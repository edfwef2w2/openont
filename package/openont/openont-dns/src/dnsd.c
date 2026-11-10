/* SPDX-License-Identifier: GPL-2.0-only */
#define _GNU_SOURCE
#include "bogus.h"
#include "cache.h"
#include "dns_proto.h"
#include "rules.h"
#include "upstream.h"

#include <arpa/inet.h>
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define MAX_UPS 64
#define MAX_SELF 32

static int g_port = 53;
static int g_cache_size = 4096;
static int g_min_ttl;
static int g_max_ttl = 3600;
static int g_serve_expired = 1;
static int g_prefetch = 1;
static int g_mode = UP_FASTEST_IP;
static int g_speed = UP_SPEED_TCP;
static int g_pref;
static int g_block_mode;
static int g_log_size = 500;
static int g_accel;
static int g_timeout_ms = 1200;
static char g_classify[256] = "/tmp/openont-stats/dns.log";
static char g_qlog_path[256] = "/tmp/openont-dns/query.log";
static char g_conf[512];

static struct upstream_srv g_ups[MAX_UPS];
static int g_nups;
static char g_self[MAX_SELF][64];
static int g_nself;
static struct ruleset *g_rules;
static struct cache *g_cache;
static struct bogus_list g_bogus;
static char **g_qlog;
static int g_qlog_n;

static volatile sig_atomic_t g_stop;
static volatile sig_atomic_t g_reload;

static void on_term(int sig)
{
	(void)sig;
	g_stop = 1;
}

static void on_hup(int sig)
{
	(void)sig;
	g_reload = 1;
}

static int is_self(const char *ip)
{
	int i;
	if (!ip || !ip[0])
		return 1;
	if (!strcmp(ip, "127.0.0.1") || !strcmp(ip, "::1") || !strcmp(ip, "0.0.0.0"))
		return 1;
	for (i = 0; i < g_nself; i++) {
		if (!strcmp(g_self[i], ip))
			return 1;
	}
	return 0;
}

static const char *type_name(uint16_t t)
{
	if (t == DNS_T_A)
		return "A";
	if (t == DNS_T_AAAA)
		return "AAAA";
	if (t == DNS_T_CNAME)
		return "CNAME";
	return "OTHER";
}

static void qlog_add(const char *client, const char *name, uint16_t qtype,
		     const char *action, const char *detail)
{
	char line[512];
	FILE *fp;
	int i;
	int keep;

	if (g_log_size < 1)
		return;
	snprintf(line, sizeof(line), "%ld %s %s %s %s %s",
		 (long)time(NULL), client && client[0] ? client : "-",
		 name && name[0] ? name : "-", type_name(qtype),
		 action ? action : "-", detail ? detail : "-");
	for (i = 0; line[i]; i++) {
		if (line[i] == '\n' || line[i] == '\r')
			line[i] = ' ';
	}
	if (!g_qlog) {
		g_qlog = calloc((size_t)g_log_size, sizeof(char *));
		if (!g_qlog)
			return;
	}
	if (g_qlog_n == g_log_size) {
		free(g_qlog[0]);
		memmove(g_qlog, g_qlog + 1, (size_t)(g_log_size - 1) * sizeof(char *));
		g_qlog_n--;
	}
	g_qlog[g_qlog_n++] = strdup(line);
	fp = fopen(g_qlog_path, "w");
	if (!fp)
		return;
	keep = g_qlog_n;
	for (i = 0; i < keep; i++) {
		if (g_qlog[i])
			fprintf(fp, "%s\n", g_qlog[i]);
	}
	fclose(fp);
}

static void classify_ip(const char *name, const char *ip)
{
	FILE *fp;
	if (!name || !ip || is_self(ip) || bogus_contains(&g_bogus, ip))
		return;
	fp = fopen(g_classify, "a");
	if (!fp)
		return;
	fprintf(fp, "reply %s is %s\n", name, ip);
	fclose(fp);
}

static int safe_token(const char *s)
{
	if (!s || !s[0] || strlen(s) > 64)
		return 0;
	for (; *s; s++) {
		unsigned char c = (unsigned char)*s;
		if (!isalnum(c) && c != '_' && c != '-')
			return 0;
	}
	return 1;
}

static void nftset_add(const char *spec, const char *ip)
{
	char tmp[160];
	char family[32];
	char table[64];
	char setname[64];
	char elem[96];
	char key[160];
	static char seen[64][160];
	static int nseen;
	pid_t pid;
	int i;
	uint8_t addr[4];

	if (!spec || !spec[0] || !ip || dns_parse_ipv4(ip, addr) != 0)
		return;
	snprintf(tmp, sizeof(tmp), "%s", spec);
	if (sscanf(tmp, "%31[^/]/%63[^/]/%63s", family, table, setname) != 3)
		return;
	if (!safe_token(family) || !safe_token(table) || !safe_token(setname))
		return;
	snprintf(key, sizeof(key), "%s/%s", spec, ip);
	for (i = 0; i < nseen; i++) {
		if (!strcmp(seen[i], key))
			return;
	}
	if (nseen < 64)
		snprintf(seen[nseen++], sizeof(seen[0]), "%s", key);
	snprintf(elem, sizeof(elem), "{ %s timeout 1h }", ip);
	pid = fork();
	if (pid < 0)
		return;
	if (pid == 0) {
		int fd = open("/dev/null", O_RDWR);
		if (fd >= 0) {
			dup2(fd, 0);
			dup2(fd, 1);
			dup2(fd, 2);
			if (fd > 2)
				close(fd);
		}
		execlp("nft", "nft", "add", "element", family, table, setname, elem, (char *)NULL);
		_exit(127);
	}
	waitpid(pid, NULL, 0);
}

static void note_answers(const char *name, const char *nftset, const uint8_t *pkt, int len)
{
	struct dns_rr rr[DNS_MAX_RR];
	int n;
	int i;

	n = dns_parse_answers(pkt, len, rr, DNS_MAX_RR);
	for (i = 0; i < n; i++) {
		if ((rr[i].type == DNS_T_A || rr[i].type == DNS_T_AAAA) && rr[i].text[0]) {
			classify_ip(name, rr[i].text);
			if (nftset && nftset[0])
				nftset_add(nftset, rr[i].text);
		}
	}
}

static int send_out(int udp_fd, int tcp_fd, struct sockaddr *peer, socklen_t peerlen,
		    const uint8_t *pkt, int len)
{
	if (len <= 0)
		return -1;
	if (tcp_fd >= 0) {
		uint8_t hdr[2];
		hdr[0] = (uint8_t)(len >> 8);
		hdr[1] = (uint8_t)len;
		if (send(tcp_fd, hdr, 2, MSG_NOSIGNAL) != 2)
			return -1;
		if (send(tcp_fd, pkt, (size_t)len, MSG_NOSIGNAL) != len)
			return -1;
		return 0;
	}
	return sendto(udp_fd, pkt, (size_t)len, 0, peer, peerlen) == len ? 0 : -1;
}

static int collect_group(const char *group, struct upstream_srv *out, int maxn)
{
	int n = 0;
	int i;
	const char *g = (group && group[0]) ? group : "default";

	for (i = 0; i < g_nups && n < maxn; i++) {
		if (strcmp(g_ups[i].group, g) == 0)
			out[n++] = g_ups[i];
	}
	return n;
}

static int packet_usable(const uint8_t *pkt, int len)
{
	struct dns_rr rr[DNS_MAX_RR];
	int n;
	int i;
	int addrs = 0;
	int bad = 0;
	int rcode;

	if (len < 12)
		return 0;
	rcode = dns_header_rcode(pkt, len);
	if (rcode != DNS_R_NOERROR && rcode != DNS_R_NXDOMAIN)
		return 0;
	n = dns_parse_answers(pkt, len, rr, DNS_MAX_RR);
	for (i = 0; i < n; i++) {
		if (rr[i].type != DNS_T_A && rr[i].type != DNS_T_AAAA)
			continue;
		addrs++;
		if (bogus_contains(&g_bogus, rr[i].text))
			bad++;
	}
	if (addrs > 0 && bad == addrs)
		return 0;
	return 1;
}

static int forward_group(const uint8_t *q, int qlen, const char *group, uint16_t qtype,
			 const char *qname, uint8_t *out, int outmax)
{
	struct upstream_srv ups[8];
	struct upstream_result results[8];
	int nup;
	int nres;
	int i;
	char ips[8][64];
	int nips = 0;
	char best[64];
	uint32_t ttl = 60;

	nup = collect_group(group, ups, 8);
	if (nup == 0)
		return -1;
	memset(results, 0, sizeof(results));
	nres = upstream_race(ups, nup, q, qlen, g_mode, g_timeout_ms, results, 8);
	if (nres <= 0)
		return -1;
	if (g_mode != UP_FASTEST_IP || (qtype != DNS_T_A && qtype != DNS_T_AAAA)) {
		for (i = 0; i < nres; i++) {
			if (packet_usable(results[i].pkt, results[i].rlen) &&
			    results[i].rlen <= outmax) {
				memcpy(out, results[i].pkt, (size_t)results[i].rlen);
				dns_set_id(out, results[i].rlen, dns_header_id(q, qlen));
				return results[i].rlen;
			}
		}
		if (results[0].rlen > 12 && results[0].rlen <= outmax) {
			memcpy(out, results[0].pkt, (size_t)results[0].rlen);
			dns_set_id(out, results[0].rlen, dns_header_id(q, qlen));
			return results[0].rlen;
		}
		return -1;
	}
	for (i = 0; i < nres; i++) {
		struct dns_rr rr[DNS_MAX_RR];
		int na;
		int j;
		if (!packet_usable(results[i].pkt, results[i].rlen))
			continue;
		na = dns_parse_answers(results[i].pkt, results[i].rlen, rr, DNS_MAX_RR);
		for (j = 0; j < na && nips < 8; j++) {
			int k;
			int dup = 0;
			if (rr[j].type != qtype || !rr[j].text[0])
				continue;
			if (bogus_contains(&g_bogus, rr[j].text))
				continue;
			for (k = 0; k < nips; k++) {
				if (!strcmp(ips[k], rr[j].text))
					dup = 1;
			}
			if (dup)
				continue;
			snprintf(ips[nips], sizeof(ips[nips]), "%s", rr[j].text);
			if (rr[j].ttl)
				ttl = rr[j].ttl;
			nips++;
		}
	}
	if (nips == 0)
		return -1;
	if (upstream_pick_ip(ips, nips, g_speed, 400, best, sizeof(best)) != 0)
		return -1;
	{
		struct dns_rr rr;
		uint8_t addr[16];
		if (qtype == DNS_T_A && dns_parse_ipv4(best, addr) == 0)
			dns_make_a(&rr, qname, ttl, addr);
		else if (qtype == DNS_T_AAAA && dns_parse_ipv6(best, addr) == 0)
			dns_make_aaaa(&rr, qname, ttl, addr);
		else
			return -1;
		return dns_build_response(out, outmax, q, qlen, DNS_R_NOERROR, &rr, 1);
	}
}

static int build_empty(const uint8_t *q, int qlen, int rcode, uint8_t *out, int outmax)
{
	return dns_build_response(out, outmax, q, qlen, rcode, NULL, 0);
}

static int build_block(const uint8_t *q, int qlen, uint16_t qtype, const char *qname,
		       uint8_t *out, int outmax)
{
	struct dns_rr rr;
	uint8_t z4[4] = { 0, 0, 0, 0 };
	uint8_t z6[16];

	if (g_block_mode == 1)
		return build_empty(q, qlen, DNS_R_REFUSED, out, outmax);
	if (g_block_mode == 2) {
		if (qtype == DNS_T_A) {
			dns_make_a(&rr, qname, 60, z4);
			return dns_build_response(out, outmax, q, qlen, DNS_R_NOERROR, &rr, 1);
		}
		if (qtype == DNS_T_AAAA) {
			memset(z6, 0, sizeof(z6));
			dns_make_aaaa(&rr, qname, 60, z6);
			return dns_build_response(out, outmax, q, qlen, DNS_R_NOERROR, &rr, 1);
		}
	}
	return build_empty(q, qlen, DNS_R_NXDOMAIN, out, outmax);
}

static int forward_name(const uint8_t *q, int qlen, const char *group, uint16_t qtype,
			const char *qname, uint8_t *out, int outmax)
{
	int n;
	const char *g = (group && group[0]) ? group : "default";

	n = forward_group(q, qlen, g, qtype, qname, out, outmax);
	if (n > 0 && packet_usable(out, n))
		return n;
	if (strcmp(g, "default") != 0) {
		n = forward_group(q, qlen, "default", qtype, qname, out, outmax);
		if (n > 0)
			return n;
	}
	return build_empty(q, qlen, 2, out, outmax);
}

static uint32_t packet_ttl(const uint8_t *pkt, int len)
{
	struct dns_rr rr[DNS_MAX_RR];
	int n = dns_parse_answers(pkt, len, rr, DNS_MAX_RR);
	return dns_answer_ttl(rr, n, 60);
}

static void store_packet(const char *name, uint16_t qtype, const uint8_t *pkt, int len)
{
	int rcode;
	uint32_t ttl;
	if (!g_cache || len <= 0 || len > 1200)
		return;
	rcode = dns_header_rcode(pkt, len);
	ttl = packet_ttl(pkt, len);
	if (rcode == DNS_R_NXDOMAIN && ttl == 60)
		ttl = 30;
	cache_store(g_cache, name, qtype, rcode, pkt, len, ttl, (uint32_t)time(NULL));
}

static int resolve_query(const uint8_t *q, int qlen, const char *client, int bypass,
			 const char *lan_ip, int depth, uint8_t *out, int outmax, int *from_cache)
{
	struct dns_question qq;
	struct rules_hit hit;
	int skip;
	char group[64];

	if (from_cache)
		*from_cache = 0;
	if (dns_parse_question(q, qlen, &qq) != 0 || !qq.name[0])
		return -1;
	memset(&hit, 0, sizeof(hit));
	if (g_rules)
		rules_match(g_rules, qq.name, client, &hit);
	skip = g_rules && rules_client_skips(g_rules, client);

	if (hit.rewrite && depth < 4) {
		struct dns_rr rr[DNS_MAX_RR];
		int nrr = 0;
		if (hit.rewrite_type == DNS_T_CNAME) {
			uint8_t subq[512];
			uint8_t sub[DNS_MAX_PACKET];
			int slen;
			int sublen;
			struct dns_rr extra[DNS_MAX_RR];
			int ne;
			int i;
			dns_make_cname(&rr[0], qq.name, 60, hit.rewrite_value);
			nrr = 1;
			slen = dns_build_query(subq, sizeof(subq), dns_header_id(q, qlen),
					       hit.rewrite_value, qq.qtype);
			if (slen > 0) {
				sublen = resolve_query(subq, slen, client, bypass, lan_ip, depth + 1,
						       sub, sizeof(sub), NULL);
				if (sublen > 0) {
					ne = dns_parse_answers(sub, sublen, extra, DNS_MAX_RR);
					for (i = 0; i < ne && nrr < DNS_MAX_RR; i++) {
						uint8_t addr[16];
						if (extra[i].type == DNS_T_A &&
						    dns_parse_ipv4(extra[i].text, addr) == 0)
							dns_make_a(&rr[nrr++], extra[i].name, extra[i].ttl, addr);
						else if (extra[i].type == DNS_T_AAAA &&
							 dns_parse_ipv6(extra[i].text, addr) == 0)
							dns_make_aaaa(&rr[nrr++], extra[i].name, extra[i].ttl, addr);
					}
				}
			}
			qlog_add(client, qq.name, qq.qtype, "rewrite", hit.rewrite_value);
			return dns_build_response(out, outmax, q, qlen, DNS_R_NOERROR, rr, nrr);
		}
		if (hit.rewrite_type == qq.qtype ||
		    (hit.rewrite_type == DNS_T_A && qq.qtype == DNS_T_A) ||
		    (hit.rewrite_type == DNS_T_AAAA && qq.qtype == DNS_T_AAAA)) {
			uint8_t addr[16];
			if (hit.rewrite_type == DNS_T_A && dns_parse_ipv4(hit.rewrite_value, addr) == 0)
				dns_make_a(&rr[0], qq.name, 60, addr);
			else if (hit.rewrite_type == DNS_T_AAAA && dns_parse_ipv6(hit.rewrite_value, addr) == 0)
				dns_make_aaaa(&rr[0], qq.name, 60, addr);
			else
				goto after_rewrite;
			qlog_add(client, qq.name, qq.qtype, "rewrite", hit.rewrite_value);
			if (!is_self(hit.rewrite_value))
				classify_ip(qq.name, hit.rewrite_value);
			return dns_build_response(out, outmax, q, qlen, DNS_R_NOERROR, &rr[0], 1);
		}
	}
after_rewrite:
	if (g_accel && hit.accel && !bypass) {
		struct dns_rr rr;
		uint8_t addr[4];
		const char *lip = (lan_ip && lan_ip[0]) ? lan_ip : (g_nself ? g_self[0] : NULL);
		qlog_add(client, qq.name, qq.qtype, "accel", lip ? lip : "-");
		if (qq.qtype == DNS_T_A && lip && dns_parse_ipv4(lip, addr) == 0) {
			dns_make_a(&rr, qq.name, 30, addr);
			return dns_build_response(out, outmax, q, qlen, DNS_R_NOERROR, &rr, 1);
		}
		return build_empty(q, qlen, DNS_R_NOERROR, out, outmax);
	}
	if (!skip && hit.block) {
		qlog_add(client, qq.name, qq.qtype, "block",
			 g_block_mode == 1 ? "refused" : (g_block_mode == 2 ? "zero" : "nxdomain"));
		return build_block(q, qlen, qq.qtype, qq.name, out, outmax);
	}
	if ((g_pref == 1 && qq.qtype == DNS_T_AAAA) || (g_pref == 2 && qq.qtype == DNS_T_A)) {
		qlog_add(client, qq.name, qq.qtype, "pref", g_pref == 1 ? "v4" : "v6");
		return build_empty(q, qlen, DNS_R_NOERROR, out, outmax);
	}
	if (g_cache && depth == 0) {
		int rcode = 0;
		int plen = 0;
		int refresh = 0;
		int st = cache_lookup(g_cache, qq.name, qq.qtype, (uint32_t)time(NULL),
				      &rcode, out, outmax, &plen, &refresh);
		if (st == CACHE_FRESH || st == CACHE_STALE) {
			if (from_cache)
				*from_cache = 1;
			if (!(refresh && (st == CACHE_STALE || g_prefetch))) {
				qlog_add(client, qq.name, qq.qtype, "cache", st == CACHE_STALE ? "stale" : "hit");
				return plen;
			}
			/* Stale or prefetch: fall through and replace. A stale hit still
			 * returns the fresh lookup below so the client is not stuck on it. */
		}
	}
	snprintf(group, sizeof(group), "%s", hit.group[0] ? hit.group : "default");
	{
		int n = forward_name(q, qlen, group, qq.qtype, qq.name, out, outmax);
		if (n > 0) {
			store_packet(qq.name, qq.qtype, out, n);
			note_answers(qq.name, hit.nftset, out, n);
			qlog_add(client, qq.name, qq.qtype, "forward", group);
		}
		return n;
	}
}

static void handle_packet(const uint8_t *q, int qlen, const char *client, int bypass,
			  const char *lan_ip, int udp_fd, int tcp_fd,
			  struct sockaddr *peer, socklen_t peerlen)
{
	uint8_t out[DNS_MAX_PACKET];
	int n = resolve_query(q, qlen, client, bypass, lan_ip, 0, out, sizeof(out), NULL);
	if (n > 0)
		send_out(udp_fd, tcp_fd, peer, peerlen, out, n);
}

static char *trim(char *s)
{
	char *e;
	while (*s && isspace((unsigned char)*s))
		s++;
	e = s + strlen(s);
	while (e > s && isspace((unsigned char)e[-1]))
		*--e = '\0';
	return s;
}

static void load_include(const char *path)
{
	FILE *fp;
	char line[1024];

	fp = fopen(path, "r");
	if (!fp)
		return;
	while (fgets(line, sizeof(line), fp)) {
		char cooked[1100];
		char *s = trim(line);
		if (!*s || *s == '#' || *s == '!')
			continue;
		snprintf(cooked, sizeof(cooked), "adg - %s", s);
		rules_load_line(g_rules, cooked);
	}
	fclose(fp);
}

static int tokenise(char *s, char **tok, int max)
{
	int n = 0;
	char *save = NULL;
	for (s = strtok_r(s, " \t", &save); s && n < max; s = strtok_r(NULL, " \t", &save))
		tok[n++] = s;
	return n;
}

static void load_conf(const char *path)
{
	FILE *fp;
	char line[1024];
	int i;

	if (g_rules)
		rules_free(g_rules);
	g_rules = rules_create();
	bogus_free(&g_bogus);
	g_nups = 0;
	g_nself = 0;
	fp = fopen(path, "r");
	if (!fp) {
		fprintf(stderr, "openont-dnsd: cannot read %s\n", path);
	} else {
		while (fgets(line, sizeof(line), fp)) {
			char *s = trim(line);
			char *tok[8];
			int n;
			char copy[1024];
			if (!*s || *s == '#')
				continue;
			snprintf(copy, sizeof(copy), "%s", s);
			n = tokenise(s, tok, 8);
			if (n >= 2 && !strcmp(tok[0], "port"))
				g_port = atoi(tok[1]);
			else if (n >= 2 && !strcmp(tok[0], "cache_size"))
				g_cache_size = atoi(tok[1]);
			else if (n >= 2 && !strcmp(tok[0], "min_ttl"))
				g_min_ttl = atoi(tok[1]);
			else if (n >= 2 && !strcmp(tok[0], "max_ttl"))
				g_max_ttl = atoi(tok[1]);
			else if (n >= 2 && !strcmp(tok[0], "serve_expired"))
				g_serve_expired = atoi(tok[1]);
			else if (n >= 2 && !strcmp(tok[0], "prefetch"))
				g_prefetch = atoi(tok[1]);
			else if (n >= 2 && !strcmp(tok[0], "log_size"))
				g_log_size = atoi(tok[1]);
			else if (n >= 2 && !strcmp(tok[0], "accel"))
				g_accel = atoi(tok[1]);
			else if (n >= 2 && !strcmp(tok[0], "response_mode")) {
				if (!strcmp(tok[1], "first-response"))
					g_mode = UP_FIRST;
				else if (!strcmp(tok[1], "fastest-response"))
					g_mode = UP_FASTEST_RESP;
				else
					g_mode = UP_FASTEST_IP;
			} else if (n >= 2 && !strcmp(tok[0], "speed_check")) {
				if (!strcmp(tok[1], "icmp"))
					g_speed = UP_SPEED_ICMP;
				else if (!strcmp(tok[1], "off"))
					g_speed = UP_SPEED_OFF;
				else
					g_speed = UP_SPEED_TCP;
			} else if (n >= 2 && !strcmp(tok[0], "ip_pref")) {
				if (!strcmp(tok[1], "v4"))
					g_pref = 1;
				else if (!strcmp(tok[1], "v6"))
					g_pref = 2;
				else
					g_pref = 0;
			} else if (n >= 2 && !strcmp(tok[0], "block_mode")) {
				if (!strcmp(tok[1], "refused"))
					g_block_mode = 1;
				else if (!strcmp(tok[1], "zero"))
					g_block_mode = 2;
				else
					g_block_mode = 0;
			} else if (n >= 2 && !strcmp(tok[0], "classify_log"))
				snprintf(g_classify, sizeof(g_classify), "%s", tok[1]);
			else if (n >= 2 && !strcmp(tok[0], "query_log"))
				snprintf(g_qlog_path, sizeof(g_qlog_path), "%s", tok[1]);
			else if (n >= 2 && !strcmp(tok[0], "self") && g_nself < MAX_SELF)
				snprintf(g_self[g_nself++], sizeof(g_self[0]), "%s", tok[1]);
			else if (n >= 2 && !strcmp(tok[0], "bogus"))
				bogus_add_cidr(&g_bogus, tok[1]);
			else if (n >= 2 && !strcmp(tok[0], "include"))
				load_include(tok[1]);
			else if (n >= 5 && !strcmp(tok[0], "upstream") && g_nups < MAX_UPS) {
				struct upstream_srv *u = &g_ups[g_nups++];
				memset(u, 0, sizeof(*u));
				snprintf(u->group, sizeof(u->group), "%s", tok[1]);
				snprintf(u->proto, sizeof(u->proto), "%s", tok[2]);
				snprintf(u->host, sizeof(u->host), "%s", tok[3]);
				u->port = atoi(tok[4]);
				if (n >= 6 && strcmp(tok[5], "-") != 0)
					snprintf(u->tls_host, sizeof(u->tls_host), "%s", tok[5]);
				if (n >= 7 && strcmp(tok[6], "-") != 0)
					snprintf(u->path, sizeof(u->path), "%s", tok[6]);
			} else if (!strncmp(copy, "block ", 6) || !strncmp(copy, "allow ", 6) ||
				   !strncmp(copy, "rewrite ", 8) || !strncmp(copy, "accel ", 6) ||
				   !strncmp(copy, "domain ", 7) || !strncmp(copy, "adg ", 4) ||
				   !strncmp(copy, "skip ", 5)) {
				rules_load_line(g_rules, copy);
			}
		}
		fclose(fp);
	}
	{
		char boot[64] = "";
		uint8_t tmp[16];
		for (i = 0; i < g_nups; i++) {
			if (!strcmp(g_ups[i].proto, "udp") && dns_parse_ipv4(g_ups[i].host, tmp) == 0) {
				snprintf(boot, sizeof(boot), "%s", g_ups[i].host);
				break;
			}
		}
		for (i = 0; i < g_nups; i++) {
			char resolved[64];
			if (dns_parse_ipv4(g_ups[i].host, tmp) == 0 || dns_parse_ipv6(g_ups[i].host, tmp) == 0)
				continue;
			if (!g_ups[i].tls_host[0])
				snprintf(g_ups[i].tls_host, sizeof(g_ups[i].tls_host), "%s", g_ups[i].host);
			if (boot[0] && upstream_resolve_a(boot, 53, g_ups[i].host, resolved, sizeof(resolved)) == 0)
				snprintf(g_ups[i].host, sizeof(g_ups[i].host), "%s", resolved);
		}
	}
	if (g_cache)
		cache_free(g_cache);
	g_cache = cache_create(g_cache_size, g_min_ttl, g_max_ttl, g_serve_expired);
	fprintf(stderr, "openont-dnsd: config loaded, %d upstreams\n", g_nups);
}

static int bind_udp(int family, int port)
{
	int fd;
	int on = 1;

	fd = socket(family, SOCK_DGRAM, 0);
	if (fd < 0)
		return -1;
	setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));
	if (family == AF_INET) {
		struct sockaddr_in sa;
		memset(&sa, 0, sizeof(sa));
		sa.sin_family = AF_INET;
		sa.sin_port = htons((uint16_t)port);
		sa.sin_addr.s_addr = htonl(INADDR_ANY);
		if (bind(fd, (struct sockaddr *)&sa, sizeof(sa)) != 0) {
			close(fd);
			return -1;
		}
		setsockopt(fd, IPPROTO_IP, IP_PKTINFO, &on, sizeof(on));
	} else {
		struct sockaddr_in6 sa;
		memset(&sa, 0, sizeof(sa));
		sa.sin6_family = AF_INET6;
		sa.sin6_port = htons((uint16_t)port);
		if (bind(fd, (struct sockaddr *)&sa, sizeof(sa)) != 0) {
			close(fd);
			return -1;
		}
		setsockopt(fd, IPPROTO_IPV6, IPV6_RECVPKTINFO, &on, sizeof(on));
		setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &on, sizeof(on));
	}
	return fd;
}

static int bind_tcp(int family, int port)
{
	int fd;
	int on = 1;

	fd = socket(family, SOCK_STREAM, 0);
	if (fd < 0)
		return -1;
	setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));
	if (family == AF_INET) {
		struct sockaddr_in sa;
		memset(&sa, 0, sizeof(sa));
		sa.sin_family = AF_INET;
		sa.sin_port = htons((uint16_t)port);
		sa.sin_addr.s_addr = htonl(INADDR_ANY);
		if (bind(fd, (struct sockaddr *)&sa, sizeof(sa)) != 0) {
			close(fd);
			return -1;
		}
	} else {
		struct sockaddr_in6 sa;
		memset(&sa, 0, sizeof(sa));
		sa.sin6_family = AF_INET6;
		sa.sin6_port = htons((uint16_t)port);
		if (bind(fd, (struct sockaddr *)&sa, sizeof(sa)) != 0) {
			close(fd);
			return -1;
		}
		setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &on, sizeof(on));
	}
	if (listen(fd, 16) != 0) {
		close(fd);
		return -1;
	}
	return fd;
}

static void client_str(struct sockaddr *sa, char *out, int outlen)
{
	char ip[64];
	if (sa->sa_family == AF_INET) {
		inet_ntop(AF_INET, &((struct sockaddr_in *)sa)->sin_addr, ip, sizeof(ip));
		snprintf(out, (size_t)outlen, "%s", ip);
	} else if (sa->sa_family == AF_INET6) {
		inet_ntop(AF_INET6, &((struct sockaddr_in6 *)sa)->sin6_addr, ip, sizeof(ip));
		snprintf(out, (size_t)outlen, "%s", ip);
	} else {
		snprintf(out, (size_t)outlen, "-");
	}
}

static int is_loopback(const char *ip)
{
	return ip && (!strcmp(ip, "127.0.0.1") || !strcmp(ip, "::1"));
}

static void read_udp(int fd)
{
	uint8_t buf[DNS_MAX_PACKET];
	char cbuf[256];
	char client[64];
	char lan[64];
	struct sockaddr_storage peer;
	struct iovec iov;
	struct msghdr msg;
	struct cmsghdr *cmsg;
	int n;
	int bypass;

	memset(&msg, 0, sizeof(msg));
	iov.iov_base = buf;
	iov.iov_len = sizeof(buf);
	msg.msg_name = &peer;
	msg.msg_namelen = sizeof(peer);
	msg.msg_iov = &iov;
	msg.msg_iovlen = 1;
	msg.msg_control = cbuf;
	msg.msg_controllen = sizeof(cbuf);
	n = (int)recvmsg(fd, &msg, 0);
	if (n < 12)
		return;
	lan[0] = '\0';
	for (cmsg = CMSG_FIRSTHDR(&msg); cmsg; cmsg = CMSG_NXTHDR(&msg, cmsg)) {
		if (cmsg->cmsg_level == IPPROTO_IP && cmsg->cmsg_type == IP_PKTINFO) {
			struct in_pktinfo *pi = (struct in_pktinfo *)CMSG_DATA(cmsg);
			inet_ntop(AF_INET, &pi->ipi_addr, lan, sizeof(lan));
		}
	}
	client_str((struct sockaddr *)&peer, client, sizeof(client));
	bypass = is_loopback(client) || is_loopback(lan);
	handle_packet(buf, n, client, bypass, lan, fd, -1, (struct sockaddr *)&peer, msg.msg_namelen);
}

static int read_n(int fd, uint8_t *buf, int len)
{
	int off = 0;
	while (off < len) {
		int n = (int)recv(fd, buf + off, (size_t)(len - off), 0);
		if (n <= 0)
			return -1;
		off += n;
	}
	return 0;
}

static void read_tcp(int lfd)
{
	struct sockaddr_storage peer;
	socklen_t plen = sizeof(peer);
	int fd;
	uint8_t hdr[2];
	uint8_t buf[DNS_MAX_PACKET];
	int body;
	char client[64];
	struct timeval tv;

	fd = accept(lfd, (struct sockaddr *)&peer, &plen);
	if (fd < 0)
		return;
	tv.tv_sec = 3;
	tv.tv_usec = 0;
	setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
	setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
	client_str((struct sockaddr *)&peer, client, sizeof(client));
	if (read_n(fd, hdr, 2) != 0) {
		close(fd);
		return;
	}
	body = (hdr[0] << 8) | hdr[1];
	if (body < 12 || body > (int)sizeof(buf) || read_n(fd, buf, body) != 0) {
		close(fd);
		return;
	}
	handle_packet(buf, body, client, is_loopback(client), NULL, -1, fd,
		      (struct sockaddr *)&peer, plen);
	close(fd);
}

int main(int argc, char **argv)
{
	int udp4 = -1;
	int udp6 = -1;
	int tcp4 = -1;
	int tcp6 = -1;

	if (argc < 2) {
		fprintf(stderr, "usage: openont-dnsd <config>\n");
		return 1;
	}
	snprintf(g_conf, sizeof(g_conf), "%s", argv[1]);
	signal(SIGTERM, on_term);
	signal(SIGINT, on_term);
	signal(SIGHUP, on_hup);
	signal(SIGPIPE, SIG_IGN);
	load_conf(g_conf);
	udp4 = bind_udp(AF_INET, g_port);
	udp6 = bind_udp(AF_INET6, g_port);
	tcp4 = bind_tcp(AF_INET, g_port);
	tcp6 = bind_tcp(AF_INET6, g_port);
	if (udp4 < 0 && udp6 < 0) {
		fprintf(stderr, "openont-dnsd: bind port %d failed: %s\n", g_port, strerror(errno));
		return 1;
	}
	fprintf(stderr, "openont-dnsd: listening on %d\n", g_port);
	while (!g_stop) {
		struct pollfd pf[4];
		int np = 0;
		int map[4];
		int i;
		int rc;
		if (g_reload) {
			g_reload = 0;
			load_conf(g_conf);
		}
		if (udp4 >= 0) {
			map[np] = udp4;
			pf[np].fd = udp4;
			pf[np].events = POLLIN;
			np++;
		}
		if (udp6 >= 0) {
			map[np] = udp6;
			pf[np].fd = udp6;
			pf[np].events = POLLIN;
			np++;
		}
		if (tcp4 >= 0) {
			map[np] = tcp4;
			pf[np].fd = tcp4;
			pf[np].events = POLLIN;
			np++;
		}
		if (tcp6 >= 0) {
			map[np] = tcp6;
			pf[np].fd = tcp6;
			pf[np].events = POLLIN;
			np++;
		}
		rc = poll(pf, (nfds_t)np, 1000);
		if (rc < 0) {
			if (errno == EINTR)
				continue;
			break;
		}
		for (i = 0; i < np; i++) {
			if (!(pf[i].revents & POLLIN))
				continue;
			if (pf[i].fd == udp4 || pf[i].fd == udp6)
				read_udp(pf[i].fd);
			else
				read_tcp(pf[i].fd);
		}
		(void)map;
	}
	if (udp4 >= 0)
		close(udp4);
	if (udp6 >= 0)
		close(udp6);
	if (tcp4 >= 0)
		close(tcp4);
	if (tcp6 >= 0)
		close(tcp6);
	return 0;
}

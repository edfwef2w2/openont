/* SPDX-License-Identifier: GPL-2.0-only
 *
 * openont-desync — NFQUEUE helper for DNS web acceleration.
 *
 * The forward chain queues the first packets of TCP/443 flows towards
 * addresses that openont-dnsd put into the accel sets. When the client's
 * ClientHello goes by, a decoy ClientHello is sent first through a raw
 * socket. The decoy is built so that it is seen by on-path inspection but
 * dropped before it reaches the server (hop limit too small and/or broken
 * TCP checksum). The real packet then leaves unchanged.
 *
 * Queued packets of the original direction get NF_STOP rather than
 * NF_ACCEPT: that skips the remaining forward rules for those few early
 * packets, so flow offload does not take the connection before its
 * ClientHello has been seen here. Only established packets are queued.
 */

#define _GNU_SOURCE
#include "tls_hello.h"

#include <arpa/inet.h>
#include <ctype.h>
#include <errno.h>
#include <linux/netfilter.h>
#include <libnetfilter_queue/libnetfilter_queue.h>
#include <netinet/in.h>
#include <netinet/ip.h>
#include <netinet/ip6.h>
#include <netinet/tcp.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#define DEFAULT_CONF "/tmp/openont-dns/desync.conf"
#define DEFAULT_STATUS "/tmp/openont-dns/desync.json"
#define FLOW_TAB 4096
#define FLOW_PROBE 8
#define FLOW_TTL 120
#define FAKE_MAX 1500

#define FOOL_TTL 1
#define FOOL_BADSUM 2

struct flow_key {
	uint8_t family;
	uint8_t caddr[16];
	uint8_t saddr[16];
	uint16_t cport;
	uint16_t sport;
};

struct flow {
	struct flow_key key;
	time_t ts;
	int hops;	/* routers between us and the server, -1 unknown */
	int done;
	int used;
};

static struct flow g_flows[FLOW_TAB];

static int g_queue = 11;
static int g_fooling = FOOL_TTL;
static int g_ttl_auto = 1;
static int g_ttl = 5;
static int g_ttl_delta = 1;
static int g_repeat = 1;
static char g_fake_sni[254] = "www.baidu.com";
static char g_status[256] = DEFAULT_STATUS;

static int g_raw4 = -1;
static int g_raw6 = -1;

static unsigned long g_hellos;
static unsigned long g_fakes;
static unsigned long g_auto_ttl;
static unsigned long g_fixed_ttl;
static unsigned long g_errors;
static int g_dirty = 1;

static volatile sig_atomic_t g_run = 1;

static void on_sig(int sig)
{
	(void)sig;
	g_run = 0;
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

static int clamp(int v, int lo, int hi)
{
	return v < lo ? lo : (v > hi ? hi : v);
}

static int valid_host(const char *s)
{
	size_t n = strlen(s);
	if (n < 1 || n > 253)
		return 0;
	for (; *s; s++) {
		unsigned char c = (unsigned char)*s;
		if (!isalnum(c) && c != '.' && c != '-')
			return 0;
	}
	return 1;
}

static void load_conf(const char *path)
{
	FILE *fp = fopen(path, "r");
	char line[512];

	if (!fp) {
		fprintf(stderr, "openont-desync: cannot read %s, using defaults\n", path);
		return;
	}
	while (fgets(line, sizeof(line), fp)) {
		char key[64];
		char val[256];
		char *s = trim(line);
		if (!*s || *s == '#')
			continue;
		if (sscanf(s, "%63s %255s", key, val) != 2)
			continue;
		if (!strcmp(key, "queue"))
			g_queue = clamp(atoi(val), 0, 65535);
		else if (!strcmp(key, "fooling")) {
			if (!strcmp(val, "badsum"))
				g_fooling = FOOL_BADSUM;
			else if (!strcmp(val, "both"))
				g_fooling = FOOL_TTL | FOOL_BADSUM;
			else
				g_fooling = FOOL_TTL;
		} else if (!strcmp(key, "ttl_mode"))
			g_ttl_auto = strcmp(val, "manual") != 0;
		else if (!strcmp(key, "ttl"))
			g_ttl = clamp(atoi(val), 1, 64);
		else if (!strcmp(key, "ttl_delta"))
			g_ttl_delta = clamp(atoi(val), 0, 10);
		else if (!strcmp(key, "repeat"))
			g_repeat = clamp(atoi(val), 1, 5);
		else if (!strcmp(key, "fake_sni")) {
			if (valid_host(val))
				snprintf(g_fake_sni, sizeof(g_fake_sni), "%s", val);
		} else if (!strcmp(key, "status"))
			snprintf(g_status, sizeof(g_status), "%s", val);
	}
	fclose(fp);
}

static void write_status(int running)
{
	char tmp[300];
	FILE *fp;
	int i;
	int flows = 0;
	time_t now = time(NULL);

	for (i = 0; i < FLOW_TAB; i++) {
		if (g_flows[i].used && now - g_flows[i].ts < FLOW_TTL)
			flows++;
	}
	snprintf(tmp, sizeof(tmp), "%s.new", g_status);
	fp = fopen(tmp, "w");
	if (!fp)
		return;
	fprintf(fp,
		"{\"running\":%s,\"queue\":%d,\"fooling\":\"%s\",\"ttl_mode\":\"%s\","
		"\"ttl\":%d,\"ttl_delta\":%d,\"repeat\":%d,\"hellos\":%lu,\"fakes\":%lu,"
		"\"auto_ttl\":%lu,\"fixed_ttl\":%lu,\"errors\":%lu,\"flows\":%d}\n",
		running ? "true" : "false", g_queue,
		g_fooling == (FOOL_TTL | FOOL_BADSUM) ? "both" :
		(g_fooling == FOOL_BADSUM ? "badsum" : "ttl"),
		g_ttl_auto ? "auto" : "manual", g_ttl, g_ttl_delta, g_repeat,
		g_hellos, g_fakes, g_auto_ttl, g_fixed_ttl, g_errors, flows);
	fclose(fp);
	rename(tmp, g_status);
}

static uint32_t key_hash(const struct flow_key *k)
{
	uint32_t h = 2166136261u;
	const uint8_t *p = (const uint8_t *)k;
	size_t i;
	for (i = 0; i < sizeof(*k); i++) {
		h ^= p[i];
		h *= 16777619u;
	}
	return h;
}

static struct flow *flow_get(const struct flow_key *k, int create)
{
	uint32_t h = key_hash(k);
	time_t now = time(NULL);
	struct flow *victim = NULL;
	int victim_stale = 0;
	int i;

	for (i = 0; i < FLOW_PROBE; i++) {
		struct flow *f = &g_flows[(h + (uint32_t)i) % FLOW_TAB];
		int stale = !f->used || now - f->ts >= FLOW_TTL;
		if (!stale && !memcmp(&f->key, k, sizeof(*k))) {
			f->ts = now;
			return f;
		}
		/* reuse a free or expired slot, else the least recently used one */
		if (stale) {
			if (!victim || !victim_stale) {
				victim = f;
				victim_stale = 1;
			}
		} else if (!victim || (!victim_stale && f->ts < victim->ts)) {
			victim = f;
		}
	}
	if (!create)
		return NULL;
	memset(victim, 0, sizeof(*victim));
	victim->key = *k;
	victim->ts = now;
	victim->hops = -1;
	victim->used = 1;
	return victim;
}

static uint32_t sum16(const uint8_t *p, size_t n, uint32_t s)
{
	while (n > 1) {
		s += (uint32_t)((p[0] << 8) | p[1]);
		p += 2;
		n -= 2;
	}
	if (n)
		s += (uint32_t)(p[0] << 8);
	return s;
}

static uint16_t fold(uint32_t s)
{
	while (s >> 16)
		s = (s & 0xffff) + (s >> 16);
	return (uint16_t)~s;
}

static void tcp_checksum(uint8_t *tcp, size_t tcplen, const uint8_t *src,
			 const uint8_t *dst, int alen, int bad)
{
	uint32_t s = 0;
	uint16_t c;
	uint8_t tail[4];

	tcp[16] = 0;
	tcp[17] = 0;
	s = sum16(src, (size_t)alen, s);
	s = sum16(dst, (size_t)alen, s);
	if (alen == 4) {
		tail[0] = 0;
		tail[1] = IPPROTO_TCP;
		tail[2] = (uint8_t)(tcplen >> 8);
		tail[3] = (uint8_t)tcplen;
		s = sum16(tail, 4, s);
	} else {
		uint8_t l[8] = { 0 };
		l[0] = (uint8_t)(tcplen >> 24);
		l[1] = (uint8_t)(tcplen >> 16);
		l[2] = (uint8_t)(tcplen >> 8);
		l[3] = (uint8_t)tcplen;
		l[7] = IPPROTO_TCP;
		s = sum16(l, 8, s);
	}
	s = sum16(tcp, tcplen, s);
	c = fold(s);
	if (bad)
		c = (uint16_t)(c ^ 0x5a5a);
	tcp[16] = (uint8_t)(c >> 8);
	tcp[17] = (uint8_t)c;
}

/* Routers between this host and the sender, from a TTL seen in forward. */
static int hops_from_ttl(int ttl)
{
	int init = ttl < 64 ? 64 : (ttl < 128 ? 128 : 255);
	/* the forward path already took one off for this hop */
	return init - ttl - 1;
}

static int fake_ttl(const struct flow *f, int real_ttl)
{
	if (!(g_fooling & FOOL_TTL))
		return real_ttl;
	if (g_ttl_auto && f && f->hops >= 0) {
		/* the server is hops + 1 away; stop delta hops short of it */
		int t = f->hops + 1 - g_ttl_delta;
		if (t >= 1) {
			g_auto_ttl++;
			return t;
		}
	}
	g_fixed_ttl++;
	return g_ttl;
}

static int send_fake4(const uint8_t *pkt, int iphl, int tcphl,
		      const uint8_t *fake, int flen, int ttl)
{
	uint8_t buf[FAKE_MAX + 128];
	struct iphdr *ip = (struct iphdr *)buf;
	struct sockaddr_in dst;
	int total = iphl + tcphl + flen;

	if (total > (int)sizeof(buf))
		return -1;
	memcpy(buf, pkt, (size_t)(iphl + tcphl));
	memcpy(buf + iphl + tcphl, fake, (size_t)flen);
	ip->tot_len = htons((uint16_t)total);
	ip->id = htons((uint16_t)(random() & 0xffff));
	ip->ttl = (uint8_t)ttl;
	ip->check = 0;
	ip->check = htons(fold(sum16(buf, (size_t)iphl, 0)));
	tcp_checksum(buf + iphl, (size_t)(tcphl + flen), (uint8_t *)&ip->saddr,
		     (uint8_t *)&ip->daddr, 4, g_fooling & FOOL_BADSUM);
	memset(&dst, 0, sizeof(dst));
	dst.sin_family = AF_INET;
	dst.sin_addr.s_addr = ip->daddr;
	if (sendto(g_raw4, buf, (size_t)total, 0, (struct sockaddr *)&dst, sizeof(dst)) != total)
		return -1;
	return 0;
}

static int send_fake6(const uint8_t *pkt, int tcphl,
		      const uint8_t *fake, int flen, int hlim)
{
	uint8_t buf[FAKE_MAX + 128];
	struct ip6_hdr *ip6 = (struct ip6_hdr *)buf;
	struct sockaddr_in6 dst;
	int total = 40 + tcphl + flen;

	if (total > (int)sizeof(buf))
		return -1;
	memcpy(buf, pkt, (size_t)(40 + tcphl));
	memcpy(buf + 40 + tcphl, fake, (size_t)flen);
	ip6->ip6_plen = htons((uint16_t)(tcphl + flen));
	ip6->ip6_hlim = (uint8_t)hlim;
	tcp_checksum(buf + 40, (size_t)(tcphl + flen), (uint8_t *)&ip6->ip6_src,
		     (uint8_t *)&ip6->ip6_dst, 16, g_fooling & FOOL_BADSUM);
	memset(&dst, 0, sizeof(dst));
	dst.sin6_family = AF_INET6;
	memcpy(&dst.sin6_addr, &ip6->ip6_dst, 16);
	if (sendto(g_raw6, buf, (size_t)total, 0, (struct sockaddr *)&dst, sizeof(dst)) != total)
		return -1;
	return 0;
}

/* Verdict for one queued packet. */
static int handle(const uint8_t *pkt, int len)
{
	struct flow_key k;
	struct flow *f;
	const uint8_t *tcp;
	const uint8_t *payload;
	int iphl;
	int tcphl;
	int plen;
	int ttl;
	int v6;
	uint16_t sport;
	uint16_t dport;
	uint8_t flags;

	if (len < 20)
		return NF_ACCEPT;
	memset(&k, 0, sizeof(k));
	v6 = (pkt[0] >> 4) == 6;
	if ((pkt[0] >> 4) == 4) {
		const struct iphdr *ip = (const struct iphdr *)pkt;
		iphl = ip->ihl * 4;
		if (ip->protocol != IPPROTO_TCP || iphl < 20 || len < iphl + 20 ||
		    (ntohs(ip->frag_off) & 0x3fff))
			return NF_ACCEPT;
		ttl = ip->ttl;
	} else if (v6) {
		const struct ip6_hdr *ip6 = (const struct ip6_hdr *)pkt;
		iphl = 40;
		if (len < 60 || ip6->ip6_nxt != IPPROTO_TCP)
			return NF_ACCEPT;
		ttl = ip6->ip6_hlim;
	} else {
		return NF_ACCEPT;
	}
	tcp = pkt + iphl;
	tcphl = (tcp[12] >> 4) * 4;
	if (tcphl < 20 || iphl + tcphl > len)
		return NF_ACCEPT;
	sport = (uint16_t)((tcp[0] << 8) | tcp[1]);
	dport = (uint16_t)((tcp[2] << 8) | tcp[3]);
	flags = tcp[13];
	payload = tcp + tcphl;
	if (v6)
		plen = ntohs(((const struct ip6_hdr *)pkt)->ip6_plen) - tcphl;
	else
		plen = ntohs(((const struct iphdr *)pkt)->tot_len) - iphl - tcphl;
	if (plen < 0 || iphl + tcphl + plen > len)
		plen = len - iphl - tcphl;

	k.family = v6 ? 6 : 4;
	if (sport == 443 && (flags & (TH_SYN | TH_ACK)) == (TH_SYN | TH_ACK)) {
		/* reply direction: learn how far away the server is */
		if (v6) {
			memcpy(k.caddr, pkt + 24, 16);
			memcpy(k.saddr, pkt + 8, 16);
		} else {
			memcpy(k.caddr, pkt + 16, 4);
			memcpy(k.saddr, pkt + 12, 4);
		}
		k.cport = dport;
		k.sport = sport;
		f = flow_get(&k, 1);
		if (f)
			f->hops = hops_from_ttl(ttl);
		return NF_ACCEPT;
	}
	if (dport != 443)
		return NF_ACCEPT;

	if (v6) {
		memcpy(k.caddr, pkt + 8, 16);
		memcpy(k.saddr, pkt + 24, 16);
	} else {
		memcpy(k.caddr, pkt + 12, 4);
		memcpy(k.saddr, pkt + 16, 4);
	}
	k.cport = sport;
	k.sport = dport;
	f = flow_get(&k, 1);
	if (f && !f->done && plen > 0 && tls_is_client_hello(payload, plen)) {
		uint8_t fake[FAKE_MAX];
		int flen;
		int t;
		int i;

		f->done = 1;
		g_hellos++;
		g_dirty = 1;
		flen = tls_build_fake(payload, plen, g_fake_sni, fake, sizeof(fake));
		if (flen <= 0) {
			g_errors++;
			return NF_STOP;
		}
		t = fake_ttl(f, ttl);
		for (i = 0; i < g_repeat; i++) {
			int rc = v6 ? send_fake6(pkt, tcphl, fake, flen, t)
				    : send_fake4(pkt, iphl, tcphl, fake, flen, t);
			if (rc == 0)
				g_fakes++;
			else
				g_errors++;
		}
	}
	return NF_STOP;
}

static int cb(struct nfq_q_handle *qh, struct nfgenmsg *nfmsg,
	      struct nfq_data *nfa, void *data)
{
	struct nfqnl_msg_packet_hdr *ph;
	unsigned char *pkt = NULL;
	uint32_t id = 0;
	int len;
	int verdict = NF_ACCEPT;

	(void)nfmsg;
	(void)data;
	ph = nfq_get_msg_packet_hdr(nfa);
	if (ph)
		id = ntohl(ph->packet_id);
	len = nfq_get_payload(nfa, &pkt);
	if (len > 0 && pkt)
		verdict = handle(pkt, len);
	return nfq_set_verdict(qh, id, (uint32_t)verdict, 0, NULL);
}

int main(int argc, char **argv)
{
	struct nfq_handle *h;
	struct nfq_q_handle *qh;
	char buf[65536] __attribute__((aligned));
	time_t last = 0;
	int fd;
	int one = 1;

	load_conf(argc > 1 ? argv[1] : DEFAULT_CONF);
	srandom((unsigned int)(time(NULL) ^ getpid()));
	signal(SIGINT, on_sig);
	signal(SIGTERM, on_sig);
	signal(SIGPIPE, SIG_IGN);

	g_raw4 = socket(AF_INET, SOCK_RAW, IPPROTO_RAW);
	if (g_raw4 >= 0)
		setsockopt(g_raw4, IPPROTO_IP, IP_HDRINCL, &one, sizeof(one));
	g_raw6 = socket(AF_INET6, SOCK_RAW, IPPROTO_RAW);
	if (g_raw4 < 0 && g_raw6 < 0) {
		fprintf(stderr, "openont-desync: raw socket: %s\n", strerror(errno));
		return 1;
	}

	h = nfq_open();
	if (!h) {
		fprintf(stderr, "openont-desync: nfq_open: %s\n", strerror(errno));
		return 1;
	}
	nfq_unbind_pf(h, AF_INET);
	nfq_bind_pf(h, AF_INET);
	nfq_unbind_pf(h, AF_INET6);
	nfq_bind_pf(h, AF_INET6);
	qh = nfq_create_queue(h, (uint16_t)g_queue, &cb, NULL);
	if (!qh) {
		fprintf(stderr, "openont-desync: queue %d: %s\n", g_queue, strerror(errno));
		nfq_close(h);
		return 1;
	}
	if (nfq_set_mode(qh, NFQNL_COPY_PACKET, 0xffff) < 0)
		fprintf(stderr, "openont-desync: set_mode failed\n");
	/* on overload let packets through instead of dropping them */
	nfq_set_queue_flags(qh, NFQA_CFG_F_FAIL_OPEN, NFQA_CFG_F_FAIL_OPEN);

	write_status(1);
	fd = nfq_fd(h);
	while (g_run) {
		int rv = (int)recv(fd, buf, sizeof(buf), 0);
		time_t now;
		if (rv >= 0) {
			nfq_handle_packet(h, buf, rv);
		} else if (errno == ENOBUFS) {
			g_errors++;
		} else if (errno != EINTR) {
			fprintf(stderr, "openont-desync: recv: %s\n", strerror(errno));
			break;
		}
		now = time(NULL);
		if (g_dirty && now != last) {
			write_status(1);
			g_dirty = 0;
			last = now;
		}
	}
	write_status(0);
	nfq_destroy_queue(qh);
	nfq_close(h);
	return 0;
}

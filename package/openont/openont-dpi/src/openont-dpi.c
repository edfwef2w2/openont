/* SPDX-License-Identifier: GPL-2.0-only
 *
 * openont-dpi — NFQUEUE userspace classifier for OpenONT.
 * Writes sticky flow labels for openont-statsd and dpi_meta.json.
 */

#define _GNU_SOURCE
#include "classify.h"

#include <arpa/inet.h>
#include <errno.h>
#include <linux/netfilter.h>
#include <netinet/ip.h>
#include <netinet/ip6.h>
#include <netinet/tcp.h>
#include <netinet/udp.h>
#include <libnetfilter_queue/libnetfilter_queue.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define STATS_DIR "/tmp/openont-stats"
#define FLOW_FILE STATS_DIR "/flow.class"
#define META_FILE STATS_DIR "/dpi_meta.json"
#define BUCKET_CONF_SYS "/usr/share/openont/dpi-buckets.conf"
#define BUCKET_CONF_USR "/etc/openont/dpi-buckets.conf"
#define DEFAULT_QUEUE 10

/* packet mark: bits 16..23 = bucket id (1..9), non-zero means labeled */
#define MARK_SHIFT 16
#define MARK_MASK  0x00FF0000u

struct flow_key {
	uint8_t family; /* 4 or 6 */
	uint8_t proto;
	uint16_t sport, dport;
	uint8_t saddr[16];
	uint8_t daddr[16];
};

struct flow_entry {
	struct flow_key key;
	uint8_t bucket;
	uint8_t done;
	uint32_t pkts;
	time_t ts;
};

#define FLOW_TAB 4096
static struct flow_entry g_flows[FLOW_TAB];
static struct oo_classifier g_cls;
static volatile sig_atomic_t g_run = 1;
static uint32_t g_flows_seen;
static uint32_t g_flows_classified;
static uint32_t g_queue_pkts;
static uint32_t g_queue_drops;
static int g_queue_num = DEFAULT_QUEUE;
static char g_mode[16] = "sample";

static void on_sig(int sig)
{
	(void)sig;
	g_run = 0;
}

static uint32_t key_hash(const struct flow_key *k)
{
	uint32_t h = k->proto;
	size_t i;
	h = h * 131 + k->sport;
	h = h * 131 + k->dport;
	for (i = 0; i < (k->family == 6 ? 16u : 4u); i++) {
		h = h * 131 + k->saddr[i];
		h = h * 131 + k->daddr[i];
	}
	return h;
}

static int key_eq(const struct flow_key *a, const struct flow_key *b)
{
	if (a->family != b->family || a->proto != b->proto ||
	    a->sport != b->sport || a->dport != b->dport)
		return 0;
	return memcmp(a->saddr, b->saddr, a->family == 6 ? 16 : 4) == 0 &&
	       memcmp(a->daddr, b->daddr, a->family == 6 ? 16 : 4) == 0;
}

static struct flow_entry *flow_get(const struct flow_key *k, int create)
{
	uint32_t h = key_hash(k) % FLOW_TAB;
	uint32_t i;
	for (i = 0; i < FLOW_TAB; i++) {
		uint32_t idx = (h + i) % FLOW_TAB;
		struct flow_entry *e = &g_flows[idx];
		if (e->ts == 0) {
			if (!create)
				return NULL;
			memset(e, 0, sizeof(*e));
			e->key = *k;
			e->ts = time(NULL);
			g_flows_seen++;
			return e;
		}
		if (key_eq(&e->key, k))
			return e;
	}
	return NULL;
}

static void addr_to_str(const struct flow_key *k, int src, char *buf, size_t sz)
{
	const uint8_t *a = src ? k->saddr : k->daddr;
	if (k->family == 6)
		inet_ntop(AF_INET6, a, buf, (socklen_t)sz);
	else
		inet_ntop(AF_INET, a, buf, (socklen_t)sz);
}

/* Rewrite flow.class from in-memory table (simple, small scale) */
static void flush_flow_file(void)
{
	char path[128], tmp[140];
	FILE *fp;
	size_t i;

	snprintf(path, sizeof(path), "%s", FLOW_FILE);
	snprintf(tmp, sizeof(tmp), "%s.tmp", FLOW_FILE);
	fp = fopen(tmp, "w");
	if (!fp)
		return;
	for (i = 0; i < FLOW_TAB; i++) {
		struct flow_entry *e = &g_flows[i];
		char sa[64], da[64];
		const char *pname;
		if (!e->ts || !e->done || e->bucket == OO_B_UNKNOWN)
			continue;
		addr_to_str(&e->key, 1, sa, sizeof(sa));
		addr_to_str(&e->key, 0, da, sizeof(da));
		pname = e->key.proto == 6 ? "tcp" : (e->key.proto == 17 ? "udp" : "other");
		/* both directions helpers: write original 5-tuple */
		fprintf(fp, "%s %s %s %u %u %s\n",
			pname, sa, da, (unsigned)e->key.sport, (unsigned)e->key.dport,
			oo_bucket_name(e->bucket));
	}
	fclose(fp);
	rename(tmp, path);
}

static void write_meta(int running)
{
	char tmp[140];
	FILE *fp;
	snprintf(tmp, sizeof(tmp), "%s.tmp", META_FILE);
	fp = fopen(tmp, "w");
	if (!fp)
		return;
	fprintf(fp,
		"{\"engine\":\"payload-dpi\",\"ndpi_version\":\"\","
		"\"running\":%s,\"flows_seen\":%u,\"flows_classified\":%u,"
		"\"queue_pkts\":%u,\"queue_drops\":%u,\"mode\":\"%s\","
		"\"queue_num\":%d,\"last_error\":\"\"}\n",
		running ? "true" : "false",
		g_flows_seen, g_flows_classified,
		g_queue_pkts, g_queue_drops, g_mode, g_queue_num);
	fclose(fp);
	rename(tmp, META_FILE);
}

static int parse_ipv4(const uint8_t *data, size_t len,
		      struct flow_key *k, const uint8_t **l4, size_t *l4len)
{
	const struct iphdr *ip;
	size_t ihl;
	if (len < sizeof(struct iphdr))
		return -1;
	ip = (const struct iphdr *)data;
	if (ip->version != 4)
		return -1;
	ihl = (size_t)ip->ihl * 4;
	if (ihl < sizeof(struct iphdr) || len < ihl)
		return -1;
	k->family = 4;
	k->proto = ip->protocol;
	memcpy(k->saddr, &ip->saddr, 4);
	memcpy(k->daddr, &ip->daddr, 4);
	*l4 = data + ihl;
	*l4len = len - ihl;
	return 0;
}

static int parse_ipv6(const uint8_t *data, size_t len,
		      struct flow_key *k, const uint8_t **l4, size_t *l4len)
{
	const struct ip6_hdr *ip6;
	uint8_t nexth;
	size_t off;
	if (len < sizeof(struct ip6_hdr))
		return -1;
	ip6 = (const struct ip6_hdr *)data;
	if (((data[0] >> 4) & 0xF) != 6)
		return -1;
	k->family = 6;
	memcpy(k->saddr, &ip6->ip6_src, 16);
	memcpy(k->daddr, &ip6->ip6_dst, 16);
	nexth = ip6->ip6_nxt;
	off = sizeof(struct ip6_hdr);
	/* skip a few extension headers */
	while (off + 2 < len &&
	       (nexth == 0 || nexth == 43 || nexth == 60 || nexth == 51 || nexth == 50)) {
		if (nexth == 44) /* fragment */
			break;
		nexth = data[off];
		off += (size_t)data[off + 1] * 8 + 8;
	}
	k->proto = nexth;
	if (off > len)
		return -1;
	*l4 = data + off;
	*l4len = len - off;
	return 0;
}

static int parse_l4(struct flow_key *k, const uint8_t *l4, size_t l4len,
		    const uint8_t **payload, size_t *plen)
{
	k->sport = k->dport = 0;
	*payload = NULL;
	*plen = 0;
	if (k->proto == IPPROTO_TCP) {
		const struct tcphdr *th;
		size_t doff;
		if (l4len < sizeof(struct tcphdr))
			return -1;
		th = (const struct tcphdr *)l4;
		doff = (size_t)th->doff * 4;
		if (doff < sizeof(struct tcphdr) || l4len < doff)
			return -1;
		k->sport = ntohs(th->source);
		k->dport = ntohs(th->dest);
		*payload = l4 + doff;
		*plen = l4len - doff;
		return 0;
	}
	if (k->proto == IPPROTO_UDP) {
		const struct udphdr *uh;
		if (l4len < sizeof(struct udphdr))
			return -1;
		uh = (const struct udphdr *)l4;
		k->sport = ntohs(uh->source);
		k->dport = ntohs(uh->dest);
		*payload = l4 + sizeof(struct udphdr);
		*plen = l4len - sizeof(struct udphdr);
		return 0;
	}
	return -1;
}

static uint32_t bucket_to_mark(uint8_t id)
{
	if (id == OO_B_UNKNOWN)
		return 0;
	return ((uint32_t)id << MARK_SHIFT) & MARK_MASK;
}

static int cb(struct nfq_q_handle *qh, struct nfgenmsg *nfmsg,
	      struct nfq_data *nfa, void *data)
{
	int id = 0;
	struct nfqnl_msg_packet_hdr *ph;
	unsigned char *pkt = NULL;
	int pkt_len;
	struct flow_key key;
	const uint8_t *l4 = NULL, *payload = NULL;
	size_t l4len = 0, plen = 0;
	struct flow_entry *fe;
	uint8_t bucket = OO_B_UNKNOWN;
	uint32_t mark = 0;
	char host[OO_HOST_MAX];
	int verdict = NF_ACCEPT;
	static time_t last_flush;
	time_t now;

	(void)nfmsg;
	(void)data;

	ph = nfq_get_msg_packet_hdr(nfa);
	if (ph)
		id = ntohl(ph->packet_id);

	g_queue_pkts++;
	pkt_len = nfq_get_payload(nfa, &pkt);
	if (pkt_len < 0 || !pkt) {
		g_queue_drops++;
		return nfq_set_verdict(qh, id, NF_ACCEPT, 0, NULL);
	}

	memset(&key, 0, sizeof(key));
	if (pkt_len >= 1 && (pkt[0] >> 4) == 4) {
		if (parse_ipv4(pkt, (size_t)pkt_len, &key, &l4, &l4len) < 0)
			goto accept;
	} else if (pkt_len >= 1 && (pkt[0] >> 4) == 6) {
		if (parse_ipv6(pkt, (size_t)pkt_len, &key, &l4, &l4len) < 0)
			goto accept;
	} else {
		goto accept;
	}

	if (parse_l4(&key, l4, l4len, &payload, &plen) < 0)
		goto accept;

	fe = flow_get(&key, 1);
	if (!fe)
		goto accept;

	fe->pkts++;
	if (fe->done) {
		bucket = fe->bucket;
		mark = bucket_to_mark(bucket);
		goto accept;
	}

	bucket = oo_classify_payload(&g_cls, key.proto, key.sport, key.dport,
				     payload, plen, host, sizeof(host));
	if (bucket != OO_B_UNKNOWN) {
		fe->bucket = bucket;
		fe->done = 1;
		fe->ts = time(NULL);
		g_flows_classified++;
		mark = bucket_to_mark(bucket);
	} else if (fe->pkts >= 12) {
		/* give up — leave unknown, stop wasting CPU (mark stays 0 → still queued;
		 * nft still queues first 12 only for established) */
		fe->done = 1;
		fe->bucket = OO_B_UNKNOWN;
	}

accept:
	now = time(NULL);
	if (now != last_flush) {
		flush_flow_file();
		write_meta(1);
		last_flush = now;
	}

	if (mark)
		return nfq_set_verdict2(qh, id, verdict, mark, 0, NULL);
	return nfq_set_verdict(qh, id, verdict, 0, NULL);
}

static int load_conf(void)
{
	if (access(BUCKET_CONF_USR, R_OK) == 0)
		return oo_classifier_load(&g_cls, BUCKET_CONF_USR);
	return oo_classifier_load(&g_cls, BUCKET_CONF_SYS);
}

int main(int argc, char **argv)
{
	struct nfq_handle *h = NULL;
	struct nfq_q_handle *qh = NULL;
	int fd, rv;
	char buf[65536] __attribute__((aligned));
	const char *mode_env;

	(void)argc;
	(void)argv;

	signal(SIGINT, on_sig);
	signal(SIGTERM, on_sig);

	mkdir(STATS_DIR, 0755);

	mode_env = getenv("OPENONT_DPI_MODE");
	if (mode_env && *mode_env) {
		strncpy(g_mode, mode_env, sizeof(g_mode) - 1);
		g_mode[sizeof(g_mode) - 1] = '\0';
	}
	if (getenv("OPENONT_DPI_QUEUE"))
		g_queue_num = atoi(getenv("OPENONT_DPI_QUEUE"));

	if (!strcmp(g_mode, "off")) {
		write_meta(0);
		return 0;
	}

	if (load_conf() < 0) {
		/* continue with empty map — built-in tags still work via empty map_token */
		fprintf(stderr, "openont-dpi: warning: no bucket conf, using built-ins only\n");
		memset(&g_cls, 0, sizeof(g_cls));
	}

	/* install nft rules */
	if (system("/usr/lib/openont/dpi-nft.sh start") != 0)
		fprintf(stderr, "openont-dpi: warning: nft install failed\n");

	h = nfq_open();
	if (!h) {
		fprintf(stderr, "openont-dpi: nfq_open failed: %s\n", strerror(errno));
		write_meta(0);
		return 1;
	}
	if (nfq_unbind_pf(h, AF_INET) < 0) { /* ignore */ }
	if (nfq_bind_pf(h, AF_INET) < 0) {
		fprintf(stderr, "openont-dpi: bind IPv4 failed\n");
	}
	if (nfq_unbind_pf(h, AF_INET6) < 0) { /* ignore */ }
	nfq_bind_pf(h, AF_INET6);

	qh = nfq_create_queue(h, (uint16_t)g_queue_num, &cb, NULL);
	if (!qh) {
		fprintf(stderr, "openont-dpi: create_queue %d failed\n", g_queue_num);
		nfq_close(h);
		write_meta(0);
		return 1;
	}
	if (nfq_set_mode(qh, NFQNL_COPY_PACKET, 0xffff) < 0) {
		fprintf(stderr, "openont-dpi: set_mode failed\n");
	}

	write_meta(1);
	fd = nfq_fd(h);
	while (g_run) {
		rv = recv(fd, buf, sizeof(buf), 0);
		if (rv >= 0) {
			nfq_handle_packet(h, buf, rv);
			continue;
		}
		if (errno == ENOBUFS) {
			g_queue_drops++;
			continue;
		}
		if (errno == EINTR)
			continue;
		break;
	}

	flush_flow_file();
	write_meta(0);
	nfq_destroy_queue(qh);
	nfq_close(h);
	system("/usr/lib/openont/dpi-nft.sh stop");
	oo_classifier_free(&g_cls);
	return 0;
}

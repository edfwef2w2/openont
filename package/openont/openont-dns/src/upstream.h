/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef OPENONT_UPSTREAM_H
#define OPENONT_UPSTREAM_H

#include "dns_proto.h"

#define UP_FIRST 0
#define UP_FASTEST_RESP 1
#define UP_FASTEST_IP 2

#define UP_SPEED_OFF 0
#define UP_SPEED_ICMP 1
#define UP_SPEED_TCP 2

struct upstream_srv {
	char group[64];
	char proto[8];
	char host[256];
	int port;
	char tls_host[256];
	char path[128];
};

struct upstream_result {
	int rlen;
	int rtt_ms;
	int finish_seq;
	uint8_t pkt[DNS_MAX_PACKET];
};

int upstream_exchange(const struct upstream_srv *u, const uint8_t *q, int qlen,
		      uint8_t *resp, int respmax, int timeout_ms, int *rtt_ms);

int upstream_race(const struct upstream_srv *list, int n, const uint8_t *q, int qlen,
		  int mode, int timeout_ms, struct upstream_result *results, int max_results);

int upstream_resolve_a(const char *bootstrap_ip, int port, const char *name,
		       char *out_ip, int outlen);

int upstream_pick_ip(char ips[][64], int nips, int speed, int timeout_ms, char *best, int bestlen);

#endif

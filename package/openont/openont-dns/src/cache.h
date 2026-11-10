/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef OPENONT_DNS_CACHE_H
#define OPENONT_DNS_CACHE_H

#include <stdint.h>

#define CACHE_MISS 0
#define CACHE_FRESH 1
#define CACHE_STALE 2

struct cache;

struct cache *cache_create(int slots, int min_ttl, int max_ttl, int serve_expired);
void cache_free(struct cache *c);

int cache_store(struct cache *c, const char *name, uint16_t qtype, int rcode,
		const uint8_t *pkt, int pktlen, uint32_t ttl, uint32_t now);

int cache_lookup(struct cache *c, const char *name, uint16_t qtype, uint32_t now,
		 int *rcode, uint8_t *pkt, int pktmax, int *pktlen, int *want_refresh);

#endif

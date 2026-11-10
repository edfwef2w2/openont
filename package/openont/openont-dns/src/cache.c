/* SPDX-License-Identifier: GPL-2.0-only */
#include "cache.h"
#include "dns_proto.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CACHE_PKT 1200
#define CACHE_STALE_SEC 3600

struct cache_slot {
	int used;
	uint32_t hash;
	char name[DNS_MAX_NAME + 1];
	uint16_t qtype;
	int rcode;
	uint32_t expire;
	uint32_t stale_until;
	uint32_t ttl;
	uint8_t pkt[CACHE_PKT];
	int pktlen;
};

struct cache {
	struct cache_slot *slots;
	int nslots;
	int min_ttl;
	int max_ttl;
	int serve_expired;
};

static uint32_t cache_hash(const char *name, uint16_t qtype)
{
	uint32_t h = 5381;
	const unsigned char *p = (const unsigned char *)name;
	while (*p) {
		h = ((h << 5) + h) + *p;
		p++;
	}
	h = ((h << 5) + h) + (uint32_t)qtype;
	return h;
}

struct cache *cache_create(int slots, int min_ttl, int max_ttl, int serve_expired)
{
	struct cache *c;

	if (slots < 16)
		slots = 16;
	c = calloc(1, sizeof(*c));
	if (!c)
		return NULL;
	c->slots = calloc((size_t)slots, sizeof(*c->slots));
	if (!c->slots) {
		free(c);
		return NULL;
	}
	c->nslots = slots;
	c->min_ttl = min_ttl < 0 ? 0 : min_ttl;
	c->max_ttl = max_ttl;
	c->serve_expired = serve_expired ? 1 : 0;
	return c;
}

void cache_free(struct cache *c)
{
	if (!c)
		return;
	free(c->slots);
	free(c);
}

static uint32_t clamp_ttl(const struct cache *c, uint32_t ttl)
{
	if ((int)ttl < c->min_ttl)
		ttl = (uint32_t)c->min_ttl;
	if (c->max_ttl > 0 && (int)ttl > c->max_ttl)
		ttl = (uint32_t)c->max_ttl;
	if (ttl == 0)
		ttl = 1;
	return ttl;
}

int cache_store(struct cache *c, const char *name, uint16_t qtype, int rcode,
		const uint8_t *pkt, int pktlen, uint32_t ttl, uint32_t now)
{
	char norm[DNS_MAX_NAME + 1];
	uint32_t h;
	int start;
	int i;
	int victim = -1;
	uint32_t oldest = 0xffffffffu;

	if (!c || !name || !pkt || pktlen <= 0 || pktlen > CACHE_PKT)
		return -1;
	snprintf(norm, sizeof(norm), "%s", name);
	dns_normalize(norm);
	ttl = clamp_ttl(c, ttl);
	h = cache_hash(norm, qtype);
	start = (int)(h % (uint32_t)c->nslots);
	for (i = 0; i < c->nslots; i++) {
		int idx = (start + i) % c->nslots;
		struct cache_slot *s = &c->slots[idx];
		if (s->used && s->hash == h && s->qtype == qtype && strcmp(s->name, norm) == 0) {
			victim = idx;
			break;
		}
		if (!s->used) {
			victim = idx;
			break;
		}
		if (s->expire < oldest) {
			oldest = s->expire;
			victim = idx;
		}
	}
	if (victim < 0)
		return -1;
	{
		struct cache_slot *s = &c->slots[victim];
		memset(s, 0, sizeof(*s));
		s->used = 1;
		s->hash = h;
		snprintf(s->name, sizeof(s->name), "%s", norm);
		s->qtype = qtype;
		s->rcode = rcode;
		s->ttl = ttl;
		s->expire = now + ttl;
		s->stale_until = s->expire + CACHE_STALE_SEC;
		s->pktlen = pktlen;
		memcpy(s->pkt, pkt, (size_t)pktlen);
	}
	return 0;
}

int cache_lookup(struct cache *c, const char *name, uint16_t qtype, uint32_t now,
		 int *rcode, uint8_t *pkt, int pktmax, int *pktlen, int *want_refresh)
{
	char norm[DNS_MAX_NAME + 1];
	uint32_t h;
	int start;
	int i;

	if (want_refresh)
		*want_refresh = 0;
	if (!c || !name || !pkt || pktmax <= 0)
		return CACHE_MISS;
	snprintf(norm, sizeof(norm), "%s", name);
	dns_normalize(norm);
	h = cache_hash(norm, qtype);
	start = (int)(h % (uint32_t)c->nslots);
	for (i = 0; i < c->nslots; i++) {
		int idx = (start + i) % c->nslots;
		struct cache_slot *s = &c->slots[idx];
		uint32_t left;
		int state;

		if (!s->used)
			return CACHE_MISS;
		if (s->hash != h || s->qtype != qtype || strcmp(s->name, norm) != 0)
			continue;
		if (s->pktlen > pktmax)
			return CACHE_MISS;
		if (now < s->expire) {
			state = CACHE_FRESH;
			left = s->expire - now;
			if (want_refresh && s->ttl > 0 && left * 10 < s->ttl)
				*want_refresh = 1;
		} else if (c->serve_expired && now < s->stale_until) {
			state = CACHE_STALE;
			if (want_refresh)
				*want_refresh = 1;
		} else {
			return CACHE_MISS;
		}
		if (rcode)
			*rcode = s->rcode;
		memcpy(pkt, s->pkt, (size_t)s->pktlen);
		if (pktlen)
			*pktlen = s->pktlen;
		return state;
	}
	return CACHE_MISS;
}

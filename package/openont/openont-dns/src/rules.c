/* SPDX-License-Identifier: GPL-2.0-only */
#define _POSIX_C_SOURCE 200809L
#include "rules.h"
#include "dns_proto.h"

#include <ctype.h>
#include <regex.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define RULES_BUCKETS 4096

struct rule_item {
	struct rule_item *next;
	int kind;
	int exact;
	char *client;
	uint16_t rrtype;
	char *value;
	char *extra;
};

struct bucket {
	char *name;
	struct rule_item *items;
	struct bucket *next;
};

struct regex_item {
	int allow;
	char *client;
	regex_t re;
};

struct ruleset {
	struct bucket *buckets[RULES_BUCKETS];
	struct regex_item regexes[RULES_MAX_REGEX];
	int nregex;
	char *skips[64];
	int nskips;
	int nitems;
};

#define RULES_MAX_ITEMS 200000

static uint32_t hash_name(const char *s)
{
	uint32_t h = 5381;
	while (*s) {
		h = ((h << 5) + h) + (unsigned char)*s;
		s++;
	}
	return h;
}

struct ruleset *rules_create(void)
{
	return calloc(1, sizeof(struct ruleset));
}

static void free_items(struct rule_item *it)
{
	while (it) {
		struct rule_item *n = it->next;
		free(it->client);
		free(it->value);
		free(it->extra);
		free(it);
		it = n;
	}
}

void rules_free(struct ruleset *rs)
{
	int i;

	if (!rs)
		return;
	for (i = 0; i < RULES_BUCKETS; i++) {
		struct bucket *b = rs->buckets[i];
		while (b) {
			struct bucket *n = b->next;
			free_items(b->items);
			free(b->name);
			free(b);
			b = n;
		}
	}
	for (i = 0; i < rs->nregex; i++) {
		regfree(&rs->regexes[i].re);
		free(rs->regexes[i].client);
	}
	for (i = 0; i < rs->nskips; i++)
		free(rs->skips[i]);
	free(rs);
}

static struct bucket *find_bucket(struct ruleset *rs, const char *name, int create)
{
	uint32_t h = hash_name(name) % RULES_BUCKETS;
	struct bucket *b = rs->buckets[h];

	while (b) {
		if (strcmp(b->name, name) == 0)
			return b;
		b = b->next;
	}
	if (!create)
		return NULL;
	b = calloc(1, sizeof(*b));
	if (!b)
		return NULL;
	b->name = strdup(name);
	if (!b->name) {
		free(b);
		return NULL;
	}
	b->next = rs->buckets[h];
	rs->buckets[h] = b;
	return b;
}

static const struct bucket *find_bucket_c(const struct ruleset *rs, const char *name)
{
	uint32_t h = hash_name(name) % RULES_BUCKETS;
	const struct bucket *b = rs->buckets[h];

	while (b) {
		if (strcmp(b->name, name) == 0)
			return b;
		b = b->next;
	}
	return NULL;
}

static int add_item(struct ruleset *rs, const char *name, int kind, int exact,
		    const char *client, uint16_t rrtype, const char *value, const char *extra)
{
	struct bucket *b;
	struct rule_item *it;
	char norm[DNS_MAX_NAME + 1];

	if (!rs || !name || !name[0])
		return -1;
	if (rs->nitems >= RULES_MAX_ITEMS)
		return -1;
	snprintf(norm, sizeof(norm), "%s", name);
	dns_normalize(norm);
	if (!norm[0])
		return -1;
	b = find_bucket(rs, norm, 1);
	if (!b)
		return -1;
	it = calloc(1, sizeof(*it));
	if (!it)
		return -1;
	it->kind = kind;
	it->exact = exact;
	it->rrtype = rrtype;
	if (client && client[0] && strcmp(client, "-") != 0)
		it->client = strdup(client);
	if (value)
		it->value = strdup(value);
	if (extra && extra[0])
		it->extra = strdup(extra);
	it->next = b->items;
	b->items = it;
	rs->nitems++;
	return 0;
}

static char *trim(char *s)
{
	char *e;
	while (*s && isspace((unsigned char)*s))
		s++;
	if (!*s)
		return s;
	e = s + strlen(s);
	while (e > s && isspace((unsigned char)e[-1]))
		*--e = '\0';
	return s;
}

static void strip_modifiers(char *s)
{
	char *dollar = strchr(s, '$');
	if (dollar)
		*dollar = '\0';
}

static int add_regex(struct ruleset *rs, int allow, const char *client, const char *pat)
{
	struct regex_item *it;

	if (rs->nregex >= RULES_MAX_REGEX)
		return -1;
	it = &rs->regexes[rs->nregex];
	if (regcomp(&it->re, pat, REG_EXTENDED | REG_ICASE | REG_NOSUB) != 0)
		return -1;
	it->allow = allow;
	it->client = (client && client[0] && strcmp(client, "-") != 0) ? strdup(client) : NULL;
	rs->nregex++;
	return 0;
}

static int add_adguard(struct ruleset *rs, const char *client, char *text)
{
	int allow = 0;
	char *s;

	s = trim(text);
	if (!*s || *s == '#' || *s == '!')
		return 0;
	strip_modifiers(s);
	s = trim(s);
	if (!strncmp(s, "@@", 2)) {
		allow = 1;
		s += 2;
	}
	if (s[0] == '/' ) {
		char *end = strrchr(s + 1, '/');
		if (!end || end == s + 1)
			return 0;
		*end = '\0';
		return add_regex(rs, allow, client, s + 1);
	}
	if (!strncmp(s, "||", 2)) {
		char *dom = s + 2;
		char *hat = strchr(dom, '^');
		if (hat)
			*hat = '\0';
		if (!dom[0])
			return 0;
		return add_item(rs, dom, allow ? RULE_ALLOW : RULE_BLOCK, 0, client, 0, NULL, NULL);
	}
	if (s[0] == '|' && s[1] != '|') {
		char *dom = s + 1;
		char *hat = strchr(dom, '^');
		if (hat)
			*hat = '\0';
		return add_item(rs, dom, allow ? RULE_ALLOW : RULE_BLOCK, 1, client, 0, NULL, NULL);
	}
	if (!allow && (strncmp(s, "0.0.0.0 ", 8) == 0 || strncmp(s, "127.0.0.1 ", 10) == 0)) {
		char *host = strchr(s, ' ');
		if (!host)
			return 0;
		host = trim(host);
		if (*host == '#')
			return 0;
		return add_item(rs, host, RULE_BLOCK, 1, client, 0, NULL, NULL);
	}
	if (strchr(s, ' ') || strchr(s, '/'))
		return 0;
	if (!strchr(s, '.') && strcmp(s, "localhost") != 0)
		return 0;
	return add_item(rs, s, allow ? RULE_ALLOW : RULE_BLOCK, 0, client, 0, NULL, NULL);
}

static int parse_type(const char *s)
{
	if (!strcmp(s, "A") || !strcmp(s, "a"))
		return DNS_T_A;
	if (!strcmp(s, "AAAA") || !strcmp(s, "aaaa"))
		return DNS_T_AAAA;
	if (!strcmp(s, "CNAME") || !strcmp(s, "cname"))
		return DNS_T_CNAME;
	return 0;
}

int rules_load_line(struct ruleset *rs, const char *line)
{
	char buf[1024];
	char *s;
	char *tok[8];
	int ntok = 0;
	char *save = NULL;

	if (!rs || !line)
		return -1;
	snprintf(buf, sizeof(buf), "%s", line);
	s = trim(buf);
	if (!*s || *s == '#')
		return 0;

	if (!strncmp(s, "adg ", 4)) {
		char *client = s + 4;
		char *sp = strchr(client, ' ');
		if (!sp)
			return 0;
		*sp = '\0';
		return add_adguard(rs, client, sp + 1);
	}
	if (!strncmp(s, "skip ", 5)) {
		char *ip = trim(s + 5);
		if (!ip[0] || rs->nskips >= 64)
			return -1;
		rs->skips[rs->nskips++] = strdup(ip);
		return 0;
	}

	for (s = strtok_r(s, " \t", &save); s && ntok < 8; s = strtok_r(NULL, " \t", &save))
		tok[ntok++] = s;
	if (ntok < 3)
		return 0;

	if (!strcmp(tok[0], "block") || !strcmp(tok[0], "allow")) {
		int allow = strcmp(tok[0], "allow") == 0;
		int exact = strcmp(tok[1], "exact") == 0;
		const char *client = NULL;
		if (!strcmp(tok[1], "regex")) {
			/* pattern may have been split; rejoin from original is lost.
			 * Regex patterns are loaded via adg lines. */
			return add_regex(rs, allow, NULL, tok[2]);
		}
		if (!strcmp(tok[1], "suffix"))
			exact = 0;
		else if (!strcmp(tok[1], "exact"))
			exact = 1;
		else
			return 0;
		if (ntok >= 5 && !strcmp(tok[3], "client"))
			client = tok[4];
		return add_item(rs, tok[2], allow ? RULE_ALLOW : RULE_BLOCK, exact, client, 0, NULL, NULL);
	}
	if (!strcmp(tok[0], "rewrite") && ntok >= 5) {
		int exact = strcmp(tok[1], "exact") == 0;
		int typ = parse_type(tok[3]);
		if (!typ)
			return -1;
		return add_item(rs, tok[2], RULE_REWRITE, exact, NULL, (uint16_t)typ, tok[4], NULL);
	}
	if (!strcmp(tok[0], "accel") && ntok >= 3) {
		int exact = strcmp(tok[1], "exact") == 0;
		return add_item(rs, tok[2], RULE_ACCEL, exact, NULL, 0, NULL, NULL);
	}
	if (!strcmp(tok[0], "domain") && ntok >= 4) {
		int exact = strcmp(tok[1], "exact") == 0;
		const char *nft = NULL;
		if (ntok >= 6 && !strcmp(tok[4], "nftset"))
			nft = tok[5];
		return add_item(rs, tok[2], RULE_DOMAIN, exact, NULL, 0, tok[3], nft);
	}
	return 0;
}

int rules_client_skips(const struct ruleset *rs, const char *client_ip)
{
	int i;

	if (!rs || !client_ip)
		return 0;
	for (i = 0; i < rs->nskips; i++) {
		if (strcmp(rs->skips[i], client_ip) == 0)
			return 1;
	}
	return 0;
}

static int client_ok(const char *rule_client, const char *ip)
{
	if (!rule_client || !rule_client[0])
		return 1;
	return ip && strcmp(rule_client, ip) == 0;
}

static int spec_of(int labels, int exact)
{
	return labels * 2 + (exact ? 1 : 0);
}

static int label_count(const char *name)
{
	int n = 1;
	const char *p = name;
	if (!*p)
		return 0;
	while (*p) {
		if (*p == '.')
			n++;
		p++;
	}
	return n;
}

int rules_match(const struct ruleset *rs, const char *qname, const char *client_ip,
		struct rules_hit *hit)
{
	char name[DNS_MAX_NAME + 1];
	char cur[DNS_MAX_NAME + 1];
	int best_block = -1;
	int best_allow = -1;
	int best_rw = -1;
	int best_accel = -1;
	int best_dom = -1;
	int labels;
	int i;

	if (!hit)
		return -1;
	memset(hit, 0, sizeof(*hit));
	if (!rs || !qname)
		return 0;
	snprintf(name, sizeof(name), "%s", qname);
	dns_normalize(name);
	labels = label_count(name);
	snprintf(cur, sizeof(cur), "%s", name);

	while (cur[0]) {
		const struct bucket *b = find_bucket_c(rs, cur);
		int full = strcmp(cur, name) == 0;
		if (b) {
			const struct rule_item *it;
			for (it = b->items; it; it = it->next) {
				int spec;
				if (it->exact && !full)
					continue;
				if (!client_ok(it->client, client_ip))
					continue;
				spec = spec_of(label_count(cur), it->exact);
				if (it->kind == RULE_BLOCK && spec > best_block)
					best_block = spec;
				else if (it->kind == RULE_ALLOW && spec > best_allow)
					best_allow = spec;
				else if (it->kind == RULE_REWRITE && spec > best_rw) {
					best_rw = spec;
					hit->rewrite = 1;
					hit->rewrite_type = it->rrtype;
					snprintf(hit->rewrite_value, sizeof(hit->rewrite_value), "%s",
						 it->value ? it->value : "");
				} else if (it->kind == RULE_ACCEL && spec > best_accel) {
					best_accel = spec;
					hit->accel = 1;
				} else if (it->kind == RULE_DOMAIN && spec > best_dom) {
					best_dom = spec;
					snprintf(hit->group, sizeof(hit->group), "%s", it->value ? it->value : "");
					snprintf(hit->nftset, sizeof(hit->nftset), "%s", it->extra ? it->extra : "");
				}
			}
		}
		{
			char *dot = strchr(cur, '.');
			if (!dot)
				break;
			memmove(cur, dot + 1, strlen(dot + 1) + 1);
		}
		labels--;
		(void)labels;
	}

	if (best_rw >= 0 && best_accel >= 0 && best_rw >= best_accel)
		hit->accel = 0;
	if (best_accel > best_rw)
		hit->rewrite = 0;

	for (i = 0; i < rs->nregex; i++) {
		const struct regex_item *rx = &rs->regexes[i];
		if (!client_ok(rx->client, client_ip))
			continue;
		if (regexec(&rx->re, name, 0, NULL, 0) != 0)
			continue;
		if (rx->allow)
			best_allow = 1000000;
		else if (best_allow < 0)
			best_block = 1000000;
	}

	if (best_allow >= 0 && best_allow >= best_block)
		hit->block = 0;
	else if (best_block >= 0)
		hit->block = 1;
	return 0;
}

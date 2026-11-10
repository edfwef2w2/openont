/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef OPENONT_DNS_RULES_H
#define OPENONT_DNS_RULES_H

#include <stdint.h>

#define RULES_MAX_REGEX 64

enum {
	RULE_BLOCK = 1,
	RULE_ALLOW = 2,
	RULE_REWRITE = 3,
	RULE_ACCEL = 4,
	RULE_DOMAIN = 5
};

struct rules_hit {
	int block;
	int rewrite;
	uint16_t rewrite_type;
	char rewrite_value[256];
	int accel;
	char group[64];
	char nftset[160];
};

struct ruleset;

struct ruleset *rules_create(void);
void rules_free(struct ruleset *rs);
int rules_load_line(struct ruleset *rs, const char *line);
int rules_match(const struct ruleset *rs, const char *qname, const char *client_ip,
		struct rules_hit *hit);
int rules_client_skips(const struct ruleset *rs, const char *client_ip);

#endif

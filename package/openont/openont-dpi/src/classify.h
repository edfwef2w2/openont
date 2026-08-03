/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef OPENONT_CLASSIFY_H
#define OPENONT_CLASSIFY_H

#include <stddef.h>
#include <stdint.h>

#include "buckets.gen.h"

#define OO_BUCKET_MAX 16
#define OO_TOKEN_MAX  96
#define OO_HOST_MAX   256
#define OO_CLASS_MAX  32

struct oo_map_entry {
	char token[OO_TOKEN_MAX];
	char bucket[OO_CLASS_MAX];
	uint8_t id;
	uint8_t tlen;
};

struct oo_classifier {
	struct oo_map_entry *entries;
	size_t n_entries;
	size_t cap;
};

int oo_classifier_load(struct oo_classifier *c, const char *path);
void oo_classifier_free(struct oo_classifier *c);

/*
 * Inspect L4 payload. Fills host_out (SNI/Host) when found.
 * Returns bucket id (never fails; unknown = 0).
 */
uint8_t oo_classify_payload(struct oo_classifier *c,
			    uint8_t l4proto,
			    uint16_t sport, uint16_t dport,
			    const uint8_t *payload, size_t len,
			    char *host_out, size_t host_sz);

#endif

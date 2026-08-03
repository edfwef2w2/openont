/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef OPENONT_CLASSIFY_H
#define OPENONT_CLASSIFY_H

#include <stddef.h>
#include <stdint.h>

#define OO_BUCKET_MAX 16
#define OO_TOKEN_MAX  96
#define OO_HOST_MAX   256
#define OO_CLASS_MAX  32

/* Display buckets — order must match statsd / UI APP_KEYS */
enum oo_bucket_id {
	OO_B_HTTP = 1,
	OO_B_VIDEO = 2,
	OO_B_GAME = 3,
	OO_B_DOWNLOAD = 4,
	OO_B_FILE = 5,
	OO_B_IM = 6,
	OO_B_COMMON = 7,
	OO_B_OTHER = 8,
	OO_B_SPEEDTEST = 9,
	OO_B_UNKNOWN = 0
};

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

/* Map bucket name → id (0 = unknown) */
uint8_t oo_bucket_id(const char *name);
const char *oo_bucket_name(uint8_t id);

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

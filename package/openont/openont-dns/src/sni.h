/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef OPENONT_SNI_H
#define OPENONT_SNI_H

struct client_hello_info {
	char sni[256];
	char alpn[8][32];
	int nalpn;
};

/* 1 parsed, 0 need more bytes, -1 not a ClientHello. */
int sni_parse_client_hello(const uint8_t *buf, int len, struct client_hello_info *out);

int sni_name_matches(const char *host, const char *rule);

#endif

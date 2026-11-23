/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef OPENONT_TLS_HELLO_H
#define OPENONT_TLS_HELLO_H

#include <stdint.h>

/* 1 when the payload starts a TLS handshake record carrying a ClientHello. */
int tls_is_client_hello(const uint8_t *p, int len);

/*
 * Find the server_name host bytes inside a ClientHello that may be cut short
 * (a large hello spans several TCP segments). 0 and *off/*n set when the whole
 * host name lies inside the buffer, -1 otherwise.
 */
int tls_find_sni(const uint8_t *p, int len, int *off, int *n);

/*
 * Build a decoy ClientHello for decoy name into out.
 * With the real first segment given and its SNI inside that segment, the decoy
 * is a copy of it with the same length: the host name is overwritten with a
 * name built from decoy, and random and session id are refreshed.
 * Otherwise a small stand-alone ClientHello for decoy is written.
 * Returns the length, or -1.
 */
int tls_build_fake(const uint8_t *real, int rlen, const char *decoy,
		   uint8_t *out, int outmax);

/* Stand-alone ClientHello for sni. Returns the length, or -1. */
int tls_synth_hello(const char *sni, uint8_t *out, int outmax);

#endif

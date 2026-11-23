/* SPDX-License-Identifier: GPL-2.0-only */
#include "tls_hello.h"

#include <stdlib.h>
#include <string.h>

static int rd16(const uint8_t *p)
{
	return (p[0] << 8) | p[1];
}

static void wr16(uint8_t *p, int v)
{
	p[0] = (uint8_t)(v >> 8);
	p[1] = (uint8_t)v;
}

static void rand_bytes(uint8_t *p, int n)
{
	int i;
	for (i = 0; i < n; i++)
		p[i] = (uint8_t)(random() & 0xff);
}

static char rand_letter(void)
{
	return (char)('a' + random() % 26);
}

int tls_is_client_hello(const uint8_t *p, int len)
{
	/* record: 16 03 0x len16 | handshake: 01 len24 | body: 03 0x */
	if (!p || len < 11)
		return 0;
	if (p[0] != 0x16 || p[1] != 0x03 || p[2] > 0x04)
		return 0;
	if (p[5] != 0x01 || p[9] != 0x03)
		return 0;
	return rd16(p + 3) >= 4;
}

int tls_find_sni(const uint8_t *p, int len, int *off, int *n)
{
	int pos;
	int ext_end;
	int rec_end;

	if (!tls_is_client_hello(p, len))
		return -1;
	rec_end = 5 + rd16(p + 3);
	if (rec_end < len)
		len = rec_end;
	pos = 9 + 2 + 32;		/* version + random */
	if (pos + 1 > len)
		return -1;
	pos += 1 + p[pos];		/* session id */
	if (pos + 2 > len)
		return -1;
	pos += 2 + rd16(p + pos);	/* cipher suites */
	if (pos + 1 > len)
		return -1;
	pos += 1 + p[pos];		/* compression */
	if (pos + 2 > len)
		return -1;
	ext_end = pos + 2 + rd16(p + pos);
	pos += 2;
	if (ext_end > len)
		ext_end = len;
	while (pos + 4 <= ext_end) {
		int type = rd16(p + pos);
		int elen = rd16(p + pos + 2);
		if (type == 0) {
			/* list len16 | name type 0 | host len16 | host */
			int h = pos + 4 + 5;
			int hlen;
			if (h > ext_end || p[pos + 6] != 0)
				return -1;
			hlen = rd16(p + h - 2);
			if (hlen < 1 || h + hlen > ext_end)
				return -1;
			*off = h;
			*n = hlen;
			return 0;
		}
		pos += 4 + elen;
	}
	return -1;
}

/* A host name of exactly n bytes that ends in decoy when it fits. */
static void fill_name(char *dst, int n, const char *decoy)
{
	int dl = decoy ? (int)strlen(decoy) : 0;
	int i;

	if (dl > 0 && dl == n) {
		memcpy(dst, decoy, (size_t)n);
		return;
	}
	if (dl > 0 && n >= dl + 2) {
		int pre = n - dl - 1;
		for (i = 0; i < pre; i++)
			dst[i] = rand_letter();
		dst[pre] = '.';
		memcpy(dst + pre + 1, decoy, (size_t)dl);
		return;
	}
	if (n >= 5) {
		for (i = 0; i < n - 4; i++)
			dst[i] = rand_letter();
		memcpy(dst + n - 4, ".com", 4);
		return;
	}
	for (i = 0; i < n; i++)
		dst[i] = rand_letter();
}

int tls_build_fake(const uint8_t *real, int rlen, const char *decoy,
		   uint8_t *out, int outmax)
{
	int off;
	int n;
	int sid;

	if (real && rlen <= outmax && tls_find_sni(real, rlen, &off, &n) == 0) {
		memcpy(out, real, (size_t)rlen);
		fill_name((char *)out + off, n, decoy);
		rand_bytes(out + 11, 32);
		sid = out[43];
		if (sid > 0 && 44 + sid <= rlen)
			rand_bytes(out + 44, sid);
		return rlen;
	}
	return tls_synth_hello(decoy && decoy[0] ? decoy : "www.example.com", out, outmax);
}

int tls_synth_hello(const char *sni, uint8_t *out, int outmax)
{
	static const uint8_t suites[] = {
		0x13, 0x01, 0x13, 0x02, 0x13, 0x03,
		0xc0, 0x2b, 0xc0, 0x2f, 0xc0, 0x2c, 0xc0, 0x30,
		0xcc, 0xa9, 0xcc, 0xa8, 0xc0, 0x13, 0xc0, 0x14,
		0x00, 0x9c, 0x00, 0x9d, 0x00, 0x2f, 0x00, 0x35
	};
	static const uint8_t groups[] = { 0x00, 0x1d, 0x00, 0x17, 0x00, 0x18 };
	static const uint8_t sigalgs[] = {
		0x04, 0x03, 0x08, 0x04, 0x04, 0x01, 0x05, 0x03,
		0x08, 0x05, 0x05, 0x01, 0x08, 0x06, 0x06, 0x01
	};
	static const uint8_t alpn[] = {
		0x02, 'h', '2', 0x08, 'h', 't', 't', 'p', '/', '1', '.', '1'
	};
	int hl = sni ? (int)strlen(sni) : 0;
	int p = 0;
	int ext_start;
	int hs_len;

	if (hl < 1 || hl > 253 || outmax < 400 + hl)
		return -1;
	out[p++] = 0x16;
	out[p++] = 0x03;
	out[p++] = 0x01;
	p += 2;				/* record length */
	out[p++] = 0x01;
	p += 3;				/* handshake length */
	out[p++] = 0x03;
	out[p++] = 0x03;
	rand_bytes(out + p, 32);
	p += 32;
	out[p++] = 32;
	rand_bytes(out + p, 32);
	p += 32;
	wr16(out + p, (int)sizeof(suites));
	p += 2;
	memcpy(out + p, suites, sizeof(suites));
	p += (int)sizeof(suites);
	out[p++] = 1;
	out[p++] = 0;
	ext_start = p;
	p += 2;

	/* server_name */
	wr16(out + p, 0x0000);
	wr16(out + p + 2, hl + 5);
	wr16(out + p + 4, hl + 3);
	out[p + 6] = 0;
	wr16(out + p + 7, hl);
	memcpy(out + p + 9, sni, (size_t)hl);
	p += 9 + hl;
	/* extended_master_secret */
	wr16(out + p, 0x0017);
	wr16(out + p + 2, 0);
	p += 4;
	/* renegotiation_info */
	wr16(out + p, 0xff01);
	wr16(out + p + 2, 1);
	out[p + 4] = 0;
	p += 5;
	/* supported_groups */
	wr16(out + p, 0x000a);
	wr16(out + p + 2, (int)sizeof(groups) + 2);
	wr16(out + p + 4, (int)sizeof(groups));
	memcpy(out + p + 6, groups, sizeof(groups));
	p += 6 + (int)sizeof(groups);
	/* ec_point_formats */
	wr16(out + p, 0x000b);
	wr16(out + p + 2, 2);
	out[p + 4] = 1;
	out[p + 5] = 0;
	p += 6;
	/* session_ticket */
	wr16(out + p, 0x0023);
	wr16(out + p + 2, 0);
	p += 4;
	/* ALPN */
	wr16(out + p, 0x0010);
	wr16(out + p + 2, (int)sizeof(alpn) + 2);
	wr16(out + p + 4, (int)sizeof(alpn));
	memcpy(out + p + 6, alpn, sizeof(alpn));
	p += 6 + (int)sizeof(alpn);
	/* signature_algorithms */
	wr16(out + p, 0x000d);
	wr16(out + p + 2, (int)sizeof(sigalgs) + 2);
	wr16(out + p + 4, (int)sizeof(sigalgs));
	memcpy(out + p + 6, sigalgs, sizeof(sigalgs));
	p += 6 + (int)sizeof(sigalgs);
	/* key_share: x25519 */
	wr16(out + p, 0x0033);
	wr16(out + p + 2, 2 + 4 + 32);
	wr16(out + p + 4, 4 + 32);
	wr16(out + p + 6, 0x001d);
	wr16(out + p + 8, 32);
	rand_bytes(out + p + 10, 32);
	p += 10 + 32;
	/* psk_key_exchange_modes */
	wr16(out + p, 0x002d);
	wr16(out + p + 2, 2);
	out[p + 4] = 1;
	out[p + 5] = 1;
	p += 6;
	/* supported_versions: 1.3, 1.2 */
	wr16(out + p, 0x002b);
	wr16(out + p + 2, 5);
	out[p + 4] = 4;
	wr16(out + p + 5, 0x0304);
	wr16(out + p + 7, 0x0303);
	p += 9;

	wr16(out + ext_start, p - ext_start - 2);
	hs_len = p - 9;
	out[6] = (uint8_t)(hs_len >> 16);
	out[7] = (uint8_t)(hs_len >> 8);
	out[8] = (uint8_t)hs_len;
	wr16(out + 3, p - 5);
	return p;
}

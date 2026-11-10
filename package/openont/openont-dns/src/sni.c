/* SPDX-License-Identifier: GPL-2.0-only */
#include "sni.h"

#include <ctype.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static int rd16(const uint8_t *p)
{
	return (p[0] << 8) | p[1];
}

static void copy_lower(char *dst, int dstlen, const uint8_t *src, int n)
{
	int i;
	if (n >= dstlen)
		n = dstlen - 1;
	if (n < 0)
		n = 0;
	for (i = 0; i < n; i++) {
		unsigned char c = src[i];
		if (c >= 'A' && c <= 'Z')
			c = (unsigned char)(c - 'A' + 'a');
		dst[i] = (char)c;
	}
	dst[n] = '\0';
}

int sni_parse_client_hello(const uint8_t *buf, int len, struct client_hello_info *out)
{
	int rec_len;
	int hs_len;
	int pos;
	int sid_len;
	int cs_len;
	int comp_len;
	int ext_len;
	int ext_end;

	if (!buf || !out)
		return -1;
	memset(out, 0, sizeof(*out));
	if (len < 5)
		return 0;
	if (buf[0] != 0x16)
		return -1;
	rec_len = rd16(buf + 3);
	if (rec_len < 4 || rec_len > 16384)
		return -1;
	if (len < 5 + rec_len)
		return 0;
	if (buf[5] != 0x01)
		return -1;
	hs_len = (buf[6] << 16) | (buf[7] << 8) | buf[8];
	if (hs_len + 4 > rec_len)
		return -1;
	pos = 9;
	if (pos + 34 > len)
		return -1;
	pos += 2 + 32;
	if (pos >= len)
		return -1;
	sid_len = buf[pos];
	pos += 1 + sid_len;
	if (pos + 2 > len)
		return -1;
	cs_len = rd16(buf + pos);
	pos += 2 + cs_len;
	if (pos + 1 > len)
		return -1;
	comp_len = buf[pos];
	pos += 1 + comp_len;
	if (pos + 2 > len)
		return 1;
	ext_len = rd16(buf + pos);
	pos += 2;
	ext_end = pos + ext_len;
	if (ext_end > len)
		return 0;
	while (pos + 4 <= ext_end) {
		int et = rd16(buf + pos);
		int el = rd16(buf + pos + 2);
		int body = pos + 4;
		if (body + el > ext_end)
			return -1;
		if (et == 0 && el >= 5) {
			int list = rd16(buf + body);
			int np = body + 2;
			int list_end = body + 2 + list;
			if (list_end > body + el)
				return -1;
			if (np < list_end && buf[np] == 0) {
				int nl = rd16(buf + np + 1);
				if (np + 3 + nl <= list_end)
					copy_lower(out->sni, sizeof(out->sni), buf + np + 3, nl);
			}
		} else if (et == 16 && el >= 2) {
			int list = rd16(buf + body);
			int np = body + 2;
			int list_end = np + list;
			if (list_end > body + el)
				list_end = body + el;
			while (np < list_end && out->nalpn < 8) {
				int nl = buf[np];
				if (np + 1 + nl > list_end)
					break;
				copy_lower(out->alpn[out->nalpn], 32, buf + np + 1, nl);
				out->nalpn++;
				np += 1 + nl;
			}
		}
		pos = body + el;
	}
	return 1;
}

int sni_name_matches(const char *host, const char *rule)
{
	size_t hl;
	size_t rl;
	char h[256];
	char r[256];
	size_t i;

	if (!host || !rule || !rule[0])
		return 0;
	snprintf(h, sizeof(h), "%s", host);
	snprintf(r, sizeof(r), "%s", rule);
	for (i = 0; h[i]; i++)
		h[i] = (char)tolower((unsigned char)h[i]);
	for (i = 0; r[i]; i++)
		r[i] = (char)tolower((unsigned char)r[i]);
	hl = strlen(h);
	rl = strlen(r);
	while (hl && h[hl - 1] == '.')
		h[--hl] = '\0';
	while (rl && r[rl - 1] == '.')
		r[--rl] = '\0';
	if (hl == rl && strcmp(h, r) == 0)
		return 1;
	if (hl > rl && h[hl - rl - 1] == '.' && strcmp(h + hl - rl, r) == 0)
		return 1;
	return 0;
}

/* SPDX-License-Identifier: GPL-2.0-only */
/* Payload DPI: TLS SNI, HTTP Host, and light L7 tags → openont buckets. */

#include "classify.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void str_lower(char *s)
{
	for (; *s; s++)
		*s = (char)tolower((unsigned char)*s);
}

static int cmp_entry_len_desc(const void *a, const void *b)
{
	const struct oo_map_entry *ea = a, *eb = b;
	if (ea->tlen != eb->tlen)
		return (int)eb->tlen - (int)ea->tlen;
	return strcmp(ea->token, eb->token);
}

int oo_classifier_load(struct oo_classifier *c, const char *path)
{
	FILE *fp;
	char line[512];

	memset(c, 0, sizeof(*c));
	fp = fopen(path, "r");
	if (!fp)
		return -1;

	c->cap = 256;
	c->entries = calloc(c->cap, sizeof(*c->entries));
	if (!c->entries) {
		fclose(fp);
		return -1;
	}

	while (fgets(line, sizeof(line), fp)) {
		char *p = line, *tok, *bucket, *hash;
		struct oo_map_entry *e;

		while (*p == ' ' || *p == '\t')
			p++;
		if (*p == '#' || *p == '\n' || *p == '\0')
			continue;
		hash = strchr(p, '#');
		if (hash)
			*hash = '\0';
		tok = p;
		bucket = strchr(p, '|');
		if (!bucket)
			continue;
		*bucket++ = '\0';
		/* trim */
		{
			char *end = tok + strlen(tok);
			while (end > tok && (end[-1] == ' ' || end[-1] == '\t' ||
					     end[-1] == '\r' || end[-1] == '\n'))
				*--end = '\0';
			end = bucket + strlen(bucket);
			while (end > bucket && (end[-1] == ' ' || end[-1] == '\t' ||
						end[-1] == '\r' || end[-1] == '\n'))
				*--end = '\0';
		}
		if (!*tok || !*bucket)
			continue;
		if (c->n_entries >= c->cap) {
			size_t ncap = c->cap * 2;
			struct oo_map_entry *ne = realloc(c->entries, ncap * sizeof(*ne));
			if (!ne)
				break;
			c->entries = ne;
			c->cap = ncap;
		}
		e = &c->entries[c->n_entries];
		memset(e, 0, sizeof(*e));
		strncpy(e->token, tok, OO_TOKEN_MAX - 1);
		strncpy(e->bucket, bucket, OO_CLASS_MAX - 1);
		str_lower(e->token);
		str_lower(e->bucket);
		e->tlen = (uint8_t)strlen(e->token);
		e->id = oo_bucket_id(e->bucket);
		if (e->id == OO_B_UNKNOWN && strcmp(e->bucket, "unknown") != 0)
			e->id = OO_B_OTHER_APP;
		c->n_entries++;
	}
	fclose(fp);
	if (c->n_entries)
		qsort(c->entries, c->n_entries, sizeof(*c->entries), cmp_entry_len_desc);
	return 0;
}

void oo_classifier_free(struct oo_classifier *c)
{
	if (!c)
		return;
	free(c->entries);
	memset(c, 0, sizeof(*c));
}

static uint8_t map_token(struct oo_classifier *c, const char *token)
{
	size_t i;
	char low[OO_HOST_MAX];
	size_t n;

	if (!c || !token || !*token)
		return OO_B_UNKNOWN;
	n = strlen(token);
	if (n >= sizeof(low))
		n = sizeof(low) - 1;
	memcpy(low, token, n);
	low[n] = '\0';
	str_lower(low);

	if (!c->entries)
		return OO_B_UNKNOWN;
	for (i = 0; i < c->n_entries; i++) {
		if (c->entries[i].tlen == 0)
			continue;
		if (strstr(low, c->entries[i].token))
			return c->entries[i].id;
	}
	return OO_B_UNKNOWN;
}

/* TLS ClientHello SNI (RFC 6066) — best-effort parser */
static int extract_tls_sni(const uint8_t *p, size_t len, char *out, size_t out_sz)
{
	size_t pos = 0;
	uint16_t cs_len, ext_len, ext_type, ext_size;
	uint8_t sid_len, comp_len;
	size_t ext_end;

	if (len < 43 || p[0] != 0x16 || p[1] != 0x03)
		return -1;
	/* record length */
	if (5 + ((size_t)p[3] << 8 | p[4]) > len)
		/* allow truncated */
		;
	if (p[5] != 0x01) /* ClientHello */
		return -1;
	pos = 9; /* skip handshake hdr + version */
	if (pos + 32 + 1 > len)
		return -1;
	pos += 32; /* random */
	sid_len = p[pos++];
	if (pos + sid_len + 2 > len)
		return -1;
	pos += sid_len;
	cs_len = (uint16_t)((p[pos] << 8) | p[pos + 1]);
	pos += 2;
	if (pos + cs_len + 1 > len)
		return -1;
	pos += cs_len;
	comp_len = p[pos++];
	if (pos + comp_len + 2 > len)
		return -1;
	pos += comp_len;
	ext_len = (uint16_t)((p[pos] << 8) | p[pos + 1]);
	pos += 2;
	ext_end = pos + ext_len;
	if (ext_end > len)
		ext_end = len;

	while (pos + 4 <= ext_end) {
		ext_type = (uint16_t)((p[pos] << 8) | p[pos + 1]);
		ext_size = (uint16_t)((p[pos + 2] << 8) | p[pos + 3]);
		pos += 4;
		if (pos + ext_size > ext_end)
			break;
		if (ext_type == 0 && ext_size >= 5) { /* server_name */
			size_t sni = pos;
			uint16_t list_len = (uint16_t)((p[sni] << 8) | p[sni + 1]);
			sni += 2;
			if (sni + list_len > pos + ext_size)
				break;
			if (sni + 3 <= pos + ext_size && p[sni] == 0) {
				uint16_t nlen = (uint16_t)((p[sni + 1] << 8) | p[sni + 2]);
				sni += 3;
				if (sni + nlen <= pos + ext_size && nlen > 0 && nlen < out_sz) {
					memcpy(out, p + sni, nlen);
					out[nlen] = '\0';
					return 0;
				}
			}
		}
		pos += ext_size;
	}
	return -1;
}

static int extract_http_host(const uint8_t *p, size_t len, char *out, size_t out_sz)
{
	size_t i;
	const char *s;
	char buf[1024];

	if (len < 8 || len > sizeof(buf) - 1)
		len = len > sizeof(buf) - 1 ? sizeof(buf) - 1 : len;
	/* only if looks like HTTP request */
	if (!(len >= 4 && (p[0] == 'G' || p[0] == 'P' || p[0] == 'H' || p[0] == 'C' ||
			   p[0] == 'O' || p[0] == 'D' || p[0] == 'T')))
		return -1;
	if (memcmp(p, "GET ", 4) && memcmp(p, "POST", 4) && memcmp(p, "HEAD", 4) &&
	    memcmp(p, "PUT ", 4) && memcmp(p, "OPTI", 4) && memcmp(p, "CONN", 4))
		return -1;

	memcpy(buf, p, len);
	buf[len] = '\0';
	/* case-insensitive Host: */
	for (i = 0; i + 5 < len; i++) {
		if ((buf[i] == 'H' || buf[i] == 'h') &&
		    (buf[i + 1] == 'o' || buf[i + 1] == 'O') &&
		    (buf[i + 2] == 's' || buf[i + 2] == 'S') &&
		    (buf[i + 3] == 't' || buf[i + 3] == 'T') &&
		    buf[i + 4] == ':') {
			s = buf + i + 5;
			while (*s == ' ' || *s == '\t')
				s++;
			i = 0;
			while (s[i] && s[i] != '\r' && s[i] != '\n' && s[i] != ':' &&
			       i + 1 < out_sz) {
				out[i] = s[i];
				i++;
			}
			out[i] = '\0';
			return i > 0 ? 0 : -1;
		}
	}
	return -1;
}

static int is_quic_long(const uint8_t *p, size_t len)
{
	/* IETF QUIC long header: first byte 0xC0-0xFF roughly, version non-zero */
	if (len < 6)
		return 0;
	if ((p[0] & 0x80) == 0)
		return 0;
	return 1;
}

static int is_dns_query(const uint8_t *p, size_t len, uint16_t sport, uint16_t dport)
{
	if (dport != 53 && sport != 53)
		return 0;
	if (len < 12)
		return 0;
	/* QR bit = 0 for query */
	return (p[2] & 0x80) == 0;
}

static int is_bittorrent(const uint8_t *p, size_t len)
{
	if (len >= 20 && p[0] == 19 && memcmp(p + 1, "BitTorrent protocol", 19) == 0)
		return 1;
	if (len >= 8 && memcmp(p, "d1:ad2:id", 8) == 0)
		return 1;
	return 0;
}

uint8_t oo_classify_payload(struct oo_classifier *c,
			    uint8_t l4proto,
			    uint16_t sport, uint16_t dport,
			    const uint8_t *payload, size_t len,
			    char *host_out, size_t host_sz)
{
	uint8_t id;
	char host[OO_HOST_MAX];

	if (host_out && host_sz)
		host_out[0] = '\0';
	host[0] = '\0';

	if (!payload || len == 0) {
		/* port-only weak tags when no payload yet */
		if (dport == 53 || sport == 53)
			return map_token(c, "dns");
		if (dport == 80 || sport == 80)
			return map_token(c, "http");
		if (dport == 443 || sport == 443)
			return map_token(c, "tls");
		return OO_B_UNKNOWN;
	}

	if (l4proto == 17) { /* UDP */
		if (is_dns_query(payload, len, sport, dport) || dport == 53 || sport == 53) {
			id = map_token(c, "dns");
			return id ? id : OO_B_COMMON;
		}
		if (is_quic_long(payload, len) || dport == 443 || sport == 443) {
			/* QUIC may carry TLS crypto; no SNI easy path without full parse */
			id = map_token(c, "quic");
			return id ? id : OO_B_HTTP;
		}
		if (is_bittorrent(payload, len)) {
			id = map_token(c, "bittorrent");
			return id ? id : OO_B_DOWNLOAD;
		}
		if (dport == 123 || sport == 123) {
			id = map_token(c, "ntp");
			return id ? id : OO_B_COMMON;
		}
	}

	if (l4proto == 6) { /* TCP */
		if (extract_tls_sni(payload, len, host, sizeof(host)) == 0) {
			if (host_out && host_sz) {
				strncpy(host_out, host, host_sz - 1);
				host_out[host_sz - 1] = '\0';
			}
			id = map_token(c, host);
			if (id != OO_B_UNKNOWN)
				return id;
			id = map_token(c, "tls");
			return id ? id : OO_B_HTTP;
		}
		if (extract_http_host(payload, len, host, sizeof(host)) == 0) {
			if (host_out && host_sz) {
				strncpy(host_out, host, host_sz - 1);
				host_out[host_sz - 1] = '\0';
			}
			id = map_token(c, host);
			if (id != OO_B_UNKNOWN)
				return id;
			id = map_token(c, "http");
			return id ? id : OO_B_HTTP;
		}
		if (is_bittorrent(payload, len)) {
			id = map_token(c, "bittorrent");
			return id ? id : OO_B_DOWNLOAD;
		}
		/* SSH banner */
		if (len >= 4 && memcmp(payload, "SSH-", 4) == 0) {
			id = map_token(c, "ssh");
			return id ? id : OO_B_COMMON;
		}
		if (dport == 80 || sport == 80) {
			id = map_token(c, "http");
			return id ? id : OO_B_HTTP;
		}
		if (dport == 443 || sport == 443) {
			id = map_token(c, "tls");
			return id ? id : OO_B_HTTP;
		}
		if (dport == 22 || sport == 22) {
			id = map_token(c, "ssh");
			return id ? id : OO_B_COMMON;
		}
	}

	return OO_B_UNKNOWN;
}

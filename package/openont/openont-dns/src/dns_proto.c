/* SPDX-License-Identifier: GPL-2.0-only */
#include "dns_proto.h"

#include <stdio.h>
#include <string.h>

static uint16_t rd16(const uint8_t *p)
{
	return (uint16_t)((p[0] << 8) | p[1]);
}

static uint32_t rd32(const uint8_t *p)
{
	return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) |
	       ((uint32_t)p[2] << 8) | p[3];
}

static void wr16(uint8_t *p, uint16_t v)
{
	p[0] = (uint8_t)(v >> 8);
	p[1] = (uint8_t)v;
}

static void wr32(uint8_t *p, uint32_t v)
{
	p[0] = (uint8_t)(v >> 24);
	p[1] = (uint8_t)(v >> 16);
	p[2] = (uint8_t)(v >> 8);
	p[3] = (uint8_t)v;
}

void dns_normalize(char *name)
{
	char *r;
	char *w;
	size_t n;

	if (!name)
		return;
	for (r = name, w = name; *r; r++) {
		unsigned char c = (unsigned char)*r;
		if (c >= 'A' && c <= 'Z')
			c = (unsigned char)(c - 'A' + 'a');
		*w++ = (char)c;
	}
	*w = '\0';
	n = strlen(name);
	while (n > 0 && name[n - 1] == '.') {
		name[--n] = '\0';
	}
}

int dns_parse_ipv4(const char *s, uint8_t out[4])
{
	unsigned a, b, c, d;
	char tail;

	if (!s || sscanf(s, "%u.%u.%u.%u%c", &a, &b, &c, &d, &tail) != 4)
		return -1;
	if (a > 255 || b > 255 || c > 255 || d > 255)
		return -1;
	out[0] = (uint8_t)a;
	out[1] = (uint8_t)b;
	out[2] = (uint8_t)c;
	out[3] = (uint8_t)d;
	return 0;
}

void dns_format_ipv4(const uint8_t addr[4], char *out, int outlen)
{
	if (!out || outlen < 8)
		return;
	snprintf(out, (size_t)outlen, "%u.%u.%u.%u",
		 addr[0], addr[1], addr[2], addr[3]);
}

int dns_parse_ipv6(const char *s, uint8_t out[16])
{
	unsigned parts[8];
	int nparts = 0;
	int gap = -1;
	const char *p = s;
	int i;

	if (!s || !*s)
		return -1;
	memset(out, 0, 16);
	if (p[0] == ':') {
		if (p[1] != ':')
			return -1;
		gap = 0;
		p += 2;
		if (!*p)
			return 0;
	}

	while (*p && nparts < 8) {
		unsigned v = 0;
		int digits = 0;

		if (*p == ':')
			return -1;
		while (*p && *p != ':') {
			char c = *p;
			unsigned d;
			if (c >= '0' && c <= '9')
				d = (unsigned)(c - '0');
			else if (c >= 'a' && c <= 'f')
				d = (unsigned)(c - 'a' + 10);
			else if (c >= 'A' && c <= 'F')
				d = (unsigned)(c - 'A' + 10);
			else
				return -1;
			v = (v << 4) | d;
			if (v > 0xffff)
				return -1;
			digits++;
			if (digits > 4)
				return -1;
			p++;
		}
		if (!digits)
			return -1;
		parts[nparts++] = v;
		if (!*p)
			break;
		if (p[1] == ':') {
			if (gap >= 0)
				return -1;
			gap = nparts;
			p += 2;
			if (!*p)
				break;
			continue;
		}
		p++;
		if (!*p)
			return -1;
	}
	if (*p)
		return -1;
	if (gap < 0) {
		if (nparts != 8)
			return -1;
		for (i = 0; i < 8; i++) {
			out[i * 2] = (uint8_t)(parts[i] >> 8);
			out[i * 2 + 1] = (uint8_t)parts[i];
		}
		return 0;
	}
	{
		int tail = nparts - gap;
		int zi = 8 - nparts;
		if (zi < 1)
			return -1;
		for (i = 0; i < gap; i++) {
			out[i * 2] = (uint8_t)(parts[i] >> 8);
			out[i * 2 + 1] = (uint8_t)parts[i];
		}
		for (i = 0; i < tail; i++) {
			int src = gap + i;
			int dst = gap + zi + i;
			out[dst * 2] = (uint8_t)(parts[src] >> 8);
			out[dst * 2 + 1] = (uint8_t)parts[src];
		}
	}
	return 0;
}

void dns_format_ipv6(const uint8_t addr[16], char *out, int outlen)
{
	int best_at = -1;
	int best_len = 0;
	int i;

	if (!out || outlen < 4)
		return;
	for (i = 0; i < 8; ) {
		if (addr[i * 2] == 0 && addr[i * 2 + 1] == 0) {
			int j = i;
			while (j < 8 && addr[j * 2] == 0 && addr[j * 2 + 1] == 0)
				j++;
			if (j - i > best_len) {
				best_at = i;
				best_len = j - i;
			}
			i = j;
		} else {
			i++;
		}
	}
	if (best_len < 2)
		best_at = -1;

	out[0] = '\0';
	i = 0;
	while (i < 8) {
		char piece[8];
		if (best_at >= 0 && i == best_at) {
			strncat(out, "::", (size_t)outlen - strlen(out) - 1);
			i += best_len;
			continue;
		}
		snprintf(piece, sizeof(piece), "%x",
			 (addr[i * 2] << 8) | addr[i * 2 + 1]);
		if (out[0] && out[strlen(out) - 1] != ':')
			strncat(out, ":", (size_t)outlen - strlen(out) - 1);
		strncat(out, piece, (size_t)outlen - strlen(out) - 1);
		i++;
	}
	if (best_at == 0 && best_len == 8)
		snprintf(out, (size_t)outlen, "::");
}

int dns_name_decode(const uint8_t *pkt, int len, int off,
		    char *out, int outlen, int *next)
{
	int pos = off;
	int outp = 0;
	int hops = 0;
	int jumped = 0;
	int end = off;

	if (!pkt || !out || outlen < 2 || off < 0 || off >= len)
		return -1;
	out[0] = '\0';
	while (pos < len && hops < 32) {
		uint8_t lab = pkt[pos];
		if (lab == 0) {
			if (!jumped)
				end = pos + 1;
			break;
		}
		if ((lab & 0xc0) == 0xc0) {
			int ptr;
			if (pos + 1 >= len)
				return -1;
			ptr = ((lab & 0x3f) << 8) | pkt[pos + 1];
			if (ptr >= len)
				return -1;
			if (!jumped)
				end = pos + 2;
			pos = ptr;
			jumped = 1;
			hops++;
			continue;
		}
		if ((lab & 0xc0) != 0)
			return -1;
		if (pos + 1 + lab > len)
			return -1;
		if (outp && outp + 1 < outlen)
			out[outp++] = '.';
		if (outp + lab >= outlen)
			return -1;
		memcpy(out + outp, pkt + pos + 1, lab);
		outp += lab;
		out[outp] = '\0';
		pos += 1 + lab;
		if (!jumped)
			end = pos;
		hops++;
	}
	if (hops >= 32)
		return -1;
	dns_normalize(out);
	if (next)
		*next = end;
	return 0;
}

int dns_name_encode(const char *name, uint8_t *out, int max)
{
	const char *p = name;
	int n = 0;

	if (!name || !out || max < 1)
		return -1;
	if (!*p) {
		out[0] = 0;
		return 1;
	}
	while (*p) {
		const char *dot = strchr(p, '.');
		int lab = dot ? (int)(dot - p) : (int)strlen(p);
		if (lab <= 0 || lab > 63 || n + lab + 1 >= max)
			return -1;
		out[n++] = (uint8_t)lab;
		memcpy(out + n, p, (size_t)lab);
		n += lab;
		if (!dot)
			break;
		p = dot + 1;
		if (!*p)
			break;
	}
	if (n + 1 > max)
		return -1;
	out[n++] = 0;
	return n;
}

int dns_parse_question(const uint8_t *pkt, int len, struct dns_question *q)
{
	int next = 0;
	uint16_t qd;

	if (!pkt || !q || len < 12)
		return -1;
	memset(q, 0, sizeof(*q));
	qd = rd16(pkt + 4);
	if (qd < 1)
		return -1;
	if (dns_name_decode(pkt, len, 12, q->name, sizeof(q->name), &next) != 0)
		return -1;
	if (next + 4 > len)
		return -1;
	q->qtype = rd16(pkt + next);
	q->qclass = rd16(pkt + next + 2);
	q->qend = next + 4;
	return 0;
}

int dns_header_rcode(const uint8_t *pkt, int len)
{
	if (!pkt || len < 4)
		return -1;
	return pkt[3] & 0x0f;
}

uint16_t dns_header_id(const uint8_t *pkt, int len)
{
	if (!pkt || len < 2)
		return 0;
	return rd16(pkt);
}

void dns_set_id(uint8_t *pkt, int len, uint16_t id)
{
	if (!pkt || len < 2)
		return;
	wr16(pkt, id);
}

static int parse_one_rr(const uint8_t *pkt, int len, int off, struct dns_rr *rr, int *next)
{
	int name_next = 0;
	uint16_t rdlen;
	int rdoff;

	memset(rr, 0, sizeof(*rr));
	if (dns_name_decode(pkt, len, off, rr->name, sizeof(rr->name), &name_next) != 0)
		return -1;
	if (name_next + 10 > len)
		return -1;
	rr->type = rd16(pkt + name_next);
	rr->rrclass = rd16(pkt + name_next + 2);
	rr->ttl = rd32(pkt + name_next + 4);
	rdlen = rd16(pkt + name_next + 8);
	rdoff = name_next + 10;
	if (rdoff + rdlen > len || rdlen > sizeof(rr->rdata))
		return -1;
	rr->rdlen = rdlen;
	memcpy(rr->rdata, pkt + rdoff, rdlen);
	if (rr->type == DNS_T_A && rdlen == 4)
		dns_format_ipv4(rr->rdata, rr->text, sizeof(rr->text));
	else if (rr->type == DNS_T_AAAA && rdlen == 16)
		dns_format_ipv6(rr->rdata, rr->text, sizeof(rr->text));
	else if (rr->type == DNS_T_CNAME) {
		int ignored = 0;
		if (dns_name_decode(pkt, len, rdoff, rr->text, sizeof(rr->text), &ignored) != 0)
			rr->text[0] = '\0';
	}
	if (next)
		*next = rdoff + rdlen;
	return 0;
}

int dns_parse_answers(const uint8_t *pkt, int len, struct dns_rr *rr, int maxrr)
{
	struct dns_question q;
	uint16_t an;
	int off;
	int n = 0;
	int i;

	if (dns_parse_question(pkt, len, &q) != 0)
		return -1;
	an = rd16(pkt + 6);
	off = q.qend;
	for (i = 0; i < an && n < maxrr; i++) {
		int next = 0;
		if (parse_one_rr(pkt, len, off, &rr[n], &next) != 0)
			return n;
		off = next;
		n++;
	}
	return n;
}

int dns_build_query(uint8_t *out, int max, uint16_t id, const char *name, uint16_t qtype)
{
	int nlen;
	char norm[DNS_MAX_NAME + 1];

	if (!out || max < 18 || !name)
		return -1;
	snprintf(norm, sizeof(norm), "%s", name);
	dns_normalize(norm);
	memset(out, 0, 12);
	wr16(out, id);
	wr16(out + 2, 0x0100);
	wr16(out + 4, 1);
	nlen = dns_name_encode(norm, out + 12, max - 16);
	if (nlen < 0)
		return -1;
	wr16(out + 12 + nlen, qtype);
	wr16(out + 12 + nlen + 2, DNS_CLASS_IN);
	return 12 + nlen + 4;
}

static int append_name(uint8_t *out, int max, int off, const char *name, int qname_off, const char *qname)
{
	char norm[DNS_MAX_NAME + 1];

	snprintf(norm, sizeof(norm), "%s", name ? name : "");
	dns_normalize(norm);
	if (qname && strcmp(norm, qname) == 0 && qname_off >= 0 && off + 2 <= max) {
		wr16(out + off, (uint16_t)(0xc000 | qname_off));
		return 2;
	}
	return dns_name_encode(norm, out + off, max - off);
}

int dns_build_response(uint8_t *out, int max, const uint8_t *query, int qlen,
		       int rcode, const struct dns_rr *ans, int nans)
{
	struct dns_question q;
	int off;
	int i;
	uint16_t flags;

	if (!out || !query || dns_parse_question(query, qlen, &q) != 0)
		return -1;
	if (q.qend > max)
		return -1;
	memcpy(out, query, (size_t)q.qend);
	flags = 0x8000 | 0x0080 | (rd16(query + 2) & 0x0100) | (rcode & 0x0f);
	wr16(out + 2, flags);
	wr16(out + 4, 1);
	wr16(out + 6, (uint16_t)(nans > 0 ? nans : 0));
	wr16(out + 8, 0);
	wr16(out + 10, 0);
	off = q.qend;
	for (i = 0; i < nans; i++) {
		int nl;
		if (off + 12 + ans[i].rdlen > max)
			return -1;
		nl = append_name(out, max, off, ans[i].name, 12, q.name);
		if (nl < 0)
			return -1;
		off += nl;
		if (off + 10 + ans[i].rdlen > max)
			return -1;
		wr16(out + off, ans[i].type);
		wr16(out + off + 2, DNS_CLASS_IN);
		wr32(out + off + 4, ans[i].ttl);
		wr16(out + off + 8, ans[i].rdlen);
		memcpy(out + off + 10, ans[i].rdata, ans[i].rdlen);
		off += 10 + ans[i].rdlen;
	}
	return off;
}

uint32_t dns_answer_ttl(const struct dns_rr *ans, int nans, uint32_t deflt)
{
	uint32_t ttl = 0;
	int i;
	int seen = 0;

	for (i = 0; i < nans; i++) {
		if (!seen || ans[i].ttl < ttl)
			ttl = ans[i].ttl;
		seen = 1;
	}
	return seen ? ttl : deflt;
}

int dns_make_a(struct dns_rr *rr, const char *name, uint32_t ttl, const uint8_t addr[4])
{
	memset(rr, 0, sizeof(*rr));
	snprintf(rr->name, sizeof(rr->name), "%s", name);
	dns_normalize(rr->name);
	rr->type = DNS_T_A;
	rr->rrclass = DNS_CLASS_IN;
	rr->ttl = ttl;
	rr->rdlen = 4;
	memcpy(rr->rdata, addr, 4);
	dns_format_ipv4(addr, rr->text, sizeof(rr->text));
	return 0;
}

int dns_make_aaaa(struct dns_rr *rr, const char *name, uint32_t ttl, const uint8_t addr[16])
{
	memset(rr, 0, sizeof(*rr));
	snprintf(rr->name, sizeof(rr->name), "%s", name);
	dns_normalize(rr->name);
	rr->type = DNS_T_AAAA;
	rr->rrclass = DNS_CLASS_IN;
	rr->ttl = ttl;
	rr->rdlen = 16;
	memcpy(rr->rdata, addr, 16);
	dns_format_ipv6(addr, rr->text, sizeof(rr->text));
	return 0;
}

int dns_make_cname(struct dns_rr *rr, const char *name, uint32_t ttl, const char *target)
{
	int n;
	char norm[DNS_MAX_NAME + 1];

	memset(rr, 0, sizeof(*rr));
	snprintf(rr->name, sizeof(rr->name), "%s", name);
	dns_normalize(rr->name);
	snprintf(norm, sizeof(norm), "%s", target);
	dns_normalize(norm);
	rr->type = DNS_T_CNAME;
	rr->rrclass = DNS_CLASS_IN;
	rr->ttl = ttl;
	n = dns_name_encode(norm, rr->rdata, sizeof(rr->rdata));
	if (n < 0)
		return -1;
	rr->rdlen = (uint16_t)n;
	snprintf(rr->text, sizeof(rr->text), "%s", norm);
	return 0;
}

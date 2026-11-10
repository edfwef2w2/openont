/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef OPENONT_DNS_PROTO_H
#define OPENONT_DNS_PROTO_H

#include <stddef.h>
#include <stdint.h>

#define DNS_MAX_NAME 253
#define DNS_MAX_PACKET 4096
#define DNS_MAX_RR 16

#define DNS_T_A 1
#define DNS_T_CNAME 5
#define DNS_T_AAAA 28
#define DNS_CLASS_IN 1

#define DNS_R_NOERROR 0
#define DNS_R_NXDOMAIN 3
#define DNS_R_REFUSED 5

struct dns_question {
	char name[DNS_MAX_NAME + 1];
	uint16_t qtype;
	uint16_t qclass;
	int qend;
};

struct dns_rr {
	char name[DNS_MAX_NAME + 1];
	uint16_t type;
	uint16_t rrclass;
	uint32_t ttl;
	uint8_t rdata[512];
	uint16_t rdlen;
	char text[256];
};

int dns_name_decode(const uint8_t *pkt, int len, int off,
		    char *out, int outlen, int *next);
int dns_name_encode(const char *name, uint8_t *out, int max);

int dns_parse_question(const uint8_t *pkt, int len, struct dns_question *q);
int dns_header_rcode(const uint8_t *pkt, int len);
uint16_t dns_header_id(const uint8_t *pkt, int len);
void dns_set_id(uint8_t *pkt, int len, uint16_t id);

int dns_parse_answers(const uint8_t *pkt, int len, struct dns_rr *rr, int maxrr);

int dns_build_query(uint8_t *out, int max, uint16_t id,
		    const char *name, uint16_t qtype);
int dns_build_response(uint8_t *out, int max, const uint8_t *query, int qlen,
		       int rcode, const struct dns_rr *ans, int nans);

uint32_t dns_answer_ttl(const struct dns_rr *ans, int nans, uint32_t deflt);

int dns_make_a(struct dns_rr *rr, const char *name, uint32_t ttl, const uint8_t addr[4]);
int dns_make_aaaa(struct dns_rr *rr, const char *name, uint32_t ttl, const uint8_t addr[16]);
int dns_make_cname(struct dns_rr *rr, const char *name, uint32_t ttl, const char *target);

int dns_parse_ipv4(const char *s, uint8_t out[4]);
int dns_parse_ipv6(const char *s, uint8_t out[16]);
void dns_format_ipv4(const uint8_t addr[4], char *out, int outlen);
void dns_format_ipv6(const uint8_t addr[16], char *out, int outlen);

void dns_normalize(char *name);

#endif

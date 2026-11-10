/* SPDX-License-Identifier: GPL-2.0-only */
#include "bogus.h"
#include "cache.h"
#include "dns_proto.h"
#include "rules.h"
#include "sni.h"

#include <stdio.h>
#include <string.h>

static int g_fail;

static void expect(int cond, const char *msg)
{
	if (!cond) {
		fprintf(stderr, "FAIL %s\n", msg);
		g_fail++;
	}
}

static void test_proto(void)
{
	uint8_t q[512];
	uint8_t resp[512];
	struct dns_question qq;
	struct dns_rr ans;
	struct dns_rr got[4];
	uint8_t addr[4] = { 1, 2, 3, 4 };
	int qlen;
	int rlen;
	int n;
	uint8_t v6[16];
	char text[64];

	qlen = dns_build_query(q, sizeof(q), 0x1234, "Example.COM.", DNS_T_A);
	expect(qlen > 0, "build query");
	expect(dns_parse_question(q, qlen, &qq) == 0, "parse question");
	expect(strcmp(qq.name, "example.com") == 0, "normalized name");
	expect(qq.qtype == DNS_T_A, "qtype A");
	expect(dns_make_a(&ans, "example.com", 30, addr) == 0, "make A");
	rlen = dns_build_response(resp, sizeof(resp), q, qlen, DNS_R_NOERROR, &ans, 1);
	expect(rlen > 0, "build response");
	expect(dns_header_id(resp, rlen) == 0x1234, "id preserved");
	expect(dns_header_rcode(resp, rlen) == 0, "noerror");
	n = dns_parse_answers(resp, rlen, got, 4);
	expect(n == 1, "one answer");
	expect(strcmp(got[0].text, "1.2.3.4") == 0, "A text");
	expect(got[0].ttl == 30, "ttl");

	rlen = dns_build_response(resp, sizeof(resp), q, qlen, DNS_R_NXDOMAIN, NULL, 0);
	expect(dns_header_rcode(resp, rlen) == DNS_R_NXDOMAIN, "nxdomain");

	expect(dns_parse_ipv6("2001:db8::1", v6) == 0, "parse v6");
	expect(v6[0] == 0x20 && v6[1] == 0x01 && v6[15] == 1, "v6 bytes");
	dns_format_ipv6(v6, text, sizeof(text));
	expect(strcmp(text, "2001:db8::1") == 0, "format v6");
	expect(dns_parse_ipv6("::1", v6) == 0, "parse ::1");
	expect(v6[15] == 1, "::1 last");
	expect(dns_parse_ipv6("::", v6) == 0, "parse ::");
}

static void test_bogus(void)
{
	struct bogus_list list;
	memset(&list, 0, sizeof(list));
	expect(bogus_add_cidr(&list, "0.0.0.0/8") == 0, "add 0/8");
	expect(bogus_add_cidr(&list, "127.0.0.0/8") == 0, "add 127/8");
	expect(bogus_add_cidr(&list, "240.0.0.0/4") == 0, "add 240/4");
	expect(bogus_contains(&list, "0.1.2.3") == 1, "0.1.2.3 bogus");
	expect(bogus_contains(&list, "1.2.3.4") == 0, "1.2.3.4 ok");
	expect(bogus_contains(&list, "127.0.0.1") == 1, "loopback bogus");
	expect(bogus_contains(&list, "240.1.1.1") == 1, "240 bogus");
	expect(bogus_contains(&list, "8.8.8.8") == 0, "8.8.8.8 ok");
	bogus_free(&list);
}

static void test_cache(void)
{
	struct cache *c = cache_create(32, 5, 60, 1);
	uint8_t pkt[32];
	uint8_t out[32];
	int rcode = -1;
	int plen = 0;
	int refresh = 0;
	int st;

	memset(pkt, 0xab, sizeof(pkt));
	expect(c != NULL, "cache create");
	expect(cache_store(c, "Example.com", DNS_T_A, 0, pkt, sizeof(pkt), 1, 1000) == 0, "store");
	st = cache_lookup(c, "example.com", DNS_T_A, 1000, &rcode, out, sizeof(out), &plen, &refresh);
	expect(st == CACHE_FRESH, "fresh");
	expect(plen == 32, "pkt len");
	/* min ttl clamps 1 up to 5, so expire is 1005. At 1004 still fresh. */
	st = cache_lookup(c, "example.com", DNS_T_A, 1004, &rcode, out, sizeof(out), &plen, &refresh);
	expect(st == CACHE_FRESH, "still fresh at clamp");
	st = cache_lookup(c, "example.com", DNS_T_A, 1006, &rcode, out, sizeof(out), &plen, &refresh);
	expect(st == CACHE_STALE, "serve expired");
	expect(refresh == 1, "stale wants refresh");
	st = cache_lookup(c, "example.com", DNS_T_A, 1005 + 3600, &rcode, out, sizeof(out), &plen, &refresh);
	expect(st == CACHE_MISS, "past stale window");

	expect(cache_store(c, "long.example", DNS_T_A, 0, pkt, sizeof(pkt), 1000, 0) == 0, "store max");
	st = cache_lookup(c, "long.example", DNS_T_A, 59, &rcode, out, sizeof(out), &plen, &refresh);
	expect(st == CACHE_FRESH, "inside max ttl");
	st = cache_lookup(c, "long.example", DNS_T_A, 60, &rcode, out, sizeof(out), &plen, &refresh);
	expect(st == CACHE_STALE, "max ttl expired still served");
	st = cache_lookup(c, "long.example", DNS_T_A, 60 + 3600, &rcode, out, sizeof(out), &plen, &refresh);
	expect(st == CACHE_MISS, "stale window ended");
	cache_free(c);
}

static void test_rules(void)
{
	struct ruleset *rs = rules_create();
	struct rules_hit hit;

	expect(rs != NULL, "rules");
	expect(rules_load_line(rs, "adg - ||ads.example^") == 0, "suffix block");
	expect(rules_load_line(rs, "adg - @@||good.ads.example^") == 0, "allow");
	expect(rules_load_line(rs, "adg - |exact.test^") == 0, "exact block");
	expect(rules_load_line(rs, "adg - 0.0.0.0 hosts.example") == 0, "hosts");
	expect(rules_load_line(rs, "adg - /tracker[0-9]/") == 0, "regex");
	expect(rules_load_line(rs, "rewrite suffix cdn.example A 9.9.9.9") == 0, "rewrite");
	expect(rules_load_line(rs, "accel suffix github.com") == 0, "accel");
	expect(rules_load_line(rs, "domain suffix cn.example intl nftset inet/fw4/cn") == 0, "domain");
	expect(rules_load_line(rs, "skip 192.168.1.9") == 0, "skip");
	expect(rules_load_line(rs, "adg 10.0.0.5 ||only.client^") == 0, "client rule");

	rules_match(rs, "a.ads.example", "1.1.1.1", &hit);
	expect(hit.block == 1, "suffix blocks child");

	rules_match(rs, "good.ads.example", "1.1.1.1", &hit);
	expect(hit.block == 0, "allow beats block");

	rules_match(rs, "exact.test", NULL, &hit);
	expect(hit.block == 1, "exact name blocked");
	rules_match(rs, "sub.exact.test", NULL, &hit);
	expect(hit.block == 0, "exact does not hit child");

	rules_match(rs, "hosts.example", NULL, &hit);
	expect(hit.block == 1, "hosts line");

	rules_match(rs, "tracker5.cdn", NULL, &hit);
	expect(hit.block == 1, "regex block");

	rules_match(rs, "img.cdn.example", NULL, &hit);
	expect(hit.rewrite == 1, "rewrite hit");
	expect(hit.rewrite_type == DNS_T_A, "rewrite A");
	expect(strcmp(hit.rewrite_value, "9.9.9.9") == 0, "rewrite value");

	rules_match(rs, "www.github.com", NULL, &hit);
	expect(hit.accel == 1, "accel suffix");

	rules_match(rs, "a.cn.example", NULL, &hit);
	expect(strcmp(hit.group, "intl") == 0, "group");
	expect(strcmp(hit.nftset, "inet/fw4/cn") == 0, "nftset");

	rules_match(rs, "only.client", "10.0.0.8", &hit);
	expect(hit.block == 0, "other client not blocked");
	rules_match(rs, "only.client", "10.0.0.5", &hit);
	expect(hit.block == 1, "matching client blocked");

	expect(rules_client_skips(rs, "192.168.1.9") == 1, "skip list");
	expect(rules_client_skips(rs, "192.168.1.8") == 0, "not skipped");

	/* Longer block beats a shorter allow. */
	expect(rules_load_line(rs, "adg - @@||example^") == 0, "wide allow");
	expect(rules_load_line(rs, "block exact ads.example") == 0, "narrow block");
	rules_match(rs, "ads.example", NULL, &hit);
	expect(hit.block == 1, "more specific block wins");
	rules_match(rs, "www.example", NULL, &hit);
	expect(hit.block == 0, "wide allow still allows");

	rules_free(rs);
}

static void put16(uint8_t *p, int v)
{
	p[0] = (uint8_t)(v >> 8);
	p[1] = (uint8_t)v;
}

static void test_sni(void)
{
	uint8_t buf[256];
	int n = 0;
	struct client_hello_info info;
	const char *host = "example.com";
	int hlen = (int)strlen(host);
	int ext_body;
	int ext_len;
	int hs_len;
	int rec_len;

	/* Handshake body starts at offset 9. Build from the inside. */
	memset(buf, 0, sizeof(buf));
	buf[0] = 0x16;
	buf[1] = 0x03;
	buf[2] = 0x01;
	buf[5] = 0x01;
	buf[9] = 0x03;
	buf[10] = 0x03;
	n = 11 + 32;
	buf[n++] = 0; /* session */
	put16(buf + n, 2);
	n += 2;
	put16(buf + n, 0x002f);
	n += 2;
	buf[n++] = 1;
	buf[n++] = 0; /* compression */
	ext_body = n + 2;
	/* SNI */
	put16(buf + ext_body, 0);
	put16(buf + ext_body + 2, 5 + hlen);
	put16(buf + ext_body + 4, 3 + hlen);
	buf[ext_body + 6] = 0;
	put16(buf + ext_body + 7, hlen);
	memcpy(buf + ext_body + 9, host, (size_t)hlen);
	/* ALPN */
	{
		int ap = ext_body + 9 + hlen;
		const char *a = "h2";
		const char *b = "http/1.1";
		int list = 1 + 2 + 1 + 8;
		put16(buf + ap, 16);
		put16(buf + ap + 2, 2 + list);
		put16(buf + ap + 4, list);
		buf[ap + 6] = 2;
		memcpy(buf + ap + 7, a, 2);
		buf[ap + 9] = 8;
		memcpy(buf + ap + 10, b, 8);
		ext_len = (ap + 18) - ext_body;
	}
	put16(buf + n, ext_len);
	hs_len = (ext_body + ext_len) - 9;
	buf[6] = (uint8_t)((hs_len >> 16) & 0xff);
	buf[7] = (uint8_t)((hs_len >> 8) & 0xff);
	buf[8] = (uint8_t)(hs_len & 0xff);
	rec_len = 4 + hs_len;
	put16(buf + 3, rec_len);

	expect(sni_parse_client_hello(buf, 4, &info) == 0, "short hello needs more");
	expect(sni_parse_client_hello(buf, 5 + rec_len, &info) == 1, "parsed hello");
	expect(strcmp(info.sni, "example.com") == 0, "sni");
	expect(info.nalpn == 2, "two alpn");
	expect(strcmp(info.alpn[0], "h2") == 0, "alpn h2");
	expect(strcmp(info.alpn[1], "http/1.1") == 0, "alpn http");
	expect(sni_name_matches("WWW.Example.com", "example.com") == 1, "suffix host");
	expect(sni_name_matches("notexample.com", "example.com") == 0, "not a parent");
	expect(sni_parse_client_hello((const uint8_t *)"GET /", 5, &info) == -1, "not tls");
}

int main(void)
{
	test_proto();
	test_bogus();
	test_cache();
	test_rules();
	test_sni();
	if (g_fail) {
		fprintf(stderr, "%d failure(s)\n", g_fail);
		return 1;
	}
	printf("openont-dns unit tests ok\n");
	return 0;
}

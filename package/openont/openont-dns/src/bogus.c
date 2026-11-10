/* SPDX-License-Identifier: GPL-2.0-only */
#include "bogus.h"
#include "dns_proto.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void bogus_free(struct bogus_list *list)
{
	if (!list)
		return;
	free(list->items);
	list->items = NULL;
	list->n = 0;
	list->cap = 0;
}

static int prefix_ok(int prefix, int maxp)
{
	return prefix >= 0 && prefix <= maxp;
}

int bogus_add_cidr(struct bogus_list *list, const char *cidr)
{
	char buf[128];
	char *slash;
	struct bogus_item item;
	int prefix;
	unsigned char addr[16];
	int v6;

	if (!list || !cidr || !cidr[0])
		return -1;
	snprintf(buf, sizeof(buf), "%s", cidr);
	slash = strchr(buf, '/');
	if (slash) {
		*slash = '\0';
		prefix = atoi(slash + 1);
	} else {
		prefix = -1;
	}
	memset(&item, 0, sizeof(item));
	if (strchr(buf, ':')) {
		if (dns_parse_ipv6(buf, addr) != 0)
			return -1;
		v6 = 1;
		if (prefix < 0)
			prefix = 128;
		if (!prefix_ok(prefix, 128))
			return -1;
	} else {
		if (dns_parse_ipv4(buf, addr) != 0)
			return -1;
		v6 = 0;
		if (prefix < 0)
			prefix = 32;
		if (!prefix_ok(prefix, 32))
			return -1;
	}
	item.v6 = v6;
	item.prefix = prefix;
	memcpy(item.addr, addr, v6 ? 16 : 4);
	if (list->n + 1 > list->cap) {
		int cap = list->cap ? list->cap * 2 : 8;
		struct bogus_item *ni = realloc(list->items, (size_t)cap * sizeof(*ni));
		if (!ni)
			return -1;
		list->items = ni;
		list->cap = cap;
	}
	list->items[list->n++] = item;
	return 0;
}

static int match_prefix(const unsigned char *addr, const unsigned char *net, int prefix, int nbytes)
{
	int full = prefix / 8;
	int rem = prefix % 8;
	int i;

	if (full > nbytes)
		return 0;
	for (i = 0; i < full; i++) {
		if (addr[i] != net[i])
			return 0;
	}
	if (rem && full < nbytes) {
		unsigned char mask = (unsigned char)(0xff << (8 - rem));
		if ((addr[full] & mask) != (net[full] & mask))
			return 0;
	}
	return 1;
}

int bogus_contains(const struct bogus_list *list, const char *ip)
{
	unsigned char addr[16];
	int v6;
	int i;

	if (!list || !ip)
		return 0;
	if (strchr(ip, ':')) {
		if (dns_parse_ipv6(ip, addr) != 0)
			return 0;
		v6 = 1;
	} else {
		if (dns_parse_ipv4(ip, addr) != 0)
			return 0;
		v6 = 0;
	}
	for (i = 0; i < list->n; i++) {
		const struct bogus_item *it = &list->items[i];
		if (it->v6 != v6)
			continue;
		if (match_prefix(addr, it->addr, it->prefix, v6 ? 16 : 4))
			return 1;
	}
	return 0;
}

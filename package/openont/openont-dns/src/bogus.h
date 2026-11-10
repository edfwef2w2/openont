/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef OPENONT_BOGUS_H
#define OPENONT_BOGUS_H

struct bogus_list {
	struct bogus_item *items;
	int n;
	int cap;
};

struct bogus_item {
	int v6;
	int prefix;
	unsigned char addr[16];
};

int bogus_add_cidr(struct bogus_list *list, const char *cidr);
int bogus_contains(const struct bogus_list *list, const char *ip);
void bogus_free(struct bogus_list *list);

#endif

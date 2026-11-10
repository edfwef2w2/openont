#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
. /usr/lib/openont/dns.sh

while true; do
	openont_dns_refresh_lists
	sleep 60
done

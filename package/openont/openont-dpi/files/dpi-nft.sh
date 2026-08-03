#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
# Install / remove OpenONT DPI NFQUEUE hooks (nftables).

QUEUE_NUM="${OPENONT_DPI_QUEUE:-10}"
TABLE="inet openont"
CHAIN="dpi"

cmd="$1"

nft_ok() {
	command -v nft >/dev/null 2>&1
}

remove_rules() {
	nft_ok || return 0
	nft delete table "$TABLE" 2>/dev/null || true
}

install_rules() {
	nft_ok || {
		echo "nft not available" >&2
		return 1
	}
	remove_rules
	nft -f - <<EOF
table $TABLE {
	chain $CHAIN {
		type filter hook forward priority 0; policy accept;
		# Already labeled by openont-dpi (packet mark in class range) → skip queue
		meta mark and 0xff0000 != 0 accept
		# New / early packets into userspace classifier
		ct state new queue num $QUEUE_NUM bypass
		ct packets 1-12 queue num $QUEUE_NUM bypass
	}
}
EOF
}

case "$cmd" in
	start|install)
		install_rules
		;;
	stop|remove)
		remove_rules
		;;
	*)
		echo "usage: $0 start|stop" >&2
		exit 1
		;;
esac

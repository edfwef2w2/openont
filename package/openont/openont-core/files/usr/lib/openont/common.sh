# SPDX-License-Identifier: GPL-2.0-only
# Common helpers for OpenONT tools.

[ -n "$OPENONT_COMMON_LOADED" ] && return 0
OPENONT_COMMON_LOADED=1

. /lib/functions.sh 2>/dev/null || true

openont_reload_network() {
	if command -v reload_config >/dev/null 2>&1; then
		reload_config 2>/dev/null && return 0
	fi
	/etc/init.d/network reload 2>/dev/null
	/etc/init.d/firewall reload 2>/dev/null
	/etc/init.d/dnsmasq reload 2>/dev/null
	return 0
}

openont_reload_firewall() {
	/etc/init.d/firewall reload 2>/dev/null || fw4 reload 2>/dev/null || true
}

openont_json_escape() {
	printf '%s' "$1" | sed 's/\\/\\\\/g;s/"/\\"/g'
}

openont_ok() {
	printf '{"ok":true,"message":"%s"}\n' "$(openont_json_escape "${1:-ok}")"
}

openont_err() {
	printf '{"ok":false,"error":"%s"}\n' "$(openont_json_escape "${1:-error}")"
	return 1
}

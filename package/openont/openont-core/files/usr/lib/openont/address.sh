# SPDX-License-Identifier: GPL-2.0-only
# Protocol and addressing of lanN / wanN roles.
#
# This file is the only writer of network.<role>.proto and its parameters
# (ipaddr, gateway, dns, username, password, ipv6) and of the WAN IPv6
# companion. Member ports belong to port.sh, DHCP pools to dhcp.sh.
#
# openont_address_stage_* change UCI without committing so callers
# (port.sh, rpcd) can batch; the public commands commit and reload.

[ -n "$OPENONT_ADDRESS_LOADED" ] && return 0
OPENONT_ADDRESS_LOADED=1

. /usr/lib/openont/role.sh
. /usr/lib/openont/dhcp.sh

_openont_address_need_role() {
	local role="$1"
	openont_role_valid "$role" || { echo "invalid role: $role" >&2; return 1; }
	openont_role_exists "$role" || {
		echo "role not configured: $role (bind a port first: openont-port set $role <eth...>)" >&2
		return 1
	}
}

# Parse a.b.c.d or a.b.c.d/nn into _addr_ip and _addr_prefix (default 24).
openont_address_parse_cidr() {
	local raw="$1" ip pref
	_addr_ip=""
	_addr_prefix="24"
	case "$raw" in
		*/*) ip=${raw%/*}; pref=${raw#*/} ;;
		*) ip="$raw"; pref="24" ;;
	esac
	openont_is_ipv4 "$ip" || return 1
	case "$pref" in ''|*[!0-9]*) return 1 ;; esac
	[ "$pref" -ge 1 ] && [ "$pref" -le 32 ] || return 1
	_addr_ip="$ip"
	_addr_prefix="$pref"
}

openont_address_clear_fields() {
	local role="$1" o
	for o in ipaddr netmask gateway dns username password ipv6; do
		uci -q delete "network.$role.$o"
	done
}

openont_address_v6_companion() {
	local role="$1" v6
	v6=$(openont_role_v6 "$role")
	[ -e /proc/sys/net/ipv6 ] || return 0
	uci -q batch <<-EOF
		set network.$v6=interface
		set network.$v6.device='@$role'
		set network.$v6.proto='dhcpv6'
	EOF
}

openont_address_drop_v6() {
	uci -q delete "network.$(openont_role_v6 "$1")"
}

# stage_static <role> <ip[/cidr]> [gateway] [dns...]
openont_address_stage_static() {
	local role="$1" cidr_in="$2" gw="" dns="" a
	shift 2 2>/dev/null || true
	_openont_address_need_role "$role" || return 1
	openont_address_parse_cidr "$cidr_in" || { echo "invalid ip/cidr: $cidr_in" >&2; return 1; }
	# First extra argument is the gateway (may be empty), the rest are DNS.
	if [ "$#" -gt 0 ]; then
		gw="$1"
		shift
	fi
	[ -z "$gw" ] || openont_is_ipv4 "$gw" || { echo "invalid gateway: $gw" >&2; return 1; }
	for a in "$@"; do
		[ -n "$a" ] || continue
		openont_is_ipv4 "$a" || { echo "invalid dns: $a" >&2; return 1; }
		dns="$dns $a"
	done
	openont_address_clear_fields "$role"
	uci -q set "network.$role.proto=static"
	uci add_list "network.$role.ipaddr=$_addr_ip/$_addr_prefix"
	[ -n "$gw" ] && uci -q set "network.$role.gateway=$gw"
	for a in $dns; do
		uci add_list "network.$role.dns=$a"
	done
	if [ "$(openont_role_type "$role")" = "wan" ]; then
		openont_address_drop_v6 "$role"
	else
		openont_dhcp_dns_opt_refresh "$role"
	fi
	_addr_summary="$role $_addr_ip/$_addr_prefix${gw:+ gw=$gw}${dns:+ dns=$(echo $dns)}"
}

openont_address_stage_dhcp() {
	local role="$1"
	_openont_address_need_role "$role" || return 1
	[ "$(openont_role_type "$role")" = "wan" ] || {
		echo "dhcp client only for wan* (LAN stays static)" >&2
		return 1
	}
	openont_address_clear_fields "$role"
	uci -q set "network.$role.proto=dhcp"
	openont_address_v6_companion "$role"
}

# stage_pppoe <wanN> [username] [password] - empty keeps the stored value.
openont_address_stage_pppoe() {
	local role="$1" user="$2" pass="$3" old_user old_pass
	_openont_address_need_role "$role" || return 1
	[ "$(openont_role_type "$role")" = "wan" ] || { echo "pppoe only for wan*" >&2; return 1; }
	old_user=$(uci -q get "network.$role.username")
	old_pass=$(uci -q get "network.$role.password")
	[ -n "$user" ] || user="$old_user"
	[ -n "$pass" ] || pass="$old_pass"
	openont_address_clear_fields "$role"
	uci -q set "network.$role.proto=pppoe"
	[ -n "$user" ] && uci -q set "network.$role.username=$user"
	[ -n "$pass" ] && uci -q set "network.$role.password=$pass"
	# pppd brings up a dynamic <role>_6 DHCPv6 child itself.
	uci -q set "network.$role.ipv6=auto"
	openont_address_drop_v6 "$role"
}

# stage_proto <role> <dhcp|static|pppoe> - switch protocol, keeping what can be
# kept. static needs an address already on the role.
openont_address_stage_proto() {
	local role="$1" proto="$2" cidr
	case "$proto" in
		dhcp) openont_address_stage_dhcp "$role" ;;
		pppoe) openont_address_stage_pppoe "$role" ;;
		static)
			[ "$(uci -q get "network.$role.proto")" = "static" ] && return 0
			cidr=$(openont_role_cidr "$role") || {
				echo "static needs an address: openont-address set $role <ip/cidr> [gateway] [dns...]" >&2
				return 1
			}
			openont_address_stage_static "$role" "$cidr"
			;;
		*) echo "invalid proto: $proto" >&2; return 1 ;;
	esac
}

openont_address_commit() {
	uci commit network
	uci commit dhcp
	openont_reload_network
}

# set <role> <ip[/cidr]> [gateway] [dns...]
openont_address_set() {
	[ -n "$1" ] && [ -n "$2" ] || {
		echo "usage: openont-address set <lanN|wanN> <ip[/cidr]> [gateway] [dns...]" >&2
		return 1
	}
	openont_address_stage_static "$@" || return 1
	openont_address_commit
	echo "ok $_addr_summary"
}

openont_address_dhcp() {
	[ -n "$1" ] || { echo "usage: openont-address dhcp <wanN>" >&2; return 1; }
	openont_address_stage_dhcp "$1" || return 1
	openont_address_commit
	echo "ok $1 dhcp"
}

openont_address_pppoe() {
	[ -n "$1" ] || { echo "usage: openont-address pppoe <wanN> [username] [password]" >&2; return 1; }
	openont_address_stage_pppoe "$1" "$2" "$3" || return 1
	[ -n "$(uci -q get "network.$1.username")" ] || echo "warning: $1 has no PPPoE username yet" >&2
	openont_address_commit
	echo "ok $1 pppoe"
}

openont_address_status_json() {
	local role first=1 proto dev gw dns ip up user
	printf '{"roles":['
	for role in $(openont_role_list); do
		proto=$(uci -q get "network.$role.proto")
		dev=$(uci -q get "network.$role.device")
		gw=$(uci -q get "network.$role.gateway")
		dns=$(uci -q get "network.$role.dns" | xargs)
		ip=$(uci -q get "network.$role.ipaddr" | xargs)
		user=$(uci -q get "network.$role.username")
		up=false
		ubus call network.interface."$role" status 2>/dev/null | grep -q '"up": true' && up=true
		[ "$first" -eq 1 ] || printf ','
		first=0
		printf '{"name":"%s","proto":"%s","device":"%s","ipaddr":"%s","gateway":"%s","dns":"%s","username":"%s","up":%s}' \
			"$(openont_json_escape "$role")" "$(openont_json_escape "$proto")" \
			"$(openont_json_escape "$dev")" "$(openont_json_escape "$ip")" \
			"$(openont_json_escape "$gw")" "$(openont_json_escape "$dns")" \
			"$(openont_json_escape "$user")" "$up"
	done
	printf ']}\n'
}

openont_address_list() {
	local role proto dev gw dns ip
	printf "%-8s %-8s %-22s %-16s %-20s %s\n" "ROLE" "PROTO" "IP" "GATEWAY" "DNS" "DEVICE"
	for role in $(openont_role_list); do
		proto=$(uci -q get "network.$role.proto")
		dev=$(uci -q get "network.$role.device")
		gw=$(uci -q get "network.$role.gateway")
		dns=$(uci -q get "network.$role.dns" | xargs)
		ip=$(uci -q get "network.$role.ipaddr" | xargs)
		[ "$proto" = "pppoe" ] && ip="user=$(uci -q get "network.$role.username")"
		printf "%-8s %-8s %-22s %-16s %-20s %s\n" \
			"$role" "${proto:--}" "${ip:--}" "${gw:--}" "${dns:--}" "${dev:--}"
	done
}

# SPDX-License-Identifier: GPL-2.0-only
# IPv4 address binding for lanN / wanN roles.

. /usr/lib/openont/common.sh

openont_address_is_role() {
	echo "$1" | grep -qE '^(lan|wan)[0-9]+$'
}

openont_address_role_exists() {
	local role="$1"
	# Named interface section created by openont-port
	uci -q show "network.$role" 2>/dev/null | grep -q "network\.$role=interface"
}

openont_address_is_ipv4() {
	echo "$1" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || return 1
	local o IFS=.
	set -- $1
	for o in "$1" "$2" "$3" "$4"; do
		[ "$o" -ge 0 ] 2>/dev/null && [ "$o" -le 255 ] 2>/dev/null || return 1
	done
	return 0
}

# Parse a.b.c.d or a.b.c.d/nn into _addr_ip and _addr_prefix (default 24).
openont_address_parse_cidr() {
	local raw="$1"
	local ip pref
	_addr_ip=""
	_addr_prefix="24"
	case "$raw" in
		*/*)
			ip=${raw%/*}
			pref=${raw#*/}
			;;
		*)
			ip="$raw"
			pref="24"
			;;
	esac
	openont_address_is_ipv4 "$ip" || return 1
	case "$pref" in
		''|*[!0-9]*) return 1 ;;
	esac
	[ "$pref" -ge 0 ] && [ "$pref" -le 32 ] || return 1
	_addr_ip="$ip"
	_addr_prefix="$pref"
	return 0
}

openont_address_clear_static_fields() {
	local role="$1"
	uci -q delete "network.$role.ipaddr" 2>/dev/null || true
	uci -q delete "network.$role.netmask" 2>/dev/null || true
	uci -q delete "network.$role.gateway" 2>/dev/null || true
	uci -q delete "network.$role.dns" 2>/dev/null || true
	# legacy single options
	uci -q delete "network.$role.ip4table" 2>/dev/null || true
}

openont_address_set_ipaddr() {
	local role="$1"
	local cidr="$2"
	# Prefer list form used by openont-port LAN bind.
	uci -q delete "network.$role.ipaddr" 2>/dev/null || true
	uci -q delete "network.$role.netmask" 2>/dev/null || true
	uci add_list "network.$role.ipaddr=$cidr"
}

openont_address_ensure_wan6_dhcp() {
	local role="$1"
	[ -e /proc/sys/net/ipv6 ] || return 0
	uci -q batch <<-EOF
		delete network.${role}6
		set network.${role}6=interface
		set network.${role}6.device='@$role'
		set network.${role}6.proto='dhcpv6'
	EOF
}

openont_address_drop_wan6() {
	local role="$1"
	uci -q delete "network.${role}6" 2>/dev/null || true
}

# set <role> <ip[/cidr]> [gateway] [dns...]
openont_address_set() {
	local role="$1"
	local cidr_in="$2"
	shift 2 2>/dev/null || true
	local gw="" dns_list="" a

	[ -n "$role" ] && [ -n "$cidr_in" ] || {
		echo "usage: openont-address set <lanN|wanN> <ip[/cidr]> [gateway] [dns...]" >&2
		return 1
	}

	openont_address_is_role "$role" || { echo "invalid role: $role" >&2; return 1; }
	openont_address_role_exists "$role" || {
		echo "role not configured: $role (bind port first: openont-port set $role <eth...>)" >&2
		return 1
	}

	openont_address_parse_cidr "$cidr_in" || {
		echo "invalid ip/cidr: $cidr_in" >&2
		return 1
	}
	local cidr="${_addr_ip}/${_addr_prefix}"

	# remaining args: optional gateway, then DNS servers
	for a in "$@"; do
		[ -n "$a" ] || continue
		openont_address_is_ipv4 "$a" || { echo "invalid address: $a" >&2; return 1; }
		if [ -z "$gw" ]; then
			gw="$a"
		else
			dns_list="$dns_list $a"
		fi
	done
	dns_list=$(echo "$dns_list" | xargs)

	case "$role" in
		lan*)
			uci -q set "network.$role.proto=static"
			openont_address_clear_static_fields "$role"
			openont_address_set_ipaddr "$role" "$cidr"
			if [ -n "$gw" ]; then
				uci -q set "network.$role.gateway=$gw"
			fi
			if [ -n "$dns_list" ]; then
				for a in $dns_list; do
					uci add_list "network.$role.dns=$a"
				done
			fi
			;;
		wan*)
			uci -q set "network.$role.proto=static"
			openont_address_clear_static_fields "$role"
			# PPPoE options no longer apply
			uci -q delete "network.$role.username" 2>/dev/null || true
			uci -q delete "network.$role.password" 2>/dev/null || true
			openont_address_set_ipaddr "$role" "$cidr"
			if [ -n "$gw" ]; then
				uci -q set "network.$role.gateway=$gw"
			fi
			if [ -n "$dns_list" ]; then
				for a in $dns_list; do
					uci add_list "network.$role.dns=$a"
				done
			fi
			# static IPv4 only: drop companion dhcpv6 (same as port set static path intent)
			openont_address_drop_wan6 "$role"
			;;
	esac

	uci commit network
	openont_reload_network
	echo "ok $role $cidr${gw:+ gw=$gw}${dns_list:+ dns=$dns_list}"
	return 0
}

# dhcp <wanN> — switch WAN back to DHCP
openont_address_dhcp() {
	local role="$1"
	[ -n "$role" ] || { echo "usage: openont-address dhcp <wanN>" >&2; return 1; }
	openont_address_is_role "$role" || { echo "invalid role: $role" >&2; return 1; }
	case "$role" in
		wan*) ;;
		*)
			echo "dhcp only supported for wan* (LAN stays static; use set)" >&2
			return 1
			;;
	esac
	openont_address_role_exists "$role" || {
		echo "role not configured: $role (bind port first: openont-port set $role <eth...>)" >&2
		return 1
	}

	uci -q set "network.$role.proto=dhcp"
	openont_address_clear_static_fields "$role"
	uci -q delete "network.$role.username" 2>/dev/null || true
	uci -q delete "network.$role.password" 2>/dev/null || true
	openont_address_ensure_wan6_dhcp "$role"

	uci commit network
	openont_reload_network
	echo "ok $role dhcp"
	return 0
}

openont_address_ipaddrs() {
	local role="$1"
	# may be list or single
	uci -q get "network.$role.ipaddr" 2>/dev/null
}

openont_address_status_json() {
	local role first=1 proto dev gw dns ip up
	printf '{'
	printf '"roles":['
	for role in $(uci -q show network 2>/dev/null | sed -n "s/^network\.\(\(lan\|wan\)[0-9]*\)=interface/\1/p" | sort); do
		proto=$(uci -q get "network.$role.proto")
		dev=$(uci -q get "network.$role.device")
		gw=$(uci -q get "network.$role.gateway")
		dns=$(uci -q get "network.$role.dns" | xargs)
		ip=$(openont_address_ipaddrs "$role" | xargs)
		up=0
		ubus call network.interface."$role" status 2>/dev/null | grep -q '"up": true' && up=1
		[ "$first" -eq 1 ] || printf ','
		first=0
		printf '{"name":"%s","proto":"%s","device":"%s","ipaddr":"%s","gateway":"%s","dns":"%s","up":%s}' \
			"$(openont_json_escape "$role")" \
			"$(openont_json_escape "${proto:-}")" \
			"$(openont_json_escape "${dev:-}")" \
			"$(openont_json_escape "${ip:-}")" \
			"$(openont_json_escape "${gw:-}")" \
			"$(openont_json_escape "${dns:-}")" \
			"$up"
	done
	printf ']'
	printf '}\n'
}

openont_address_list() {
	local role proto dev gw dns ip
	printf "%-8s %-8s %-22s %-16s %-20s %s\n" "ROLE" "PROTO" "IP" "GATEWAY" "DNS" "DEVICE"
	for role in $(uci -q show network 2>/dev/null | sed -n "s/^network\.\(\(lan\|wan\)[0-9]*\)=interface/\1/p" | sort); do
		proto=$(uci -q get "network.$role.proto")
		dev=$(uci -q get "network.$role.device")
		gw=$(uci -q get "network.$role.gateway")
		dns=$(uci -q get "network.$role.dns" | xargs)
		ip=$(openont_address_ipaddrs "$role" | xargs)
		printf "%-8s %-8s %-22s %-16s %-20s %s\n" \
			"$role" "${proto:--}" "${ip:--}" "${gw:--}" "${dns:--}" "${dev:--}"
	done
}

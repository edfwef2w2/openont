# SPDX-License-Identifier: GPL-2.0-only
# DHCP server for lanN roles: address pools, static leases, lease table.
#
# Only writer of dhcp.<lanN> pool options (ignore/start/limit/leasetime) and
# dhcp.@host. Global dnsmasq options are left alone: DNS belongs to
# openont-dns, which also owns the "6,<lan ip>" dhcp_option entries.

[ -n "$OPENONT_DHCP_LOADED" ] && return 0
OPENONT_DHCP_LOADED=1

. /usr/lib/openont/role.sh

# Shared with openont-dns (dns.sh): present while openont-dns owns DNS.
OPENONT_DHCP_DNS_STAMP="/etc/openont/dns-dnsmasq.port"
OPENONT_DHCP_DNS_OPT6="/etc/openont/dns-dhcp-opt6"
OPENONT_DHCP_LEASES="${OPENONT_DHCP_LEASES:-/tmp/dhcp.leases}"

openont_dhcp_is_mac() {
	echo "$1" | grep -qE '^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$'
}

openont_dhcp_is_leasetime() {
	echo "$1" | grep -qE '^([0-9]+[smhdw]?|infinite)$'
}

# Drop this role's "6,<ip>" entries recorded by openont-dns.
_openont_dhcp_dns_opt_drop() {
	local role="$1" r opt tmp
	[ -f "$OPENONT_DHCP_DNS_OPT6" ] || return 0
	tmp="$OPENONT_DHCP_DNS_OPT6.tmp"
	: > "$tmp"
	while read -r r opt; do
		if [ "$r" = "$role" ]; then
			uci -q del_list "dhcp.$role.dhcp_option=$opt"
		else
			echo "$r $opt" >> "$tmp"
		fi
	done < "$OPENONT_DHCP_DNS_OPT6"
	mv "$tmp" "$OPENONT_DHCP_DNS_OPT6"
}

# Keep the advertised DNS server equal to the LAN address while openont-dns
# runs (dnsmasq is on port 0 then and would advertise nothing).
openont_dhcp_dns_opt_refresh() {
	local role="$1" cidr opt
	[ -f "$OPENONT_DHCP_DNS_STAMP" ] || return 0
	uci -q get "dhcp.$role" >/dev/null 2>&1 || return 0
	_openont_dhcp_dns_opt_drop "$role"
	cidr=$(openont_role_cidr "$role") || return 0
	opt="6,${cidr%/*}"
	uci -q add_list "dhcp.$role.dhcp_option=$opt"
	echo "$role $opt" >> "$OPENONT_DHCP_DNS_OPT6"
}

# Pool for a new LAN (keeps an existing section, re-enabling it).
openont_dhcp_pool_default() {
	local role="$1"
	if [ "$(uci -q get "dhcp.$role")" = "dhcp" ]; then
		uci -q delete "dhcp.$role.ignore"
	else
		uci -q batch <<-EOF
			set dhcp.$role=dhcp
			set dhcp.$role.interface='$role'
			set dhcp.$role.start='100'
			set dhcp.$role.limit='150'
			set dhcp.$role.leasetime='12h'
		EOF
	fi
	openont_dhcp_dns_opt_refresh "$role"
}

openont_dhcp_pool_del() {
	_openont_dhcp_dns_opt_drop "$1"
	uci -q delete "dhcp.$1"
}

# Host count of a prefix, minus network and broadcast.
_openont_dhcp_hosts() {
	local p="$1"
	[ "$p" -ge 31 ] && { echo 0; return; }
	echo $(( (1 << (32 - p)) - 2 ))
}

# stage_pool <lanN> <on|off> [start] [limit] [leasetime]
openont_dhcp_stage_pool() {
	local role="$1" en="$2" start="$3" limit="$4" lt="$5" cidr hosts
	openont_role_valid "$role" && [ "$(openont_role_type "$role")" = "lan" ] || {
		echo "dhcp pools exist only on lan roles: $role" >&2; return 1; }
	openont_role_exists "$role" || { echo "role not configured: $role" >&2; return 1; }
	[ "$(uci -q get "dhcp.$role")" = "dhcp" ] || openont_dhcp_pool_default "$role"
	case "$en" in
		1|on|true|yes) uci -q delete "dhcp.$role.ignore" ;;
		0|off|false|no) uci -q set "dhcp.$role.ignore=1" ;;
		*) echo "invalid state: $en (on|off)" >&2; return 1 ;;
	esac
	[ -n "$start" ] || start=$(uci -q get "dhcp.$role.start")
	[ -n "$limit" ] || limit=$(uci -q get "dhcp.$role.limit")
	[ -n "$lt" ] || lt=$(uci -q get "dhcp.$role.leasetime")
	start=${start:-100}; limit=${limit:-150}; lt=${lt:-12h}
	case "$start$limit" in *[!0-9]*) echo "start/limit must be numbers" >&2; return 1 ;; esac
	[ "$start" -ge 1 ] && [ "$limit" -ge 1 ] || { echo "start/limit must be >= 1" >&2; return 1; }
	openont_dhcp_is_leasetime "$lt" || { echo "invalid lease time: $lt (e.g. 12h, 30m, infinite)" >&2; return 1; }
	cidr=$(openont_role_cidr "$role") || { echo "$role has no IPv4 address" >&2; return 1; }
	hosts=$(_openont_dhcp_hosts "${cidr#*/}")
	[ $((start + limit - 1)) -le "$hosts" ] || {
		echo "range $start+$limit exceeds $cidr ($hosts usable addresses)" >&2; return 1; }
	uci -q batch <<-EOF
		set dhcp.$role.start='$start'
		set dhcp.$role.limit='$limit'
		set dhcp.$role.leasetime='$lt'
	EOF
}

openont_dhcp_pool() {
	openont_dhcp_stage_pool "$@" || return 1
	uci commit dhcp
	/etc/init.d/dnsmasq reload >/dev/null 2>&1
	echo "ok $1"
}

openont_dhcp_static_ids() {
	uci -q -X show dhcp 2>/dev/null | sed -n 's/^dhcp\.\([^.=]*\)=host$/\1/p'
}

# stage_static <id|""> <mac> <ip> [hostname] - prints the section id.
openont_dhcp_stage_static() {
	local id="$1" mac="$2" ip="$3" name="$4" sid other
	openont_dhcp_is_mac "$mac" || { echo "invalid MAC: $mac" >&2; return 1; }
	mac=$(echo "$mac" | tr 'A-F' 'a-f')
	openont_is_ipv4 "$ip" || { echo "invalid IP: $ip" >&2; return 1; }
	openont_lan_of_ip "$ip" >/dev/null || { echo "$ip is not inside any LAN subnet" >&2; return 1; }
	case "$name" in *[!A-Za-z0-9._-]*) echo "invalid hostname: $name" >&2; return 1 ;; esac
	if [ -n "$id" ]; then
		[ "$(uci -q get "dhcp.$id")" = "host" ] || { echo "no such static lease: $id" >&2; return 1; }
	fi
	for sid in $(openont_dhcp_static_ids); do
		[ "$sid" = "$id" ] && continue
		other=$(uci -q get "dhcp.$sid.mac" | tr 'A-F' 'a-f')
		[ "$other" = "$mac" ] && { echo "MAC $mac already has a static lease" >&2; return 1; }
		[ "$(uci -q get "dhcp.$sid.ip")" = "$ip" ] && { echo "IP $ip already assigned" >&2; return 1; }
	done
	[ -n "$id" ] || id=$(uci add dhcp host)
	uci -q batch <<-EOF
		set dhcp.$id.mac='$mac'
		set dhcp.$id.ip='$ip'
		delete dhcp.$id.name
	EOF
	[ -n "$name" ] && uci -q set "dhcp.$id.name=$name"
	echo "$id"
}

openont_dhcp_static_set() {
	local id
	id=$(openont_dhcp_stage_static "$@") || return 1
	uci commit dhcp
	/etc/init.d/dnsmasq reload >/dev/null 2>&1
	echo "ok $id"
}

openont_dhcp_static_del() {
	[ "$(uci -q get "dhcp.$1")" = "host" ] || { echo "no such static lease: $1" >&2; return 1; }
	uci -q delete "dhcp.$1"
	uci commit dhcp
	/etc/init.d/dnsmasq reload >/dev/null 2>&1
	echo "ok deleted $1"
}

# Before a LAN is removed: drop its pool and static leases inside its subnet.
# Sets _dhcp_removed to the number of static leases removed. No commit.
openont_dhcp_stage_role_cleanup() {
	local role="$1" cidr sid ip
	_dhcp_removed=0
	cidr=$(openont_role_cidr "$role") && for sid in $(openont_dhcp_static_ids); do
		ip=$(uci -q get "dhcp.$sid.ip")
		[ -n "$ip" ] && openont_is_ipv4 "$ip" || continue
		if openont_cidr_contains "$cidr" "$ip"; then
			uci -q delete "dhcp.$sid"
			_dhcp_removed=$((_dhcp_removed + 1))
		fi
	done
	openont_dhcp_pool_del "$role"
}

openont_dhcp_leases_json() {
	local now first=1 exp mac ip host rest remain role st
	now=$(date +%s)
	printf '{"leases":['
	[ -f "$OPENONT_DHCP_LEASES" ] && while read -r exp mac ip host rest; do
		[ -n "$ip" ] || continue
		openont_is_ipv4 "$ip" || continue
		[ "$host" = "*" ] && host=""
		if [ "$exp" = "0" ]; then remain=-1; else remain=$((exp - now)); [ "$remain" -lt 0 ] && remain=0; fi
		role=$(openont_lan_of_ip "$ip")
		st=false
		uci -q -X show dhcp 2>/dev/null | grep -qi "\.mac='$mac'" && st=true
		[ "$first" -eq 1 ] || printf ','
		first=0
		printf '{"ip":"%s","mac":"%s","hostname":"%s","remaining":%s,"role":"%s","static":%s}' \
			"$ip" "$(openont_json_escape "$mac")" "$(openont_json_escape "$host")" \
			"$remain" "$(openont_json_escape "$role")" "$st"
	done < "$OPENONT_DHCP_LEASES"
	printf ']}\n'
}

# Leases inside a CIDR.
_openont_dhcp_used() {
	local cidr="$1" n=0 exp mac ip rest
	[ -f "$OPENONT_DHCP_LEASES" ] || { echo 0; return; }
	while read -r exp mac ip rest; do
		openont_is_ipv4 "$ip" && openont_cidr_contains "$cidr" "$ip" && n=$((n + 1))
	done < "$OPENONT_DHCP_LEASES"
	echo "$n"
}

# Pool of one LAN as a JSON object.
openont_dhcp_pool_json() {
	local role="$1" cidr en start limit lt used rem net firstip lastip
	cidr=$(openont_role_cidr "$role") || cidr=""
	en=false; start=""; limit=""; lt=""; used=0; rem=0; firstip=""; lastip=""
	if [ "$(uci -q get "dhcp.$role")" = "dhcp" ]; then
		[ "$(uci -q get "dhcp.$role.ignore")" = "1" ] || en=true
		start=$(uci -q get "dhcp.$role.start"); start=${start:-100}
		limit=$(uci -q get "dhcp.$role.limit"); limit=${limit:-150}
		lt=$(uci -q get "dhcp.$role.leasetime"); lt=${lt:-12h}
	fi
	if [ -n "$cidr" ] && [ -n "$start" ]; then
		net=$(( $(openont_ip2int "${cidr%/*}") & $(openont_prefix2mask_int "${cidr#*/}") ))
		firstip=$(openont_int2ip $((net + start)))
		lastip=$(openont_int2ip $((net + start + limit - 1)))
		used=$(_openont_dhcp_used "$cidr")
		rem=$((limit - used)); [ "$rem" -lt 0 ] && rem=0
		[ "$en" = "true" ] || rem=0
	fi
	printf '{"role":"%s","cidr":"%s","enabled":%s,"start":"%s","limit":"%s","leasetime":"%s","first":"%s","last":"%s","used":%s,"remaining":%s}' \
		"$role" "$cidr" "$en" "$start" "$limit" "$(openont_json_escape "$lt")" \
		"$firstip" "$lastip" "$used" "$rem"
}

openont_dhcp_status_json() {
	local role first=1 sid ip
	printf '{"pools":['
	for role in $(openont_role_list lan); do
		[ "$first" -eq 1 ] || printf ','
		first=0
		openont_dhcp_pool_json "$role"
	done
	printf '],"static":['
	first=1
	for sid in $(openont_dhcp_static_ids); do
		ip=$(uci -q get "dhcp.$sid.ip")
		[ "$first" -eq 1 ] || printf ','
		first=0
		printf '{"id":"%s","name":"%s","mac":"%s","ip":"%s","role":"%s"}' \
			"$sid" "$(openont_json_escape "$(uci -q get "dhcp.$sid.name")")" \
			"$(openont_json_escape "$(uci -q get "dhcp.$sid.mac")")" \
			"$(openont_json_escape "$ip")" \
			"$(openont_is_ipv4 "$ip" && openont_lan_of_ip "$ip")"
	done
	printf ']}\n'
}

openont_dhcp_list() {
	local role en start limit lt sid
	printf "%-8s %-4s %-6s %-6s %s\n" "LAN" "ON" "START" "LIMIT" "LEASE"
	for role in $(openont_role_list lan); do
		en=on
		[ "$(uci -q get "dhcp.$role")" = "dhcp" ] || en=-
		[ "$(uci -q get "dhcp.$role.ignore")" = "1" ] && en=off
		start=$(uci -q get "dhcp.$role.start")
		limit=$(uci -q get "dhcp.$role.limit")
		lt=$(uci -q get "dhcp.$role.leasetime")
		printf "%-8s %-4s %-6s %-6s %s\n" "$role" "$en" "${start:--}" "${limit:--}" "${lt:--}"
	done
	echo
	echo "Static leases:"
	for sid in $(openont_dhcp_static_ids); do
		printf "  %-14s %-17s %-15s %s\n" "$sid" "$(uci -q get "dhcp.$sid.mac")" \
			"$(uci -q get "dhcp.$sid.ip")" "$(uci -q get "dhcp.$sid.name")"
	done
}

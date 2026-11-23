# SPDX-License-Identifier: GPL-2.0-only
# Role membership: create/delete lanN / wanN and bind physical ports.
#
# Only writer of network.<role>.device, the br-lanN bridge and the firewall
# zone membership. A role keeps its protocol/address (address.sh) and DHCP
# pool (dhcp.sh) when its ports change; defaults are written on creation only.

[ -n "$OPENONT_PORT_LOADED" ] && return 0
OPENONT_PORT_LOADED=1

. /usr/lib/openont/role.sh
. /usr/lib/openont/address.sh
. /usr/lib/openont/dhcp.sh

# --- firewall ---------------------------------------------------------------

openont_fw_zone_section() {
	local sid
	for sid in $(uci -q -X show firewall 2>/dev/null | sed -n 's/^firewall\.\([^.=]*\)=zone$/\1/p'); do
		[ "$(uci -q get "firewall.$sid.name")" = "$1" ] && { echo "$sid"; return 0; }
	done
	return 1
}

openont_fw_zone_create() {
	local zone="$1" sid
	sid=$(uci add firewall zone)
	uci -q batch <<-EOF
		set firewall.$sid.name='$zone'
		set firewall.$sid.input='ACCEPT'
		set firewall.$sid.output='ACCEPT'
		set firewall.$sid.forward='ACCEPT'
	EOF
	if [ "$zone" = "wan" ]; then
		uci -q batch <<-EOF
			set firewall.$sid.input='REJECT'
			set firewall.$sid.forward='REJECT'
			set firewall.$sid.masq='1'
			set firewall.$sid.mtu_fix='1'
		EOF
	fi
	echo "$sid"
}

openont_fw_lan_wan_forwarding() {
	local sid
	for sid in $(uci -q -X show firewall 2>/dev/null | sed -n 's/^firewall\.\([^.=]*\)=forwarding$/\1/p'); do
		[ "$(uci -q get "firewall.$sid.src")" = "lan" ] && \
			[ "$(uci -q get "firewall.$sid.dest")" = "wan" ] && return 0
	done
	sid=$(uci add firewall forwarding)
	uci -q batch <<-EOF
		set firewall.$sid.src='lan'
		set firewall.$sid.dest='wan'
	EOF
}

# openont_fw_zone_add <lan|wan> <network...>
openont_fw_zone_add() {
	local zone="$1" sid n
	shift
	sid=$(openont_fw_zone_section "$zone") || sid=$(openont_fw_zone_create "$zone")
	for n in "$@"; do
		uci -q get "firewall.$sid.network" | tr ' ' '\n' | grep -qx "$n" || \
			uci add_list "firewall.$sid.network=$n"
	done
	[ "$zone" = "wan" ] && openont_fw_lan_wan_forwarding
	return 0
}

openont_fw_zone_remove() {
	local zone="$1" sid n
	shift
	sid=$(openont_fw_zone_section "$zone") || return 0
	for n in "$@"; do
		uci -q del_list "firewall.$sid.network=$n"
	done
}

# --- bridge -----------------------------------------------------------------

openont_bridge_delete() {
	local sid
	sid=$(openont_device_section "$1") && uci -q delete "network.$sid"
	return 0
}

# Create or update bridge $1 with ports $2..; keeps the section (and any
# extra options on it).
openont_bridge_set() {
	local br="$1" sid p
	shift
	sid=$(openont_device_section "$br") || {
		sid=$(uci add network device)
		uci -q batch <<-EOF
			set network.$sid.name='$br'
			set network.$sid.type='bridge'
		EOF
	}
	uci -q delete "network.$sid.ports"
	for p in "$@"; do
		uci add_list "network.$sid.ports=$p"
	done
}

# --- defaults ---------------------------------------------------------------

# 192.168.<N>.1/24 for lanN, moving on while another LAN uses that /24.
openont_lan_default_cidr() {
	local role="$1" n other cidr taken
	n=$(openont_role_num "$role")
	[ "$n" -ge 1 ] 2>/dev/null || n=1
	while [ "$n" -le 254 ]; do
		taken=0
		for other in $(openont_role_list lan); do
			[ "$other" = "$role" ] && continue
			cidr=$(openont_role_cidr "$other") || continue
			openont_cidr_contains "$cidr" "192.168.$n.1" && taken=1
			openont_cidr_contains "192.168.$n.0/24" "${cidr%/*}" && taken=1
		done
		[ "$taken" -eq 0 ] && { echo "192.168.$n.1/24"; return 0; }
		n=$((n + 1))
	done
	echo "no free 192.168.x.0/24 for $role" >&2
	return 1
}

# --- commands ---------------------------------------------------------------

openont_port_commit() {
	uci commit network
	uci commit firewall
	uci commit dhcp
	openont_reload_network
}

# Validates netdevs for role $1; sets _port_list.
_openont_port_check() {
	local role="$1" a owner
	shift
	_port_list=""
	for a in "$@"; do
		openont_is_physical_netdev "$a" || { echo "not a physical port: $a" >&2; return 1; }
		owner=$(openont_netdev_owner "$a") || owner=""
		if [ -n "$owner" ] && [ "$owner" != "$role" ]; then
			echo "port $a already used by $owner" >&2
			return 1
		fi
		echo " $_port_list " | grep -q " $a " || _port_list="$_port_list $a"
	done
	_port_list=$(echo $_port_list)
	[ -n "$_port_list" ] || { echo "need at least one port" >&2; return 1; }
}

# stage_set <role> <eth...> [dhcp|pppoe|static] - no commit.
openont_port_stage_set() {
	local role="$1" proto="" ports="" a dev cidr created=0
	shift
	openont_role_valid "$role" || { echo "invalid role: $role (lanN or wanN)" >&2; return 1; }
	for a in "$@"; do
		case "$a" in
			dhcp|pppoe|static) proto="$a" ;;
			*) ports="$ports $a" ;;
		esac
	done
	_openont_port_check "$role" $ports || return 1
	ports="$_port_list"
	openont_role_exists "$role" || created=1

	case "$(openont_role_type "$role")" in
		lan)
			[ -z "$proto" ] || [ "$proto" = "static" ] || { echo "LAN is always static" >&2; return 1; }
			openont_bridge_set "$(openont_role_bridge "$role")" $ports
			if [ "$created" -eq 1 ]; then
				cidr=$(openont_lan_default_cidr "$role") || return 1
				uci -q batch <<-EOF
					set network.$role=interface
					set network.$role.proto='static'
					add_list network.$role.ipaddr='$cidr'
				EOF
				[ -e /proc/sys/net/ipv6 ] && uci -q set "network.$role.ip6assign=60"
			fi
			uci -q set "network.$role.device=$(openont_role_bridge "$role")"
			openont_fw_zone_add lan "$role"
			[ "$created" -eq 1 ] && openont_dhcp_pool_default "$role"
			;;
		wan)
			[ "$(echo "$ports" | wc -w)" -eq 1 ] || { echo "a WAN takes exactly one port" >&2; return 1; }
			dev=$(uci -q get "network.$role.device")
			case "$dev" in br-*) openont_bridge_delete "$dev" ;; esac
			if [ "$created" -eq 1 ]; then
				uci -q set "network.$role=interface"
				uci -q set "network.$role.device=$ports"
				openont_address_stage_proto "$role" "${proto:-dhcp}" || return 1
			else
				uci -q set "network.$role.device=$ports"
				[ -n "$proto" ] && { openont_address_stage_proto "$role" "$proto" || return 1; }
			fi
			openont_fw_zone_add wan "$role" "$(openont_role_v6 "$role")"
			;;
	esac
	_port_summary="$role $ports"
}

openont_port_set() {
	openont_port_stage_set "$@" || { uci revert network; uci revert firewall; uci revert dhcp; return 1; }
	openont_port_commit
	echo "ok $_port_summary"
}

# create <lan|wan> <eth...> [proto] - next free role name.
openont_port_create() {
	local role
	role=$(openont_role_next "$1") || { echo "type must be lan or wan" >&2; return 1; }
	shift
	openont_port_set "$role" "$@"
}

openont_port_add() {
	local role="$1" netdev="$2"
	openont_role_exists "$role" || { echo "role not configured: $role" >&2; return 1; }
	[ "$(openont_role_type "$role")" = "lan" ] || { echo "add only for lan roles; use set for wan" >&2; return 1; }
	openont_role_ports "$role" | tr ' ' '\n' | grep -qx "$netdev" && { echo "$netdev already in $role" >&2; return 1; }
	openont_port_set "$role" $(openont_role_ports "$role") "$netdev"
}

openont_port_del_port() {
	local role="$1" netdev="$2" new="" p
	openont_role_exists "$role" || { echo "role not configured: $role" >&2; return 1; }
	for p in $(openont_role_ports "$role"); do
		[ "$p" = "$netdev" ] || new="$new $p"
	done
	[ "$new" != " $(openont_role_ports "$role" | xargs)" ] || { echo "$netdev not in $role" >&2; return 1; }
	[ -n "$new" ] || { echo "cannot remove the last port; use: del $role" >&2; return 1; }
	openont_port_set "$role" $new
}

openont_port_del() {
	local role="$1" dev v6 msg=""
	openont_role_valid "$role" && openont_role_exists "$role" || { echo "role not configured: $role" >&2; return 1; }
	v6=$(openont_role_v6 "$role")
	dev=$(uci -q get "network.$role.device")
	case "$(openont_role_type "$role")" in
		lan)
			openont_dhcp_stage_role_cleanup "$role"
			[ "$_dhcp_removed" -gt 0 ] && msg=" (removed $_dhcp_removed static lease(s))"
			openont_fw_zone_remove lan "$role"
			;;
		wan) openont_fw_zone_remove wan "$role" "$v6" ;;
	esac
	case "$dev" in br-*) openont_bridge_delete "$dev" ;; esac
	uci -q delete "network.$role"
	uci -q delete "network.$v6"
	openont_port_commit
	echo "ok deleted $role$msg"
}

# [{"netdev","role","free","port":{link...}}, ...]
openont_port_physical_json() {
	local d role first=1 isfree
	printf '['
	for d in $(openont_list_physical); do
		role=$(openont_netdev_owner "$d") || role=""
		isfree=false
		[ -z "$role" ] && isfree=true
		[ "$first" -eq 1 ] || printf ','
		first=0
		printf '{"netdev":"%s","role":"%s","free":%s,"port":' \
			"$(openont_json_escape "$d")" "$(openont_json_escape "$role")" "$isfree"
		openont_netdev_link_json "$d"
		printf '}'
	done
	printf ']'
}

# [{link...}, ...] for the member ports of a role
openont_port_role_ports_json() {
	local p first=1
	printf '['
	for p in $(openont_role_ports "$1"); do
		[ "$first" -eq 1 ] || printf ','
		first=0
		openont_netdev_link_json "$p"
	done
	printf ']'
}

openont_port_stats_json() {
	local total free lan_n wan_n
	total=$(openont_list_physical | wc -l)
	free=0
	for d in $(openont_list_physical); do
		openont_netdev_owner "$d" >/dev/null || free=$((free + 1))
	done
	lan_n=$(openont_role_list lan | wc -l)
	wan_n=$(openont_role_list wan | wc -l)
	printf '{"total":%s,"free":%s,"lan":%s,"wan":%s}' $total $free $lan_n $wan_n
}

openont_port_status_json() {
	local role first=1
	printf '{"physical":'
	openont_port_physical_json
	printf ',"roles":['
	for role in $(openont_role_list); do
		[ "$first" -eq 1 ] || printf ','
		first=0
		printf '{"name":"%s","type":"%s","device":"%s","proto":"%s","ports":' \
			"$role" "$(openont_role_type "$role")" \
			"$(openont_json_escape "$(uci -q get "network.$role.device")")" \
			"$(openont_json_escape "$(uci -q get "network.$role.proto")")"
		openont_port_role_ports_json "$role"
		printf '}'
	done
	printf '],"stats":'
	openont_port_stats_json
	printf '}\n'
}

openont_port_list() {
	local d role p
	printf "%-10s %-12s %s\n" "PORT" "ROLE" "LINK"
	for d in $(openont_list_physical); do
		role=$(openont_netdev_owner "$d") || role="-"
		printf "%-10s %-12s %s\n" "$d" "$role" "$(openont_netdev_link "$d")"
	done
	echo
	echo "Roles:"
	for role in $(openont_role_list); do
		printf "  %-6s proto=%-7s ports=%s\n" "$role" \
			"$(uci -q get "network.$role.proto")" "$(openont_role_ports "$role" | xargs)"
	done
}

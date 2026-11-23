# SPDX-License-Identifier: GPL-2.0-only
# Single definition of OpenONT roles (lanN / wanN) and physical ports.
#
# A role is a network.<role>=interface section whose name matches
# (lan|wan)[0-9]+. Everything else (bridge name, IPv6 companion, member
# ports, owner of a netdev) is derived here; other libraries must not
# re-implement the lookup.

[ -n "$OPENONT_ROLE_LOADED" ] && return 0
OPENONT_ROLE_LOADED=1

. /usr/lib/openont/common.sh

openont_role_valid() {
	echo "$1" | grep -qE '^(lan|wan)[0-9]+$'
}

# lan1 -> lan
openont_role_type() {
	echo "${1%%[0-9]*}"
}

# lan12 -> 12
openont_role_num() {
	echo "${1#???}"
}

openont_role_exists() {
	[ "$(uci -q get "network.$1")" = "interface" ]
}

openont_role_bridge() {
	echo "br-$1"
}

# IPv6 companion interface of a WAN. Underscore keeps it outside the role
# pattern; it is also the name netifd gives the dynamic PPPoE IPv6 child.
openont_role_v6() {
	echo "${1}_6"
}

# openont_role_list [lan|wan] - roles sorted by type then number.
openont_role_list() {
	local want="$1" s dev
	for s in $(uci -q show network 2>/dev/null | sed -n 's/^network\.\([^.=]*\)=interface$/\1/p'); do
		openont_role_valid "$s" || continue
		case "$want" in
			''|"$(openont_role_type "$s")") ;;
			*) continue ;;
		esac
		# A legacy wanN6 companion (device '@wanN') is not a role.
		dev=$(uci -q get "network.$s.device")
		case "$dev" in @*) continue ;; esac
		printf '%s %s\n' "$(openont_role_type "$s")" "$(openont_role_num "$s")"
	done | sort -k1,1 -k2,2n | while read -r t n; do
		echo "$t$n"
	done
}

# openont_role_next <lan|wan> - first unused role name of that type.
openont_role_next() {
	local t="$1" n=1
	case "$t" in lan|wan) ;; *) return 1 ;; esac
	while uci -q get "network.$t$n" >/dev/null 2>&1; do
		n=$((n + 1))
	done
	echo "$t$n"
}

# Section id (cfgXXXX or name) of the network device with option name=$1.
openont_device_section() {
	local want="$1" sid
	for sid in $(uci -q -X show network 2>/dev/null | sed -n "s/^network\.\([^.]*\)\.name='\{0,1\}$want'\{0,1\}$/\1/p"); do
		[ "$(uci -q get "network.$sid")" = "device" ] && { echo "$sid"; return 0; }
	done
	return 1
}

openont_bridge_sections() {
	local sid
	for sid in $(uci -q -X show network 2>/dev/null | sed -n 's/^network\.\([^.=]*\)=device$/\1/p'); do
		[ "$(uci -q get "network.$sid.type")" = "bridge" ] && echo "$sid"
	done
}

# Member netdevs of a role (bridge ports for LAN, the device for WAN).
openont_role_ports() {
	local role="$1" dev sid
	dev=$(uci -q get "network.$role.device")
	[ -n "$dev" ] || return 0
	case "$dev" in
		br-*)
			sid=$(openont_device_section "$dev") || return 0
			uci -q get "network.$sid.ports"
			;;
		@*) ;;
		*) echo "$dev" ;;
	esac
}

# Prints the role using netdev $1; for a bridge outside any role, prints the
# bridge name. Returns 1 when the netdev is free.
openont_netdev_owner() {
	local want="$1" role p sid
	for role in $(openont_role_list); do
		for p in $(openont_role_ports "$role"); do
			[ "$p" = "$want" ] && { echo "$role"; return 0; }
		done
	done
	for sid in $(openont_bridge_sections); do
		for p in $(uci -q get "network.$sid.ports"); do
			[ "$p" = "$want" ] && { uci -q get "network.$sid.name"; return 0; }
		done
	done
	return 1
}

openont_is_wireless_netdev() {
	local dev="$1"
	case "$dev" in
		wlan*|phy*|wifi*|ra[0-9]*|rai*|rax*|apcli*|wds*|p2p*|awdl*|anpi*)
			return 0
			;;
	esac
	[ -d "/sys/class/net/$dev/wireless" ] && return 0
	[ -e "/sys/class/net/$dev/phy80211" ] && return 0
	return 1
}

openont_is_physical_netdev() {
	local dev="$1"
	[ -n "$dev" ] || return 1
	[ -d "/sys/class/net/$dev" ] || return 1
	openont_is_wireless_netdev "$dev" && return 1
	case "$dev" in
		lo|br-*|ifb*|teql*|gre*|gretap*|erspan*|sit*|tun*|tap*|veth*|docker*|virbr*|wg*|pppoe-*|pppoa-*)
			return 1
			;;
	esac
	[ -e "/sys/class/net/$dev/device" ] && return 0
	case "$dev" in
		eth*|en*|em*|p[0-9]*) return 0 ;;
	esac
	return 1
}

openont_list_physical() {
	local d
	for d in /sys/class/net/*; do
		d=${d##*/}
		openont_is_physical_netdev "$d" && echo "$d"
	done | sort -u
}

openont_netdev_link() {
	grep -qx up "/sys/class/net/$1/operstate" 2>/dev/null && echo up || echo down
}

openont_netdev_link_json() {
	local dev="$1" link speed="" duplex="" mac=""
	link=$(openont_netdev_link "$dev")
	if [ -d "/sys/class/net/$dev" ]; then
		mac=$(cat "/sys/class/net/$dev/address" 2>/dev/null)
		speed=$(cat "/sys/class/net/$dev/speed" 2>/dev/null)
		[ "$speed" = "-1" ] && speed=""
		duplex=$(cat "/sys/class/net/$dev/duplex" 2>/dev/null)
	fi
	printf '{"name":"%s","link":"%s","speed":"%s","duplex":"%s","mac":"%s"}' \
		"$(openont_json_escape "$dev")" "$link" "$(openont_json_escape "$speed")" \
		"$(openont_json_escape "$duplex")" "$(openont_json_escape "$mac")"
}

# --- IPv4 helpers -----------------------------------------------------------

openont_is_ipv4() {
	echo "$1" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || return 1
	local o IFS=.
	set -- $1
	for o in "$1" "$2" "$3" "$4"; do
		[ "$o" -le 255 ] 2>/dev/null || return 1
	done
	return 0
}

openont_ip2int() {
	local IFS=.
	set -- $1
	echo $(( ($1 << 24) + ($2 << 16) + ($3 << 8) + $4 ))
}

openont_int2ip() {
	local n="$1"
	echo "$(( (n >> 24) & 255 )).$(( (n >> 16) & 255 )).$(( (n >> 8) & 255 )).$(( n & 255 ))"
}

openont_mask2prefix() {
	local n bits=0
	n=$(openont_ip2int "$1")
	while [ $((n & 0x80000000)) -ne 0 ]; do
		bits=$((bits + 1))
		n=$(( (n << 1) & 0xffffffff ))
	done
	echo "$bits"
}

openont_prefix2mask_int() {
	[ "$1" -eq 0 ] && { echo 0; return; }
	echo $(( (0xffffffff << (32 - $1)) & 0xffffffff ))
}

# Primary IPv4 of a role as ip/prefix (handles list ipaddr and ipaddr+netmask).
openont_role_cidr() {
	local role="$1" ip mask
	ip=$(uci -q get "network.$role.ipaddr" | awk '{print $1}')
	[ -n "$ip" ] || return 1
	case "$ip" in
		*/*) echo "$ip" ;;
		*)
			mask=$(uci -q get "network.$role.netmask")
			if [ -n "$mask" ]; then
				echo "$ip/$(openont_mask2prefix "$mask")"
			else
				echo "$ip/24"
			fi
			;;
	esac
}

# openont_cidr_contains <ip/prefix> <ip>
openont_cidr_contains() {
	local net="${1%/*}" pre="${1#*/}" m
	m=$(openont_prefix2mask_int "$pre")
	[ $(( $(openont_ip2int "$net") & m )) -eq $(( $(openont_ip2int "$2") & m )) ]
}

# The LAN role whose subnet holds IP $1.
openont_lan_of_ip() {
	local role cidr
	for role in $(openont_role_list lan); do
		cidr=$(openont_role_cidr "$role") || continue
		openont_cidr_contains "$cidr" "$1" && { echo "$role"; return 0; }
	done
	return 1
}

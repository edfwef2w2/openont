# SPDX-License-Identifier: GPL-2.0-only
# Port role binding (lanN/wanN), multi-eth bridge for LAN.

. /usr/lib/openont/common.sh

LAN_IP="${OPENONT_LAN_IP:-192.168.1.1}"
LAN_PREFIX="${OPENONT_LAN_PREFIX:-24}"

openont_is_role() {
	echo "$1" | grep -qE '^(lan|wan)[0-9]+$'
}

openont_is_physical_netdev() {
	local dev="$1"
	[ -n "$dev" ] || return 1
	[ -d "/sys/class/net/$dev" ] || return 1
	case "$dev" in
		lo|br-*|wlan*|phy*|ifb*|teql*|gre*|gretap*|erspan*|sit*|tun*|tap*|veth*|docker*|virbr*|wg*|pppoe-*|pppoa-*)
			return 1
			;;
	esac
	if [ -e "/sys/class/net/$dev/device" ]; then
		return 0
	fi
	case "$dev" in
		eth*|en*|ens*|enp*|eno*|em*|p[0-9]*) return 0 ;;
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

# Returns role using this netdev (as port of bridge or direct device)
openont_netdev_owner() {
	local want="$1"
	local s dev br name ports p
	# direct device match
	for s in $(uci -q show network 2>/dev/null | sed -n "s/^network\.\(\(lan\|wan\)[0-9]*\)=interface/\1/p"); do
		dev=$(uci -q get "network.$s.device")
		[ "$dev" = "$want" ] && { echo "$s"; return 0; }
		case "$dev" in
			br-lan*|br-wan*)
				# check bridge ports
				;;
		esac
	done
	# bridge ports in network.@device
	local i=0
	while uci -q get "network.@device[$i]" >/dev/null 2>&1; do
		name=$(uci -q get "network.@device[$i].name")
		type=$(uci -q get "network.@device[$i].type")
		if [ "$type" = "bridge" ]; then
			ports=$(uci -q get "network.@device[$i].ports")
			for p in $ports; do
				if [ "$p" = "$want" ]; then
					# find interface using this bridge
					for s in $(uci -q show network | sed -n "s/^network\.\(\(lan\|wan\)[0-9]*\)=interface/\1/p"); do
						dev=$(uci -q get "network.$s.device")
						[ "$dev" = "$name" ] && { echo "$s"; return 0; }
					done
					echo "$name"
					return 0
				fi
			done
		fi
		i=$((i + 1))
	done
	return 1
}

openont_role_ports() {
	local role="$1"
	local dev name i ports
	dev=$(uci -q get "network.$role.device")
	[ -n "$dev" ] || return 0
	case "$dev" in
		br-*)
			i=0
			while uci -q get "network.@device[$i]" >/dev/null 2>&1; do
				name=$(uci -q get "network.@device[$i].name")
				if [ "$name" = "$dev" ]; then
					uci -q get "network.@device[$i].ports"
					return 0
				fi
				i=$((i + 1))
			done
			;;
		*)
			echo "$dev"
			;;
	esac
}

openont_netdev_link_json() {
	local dev="$1"
	local link="down" speed="" duplex="" mac=""
	if [ -d "/sys/class/net/$dev" ]; then
		mac=$(cat "/sys/class/net/$dev/address" 2>/dev/null)
		if [ -f "/sys/class/net/$dev/operstate" ] && grep -qx up "/sys/class/net/$dev/operstate"; then
			link="up"
		fi
		[ -f "/sys/class/net/$dev/speed" ] && speed=$(cat "/sys/class/net/$dev/speed" 2>/dev/null)
		[ "$speed" = "-1" ] && speed=""
		[ -f "/sys/class/net/$dev/duplex" ] && duplex=$(cat "/sys/class/net/$dev/duplex" 2>/dev/null)
	fi
	printf '{"name":"%s","link":"%s","speed":"%s","duplex":"%s","mac":"%s"}' \
		"$(openont_json_escape "$dev")" "$link" "$(openont_json_escape "$speed")" \
		"$(openont_json_escape "$duplex")" "$(openont_json_escape "$mac")"
}

openont_ensure_fw_zone() {
	local zone="$1"
	local role="$2"
	local i=0 name found=0
	while uci -q get "firewall.@zone[$i]" >/dev/null 2>&1; do
		name=$(uci -q get "firewall.@zone[$i].name")
		if [ "$name" = "$zone" ]; then
			found=1
			break
		fi
		i=$((i + 1))
	done
	if [ "$found" -eq 0 ]; then
		uci -q batch <<-EOF
			add firewall zone
			set firewall.@zone[-1].name='$zone'
			set firewall.@zone[-1].input='ACCEPT'
			set firewall.@zone[-1].output='ACCEPT'
			set firewall.@zone[-1].forward='ACCEPT'
		EOF
		if [ "$zone" = "wan" ]; then
			uci -q batch <<-EOF
				set firewall.@zone[-1].input='REJECT'
				set firewall.@zone[-1].forward='REJECT'
				set firewall.@zone[-1].masq='1'
				set firewall.@zone[-1].mtu_fix='1'
			EOF
		fi
		i=0
		while uci -q get "firewall.@zone[$i]" >/dev/null 2>&1; do
			name=$(uci -q get "firewall.@zone[$i].name")
			[ "$name" = "$zone" ] && break
			i=$((i + 1))
		done
	fi
	local has=0 n
	for n in $(uci -q get "firewall.@zone[$i].network" 2>/dev/null); do
		[ "$n" = "$role" ] && has=1
	done
	[ "$has" -eq 0 ] && uci add_list "firewall.@zone[$i].network=$role"

	if [ "$zone" = "wan" ]; then
		local fi=0 fwd_ok=0 src dest
		while uci -q get "firewall.@forwarding[$fi]" >/dev/null 2>&1; do
			src=$(uci -q get "firewall.@forwarding[$fi].src")
			dest=$(uci -q get "firewall.@forwarding[$fi].dest")
			[ "$src" = "lan" ] && [ "$dest" = "wan" ] && fwd_ok=1
			fi=$((fi + 1))
		done
		if [ "$fwd_ok" -eq 0 ]; then
			uci -q batch <<-EOF
				add firewall forwarding
				set firewall.@forwarding[-1].src='lan'
				set firewall.@forwarding[-1].dest='wan'
			EOF
		fi
	fi
}

openont_fw_zone_remove() {
	local zone="$1"
	local role="$2"
	local i=0 name
	while uci -q get "firewall.@zone[$i]" >/dev/null 2>&1; do
		name=$(uci -q get "firewall.@zone[$i].name")
		if [ "$name" = "$zone" ]; then
			uci -q del_list "firewall.@zone[$i].network=$role" 2>/dev/null
			break
		fi
		i=$((i + 1))
	done
}

openont_dhcp_lan() {
	local role="$1"
	if uci -q get "dhcp.$role" >/dev/null 2>&1; then
		uci -q set "dhcp.$role.ignore=0"
	else
		uci -q batch <<-EOF
			set dhcp.$role=dhcp
			set dhcp.$role.interface='$role'
			set dhcp.$role.start='100'
			set dhcp.$role.limit='150'
			set dhcp.$role.leasetime='12h'
		EOF
	fi
}

openont_dhcp_del() {
	uci -q delete "dhcp.$1" 2>/dev/null
}

openont_delete_bridge_device() {
	local brname="$1"
	local i=0 name
	while uci -q get "network.@device[$i]" >/dev/null 2>&1; do
		name=$(uci -q get "network.@device[$i].name")
		if [ "$name" = "$brname" ]; then
			uci -q delete "network.@device[$i]"
			return 0
		fi
		i=$((i + 1))
	done
}

openont_set_bridge() {
	local brname="$1"
	shift
	local ports="$*"
	local p
	openont_delete_bridge_device "$brname"
	uci -q batch <<-EOF
		add network device
		set network.@device[-1].name='$brname'
		set network.@device[-1].type='bridge'
	EOF
	for p in $ports; do
		uci add_list "network.@device[-1].ports=$p"
	done
}

# set lanN eth0 [eth1 ...] [or for wan: wanN eth0 [proto]]
openont_port_set() {
	local role="$1"
	shift
	local args="$*"
	local ports="" proto="dhcp" a owner brname ipaddr

	openont_is_role "$role" || { echo "invalid role: $role" >&2; return 1; }

	case "$role" in
		lan*)
			for a in $args; do
				case "$a" in
					*.*.*.*|/*) ipaddr="$a" ;; # optional ip/cidr later
					*)
						openont_is_physical_netdev "$a" || { echo "invalid netdev: $a" >&2; return 1; }
						owner=$(openont_netdev_owner "$a" || true)
						if [ -n "$owner" ] && [ "$owner" != "$role" ] && [ "$owner" != "br-$role" ]; then
							echo "netdev $a already used by $owner" >&2
							return 1
						fi
						ports="$ports $a"
						;;
				esac
			done
			ports=$(echo "$ports" | xargs)
			[ -n "$ports" ] || { echo "need at least one netdev" >&2; return 1; }

			brname="br-$role"
			openont_set_bridge "$brname" $ports
			uci -q batch <<-EOF
				delete network.$role
				set network.$role=interface
				set network.$role.device='$brname'
				set network.$role.proto='static'
				del_list network.$role.ipaddr
				add_list network.$role.ipaddr='${ipaddr:-$LAN_IP/$LAN_PREFIX}'
			EOF
			[ -e /proc/sys/net/ipv6 ] && uci -q set "network.$role.ip6assign=60"
			openont_ensure_fw_zone lan "$role"
			openont_dhcp_lan "$role"
			;;
		wan*)
			# set wan1 eth0 [dhcp|pppoe|static]
			local netdev=""
			for a in $args; do
				case "$a" in
					dhcp|pppoe|static) proto="$a" ;;
					*)
						if openont_is_physical_netdev "$a"; then
							netdev="$a"
						fi
						;;
				esac
			done
			[ -n "$netdev" ] || { echo "need netdev" >&2; return 1; }
			owner=$(openont_netdev_owner "$netdev" || true)
			if [ -n "$owner" ] && [ "$owner" != "$role" ]; then
				echo "netdev $netdev already used by $owner" >&2
				return 1
			fi
			# remove old bridge if any
			dev=$(uci -q get "network.$role.device")
			case "$dev" in br-*) openont_delete_bridge_device "$dev" ;; esac

			uci -q batch <<-EOF
				delete network.$role
				set network.$role=interface
				set network.$role.device='$netdev'
				set network.$role.proto='$proto'
			EOF
			if [ "$proto" = "pppoe" ]; then
				uci -q set "network.$role.username=${OPENONT_PPPOE_USER:-username}"
				uci -q set "network.$role.password=${OPENONT_PPPOE_PASS:-password}"
				uci -q set "network.$role.ipv6=auto"
			fi
			if [ -e /proc/sys/net/ipv6 ] && [ "$proto" != "static" ]; then
				uci -q batch <<-EOF
					delete network.${role}6
					set network.${role}6=interface
					set network.${role}6.device='@$role'
					set network.${role}6.proto='dhcpv6'
				EOF
			fi
			openont_ensure_fw_zone wan "$role"
			openont_dhcp_del "$role"
			;;
	esac

	uci commit network
	uci commit firewall
	uci commit dhcp 2>/dev/null
	openont_reload_network
	echo "ok $role"
	return 0
}

openont_port_add() {
	local role="$1"
	local netdev="$2"
	local ports owner brname
	openont_is_role "$role" || return 1
	case "$role" in lan*) ;; *) echo "add only for lan*" >&2; return 1 ;; esac
	openont_is_physical_netdev "$netdev" || return 1
	owner=$(openont_netdev_owner "$netdev" || true)
	[ -z "$owner" ] || [ "$owner" = "$role" ] || { echo "busy: $owner" >&2; return 1; }
	ports=$(openont_role_ports "$role")
	echo "$ports" | grep -qw "$netdev" && { echo "already member" >&2; return 1; }
	ports=$(echo "$ports $netdev" | xargs)
	openont_port_set "$role" $ports
}

openont_port_del_port() {
	local role="$1"
	local netdev="$2"
	local ports new="" p
	openont_is_role "$role" || return 1
	ports=$(openont_role_ports "$role")
	for p in $ports; do
		[ "$p" = "$netdev" ] && continue
		new="$new $p"
	done
	new=$(echo "$new" | xargs)
	[ -n "$new" ] || { echo "cannot remove last port; use del $role" >&2; return 1; }
	openont_port_set "$role" $new
}

openont_port_del() {
	local role="$1"
	local dev
	openont_is_role "$role" || return 1
	dev=$(uci -q get "network.$role.device")
	case "$dev" in br-*) openont_delete_bridge_device "$dev" ;; esac
	uci -q delete "network.$role"
	uci -q delete "network.${role}6" 2>/dev/null
	case "$role" in
		lan*) openont_fw_zone_remove lan "$role"; openont_dhcp_del "$role" ;;
		wan*) openont_fw_zone_remove wan "$role" ;;
	esac
	uci commit network
	uci commit firewall
	uci commit dhcp 2>/dev/null
	openont_reload_network
	echo "ok deleted $role"
}

openont_port_status_json() {
	local d role ports p first total=0 free=0 lan_n=0 wan_n=0
	printf '{'
	printf '"physical":['
	first=1
	for d in $(openont_list_physical); do
		total=$((total + 1))
		role=$(openont_netdev_owner "$d" || true)
		case "$role" in
			br-lan*|br-wan*) role=${role#br-} ;;
		esac
		[ -z "$role" ] && free=$((free + 1))
		link="down"; speed=""; duplex=""; mac=""
		if [ -d "/sys/class/net/$d" ]; then
			mac=$(cat "/sys/class/net/$d/address" 2>/dev/null)
			grep -qx up "/sys/class/net/$d/operstate" 2>/dev/null && link="up"
			[ -f "/sys/class/net/$d/speed" ] && speed=$(cat "/sys/class/net/$d/speed" 2>/dev/null)
			[ "$speed" = "-1" ] && speed=""
			[ -f "/sys/class/net/$d/duplex" ] && duplex=$(cat "/sys/class/net/$d/duplex" 2>/dev/null)
		fi
		[ "$first" -eq 1 ] || printf ','
		first=0
		printf '{"netdev":"%s","role":"%s","free":%s,"link":"%s","speed":"%s","duplex":"%s","mac":"%s"}' \
			"$(openont_json_escape "$d")" "$(openont_json_escape "${role:-}")" \
			"$([ -z "$role" ] && echo true || echo false)" \
			"$link" "$(openont_json_escape "$speed")" "$(openont_json_escape "$duplex")" \
			"$(openont_json_escape "$mac")"
	done
	printf '],'
	printf '"roles":['
	first=1
	for role in $(uci -q show network 2>/dev/null | sed -n "s/^network\.\(\(lan\|wan\)[0-9]*\)=interface/\1/p" | sort); do
		case "$role" in lan*) lan_n=$((lan_n + 1)) ;; wan*) wan_n=$((wan_n + 1)) ;; esac
		[ "$first" -eq 1 ] || printf ','
		first=0
		dev=$(uci -q get "network.$role.device")
		proto=$(uci -q get "network.$role.proto")
		ports=$(openont_role_ports "$role")
		printf '{"name":"%s","device":"%s","proto":"%s","ports":[' \
			"$(openont_json_escape "$role")" "$(openont_json_escape "$dev")" "$(openont_json_escape "$proto")"
		local pf=1
		for p in $ports; do
			[ "$pf" -eq 1 ] || printf ','
			pf=0
			openont_netdev_link_json "$p"
		done
		printf ']}'
	done
	printf '],'
	printf '"stats":{"total":%s,"free":%s,"lan":%s,"wan":%s}' "$total" "$free" "$lan_n" "$wan_n"
	printf '}\n'
}

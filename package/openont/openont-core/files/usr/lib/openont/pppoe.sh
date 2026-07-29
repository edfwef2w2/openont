# SPDX-License-Identifier: GPL-2.0-only
# PPPoE dial / hangup / redial and status for wan* interfaces.

. /usr/lib/openont/common.sh

openont_pppoe_list_ifaces() {
	local s proto
	for s in $(uci -q show network 2>/dev/null | sed -n "s/^network\.\([^=]*\)=interface/\1/p"); do
		proto=$(uci -q get "network.$s.proto")
		[ "$proto" = "pppoe" ] && echo "$s"
	done | sort
}

openont_pppoe_iface_json() {
	local name="$1"
	local proto device username st up pending ipv4 l3 uptime err
	proto=$(uci -q get "network.$name.proto")
	device=$(uci -q get "network.$name.device")
	username=$(uci -q get "network.$name.username")
	up=false
	pending=false
	ipv4=""
	l3=""
	uptime=0
	err=""

	st=$(ubus call network.interface."$name" status 2>/dev/null)
	if [ -n "$st" ]; then
		echo "$st" | grep -q '"up": true' && up=true
		echo "$st" | grep -q '"pending": true' && pending=true
		ipv4=$(echo "$st" | jsonfilter -e '@["ipv4-address"][0].address' 2>/dev/null)
		l3=$(echo "$st" | jsonfilter -e '@["l3_device"]' 2>/dev/null)
		uptime=$(echo "$st" | jsonfilter -e '@["uptime"]' 2>/dev/null)
		[ -n "$uptime" ] || uptime=0
		err=$(echo "$st" | jsonfilter -e '@["errors"][0]' 2>/dev/null)
		[ -n "$err" ] || err=$(echo "$st" | jsonfilter -e '@.errors[0].code' 2>/dev/null)
	fi

	printf '{"name":"%s","proto":"%s","device":"%s","username":"%s","up":%s,"pending":%s,"ipv4":"%s","l3_device":"%s","uptime":%s,"error":"%s"}' \
		"$(openont_json_escape "$name")" \
		"$(openont_json_escape "${proto:-}")" \
		"$(openont_json_escape "${device:-}")" \
		"$(openont_json_escape "${username:-}")" \
		"$up" "$pending" \
		"$(openont_json_escape "${ipv4:-}")" \
		"$(openont_json_escape "${l3:-}")" \
		"${uptime:-0}" \
		"$(openont_json_escape "${err:-}")"
}

openont_pppoe_status_json() {
	local filter="$1"
	local first=1 n
	printf '{"interfaces":['
	for n in $(openont_pppoe_list_ifaces); do
		if [ -n "$filter" ] && [ "$n" != "$filter" ]; then
			continue
		fi
		[ "$first" -eq 1 ] || printf ','
		first=0
		openont_pppoe_iface_json "$n"
	done
	printf ']}\n'
}

openont_pppoe_ensure() {
	local name="$1"
	local proto
	proto=$(uci -q get "network.$name.proto")
	[ "$proto" = "pppoe" ] || {
		echo "interface $name is not pppoe" >&2
		return 1
	}
	return 0
}

openont_pppoe_hangup() {
	local name="$1"
	[ -n "$name" ] || { echo "need iface" >&2; return 1; }
	openont_pppoe_ensure "$name" || return 1
	ifdown "$name" 2>/dev/null || ubus call network.interface."$name" down 2>/dev/null || true
	echo "ok hangup $name"
	return 0
}

openont_pppoe_dial() {
	local name="$1"
	[ -n "$name" ] || { echo "need iface" >&2; return 1; }
	openont_pppoe_ensure "$name" || return 1
	ifup "$name" 2>/dev/null || ubus call network.interface."$name" up 2>/dev/null || {
		echo "ifup failed for $name" >&2
		return 1
	}
	echo "ok dial $name"
	return 0
}

openont_pppoe_redial() {
	local name="$1"
	openont_pppoe_hangup "$name" || return 1
	sleep 1
	openont_pppoe_dial "$name"
}

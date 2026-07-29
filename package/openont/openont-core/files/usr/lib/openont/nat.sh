# SPDX-License-Identifier: GPL-2.0-only
# Port mapping and DMZ via firewall redirect sections.

. /usr/lib/openont/common.sh

openont_nat_find_index_by_name() {
	local want="$1"
	local i=0 n
	while uci -q get "firewall.@redirect[$i]" >/dev/null 2>&1; do
		n=$(uci -q get "firewall.@redirect[$i].name")
		[ "$n" = "$want" ] && { echo "$i"; return 0; }
		i=$((i + 1))
	done
	return 1
}

openont_nat_clear_src_ip() {
	local idx="$1"
	uci -q delete "firewall.@redirect[$idx].src_ip" 2>/dev/null
}

openont_nat_apply_group() {
	local idx="$1"
	local gid="$2"
	local e
	openont_nat_clear_src_ip "$idx"
	if [ -z "$gid" ] || [ "$gid" = "any" ]; then
		uci -q delete "firewall.@redirect[$idx].openont_src_group" 2>/dev/null
		return 0
	fi
	uci -q set "firewall.@redirect[$idx].openont_src_group=$gid"
	. /usr/lib/openont/ipgroup.sh
	for e in $(openont_ipgroup_get_entries "$gid"); do
		uci add_list "firewall.@redirect[$idx].src_ip=$e"
	done
}

openont_nat_reexpand_group() {
	local gid="$1"
	local i=0 g
	while uci -q get "firewall.@redirect[$i]" >/dev/null 2>&1; do
		g=$(uci -q get "firewall.@redirect[$i].openont_src_group")
		if [ "$g" = "$gid" ]; then
			openont_nat_apply_group "$i" "$gid"
		fi
		i=$((i + 1))
	done
	uci commit firewall
	openont_reload_firewall
}

openont_nat_portmap_add() {
	# args via env or positional:
	# name dest_ip dest_port proto src_dport [src_group] [enabled]
	local name="$1" dest_ip="$2" dest_port="$3" proto="$4" src_dport="$5"
	local src_group="${6:-}"
	local enabled="${7:-1}"
	local idx

	[ -n "$dest_ip" ] && [ -n "$dest_port" ] && [ -n "$src_dport" ] || {
		echo "need dest_ip dest_port src_dport" >&2
		return 1
	}
	proto="${proto:-tcp}"
	case "$proto" in
		tcp|udp) ;;
		tcp+udp|tcpudp) proto="tcp udp" ;;
		*) ;;
	esac
	name="${name:-pm-$dest_ip-$src_dport}"

	idx=$(openont_nat_find_index_by_name "$name" || true)
	if [ -n "$idx" ]; then
		uci -q delete "firewall.@redirect[$idx]"
	fi

	uci -q batch <<-EOF
		add firewall redirect
		set firewall.@redirect[-1].name='$name'
		set firewall.@redirect[-1].target='DNAT'
		set firewall.@redirect[-1].src='wan'
		set firewall.@redirect[-1].dest='lan'
		set firewall.@redirect[-1].proto='$proto'
		set firewall.@redirect[-1].src_dport='$src_dport'
		set firewall.@redirect[-1].dest_ip='$dest_ip'
		set firewall.@redirect[-1].dest_port='$dest_port'
		set firewall.@redirect[-1].enabled='$enabled'
		set firewall.@redirect[-1].openont_kind='portmap'
	EOF
	idx=$(openont_nat_find_index_by_name "$name")
	openont_nat_apply_group "$idx" "$src_group"
	uci commit firewall
	openont_reload_firewall
	echo "ok $name"
}

openont_nat_dmz_add() {
	local name="$1" dest_ip="$2" enabled="${3:-1}"
	local excl_proto="${4:-}" excl_port="${5:-}"
	local idx i=0 kind

	[ -n "$dest_ip" ] || { echo "need dest_ip" >&2; return 1; }
	name="${name:-dmz-$dest_ip}"

	# only one enabled DMZ overall for wan (simple policy)
	while uci -q get "firewall.@redirect[$i]" >/dev/null 2>&1; do
		kind=$(uci -q get "firewall.@redirect[$i].openont_kind")
		en=$(uci -q get "firewall.@redirect[$i].enabled")
		n=$(uci -q get "firewall.@redirect[$i].name")
		if [ "$kind" = "dmz" ] && [ "$en" != "0" ] && [ "$n" != "$name" ]; then
			echo "another DMZ already enabled: $n" >&2
			return 1
		fi
		i=$((i + 1))
	done

	idx=$(openont_nat_find_index_by_name "$name" || true)
	[ -n "$idx" ] && uci -q delete "firewall.@redirect[$idx]"

	uci -q batch <<-EOF
		add firewall redirect
		set firewall.@redirect[-1].name='$name'
		set firewall.@redirect[-1].target='DNAT'
		set firewall.@redirect[-1].src='wan'
		set firewall.@redirect[-1].dest='lan'
		set firewall.@redirect[-1].proto='all'
		set firewall.@redirect[-1].src_dport='1-65535'
		set firewall.@redirect[-1].dest_ip='$dest_ip'
		set firewall.@redirect[-1].enabled='$enabled'
		set firewall.@redirect[-1].openont_kind='dmz'
		set firewall.@redirect[-1].openont_excl_proto='$excl_proto'
		set firewall.@redirect[-1].openont_excl_port='$excl_port'
	EOF
	# Note: exclude ports are stored for UI; full nft exclude is best-effort via reflection_src
	uci commit firewall
	openont_reload_firewall
	echo "ok $name"
}

openont_nat_set_enabled() {
	local name="$1"
	local en="$2"
	local idx
	idx=$(openont_nat_find_index_by_name "$name") || { echo "not found" >&2; return 1; }
	uci -q set "firewall.@redirect[$idx].enabled=$en"
	uci commit firewall
	openont_reload_firewall
	echo "ok"
}

openont_nat_del() {
	local name="$1"
	local idx
	idx=$(openont_nat_find_index_by_name "$name") || { echo "not found" >&2; return 1; }
	uci -q delete "firewall.@redirect[$idx]"
	uci commit firewall
	openont_reload_firewall
	echo "ok deleted"
}

openont_nat_list_json() {
	local kind_filter="${1:-}" # portmap|dmz|empty=all
	local i=0 first=1 name kind proto dest_ip dest_port src_dport en src_group excl_p excl_t
	printf '{"items":['
	while uci -q get "firewall.@redirect[$i]" >/dev/null 2>&1; do
		kind=$(uci -q get "firewall.@redirect[$i].openont_kind")
		# treat missing kind as portmap if dest_port set
		if [ -z "$kind" ]; then
			dest_port=$(uci -q get "firewall.@redirect[$i].dest_port")
			if [ -n "$dest_port" ]; then kind="portmap"; else kind="other"; fi
		fi
		if [ -n "$kind_filter" ] && [ "$kind" != "$kind_filter" ]; then
			i=$((i + 1))
			continue
		fi
		name=$(uci -q get "firewall.@redirect[$i].name")
		proto=$(uci -q get "firewall.@redirect[$i].proto")
		dest_ip=$(uci -q get "firewall.@redirect[$i].dest_ip")
		dest_port=$(uci -q get "firewall.@redirect[$i].dest_port")
		src_dport=$(uci -q get "firewall.@redirect[$i].src_dport")
		en=$(uci -q get "firewall.@redirect[$i].enabled")
		[ "$en" = "0" ] || en=1
		src_group=$(uci -q get "firewall.@redirect[$i].openont_src_group")
		excl_p=$(uci -q get "firewall.@redirect[$i].openont_excl_proto")
		excl_t=$(uci -q get "firewall.@redirect[$i].openont_excl_port")
		[ "$first" -eq 1 ] || printf ','
		first=0
		printf '{"name":"%s","kind":"%s","proto":"%s","dest_ip":"%s","dest_port":"%s","src_dport":"%s","enabled":%s,"src_group":"%s","excl_proto":"%s","excl_port":"%s","src_wan":"all"}' \
			"$(openont_json_escape "$name")" "$(openont_json_escape "$kind")" \
			"$(openont_json_escape "$proto")" "$(openont_json_escape "$dest_ip")" \
			"$(openont_json_escape "$dest_port")" "$(openont_json_escape "$src_dport")" \
			"$en" "$(openont_json_escape "$src_group")" \
			"$(openont_json_escape "$excl_p")" "$(openont_json_escape "$excl_t")"
		i=$((i + 1))
	done
	printf ']}\n'
}

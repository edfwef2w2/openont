# SPDX-License-Identifier: GPL-2.0-only
# IP groups for port-forward source allow lists.

. /usr/lib/openont/common.sh

openont_ipgroup_ensure_config() {
	[ -f /etc/config/openont ] || touch /etc/config/openont
}

openont_ipgroup_list_ids() {
	uci -q show openont 2>/dev/null | sed -n "s/^openont\.\([^=]*\)=ipgroup/\1/p"
}

openont_ipgroup_get_entries() {
	local id="$1"
	uci -q get "openont.$id.entry" 2>/dev/null
}

openont_ipgroup_refs() {
	local id="$1"
	local i=0 n c=0
	while uci -q get "firewall.@redirect[$i]" >/dev/null 2>&1; do
		n=$(uci -q get "firewall.@redirect[$i].openont_src_group")
		[ "$n" = "$id" ] && c=$((c + 1))
		i=$((i + 1))
	done
	echo "$c"
}

openont_ipgroup_set() {
	local id="$1"
	local name="$2"
	local comment="$3"
	shift 3
	local e
	openont_ipgroup_ensure_config
	[ -n "$id" ] || id=$(echo "$name" | tr -c 'A-Za-z0-9_' '_' | sed 's/^_/g/')
	[ -n "$id" ] || { echo "need id/name" >&2; return 1; }
	uci -q batch <<-EOF
		set openont.$id=ipgroup
		set openont.$id.name='${name:-$id}'
		set openont.$id.comment='$comment'
		delete openont.$id.entry
	EOF
	for e in "$@"; do
		[ -n "$e" ] && uci add_list "openont.$id.entry=$e"
	done
	uci commit openont
	# re-expand redirects referencing this group
	. /usr/lib/openont/nat.sh
	openont_nat_reexpand_group "$id"
	echo "ok $id"
}

openont_ipgroup_del() {
	local id="$1"
	local refs
	refs=$(openont_ipgroup_refs "$id")
	if [ "$refs" -gt 0 ] 2>/dev/null; then
		echo "group $id is referenced by $refs portmap(s); clear references first" >&2
		return 1
	fi
	uci -q delete "openont.$id"
	uci commit openont
	echo "ok deleted $id"
}

openont_ipgroup_status_json() {
	local id name comment entries e first=1 ef refs
	printf '{"groups":['
	for id in $(openont_ipgroup_list_ids); do
		[ "$first" -eq 1 ] || printf ','
		first=0
		name=$(uci -q get "openont.$id.name")
		comment=$(uci -q get "openont.$id.comment")
		refs=$(openont_ipgroup_refs "$id")
		printf '{"id":"%s","name":"%s","comment":"%s","refs":%s,"entries":[' \
			"$(openont_json_escape "$id")" "$(openont_json_escape "${name:-$id}")" \
			"$(openont_json_escape "$comment")" "$refs"
		ef=1
		for e in $(openont_ipgroup_get_entries "$id"); do
			[ "$ef" -eq 1 ] || printf ','
			ef=0
			printf '"%s"' "$(openont_json_escape "$e")"
		done
		printf ']}'
	done
	printf ']}\n'
}

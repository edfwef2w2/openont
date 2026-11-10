# SPDX-License-Identifier: GPL-2.0-only
# Shared DNS backend for the CLI and ubus RPC.

[ -n "$OPENONT_DNS_LOADED" ] && return 0
OPENONT_DNS_LOADED=1

. /usr/lib/openont/common.sh 2>/dev/null || true
. /lib/functions.sh 2>/dev/null || true
. /usr/share/libubox/jshn.sh 2>/dev/null || true

DNS_STAMP="/etc/openont/dns-dnsmasq.port"
DNS_OPT6="/etc/openont/dns-dhcp-opt6"
DNS_HTTPS="/etc/openont/dns-uhttpd.https"
DNS_RUN="/tmp/openont-dns"
DNS_CONF="$DNS_RUN/dnsd.conf"
DNS_TLS="$DNS_RUN/tlsfront.conf"

openont_dns_fail() {
	openont_err "$1" || true
	return 0
}

openont_dns_bool() {
	case "$1" in
		1|true|yes|on) echo 1 ;;
		*) echo 0 ;;
	esac
}

openont_dns_interval() {
	local s="$1"
	case "$s" in
		*[!0-9]*h) echo $((${s%h} * 3600)) ;;
		*h) echo $((${s%h} * 3600)) ;;
		*m) echo $((${s%m} * 60)) ;;
		*d) echo $((${s%d} * 86400)) ;;
		*[0-9]) echo "$s" ;;
		*) echo 86400 ;;
	esac
}

openont_dns_sections() {
	uci show openont-dns 2>/dev/null | sed -n "s/^openont-dns\\.\\([^=]*\\)=$1$/\\1/p"
}

openont_dns_lan_ips() {
	local role ip
	for role in $(uci show network 2>/dev/null | sed -n 's/^network\.\(lan[0-9]*\)=interface/\1/p'); do
		ip=$(uci -q get "network.$role.ipaddr")
		ip=${ip%%/*}
		[ -n "$ip" ] && echo "$ip"
	done
}

openont_dns_claim_dnsmasq() {
	local role ip opt saved
	[ -x /etc/init.d/dnsmasq ] || return 0
	mkdir -p /etc/openont
	if [ ! -f "$DNS_STAMP" ]; then
		saved=$(uci -q get dhcp.@dnsmasq[0].port)
		printf '%s\n' "${saved:-__unset__}" > "$DNS_STAMP"
		uci -q set dhcp.@dnsmasq[0].port='0'
		: > "$DNS_OPT6"
		for role in $(uci show network 2>/dev/null | sed -n 's/^network\.\(lan[0-9]*\)=interface/\1/p'); do
			ip=$(uci -q get "network.$role.ipaddr")
			ip=${ip%%/*}
			[ -n "$ip" ] || continue
			uci -q get "dhcp.$role" >/dev/null 2>&1 || continue
			opt="6,$ip"
			uci -q add_list "dhcp.$role.dhcp_option=$opt"
			echo "$role $opt" >> "$DNS_OPT6"
		done
		uci commit dhcp
		/etc/init.d/dnsmasq restart >/dev/null 2>&1 || true
	fi
}

openont_dns_release_dnsmasq() {
	local saved role opt
	[ -f "$DNS_STAMP" ] || return 0
	[ -x /etc/init.d/dnsmasq ] || return 0
	saved=$(cat "$DNS_STAMP" 2>/dev/null)
	if [ "$saved" = "__unset__" ] || [ -z "$saved" ]; then
		uci -q delete dhcp.@dnsmasq[0].port
	else
		uci -q set "dhcp.@dnsmasq[0].port=$saved"
	fi
	if [ -f "$DNS_OPT6" ]; then
		while read -r role opt; do
			[ -n "$role" ] && [ -n "$opt" ] || continue
			uci -q del_list "dhcp.$role.dhcp_option=$opt"
		done < "$DNS_OPT6"
		rm -f "$DNS_OPT6"
	fi
	rm -f "$DNS_STAMP"
	uci commit dhcp
	/etc/init.d/dnsmasq restart >/dev/null 2>&1 || true
}

openont_dns_claim_https() {
	local line
	[ -f "$DNS_HTTPS" ] && return 0
	mkdir -p /etc/openont
	uci show uhttpd.main.listen_https 2>/dev/null | sed -n "s/.*='\\(.*\\)'/\\1/p" > "$DNS_HTTPS"
	uci -q delete uhttpd.main.listen_https
	uci -q add_list uhttpd.main.listen_https='127.0.0.1:8443'
	uci -q add_list uhttpd.main.listen_https='[::1]:8443'
	uci commit uhttpd 2>/dev/null || true
	[ -x /etc/init.d/uhttpd ] && /etc/init.d/uhttpd restart >/dev/null 2>&1 || true
	return 0
}

openont_dns_restore_https() {
	[ -f "$DNS_HTTPS" ] || return 0
	uci -q delete uhttpd.main.listen_https
	if [ -s "$DNS_HTTPS" ]; then
		while IFS= read -r line; do
			[ -n "$line" ] && uci -q add_list uhttpd.main.listen_https="$line"
		done < "$DNS_HTTPS"
	else
		uci -q add_list uhttpd.main.listen_https='0.0.0.0:443'
		uci -q add_list uhttpd.main.listen_https='[::]:443'
	fi
	rm -f "$DNS_HTTPS"
	uci commit uhttpd 2>/dev/null || true
	[ -x /etc/init.d/uhttpd ] && /etc/init.d/uhttpd restart >/dev/null 2>&1 || true
}

openont_dns_ensure_sets() {
	local id nft fam table setname
	command -v nft >/dev/null 2>&1 || return 0
	nft add table inet openont >/dev/null 2>&1 || true
	for id in $(openont_dns_sections domain); do
		nft=$(uci -q get "openont-dns.$id.nftset")
		[ -n "$nft" ] || continue
		nft=$(printf '%s' "$nft" | tr ' ' '/')
		fam=$(printf '%s' "$nft" | cut -d/ -f1)
		table=$(printf '%s' "$nft" | cut -d/ -f2)
		setname=$(printf '%s' "$nft" | cut -d/ -f3)
		[ -n "$fam" ] && [ -n "$table" ] && [ -n "$setname" ] || continue
		nft add table "$fam" "$table" >/dev/null 2>&1 || true
		nft add set "$fam" "$table" "$setname" '{ type ipv4_addr; flags timeout; }' >/dev/null 2>&1 || true
	done
}

_dns_emit_up() {
	local id="$1" en group proto address port tls path
	config_get en "$id" enabled 1
	[ "$en" = "0" ] && return 0
	config_get group "$id" group "default"
	config_get proto "$id" proto "udp"
	config_get address "$id" address
	config_get port "$id" port "53"
	config_get tls "$id" tls_host
	config_get path "$id" doh_path
	[ -n "$address" ] || return 0
	[ -n "$tls" ] || tls="-"
	[ -n "$path" ] || path="/dns-query"
	echo "upstream $group $proto $address $port $tls $path" >> "$DNS_CONF.new"
}

_dns_emit_bogus() {
	local id="$1" cidr
	config_get cidr "$id" cidr
	[ -n "$cidr" ] && echo "bogus $cidr" >> "$DNS_CONF.new"
}

_dns_emit_domain() {
	local id="$1" pattern match group nft
	config_get pattern "$id" pattern
	config_get match "$id" match "suffix"
	config_get group "$id" group "default"
	config_get nft "$id" nftset
	[ -n "$pattern" ] || return 0
	nft=$(printf '%s' "$nft" | tr ' ' '/')
	if [ -n "$nft" ]; then
		echo "domain $match $pattern $group nftset $nft" >> "$DNS_CONF.new"
	else
		echo "domain $match $pattern $group" >> "$DNS_CONF.new"
	fi
}

_dns_emit_rewrite() {
	local id="$1" pattern match typ value
	config_get pattern "$id" pattern
	config_get match "$id" match "suffix"
	config_get typ "$id" type "A"
	config_get value "$id" value
	[ -n "$pattern" ] && [ -n "$value" ] || return 0
	echo "rewrite $match $pattern $typ $value" >> "$DNS_CONF.new"
}

_dns_emit_filter() {
	local id="$1" text client
	config_get text "$id" text
	config_get client "$id" client
	[ -n "$text" ] || return 0
	[ -n "$client" ] || client="-"
	echo "adg $client $text" >> "$DNS_CONF.new"
}

_dns_emit_accel() {
	local id="$1" domain en
	[ "$DNS_ACCEL_ON" = "1" ] || return 0
	config_get en "$id" enabled 1
	[ "$en" = "0" ] && return 0
	config_get domain "$id" domain
	[ -n "$domain" ] || return 0
	echo "accel suffix $domain" >> "$DNS_CONF.new"
	echo "accel $domain" >> "$DNS_TLS.new"
}

_dns_emit_client() {
	local id="$1" address
	config_get address "$id" address
	[ -n "$address" ] && echo "skip $address" >> "$DNS_CONF.new"
}

_dns_emit_list() {
	local id="$1" name url en safe
	config_get en "$id" enabled 0
	[ "$en" = "1" ] || return 0
	config_get name "$id" name "$id"
	config_get url "$id" url
	safe=$(printf '%s' "$name" | tr -c 'A-Za-z0-9._-' '_')
	[ -n "$safe" ] || return 0
	if [ -s "/var/lib/openont-dns/lists/$safe" ]; then
		echo "include /var/lib/openont-dns/lists/$safe" >> "$DNS_CONF.new"
	fi
	[ -n "$url" ] || return 0
}

openont_dns_write_conf() {
	local port cache min max serve prefetch mode speed pref block logsz accel sni sniname ip
	mkdir -p "$DNS_RUN" /var/lib/openont-dns/lists /etc/openont/dns /tmp/openont-stats
	port=$(uci -q get openont-dns.main.port); port=${port:-53}
	cache=$(uci -q get openont-dns.main.cache_size); cache=${cache:-4096}
	min=$(uci -q get openont-dns.main.min_ttl); min=${min:-0}
	max=$(uci -q get openont-dns.main.max_ttl); max=${max:-3600}
	serve=$(uci -q get openont-dns.main.serve_expired); serve=${serve:-1}
	prefetch=$(uci -q get openont-dns.main.prefetch); prefetch=${prefetch:-1}
	mode=$(uci -q get openont-dns.main.response_mode); mode=${mode:-fastest-ip}
	speed=$(uci -q get openont-dns.main.speed_check); speed=${speed:-tcp443}
	pref=$(uci -q get openont-dns.main.ip_pref); pref=${pref:-dual}
	block=$(uci -q get openont-dns.main.block_mode); block=${block:-nxdomain}
	logsz=$(uci -q get openont-dns.main.log_size); logsz=${logsz:-500}
	accel=$(uci -q get openont-dns.main.accel_enabled); accel=${accel:-0}
	sni=$(uci -q get openont-dns.main.accel_sni); sni=${sni:-omit}
	sniname=$(uci -q get openont-dns.main.accel_sni_name)
	DNS_ACCEL_ON="$accel"
	{
		echo "port $port"
		echo "cache_size $cache"
		echo "min_ttl $min"
		echo "max_ttl $max"
		echo "serve_expired $serve"
		echo "prefetch $prefetch"
		echo "response_mode $mode"
		echo "speed_check $speed"
		echo "ip_pref $pref"
		echo "block_mode $block"
		echo "log_size $logsz"
		echo "accel $accel"
		echo "classify_log /tmp/openont-stats/dns.log"
		echo "query_log $DNS_RUN/query.log"
		echo "self 127.0.0.1"
		for ip in $(openont_dns_lan_ips); do
			echo "self $ip"
		done
	} > "$DNS_CONF.new"
	{
		echo "ca_key /etc/openont/dns/ca.key"
		echo "ca_crt /etc/openont/dns/ca.crt"
		echo "cert_dir $DNS_RUN/certs"
		echo "backend_host 127.0.0.1"
		echo "backend_port 8443"
		echo "sni_mode $sni"
		if [ -n "$sniname" ]; then
			echo "sni_name $sniname"
		else
			echo "sni_name -"
		fi
		echo "trust_file /etc/ssl/certs/ca-certificates.crt"
		echo "listen_port 443"
	} > "$DNS_TLS.new"
	config_load openont-dns
	config_foreach _dns_emit_up upstream
	config_foreach _dns_emit_bogus bogus
	config_foreach _dns_emit_domain domain
	config_foreach _dns_emit_rewrite rewrite
	config_foreach _dns_emit_filter filter
	config_foreach _dns_emit_accel accel
	config_foreach _dns_emit_client client
	config_foreach _dns_emit_list blocklist
	mv -f "$DNS_CONF.new" "$DNS_CONF"
	mv -f "$DNS_TLS.new" "$DNS_TLS"
}

openont_dns_apply() {
	local en
	en=$(uci -q get openont-dns.main.enabled)
	if [ "$en" = "1" ]; then
		/etc/init.d/openont-dns restart >/dev/null 2>&1 || /etc/init.d/openont-dns start >/dev/null 2>&1 || true
	else
		/etc/init.d/openont-dns stop >/dev/null 2>&1 || true
	fi
}

openont_dns_commit() {
	uci commit openont-dns
	openont_dns_apply
	openont_ok saved
}

openont_dns_section_del() {
	local id="$1" typ
	[ -n "$id" ] || { openont_dns_fail "missing id"; return 0; }
	typ=$(uci -q get "openont-dns.$id")
	case "$typ" in
		upstream|domain|rewrite|filter|blocklist|accel|client|bogus) ;;
		*) openont_dns_fail "unknown section"; return 0 ;;
	esac
	uci -q delete "openont-dns.$id"
	openont_dns_commit
}

openont_dns_replace_bogus() {
	local cidr id s
	for s in $(openont_dns_sections bogus); do
		uci -q delete "openont-dns.$s"
	done
	for cidr in $(printf '%s' "$1" | tr '\n,' ' '); do
		case "$cidr" in
			''|*[!0-9a-fA-F:./]*) continue ;;
		esac
		id=$(uci add openont-dns bogus)
		uci -q set "openont-dns.$id.cidr=$cidr"
	done
}

openont_dns_set() {
	local enabled="$1" port="$2" cache="$3" min="$4" max="$5"
	local serve="$6" prefetch="$7" mode="$8" speed="$9"
	shift 9
	local pref="$1" block="$2" logsz="$3" bogus="$4"
	enabled=$(openont_dns_bool "$enabled")
	serve=$(openont_dns_bool "$serve")
	prefetch=$(openont_dns_bool "$prefetch")
	case "$port" in
		''|*[!0-9]*|0) openont_dns_fail "invalid port"; return 0 ;;
	esac
	case "$mode" in
		first-response|fastest-response|fastest-ip) ;;
		*) openont_dns_fail "invalid response mode"; return 0 ;;
	esac
	case "$speed" in
		off|icmp|tcp443) ;;
		*) openont_dns_fail "invalid speed check"; return 0 ;;
	esac
	case "$pref" in
		dual|v4|v6) ;;
		*) openont_dns_fail "invalid address preference"; return 0 ;;
	esac
	case "$block" in
		nxdomain|refused|zero) ;;
		*) openont_dns_fail "invalid block mode"; return 0 ;;
	esac
	uci -q set openont-dns.main=server
	uci -q set openont-dns.main.enabled="$enabled"
	uci -q set openont-dns.main.port="$port"
	uci -q set openont-dns.main.cache_size="${cache:-4096}"
	uci -q set openont-dns.main.min_ttl="${min:-0}"
	uci -q set openont-dns.main.max_ttl="${max:-3600}"
	uci -q set openont-dns.main.serve_expired="$serve"
	uci -q set openont-dns.main.prefetch="$prefetch"
	uci -q set openont-dns.main.response_mode="$mode"
	uci -q set openont-dns.main.speed_check="$speed"
	uci -q set openont-dns.main.ip_pref="$pref"
	uci -q set openont-dns.main.block_mode="$block"
	uci -q set openont-dns.main.log_size="${logsz:-500}"
	openont_dns_replace_bogus "$bogus"
	openont_dns_commit
}

openont_dns_accel_cfg() {
	local enabled sni name
	enabled=$(openont_dns_bool "$1")
	sni="$2"
	name="$3"
	case "$sni" in
		keep|omit|replace) ;;
		*) openont_dns_fail "invalid SNI mode"; return 0 ;;
	esac
	uci -q set openont-dns.main.accel_enabled="$enabled"
	uci -q set openont-dns.main.accel_sni="$sni"
	uci -q set openont-dns.main.accel_sni_name="$name"
	openont_dns_commit
}

openont_dns_ensure_id() {
	local id="$1" typ="$2"
	if [ -z "$id" ]; then
		uci add openont-dns "$typ"
		return 0
	fi
	if [ "$(uci -q get "openont-dns.$id")" != "$typ" ]; then
		echo ""
		return 1
	fi
	echo "$id"
}

openont_dns_upstream_set() {
	local id="$1" name="$2" group="$3" proto="$4" address="$5" port="$6" tls="$7" path="$8" en
	en=$(openont_dns_bool "${9:-1}")
	case "$proto" in
		udp|tcp|dot|doh) ;;
		*) openont_dns_fail "invalid protocol"; return 0 ;;
	esac
	[ -n "$address" ] || { openont_dns_fail "address required"; return 0; }
	[ -n "$group" ] || group="default"
	[ -n "$port" ] || port="53"
	[ -n "$path" ] || path="/dns-query"
	id=$(openont_dns_ensure_id "$id" upstream) || { openont_dns_fail "unknown upstream"; return 0; }
	uci -q set "openont-dns.$id.name=$name"
	uci -q set "openont-dns.$id.group=$group"
	uci -q set "openont-dns.$id.proto=$proto"
	uci -q set "openont-dns.$id.address=$address"
	uci -q set "openont-dns.$id.port=$port"
	uci -q set "openont-dns.$id.tls_host=$tls"
	uci -q set "openont-dns.$id.doh_path=$path"
	uci -q set "openont-dns.$id.enabled=$en"
	openont_dns_commit
}

openont_dns_domain_set() {
	local id="$1" pattern="$2" match="$3" group="$4" nft="$5"
	[ -n "$pattern" ] || { openont_dns_fail "pattern required"; return 0; }
	case "$match" in
		exact|suffix) ;;
		*) match="suffix" ;;
	esac
	[ -n "$group" ] || group="default"
	id=$(openont_dns_ensure_id "$id" domain) || { openont_dns_fail "unknown rule"; return 0; }
	uci -q set "openont-dns.$id.pattern=$pattern"
	uci -q set "openont-dns.$id.match=$match"
	uci -q set "openont-dns.$id.group=$group"
	uci -q set "openont-dns.$id.nftset=$nft"
	openont_dns_commit
}

openont_dns_rewrite_set() {
	local id="$1" pattern="$2" match="$3" typ="$4" value="$5"
	[ -n "$pattern" ] && [ -n "$value" ] || { openont_dns_fail "pattern and value required"; return 0; }
	case "$match" in
		exact|suffix) ;;
		*) match="suffix" ;;
	esac
	case "$typ" in
		A|AAAA|CNAME) ;;
		*) openont_dns_fail "invalid record type"; return 0 ;;
	esac
	id=$(openont_dns_ensure_id "$id" rewrite) || { openont_dns_fail "unknown rewrite"; return 0; }
	uci -q set "openont-dns.$id.pattern=$pattern"
	uci -q set "openont-dns.$id.match=$match"
	uci -q set "openont-dns.$id.type=$typ"
	uci -q set "openont-dns.$id.value=$value"
	openont_dns_commit
}

openont_dns_filter_set() {
	local id="$1" text="$2" client="$3"
	[ -n "$text" ] || { openont_dns_fail "rule required"; return 0; }
	id=$(openont_dns_ensure_id "$id" filter) || { openont_dns_fail "unknown rule"; return 0; }
	uci -q set "openont-dns.$id.text=$text"
	uci -q set "openont-dns.$id.client=$client"
	openont_dns_commit
}

openont_dns_blocklist_set() {
	local id="$1" name="$2" url="$3" en refresh="$5"
	en=$(openont_dns_bool "$4")
	[ -n "$name" ] || { openont_dns_fail "name required"; return 0; }
	[ -n "$refresh" ] || refresh="24h"
	id=$(openont_dns_ensure_id "$id" blocklist) || { openont_dns_fail "unknown list"; return 0; }
	uci -q set "openont-dns.$id.name=$name"
	uci -q set "openont-dns.$id.url=$url"
	uci -q set "openont-dns.$id.enabled=$en"
	uci -q set "openont-dns.$id.refresh=$refresh"
	openont_dns_commit
}

openont_dns_client_set() {
	local id="$1" address="$2"
	[ -n "$address" ] || { openont_dns_fail "address required"; return 0; }
	id=$(openont_dns_ensure_id "$id" client) || { openont_dns_fail "unknown client"; return 0; }
	uci -q set "openont-dns.$id.address=$address"
	openont_dns_commit
}

openont_dns_accel_set() {
	local id="$1" domain="$2" en
	en=$(openont_dns_bool "${3:-1}")
	[ -n "$domain" ] || { openont_dns_fail "domain required"; return 0; }
	id=$(openont_dns_ensure_id "$id" accel) || { openont_dns_fail "unknown domain"; return 0; }
	uci -q set "openont-dns.$id.domain=$domain"
	uci -q set "openont-dns.$id.enabled=$en"
	openont_dns_commit
}

_dns_json_up() {
	local id="$1" name group proto address port tls path en
	config_get name "$id" name
	config_get group "$id" group "default"
	config_get proto "$id" proto "udp"
	config_get address "$id" address
	config_get port "$id" port "53"
	config_get tls "$id" tls_host
	config_get path "$id" doh_path "/dns-query"
	config_get en "$id" enabled 1
	json_add_object
	json_add_string id "$id"
	json_add_string name "$name"
	json_add_string group "$group"
	json_add_string proto "$proto"
	json_add_string address "$address"
	json_add_string port "$port"
	json_add_string tls_host "$tls"
	json_add_string doh_path "$path"
	json_add_boolean enabled "$en"
	json_close_object
}

_dns_json_domain() {
	local id="$1" pattern match group nft
	config_get pattern "$id" pattern
	config_get match "$id" match "suffix"
	config_get group "$id" group "default"
	config_get nft "$id" nftset
	json_add_object
	json_add_string id "$id"
	json_add_string pattern "$pattern"
	json_add_string match "$match"
	json_add_string group "$group"
	json_add_string nftset "$nft"
	json_close_object
}

_dns_json_rewrite() {
	local id="$1" pattern match typ value
	config_get pattern "$id" pattern
	config_get match "$id" match "suffix"
	config_get typ "$id" type "A"
	config_get value "$id" value
	json_add_object
	json_add_string id "$id"
	json_add_string pattern "$pattern"
	json_add_string match "$match"
	json_add_string type "$typ"
	json_add_string value "$value"
	json_close_object
}

_dns_json_filter() {
	local id="$1" text client
	config_get text "$id" text
	config_get client "$id" client
	json_add_object
	json_add_string id "$id"
	json_add_string text "$text"
	json_add_string client "$client"
	json_close_object
}

_dns_json_block() {
	local id="$1" name url en refresh
	config_get name "$id" name
	config_get url "$id" url
	config_get en "$id" enabled 0
	config_get refresh "$id" refresh "24h"
	json_add_object
	json_add_string id "$id"
	json_add_string name "$name"
	json_add_string url "$url"
	json_add_string refresh "$refresh"
	json_add_boolean enabled "$en"
	json_close_object
}

_dns_json_client() {
	local id="$1" address
	config_get address "$id" address
	json_add_object
	json_add_string id "$id"
	json_add_string address "$address"
	json_close_object
}

_dns_json_accel() {
	local id="$1" domain en
	config_get domain "$id" domain
	config_get en "$id" enabled 1
	json_add_object
	json_add_string id "$id"
	json_add_string domain "$domain"
	json_add_boolean enabled "$en"
	json_close_object
}

_dns_json_bogus() {
	local id="$1" cidr
	config_get cidr "$id" cidr
	[ -n "$cidr" ] && json_add_string "" "$cidr"
}

openont_dns_upstream_list_json() {
	json_init
	json_add_array upstreams
	config_load openont-dns
	config_foreach _dns_json_up upstream
	json_close_array
	json_dump
}

openont_dns_domain_list_json() {
	json_init
	json_add_array domains
	config_load openont-dns
	config_foreach _dns_json_domain domain
	json_close_array
	json_dump
}

openont_dns_rewrite_list_json() {
	json_init
	json_add_array rewrites
	config_load openont-dns
	config_foreach _dns_json_rewrite rewrite
	json_close_array
	json_dump
}

openont_dns_filter_list_json() {
	json_init
	json_add_array rules
	config_load openont-dns
	config_foreach _dns_json_filter filter
	json_close_array
	json_add_array blocklists
	config_foreach _dns_json_block blocklist
	json_close_array
	json_add_array rewrites
	config_foreach _dns_json_rewrite rewrite
	json_close_array
	json_add_array clients
	config_foreach _dns_json_client client
	json_close_array
	json_dump
}

openont_dns_blocklist_list_json() {
	openont_dns_filter_list_json
}

openont_dns_client_list_json() {
	openont_dns_filter_list_json
}

openont_dns_accel_list_json() {
	local en sni name
	en=$(uci -q get openont-dns.main.accel_enabled); en=${en:-0}
	sni=$(uci -q get openont-dns.main.accel_sni); sni=${sni:-omit}
	name=$(uci -q get openont-dns.main.accel_sni_name)
	json_init
	json_add_boolean accel_enabled "$en"
	json_add_string accel_sni "$sni"
	json_add_string accel_sni_name "$name"
	json_add_boolean ca_ready "$([ -s /etc/openont/dns/ca.crt ] && echo 1 || echo 0)"
	json_add_array domains
	config_load openont-dns
	config_foreach _dns_json_accel accel
	json_close_array
	json_dump
}

openont_dns_listen_ok() {
	local port hex
	port=$(uci -q get openont-dns.main.port)
	port=${port:-53}
	hex=$(printf '%04X' "$port" 2>/dev/null || echo "")
	[ -n "$hex" ] || return 1
	grep -q ":$hex " /proc/net/udp /proc/net/udp6 2>/dev/null
}

openont_dns_status_json() {
	local en port cache min max serve prefetch mode speed pref block logsz
	local accel sni name running listen yielded ip bogus
	en=$(uci -q get openont-dns.main.enabled); en=${en:-0}
	port=$(uci -q get openont-dns.main.port); port=${port:-53}
	cache=$(uci -q get openont-dns.main.cache_size); cache=${cache:-4096}
	min=$(uci -q get openont-dns.main.min_ttl); min=${min:-0}
	max=$(uci -q get openont-dns.main.max_ttl); max=${max:-3600}
	serve=$(uci -q get openont-dns.main.serve_expired); serve=${serve:-1}
	prefetch=$(uci -q get openont-dns.main.prefetch); prefetch=${prefetch:-1}
	mode=$(uci -q get openont-dns.main.response_mode); mode=${mode:-fastest-ip}
	speed=$(uci -q get openont-dns.main.speed_check); speed=${speed:-tcp443}
	pref=$(uci -q get openont-dns.main.ip_pref); pref=${pref:-dual}
	block=$(uci -q get openont-dns.main.block_mode); block=${block:-nxdomain}
	logsz=$(uci -q get openont-dns.main.log_size); logsz=${logsz:-500}
	accel=$(uci -q get openont-dns.main.accel_enabled); accel=${accel:-0}
	sni=$(uci -q get openont-dns.main.accel_sni); sni=${sni:-omit}
	name=$(uci -q get openont-dns.main.accel_sni_name)
	if pidof openont-dnsd >/dev/null 2>&1; then running=1; else running=0; fi
	if openont_dns_listen_ok; then listen=1; else listen=0; fi
	if [ -f "$DNS_STAMP" ]; then yielded=1; else yielded=0; fi
	ip=$(openont_dns_lan_ips | head -n 1)
	json_init
	json_add_boolean enabled "$en"
	json_add_int port "$port"
	json_add_int cache_size "$cache"
	json_add_int min_ttl "$min"
	json_add_int max_ttl "$max"
	json_add_boolean serve_expired "$serve"
	json_add_boolean prefetch "$prefetch"
	json_add_string response_mode "$mode"
	json_add_string speed_check "$speed"
	json_add_string ip_pref "$pref"
	json_add_string block_mode "$block"
	json_add_int log_size "$logsz"
	json_add_boolean accel_enabled "$accel"
	json_add_string accel_sni "$sni"
	json_add_string accel_sni_name "$name"
	json_add_boolean running "$running"
	json_add_boolean listen_ok "$listen"
	json_add_boolean dnsmasq_yielded "$yielded"
	json_add_string lan_ip "$ip"
	json_add_array bogus
	config_load openont-dns
	config_foreach _dns_json_bogus bogus
	json_close_array
	json_dump
}

openont_dns_log_json() {
	local limit="${1:-200}" kind="${2:-all}" line ts client name typ action detail
	local tmp="$DNS_RUN/log.tail"
	mkdir -p "$DNS_RUN"
	json_init
	json_add_array items
	if [ -f "$DNS_RUN/query.log" ]; then
		tail -n "$limit" "$DNS_RUN/query.log" > "$tmp" 2>/dev/null || true
		while read -r ts client name typ action detail; do
			[ -n "$ts" ] || continue
			if [ "$kind" != "all" ] && [ "$action" != "$kind" ]; then
				continue
			fi
			json_add_object
			json_add_string time "$ts"
			json_add_string client "$client"
			json_add_string name "$name"
			json_add_string qtype "$typ"
			json_add_string action "$action"
			json_add_string detail "$detail"
			json_close_object
		done < "$tmp"
	fi
	json_close_array
	json_dump
}

openont_dns_ca_json() {
	local crt="/etc/openont/dns/ca.crt" pem
	if [ ! -s "$crt" ]; then
		printf '%s\n' '{"ok":false,"available":false,"error":"certificate not created"}'
		return 0
	fi
	pem=$(awk 'BEGIN{ORS="\\n"} {gsub(/\\/,"\\\\"); gsub(/"/,"\\\""); print}' "$crt")
	printf '{"ok":true,"available":true,"pem":"%s"}\n' "$pem"
}

_dns_refresh_one() {
	local id="$1" url en refresh name safe dest now age interval tmp mt
	config_get en "$id" enabled 0
	[ "$en" = "1" ] || return 0
	config_get url "$id" url
	[ -n "$url" ] || return 0
	config_get name "$id" name "$id"
	config_get refresh "$id" refresh "24h"
	safe=$(printf '%s' "$name" | tr -c 'A-Za-z0-9._-' '_')
	[ -n "$safe" ] || return 0
	dest="/var/lib/openont-dns/lists/$safe"
	interval=$(openont_dns_interval "$refresh")
	now=$(date +%s 2>/dev/null || echo 0)
	age=999999999
	if [ -f "$dest.stamp" ]; then
		mt=$(cat "$dest.stamp" 2>/dev/null)
		case "$mt" in
			''|*[!0-9]*) mt=0 ;;
		esac
		age=$((now - mt))
	fi
	if [ ! -s "$dest" ] || [ "$age" -ge "$interval" ]; then
		tmp="$dest.new"
		mkdir -p /var/lib/openont-dns/lists
		if uclient-fetch -q -T 20 -O "$tmp" "$url" >/dev/null 2>&1; then
			mv -f "$tmp" "$dest"
			printf '%s\n' "$now" > "$dest.stamp"
			DNS_LIST_CHANGED=1
		else
			rm -f "$tmp"
		fi
	fi
}

openont_dns_refresh_lists() {
	local en pid
	en=$(uci -q get openont-dns.main.enabled)
	[ "$en" = "1" ] || return 0
	DNS_LIST_CHANGED=0
	config_load openont-dns
	config_foreach _dns_refresh_one blocklist
	if [ "$DNS_LIST_CHANGED" = "1" ]; then
		openont_dns_write_conf
		pid=$(pidof openont-dnsd 2>/dev/null || true)
		[ -n "$pid" ] && kill -HUP $pid 2>/dev/null || true
	fi
}

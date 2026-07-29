# SPDX-License-Identifier: GPL-2.0-only
# Flow offload detect / status / set (off | software | hardware).

. /usr/lib/openont/common.sh

openont_offload_arch() {
	uname -m 2>/dev/null || echo unknown
}

openont_offload_software_supported() {
	# Module loaded or present, or conntrack available with nft.
	if lsmod 2>/dev/null | grep -q 'nft_flow_offload\|nf_flow_table'; then
		return 0
	fi
	if [ -e /lib/modules/*/nft_flow_offload.ko ] || \
	   [ -e /lib/modules/*/nft_flow_offload.ko.gz ] || \
	   ls /lib/modules/*/nft_flow_offload.ko* >/dev/null 2>&1; then
		return 0
	fi
	# Weak fallback: conntrack + nft present (kmod may load on demand)
	if [ -e /proc/net/nf_conntrack ] && command -v nft >/dev/null 2>&1; then
		return 0
	fi
	return 1
}

openont_offload_hardware_supported() {
	local arch
	arch=$(openont_offload_arch)
	case "$arch" in
		x86_64|i386|i686|amd64)
			return 1
			;;
	esac

	# PPE / hardware flow hints
	if [ -d /sys/kernel/debug/ppe ] || ls /sys/kernel/debug/ppe* >/dev/null 2>&1; then
		return 0
	fi
	if ls /sys/devices/*/*ppe* >/dev/null 2>&1; then
		return 0
	fi
	if lsmod 2>/dev/null | grep -qiE 'mtk_ppe|hw_nat|nf_flow_table_hw|flow_offload_hw'; then
		return 0
	fi
	# Device-tree compatible (best-effort)
	if [ -f /sys/firmware/devicetree/base/compatible ]; then
		# null-separated; tr to spaces
		local comp
		comp=$(tr '\0' ' ' < /sys/firmware/devicetree/base/compatible 2>/dev/null)
		case "$comp" in
			*mt7981*|*mt7986*|*mt7622*|*mt7621*|*ipq40xx*|*ipq807*|*\.ppe*)
				return 0
				;;
		esac
	fi
	return 1
}

openont_offload_sqm_active() {
	local s
	for s in $(uci -q show sqm 2>/dev/null | sed -n "s/^sqm\.\([^=]*\)=queue/\1/p"); do
		en=$(uci -q get "sqm.$s.enabled")
		[ "$en" = "1" ] && return 0
	done
	return 1
}

openont_offload_current_mode() {
	local soft hw
	soft=$(uci -q get firewall.@defaults[0].flow_offloading)
	hw=$(uci -q get firewall.@defaults[0].flow_offloading_hw)
	[ "$soft" = "1" ] || { echo off; return; }
	if [ "$hw" = "1" ]; then
		echo hardware
	else
		echo software
	fi
}

openont_offload_recommend() {
	local soft=0 hw=0
	openont_offload_software_supported && soft=1
	openont_offload_hardware_supported && hw=1
	if [ "$soft" -eq 0 ]; then
		echo off
		return
	fi
	if [ "$hw" -eq 1 ] && ! openont_offload_sqm_active; then
		echo hardware
		return
	fi
	echo software
}

openont_offload_detect_json() {
	local soft=false hw=false rec mode arch
	openont_offload_software_supported && soft=true
	openont_offload_hardware_supported && hw=true
	rec=$(openont_offload_recommend)
	mode=$(openont_offload_current_mode)
	arch=$(openont_offload_arch)

	printf '{"arch":"%s","software_supported":%s,"hardware_supported":%s,"current":"%s","recommend":"%s","warnings":[' \
		"$(openont_json_escape "$arch")" "$soft" "$hw" \
		"$(openont_json_escape "$mode")" "$(openont_json_escape "$rec")"
	local first=1
	if openont_offload_sqm_active; then
		[ "$first" -eq 1 ] || printf ','
		first=0
		printf '"%s"' "$(openont_json_escape "SQM is enabled; hardware offload may conflict with QoS")"
	fi
	if [ "$hw" = "false" ] && [ "$arch" = "x86_64" ]; then
		[ "$first" -eq 1 ] || printf ','
		first=0
		printf '"%s"' "$(openont_json_escape "Hardware flow offload is typically unavailable on x86_64")"
	fi
	printf ']}\n'
}

openont_offload_status_json() {
	openont_offload_detect_json
}

openont_offload_set() {
	local mode="$1"
	local soft=0 hw=0

	case "$mode" in
		off)
			soft=0; hw=0
			;;
		software)
			soft=1; hw=0
			if ! openont_offload_software_supported; then
				echo "software offload not supported on this system" >&2
				return 1
			fi
			;;
		hardware)
			soft=1; hw=1
			if ! openont_offload_software_supported; then
				echo "software offload not supported on this system" >&2
				return 1
			fi
			if ! openont_offload_hardware_supported; then
				echo "hardware offload not supported on this platform" >&2
				return 1
			fi
			;;
		*)
			echo "invalid mode (off|software|hardware)" >&2
			return 1
			;;
	esac

	# Ensure defaults section exists
	if ! uci -q get firewall.@defaults[0] >/dev/null 2>&1; then
		uci -q add firewall defaults >/dev/null
	fi
	uci -q set "firewall.@defaults[0].flow_offloading=$soft"
	uci -q set "firewall.@defaults[0].flow_offloading_hw=$hw"
	uci commit firewall
	openont_reload_firewall
	echo "ok mode=$(openont_offload_current_mode)"
	return 0
}

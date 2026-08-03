# SPDX-License-Identifier: Apache-2.0
# Stats / DPI RPC helpers for openont ubus object.
# Sourced by /usr/libexec/rpcd/openont

. /usr/share/libubox/jshn.sh 2>/dev/null || true
. /usr/lib/openont/stats-paths.sh 2>/dev/null || true

STATS_DIR="${OPENONT_STATS_DIR:-/tmp/openont-stats}"
HIST_FILE="${OPENONT_HIST_FILE:-$STATS_DIR/history.jsonl}"

rpc_dpi_status() {
	local meta_file="$STATS_DIR/dpi_meta.json"
	local flow_file="$STATS_DIR/flow.class"
	local engine="payload-dpi" mode="sample" running=0
	local flows_seen=0 flows_classified=0 queue_pkts=0 queue_drops=0 queue_num=10
	local flow_entries=0
	local http=0 video=0 game=0 download=0 fileb=0 im=0 common=0 other_app=0 speedtest=0 unknown=0
	local total=0 classified=0 classified_ratio=0 unknown_ratio=0

	if [ -f "$meta_file" ]; then
		engine=$(jsonfilter -i "$meta_file" -e '@.engine' 2>/dev/null || echo payload-dpi)
		mode=$(jsonfilter -i "$meta_file" -e '@.mode' 2>/dev/null || echo sample)
		flows_seen=$(jsonfilter -i "$meta_file" -e '@.flows_seen' 2>/dev/null || echo 0)
		flows_classified=$(jsonfilter -i "$meta_file" -e '@.flows_classified' 2>/dev/null || echo 0)
		queue_pkts=$(jsonfilter -i "$meta_file" -e '@.queue_pkts' 2>/dev/null || echo 0)
		queue_drops=$(jsonfilter -i "$meta_file" -e '@.queue_drops' 2>/dev/null || echo 0)
		queue_num=$(jsonfilter -i "$meta_file" -e '@.queue_num' 2>/dev/null || echo 10)
		case "$(jsonfilter -i "$meta_file" -e '@.running' 2>/dev/null)" in
			true|1) running=1 ;;
		esac
	fi
	# process alive counts as running even if meta lagging
	pidof openont-dpi >/dev/null 2>&1 && running=1

	[ -f "$flow_file" ] && flow_entries=$(grep -c . "$flow_file" 2>/dev/null || echo 0)

	# latest sample ratios from history tail (last line apps)
	if [ -f "$HIST_FILE" ]; then
		local last
		last=$(tail -n 1 "$HIST_FILE" 2>/dev/null)
		if [ -n "$last" ]; then
			http=$(echo "$last" | jsonfilter -e '@.http' 2>/dev/null || echo 0)
			video=$(echo "$last" | jsonfilter -e '@.video' 2>/dev/null || echo 0)
			game=$(echo "$last" | jsonfilter -e '@.game' 2>/dev/null || echo 0)
			download=$(echo "$last" | jsonfilter -e '@.download' 2>/dev/null || echo 0)
			fileb=$(echo "$last" | jsonfilter -e '@.file' 2>/dev/null || echo 0)
			im=$(echo "$last" | jsonfilter -e '@.im' 2>/dev/null || echo 0)
			common=$(echo "$last" | jsonfilter -e '@.common' 2>/dev/null || echo 0)
			other_app=$(echo "$last" | jsonfilter -e '@.other_app' 2>/dev/null || echo 0)
			speedtest=$(echo "$last" | jsonfilter -e '@.speedtest' 2>/dev/null || echo 0)
			unknown=$(echo "$last" | jsonfilter -e '@.unknown' 2>/dev/null || echo 0)
		fi
	fi
	total=$((http + video + game + download + fileb + im + common + other_app + speedtest + unknown))
	classified=$((total - unknown))
	[ "$classified" -lt 0 ] && classified=0
	if [ "$total" -gt 0 ]; then
		classified_ratio=$((classified * 100 / total))
		unknown_ratio=$((unknown * 100 / total))
	fi

	json_init
	json_add_string classifier "$engine"
	json_add_string engine "$engine"
	json_add_boolean dpi_running "$running"
	json_add_string dpi_mode "$mode"
	json_add_int flows_seen "${flows_seen:-0}"
	json_add_int flows_classified "${flows_classified:-0}"
	json_add_int queue_pkts "${queue_pkts:-0}"
	json_add_int queue_drops "${queue_drops:-0}"
	json_add_int queue_num "${queue_num:-10}"
	json_add_int flow_entries "${flow_entries:-0}"
	json_add_int classified_ratio "$classified_ratio"
	json_add_int unknown_ratio "$unknown_ratio"
	json_add_int last_sample_total "$total"
	if [ -x /usr/sbin/openont-dpi ]; then
		json_add_boolean binary_present 1
	else
		json_add_boolean binary_present 0
	fi
	json_dump
}

rpc_history() {
	local window="${1:-30}"
	case "$window" in 30|60|1440) ;; *) window=30 ;; esac
	local now cutoff oldest available_sec effective_window rate_cut
	local http=0 video=0 game=0 download=0 fileb=0 im=0 common=0 other_app=0 speedtest=0 unknown=0
	local total=0 classified_ratio=0 unknown_ratio=0
	now=$(date +%s)
	cutoff=$((now - window * 60))
	rate_cut=$((now - 300))
	oldest=0
	available_sec=0
	effective_window=0

	# Single-pass awk: sum apps over window; rate points only last 5 minutes
	local agg_file="$STATS_DIR/history.agg.$$"
	if [ -f "$HIST_FILE" ]; then
		awk -v cut="$cutoff" -v rate_cut="$rate_cut" -v now="$now" '
		function gi(s, key,   re, m) {
			re = "\"" key "\":[0-9]+"
			if (match(s, re)) {
				m = substr(s, RSTART, RLENGTH)
				sub(/.*:/, "", m)
				return m + 0
			}
			return 0
		}
		{
			t = gi($0, "t")
			if (t <= 0) next
			if (oldest == 0 || t < oldest) oldest = t
			if (t < cut) next
			http += gi($0, "http"); video += gi($0, "video"); game += gi($0, "game")
			download += gi($0, "download"); fileb += gi($0, "file"); im += gi($0, "im")
			common += gi($0, "common"); other_app += gi($0, "other_app")
			speedtest += gi($0, "speedtest"); unknown += gi($0, "unknown")
			if (t >= rate_cut) {
				rx = gi($0, "rx_bps"); tx = gi($0, "tx_bps")
				printf "P %d %d %d\n", t, rx, tx
			}
		}
		END {
			printf "A %d %d %d %d %d %d %d %d %d %d\n", http, video, game, download, fileb, im, common, other_app, speedtest, unknown
			printf "O %d\n", oldest
		}
		' "$HIST_FILE" > "$agg_file" 2>/dev/null
	fi

	json_init
	json_add_int window "$window"
	json_add_string unit "bytes"

	if [ -f "$agg_file" ]; then
		while read -r kind a b c d e f g h i j k; do
			case "$kind" in
				A)
					http=$a; video=$b; game=$c; download=$d; fileb=$e
					im=$f; common=$g; other_app=$h; speedtest=$i; unknown=$j
					;;
				O)
					oldest=$a
					;;
			esac
		done < "$agg_file"
		if [ "${oldest:-0}" -gt 0 ] 2>/dev/null; then
			available_sec=$((now - oldest))
			[ "$available_sec" -lt 0 ] && available_sec=0
		fi
	fi

	# effective window in minutes: min(selected, available)
	if [ "$available_sec" -le 0 ] 2>/dev/null; then
		effective_window=0
	else
		local avail_min=$(( (available_sec + 59) / 60 ))
		if [ "$avail_min" -lt "$window" ]; then
			effective_window=$avail_min
		else
			effective_window=$window
		fi
		[ "$effective_window" -lt 1 ] && effective_window=1
	fi

	json_add_int available_sec "$available_sec"
	json_add_int oldest_t "${oldest:-0}"
	json_add_int effective_window "$effective_window"

	json_add_array points
	if [ -f "$agg_file" ]; then
		while read -r kind t rx tx; do
			[ "$kind" = "P" ] || continue
			json_add_object
			json_add_int t "$t"
			json_add_int rx_bps "$rx"
			json_add_int tx_bps "$tx"
			json_close_object
		done < "$agg_file"
	fi
	json_close_array

	json_add_object apps
	json_add_int http "${http:-0}"
	json_add_int video "${video:-0}"
	json_add_int game "${game:-0}"
	json_add_int download "${download:-0}"
	json_add_int file "${fileb:-0}"
	json_add_int im "${im:-0}"
	json_add_int common "${common:-0}"
	json_add_int other_app "${other_app:-0}"
	json_add_int speedtest "${speedtest:-0}"
	json_add_int unknown "${unknown:-0}"
	json_close_object

	total=$((http + video + game + download + fileb + im + common + other_app + speedtest + unknown))
	if [ "$total" -gt 0 ]; then
		classified_ratio=$(( (total - unknown) * 100 / total ))
		unknown_ratio=$(( unknown * 100 / total ))
		[ "$classified_ratio" -lt 0 ] && classified_ratio=0
	fi

	json_add_object meta
	json_add_string classifier "payload-dpi"
	json_add_int classified_ratio "$classified_ratio"
	json_add_int unknown_ratio "$unknown_ratio"
	json_add_int total_bytes "$total"
	if [ -f "$STATS_DIR/dpi_meta.json" ]; then
		json_add_string dpi_raw "$(cat "$STATS_DIR/dpi_meta.json" 2>/dev/null | tr -d '\n')"
	fi
	json_close_object

	rm -f "$agg_file"
	json_dump
}

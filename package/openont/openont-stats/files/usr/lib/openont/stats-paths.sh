# SPDX-License-Identifier: Apache-2.0
# Shared paths for openont-stats / openont-dpi consumers.
# Source: . /usr/lib/openont/stats-paths.sh

[ -n "$OPENONT_STATS_PATHS_LOADED" ] && return 0
OPENONT_STATS_PATHS_LOADED=1

OPENONT_STATS_DIR="${OPENONT_STATS_DIR:-/tmp/openont-stats}"
OPENONT_HIST_FILE="${OPENONT_STATS_DIR}/history.jsonl"
OPENONT_RATES_FILE="${OPENONT_STATS_DIR}/rates.json"
OPENONT_FLOW_FILE="${OPENONT_STATS_DIR}/flow.class"
OPENONT_CONN_STATE="${OPENONT_STATS_DIR}/conn_bytes.state"
OPENONT_DPI_META="${OPENONT_STATS_DIR}/dpi_meta.json"

# Mark contract — keep in sync with buckets.schema / buckets.gen.h
OPENONT_DPI_MARK_SHIFT="${OPENONT_DPI_MARK_SHIFT:-16}"

# Optional shared buckets helper
[ -f /usr/share/openont/buckets.sh ] && . /usr/share/openont/buckets.sh

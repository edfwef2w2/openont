#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-only
# Remove wireless views/deps from a checked-out luci feed (not a runtime hide).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LUCI="${1:-$ROOT/feeds/luci}"

if [ ! -d "$LUCI" ]; then
	echo "strip-luci-wireless: no luci feed at $LUCI (skip)" >&2
	exit 0
fi

# Drop iwinfo hard deps so luci-mod-status/network build without libiwinfo.
find "$LUCI" -name Makefile -print0 | while IFS= read -r -d '' mk; do
	grep -q 'iwinfo' "$mk" 2>/dev/null || continue
	# portable in-place: rewrite via temp
	tmp="${mk}.nowifi"
	sed -e 's/ *+libiwinfo-lua//g' \
	    -e 's/ *+libiwinfo//g' \
	    -e 's/ *+rpcd-mod-iwinfo//g' \
	    -e 's/ *+iwinfo//g' \
	    -e 's/PKG_BUILD_DEPENDS:=iwinfo/PKG_BUILD_DEPENDS:=/' \
	    "$mk" > "$tmp"
	mv "$tmp" "$mk"
done

# Delete wireless UI sources (pages, not menu "enabled: false").
find "$LUCI" \( \
	-name 'wireless.js' -o \
	-name 'wifi.js' -o \
	-name 'channel_analysis.js' \
\) -type f -print0 | while IFS= read -r -d '' f; do
	rm -f "$f"
done

# Strip wireless keys from luci menu JSON.
PY=python3
command -v python3 >/dev/null 2>&1 || PY=python
"$PY" - "$LUCI" <<'PY'
import json, os, sys
root = sys.argv[1]
drop_keys = {
    "admin/network/wireless",
    "admin/status/realtime/wireless",
    "admin/status/channel_analysis",
}
for dirpath, _, files in os.walk(root):
    for name in files:
        if not name.endswith(".json"):
            continue
        path = os.path.join(dirpath, name)
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        changed = False
        for k in list(data.keys()):
            if k in drop_keys or k.endswith("/wireless") or "channel_analysis" in k:
                del data[k]
                changed = True
        if changed:
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                json.dump(data, fh, indent="\t")
                fh.write("\n")
PY

echo "strip-luci-wireless: removed wireless sources under $LUCI"

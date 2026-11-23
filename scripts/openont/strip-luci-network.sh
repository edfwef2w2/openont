#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-only
# Remove the stock interface, switch and DHCP/DNS pages from a checked-out
# luci feed. OpenONT serves Network -> Interfaces and Network -> DHCP itself
# (luci-mod-openont views openont/network and openont/dhcp under the same
# menu paths), so the stock pages would be a second, conflicting editor of
# the same network/dhcp config. Routes and diagnostics stay.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LUCI="${1:-$ROOT/feeds/luci}"

if [ ! -d "$LUCI" ]; then
	echo "strip-luci-network: no luci feed at $LUCI (skip)" >&2
	exit 0
fi

VIEWS="$LUCI/modules/luci-mod-network/htdocs/luci-static/resources/view/network"
for v in network.js switch.js dhcp.js hosts.js; do
	rm -f "$VIEWS/$v"
done

PY=python3
command -v python3 >/dev/null 2>&1 || PY=python
"$PY" - "$LUCI/modules/luci-mod-network" <<'PY'
import json, os, sys
root = sys.argv[1]
drop = {
    "admin/network/network",
    "admin/network/switch",
    "admin/network/dhcp",
    "admin/network/hosts",
}
for dirpath, _, files in os.walk(root):
    for name in files:
        if not name.endswith(".json") or "menu.d" not in dirpath:
            continue
        path = os.path.join(dirpath, name)
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            continue
        keys = [k for k in data if k in drop]
        if not keys:
            continue
        for k in keys:
            del data[k]
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(data, fh, indent="\t")
            fh.write("\n")
        print("strip-luci-network: %s: dropped %s" % (path, ", ".join(sorted(keys))))
PY

echo "strip-luci-network: removed stock interface/DHCP pages under $LUCI"

#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-only
# Apply an OpenONT seed configuration.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

TARGET="${1:-x86_64}"

case "$TARGET" in
	x86_64|x86/64)
		SEED="$ROOT/configs/openont-x86_64.config"
		;;
	armsr|armsr_armv8|armsr/armv8)
		SEED="$ROOT/configs/openont-armsr_armv8.config"
		;;
	*)
		echo "Usage: $0 <x86_64|armsr_armv8>" >&2
		exit 1
		;;
esac

COMMON="$ROOT/configs/openont.common.config"
[ -f "$SEED" ] || { echo "missing seed: $SEED" >&2; exit 1; }
[ -f "$COMMON" ] || { echo "missing common: $COMMON" >&2; exit 1; }

cat "$SEED" "$COMMON" > "$ROOT/.config"
make defconfig

echo "OpenONT config ready for target=$TARGET"

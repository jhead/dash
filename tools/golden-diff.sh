#!/usr/bin/env bash
# golden-diff.sh — build swf-dump (if needed) and run the golden FLA/SWF diff.
#
# Task 0698: structural diff of our SWF export vs Flash 8's reference export.
#
# Usage:
#   tools/golden-diff.sh <golden.fla> <golden.swf> [--tolerance <twips>]
#
# Prerequisites:
#   - @flash/core and @flash/swf must be built (pnpm -r build) so the
#     harness can import their dist/ entry points.
#   - Rust toolchain (cargo) available for building swf-dump.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DUMP_BIN="$HERE/swf-dump/target/debug/swf-dump"

if [[ ! -x "$DUMP_BIN" ]]; then
  echo "golden-diff: building swf-dump..." >&2
  ( cd "$HERE/swf-dump" && cargo build )
fi

exec node "$HERE/golden-diff.mjs" "$@"

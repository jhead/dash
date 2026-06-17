#!/usr/bin/env bash
# Build flashdrv: Win7 x86 server (.exe) + native client.
#
# Requires Zig 0.14.1 (NOT 0.16 — its networking is mid-reform). Point ZIG at it:
#   ZIG=/path/to/zig-0.14.1/zig ./build.sh
# To fetch 0.14.1:
#   curl -sL https://ziglang.org/download/0.14.1/zig-aarch64-macos-0.14.1.tar.xz | tar xJ
set -euo pipefail
cd "$(dirname "$0")"

ZIG="${ZIG:-zig}"
ver="$("$ZIG" version)"
case "$ver" in
  0.14.*) ;;
  *) echo "WARNING: expected Zig 0.14.x, got $ver — may not compile / may not run on Win7" >&2 ;;
esac

mkdir -p ../../dist
# -fsingle-threaded is REQUIRED for Win7: the default multi-threaded build pulls in
# ntdll RtlWaitOnAddress (futex/lock machinery), which is Windows 8+. We never spawn
# threads (one connection at a time), so single-threaded is correct anyway.
echo "[server] x86-windows-gnu (Win7) ..."
"$ZIG" build-exe flashdrv.zig -target x86-windows-gnu -O ReleaseSafe -fsingle-threaded -femit-bin=../../dist/flashdrv.exe
echo "[client] native ..."
"$ZIG" build-exe flashdrv.zig -O ReleaseSafe -fsingle-threaded -femit-bin=../../dist/flashdrv

# drop compiler side-artifacts
rm -f ../../dist/*.obj ../../dist/*.o ../../dist/*.pdb

echo "done:"
echo "  dist/flashdrv.exe  -> copy to the Win7 VM, run: flashdrv.exe serve"
echo "  dist/flashdrv      -> drive from the Mac:        flashdrv run/ping"

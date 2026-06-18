# FLA Binary Format — Reverse-Engineering Plan

Goal: bottom out the remaining `[I]`/`[O]`/`[X]` gaps in `docs/21-fla-binary-format.md`
by using a real Flash 8 install (Win7 VM) as a differential oracle.

## Core idea

Flash 8 itself is the oracle. We drive it with **JSFL** (JavaScript that runs *inside*
the Flash IDE — Flash does the writing, not us) to emit FLAs that differ by exactly one
property, then byte-diff them on the host to decode each field.

- This retires the entire `[I]`/`[O]` column. True `[X]` semantics (CPicSwf tail,
  CPicObjBase.flags meaning, Contents walk) still need flash.exe decompilation later —
  out of scope for phase 1.

## Transport decision

- ❌ Shared folder — unreliable in this VM.
- ✅ **Client/server pair in Go.** Server runs *in* the VM, client drives from the Mac.
  Files move over HTTP; nothing crosses a share.

### Language: Zig (pinned 0.14.1)
- Best-in-class cross-compile: `-target x86-windows-gnu` → PE32 for Win7 x86, from arm64 mac, zero hassle.
- Single static `.exe`, no runtime deps.
- **Pin Zig 0.14.1.** NOT 0.16 — 0.16 moved all networking under the half-finished
  `std.Io` async reform (every listen/connect/read needs an `io: Io`), poorly documented
  and risky on Windows. 0.14.1 has the classic, battle-tested `std.net`
  (`Address.listen` → `Server.accept` → `Connection.stream` with plain `read`/`writeAll`),
  pre-writergate. Verified: all needed APIs (net + `process.Child` + `fs` absolute helpers)
  cross-compile clean to `x86-windows-gnu`.
- Toolchain: `/tmp/zig-aarch64-macos-0.14.1/zig` (downloaded from ziglang.org); build via `ZIG` env var.
- Archive format: custom `[u32 nameLen][name][u32 dataLen][data]…` (no std zip writer in 0.14); HTTP/1.1 so it's curl-testable.

### Win7 ABI gotchas (hard-won — building PE32 is NOT enough)
Zig std silently pulls in Win8+ ntdll calls; each surfaces as a runtime
"entry point not found in ntdll.dll" on Win7. Two hit us:
- `std.time.milliTimestamp()` → `RtlGetSystemTimePrecise` (Win8+). Use `std.time.Timer`
  (QueryPerformanceCounter, XP+) for elapsed-time instead.
- default multi-threaded build → `RtlWaitOnAddress` (Win8+, futex/lock machinery). Build
  with **`-fsingle-threaded`** (correct anyway — server is single-connection, no threads).
Verify after every rebuild by dumping the PE import table and checking no symbol is Win8+.
Both flags/fixes are baked into `tools/flashdrv/build.sh`.

Plus a runtime (not import-table) trap:
- Winsock: `std.net` auto-inits WSA on the client connect path but NOT the server listen
  path → explicit `WSAStartup(2,2)` at startup.
- `std.net.Address.listen` passes `SOCK.CLOEXEC` → `posix.socket` passes
  `WSA_FLAG_NO_HANDLE_INHERIT` to `WSASocketW`, **which needs Win7 SP1**. The test VM is
  build 7600 (RTM, no SP1) → `error.Unexpected`. Fix: custom `listenNoCloexec()` that
  creates the socket without CLOEXEC (flags=0). `accept()` is unaffected (Windows accept
  takes no flags). These are runtime-only — the import audit won't catch them.

### Architecture
- **Server (Win7, `flashdrv.exe serve`):** HTTP server. On `POST /run` with a JSFL body:
  1. wipe local scratch out-dir (`C:\flashdrv\out`)
  2. wrap script (inject `OUT` uri global + try/catch + `__ERROR__`/`__DONE__` sentinels + `fl.quit`)
  3. write `job.jsfl`, launch `Flash.exe job.jsfl`
  4. poll for `__DONE__` sentinel up to timeout (don't trust process exit — Flash is single-instance)
  5. on done → zip all out-dir files, return; on timeout → `taskkill /IM Flash.exe /F`, 504
- **Client (Mac, `flashdrv run`):** POST script, unzip response to `--out` dir. Plus `ping`.

### Protocol
- `GET /ping` — health.
- `POST /run?timeout=N` — body = JSFL text; response = `application/zip` of outputs;
  `X-Flashdrv-Error` header carries any JSFL exception text.

## VM prep (one-time)
- Flash 8 Prefs → General → "On launch: No document" (kills Welcome screen that blocks scripts).
- Dismiss activation / crash-recovery dialogs once.
- Needs an interactive logged-in desktop (Flash is GUI; can't be a service).
- Firewall: allow flashdrv.exe on first run, or
  `netsh advfirewall firewall add rule name=flashdrv dir=in action=allow protocol=TCP localport=8080`.
- Network: bridged adapter (VM gets LAN IP → `--server http://<vmip>:8080`) OR
  NAT port-forward host:8080→guest:8080 (`--server http://localhost:8080`).

## Smoke test (validate before building the full harness)
The one unverified assumption: does `Flash.exe foo.jsfl` execute the script on this install?
- First milestone: `flashdrv ping` works, then a trivial `/run` script that writes one file
  comes back through the client.
- Fallback if command-line JSFL doesn't fire: drop script into
  `…\Flash 8\<lang>\Configuration\Commands\` and trigger via menu / `fl.runScript`, or
  AutoHotkey to drive the menu.

## Differ (host side)
FLAs are noisy (timestamps/GUIDs). Decode via:
1. **Noise mask** — save the same input twice; self-diff = volatile byte ranges to ignore.
2. **Signal** = `(mutant XOR baseline) & ~mask`, paired with the specimen's `.meta` JSON.
3. **Ramp, don't toggle** — emit a field at 0,1,2,…,max to reveal enum vs bitfield vs fixed-point.
Decoded fields become regression fixtures.

## First gaps to target (highest value, all JSFL-reachable)
1. Symbol linkage 4 flag bytes order (`[I]`, only all-false verified) — §6.3
2. `CPicVideo` whole record (`[I]`, **no sample exists**) — import an FLV
3. scale9Grid 20-byte block (`[O]`) — set a known grid
4. Custom ease-curve point format (`[O]`) — `setCustomEase`
5. `Font N` interior fields (`[X]`)
6. Accessibility byte layout (`[I]`)

## HARNESS IS OPERATIONAL ✅ (verified 2026-06-15)

Full round-trip proven: Mac client → HTTP → Win7 VM (192.168.64.2:8080) → real Flash 8
(`fl.version` = WIN 8,0,0,478) → genuine OLE2 FLA (magic `d0cf 11e0 a1b1 1ae1`) → archived
back to the Mac. An empty `fl.createDocument()` saves to a **20,992-byte** FLA.

Deployed server: **v4** (`flashdrv ping` must report `flashdrv v4 (warm + dirty-on-save)`;
bump VERSION on every redeploy to confirm the right build is live — we lost time twice to a
stale exe still serving).

### Noise floor (measured) — the differ's foundation
Two identical empty-doc saves in one run differ by **only 8 bytes**, at 1-indexed offsets
`1645,1646,1647` · `3211,3212` · `3692,3696,3760` (timestamps / a GUID). Everything else is
deterministic. **Offsets are doc-shape-dependent** → compute the mask per specimen-shape at
run time (save the SAME input twice, diff), never hardcode these.

### JSFL save contract (hard-won)
- `fl.saveDocument(doc, uri)` returns **false** for an UNMODIFIED doc (no throw, no file).
  `flashdrvSave` handles it: try save; if false, add+delete a layer (content-neutral dirty)
  and retry. Real generators modify the doc anyway → first save wins, zero pollution.
- `fl.saveDocumentAs(doc, uri)` **pops a modal dialog** (ignores URI) → unusable headless.
- URI MUST be `file:///C|/...`. A bare `C:\...` path throws a **fatal, uncatchable
  "Invalid URI"** that halts the whole script before the sentinels.
- Keep Flash **warm** (don't `fl.quit` between runs): cold launch hits the registration
  nag / incomplete-init state where saves silently fail. Launch Flash by hand once and
  dismiss registration before a batch; `--quit` only on the final run.

### Operational workflow (to run the plan)
1. VM: Flash 8 open (registration dismissed); `flashdrv.exe serve --flash "C:\Program Files (x86)\Macromedia\Flash 8\Flash.exe"`.
   (Flash is under **Program Files (x86)** — 64-bit Win7 RTM, build 7600.)
2. Mac: `./dist/flashdrv ping --server http://192.168.64.2:8080` → expect `v4`.
3. Generate: `./dist/flashdrv run --server http://192.168.64.2:8080 --script gen.jsfl --out ./corpus/<gap>`.
4. Diff: noise-mask + signal (see below).

## Status / next steps
- [x] Build flashdrv (Win7 x86 server + mac client) — `tools/flashdrv/`
- [x] Cleared 5 Win7 traps (see above). PE import audit: `tools/flashdrv/peimp.py`.
- [x] Smoke test against REAL Flash 8 PASSED.
- [x] Noise floor measured (~8 bytes).
- [x] Host-side per-stream differ `tools/flashdrv/fladiff.py` (+ dependency-free CFB reader
      `fla_cfb.py`). Diffs INSIDE each CFB stream (Contents/Page/Symbol) so offsets are
      stream-relative and CFB-container noise is excluded — far better than whole-file XOR.
- [x] Stage block decoded & oracle-verified (`jsfl/stage.jsfl` → `corpus/stage`): width@407
      u16*20 twips, height@415 u16*20, bg@456 RGB, fps@466 u8 (8.8). See docs/21 §6.6.
- [x] **All remaining gaps resolved from the byte-verified writer flacomdoc** (cloned to
      `tools/refs/flacomdoc`, cross-checked vs `tools/refs/fla-decoder`). 5 parallel agents
      mined FlaConverter/TimelineConverter/FlaWriter; findings folded into docs/21 (every
      [I]/[O]/[X] → [V] except the bounded CPicSwf body). Authoritative F8 schema table
      computed in `findings/schema-F8.md` (`findings/dump_schema.py`) — both agents had
      positional errors in this table, so it was machine-computed.
- [x] READ proof: `flaparse.py` parses the full document catalog + CArchive class inventory
      of Magnet/golden/evaporatingdrip (`findings/read-proof.txt`).
- [x] WRITE proof: `flapatch.py` rewrites §6.6 stage fields by the spec; **real Flash 8 reads
      our bytes back exactly** (640×480, fps 30, bg #123456) — `findings/write-proof.txt`.

## What worked / what did NOT (hard-won)
- **JSFL linkage edits HANG session-0 Flash.** Setting linkage (even AS-export, no RS) pops a
  modal that headless/session-0 Flash can't dismiss → the whole batch times out. `addNewItem`,
  stage props, and shapes are modal-free and fine. Linkage (§6.4) is therefore verified from
  flacomdoc + the read side, NOT the oracle.
- **flacomdoc >> oracle for STRUCTURAL layout.** The differential oracle is great for confirming
  a single field's offset/encoding (stage block) but slow and modal-prone for whole records. The
  byte-verified writer gives the entire field order at once; the oracle's best use is spot-checks
  + the write round-trip proof.
- **The server SSH session dying kills the server.** Run it via a long-lived background SSH
  keyed to a NON-passphrase key. The ed25519 key is now in the VM authorized_keys
  (`administrators_authorized_keys`) for durable access independent of the agent.
- **Verify agent output against real bytes.** Both mining agents mis-mapped the FlaFormatVersion
  positional row (asLinkageVersion 4-vs-2, really 7); the scene tag string is unicode "Page N"
  not ASCII "P <n> <time>". Always cross-check the writer claims against a real FLA.

## Residual
- `CPicSwf` (imported-SWF) body — flacomdoc has no SWF-import writer; ~950–5500 B, only the
  matrix recoverable; derives from CPicObj. Out of the authoring round-trip (reader resyncs
  past it). Magnet.fla DOES contain samples (symbols "Claw.swft"/"claw2.swft") if a future
  Ghidra/diff pass wants to bottom it out. docs/21 §16.3.

## Out of scope (phase 2)
- Full `CPicSwf` body decode (Ghidra at VA 0x9490400, or diff Magnet's CPicSwf records).
- Live debugger tie-breaking for resync-prone tails.

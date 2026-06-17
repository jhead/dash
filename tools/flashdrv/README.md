# flashdrv

Drive a real **Flash 8** install (in a Win7 VM) as a differential FLA oracle, over HTTP —
no shared folder. The server runs *in the VM* and does all file I/O locally; FLAs travel
back to the Mac as an HTTP response. See `../../FLA-RE-PLAN.md` for the why.

```
Mac (client)                         Win7 VM (server)
  flashdrv run  ──POST /run (jsfl)──▶  write job.jsfl ─▶ launch Flash.exe
                                       poll __DONE__ sentinel
  corpus/*.fla  ◀──── archive ───────  zip out\*.fla
```

## Build

Requires **Zig 0.14.1** (not 0.16 — its networking moved under the half-finished `std.Io`
reform). Fetch it and build:

```bash
curl -sL https://ziglang.org/download/0.14.1/zig-aarch64-macos-0.14.1.tar.xz | tar xJ
ZIG=./zig-aarch64-macos-0.14.1/zig ./build.sh
# -> dist/flashdrv.exe (Win7 x86 server), dist/flashdrv (mac client)
```

## Run

**In the VM** (one-time prep): Flash 8 → Preferences → General → *On launch: No document*
(kills the Welcome screen that blocks scripted launches); dismiss any activation/crash
dialogs once. Flash needs an interactive logged-in desktop.

Copy `flashdrv.exe` over, then:

```bat
flashdrv.exe serve
:: defaults: --addr 0.0.0.0:8080  --flash "C:\Program Files\Macromedia\Flash 8\Flash.exe"  --workdir C:\flashdrv
```

Firewall: allow it on first run, or
`netsh advfirewall firewall add rule name=flashdrv dir=in action=allow protocol=TCP localport=8080`.

**From the Mac** (`<VMIP>` = the VM's address; bridged adapter, or NAT port-forward → use localhost):

```bash
flashdrv ping --server http://<VMIP>:8080
flashdrv run  --server http://<VMIP>:8080 --script gen.jsfl --out ./corpus
echo 'var d=fl.createDocument(); flashdrvSave(d,"hello");' | flashdrv run --server http://<VMIP>:8080 --script - --out ./corpus
```

## JSFL contract

Your script runs wrapped: a global `OUT` (the server's output dir as a `file:///` URI) is
predefined, plus a helper `flashdrvSave(doc, name)` (saves `OUT+name+".fla"` and closes the
doc). **Write every artifact under `OUT`.** Don't call `fl.quit` yourself. Any thrown error
is caught and returned in the `X-Flashdrv-Error` response header. Everything the script
writes to `OUT` (except the `__DONE__`/`__ERROR__` control files) is archived back to `--out`.

**Flash stays warm between runs by default** (the wrapper does NOT quit Flash). This is both
faster for batches and necessary for correctness: a *cold* Flash launch comes up in a state
(registration nag / incomplete init) where `fl.saveDocument` silently returns `false` and no
FLA is written. Keep Flash open. Pass `--quit` (client) / `?quit=1` (HTTP) on the last run to
close it. **Before a batch, launch Flash 8 once by hand and dismiss the registration dialog**
so the first request hits a warm, past-nag instance.

URI note: `fl.saveDocument` requires a real `file:///C|/...` URI — a bare Windows path
(`C:\...`) throws a fatal, uncatchable "Invalid URI" that halts the whole script. `flashdrvSave`
/ `OUT` already use the correct form.

## Protocol

- `GET /ping` → text health check.
- `POST /run?timeout=N` — body = JSFL; response = archive of produced files
  (`application/x-flashdrv`: repeated `[u32 nameLen][name][u32 dataLen][data]`, little-endian).
  `X-Flashdrv-Count` = file count; `X-Flashdrv-Error` = JSFL exception, if any. On no
  `__DONE__` within N seconds the server kills Flash and returns `504`.

## Status

**Operational** — verified end-to-end against real Flash 8 in a Win7 VM (2026-06-15): JSFL
executes, a genuine OLE2 FLA round-trips Mac→VM→Flash→Mac, noise floor ≈8 bytes per save.
See `../../FLA-RE-PLAN.md` for the full findings, the Win7/JSFL gotchas, and next steps
(noise-mask differ + the first differential generator).

`peimp.py` dumps the PE import table — run it after any rebuild to confirm no Win8+ symbols
crept in (`python3 peimp.py ../../dist/flashdrv.exe`). `jsfl/` holds reusable scripts
(`noise.jsfl` = the noise-floor probe to run before each batch).

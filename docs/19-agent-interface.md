# 19 — Agent Control Interface (`flash-agent` CLI + RPC bridge)

A live remote-control surface for the authoring tool: a CLI (and underlying JSON-RPC
protocol) that connects to a **running editor instance** and manipulates the stage,
timeline, scripts, library, document properties, selection, and publishing — without
Playwright, without screenshots-as-input, without synthesizing pointer events.

This extends `18-verification-and-automation.md`: Layer 2's `__flashTest` bridge and
Layer 4's JSFL surface are *in-page* APIs reachable only through a browser automation
harness. This doc adds the missing transport — a way for any out-of-process agent
(an LLM in a terminal, a script, another tool) to reach those same capabilities over a
socket, plus a typed command surface and a CLI front-end.

## Why this exists

- **Playwright is the wrong altitude for editing.** Driving the UI through pointer
  events is the right way to *test the UI*, but the wrong way to *use the editor as a
  tool*. An agent that wants "a 100×50 red rectangle on layer 2, frame 5, with
  `stop();` on frame 5" should say exactly that, get a structured success/error back,
  and read the resulting document state as JSON.
- **Sessions, not snapshots.** `runJSFL` via `page.evaluate` requires owning the
  browser. The agent interface lets a human keep the editor open (Tauri or browser)
  while one or more agents connect, inspect, and mutate the *same live session* — the
  document the human is looking at updates in real time, with every agent mutation in
  the undo history.
- **Text in, text out.** Per the doctrine in doc 18: every behavior must be assertable
  as text or structure first. All commands return structured JSON; screenshots and
  published SWF bytes are available but supplementary.

## Architecture

The editor page runs in a browser context (Tauri webview or plain browser); it cannot
listen on a port. The Vite dev server already owns port **1420** and proxies the page.
So the bridge is a **relay inside the Vite dev server**, with two WebSocket roles:

```
flash-agent CLI ──ws──► ws://localhost:1420/__agent (role=client) ─┐
                                                                   │  Vite plugin relay
                                                                   │  (vite-plugin-agent-bridge)
Editor page ───────ws──► ws://localhost:1420/__agent (role=editor) ┘
        │
        ▼
AgentCommandRegistry (authoring-ui)
        │  typed commands; same command layer the UI uses
        ▼
@flash/core mutations ──► pushDoc() ──► history, React re-render
```

- **`vite-plugin-agent-bridge`** (in `apps/desktop/vite.config.ts`): hooks the dev
  server's HTTP `upgrade` event for path `/__agent`, accepts WebSocket connections,
  and relays JSON-RPC frames between the single registered `editor` socket and any
  number of `client` sockets. The relay is dumb: it routes, tags requests with client
  ids so responses return to the right caller, and reports "no editor connected" /
  "editor disconnected" errors. It holds no document state.
- **Editor-side client** (`packages/authoring-ui/src/agent/`): when
  `import.meta.env.DEV` or `VITE_FLASH_TEST=1`, the Shell opens a WebSocket to
  `/__agent?role=editor`, registers, and dispatches incoming requests to the
  **AgentCommandRegistry**. Reconnects with backoff if the socket drops (e.g. Vite
  restart).
- **AgentCommandRegistry** (`packages/authoring-ui/src/agent/registry.ts`): a typed
  map of `method → handler`. Handlers close over the same state and callbacks the
  Shell already wires into `__flashTest` (current doc, `pushDoc`, selection setters,
  view-state setters, `runJSFL`, `publish`, `screenshotStage`). **Rule:** handlers go
  through the shared command layer — `@flash/core` mutations + `pushDoc()` +
  the Shell's selection/view setters. Never poke component internals, never mutate
  the document outside history.
- **`flash-agent` CLI** (`packages/agent-cli`, bin name `flash-agent`): a Node CLI
  that connects as `role=client`, sends one request (or a batch / an interactive
  session), prints structured output, and exits with a meaningful code.

### Why a relay instead of a new server

- No new port, no new daemon: anything that can reach the dev server can reach the
  bridge, and the Playwright e2e suite (which already auto-starts Vite on 1420) can
  test it with zero infra changes.
- Works identically in browser-mode Vite and `tauri dev` (Tauri's webview loads the
  same dev URL).
- **Non-goal (MVP):** packaged Tauri builds (no Vite). The follow-up is a small WS
  server in `src-tauri` exposing the same protocol; the editor-side client and CLI
  are transport-agnostic (a URL), so nothing else changes.

### Security

Dev-tool posture, same as `__flashTest`:
- The relay binds to localhost only and is registered only by the dev-server plugin.
- The editor-side client only starts in dev mode or under `VITE_FLASH_TEST=1`.
- Optional shared token: if `FLASH_AGENT_TOKEN` is set in the dev server's env,
  clients must present it (`?token=` or first-frame auth) — useful when port 1420 is
  forwarded. Not required for MVP local use.

## Protocol

JSON-RPC 2.0 over WebSocket, one JSON object per text frame.

```jsonc
// request (client → editor, via relay)
{ "jsonrpc": "2.0", "id": 7, "method": "timeline.insertKeyframe",
  "params": { "layerId": "layer-2", "frameIndex": 4 } }

// success
{ "jsonrpc": "2.0", "id": 7, "result": { "ok": true, "rev": 42 } }

// error
{ "jsonrpc": "2.0", "id": 7, "error": { "code": -32602,
  "message": "no layer with id 'layer-2'", "data": { "knownLayerIds": ["..."] } } }
```

Conventions:
- **`rev`**: the editor maintains a monotonically increasing document revision counter
  (bumped on every `pushDoc`). Every mutating result includes the new `rev`; reads
  include the `rev` they observed. Lets agents detect concurrent edits cheaply.
- **Errors are actionable**: messages name the bad parameter and, where cheap, include
  valid alternatives in `error.data` (known layer ids, valid tool ids, frame bounds).
  An LLM should be able to self-correct from the error alone.
- Relay-level errors (no editor connected, editor timeout) use reserved codes in the
  `-32000` range with distinct messages.
- Shared types live in `packages/agent-protocol` (`@flash/agent-protocol`): request/
  response envelopes, method param/result types, error codes. Both the editor client
  and the CLI depend on it; the Vite plugin treats frames as opaque.

## Command surface (MVP)

Grouped by domain. Coordinates are stage coordinates (px). Colors are `#RRGGBB` or
`#RRGGBBAA` strings at the protocol boundary (converted to/from model `RGBA` inside).
All frame indices are 0-based (the CLI may render 1-based for humans, but the protocol
is 0-based, matching the model).

### Session & document

| Method | Params | Result |
|--------|--------|--------|
| `editor.ping` | — | `{ ok, version, rev }` |
| `editor.info` | — | document name, size, fps, bg color, scene count, edit context, active tool, `rev` |
| `doc.get` | `{ path? }` (JSON-pointer-ish, e.g. `/scenes/0/timeline/layers/1`) | the (sub)document as JSON |
| `doc.summary` | — | token-light outline: scenes → layers (id, name, type, frameCount) → keyframes (index, objectCount, hasScript, tween), library item list. **This is the default "look around" call** — `doc.get` on a real document can be huge. |
| `doc.load` | `{ document }` | replace the document (pushes to history) |
| `doc.properties.set` | `{ width?, height?, frameRate?, backgroundColor? }` | `{ ok, rev }` |
| `history.undo` / `history.redo` | — | `{ ok, rev }` |
| `history.depth` | — | `{ undo, redo }` |

### Stage & selection

| Method | Params | Result |
|--------|--------|--------|
| `stage.addShape` | `{ kind: "rect"\|"oval"\|"line", bounds/points, fill?, stroke?, layerId?, frameIndex? }` | `{ id, rev }` (defaults: active layer, current frame) |
| `stage.addText` | `{ x, y, width, height, text, textType?, fontFamily?, fontSize?, color?, ... }` | `{ id, rev }` |
| `stage.placeInstance` | `{ symbolId, x, y, name? }` | `{ id, rev }` |
| `stage.update` | `{ id, updates }` (x/y/scale/rotation/alpha/name/filters/text props…) | `{ ok, rev }` |
| `stage.remove` | `{ ids }` | `{ ok, rev }` |
| `stage.arrange` | `{ ids, op: "front"\|"back"\|"forward"\|"backward" }` | `{ ok, rev }` |
| `stage.group` / `stage.ungroup` | `{ ids }` | `{ ok, rev }` |
| `selection.get` | — | selected ids + their objects |
| `selection.set` | `{ ids }` / `selection.clear` / `selection.all` | `{ ok }` |
| `view.set` | `{ zoom?, panX?, panY?, currentFrame?, activeLayerId? }` | `{ ok }` |
| `tool.select` | `{ toolId }` | `{ ok }` |

### Timeline

| Method | Params | Result |
|--------|--------|--------|
| `timeline.addLayer` | `{ name?, type? }` | `{ layerId, rev }` |
| `timeline.removeLayer` | `{ layerId }` | `{ ok, rev }` |
| `timeline.updateLayer` | `{ layerId, name?, locked?, visible?, type? }` | `{ ok, rev }` |
| `timeline.insertFrame` / `insertKeyframe` / `insertBlankKeyframe` / `removeFrame` | `{ layerId, frameIndex }` | `{ ok, rev }` |
| `timeline.setFrameLabel` | `{ layerId, frameIndex, label, labelType? }` | `{ ok, rev }` |
| `timeline.setTween` | `{ layerId, frameIndex, kind: "motion"\|"shape"\|null, props? }` | `{ ok, rev }` |
| `timeline.gotoFrame` | `{ frameIndex }` | `{ ok }` |
| `playback.play` / `playback.stop` | — | `{ ok }` |

### Code (AS2)

| Method | Params | Result |
|--------|--------|--------|
| `script.get` | `{ layerId, frameIndex }` | `{ script }` (from governing keyframe) |
| `script.set` | `{ layerId, frameIndex, script }` | `{ ok, rev, diagnostics }` — runs the AS2 compiler (`compileScript`) in check mode and returns syntax errors as diagnostics **without blocking the set** (Flash 8 lets you save broken scripts; the agent still gets immediate feedback) |
| `script.check` | `{ script }` | `{ diagnostics }` — compile-check without mutating |
| `script.list` | — | all `(sceneIndex, layerId, frameIndex)` triples that carry scripts, with first-line previews |

### Library & symbols

| Method | Params | Result |
|--------|--------|--------|
| `library.list` | — | items (id, name, type, folder) |
| `library.createSymbol` | `{ name, symbolType }` | `{ symbolId, rev }` |
| `library.convertToSymbol` | `{ ids, name, symbolType }` | `{ symbolId, instanceId, rev }` |
| `library.rename` / `library.remove` | `{ itemId, name? }` | `{ ok, rev }` |

### Output & escape hatches

| Method | Params | Result |
|--------|--------|--------|
| `jsfl.run` | `{ source }` | `JsflResult` (`traces`, `returnValue`, `error`); mutations land in history |
| `stage.screenshot` | `{ frameIndex? }` | `{ pngBase64, width, height }` (reuses `screenshotStage()`, 1:1 DPR, background-composited) |
| `publish.swf` | — | `{ swfBase64, byteLength }` |
| `file.saveFla` / `file.loadFla` | `{ flaBase64? }` | bytes / `{ ok, rev }` (in-memory, no native dialogs) |

`jsfl.run` is the deliberate escape hatch: anything not yet covered by a typed method
is reachable by script, and grows the on-theme JSFL surface (doc 18, Layer 4) instead
of an ad-hoc one. Typed methods are preferred where they exist because they validate
params and return actionable errors.

## The `flash-agent` CLI

`packages/agent-cli`, bin `flash-agent` (workspace-linked; run as
`pnpm --filter @flash/agent-cli exec flash-agent …` or via a root script alias).
Node ≥ 18, dependencies kept minimal (`ws` + a tiny arg parser).

```
flash-agent [--url ws://localhost:1420/__agent] [--json] <command> [args]

SESSION
  status                          editor.ping + editor.info, human-readable
DOCUMENT
  doc summary                     token-light outline (default way to look around)
  doc get [<json-pointer>]        full or partial document JSON
  props set --width N --height N --fps N --bg '#RRGGBB'
  undo / redo
STAGE
  add rect  --x1 --y1 --x2 --y2 [--fill '#f00'] [--stroke '#000,1'] [--layer ID] [--frame N]
  add oval  ... / add line ... / add text --x --y --text "..."
  place <symbolId> --x --y [--name inst1]
  update <objectId> --set x=120 --set rotation=45 ...
  remove <objectId...>
  select <objectId...> | select --all | select --none
TIMELINE
  layer add [--name N] / layer rm <id> / layer set <id> --locked ...
  frame insert|keyframe|blank|rm --layer <id> --frame <n>
  tween set --layer <id> --frame <n> --kind motion|shape
  goto <frame>  /  play  /  stop
CODE
  script list
  script get --layer <id> --frame <n> [-o file.as]
  script set --layer <id> --frame <n> [file.as | --eval 'stop();']   (prints diagnostics)
  script check [file.as | --eval '...']
LIBRARY
  lib list / lib create-symbol --name N --type movieclip
  lib convert <objectId...> --name N --type movieclip
OUTPUT
  screenshot [-o stage.png] [--frame N]
  publish [-o out.swf]
  save [-o project.fla] / open <project.fla>
SCRIPTING
  jsfl <file.jsfl>  |  jsfl --eval 'fl.trace(doc.width)'
  repl                            interactive line-per-command session (keeps one socket)
```

Conventions:
- **`--json`** on any command prints the raw RPC result (one JSON object, stdout) —
  the mode agents should use. Default output is concise human-readable text.
- **Exit codes:** 0 success; 1 RPC-level error (bad params, unknown id); 2 transport
  error (no dev server / no editor connected — message says exactly which, and how to
  start it: `pnpm --filter @flash/desktop dev`).
- Binary results (`screenshot`, `publish`, `save`) are written to files, never dumped
  to stdout (unless `--json`, which keeps base64).
- IDs everywhere: commands accept the model's stable ids (`layerId`, object `id`,
  `symbolId`) as printed by `doc summary` / `lib list`. No name-based fuzzy matching
  in MVP (names are not unique).

### Agent workflow example

```bash
flash-agent status                       # editor alive? doc name, size, rev
flash-agent doc summary --json           # orient: scenes/layers/keyframes/library
flash-agent add rect --x1 100 --y1 100 --x2 200 --y2 150 --fill '#FF0000'
flash-agent frame keyframe --layer layer-1 --frame 4
flash-agent script set --layer layer-1 --frame 4 --eval 'stop();'
flash-agent doc get /scenes/0/timeline/layers/0 --json   # assert structure
flash-agent screenshot -o /tmp/stage.png # optional visual check
flash-agent publish -o /tmp/test.swf     # feed to swf-verify / Ruffle
flash-agent undo                         # everything is in history
```

The verification loop stays textual: mutate → read `doc get`/`summary` → assert →
only then look at pixels.

## Relationship to existing layers

| Surface | Reaches it via | Keep using it for |
|---------|----------------|-------------------|
| `__flashTest` | `page.evaluate` (Playwright) | UI-path testing (gestures, menus) — it tests that the *UI* mutates the model correctly |
| JSFL `runJSFL` | bridge or `jsfl.run` RPC | scripted/recorded scenarios, Flash-8-fidelity API |
| **Agent RPC + CLI (this doc)** | WebSocket / terminal | live out-of-process control; the default surface for LLM agents doing authoring work |

The registry and `__flashTest` should share one implementation of each command
(extract the Shell's bridge closures into a shared module both consume) so the two
surfaces cannot drift.

## MVP scope

**In:** relay plugin; editor client + registry with the method tables above; protocol
package; CLI with all listed commands; e2e spec proving CLI ↔ live editor round-trips;
docs (this file, AGENTS.md/CLAUDE.md pointers).

**Out (follow-ups, tracked as open tasks):**
- Event subscriptions / `flash-agent watch` (doc-changed, selection-changed,
  playhead notifications pushed to clients).
- Packaged-Tauri transport (Rust WS server speaking the same protocol).
- Multi-document / multi-editor routing (MVP: one editor; a second editor
  registration replaces the first with a warning to clients).
- Symbol-timeline edit context (entering a symbol and editing its timeline via RPC) —
  until then, `jsfl.run` / `doc.load` are the workaround.
- Auth beyond the optional shared token.

## Implementation plan

1. **`@flash/agent-protocol` + Vite relay plugin + editor-side client** — the
   transport skeleton, `editor.ping`/`editor.info`/`doc.get`/`doc.summary` only.
   Proves CLI-less round-trip via a raw `ws` test.
2. **AgentCommandRegistry** — full method surface, sharing implementations with
   `__flashTest`; unit tests per method against `@flash/core` fixtures.
3. **`flash-agent` CLI** — commands, `--json`, exit codes, repl; e2e spec that starts
   Vite, loads the editor page, runs real CLI invocations, asserts document state.
4. **JSFL expansion** (parallel) — grow the JSFL DOM (frames/layers CRUD,
   `convertToSymbol`, `setFrameScript`-equivalent, document property setters, library)
   so `jsfl.run` is a genuinely useful escape hatch.

Each step is a story-sized task in `.tasks/`; testing ships inside each story per
AGENTS.md.

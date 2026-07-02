# 19 — Agent Control Interface (MCP server + editor bridge)

A live remote-control surface for the authoring tool, exposed as a **Model Context
Protocol (MCP) server**. Any MCP client — Claude Code, Cursor, Claude Desktop, custom
agents built on the MCP SDKs — connects to a running editor instance and manipulates
the stage, timeline, scripts, library, document properties, selection, and publishing,
without Playwright, without screenshots-as-input, without synthesizing pointer events.

This extends `18-verification-and-automation.md`: Layer 2's `__flashTest` bridge and
Layer 4's JSFL surface are *in-page* APIs reachable only through a browser automation
harness. This doc adds the missing transport — an out-of-process, standards-based way
to reach the same command layer.

## Why this exists, and why MCP

- **Playwright is the wrong altitude for editing.** Driving the UI through pointer
  events is the right way to *test the UI*, but the wrong way to *use the editor as a
  tool*. An agent that wants "a 100×50 red rectangle on layer 2, frame 5, with
  `stop();` on frame 5" should say exactly that, get a structured success/error back,
  and read the resulting document state as JSON.
- **Sessions, not snapshots.** A human keeps the editor open (Tauri or browser) while
  agents connect, inspect, and mutate the *same live session* — the document the human
  is looking at updates in real time, with every agent mutation in the undo history.
- **MCP instead of a custom protocol.** Every capable agent runtime already speaks
  MCP. By exposing the editor as an MCP server we get, with zero client-side work:
  - **OOTB compatibility** — `claude mcp add`, a Cursor `mcpServers` entry, or any
    SDK client connects immediately; tool schemas are self-describing.
  - **Native image content** — `stage_screenshot` returns an MCP `image` content
    block; clients put the rendered stage straight in front of the model's eyes.
  - **Resources** — the document outline, library, and script index are browsable
    MCP resources, not bespoke query commands.
  - **Subscriptions** (follow-up) — doc-changed notifications map onto MCP resource
    update notifications instead of a hand-rolled event stream.
- **Text in, text out.** Per the doctrine in doc 18: every behavior must be assertable
  as text or structure first. All tools return structured JSON; screenshots and
  published SWF bytes are available but supplementary.

## Architecture

The editor page runs in a browser context (Tauri webview or plain browser); it cannot
listen on a port. The Vite dev server already owns port **1420**. So the MCP server
lives **inside a Vite plugin** (Node side) and forwards commands to the editor page
over a private WebSocket bridge:

```
MCP clients (Claude Code, Cursor, custom agents, flash-agent CLI)
        │  Streamable HTTP — http://localhost:1420/mcp
        ▼
vite-plugin-agent-mcp  (apps/desktop, Node side of the dev server)
  • McpServer from @modelcontextprotocol/sdk
  • tool set GENERATED from the @flash/agent-protocol registry (one tool per
    ALL_COMMANDS entry); resources for doc/library/scripts
  • validates params (zod schemas shared via @flash/agent-protocol)
  • bounds request bodies + WS frames (MAX_BODY_BYTES) to cap memory use
        │  private WS bridge — ws://localhost:1420/__agent (role=editor)
        ▼
Editor page (packages/authoring-ui/src/agent/)
  • dials the bridge on startup (dev / VITE_FLASH_TEST=1), reconnects with backoff
  • dispatches to AgentCommandRegistry
        │
        ▼
AgentCommandRegistry ──► @flash/core mutations ──► pushDoc() ──► history, re-render
```

- **`vite-plugin-agent-mcp`** (registered in `apps/desktop/vite.config.ts`): hosts the
  MCP Streamable HTTP endpoint at `/mcp` via dev-server middleware, and accepts the
  editor page's WebSocket on `/__agent`. It holds no document state: every tool call
  is forwarded to the editor and the editor's reply becomes the tool result. If no
  editor page is connected, tools fail fast with an actionable message ("editor page
  not connected — open http://localhost:1420 or run `pnpm --filter @flash/desktop
  dev`").
- **The internal bridge is private.** Editor↔plugin frames are a trivial
  request/response envelope internal to this feature — *not* a public protocol.
  The public, versioned, documented surface is the MCP server.
- **AgentCommandRegistry** (`packages/authoring-ui/src/agent/registry.ts`): a typed
  map of `command → handler`. Handlers close over the same state and callbacks the
  Shell already wires into `__flashTest` (current doc, `pushDoc`, selection setters,
  view-state setters, `runJSFL`, `publish`, `screenshotStage`). **Rule:** handlers go
  through the shared command layer — `@flash/core` mutations + `pushDoc()` + the
  Shell's selection/view setters. Never poke component internals, never mutate the
  document outside history.
- **`@flash/agent-protocol`** (`packages/agent-protocol`): zod schemas + TS types for
  every command's params/result, shared by the plugin (MCP tool `inputSchema`,
  validation) and the editor registry (dispatch typing). One definition per command.
  It is the **single source of truth** for the tool surface: `ALL_COMMANDS` +
  `COMMAND_SCHEMAS` + `COMMAND_DESCRIPTIONS`. **Both** transports build their tool set
  by iterating it — the MCP plugin (`registerAgentCommandTools`) and the in-browser
  Agent Chat bridge (`authoring-ui/agentchat/tools.ts`) — so a command added or a
  schema tightened in the protocol flows to both with no per-tool edit and the two
  transports **cannot drift** (task 1393). Because both generate from these schemas,
  each schema must describe the params the registry handler actually honors (e.g.
  `stage_add_shape.fill` accepts a solid string *or* a gradient descriptor;
  `stage_place_instance` carries scale/rotation/blendMode/colorEffect/loopMode/
  firstFrame; `stage_add_text` carries the input-text/layout extras) — a narrower
  schema would silently hide real, working functionality from the model.

### Why host MCP in the dev server

- No new port, no new daemon: anything that can reach the dev server can reach the
  agent surface, and the Playwright e2e suite (which already auto-starts Vite on
  1420) can test it with zero infra changes.
- Works identically in browser-mode Vite and `tauri dev` (Tauri's webview loads the
  same dev URL).
- **Non-goal (MVP):** packaged Tauri builds (no Vite). Follow-up: host the same MCP
  server in `src-tauri` (Rust MCP SDK or a Node sidecar); the registry and protocol
  package are transport-agnostic, so nothing else changes.

### Security

Dev-tool posture, same as `__flashTest`:
- The dev server binds to localhost; the MCP endpoint additionally **validates the
  `Origin`/`Host` headers** against localhost to block DNS-rebinding (per MCP
  Streamable HTTP guidance).
- The editor-side bridge client only starts in dev mode or under `VITE_FLASH_TEST=1`.
- Optional shared secret: if `FLASH_AGENT_TOKEN` is set in the dev server's env, MCP
  requests must carry it as a bearer token — useful when port 1420 is forwarded. Not
  required for MVP local use.
- **Request-size bounds (task 1393).** The `/mcp` HTTP body accumulator and the
  `/__agent` WebSocket server were previously unbounded — a local peer could stream an
  arbitrarily large payload and exhaust the dev-server's memory. Both are now capped at
  `MAX_BODY_BYTES` (default 64 MiB, override via `FLASH_AGENT_MAX_BYTES`): an oversized
  HTTP body aborts with **413 Payload Too Large**, an oversized WS frame trips ws's
  `maxPayload` (1009 close). The cap is deliberately generous — `doc_load` /
  `file_load_fla` / `library_import_*` carry base64 blobs and full-document / SWF / FLA
  replies flow back over the same WS — but finite.

## Connecting (OOTB)

```bash
# Claude Code
claude mcp add --transport http flash-editor http://localhost:1420/mcp

# Cursor / Claude Desktop / other config-file clients
{ "mcpServers": { "flash-editor": { "url": "http://localhost:1420/mcp" } } }

# stdio-only clients
npx mcp-remote http://localhost:1420/mcp
```

The server's `instructions` field teaches the usage doctrine up front: *call
`doc_summary` (or read `flash://document/summary`) to orient before mutating; assert
results from structure, use `stage_screenshot` only as a supplement; every mutation
returns `rev` — re-read if it jumped unexpectedly (a human or another agent edited).*

## Tool surface (MVP)

One MCP tool per command, named `domain_action` (MCP-safe `[a-z0-9_]`). Coordinates
are stage px. Colors are `#RRGGBB` / `#RRGGBBAA` strings at the boundary (converted
to/from model `RGBA` inside). Frame indices are **0-based**, matching the model.
Every mutating tool's result includes the new document revision **`rev`** (a counter
bumped on every `pushDoc`); reads include the `rev` they observed.

### Session & document

| Tool | Params | Result |
|------|--------|--------|
| `editor_status` | — | alive, version, document name, size, fps, bg color, scene count, edit context, active tool, `rev` |
| `doc_get` | `{ path? }` (JSON-pointer-ish, e.g. `/scenes/0/timeline/layers/1`) | the (sub)document as JSON |
| `doc_summary` | — | token-light outline: scenes → layers (id, name, type, frameCount) → keyframes (index, objectCount, hasScript, tween) + library list. **Default "look around" call** — `doc_get` on a real document can be huge. |
| `doc_load` | `{ document }` | replace the document (pushes to history) |
| `doc_set_properties` | `{ width?, height?, frameRate?, backgroundColor? }` | `{ ok, rev }` |
| `history_undo` / `history_redo` | — | `{ ok, rev }` |
| `history_depth` | — | `{ undo, redo }` |

### Stage & selection

| Tool | Params | Result |
|------|--------|--------|
| `stage_add_shape` | `{ kind: "rect"\|"oval"\|"line", bounds/points, fill?, stroke?, layerId?, frameIndex? }` | `{ id, rev }` (defaults: active layer, current frame) |
| `stage_add_text` | `{ x, y, width, height, text, textType?, fontFamily?, fontSize?, color?, ... }` | `{ id, rev }` |
| `stage_place_instance` | `{ symbolId, x, y, name?, ... }` | `{ id, rev }` — `name` sets the **AS2 instance name** (see below) |
| `stage_add_video` | `{ videoItemId, x, y, width?, height?, layerId?, frameIndex? }` (defaults to the VideoItem's native size) | `{ id, rev }` |
| `stage_update` | `{ id, updates }` (x/y/scale/rotation/alpha/instanceName/filters/text props…) | `{ ok, rev }` — pass `instanceName` (top-level or in `updates`) to rename an instance |
| `stage_set_instance_name` | `{ id, name, layerId?, frameIndex? }` | `{ ok, rev }` — set/rename the AS2 instance name; `""` clears it |
| `stage_remove` | `{ ids }` | `{ ok, rev }` |
| `stage_arrange` | `{ ids, op: "front"\|"back"\|"forward"\|"backward" }` | `{ ok, rev }` |
| `stage_group` / `stage_ungroup` | `{ ids }` | `{ ok, rev }` |
| `selection_get` | — | selected ids + their objects (+ `subSelection` in planar merge mode) |
| `selection_set` | `{ ids }` (empty = clear) / `{ all: true }` | `{ ok }` |
| `selection_pick_at` | `{ x, y, mode?: "single"\|"connected", move?: { dx, dy } }` | `{ ok, picked }` |
| `view_set` | `{ zoom?, panX?, panY?, currentFrame?, activeLayerId? }` | `{ ok }` |
| `tool_select` | `{ toolId }` | `{ ok }` |

**Partial (face/segment) selection — planar merge mode (task 1321).** When the
`planarMergeOnCommit` engine flag is ON, a merged shape on a layer is a planar
"shape soup" whose individual **fill regions (faces)** and **line segments** are
selectable, exactly like authentic Flash 8. `selection_pick_at({ x, y })` picks the
fill region or line segment of the merged shape at a stage point (`mode:"connected"`
selects the connected fills+strokes set, the double-click behavior). The result is a
`SubSelection` (`{ shapeId, keys }`, where each key is a stable, serializable face
or segment reference) exposed on `selection_get`'s optional `subSelection` field.
Pass `move:{ dx, dy }` to `selection_pick_at` to immediately **split-on-move**: the
picked piece is extracted into a new shape offset by the delta, leaving the
complement (a hole/cut) behind. With the flag OFF (the default), selection is
whole-object (`selection_get`/`selection_set` over display-object ids) and these
sub-selection fields are absent.

**Instance names (AS2 `_root.<name>`).** A placed symbol/text instance can carry an
*instance name* — the identifier ActionScript uses to reference it at runtime as
`_root.<name>` (e.g. `_root.player._x = 10`, `_root.player.gotoAndStop(2)`). This is
required to script, animate, or wire interactivity on an instance, and is **distinct from
the library item name**. There are three ways to set it:

- at creation, via `stage_place_instance`'s `name` param;
- after placement, via the dedicated `stage_set_instance_name` (clearest — pass `""` to clear);
- via `stage_update`'s `instanceName` param (top-level or inside `updates`).

The name is validated as a valid AS2 identifier (starts with a letter, `_` or `$`, then
letters/digits/`_`/`$`, and not a reserved word); an invalid name returns an `error`. The
name is emitted as the PlaceObject2 name at publish, so `_root.<name>` resolves in Ruffle.

### Timeline

| Tool | Params | Result |
|------|--------|--------|
| `timeline_add_layer` | `{ name?, type? }` | `{ layerId, rev }` |
| `timeline_remove_layer` | `{ layerId }` | `{ ok, rev }` |
| `timeline_update_layer` | `{ layerId, name?, locked?, visible?, type? }` | `{ ok, rev }` |
| `timeline_insert_frame` / `timeline_insert_keyframe` / `timeline_insert_blank_keyframe` / `timeline_remove_frame` | `{ layerId, frameIndex }` | `{ ok, rev }` |
| `timeline_set_frame_label` | `{ layerId, frameIndex, label, labelType? }` | `{ ok, rev }` |
| `timeline_set_tween` | `{ layerId, frameIndex, kind: "motion"\|"shape"\|null, props? }` | `{ ok, rev }` |
| `timeline_goto_frame` | `{ frameIndex }` | `{ ok }` |
| `playback_play` / `playback_stop` | — | `{ ok }` |

### Code (AS2)

| Tool | Params | Result |
|------|--------|--------|
| `script_get` | `{ layerId, frameIndex }` | `{ script }` (from governing keyframe) |
| `script_set` | `{ layerId, frameIndex, script }` | `{ ok, rev, diagnostics }` — runs the AS2 compiler (`compileScript`) in check mode and returns syntax errors as diagnostics **without blocking the set** (Flash 8 lets you save broken scripts; the agent still gets immediate feedback) |
| `script_check` | `{ script }` | `{ diagnostics }` — compile-check without mutating |
| `script_list` | — | all `(sceneIndex, layerId, frameIndex)` triples carrying scripts, with first-line previews |

### AS2 external classes (`doc.asClasses` VFS)

External `.as` class files attached to the document (the same surface the editor's class
VFS edits — see `docs/33-as2-classes-vfs.md`). Paths are classpath-relative with forward
slashes (e.g. `com/example/Foo.as`). The `.fla` embed (`doc.asClasses`) stays
authoritative. `class_set`/`class_check` run the AS2 **parser only** (parse-only
diagnostics) — class files declare `class`/`interface` constructs the frame-script
bytecode compiler does not emit.

| Tool | Params | Result |
|------|--------|--------|
| `class_list` | — | `{ classes: [{ path, className }], rev }` — `className` from the parsed class decl, falling back to the dotted path |
| `class_get` | `{ path }` | `{ path, source, rev }` (errors if no class at that path) |
| `class_set` | `{ path, source }` | `{ ok, rev, diagnostics }` — parse-checks, then upserts via `addAsClass`/`updateAsClass`. Saved **regardless** of parse errors (Flash 8 parity); inspect `diagnostics` |
| `class_remove` | `{ path }` | `{ ok, rev }` (errors if no class at that path) |
| `class_check` | `{ source }` | `{ diagnostics }` — parse-only check without mutating |

### Library & symbols

| Tool | Params | Result |
|------|--------|--------|
| `library_list` | — | items (id, name, type, folder) |
| `library_create_symbol` | `{ name, symbolType }` | `{ symbolId, rev }` |
| `library_convert_to_symbol` | `{ ids, name, symbolType }` | `{ symbolId, instanceId, rev }` |
| `library_rename` / `library_remove` | `{ itemId, name? }` | `{ ok, rev }` |
| `library_set_linkage` | `{ symbolId, linkageId?, className?, exportForActionScript?, exportInFirstFrame? }` | `{ ok, rev }` — set `className` to bind a symbol to an external AS2 class file (`class_set`) |

### Output & escape hatches

| Tool | Params | Result |
|------|--------|--------|
| `jsfl_run` | `{ source }` | `JsflResult` (`traces`, `returnValue`, `error`); mutations land in history |
| `stage_screenshot` | `{ frameIndex? }` | MCP **`image` content block** (PNG; reuses `screenshotStage()`, 1:1 DPR, background-composited) + `{ width, height }` |
| `publish_swf` | — | `{ swfBase64, byteLength }` |
| `file_save_fla` / `file_load_fla` | `{ flaBase64? }` | bytes / `{ ok, rev }` (in-memory, no native dialogs) |

`jsfl_run` is the deliberate escape hatch: anything not yet covered by a typed tool is
reachable by script, and grows the on-theme JSFL surface (doc 18, Layer 4) instead of
an ad-hoc one. Typed tools are preferred where they exist because they validate params
and return actionable errors.

### Resources

Read-only browsable state, complementing the tools:

| URI | Content |
|-----|---------|
| `flash://document/summary` | same outline as `doc_summary` |
| `flash://document` | full document JSON |
| `flash://library` | library item list |
| `flash://scripts` | script index with previews |

Resource **subscriptions** (notify on doc change, with `rev`) are a follow-up.

### Error & result conventions

- Tool errors use MCP `isError` results whose text **names the bad parameter** and,
  where cheap, includes valid alternatives (known layer ids, valid tool ids, frame
  bounds). An LLM must be able to self-correct from the error alone.
- IDs everywhere: tools accept the model's stable ids (`layerId`, object `id`,
  `symbolId`) as returned by `doc_summary` / `library_list`. No name-based fuzzy
  matching in MVP (names are not unique).

### Structural-input validation model (tasks 1363 / 1367)

Some tools take **structural** input (a whole document, a property bag) rather than
typed scalars. A malformed structural payload that reaches a document/timeline
mutation can crash an uncatchable reader (e.g. the collab outbound
`externalizeAssets` subscription) or silently corrupt the document. The agent
command surface enforces validation at **two layers**, because the two transports
trust their input differently:

1. **Schema layer (the model boundary).** The MCP plugin and the agent-chat tool
   set validate the model's arguments against a Zod schema (`COMMAND_SCHEMAS`)
   *before* dispatch. So the tighter a command's Zod schema, the more a model's
   bad call is rejected with a self-correcting error before any handler runs.
2. **Handler layer (the universal guard).** The raw `/__agent` WebSocket bridge
   calls `dispatchAgentCommand` **without** running the Zod schema, so a
   hand-crafted payload bypasses the schema entirely. Therefore any command whose
   param flows into a `pushDoc` / `updateDisplayObject` / timeline / library
   mutation also **validates-or-normalizes at the handler** (`packages/authoring-ui/
   src/agent/registry.ts`). This layer is the one that can never be bypassed.

The rule for any structural param: **reject with a clear error, or coerce to a
safe value — never an uncaught throw, never corruption.** Concrete applications:

- **`doc_load` / `file_load_fla` (doc-replacement boundaries).** Both replace the
  whole document, so both route the incoming doc through `normalizeAgentDoc`
  before `pushDoc`. It throws a clear error on non-object input and backfills the
  load-bearing invariants — `id`, `properties`, `scenes` (drop scenes lacking a
  `timeline.layers` array; backfill one default scene if none survive), and
  `library.items` (the original 1363 fix). For `properties` it also **coerces a
  PRESENT-but-wrong-typed scalar** to a safe value before overlaying
  `createDocumentProperties` defaults (task 1368): `width`/`height`/`frameRate`
  are clamped to finite numbers (else default), `backgroundColor`/`rulerUnits`
  forced to a string/valid enum, the `snapTo*` flags to booleans, `guides`/`grid`
  to their container shapes — so a malformed scalar (e.g. `width:"wide"`,
  `frameRate:{}`) cannot reach `history.present` and corrupt the SWF compiler's
  `width*20` stage-RECT math (NaN). Bounds mirror collab's `validateInboundDoc`
  (task 1350). A valid doc passes through with identical values (idempotent).
  `file_load_fla` additionally relies on `loadFla` throwing a clear
  `FLA open error: …` for a malformed archive.
- **`doc_load.document: z.unknown()` / `file_load_fla.flaBase64: z.string()` are
  intentionally LEFT loose at the schema layer.** A full structural Zod schema for
  the entire `FlashDocument` would be hundreds of lines, brittle against every
  model change, and would reject legitimate round-tripped docs carrying optional
  fields it didn't enumerate; the base64 string is already the correct scalar type.
  The handler normalizer is the real defense for both.
- **`stage_update.updates`.** Was an untyped `z.record(z.string(), z.unknown())`
  bag cast straight into `updateDisplayObject`. The schema is now the enumerated
  `DisplayObjectUpdatesSchema` (real scalar fields, correct types, unknown keys
  stripped), and the handler runs `sanitizeDisplayObjectUpdates`: only known
  scalar fields are forwarded, a known field with the wrong type is rejected with
  a clear error, and deep structural values (`shape`/`filters`/`warp`) are NOT
  exposed through the generic bag — they have dedicated tools.
- **`timeline_set_tween.props`.** Tightened from `z.record(z.string(),
  z.unknown())` to the enumerated `TweenPropsSchema` (motion + shape fields). The
  handler already read each prop with a `typeof` guard, so it was already safe;
  the schema tightening makes the model boundary reject garbage too.
- **Intentionally left loose (legitimate flexibility):** `jsfl_run.source`
  (an escape hatch that runs arbitrary JSFL by design — sandbox/policy is the 1282
  concern, not structural validation); all `*Result` schemas using
  `z.unknown()`/`z.any()` (`DocGetResult.value`, `SelectionGetResult.objects`,
  `JsflRunResult.returnValue`, `FilterListResult.filters`) — these are **output**
  shapes returned TO the model, not input, so they cannot crash or corrupt the doc.

## The `flash-agent` CLI (thin client)

Most agents need no CLI — they connect as MCP clients. A **thin generic wrapper**
(`packages/agent-cli`, bin `flash-agent`, built on the MCP TS SDK client) remains for
shell scripting, e2e tests, and humans:

```
flash-agent [--url http://localhost:1420/mcp] <command>

  tools                         list tools with schemas
  call <tool> [json|--k=v ...]  invoke any tool; prints the result as JSON
  read <resource-uri>           read an MCP resource
  screenshot [-o stage.png]     sugar: call stage_screenshot, write the PNG
  publish [-o out.swf]          sugar: call publish_swf, write the bytes
  repl                          interactive session on one connection
```

No bespoke per-command argument tree: `call` + the self-describing tool schemas cover
everything; only binary-output sugar gets dedicated verbs. Exit codes: 0 success,
1 tool error (`isError`), 2 transport error (message says whether the dev server or
the editor page is missing, and how to start it).

### Agent workflow example (any MCP client)

```
editor_status                    → editor alive? doc name, size, rev
doc_summary                      → orient: scenes/layers/keyframes/library
stage_add_shape {kind:"rect", x1:100, y1:100, x2:200, y2:150, fill:"#FF0000"}
timeline_insert_keyframe {layerId:"layer-1", frameIndex:4}
script_set {layerId:"layer-1", frameIndex:4, script:"stop();"}   → diagnostics: []
doc_get {path:"/scenes/0/timeline/layers/0"}                     → assert structure
stage_screenshot                 → optional visual check (image content)
publish_swf                      → feed to swf-verify / Ruffle
history_undo                     → everything is in history
```

The verification loop stays textual: mutate → read `doc_get`/`doc_summary` → assert →
only then look at pixels.

## Relationship to existing layers

| Surface | Reaches it via | Keep using it for |
|---------|----------------|-------------------|
| `__flashTest` | `page.evaluate` (Playwright) | UI-path testing (gestures, menus) — it tests that the *UI* mutates the model correctly |
| JSFL `runJSFL` | bridge or `jsfl_run` tool | scripted/recorded scenarios, Flash-8-fidelity API |
| **MCP server (this doc)** | any MCP client / `flash-agent` | live out-of-process control; the default surface for LLM agents doing authoring work |

The registry and `__flashTest` should share one implementation of each command
(extract the Shell's bridge closures into a shared module both consume) so the two
surfaces cannot drift.

## MVP scope

**In:** Vite MCP plugin (Streamable HTTP `/mcp` + private editor WS bridge);
`@flash/agent-protocol` zod schemas; editor client + registry with the tool tables
above; the four resources; thin `flash-agent` CLI; e2e spec proving MCP client ↔ live
editor round-trips; docs (this file, AGENTS.md/CLAUDE.md pointers).

**Out (follow-ups, tracked as open tasks):**
- Resource subscriptions / change notifications (doc-changed with `rev`,
  selection-changed, playhead).
- Packaged-Tauri hosting (same MCP server without Vite).
- Multi-document / multi-editor routing (MVP: one editor page; a second registration
  replaces the first and in-flight calls fail with a clear error).
- Symbol-timeline edit context (entering a symbol and editing its timeline) — until
  then, `jsfl_run` / `doc_load` are the workaround.
- MCP prompts (canned authoring recipes); auth beyond the optional bearer token.

## Implementation plan

1. **`@flash/agent-protocol` + Vite MCP plugin + editor-side bridge client** — the
   transport skeleton: `/mcp` endpoint via `@modelcontextprotocol/sdk`, private
   `/__agent` WS, registry with `editor_status`, `doc_get`, `doc_summary` only, plus
   the `flash://document/summary` resource. Proves a stock MCP client round-trip.
2. **AgentCommandRegistry** — full tool surface, sharing implementations with
   `__flashTest`; zod schemas in `@flash/agent-protocol`; unit tests per tool group
   against `@flash/core` fixtures.
3. **`flash-agent` thin CLI + e2e** — generic `tools`/`call`/`read` + binary sugar;
   e2e spec that starts Vite, loads the editor page, and drives real MCP calls
   end-to-end, asserting document state.
4. **JSFL expansion** (parallel) — grow the JSFL DOM (frames/layers CRUD,
   `convertToSymbol`, `setFrameScript`-equivalent, document property setters, library)
   so `jsfl_run` is a genuinely useful escape hatch.

Each step is a story-sized task in `.tasks/`; testing ships inside each story per
AGENTS.md.

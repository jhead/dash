# Collaboration — optional P2P multiplayer (docs/37)

Status: **Phase 5 complete — the feature is DONE** (task 1348) on top of **P4**
(task 1347), **P3** (task 1346), **P2** (task 1345), **P1** (task 1344), and
**P0** (task 1343). P0 shipped the
foundation: a faithful, property-tested Yjs binding for the document model. P1
added the **opt-in y-webrtc transport + shareable link + join flow**. P2 adds
**awareness/presence** — live cursors, selection outlines,
scene/frame/tool/edit-context presence, presence avatars, follow-a-peer, and a
Library "editing this symbol" badge — riding the same encrypted y-webrtc mesh via
`y-protocols/awareness`. P3 makes **undo collaboration-aware** (a per-origin
`Y.UndoManager`). P4 adds the **collaboration UX** — a Share dialog with an
honest privacy note + copyable invite link, a clear Start/Join/Leave control with
connection status, and the surfaced P2 presence — plus **out-of-band asset sync**:
bitmap/sound/video BYTES are kept OUT of the CRDT (only a content-hash reference
travels) and transferred lazily peer-to-peer over the same y-webrtc mesh, with a
missing-asset placeholder until the bytes arrive. **P5 hardens** the whole
feature (§13): peer-count realism (a warning past a soft mesh threshold, no
artificial cap), reconnection / signaling-health surfacing, large-doc initial-
sync + outbound-diff perf measurement, E2E-encryption verification, and the final
ops/security/limits guidance. Still **default OFF**: no provider, network,
signaling connection, or awareness exists until the user explicitly starts/joins
a session; solo has zero overhead.

> This binding is THE BET of the whole feature. Everything downstream assumes the
> projection `FlashDocument → Y.Doc → FlashDocument` is the identity over the full
> mutation surface. P0's acceptance gate (the property test) proves exactly that.

---

## 1. Approved architecture — derived binding (option b)

The immutable `FlashDocument` stays the **single source of truth**. Yjs is used
*only* as the merge engine: the `Y.Doc` is a **derived projection** of the
document, not a parallel model the app reads from.

- Solo: the app reads/writes the zustand document store exactly as before. The
  `Y.Doc` does not exist.
- Collaborative: a `FlashCollabBinding` keeps the `Y.Doc` in sync with the store.
  - **OUTBOUND** — on a local change, diff the new document against the
    last-synced one (using the model's structural-sharing reference equality:
    descend only where object references differ) and apply the minimal delta in
    **one `Y.transact`** tagged with a `localOrigin`.
  - **INBOUND** — observe the `Y.Doc` deeply; for any update whose transaction
    origin is **not** `localOrigin` (i.e. it came from a remote peer), rebuild
    the affected document and call **`replaceDoc`** (never `pushDoc`) so a remote
    edit does **not** create a local undo entry.

### Why a NEW package `@flash/collab` (Yjs stays out of `@flash/core`)

`@flash/core` must import cleanly in Node, the browser, and the Tauri webview and
stay free of runtime deps that assume one of those. Yjs lives **only** in
`packages/collab` (`@flash/collab`). `@flash/core` exposes the model + pure
mutations; `@flash/collab` depends on `@flash/core` for *types only* and owns the
entire CRDT mapping. The authoring-ui adapter (`store/collabAdapter.ts`) is the
only place the editor touches `@flash/collab`, and only when `attachCollab` is
explicitly called.

```
@flash/core  (model + pure mutations, no Yjs)
      ▲
      │ types only
      │
@flash/collab  (Yjs binding: schema mapping + FlashCollabBinding)   ◄── yjs
      ▲
      │ opt-in adapter
      │
@flash/authoring-ui  (store/collabAdapter.ts: store ↔ binding, default OFF)
```

---

## 2. The type mapping (`FlashDocument` ↔ `Y.Doc`)

The mapping balances two needs: **per-field merge** where two users editing
different attributes of the same object should both survive, and **atomic
last-writer-wins** where a value has no stable sub-identity (geometry segments
have no ids, so a finer merge would need a forbidden custom merge function).

Root: a single `Y.Map` under key `"doc"` on the `Y.Doc`.

| Model node | Y representation | Granularity |
|---|---|---|
| `FlashDocument` scalars (`id`, `accessibility`, `activePublishProfileId`) | root `Y.Map` entries | per-field |
| `properties` (and all its fields) | per-field `Y.Map` entries on the root | per-field merge of doc props |
| `scenes` | `Y.Array<Y.Map(scene)>` | **positional** |
| `library` | `Y.Map` | container |
| `asClasses` | `Y.Map<path, Y.Text>` | **character-level** |
| `classpaths` | `Y.Array<string>` (atomic replace) | whole-array LWW |
| `publishProfiles` | `Y.Array<atomic profile>` | whole-array LWW |
| `flaSwfBlobs` | `Y.Array<atomic blob>` (bytes → base64) | whole-array LWW (import-only) |
| `Scene` | `Y.Map`: `id`/`name`/`flaItemId` per-field; `timeline` → `Y.Map` | per-field |
| `Timeline` | `Y.Map { layers: Y.Array<Y.Map(layer)> }` | layers **positional** |
| `Layer` | `Y.Map`: scalars per-field; `frames` → `Y.Array<Y.Map(frame)>` | frames **positional** |
| `Frame` | `Y.Map`: scalars per-field; `displayObjects` → keyed map (below) | per-field |
| `Frame.displayObjects` | `Y.Map<id, Y.Map(object)>` **+ `__order: Y.Array<id>`** | keyed; z-order preserved |
| `DisplayObject` | `Y.Map`: **every** field per-field; `shape`/`filters`/`colorEffect`/`warp`/… stored **atomically** | scalars merge; geometry atomic |
| `library.items` | `Y.Map<id, Y.Map(item)>` **+ `__order: Y.Array<id>`** | keyed |
| `library.folders` | `Y.Array<atomic folder>` | whole-array LWW |
| Library item | `Y.Map`: scalars per-field; a `Symbol`'s `timeline` → nested `Y.Map` (same as a scene timeline) | per-field + nested timeline |

### Per-field vs atomic — the rule

A field is stored as its own `Y.Map` entry. If the field's **value** is itself an
object/array (`shape`, `filters`, `colorEffect`, `flaItemId`, `sound`, `warp`,
gradient `matrix`, …) it is written as a single deep-cloned plain-JSON value:
that whole value is one CRDT register → **whole-value last-writer-wins**. This is
exactly the spec's requirement that `displayObject.shape` geometry be atomic
(segments have no stable id; a finer merge would need a custom merge function,
which is forbidden). Editing `x` on one peer and `y` on another merges; two peers
editing the same `shape` converge to one of the two geometries, never a blend.

### Keyed maps + order array

`displayObjects` and `library.items` have stable ids and a meaningful order
(z-order / library order). They are stored as `Y.Map<id, Y.Map(child)>` for
per-object merge, plus a sibling `__order: Y.Array<id>` that records the exact
sequence. Rebuild reads `__order` to restore order; reorders write only the order
array (objects untouched). Two peers reordering concurrently converge on a single
deterministic order (Yjs array CRDT) with no object duplication.

### `asClasses` is character-level

AS2 class source is a `Y.Map<path, Y.Text>`. An edit splices the `Y.Text` with a
minimal common-prefix/common-suffix diff, so two peers inserting into disjoint
regions of the same file both survive — the whole point of editing source
collaboratively. (The same character-merge that the ClassesPanel already relies
on conceptually, now CRDT-backed.)

### Optional fields → key absence (round-trip fidelity)

The model has many optional fields (`scaleX?`, `alpha?`, `quality?`, …). For the
projection to be a true identity, **an absent optional field must rebuild as
absent**, never as a key holding `undefined`. The binding therefore:

- never stores `undefined` in a `Y` container (absent field ⇒ no key),
- deletes a `Y.Map` key when a field disappears in a later edit,
- compares with a JSON-structural equality that treats `{a:1}` and
  `{a:1,b:undefined}` as equal.

### The one non-JSON field: `flaSwfBlobs`

`FlaSwfBlob.bytes` is a `Uint8Array` and is the only non-plain-JSON value in the
surface. It is **import-only** (an opaque passthrough of a legacy `CPicSwf`
record) and is **never produced by any mutation function**, so it never appears
in the property test's generated documents. It is mapped atomically (bytes →
base64) so a round-trip still holds if a binary-FLA import ever carries one. This
is a documented, low-risk corner — not a faithfulness gap on the live surface.

---

## 3. The binding (`FlashCollabBinding`)

`packages/collab/src/binding.ts`. Constructed with a `Y.Doc` and a `DocSource`
(the minimal local-document interface):

```ts
interface DocSource {
  getDoc(): FlashDocument;
  applyRemote(doc: FlashDocument): void;   // host wires this to replaceDoc
  subscribe(listener: () => void): () => void;
}
```

- **Seed**: if the `Y.Doc` is empty, materialize the local doc into it (one
  transaction, `localOrigin`). If the `Y.Doc` is already populated (a late peer
  joining an existing session) it **adopts** the Y.Doc state via `applyRemote`
  instead of overwriting it.
- **Outbound**: subscribes to the source; on each change reads `getDoc()`. If the
  reference is unchanged it does nothing (the model's structural sharing makes
  `prev === next` a valid skip). Otherwise `diffDoc(prev, next)` runs inside one
  `ydoc.transact(..., localOrigin)`.
- **Inbound**: `root.observeDeep`. Updates whose `txn.origin === localOrigin` are
  ignored (no echo / no loop). Remote updates rebuild the doc and call
  `applyRemote` — guarded by an `applyingRemote` flag so the resulting store
  change does not bounce back out.

The provider (y-webrtc / y-websocket, or an in-process test wire) is what
replicates updates between two `Y.Doc`s. **The binding only ever talks to its own
`Y.Doc`** — there is no networking in `@flash/collab` at P0.

### The chokepoint it hooks

Every document change in the running editor flows through one place — the
zustand document store's `apply()` (`set({ history: historyReducer(...) })` in
`store/documentStore.ts`). `pushDoc` / `replaceDoc` / `commitDrag` / `undo` /
`redo` all route through it, and the audit below found **no path that mutates the
active document any other way**. So a single store subscription captures
everything. The adapter (`store/collabAdapter.ts`) maps `getDoc → history.present`,
`applyRemote → replaceDoc`, `subscribe → store.subscribe`.

---

## 4. Bypass audit — does anything skip pushDoc/replaceDoc/commitDrag?

Result: **No.** The active document is `documentStore.history.present`; the only
writer is the store's private `apply()`. A repo-wide search found zero
`setState`/`.present =`/`historyReducer(` calls outside the store module + tests.
Every entry point routes through a canonical method:

| Entry point | Routes to |
|---|---|
| Interactive edits, agent/MCP tools (`agent/registry.ts` `cb.pushDoc`) | `pushDoc` |
| Drag gestures | `replaceDoc` (interim) + `commitDrag` (final) |
| File open (`useDocumentHandlers` ← `loadFla`) | `replaceDoc` + `clearHistory` |
| Project restore / autosave / Open Recent | `replaceDoc` + `clearHistory` |
| Dev/test bridge, agent `loadFla` tool | `pushDoc` |
| ClassesPanel `.as` edits | `pushDoc` |
| Undo / redo | `undo` / `redo` |

Two notes carried forward:
- `replaceDoc` fires high-frequency, non-undoable interim updates during a drag;
  `commitDrag.finalDoc` is the authoritative sync point. The binding syncs on
  every change (each is one small transaction); a future phase may coalesce
  interim drag frames if the provider's update rate warrants it.
- `hooks/useHistory.ts` is a *separate* React-reducer history used only by tests;
  it is not wired to the live store, so it is not a live bypass.

---

## 5. Acceptance — the property test (the gate)

`packages/collab/src/__tests__/property.test.ts`.

For **120 random seeds × 60 steps each (7,200 mutation steps)**, a seeded PRNG
drives a sequence of mutations through the **REAL `@flash/core` pure functions**
(`timeline.ts`, `document-mutations.ts`, `library.ts`), the source document is
synced through a `FlashCollabBinding` into a **second (remote) `Y.Doc`** over an
in-process wire, a `FlashDocument` is rebuilt from the **remote** `Y.Doc`, and it
is asserted **deep-equal to the source — after every step**, not just at the end.
Plus a 200-step local-peer round-trip and a minimal-delta proof (a single scalar
edit produces < half the bytes of a full re-materialize).

Coverage spans add/remove/move/update across **scenes, layers, frames,
displayObjects, library items + folders, asClasses, document properties, and
symbol nested timelines** (see `mutators.ts`).

`binding.test.ts` adds CRDT-behavior tests: origin filtering (remote edit →
`applyRemote`, own writes ignored, no echo), **per-field merge** (A edits `x`, B
edits `y` of the same object → both survive), **atomic geometry LWW** (concurrent
whole-`shape` edits converge to exactly one of the two values), **character-level
`asClasses` merge** (disjoint inserts both survive), and **late-join adoption**.

Result: **9/9 tests pass** (`pnpm --filter @flash/collab test`).

---

## 6. Honest tradeoffs & known limits

- **Positional arrays for scenes/layers/frames.** Per the approved spec these are
  `Y.Array`s reconciled by index (frames are id-less). Two peers concurrently
  *inserting at the same index* could interleave; the property test (single-doc
  sequential mutation) does not exercise that, and it is acceptable for P0. A
  later phase could key layers/scenes by their stable ids for stronger concurrent
  insert semantics — at the cost of more mapping machinery.
- **Atomic geometry.** `shape` (and `filters`, `colorEffect`, `warp`, …) are
  whole-value last-writer-wins. Two peers reshaping the same shape lose one
  edit's geometry — by design: segment-level merge has no stable identity and
  would require a forbidden custom merge. This matches Flash's own
  one-artist-per-shape reality.
- **`flaSwfBlobs`** is import-only and mapped atomically (base64); not produced by
  any mutation, so it is outside the property test's generated surface.
- **No networking / presence / asset transport yet** (phases 1–5). Bitmap/sound/
  video `dataUri` bytes are intentionally **not** in the `Y.Doc`; assets will be
  transported out-of-band by `assetId` + hash in P4. (At P0 the model's `dataUri`
  is just a string field and round-trips like any scalar — but the design point
  for P4 is that large bytes never enter the CRDT.)
- **Interim drag frames** sync as individual transactions today; coalescing is a
  possible P1+ optimization, not a correctness issue.

---

## 7. The surface phases P1–P5 build on

From `@flash/collab`:

- `class FlashCollabBinding` — the store↔Y.Doc synchronizer (outbound diff +
  origin-filtered inbound `replaceDoc`).
- `interface DocSource` — the host hook contract.
- `flashDocToYDoc(doc, origin?)` / `yDocToFlashDoc(ydoc)` — one-shot projection.
- `materializeDoc` / `diffDoc` / `rebuildDoc` / `getRoot` / `ROOT_KEY` — the
  low-level mapping (advanced / custom providers).
- `jsonEqual` / `cloneJson` / `Json` — plain-JSON helpers.

From `@flash/authoring-ui`:

- `attachCollab(documentStore, ydoc, options?)` — the single opt-in entry point;
  returns `{ binding, detach }`. **Calling it is what turns collaboration on.**
- `storeAsDocSource(store)` — wraps a `DocumentStoreApi` as a `DocSource`.
- `COLLAB_ENABLED_DEFAULT = false` — the documented default-OFF flag.

A P1 provider phase wires a `Y.Doc` to y-webrtc/y-websocket and calls
`attachCollab` behind a UI toggle; nothing else in the editor needs to change.

---

## 8. Phase 1 — y-webrtc transport + shareable link + opt-in join (task 1344)

P1 adds the network. It is the **only** place a provider is constructed, and it
constructs one **only** when the user explicitly starts or joins. In the solo
app — and at startup — nothing here runs: no `WebrtcProvider`, no signaling
socket, no WebRTC, no awareness. Default OFF is preserved
(`COLLAB_ENABLED_DEFAULT = false` still gates the editor toggle a later phase
wires).

### 8.1 The transport — y-webrtc

We use **y-webrtc** (Yjs-native): a WebRTC **mesh** between peers, a **public
signaling server** for the handshake only, and **room-password end-to-end
encryption**. There is **no server of ours**. y-webrtc derives an AES-GCM key
from the room password (PBKDF2) and encrypts every WebRTC and BroadcastChannel
message, so a peer cannot join — or read any document bytes — without the
password. Reconnection is handled entirely by y-webrtc/Yjs: a dropped peer
re-exchanges only the missing updates via the Yjs state-vector protocol.

### 8.2 The shareable link — secret in the URL fragment

```
#room=<random-room-id>&k=<E2E-password>
```

- `room` is the y-webrtc **room name** (also the link's room id).
- `k` is the y-webrtc **room password** = the **end-to-end key**.

Both live in the URL **fragment** (`#…`). Browsers never transmit the fragment in
an HTTP request, so the signaling server never sees the room or the key — the
share link itself is the capability. `collabLink.ts` is a pure module:
`generateCollabLink()` mints a 128-bit room id + 256-bit key with the Web Crypto
RNG (base64url); `buildShareUrl(base, link)` / `parseCollabLink(input)` round-trip
the fragment. A normal (non-collab) URL parses to `null`, so opening one never
auto-joins.

### 8.3 Start vs. join (the seeding order is load-bearing)

`collabSession.ts` owns the provider. Two flows, distinguished only by **when**
the binding attaches relative to first sync:

- **`startCollab(store)` — host.** Mint a fresh room+key, **attach the binding
  first** (P0 seeds the local document into the new, empty `Y.Doc` — the host's
  doc becomes the shared session state), then bring up the provider. Returns
  immediately with a live `CollabSession` whose `link` is the invite to share.
- **`joinCollab(store, link)` — joiner.** Bring up the provider **first**, await
  the first `synced` event (so the `Y.Doc` is populated with the existing
  session's state), **then attach the binding** — which, seeing a non-empty
  `Y.Doc`, takes P0's **late-join adoption** path: it rebuilds the remote document
  and `replaceDoc`s it into the local editor (a remote edit, so **no local undo
  entry**). After that, local and remote edits flow both ways and Yjs reconciles.
  A fresh/empty room never fires `synced`, so a `syncTimeoutMs` (default 8 s)
  binds anyway — an empty room then behaves like a host start.

### 8.4 Signaling configuration (user-editable)

`signaling.ts` exposes the signaling server list. The default is the **public
Yjs y-webrtc signaling server** (`wss://y-webrtc-eu.fly.dev`) — a **third-party,
best-effort** service. It is user-editable (`getSignalingServers()` /
`setSignalingServers(raw)`, persisted in `localStorage`); a session may point at
a self-hosted server (the y-webrtc repo ships a one-file Node signaling server).
**The signaling server only brokers the WebRTC handshake (SDP/ICE). It never sees
document bytes (they flow P2P over WebRTC) nor the password `k` (it lives only in
the link fragment, which is never transmitted).**

### 8.5 Acceptance

`packages/authoring-ui/src/collab/__tests__/` (19 tests, all green; full
authoring-ui suite 1087/1087, collab P0 still 9/9):

- **`collabLink.test.ts`** — generate→fragment→parse round-trip; secret is in the
  fragment, never the path/query; a normal URL parses to `null`; tokens are
  random + URL-safe.
- **`signaling.test.ts`** — public `wss://` default; user-override parsing.
- **`convergence.test.ts`** — **two peers converge.** y-webrtc needs a real WebRTC
  stack (absent in Node), so the test stands in y-webrtc's exact place —
  replicating Yjs updates between two `Y.Doc`s over a loopback wire
  (`encodeStateAsUpdate`/`applyUpdate`) — and drives the **real** `@flash/core`
  mutations through two stores + two `attachCollab` bindings. Edits on either peer
  appear on the other; both documents end deep-equal; a remote edit creates no
  local undo entry on the receiver.
- **`collabSession.test.ts`** (mocked `WebrtcProvider`) — **default OFF** (no
  provider until start/join); start seeds + surfaces a link; provider gets the
  room as name and the key as `password`; **join adopts on first sync** (binding
  attaches only after `synced`, then merges the remote doc); empty-room timeout.

### 8.6 The surface P2 (awareness/presence) builds on

`CollabSession` (from `@flash/authoring-ui`) exposes everything P2 needs:

- `session.provider: WebrtcProvider` — and y-webrtc's provider already owns a
  `provider.awareness` (a `y-protocols/awareness` `Awareness`) created per
  session. P2 sets local state (`awareness.setLocalStateField('user', {...})` for
  cursor/selection/name/color) and observes `awareness.on('change', …)` to render
  remote presence. No new transport is needed — awareness rides the same
  encrypted y-webrtc mesh.
- `session.ydoc` / `session.binding` — the shared doc + the live binding.
- `session.link` / `shareUrl()` / `fragment()` — the invite.
- `session.synced` / `session.signaling` / `session.stop()` — status + teardown.

---

## 9. Phase 2 — awareness / presence (task 1345)

P2 adds **non-persistent presence** on top of P1's transport. It touches the
document **not at all** — the awareness channel is a separate `y-protocols`
substate that y-webrtc multiplexes over the same encrypted mesh. Nothing here
runs solo: the awareness controller, overlays, and avatars only exist inside a
live `CollabSession`, and every presence component returns `null` / no-ops with
zero peers.

### 9.1 The awareness state shape

Each peer broadcasts one `AwarenessState` (`collab/awarenessState.ts`), set
field-by-field via `awareness.setLocalStateField`:

```ts
interface AwarenessState {
  user: { id; name; color };        // stable local identity (collab/localUser.ts)
  cursor: { x; y } | null;          // STAGE coords (uiStore.cursorPos), null off-stage
  scene: number;                    // uiStore.activeSceneIndex
  frame: number;                    // uiStore.currentFrame
  editContext: { mode: "document" | "symbol"; symbolId?; symbolName? };
  selection: { shapeIds: string[]; instanceId: string | null };
  tool: string;                     // uiStore.toolState.activeTool
}
```

`user` is a **stable per-browser identity** (`localUser.ts`): a random id, a
friendly random name, and a palette color derived deterministically from the id,
persisted in `localStorage` so a collaborator keeps the same color/name across
reloads. It is never written to the Y.Doc.

### 9.2 uiStore → awareness (outbound, throttled cursor)

`attachAwareness(awareness, uiStore, user, opts)` (`collab/awareness.ts`)
subscribes the uiStore and, on every change, projects the snapshot
(`uiStateToAwareness`) and pushes **only the fields that changed**
(`changedAwarenessFields`). The **cursor** — the one high-frequency field (fires
on every mousemove) — is throttled to at most one broadcast per
`cursorThrottleMs` (default **50 ms / 20 Hz**), with a trailing-edge timer so the
**last** position in a burst always lands; every other field
(scene/frame/selection/tool/editContext) broadcasts immediately. The initial
seed (cursor still `null`) does not start the throttle clock, so the user's first
real move is instant.

### 9.3 awareness → UI (inbound) + rendering

`awareness.on('change')` drives `readPeers(awareness)` — all clients **except**
`awareness.clientID`, defensively parsed by `asPeerPresence` (a malformed payload
is dropped, never thrown on). The React layer subscribes through `usePeers()`
(`collab/CollabContext.tsx`), which re-renders on every peer change **and on
TTL-driven drops**.

- **Live cursors + selection outlines** — `RemoteCursorsOverlay` renders inside
  StageArea's existing `stageOverlay` slot, which is **stage-space** (the
  container carries the CSS zoom/pan), so a peer's stage-coord cursor maps
  straight to `left`/`top`; screen-constant sizes (caret, label, outline stroke)
  are divided by `zoom`. Only peers **co-located** with the local user (same
  scene + frame + edit-context) are drawn — a cursor from a peer in another
  scene/symbol would be meaningless locally. Each peer's selection
  (`shapeIds` + `instanceId`) is resolved against the active keyframe's display
  objects and outlined in the peer's color (`getTransformedBounds`).
- **Presence avatars** — `PresenceAvatars` renders a chip per peer (+ self) in
  the EditBar's right slot, colored, with initials and a hover tooltip showing
  where they are.
- **Library "editing this symbol" badge** — `symbolEditorsFromPeers` groups
  peers by `editContext.symbolId`; `LibraryPanel` draws a colored dot per remote
  editor next to the symbol's name.

The store-connected wrappers (`collab/CollabPresence.tsx`:
`PresenceAvatarsConnected` / `RemoteCursorsConnected` / `LibraryPanelConnected`)
read `usePeers()` + the stores and are dropped into the Shell so the Shell body
itself needs no presence plumbing.

### 9.4 Follow-a-peer

Clicking a peer's avatar **follows** them: `PresenceAvatarsConnected.onFollow`
jumps the local view to the peer's `scene`/`frame` and matches their
edit-context (entering / exiting symbol-edit), so you land exactly where they are
working.

### 9.5 TTL — the protocol's built-in timeout (no custom drop logic)

There is **no custom presence-expiry code**. `y-protocols/awareness` stamps every
state with a `lastUpdated` and runs an internal interval that calls
`removeAwarenessStates` for any client not refreshed within `outdatedTimeout`
(**30 s**), firing a `change`/`update` with that client in `removed`. A peer that
closes its tab or drops its WebRTC connection therefore disappears on its own. We
only **re-stamp our own** state on a keepalive (default 15 s, well under the
timeout) so a quiet local peer is never falsely reaped, and on a graceful
`leave`/`stop` we broadcast `setLocalState(null)` so peers see us go immediately
(the TTL is just the fallback for an ungraceful drop).

### 9.6 Session wiring

`startCollab` / `joinCollab` (`collab/collabSession.ts`) gained an optional
`uiStore` (+ `user`): when present they call `attachAwareness(provider.awareness,
uiStore, user)` and expose `session.awareness` + `session.awarenessController`.
`CollabProvider` (mounted in `Shell` inside `StoreProvider`) owns the live
`CollabSession | null` and the `start`/`join`/`leave` actions, passing the doc +
UI stores in. Default state is `null` (solo). `stop()` detaches presence
**first** (broadcast offline), then the binding, then destroys the provider/Y.Doc.

### 9.7 Acceptance

`packages/authoring-ui/src/collab/__tests__/` (P2):

- **`awarenessState.test.ts`** — uiStore → awareness field mapping (cursor,
  scene, frame, selection, tool, editContext incl. symbol vs document), the
  defensive remote-state parse, the change-diff (cursor-throttle gate), and the
  symbol-editors grouping.
- **`awareness.test.ts`** — the controller over **two real `Awareness` instances
  wired loopback** (y-webrtc absent in Node, same stand-in pattern as P1's
  convergence test): outbound broadcast reaches a peer; cursor updates throttle
  and flush the **last** position; `readPeers` collects a simulated remote and
  excludes self; **TTL drop** — graceful `detach` (offline broadcast) AND the
  protocol's `removeAwarenessStates` sweep both remove the peer.
- **`presenceRender.test.ts`** (jsdom) — a simulated remote awareness state
  renders a live cursor at its stage coords, a per-user selection outline, and a
  presence avatar (with follow-on-click); a non-co-located peer and the solo
  (no-peer) case render nothing.

Full authoring-ui suite **1109/1109** green; collab P0 still **9/9**.

### 9.8 Honest limits

- Remote cursors/selection draw only for **co-located** peers (same
  scene/frame/edit-context); cross-context presence is surfaced via the avatars +
  follow, not on the stage.
- Selection outlines are **AABBs** (`getTransformedBounds`), not the exact
  per-object halo the local selection uses — sufficient to show *what* a peer has
  selected without re-deriving each object's precise transform on every change.
- **Remote code-edit cursors for `asClasses` Y.Text** were scoped but deferred:
  the ClassesPanel uses the shared `ScriptEditor` whose textarea selection is not
  yet surfaced to awareness. The awareness shape has room for it (a future
  `codeCursor` field); not wired in P2.

---

## 10. Phase 3 — per-origin collaborative undo (task 1346)

P3 makes undo **collaboration-aware**: during a session each peer undoes only its
**own** edits, never a concurrent edit a remote peer made. Solo undo is untouched.

### 10.1 The two undo models, and the seam between them

There are two undo stacks, and exactly one is live at a time:

- **SOLO — snapshot undo (unchanged).** The existing immutable snapshot history
  (`@flash/core` `history/history.ts` + the store reducer in `store/history.ts`;
  the current doc **is** `history.present`). `pushDoc` pushes a snapshot,
  `undo`/`redo` walk `past`/`future`. **Zero change** to this path — same code,
  same references, same tests.
- **COLLAB — `Y.UndoManager` scoped to the local origin.** A `Y.UndoManager` over
  the binding's root subtree with `trackedOrigins = new Set([localOrigin])`, where
  `localOrigin` is the exact origin the P0 binding tags **outbound** transactions
  with. Because every peer writes its edits under its own (distinct) `localOrigin`,
  the UndoManager captures **only this peer's** changes — so an undo can never
  revert a remote peer's edit.

The seam is the **store's `undo`/`redo`**, which are already the single chokepoint
every undo/redo path routes through (`commands/history.ts`, `Shell.tsx`,
`agent/registry.ts`). The store gained `setCollabUndo(handler | null)`:

- **`setCollabUndo(handler)`** (called on session attach) — `undo`/`redo` delegate
  to the handler (the `Y.UndoManager`); the snapshot `HistoryState` is **frozen
  aside**; and **local edits stop pushing snapshot entries** (`pushDoc` /
  `commitDrag` behave like `replaceDoc` for the session's duration, so the snapshot
  stack neither grows nor is consulted while collaborating).
- **`setCollabUndo(null)`** (called on session detach) — the frozen snapshot stack
  is **restored** onto the current present (which may be a remotely-merged doc), so
  solo undo continues from where it left off before the session.

### 10.2 How a collab undo flows back to the UI

`manager.undo()` applies the **inverse** change to the `Y.Doc` inside a Yjs
transaction whose origin is the UndoManager itself — **not** `localOrigin`. So the
binding's INBOUND `observeDeep` (which ignores only `txn.origin === localOrigin`)
fires, rebuilds the `FlashDocument`, and calls `applyRemote` → the store's
`replaceDoc`. The undone state lands in the store and the stage re-renders, exactly
the same path a remote peer's edit takes — and `replaceDoc` never pushes a snapshot
entry, so the frozen stack stays clean. The undo's Y update also replicates to the
other peers (an undo is just another edit), so all peers converge.

### 10.3 Wiring

`createCollabUndoManager(binding)` (`packages/collab/src/undo.ts`) is the only
place `Y.UndoManager` is constructed — it stays in `@flash/collab` so Yjs never
leaks into `@flash/core` or the solo path. `attachCollab` (`store/collabAdapter.ts`)
now creates it, registers it via `store.setCollabUndo(...)`, and returns it on
`AttachCollabResult.undoManager`; `detach()` calls `setCollabUndo(null)` (restoring
solo undo) then destroys the manager and binding. The binding exposes its `root`
`Y.Map` (read-only) so the UndoManager can scope to exactly that subtree.

### 10.4 Acceptance

`packages/authoring-ui/src/collab/__tests__/collabUndo.test.ts` — a 2-peer
**loopback** session (the same in-process Yjs replication P1's convergence test
uses, since y-webrtc needs a real WebRTC stack absent in Node):

- **A's undo reverts only A's edit.** A and B each add a scene; A's undo removes
  **only** A's scene on **both** peers, leaves B's scene intact, and does not grow
  A's frozen snapshot stack. A's redo re-applies it and both peers converge.
- **Symmetry** — the same holds for B's undo (each peer tracks its own origin).
- **Solo undo/redo unchanged** — with no session, snapshot undo restores the exact
  previous/next document references and stack depths.
- **Session-end restores the snapshot stack** — a solo edit's undo entry frozen at
  start is restored on `detach`, and solo undo works again afterward.

Full authoring-ui suite **1113/1113** green; collab P0 still **9/9**.

### 10.5 Honest limits / tradeoffs

- **Correctness over reach: the snapshot stack is frozen, not merged.** During a
  session, local edits do not accumulate snapshot undo entries — undo is served
  solely by the per-origin UndoManager. This is the safe choice: routing collab
  undo through the snapshot reducer would let an undo replay a *whole-document*
  snapshot over the shared Y.Doc and **clobber a remote peer's concurrent edit**.
  The tradeoff is that on session end the undo stack is the pre-session snapshot
  stack (plus the current, possibly-merged present) — in-session edit history is
  not converted into snapshot entries.
- **Atomic-geometry inheritance.** The UndoManager undoes Y changes, so the same
  whole-value LWW granularity as P0 applies (a `shape`/`filters`/`warp` edit undoes
  atomically). Per-field scalar edits undo per field, matching the binding's map.
- **One logical edit = one undo step** via `captureTimeout: 0` (the store emits one
  transaction per `pushDoc`/`commitDrag`); rapid-edit coalescing is available but
  off by default.

## 11. Trust model & inbound validation (task 1350)

**The peers are untrusted.** The collab trust model is Google-Docs-style: anyone
with the share link is a full read/write collaborator (the room id + E2E password
live in the URL fragment, §8.2). There is no per-peer authorization. A peer is
therefore *untrusted input*: it may be malicious, or simply a buggy/old client,
and it can put **arbitrary CRDT state** into the shared `Y.Doc`. Yjs replicates
that state to everyone, and the binding's inbound path (`rebuildDoc` →
`applyRemote` → `replaceDoc`) turns it back into a live `FlashDocument`.

**Why a verbatim rebuild is dangerous.** `rebuildDoc` ends in
`... as unknown as FlashDocument` — a cast, not a check. Without validation, a
peer's malformed state flows straight into the model that the renderer and the
SWF compiler index *structurally* (e.g. `scenes[0]`, `frame.displayObjects.map`,
`obj.x * 20`). A hostile/buggy peer could thereby:

1. **Crash / DoS** every collaborator's editor — a non-array where an array is
   expected, an unknown display-object `type` the renderer doesn't handle, `NaN`/
   `Infinity` coordinates that poison layout maths, or an oversized/deeply-nested
   payload that exhausts memory or the stack.
2. **Corrupt the shared doc** for everyone (one bad delta, broadcast to all).
3. **Traverse the filesystem** on a later class sync — `asClasses` paths arrive
   keyed by a raw `path`; a crafted `../`/absolute/NUL path could escape the
   class-VFS root (`WebClassVfs`/`TauriClassVfs` disk mirror) when the joiner
   syncs classes to disk. `normalizeClassPath` is the existing defence, but the
   rebuild did not invoke it.

### The defence: `validateInboundDoc` (`packages/collab/src/validate.ts`)

Every inbound rebuild is now run through `validateInboundDoc(rebuildDoc(ydoc),
lastGood)` **before** it reaches `applyRemote`/`replaceDoc` — in the binding's
deep observer, in the late-join constructor adoption, and in the one-shot
`yDocToFlashDoc` helper. It is a **total function**: it never throws and always
returns a structurally-valid `FlashDocument`.

It is *defensive normalization*, not a full schema. It enforces the shape
invariants downstream consumers actually rely on and **drops or coerces** anything
that violates them (logging one capped warning per piece), rather than throwing or
propagating garbage:

- **Top level**: `id`→string; `properties`→a valid `DocumentProperties` (built
  from `createDocumentProperties()` defaults, then sane finite/clamped `width`/
  `height`/`frameRate`, string `backgroundColor`); `scenes`→a **non-empty** array
  of valid scenes (a fresh scene if none survive — scene 0 is indexed
  unconditionally); `library`→`{items, folders}` (arrays).
- **Scenes / layers / frames / timelines**: each must be an object with its
  structural children present as arrays; missing/ wrong-type children become empty
  arrays; an id-less scene is dropped.
- **Display objects**: dropped unless `type` is a **known** discriminant (`shape`/
  `instance`/`drawing-object`/`text`/`bitmap`/`video`/`group`) AND `id` is a
  non-empty string; `x`/`y` (and any nested numeric in an atomic field) coerced
  from `NaN`/`Infinity` to a finite value.
- **Library items**: dropped unless `itemType` is known (`symbol`/`bitmap`/
  `sound`/`video`/`font`/`component`) AND `id` is a string; duplicate ids dropped;
  symbols get a validated nested timeline.
- **`asClasses`**: each `path` is run through `normalizeClassPath` — traversal
  (`..`), absolute, NUL-byte and empty paths are **rejected and dropped**;
  `source` is coerced to a string. (Absolute paths are *trimmed* to relative by
  `normalizeClassPath`, matching the rest of the VFS, not dropped.)
- **Resource bounds**: arrays are capped (`MAX_ARRAY_LEN`) and the generic
  atomic-value sanitizer is depth-bounded (`MAX_VALUE_DEPTH`), so a cyclic-ish or
  oversized payload is truncated instead of hanging/OOMing.

**Fail safe.** When the input is too broken to be a document at all (e.g. not an
object), the binding passes the **last-good** document as the fallback, so a
garbage update keeps the previous valid state rather than blanking the editor.

**Valid state is unaffected.** The validator is identity-equivalent on a
well-formed document (`validateInboundDoc(validDoc)` deep-equals `validDoc`), so
legitimate remote edits propagate unchanged. The P0 property/round-trip gates
(which exercise `rebuildDoc` directly) are untouched.

### `rebuildDoc` must not crash *before* the validator runs (task 1351)

`validateInboundDoc` runs on the **output** of `rebuildDoc` — so `rebuildDoc`
itself has to be crash-proof, or the validator never gets a chance. The one place
it wasn't: every **atomic** (non-structural) field is read back with `cloneJson`
(`packages/collab/src/json.ts`), a recursive plain-JSON deep clone. A peer can
store a **live Yjs type** (`Y.Map`/`Y.Array`/`Y.Text`) as the value of *any*
atomic field at *any* level (doc-level `properties`/`id`, a display object's `x`,
a scene/layer/frame/library-item scalar). `ymap.get(key)` returns that live
object, and cloning it recursed through Yjs's **cyclic internal item graph** →
`RangeError: Maximum call stack size exceeded`, thrown inside the binding's
`observeDeep` observer *before* `validateInboundDoc` could run. Any peer with the
share link could thus crash every collaborator — the exact DoS the validator
claims to defend.

The fix is in `cloneJson` (a pure hardening; a well-formed doc only ever stores
plain JSON atomically, so valid-doc behaviour is **identity**):

- It **drops any non-plain-JSON object** — a value whose prototype is not
  `Object.prototype`/`null` (i.e. a class instance such as a live Yjs type) is
  returned as `undefined` and the key is omitted; a Yjs type nested inside a
  plain array becomes `null` (array length preserved). The live graph is **never
  walked**. (`json.ts` stays Yjs-free — the check is structural, not
  `instanceof Y.AbstractType`.)
- Recursion is **depth-bounded** at `MAX_CLONE_DEPTH = 64` — kept equal to the
  validator's `MAX_VALUE_DEPTH` so the two limits agree — so a pathologically deep
  payload that reaches the clone is truncated instead of overflowing the stack.

`rebuildFields` then drops a key whose cloned value is `undefined`, so a hostile
Y-type-in-atomic-slot rebuilds as an **absent** field, which the validator
re-defaults (e.g. `properties` → `createDocumentProperties()`). Gate: the
`rebuildDoc stack-overflow hardening` cases in `validate.test.ts` (doc-level +
display-object-level Y-type-in-atomic driven through the real binding, plus a
5000-deep plain payload).

### What this does NOT cover (the script vector — explicit threat-model note)

Peer-supplied AS2 frame `script` text and `asClasses` *source* are compiled and
run on **every collaborator's machine**. This is **inherent to a doc-sharing
model** — exactly the same risk as opening someone else's `.fla` — and cannot be
neutralized by shape validation without breaking collaboration. The validator
sanitizes the *storage shape* of scripts (must be a string) and the *path* of
classes (no traversal), but a peer who can edit the doc can author code that runs
in your Test-Movie/Live-Preview Ruffle sandbox. A future hardening could gate
adopting remote AS2/`asClasses` behind explicit per-peer trust/confirmation; this
is noted as an open item, distinct from the transport/encryption hardening (P5,
task 1348) which protects the wire but not the inbound *model*.

### Acceptance

`packages/collab/src/__tests__/validate.test.ts` (13 cases): direct-validator
coercion/dropping (unknown kinds, missing ids, NaN coords, wrong-type structural
fields, clamped properties, oversized arrays, deeply-nested payloads, traversal/
NUL/absolute `asClasses` paths) + full binding scenarios (a peer injecting raw
hostile Y.Doc state does not crash the other peer; `yDocToFlashDoc` validates a
late-join read; valid remote edits still propagate unchanged). The P0
`binding.test.ts` (9) + `property.test.ts` (the 7,200-mutation identity gate) all
still pass — valid state is unaffected.

---

## 12. Phase 4 — collaboration UX + out-of-band asset sync (task 1347)

P4 makes collaboration *usable* (a real Share dialog + opt-in/leave control +
connection status, with the P2 presence surfaced where you'd expect it) and
closes the one byte-size hole P0 deliberately left open: bitmap/sound/video bytes
are transferred **out of band**, never through the CRDT.

### 12.1 The Share dialog + controls

`collab/ShareDialog.tsx` is the opt-in entry point (default OFF: nothing
constructs a provider or opens a connection until the user clicks Start/Join):

- **Start** mints a fresh room + E2E key, seeds the current document into the
  session, and shows the invite link (`session.shareUrl(location.origin +
  pathname)`) with a **Copy** button.
- **Join** parses a pasted invite (`parseCollabLink`) and connects.
- A live session re-opens to grab the link again.

The **honest note** is shown in every state and is non-negotiable: (1) anyone
with the link gets **full edit access** — treat it like a password; (2)
collaborators connect **peer-to-peer over WebRTC**, so their **IP addresses are
visible** to one another; (3) the document is **end-to-end encrypted** and travels
**directly between peers** — there is **no server of ours** in the middle (the
public signaling server only brokers the handshake; it never sees the data or the
key, which lives only in the URL fragment).

`collab/CollabControls.tsx` lives in the EditBar's right slot next to the P2
presence avatars (`Shell.tsx` `rightSlot`): solo shows a **"Collaborate…"** button
that opens the dialog; in a session it shows a **connection-status pill**
(connecting / connected + peer count, via `useCollabStatus` reading the provider's
`peers`/`synced` events) and a **Leave** button. The P2 avatars + remote cursors +
follow-a-peer are unchanged — P4 only makes the entry point discoverable.

### 12.2 Out-of-band asset sync — the design

P0 mapped a media item's `dataUri` as an ordinary scalar; the design point it
recorded was that **large bytes must never enter the CRDT** in a real session.
P4 enforces that at the **collab adapter boundary** — NOT inside the
`@flash/collab` binding — so the P0 property test (which has no asset store)
keeps round-tripping `dataUri` as a plain scalar and stays the gate (still
**9/9**). Two pure transforms (`collab/assetExternalize.ts`), mirroring the
`.fla` zip externalization (`zip.ts`, where a `dataUri` becomes a short
`asset:<path>` reference + separate bytes):

- **OUTBOUND** (`externalizeAssets`, wired into the adapter's `getDoc`): before
  the local doc is projected into the Y.Doc, replace each bitmap/sound/video
  `data:` URI with an **`asset-hash:<sha256>`** reference and stash the bytes in
  the local `AssetStore` (`collab/assetStore.ts`, content-addressed by hash). The
  Y.Doc only ever carries the short reference.
- **INBOUND** (`internalizeAssets`, wired into the adapter's `applyRemote`): after
  a remote doc is rebuilt, resolve each `asset-hash:` reference back to a real
  `dataUri` **if** the bytes are held locally; otherwise leave the reference (a
  **missing-asset placeholder** the renderer draws) and collect the hash to fetch.

The content hash is a pure, synchronous, dependency-free SHA-256
(`@flash/core` `fla/asset-hash.ts`) — `@flash/core` must import cleanly in
Node/browser/Tauri (no `node:crypto`, no async `crypto.subtle`), and the outbound
diff path is synchronous. `zip.ts` was refactored to reuse the same base64 /
dataUri helpers.

### 12.3 The asset channel — lazy, content-addressed, pull-based

`collab/assetChannel.ts` `AssetSyncEngine` drives a tiny request/response
protocol over a transport-agnostic `AssetTransport`:

- A peer missing the bytes for a referenced hash **broadcasts a REQUEST**.
- A peer holding those bytes **answers with a RESPONSE** carrying them.
- The requester stores the bytes; the `AssetStore` fires `onAssetAvailable`,
  which **re-internalizes** `history.present` and `replaceDoc`s it (not
  `pushDoc` — the resolution is exactly like a remote edit landing, so it is not
  a local undo entry). The placeholder resolves to the real bitmap/sound/video.

Outstanding requests **retry** on a timer (default 4 s) so a holder that joins
*after* the first request still answers. The request issued during an inbound
apply is **deferred to a microtask** so the placeholder doc lands in the store
before a (synchronous, in test) response arrives.

The **production transport** (`collab/webrtcAssetTransport.ts`) rides the SAME
WebRTC peer connections y-webrtc already maintains — no new server, no second
signaling connection. Frames carry a 4-byte magic prefix so our data listener can
distinguish them; they also reach y-webrtc's own reader, which logs a benign
`console.error` on the unknown type (no functional effect — the cost of not
forking y-webrtc). The **test transport** is an in-process loopback mesh
(`createLoopbackTransports`), mirroring P1's convergence wire, so the whole
protocol is unit-testable without a real WebRTC stack (absent in Node).

The session (`collab/collabSession.ts`) constructs the asset sync controller
(`collab/assetSync.ts`) before the binding so the host's seeding `externalize`
stashes its own asset bytes (answerable immediately) and the joiner's adoption
`internalize` requests the missing ones. `session.assetStore` / `assetSync` are
exposed; teardown is wired into `stop()`.

### 12.4 Missing-asset placeholder

`engine/renderer.ts` `renderMissingBitmapPlaceholder` draws a hatched box with a
dashed border + "loading…" label at the bitmap's placement bounds whenever the
image cache has no bytes for it — so a referenced-but-not-yet-fetched bitmap
shows **where** it will appear and that it is loading, instead of nothing. Once
the bytes arrive and the doc resolves, the normal `dataUri` → image-cache path
draws the real bitmap. (Sound/video already render their own placeholders.)

### 12.5 Acceptance

`packages/authoring-ui/src/collab/__tests__/` (P4) + `@flash/core`:

- **`asset-hash.test.ts`** (core) — SHA-256 matches `node:crypto` + FIPS vectors
  across block boundaries; base64 / dataUri round-trip; content-addressing
  (same bytes → same hash regardless of MIME); the `asset-hash:` ref scheme.
- **`assetChannel.test.ts`** — externalize replaces the `dataUri` with a hash ref
  and stashes bytes (idempotent); internalize resolves held bytes / reports
  missing; the request/response protocol over a loopback (fetch by hash, no
  request when already held, retry + late-joining holder answers).
- **`assetSync2peer.test.ts`** — the **2-peer gate**: A hosts a bitmap; B
  late-joins with NO assets; the CRDT carries only the hash; B sees the
  placeholder, requests by hash, A answers, and B's doc resolves to the real
  bytes (content hash matches). Plus a renderer assertion that an unresolved
  bitmap draws the placeholder, then the real image once resolved.
- **`shareDialog.test.ts`** (jsdom) — the dialog shows the honest note + Start/
  Join controls solo; **Start surfaces a link that parses back to the session's
  room + key** (the P1 round-trip, now through the dialog) with the secret in the
  fragment; the controls show a status pill + Leave in a session and return to
  solo on Leave.

Full authoring-ui suite **1127/1127** green; collab P0 property test still
**9/9**. (The 3 `flash8-empty.fla` binary-writer fixtures fail only because that
untracked dev-local fixture is absent in a fresh worktree — unrelated to P4.)

### 12.6 Honest limits / tradeoffs

- **Externalization is at the adapter, not the binding.** This is deliberate: it
  keeps the P0 property test (no asset store) the faithful gate, and means the
  "bytes out of the CRDT" guarantee holds for **live sessions** (which always
  attach the asset hook), while a binding used with no hook still round-trips
  `dataUri` as a scalar.
- **Whole-asset messages.** An asset is sent as a single data-channel message;
  simple-peer chunks large buffers internally, but very large bitmaps/sounds may
  still stress a browser's data-channel buffer. Chunked transfer + backpressure
  is a documented follow-up.
- **No persistence.** The `AssetStore` is in-memory; a reload re-derives it from
  the freshly-loaded document (exactly like the renderer's image cache). Bytes
  are re-fetched from peers on rejoin.
- **Benign y-webrtc log noise.** Our magic-prefixed asset frames hit y-webrtc's
  own message reader's unknown-type branch (one `console.error` each) because we
  do not fork y-webrtc to register a new top-level message type. Functionally
  inert.

### 12.7 Inbound asset trust — size cap + content-hash verification (task 1352)

The asset channel accepts a RESPONSE from **any joined peer** (the same
Google-Docs-style "anyone with the link is a collaborator" trust model as the
doc; §9), and P4 wired the Share dialog so this surface is now reachable
end-to-end by a real peer. An inbound RESPONSE frame is therefore **untrusted
input** and is validated before any bytes are internalized:

- **SIZE CAP — `MAX_ASSET_BYTES` (64 MiB), exported from `collab/assetChannel.ts`.**
  Without a cap a peer could answer a request with a multi-hundred-MB / GB payload;
  `bytes.slice()` (and the later base64 data-URI re-encode on resolution) would
  allocate a full copy per receiver → OOM / tab crash for everyone in the room.
  The cap is enforced at **three layers** so no single oversized allocation can
  slip through: (1) the **transport** (`webrtcAssetTransport.onPeerData`) drops a
  data-channel message larger than `MAX_ASSET_BYTES + 1024` (header slack) before
  it ever reaches the engine; (2) the **decode** layer (`assetChannel.decode`)
  returns `null` for a RESPONSE whose declared body exceeds the cap, *before*
  `frame.subarray`/`.slice()` materializes a copy; (3) the **accept** layer
  (`AssetSyncEngine.handle`) re-checks the actual byte length defensively. 64 MiB
  is generous for authoring bitmaps/sounds/video (a 4K 32-bit bitmap is ~33 MB)
  while bounding the worst case. (Chunked/streaming transfer + back-pressure
  remains the documented follow-up from §12.6; this bounds the single-frame path
  that exists today.)
- **CONTENT-HASH VERIFICATION.** The `AssetStore` is **content-addressed** — the
  Y.Doc references a library item by `asset-hash:<sha256>` and the bytes are
  supposed to be the bytes whose sha256 equals that hash. `AssetSyncEngine.handle`
  recomputes `sha256Hex(receivedBytes)` (the canonical hash from `@flash/core`
  `fla/asset-hash.ts`) and **drops the RESPONSE unless it equals the requested
  hash**. A malicious peer answering a request for hash X with arbitrary or crafted
  (e.g. malformed-image) bytes is thus a **no-op**: the store is never poisoned,
  the victim's legit library item is never overwritten, the image decoder never
  sees attacker-controlled bytes, and the **missing-asset placeholder stays** until
  the honest holder's correct bytes arrive (first-correct-writer-wins, not
  first-writer-wins). Unverified bytes are **never** internalized.
- **Acceptance** (`assetChannel.test.ts`, task 1352): an oversized RESPONSE is
  dropped without `put` ever being called (placeholder stays, no unbounded copy); a
  hash-mismatch RESPONSE is rejected (store not poisoned) while the honest holder's
  matching bytes still resolve; the valid 2-peer path (`assetSync2peer.test.ts`)
  still resolves end-to-end.

**Transport/E2E asymmetry (recorded, not a leak).** The DOC and AWARENESS ride
y-webrtc's password-derived AES-GCM E2E layer (§13); ASSET frames bypass it (own
MAGIC prefix + raw `peer.send`) and rely only on the WebRTC DTLS channel
encryption. No server/relay sees the bytes (direct P2P), so there is no
clear-text-via-signaling leak, but assets are not under the room-password E2E
layer the doc is. Acceptable for now; a follow-up could wrap asset frames in the
same room-key crypto.

---

## 13. Phase 5 — hardening (task 1348, FINAL phase)

P5 is the hardening pass that makes the feature shippable for real use. It adds
**no new product surface beyond a few warnings** — it sets expectations, surfaces
failure modes, measures the costs that matter, and proves the encryption claim.
Everything stays **default OFF**; nothing here runs solo.

### 13.1 Peer-count realism — graceful, no artificial cap

y-webrtc forms a **full WebRTC mesh**: every peer holds a direct connection to
every other peer, and each peer re-broadcasts every CRDT update + awareness
change to all of its links. So the connection count grows **O(N²)** and per-peer
bandwidth/CPU grows ~linearly with N. **Correctness is unaffected** — Yjs
converges regardless of N (proven by the 6-peer mesh test, §13.6) — but
**performance** degrades past a handful of peers: connection setup climbs, cursor
presence gets jittery, and a weak peer can stall.

We deliberately impose **no artificial cap** (the transport keeps working), but
we **set expectations**: `peerCountAdvice(peers)` (`collab/peerCount.ts`) is a
pure mapping from the provider's peer count to UI advice. Once participants exceed
the soft threshold `PEER_COUNT_WARN_THRESHOLD` (**15**) it returns
`warn: true` + a message suggesting the user split into smaller rooms. The warning
surfaces in two places: the EditBar **status pill** turns amber with a ⚠ and the
tooltip carries the message (`CollabControls.tsx`), and the Share dialog shows a
non-blocking **banner** (`ShareDialog.tsx`). Guidance for users: **a handful of
collaborators is the realistic Flash-authoring case and works smoothly; past ~15
people, split into multiple rooms.**

### 13.2 Reconnection edge cases — what Yjs gives free vs. what we add

The **document** recovers automatically: a dropped peer that reconnects
re-exchanges only the missing updates via the Yjs **state-vector** protocol, so
the CRDT converges with no help from us (the multi-peer reconnection test in
§13.6 proves a peer catches up on both the edits it missed AND pushes its own
offline edits on reconnect). Two things are **not** free, and
`attachReconnect` (`collab/reconnect.ts`, wired into every session and torn down
in `stop()`) hardens them:

1. **Awareness re-broadcast on (re)connect.** Presence is non-persistent and
   expires (the §9.5 30 s TTL). While disconnected we stop hearing peers'
   keepalives (they fade from our view) and our presence may be reaped on theirs.
   On every provider `peers` event that **adds** a peer (initial join, churn, or
   reconnect) the controller calls `awarenessController.flush()` — re-broadcasting
   our full presence so the new/returning peer sees us immediately, without
   waiting for our next field change.
2. **Signaling-health surfacing** (see §13.5).

### 13.3 Large-doc initial-sync + outbound-diff performance

Measured by `packages/collab/src/__tests__/perf.test.ts` on a **large doc built
from 4,000 real `@flash/core` mutations** (≈41 scenes, 244 library items,
**268 KiB** on the wire). Numbers from a representative CI-class run (the test
asserts loose guard rails to catch a 10× regression; the printed numbers are the
deliverable):

| Stage (one-time first sync) | Time |
|---|---|
| `materializeDoc` (host, once) | ~86 ms |
| `encodeStateAsUpdate` (the first-sync payload) | ~20 ms |
| `applyUpdate` (joiner) | ~25 ms |
| `rebuildDoc` (joiner) | ~32 ms |
| **TOTAL first sync** | **~163 ms** |

**Outbound diff (the steady-state cost):** a **single scalar edit** (move one
display object 1 px) on that 275 KB document produces a **31-byte** update —
**0.011%** of the full-doc bytes — in **~3.4 ms**. This is the minimal-delta
property (§1 / P0) holding on a big doc: the structural-sharing `diffDoc` descends
only where references differ, so per-edit cost is independent of document size.

**Conclusion / optimization:** no hotspot needs reworking. First sync is a
sub-200 ms one-time host+joiner cost even for a multi-thousand-object document,
and steady-state edits are tiny constant-size deltas. The dominant first-sync term
is `materializeDoc` (a one-time host cost paid before anyone joins). The perf test
stands as the regression guard.

### 13.4 Offline Y-state persistence (y-indexeddb) — DEFERRED (documented skip)

`y-indexeddb` would persist the `Y.Doc` to IndexedDB for offline editing / faster
rejoin. **We deliberately do NOT add it**, because it would create a **competing
persistence** with the existing **persistent-projects autosave** (task 1310),
which writes the **derived snapshot** (`.fla` bytes) to IndexedDB and is the
**authoritative restore path** on reload. Adding y-indexeddb means:

- Two IndexedDB stores holding the **same state in two representations** (the Yjs
  CRDT log vs. the serialized `.fla` snapshot), which can **diverge** — e.g. a
  reload restores the autosave snapshot into a fresh store, but a persisted Y.Doc
  from a *previous* session would then need reconciliation against it, and the two
  could disagree about which is newer.
- Unbounded growth of the Yjs update log (it never compacts the way a snapshot
  does), and a second source of `QuotaExceededError` to handle.
- A trust-model wrinkle: the persisted Y.Doc would retain whatever untrusted CRDT
  state peers pushed (§11), surviving a reload, where today a reload always
  re-derives from the validated snapshot.

The autosave snapshot already gives the user-facing benefit (F5 restores
in-progress work, even unnamed), and on rejoin the bytes a peer is missing are
re-fetched via the state-vector protocol (document) + the asset channel (media).
The faster-rejoin upside does not justify the divergence risk. **If revisited**,
the safe design is to make the autosave snapshot remain authoritative and treat a
persisted Y.Doc as a pure cache that is *discarded and rebuilt from the snapshot*
on any mismatch — not a second source of truth.

### 13.5 Signaling-server-down fallback

The signaling server only brokers the WebRTC handshake (§8.4) — it never sees
document bytes or the key. But if **every** configured signaling server is down, a
**new** peer can never discover an existing one (already-connected peers keep
working P2P over their established WebRTC links). P5 surfaces this:

- **Health detection.** y-webrtc's provider emits a `status` `{connected}` event
  and exposes `provider.connected` (true iff ≥1 signaling conn is up).
  `attachReconnect` tracks it and fans changes out
  (`session.signalingConnected` + `reconnect.onSignalingChange`).
- **Clear error.** The Share dialog shows a red **"Signaling server
  unreachable"** banner when the live session loses all signaling, explaining that
  existing peers stay connected but no one new can join.
- **User-editable URL + multiple servers.** The dialog's **Signaling server**
  section (`SignalingSettings`) edits the persisted list (`signaling.ts`,
  `localStorage`): one `wss://…` per line. Multiple entries give redundancy (a
  peer connects to all of them); a user can point at a self-hosted server (the
  y-webrtc repo ships a one-file Node signaling server). Changes take effect on the
  next start/join. The default is the public Yjs server
  (`wss://y-webrtc-eu.fly.dev`) — third-party, best-effort.

### 13.6 Acceptance — tests (the gates)

All green (full suites: `@flash/collab` 24/24, `@flash/authoring-ui` 1141/1141,
`@flash/swf` 1472/1472, `@flash/core` 5528/5530 — the 2 `@flash/core` failures
are the 3 `flash8-empty.fla` binary-writer fixture cases that ENOENT in a fresh
worktree because that untracked dev-local fixture is absent; unrelated to P5).

- **`collab/__tests__/multipeer.test.ts`** — **multi-peer + reconnection.** A
  full-mesh loopback bus (mirroring y-webrtc's mesh, since real WebRTC is absent
  in Node) drives REAL `@flash/core` mutations through real stores + `attachCollab`
  bindings: **6 peers** — an edit on any peer reaches all others and all 6
  documents converge byte-for-byte; a **dropped peer reconnects** and re-syncs
  both the edits it missed and its own offline edits via the state-vector
  exchange; **peer churn** — a peer leaves and a fresh peer joins mid-session,
  adopting the full current state, and all converge.
- **`collab/__tests__/reconnect.test.ts`** — the `attachReconnect` controller:
  re-flushes presence on a peer ADD (not on a remove); reports signaling health
  and fans only *changes* out; detach removes the handlers. Uses a real
  `y-protocols/awareness` loopback so the presence re-broadcast genuinely arrives.
- **`collab/__tests__/encryption.test.ts`** — **E2E-encryption verification.**
  Exercises the **real y-webrtc crypto** (`y-webrtc/src/crypto.js` `deriveKey` /
  `encrypt` / `decrypt` — the same code the live `WebrtcProvider` runs) on both a
  real **document** update and a real **awareness** update: the correct key
  round-trips to identical bytes; a **wrong password** (and a wrong room-name
  salt) **cannot decrypt** (AES-GCM auth-tag failure) — so a peer with the wrong
  `k` reads nothing; the plaintext secret never appears in the ciphertext bytes.
- **`collab/__tests__/perf.test.ts`** — the §13.3 measurement + the minimal-delta
  proof, with loose regression guard rails.
- **`collab/__tests__/peerCount.test.ts`** — the `peerCountAdvice` mapping
  (threshold boundary, non-finite clamping, message content).

### 13.7 Operations & security — the final guidance

- **Security model (unchanged, re-affirmed).** Google-Docs-style: **anyone with
  the share link is a full read/write collaborator.** The room id + AES-GCM
  password live in the URL **fragment** (`#room=…&k=…`), which browsers never
  transmit, so the signaling server sees neither the data nor the key. Treat the
  link like a password; to revoke access, start a **new** session (a fresh room +
  key) and re-share. The wire is end-to-end encrypted (§13.6 proves it). The
  **inbound model is validated** before it reaches the editor (§11). The one
  residual vector is **peer-authored AS2 `script`/`asClasses` source**, which runs
  in every collaborator's Ruffle sandbox — inherent to a doc-sharing model, the
  same risk as opening someone else's `.fla` (§11 threat-model note). Do not share
  a link with anyone you would not hand a `.fla` to run.
- **Privacy.** Collaborators connect **peer-to-peer over WebRTC**, so their **IP
  addresses are visible to one another**. There is **no server of ours**; the
  public signaling server is third-party and handshake-only. All three points are
  shown in the Share dialog's non-negotiable honest note (§12.1).
- **Sizing.** Smooth for a handful of collaborators; the UI warns past ~15 (§13.1).
  For larger groups, split into multiple rooms — there is no per-room participant
  cap, only the mesh's N² reality.
- **Signaling ops.** The public default is best-effort. For reliable / private use,
  run the y-webrtc one-file Node signaling server and set its `wss://` URL (or
  several, for redundancy) in the Share dialog's Signaling-server field (§13.5).
- **Persistence.** No collab-specific persistence: the **autosave snapshot
  remains authoritative** (§13.4). A reload re-derives everything from the
  validated `.fla` snapshot; missing document/asset bytes are re-fetched from peers
  on rejoin.

### 13.8 Residual limitations (the honest, final list)

- **N² mesh.** Large rooms degrade (performance, not correctness). No mediation
  server / SFU; splitting rooms is the answer. (P5 §13.1.)
- **No offline Y-state persistence.** Deferred by design to avoid competing with
  the authoritative autosave (P5 §13.4). Rejoin re-syncs from peers.
- **Peer code execution.** Remote AS2 source runs in your sandbox (§11 / §13.7) —
  not fixable by transport hardening; a future per-peer trust gate is the only
  remedy and is out of scope.
- **Positional-array concurrent same-index insert** can interleave (P0 §6); atomic
  geometry is **one-artist-per-shape** LWW (P0 §6); these are accepted CRDT-mapping
  tradeoffs, not P5 regressions.
- **Whole-asset data-channel messages** can stress the browser's buffer for very
  large media; chunked transfer is a documented P4 follow-up (§12.6).
- **Remote code-edit cursors** for `asClasses` Y.Text were scoped but deferred
  (P2 §9.8).
- **Benign y-webrtc log noise** from our asset frames (§12.6).

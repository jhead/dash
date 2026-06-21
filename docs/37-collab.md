# Collaboration — optional P2P multiplayer (docs/37)

Status: **Phase 2 complete** (task 1345) on top of **P1** (task 1344) and **P0**
(task 1343). P0 shipped the foundation: a faithful, property-tested Yjs binding
for the document model. P1 added the **opt-in y-webrtc transport + shareable link
+ join flow**. P2 adds **awareness/presence** — live cursors, selection outlines,
scene/frame/tool/edit-context presence, presence avatars, follow-a-peer, and a
Library "editing this symbol" badge — riding the same encrypted y-webrtc mesh via
`y-protocols/awareness`. Still **default OFF**: no provider, network, signaling
connection, or awareness exists until the user explicitly starts/joins a session;
solo has zero overhead. Phases 3–5 build asset transport, conflict UX, and the
editor toggle on top.

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

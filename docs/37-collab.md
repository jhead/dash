# Collaboration — optional P2P multiplayer (docs/37)

Status: **Phase 0 complete** (task 1343). This phase ships the foundation only:
a faithful, property-tested Yjs binding for the document model. It is **opt-in,
default OFF, and does no networking**. Phases 1–5 build the provider, presence,
asset transport, conflict UX, and the editor toggle on top of this binding.

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

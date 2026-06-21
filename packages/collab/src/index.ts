/**
 * @flash/collab — optional P2P multiplayer foundation (Phase 0).
 *
 * A faithful, derived Yjs binding for the immutable FlashDocument model. The
 * FlashDocument stays the single source of truth; the Y.Doc is a projection that
 * Yjs merges. Yjs is intentionally kept OUT of @flash/core — this package is the
 * only place it appears, so @flash/core stays pure Node/browser/Tauri.
 *
 * Nothing here does networking. The Y.Doc is the sync boundary; a provider
 * (y-webrtc/y-websocket, or an in-process wire in tests) replicates updates.
 *
 * The exports below are the surface phases 1-5 build on:
 *   - FlashCollabBinding / DocSource — the store<->Y.Doc synchronizer + its host hook.
 *   - flashDocToYDoc / yDocToFlashDoc — one-shot projection helpers.
 *   - materializeDoc / diffDoc / rebuildDoc — the low-level mapping (advanced use).
 */
export { FlashCollabBinding, flashDocToYDoc, yDocToFlashDoc } from "./binding.js";
export type { DocSource, FlashCollabBindingOptions } from "./binding.js";
export { materializeDoc, diffDoc, rebuildDoc, getRoot, ROOT_KEY } from "./schema.js";
export { jsonEqual, cloneJson } from "./json.js";
export type { Json } from "./json.js";

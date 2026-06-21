/**
 * Store-connected presence components (task 1345 P2).
 *
 * These wrap the presentational `PresenceAvatars` / `RemoteCursorsOverlay` and
 * the Library editing badge, reading the live peer list (`usePeers`) and the
 * stores (`useStores`) so the Shell only has to drop them into the right slots.
 * They are inert (render nothing, no subscriptions of consequence) when solo.
 */
import React, { useCallback, useMemo } from "react";
import { useStore } from "zustand";
import type { DisplayObject } from "@flash/core";
import { useStores } from "../store/StoreProvider.js";
import { LibraryPanel } from "../LibraryPanel.js";
import { resolveActiveTimeline } from "../selectors/active.js";
import { activeKeyframeForLayer } from "../selectors/derived.js";
import { useCollab, usePeers } from "./CollabContext.js";
import { PresenceAvatars } from "./PresenceAvatars.js";
import { RemoteCursorsOverlay } from "./RemoteCursorsOverlay.js";
import {
  type PeerEditContext,
  type PeerPresence,
  symbolEditorsFromPeers,
} from "./awarenessState.js";

/** Presence avatar row + follow-a-peer, wired to the uiStore. */
export function PresenceAvatarsConnected(): React.ReactElement | null {
  const { localUser } = useCollab();
  const peers = usePeers();
  const { uiStore, documentStore } = useStores();

  const onFollow = useCallback(
    (peer: PeerPresence) => {
      const ui = uiStore.getState();
      // Jump to the peer's scene/frame.
      ui.setActiveSceneIndex(peer.scene);
      ui.setCurrentFrame(peer.frame);
      // Match their edit context (enter / exit symbol edit).
      if (peer.editContext.mode === "symbol" && peer.editContext.symbolId) {
        const doc = documentStore.getState().history.present;
        const sym = doc.library.items.find(
          (i) => i.id === peer.editContext.symbolId && i.itemType === "symbol",
        );
        ui.setEditContext({
          mode: "symbol",
          symbolId: peer.editContext.symbolId,
          symbolName: peer.editContext.symbolName ?? sym?.name,
          symbolType: sym && sym.itemType === "symbol" ? sym.symbolType : undefined,
        });
        ui.setEditPath([]);
      } else {
        ui.setEditContext({ mode: "document" });
        ui.setEditPath([]);
      }
    },
    [uiStore, documentStore],
  );

  if (peers.length === 0) return null;
  return <PresenceAvatars localUser={localUser} peers={peers} onFollow={onFollow} />;
}

/** Remote cursors + selection overlay, wired to the stores. Lives in stageOverlay. */
export function RemoteCursorsConnected(): React.ReactElement | null {
  const peers = usePeers();
  const { uiStore, documentStore } = useStores();

  const zoom = useStore(uiStore, (s) => s.zoom);
  const scene = useStore(uiStore, (s) => s.activeSceneIndex);
  const frame = useStore(uiStore, (s) => s.currentFrame);
  const editContext = useStore(uiStore, (s) => s.editContext);
  const doc = useStore(documentStore, (s) => s.history.present);

  const localEditContext: PeerEditContext = useMemo(
    () =>
      editContext.mode === "symbol"
        ? { mode: "symbol", symbolId: editContext.symbolId, symbolName: editContext.symbolName }
        : { mode: "document" },
    [editContext],
  );

  // Display objects across all layers of the active timeline at the current
  // frame — the universe of ids a co-located peer's selection can resolve to.
  const activeObjects = useMemo<DisplayObject[]>(() => {
    const ui = uiStore.getState();
    const timeline = resolveActiveTimeline(doc, ui);
    const objs: DisplayObject[] = [];
    for (let li = 0; li < timeline.layers.length; li++) {
      const kf = activeKeyframeForLayer(timeline, li, frame);
      if (kf) objs.push(...kf.displayObjects);
    }
    return objs;
  }, [doc, frame, uiStore]);

  if (peers.length === 0) return null;
  return (
    <RemoteCursorsOverlay
      peers={peers}
      zoom={zoom}
      localScene={scene}
      localFrame={frame}
      localEditContext={localEditContext}
      activeObjects={activeObjects}
    />
  );
}

/**
 * Hook: `symbolId → editors` map for the Library "editing this symbol" badge.
 * Empty solo.
 */
export function useSymbolEditors(): Map<string, { color: string; name: string }[]> {
  const peers = usePeers();
  return useMemo(() => symbolEditorsFromPeers(peers), [peers]);
}

/**
 * LibraryPanel pre-wired with the collab "editing this symbol" badge. Drop-in
 * replacement for `<LibraryPanel/>` — forwards all props and injects
 * `symbolEditors` from the live peer list (empty / no badge solo).
 */
export function LibraryPanelConnected(
  props: Omit<React.ComponentProps<typeof LibraryPanel>, "symbolEditors">,
): React.ReactElement {
  const symbolEditors = useSymbolEditors();
  return <LibraryPanel {...props} symbolEditors={symbolEditors} />;
}

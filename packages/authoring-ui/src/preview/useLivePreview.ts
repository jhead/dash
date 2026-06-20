// ---------------------------------------------------------------------------
// useLivePreview — React adapter over LivePreviewController (task 1308).
//
// Wires the pure controller's debounced/superseding compile loop to:
//   - the zustand documentStore change subscription (auto re-compile triggers),
//   - the existing publish path (compileDocToBytes — the compiler is reused, not
//     duplicated), applying the start-from-scene/frame seek to a doc clone,
//   - React state so the panel re-renders on each snapshot.
//
// No UI-thread blocking: compileDocToBytes is async (awaits bitmap decode etc.);
// the controller debounces and supersedes so a fast typist never queues a stack
// of compiles. The controller is disposed on unmount/tab-switch so no pending
// timer or in-flight compile can publish into an unmounted panel.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, useCallback } from "react";
import type { FlashDocument } from "@flash/core";
import {
  LivePreviewController,
  type LivePreviewSnapshot,
} from "./livePreviewController.js";
import { applyStartAt, type StartAt } from "./startAt.js";

export interface UseLivePreviewParams {
  /** True while the Live Preview tab is mounted/active. When false, the loop is idle. */
  active: boolean;
  /** Auto re-compile on document changes (the auto-reload toggle). */
  autoReload: boolean;
  /** Current document (used for compile + reactive change detection). */
  doc: FlashDocument;
  /** Subscribe to document changes; returns an unsubscribe fn. */
  subscribeDoc: (listener: () => void) => () => void;
  /** Read the live document at compile time (avoids stale-closure on debounce). */
  getDoc: () => FlashDocument;
  /** Compile a (possibly derived) doc to SWF bytes, reusing the publish path. */
  compileDocToBytes: (
    targetDoc: FlashDocument,
    opts?: { skipSystemFontPrompt?: boolean }
  ) => Promise<Uint8Array>;
  /** Start-from-scene/frame seek applied to the compiled clone. */
  startAt: StartAt;
  /** Debounce window in ms. */
  debounceMs?: number;
}

export interface UseLivePreviewResult {
  snapshot: LivePreviewSnapshot;
  /** Force an immediate re-compile (manual Reload), bypassing the debounce. */
  reload: () => void;
}

export function useLivePreview(params: UseLivePreviewParams): UseLivePreviewResult {
  const {
    active,
    autoReload,
    doc,
    subscribeDoc,
    getDoc,
    compileDocToBytes,
    startAt,
    debounceMs = 350,
  } = params;

  const [snapshot, setSnapshot] = useState<LivePreviewSnapshot>(() => ({
    status: "idle",
    swfBytes: null,
    error: null,
    swfSize: 0,
    compileMs: 0,
    inFlight: false,
  }));

  // Keep the compile inputs in refs so the controller's compileFn always sees
  // the latest doc/startAt/compiler without re-creating the controller (which
  // would tear down the in-flight compile and leak a Ruffle reload).
  const getDocRef = useRef(getDoc);
  getDocRef.current = getDoc;
  const startAtRef = useRef(startAt);
  startAtRef.current = startAt;
  const compileRef = useRef(compileDocToBytes);
  compileRef.current = compileDocToBytes;

  const controllerRef = useRef<LivePreviewController | null>(null);

  // Create the controller once per "active" session. Disposed on deactivate.
  useEffect(() => {
    if (!active) return;
    const controller = new LivePreviewController({
      debounceMs,
      compileFn: async () => {
        const liveDoc = getDocRef.current();
        const derived = applyStartAt(liveDoc, startAtRef.current);
        // skipSystemFontPrompt: never trigger the Local Font Access permission
        // prompt on a background hot-reload (it would interrupt typing).
        return compileRef.current(derived, { skipSystemFontPrompt: true });
      },
      onChange: (snap) => setSnapshot(snap),
    });
    controllerRef.current = controller;
    // Kick an immediate first compile when the tab opens so it shows current state.
    controller.request({ immediate: true });
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
    // debounceMs is stable in practice; intentionally not re-creating on doc change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, debounceMs]);

  // Auto-reload: schedule a debounced re-compile whenever the document changes.
  useEffect(() => {
    if (!active || !autoReload) return;
    const unsub = subscribeDoc(() => {
      controllerRef.current?.request();
    });
    return unsub;
  }, [active, autoReload, subscribeDoc]);

  // Re-seek (immediate, no debounce) when start scene/frame changes while active.
  const startKey = `${startAt.sceneIndex}:${startAt.frame}:${startAt.hold ? 1 : 0}`;
  const lastStartKeyRef = useRef(startKey);
  useEffect(() => {
    if (!active) return;
    if (lastStartKeyRef.current === startKey) return;
    lastStartKeyRef.current = startKey;
    controllerRef.current?.request();
  }, [active, startKey]);

  // When auto-reload is OFF, a freshly-opened doc still needs one compile to
  // show; the immediate first compile in the create effect covers that.
  void doc;

  const reload = useCallback(() => {
    controllerRef.current?.request({ immediate: true });
  }, []);

  return { snapshot, reload };
}

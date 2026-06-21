import React, { useEffect, useRef, useCallback } from "react";
import type { RufflePlayerElement } from "./ruffle.d.ts";
import {
  makeTraceObserver,
  shouldSuppressRuffleLog,
  stripConsoleCssFormat,
} from "./ruffleLogFilter.js";
import { resolveRuffleBaseUrl, viteBaseUrl } from "./ruffleAssetUrl.js";

export interface RufflePlayerProps {
  /** SWF bytes to play; null = blank/idle screen */
  swfBytes: Uint8Array | null;
  width?: number;
  height?: number;
  onClose?: () => void;
  /**
   * Base URL where the Ruffle self-hosted assets live.
   * Must be a path/URL that the browser can fetch (not a bare package specifier).
   * When omitted, it is derived from the Vite deployment base
   * (`import.meta.env.BASE_URL`) so it resolves correctly both in local dev /
   * Tauri (base `/` → `/ruffle`) AND on GitHub Pages under a sub-path (base
   * `/dash/` → `/dash/ruffle`). A ROOT-ABSOLUTE default like `/ruffle` would
   * ignore the sub-path and 404 on Pages. ruffle.js and its sibling WASM/chunk
   * files are served from the app's `public/ruffle/` directory (copied to
   * `<base>/ruffle/` by Vite).
   */
  ruffleBaseUrl?: string;
  /**
   * Called when Ruffle fails to load or a SWF fails to play.
   * Use this to surface errors to the user.
   */
  onError?: (message: string) => void;
  /**
   * Called with each AS2 trace() line (via Ruffle's dedicated trace observer)
   * and with Ruffle ERROR/WARN diagnostics (scraped from the console).
   * Low-severity Ruffle internal logs (DEBUG/INFO) are filtered out.
   */
  onTrace?: (line: string) => void;
  /**
   * Extra Ruffle load options (quality, scale/letterbox, backdrop color, mute).
   * Merged into the base load config. Used by the Live Preview tab's live-dev
   * controls. Changing these re-loads the current SWF with the new config.
   */
  loadOptions?: PlayerLoadOptions;
  /**
   * Receives imperative playback controls once a player has loaded a SWF, so a
   * parent (e.g. the Live Preview panel) can wire Play/Pause/Restart buttons.
   * Called with `null` when no player is loaded.
   */
  onControls?: (controls: PlayerControls | null) => void;
}

/** Subset of Ruffle load options exposed to the embedder. */
export interface PlayerLoadOptions {
  quality?: string;
  scale?: string;
  letterbox?: string;
  backgroundColor?: string;
  muted?: boolean;
}

/** Imperative playback controls surfaced via {@link RufflePlayerProps.onControls}. */
export interface PlayerControls {
  play: () => void;
  pause: () => void;
  /** Reload the current SWF from frame 1. */
  restart: () => void;
  isPlaying: () => boolean;
}

/**
 * Embeds a Ruffle (WebAssembly) player and plays a SWF from raw bytes.
 *
 * Ruffle is loaded from the @ruffle-rs/ruffle package which registers
 * itself on window.RufflePlayer when its script is evaluated.
 */
export function RufflePlayer({
  swfBytes,
  width = 550,
  height = 400,
  ruffleBaseUrl,
  onError,
  onTrace,
  loadOptions,
  onControls,
}: RufflePlayerProps): React.ReactElement {
  // An explicit prop wins; otherwise derive the asset base from the Vite
  // deployment base so the URL respects the GitHub Pages sub-path (`/dash/`)
  // instead of a root-absolute `/ruffle` that 404s on Pages.
  const effectiveRuffleBaseUrl =
    ruffleBaseUrl ?? resolveRuffleBaseUrl(viteBaseUrl());

  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<RufflePlayerElement | null>(null);
  const ruffleLoadedRef = useRef(false);
  // Keep onError and onTrace in refs so createAndLoad does not change identity
  // when the parent re-renders with a new callback reference.
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  const onTraceRef = useRef(onTrace);
  useEffect(() => { onTraceRef.current = onTrace; }, [onTrace]);
  const onControlsRef = useRef(onControls);
  useEffect(() => { onControlsRef.current = onControls; }, [onControls]);
  // Keep loadOptions in a ref so createAndLoad reads the latest without being a
  // dep (a new object identity each render would otherwise reload Ruffle).
  const loadOptionsRef = useRef(loadOptions);
  loadOptionsRef.current = loadOptions;

  // Holds the original console methods so we can restore them on unmount.
  const origConsoleLogRef = useRef<(typeof console.log) | null>(null);
  const origConsoleWarnRef = useRef<(typeof console.warn) | null>(null);
  // A reload-the-current-SWF thunk, set on each successful load so Restart can
  // re-run it without re-referencing createAndLoad before it is defined.
  const reloadCurrentRef = useRef<(() => void) | null>(null);

  /** Ensure the Ruffle script is injected and return a promise that resolves
   *  when window.RufflePlayer is available. */
  const ensureRuffle = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (ruffleLoadedRef.current && window.RufflePlayer) {
        resolve();
        return;
      }

      // Check if already in the DOM (script already injected)
      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[data-ruffle]'
      );

      const onLoad = () => {
        ruffleLoadedRef.current = true;
        resolve();
      };

      if (existingScript) {
        // Script is already injected; if RufflePlayer is available we're done
        if (window.RufflePlayer) {
          ruffleLoadedRef.current = true;
          resolve();
        } else {
          existingScript.addEventListener("load", onLoad, { once: true });
        }
        return;
      }

      // Use the resolved base URL so we always get a real, fetchable URL that
      // respects the Vite deployment base (e.g. `/dash/ruffle/ruffle.js` on
      // GitHub Pages, `/ruffle/ruffle.js` in dev/Tauri). ruffle.js uses
      // document.currentScript.src to locate its sibling WASM and chunk files,
      // so they must live alongside ruffle.js at this base.
      const ruffleUrl = `${effectiveRuffleBaseUrl}/ruffle.js`;

      const script = document.createElement("script");
      script.src = ruffleUrl;
      script.dataset["ruffle"] = "1";
      script.addEventListener("load", onLoad, { once: true });
      script.addEventListener("error", () =>
        reject(new Error(`Failed to load Ruffle from ${ruffleUrl}`))
      );
      document.head.appendChild(script);
    });
  }, [effectiveRuffleBaseUrl]);

  /** Create (or recreate) the Ruffle player element inside the container.
   *
   * `isStale()` lets a superseded load bail out. React 18 StrictMode mounts a
   * component, runs effects, runs cleanups, then runs effects AGAIN — so the
   * swfBytes effect fires createAndLoad twice concurrently on the first mount.
   * Without this guard both runs append a <ruffle-player> and race the .load()
   * calls + console interceptor swap, leaving a blank/broken first preview
   * (the second Test Movie "works" only because re-triggering while already
   * open is a dep-change that fires the effect once). The guard also makes the
   * newest compile authoritative when loads overlap, so a stale SWF can't win. */
  const createAndLoad = useCallback(
    async (bytes: Uint8Array, isStale: () => boolean) => {
      // Record a Restart thunk that re-loads exactly these bytes from frame 1.
      reloadCurrentRef.current = () => {
        let restartStale = false;
        void createAndLoad(bytes, () => restartStale);
      };
      try {
        await ensureRuffle();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[RufflePlayer] Failed to load Ruffle script:", msg);
        onErrorRef.current?.(msg);
        return;
      }
      if (isStale()) return;

      const container = containerRef.current;
      if (!container) return;

      const ruffle = window.RufflePlayer?.newest();
      if (!ruffle) {
        const msg = "Ruffle loaded but window.RufflePlayer.newest() is unavailable";
        console.error("[RufflePlayer]", msg);
        onErrorRef.current?.(msg);
        return;
      }

      // Remove any existing player
      if (playerRef.current && container.contains(playerRef.current)) {
        container.removeChild(playerRef.current);
      }

      const player = ruffle.createPlayer();
      player.style.width = `${width}px`;
      player.style.height = `${height}px`;
      player.style.display = "block";
      container.appendChild(player);
      playerRef.current = player;

      // Capture AS2 trace() output via Ruffle's DEDICATED trace observer.
      //
      // This is the correct, reliable channel: Ruffle's `set_trace_observer`
      // (exposed on the <ruffle-player> element as the `traceObserver` setter)
      // fires ONCE per real AVM `trace()` call with the plain trace string. It
      // is NOT routed through the console diagnostics, so it is immune to the
      // log-level filtering that previously dropped every trace.
      //
      // IMPORTANT: the `traceObserver` setter forwards to the WASM player's
      // `set_trace_observer`, which only takes effect once `load()` has created
      // the underlying instance (`this.instance?.set_trace_observer(e)` in the
      // bundled build — a no-op before the instance exists). So the binding that
      // actually takes effect is the one set AFTER `load()` resolves (below); we
      // also set it here pre-load to be robust against future Ruffle versions
      // that may buffer the observer.
      //
      // (Historical note: trace() is emitted internally as a tracing `INFO`
      // event on the `avm_trace` target, which the WASMLayer renders to the
      // console as a styled "%cINFO%c ... avm_trace ... <msg>" line. The console
      // scrape below suppresses anything starting with "INFO"/"avm", so trace()
      // never reached the Output panel through the console route. The observer
      // bypasses that filter entirely — see ruffleLogFilter.ts.)
      const traceObserver = makeTraceObserver(() => onTraceRef.current);
      player.traceObserver = traceObserver;

      // Install console interceptors to capture Ruffle's own diagnostics.
      // Ruffle emits its diagnostic messages (WARN, ERROR, INFO, etc.) via
      // console.warn/console.log with CSS format tokens (%c). Only ERROR/WARN
      // severity is forwarded to the Output panel; low-severity logs
      // (DEBUG/INFO — which is also how avm_trace appears) are suppressed here,
      // because trace() now arrives via the dedicated observer above and must
      // NOT be double-delivered through the INFO console route.
      // Restore the originals on each new load (in case of reload).
      if (origConsoleLogRef.current) {
        console.log = origConsoleLogRef.current;
      }
      if (origConsoleWarnRef.current) {
        console.warn = origConsoleWarnRef.current;
      }
      origConsoleLogRef.current = console.log;
      origConsoleWarnRef.current = console.warn;
      const capturedOrigLog = console.log;
      const capturedOrigWarn = console.warn;

      /** Forward a console call to onTrace after stripping %c tokens. */
      const forwardToTrace = (args: unknown[]) => {
        if (!onTraceRef.current) return;
        const cleaned = stripConsoleCssFormat(args);
        if (shouldSuppressRuffleLog(args)) return;
        const line = cleaned.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
        onTraceRef.current(line);
      };

      console.log = (...args: unknown[]) => {
        capturedOrigLog(...args);
        forwardToTrace(args);
      };

      // Intercept console.warn to catch Ruffle's styled diagnostic messages.
      // ERROR/WARN severity messages are forwarded; DEBUG/INFO spam is suppressed.
      console.warn = (...args: unknown[]) => {
        capturedOrigWarn(...args);
        forwardToTrace(args);
      };

      // Load SWF from bytes via a Blob URL so we don't need a server
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/x-shockwave-flash" });
      const url = URL.createObjectURL(blob);
      const extra = loadOptionsRef.current ?? {};
      try {
        await (player.ruffle() as unknown as {
          load(opts: Record<string, unknown>): Promise<void>;
        }).load({
          url,
          logLevel: "info",
          // autoplay:'on' starts playback without a user-gesture audio context.
          // unmuteOverlay:'hidden' suppresses the "Click to unmute" overlay that
          // otherwise intercepts all mouse clicks on the canvas.
          autoplay: "on",
          unmuteOverlay: "hidden",
          // preloader:false skips Ruffle's loading-spinner/splash screen; the SWF
          // is already fully in memory (loaded from a Blob), so there is nothing
          // to wait for and the preloader just flashes.
          preloader: false,
          // Optional embedder controls (quality / scale / letterbox / bg / mute).
          ...(extra.quality ? { quality: extra.quality } : {}),
          ...(extra.scale ? { scale: extra.scale } : {}),
          ...(extra.letterbox ? { letterbox: extra.letterbox } : {}),
          ...(extra.backgroundColor ? { backgroundColor: extra.backgroundColor } : {}),
          ...(extra.muted ? { muted: true } : {}),
        });
        // Register the trace observer now that load() has created the WASM
        // instance — this is the binding that actually takes effect (the
        // pre-load assignment above is a no-op until the instance exists). The
        // first-frame DoAction runs on the tick after load() resolves, so this
        // is in time to capture frame-1 trace() calls.
        player.traceObserver = traceObserver;
        // A newer load started while this one was awaiting; remove this player
        // so the latest SWF is the only one left on screen.
        if (isStale() && container.contains(player)) {
          container.removeChild(player);
          if (playerRef.current === player) playerRef.current = null;
        } else {
          // Surface imperative playback controls for the live-dev panel. The
          // <ruffle-player> element exposes play()/pause()/isPlaying on the web
          // build; restart re-loads the same bytes from frame 1.
          onControlsRef.current?.({
            play: () => player.play?.(),
            pause: () => player.pause?.(),
            isPlaying: () => player.isPlaying ?? true,
            restart: () => {
              void reloadCurrentRef.current?.();
            },
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[RufflePlayer] SWF load failed:", msg);
        onErrorRef.current?.(msg);
      } finally {
        // Safe to revoke after load() resolves or rejects
        URL.revokeObjectURL(url);
      }
    },
    // onErrorRef is stable (a ref object), so removing onError from deps here
    // prevents Ruffle from reloading when the parent re-renders with a new
    // callback identity (e.g., due to keyboard shortcuts changing tool state).
    [ensureRuffle, width, height]
  );

  // Load / reload when swfBytes changes.
  // The cleanup marks this invocation stale so a superseded or
  // StrictMode-duplicated load bails out instead of appending a second player.
  useEffect(() => {
    if (!swfBytes) return;
    let stale = false;
    void createAndLoad(swfBytes, () => stale);
    return () => {
      stale = true;
    };
  }, [swfBytes, createAndLoad]);

  // Cleanup on unmount: remove player element and restore console.log interceptor.
  useEffect(() => {
    return () => {
      const container = containerRef.current;
      const player = playerRef.current;
      if (container && player && container.contains(player)) {
        container.removeChild(player);
      }
      playerRef.current = null;
      reloadCurrentRef.current = null;
      // Tell the embedder its controls are gone so it can't drive a dead player.
      onControlsRef.current?.(null);
      // Restore original console methods if we installed interceptors.
      if (origConsoleLogRef.current) {
        console.log = origConsoleLogRef.current;
        origConsoleLogRef.current = null;
      }
      if (origConsoleWarnRef.current) {
        console.warn = origConsoleWarnRef.current;
        origConsoleWarnRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      // Marker for the authoring app's global keyboard handlers: any keydown whose
      // target/activeElement is inside this subtree is being handled by the running
      // SWF (Ruffle has its own window-level keydown listener gated on player focus),
      // so authoring shortcuts/nudge/reload must NOT also fire. See
      // `isWithinRufflePlayer` in @flash/authoring-ui. Used by BOTH the Test Movie
      // modal and the Live Preview tab, which each embed this component.
      data-ruffle-host="true"
      style={{
        width,
        height,
        background: "#000",
        display: "block",
        overflow: "hidden",
      }}
    />
  );
}

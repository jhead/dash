import React, { useEffect, useRef, useCallback } from "react";
import type { RufflePlayerElement } from "./ruffle.d.ts";

export interface RufflePlayerProps {
  /** SWF bytes to play; null = blank/idle screen */
  swfBytes: Uint8Array | null;
  width?: number;
  height?: number;
  onClose?: () => void;
  /**
   * Base URL where the Ruffle self-hosted assets live.
   * Must be a path/URL that the browser can fetch (not a bare package specifier).
   * Defaults to "/ruffle" — assumes ruffle.js and its sibling WASM/chunk files
   * are served from the app's public/ruffle/ directory.
   */
  ruffleBaseUrl?: string;
  /**
   * Called when Ruffle fails to load or a SWF fails to play.
   * Use this to surface errors to the user.
   */
  onError?: (message: string) => void;
  /**
   * Called with each AS2 trace() line emitted by the running SWF.
   * Lines are filtered to exclude Ruffle-internal debug/warn/error logs;
   * only user trace() output is forwarded.
   */
  onTrace?: (line: string) => void;
}

/**
 * Ruffle log prefixes that are internal to the runtime and should NOT be
 * forwarded as user trace() output.  The prefixes are matched case-insensitively
 * against the first word(s) of each console.log argument.
 */
const RUFFLE_INTERNAL_PREFIXES = [
  "debug",
  "warn",
  "warning",
  "error",
  "[ruffle",
  "ruffle:",
  "info",
  "avm",  // e.g. "AVM1:"
];

function isRuffleInternalLog(args: unknown[]): boolean {
  if (args.length === 0) return false;
  const first = String(args[0]).trimStart().toLowerCase();
  return RUFFLE_INTERNAL_PREFIXES.some((prefix) => first.startsWith(prefix));
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
  ruffleBaseUrl = "/ruffle",
  onError,
  onTrace,
}: RufflePlayerProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<RufflePlayerElement | null>(null);
  const ruffleLoadedRef = useRef(false);
  // Keep onError and onTrace in refs so createAndLoad does not change identity
  // when the parent re-renders with a new callback reference.
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  const onTraceRef = useRef(onTrace);
  useEffect(() => { onTraceRef.current = onTrace; }, [onTrace]);

  // Holds the original console.log so we can restore it on unmount.
  const origConsoleLogRef = useRef<(typeof console.log) | null>(null);

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

      // Use the ruffleBaseUrl prop so we always get a real, fetchable URL.
      // ruffle.js uses document.currentScript.src to locate its sibling WASM
      // and chunk files, so they must live alongside ruffle.js at ruffleBaseUrl.
      const ruffleUrl = `${ruffleBaseUrl}/ruffle.js`;

      const script = document.createElement("script");
      script.src = ruffleUrl;
      script.dataset["ruffle"] = "1";
      script.addEventListener("load", onLoad, { once: true });
      script.addEventListener("error", () =>
        reject(new Error(`Failed to load Ruffle from ${ruffleUrl}`))
      );
      document.head.appendChild(script);
    });
  }, [ruffleBaseUrl]);

  /** Create (or recreate) the Ruffle player element inside the container. */
  const createAndLoad = useCallback(
    async (bytes: Uint8Array) => {
      try {
        await ensureRuffle();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[RufflePlayer] Failed to load Ruffle script:", msg);
        onErrorRef.current?.(msg);
        return;
      }

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

      // Install a console.log interceptor to capture AS2 trace() output.
      // Ruffle emits trace() via console.log when logLevel:'info' is set.
      // We capture lines that are NOT Ruffle-internal debug/warn/error output.
      // Restore the original on each new load (in case of reload).
      if (origConsoleLogRef.current) {
        console.log = origConsoleLogRef.current;
      }
      origConsoleLogRef.current = console.log;
      const capturedOrigLog = console.log;
      console.log = (...args: unknown[]) => {
        capturedOrigLog(...args);
        if (onTraceRef.current && !isRuffleInternalLog(args)) {
          const line = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
          onTraceRef.current(line);
        }
      };

      // Load SWF from bytes via a Blob URL so we don't need a server
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/x-shockwave-flash" });
      const url = URL.createObjectURL(blob);
      try {
        await (player.ruffle() as unknown as {
          load(opts: Record<string, unknown>): Promise<void>;
        }).load({ url, logLevel: "info" });
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

  // Load / reload when swfBytes changes
  useEffect(() => {
    if (!swfBytes) return;
    void createAndLoad(swfBytes);
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
      // Restore original console.log if we installed an interceptor.
      if (origConsoleLogRef.current) {
        console.log = origConsoleLogRef.current;
        origConsoleLogRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
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

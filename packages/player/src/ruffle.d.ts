/**
 * Minimal type declarations for the Ruffle selfhosted player API.
 * See: https://github.com/ruffle-rs/ruffle/wiki/Using-Ruffle#web
 */

export interface RufflePlayerElement extends HTMLElement {
  ruffle(): RufflePlayerInstance;
  /**
   * Settable callback that fires for every AVM1/AVM2 `trace()` call in the
   * running movie. This is Ruffle's dedicated, reliable trace channel — it
   * fires ONLY for real `avm_trace` output and is never polluted by Ruffle's
   * internal INFO/DEBUG diagnostics. The setter forwards to the WASM player's
   * `set_trace_observer`. See ruffle/web/src/lib.rs `set_trace_observer`.
   */
  traceObserver?: ((message: string) => void) | null;
}

export interface RufflePlayerInstance {
  load(
    options:
      | {
          url?: string;
          data?: Uint8Array;
          logLevel?: string;
          autoplay?: string;
          unmuteOverlay?: string;
        }
      | string
  ): Promise<void>;
}

export interface RuffleHandle {
  createPlayer(): RufflePlayerElement;
}

export interface RufflePlayerConfig {
  newest(): RuffleHandle;
}

declare global {
  interface Window {
    RufflePlayer?: {
      newest(): RuffleHandle;
      config?: Record<string, unknown>;
    };
  }
}

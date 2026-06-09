/**
 * Minimal type declarations for the Ruffle selfhosted player API.
 * See: https://github.com/ruffle-rs/ruffle/wiki/Using-Ruffle#web
 */

export interface RufflePlayerElement extends HTMLElement {
  ruffle(): RufflePlayerInstance;
}

export interface RufflePlayerInstance {
  load(options: { url?: string; data?: Uint8Array } | string): Promise<void>;
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

import React, { useEffect, useCallback } from "react";
import { RufflePlayer } from "./RufflePlayer";

export interface PlayerWindowProps {
  /** SWF bytes to play; null = nothing loaded */
  swfBytes: Uint8Array | null;
  stageWidth: number;
  stageHeight: number;
  isOpen: boolean;
  onClose: () => void;
  /**
   * Called when Ruffle fails to load or the SWF fails to play.
   * Show a user-visible error (toast, alert, etc.) in response.
   */
  onError?: (message: string) => void;
  /**
   * Base URL where ruffle.js and its sibling assets are served. When omitted,
   * RufflePlayer derives it from the Vite deployment base
   * (`import.meta.env.BASE_URL`) so it resolves under a GitHub Pages sub-path
   * (e.g. `/dash/ruffle`) as well as in local dev / Tauri (`/ruffle`).
   */
  ruffleBaseUrl?: string;
  /**
   * Called with each AS2 trace() line emitted by the running SWF.
   */
  onTrace?: (line: string) => void;
}

/**
 * Modal overlay window that plays a SWF via Ruffle.
 * - Dark chrome (#1a1a1a) with a "Flash Player 8" title bar.
 * - Press Escape or click outside the player window to close.
 */
export function PlayerWindow({
  swfBytes,
  stageWidth,
  stageHeight,
  isOpen,
  onClose,
  onError,
  ruffleBaseUrl,
  onTrace,
}: PlayerWindowProps): React.ReactElement | null {
  // Keyboard handler: Escape closes the window
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const TITLE_BAR_HEIGHT = 28;
  const windowWidth = stageWidth;
  const windowHeight = stageHeight + TITLE_BAR_HEIGHT;

  return (
    /* Full-screen dark overlay */
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onMouseDown={(e) => {
        // Close when clicking outside the player window
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Player window chrome */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: windowWidth,
          height: windowHeight,
          background: "#1a1a1a",
          border: "1px solid #444",
          boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
          borderRadius: 2,
          overflow: "hidden",
          userSelect: "none",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: TITLE_BAR_HEIGHT,
            background: "#2a2a2a",
            borderBottom: "1px solid #111",
            padding: "0 8px",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "#ccc",
              fontFamily: "system-ui, sans-serif",
              fontWeight: 600,
              letterSpacing: "0.03em",
            }}
          >
            Flash Player 8
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#aaa",
              fontSize: 14,
              cursor: "pointer",
              lineHeight: 1,
              padding: "2px 4px",
              borderRadius: 2,
            }}
            title="Close (Escape)"
          >
            ✕
          </button>
        </div>

        {/* Player area */}
        <RufflePlayer
          swfBytes={swfBytes}
          width={stageWidth}
          height={stageHeight}
          onError={onError}
          ruffleBaseUrl={ruffleBaseUrl}
          onTrace={onTrace}
        />
      </div>
    </div>
  );
}

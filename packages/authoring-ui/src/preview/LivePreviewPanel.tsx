// ---------------------------------------------------------------------------
// LivePreviewPanel — the Live Preview tab UI (task 1308).
//
// Hosts an embedded Ruffle player that hot-reloads the compiled SWF as the
// document changes (debounced, error-resilient — see useLivePreview /
// LivePreviewController), plus a live-dev control bar (status pill, auto-reload
// toggle, Reload/Restart, start scene/frame, play/pause, mute, quality, zoom/
// scale-to-fit, loop, background) and a non-blocking compile-error banner that
// keeps the last-good preview on screen.
// ---------------------------------------------------------------------------

import React, { useCallback, useMemo, useRef, useState } from "react";
import type { FlashDocument } from "@flash/core";
import { RufflePlayer, type PlayerControls } from "@flash/player";
import { useLivePreview } from "./useLivePreview.js";
import {
  type PreviewPrefs,
  type PreviewQuality,
  ruffleQuality,
} from "./previewPrefs.js";
import { sceneFrameCount } from "./startAt.js";
import type { LivePreviewStatus } from "./livePreviewController.js";

export interface LivePreviewPanelProps {
  /** Whether the tab is the active top tab (controls compile loop lifecycle). */
  active: boolean;
  doc: FlashDocument;
  subscribeDoc: (listener: () => void) => () => void;
  getDoc: () => FlashDocument;
  compileDocToBytes: (
    targetDoc: FlashDocument,
    opts?: { skipSystemFontPrompt?: boolean }
  ) => Promise<Uint8Array>;
  prefs: PreviewPrefs;
  onPrefsChange: (patch: Partial<PreviewPrefs>) => void;
  /** Stage size, used as the preview's intrinsic SWF size. */
  stageWidth: number;
  stageHeight: number;
  documentBackground: string;
}

const STATUS_META: Record<LivePreviewStatus, { label: string; color: string; bg: string }> = {
  idle: { label: "Idle", color: "#888", bg: "#2a2a2a" },
  compiling: { label: "Compiling…", color: "#1e1e1e", bg: "#e0b020" },
  "up-to-date": { label: "Up-to-date", color: "#fff", bg: "#2e7d32" },
  error: { label: "Error", color: "#fff", bg: "#c62828" },
};

export function LivePreviewPanel(props: LivePreviewPanelProps): React.ReactElement {
  const {
    active,
    doc,
    subscribeDoc,
    getDoc,
    compileDocToBytes,
    prefs,
    onPrefsChange,
    stageWidth,
    stageHeight,
    documentBackground,
  } = props;

  const startAt = useMemo(
    () => ({ sceneIndex: prefs.startScene, frame: prefs.startFrame }),
    [prefs.startScene, prefs.startFrame]
  );

  const { snapshot, reload } = useLivePreview({
    active,
    autoReload: prefs.autoReload,
    doc,
    subscribeDoc,
    getDoc,
    compileDocToBytes,
    startAt,
  });

  const controlsRef = useRef<PlayerControls | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const handleControls = useCallback((c: PlayerControls | null) => {
    controlsRef.current = c;
    if (c) setIsPlaying(c.isPlaying());
  }, []);

  const playPause = useCallback(() => {
    const c = controlsRef.current;
    if (!c) return;
    if (c.isPlaying()) {
      c.pause();
      setIsPlaying(false);
    } else {
      c.play();
      setIsPlaying(true);
    }
  }, []);

  const restart = useCallback(() => {
    controlsRef.current?.restart();
    setIsPlaying(true);
  }, []);

  // Available scenes for the start-from-scene selector.
  const scenes = doc.scenes;
  const maxFrameInStartScene = sceneFrameCount(doc, prefs.startScene);

  const status = STATUS_META[snapshot.status];

  // Preview backdrop behind the Ruffle canvas.
  const backdrop =
    prefs.background === "white"
      ? "#ffffff"
      : prefs.background === "black"
        ? "#000000"
        : prefs.background === "checker"
          ? "repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 50% / 16px 16px"
          : documentBackground || "#1e1e1e";

  const loadOptions = useMemo(
    () => ({
      quality: ruffleQuality(prefs.quality),
      // scaleToFit -> showAll (letterbox into the box); else noScale at zoom.
      scale: prefs.scaleToFit ? "showAll" : "noScale",
      letterbox: "on",
      muted: prefs.muted,
    }),
    [prefs.quality, prefs.scaleToFit, prefs.muted]
  );

  // Player render size. scaleToFit lets Ruffle fit the box; otherwise apply zoom.
  const playerWidth = prefs.scaleToFit ? stageWidth : Math.round(stageWidth * prefs.zoom);
  const playerHeight = prefs.scaleToFit ? stageHeight : Math.round(stageHeight * prefs.zoom);

  return (
    <div
      data-testid="live-preview-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: "#1e1e1e",
        color: "#ddd",
        fontSize: 11,
      }}
    >
      {/* Control bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          borderBottom: "1px solid #333",
          background: "#252525",
          flexShrink: 0,
        }}
      >
        <span
          data-testid="preview-status-pill"
          data-status={snapshot.status}
          title={snapshot.error ?? status.label}
          style={{
            padding: "2px 8px",
            borderRadius: 10,
            fontWeight: 600,
            color: status.color,
            background: status.bg,
            whiteSpace: "nowrap",
          }}
        >
          {status.label}
        </span>

        <label style={ctrlLabel} title="Recompile and reload on document changes">
          <input
            type="checkbox"
            data-testid="preview-autoreload"
            checked={prefs.autoReload}
            onChange={(e) => onPrefsChange({ autoReload: e.target.checked })}
          />
          Auto-reload
        </label>

        <button style={btn} data-testid="preview-reload" onClick={reload} title="Recompile now">
          ↻ Reload
        </button>
        <button style={btn} data-testid="preview-restart" onClick={restart} title="Restart from frame 1">
          ⤺ Restart
        </button>
        <button style={btn} data-testid="preview-playpause" onClick={playPause}>
          {isPlaying ? "❚❚ Pause" : "▶ Play"}
        </button>

        <span style={sep} />

        <label style={ctrlLabel} title="Begin playback at this scene">
          Scene
          <select
            data-testid="preview-start-scene"
            value={prefs.startScene}
            onChange={(e) => onPrefsChange({ startScene: Number(e.target.value), startFrame: 1 })}
            style={select}
          >
            {scenes.map((s, i) => (
              <option key={s.id} value={i}>
                {s.name || `Scene ${i + 1}`}
              </option>
            ))}
          </select>
        </label>

        <label style={ctrlLabel} title="Begin playback at this frame">
          Frame
          <input
            type="number"
            data-testid="preview-start-frame"
            min={1}
            max={Math.max(1, maxFrameInStartScene)}
            value={prefs.startFrame}
            onChange={(e) => onPrefsChange({ startFrame: Number(e.target.value) })}
            style={{ ...numInput, width: 52 }}
          />
        </label>

        <span style={sep} />

        <label style={ctrlLabel} title="Mute preview audio">
          <input
            type="checkbox"
            data-testid="preview-mute"
            checked={prefs.muted}
            onChange={(e) => onPrefsChange({ muted: e.target.checked })}
          />
          Mute
        </label>

        <label style={ctrlLabel} title="Loop at the last frame">
          <input
            type="checkbox"
            data-testid="preview-loop"
            checked={prefs.loop}
            onChange={(e) => onPrefsChange({ loop: e.target.checked })}
          />
          Loop
        </label>

        <label style={ctrlLabel}>
          Quality
          <select
            data-testid="preview-quality"
            value={prefs.quality}
            onChange={(e) => onPrefsChange({ quality: e.target.value as PreviewQuality })}
            style={select}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="best">Best</option>
          </select>
        </label>

        <label style={ctrlLabel}>
          Bg
          <select
            data-testid="preview-bg"
            value={prefs.background}
            onChange={(e) => onPrefsChange({ background: e.target.value as PreviewPrefs["background"] })}
            style={select}
          >
            <option value="default">Document</option>
            <option value="white">White</option>
            <option value="black">Black</option>
            <option value="checker">Checker</option>
          </select>
        </label>

        <span style={sep} />

        <label style={ctrlLabel} title="Scale the movie to fit the preview area">
          <input
            type="checkbox"
            data-testid="preview-scaletofit"
            checked={prefs.scaleToFit}
            onChange={(e) => onPrefsChange({ scaleToFit: e.target.checked })}
          />
          Fit
        </label>

        {!prefs.scaleToFit && (
          <label style={ctrlLabel} title="Preview zoom">
            Zoom
            <select
              data-testid="preview-zoom"
              value={prefs.zoom}
              onChange={(e) => onPrefsChange({ zoom: Number(e.target.value) })}
              style={select}
            >
              {[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map((z) => (
                <option key={z} value={z}>
                  {Math.round(z * 100)}%
                </option>
              ))}
            </select>
          </label>
        )}

        <div style={{ flex: 1 }} />

        <span style={{ color: "#888", whiteSpace: "nowrap" }} data-testid="preview-stats">
          {snapshot.swfSize > 0
            ? `${formatBytes(snapshot.swfSize)} · ${snapshot.compileMs}ms`
            : "—"}
        </span>
      </div>

      {/* Player viewport */}
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: backdrop,
        }}
      >
        {snapshot.swfBytes ? (
          <RufflePlayer
            swfBytes={snapshot.swfBytes}
            width={playerWidth}
            height={playerHeight}
            loadOptions={loadOptions}
            onControls={handleControls}
          />
        ) : (
          <div data-testid="preview-empty" style={{ color: "#888" }}>
            {snapshot.status === "compiling" ? "Compiling preview…" : "No preview yet"}
          </div>
        )}

        {/* Non-blocking compile-error banner (last-good preview stays visible). */}
        {snapshot.status === "error" && snapshot.error && (
          <div
            data-testid="preview-error-overlay"
            role="alert"
            style={{
              position: "absolute",
              left: 8,
              right: 8,
              bottom: 8,
              maxHeight: "50%",
              overflow: "auto",
              background: "rgba(180, 30, 30, 0.95)",
              color: "#fff",
              border: "1px solid #ff8a80",
              borderRadius: 4,
              padding: "8px 10px",
              fontFamily: "monospace",
              fontSize: 11,
              whiteSpace: "pre-wrap",
              boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
            }}
          >
            <strong>Compile error</strong> — showing last good preview
            {"\n"}
            {snapshot.error}
          </div>
        )}
      </div>
    </div>
  );
}

const ctrlLabel: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  whiteSpace: "nowrap",
};
const btn: React.CSSProperties = {
  padding: "2px 8px",
  background: "#3a3a3a",
  color: "#ddd",
  border: "1px solid #555",
  borderRadius: 3,
  cursor: "pointer",
  fontSize: 11,
  whiteSpace: "nowrap",
};
const select: React.CSSProperties = {
  background: "#1e1e1e",
  color: "#ddd",
  border: "1px solid #555",
  borderRadius: 3,
  fontSize: 11,
};
const numInput: React.CSSProperties = {
  background: "#1e1e1e",
  color: "#ddd",
  border: "1px solid #555",
  borderRadius: 3,
  fontSize: 11,
};
const sep: React.CSSProperties = {
  width: 1,
  alignSelf: "stretch",
  background: "#444",
  margin: "0 2px",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

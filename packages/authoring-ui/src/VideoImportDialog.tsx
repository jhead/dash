import React, { useCallback, useEffect, useRef, useState } from "react";
import type { VideoItem } from "@flash/core";
import { createVideo } from "@flash/core";
import type { PendingVideoImport } from "./store/uiStore.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Where the imported video should land. */
export type VideoEmbedTarget = "library" | "stage";

export interface VideoImportResult {
  /** The created VideoItem library entry. */
  item: VideoItem;
  /** Where to put it. "stage" also places a VideoDisplayObject on the timeline. */
  target: VideoEmbedTarget;
}

// ---------------------------------------------------------------------------
// Pure logic (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Build the `VideoItem` for a confirmed Import Video wizard. Sanitizes the
 * user-edited dimensions and frame rate (min 1, rounded) and pulls the frame
 * count from the probe (0 when the container could not be demuxed — the
 * compiler then synthesizes empty frames from `frameCount`, so a stub still
 * advances).
 */
export function buildVideoItem(opts: {
  pending: PendingVideoImport;
  name: string;
  width: number;
  height: number;
  frameRate: number;
}): VideoItem {
  const { pending, name, width, height, frameRate } = opts;
  const w = Math.max(1, Math.round(width) || 1);
  const h = Math.max(1, Math.round(height) || 1);
  const fr = Math.max(1, Math.round((frameRate || 12) * 100) / 100);
  return createVideo(name.trim() || "Video", {
    dataUri: pending.dataUri,
    frameCount: pending.probe?.frameCount ?? 0,
    frameRate: fr,
    width: w,
    height: h,
  });
}

export interface VideoImportDialogProps {
  /** The selected file + probe metadata, or null when the dialog is closed. */
  pending: PendingVideoImport | null;
  onConfirm: (result: VideoImportResult) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Styles (match ConvertToSymbolDialog / Flash 8 chrome)
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  dialog: {
    position: "fixed",
    background: "#3c3c3c",
    border: "1px solid #666",
    boxShadow: "4px 4px 12px rgba(0,0,0,0.6)",
    minWidth: "340px",
    zIndex: 1000,
    fontFamily: "Tahoma, Arial, sans-serif",
    fontSize: "11px",
    color: "#e0e0e0",
    userSelect: "none",
  },
  titleBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "#2a2a2a",
    borderBottom: "1px solid #555",
    padding: "4px 6px",
  },
  titleText: { fontSize: "11px", fontWeight: "bold", color: "#e0e0e0" },
  closeBtn: {
    background: "#666",
    border: "1px solid #888",
    color: "#e0e0e0",
    width: "14px",
    height: "14px",
    fontSize: "10px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    lineHeight: 1,
  },
  body: { padding: "10px 12px" },
  row: { display: "flex", alignItems: "center", marginBottom: "8px" },
  label: { width: "78px", flexShrink: 0, fontSize: "11px", color: "#ccc" },
  inputWide: {
    flex: 1,
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
  },
  inputNum: {
    width: "64px",
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
  },
  divider: { height: "1px", background: "#555", margin: "8px 0" },
  metaBox: {
    background: "#2a2a2a",
    border: "1px solid #555",
    padding: "6px 8px",
    marginBottom: "8px",
    fontSize: "11px",
    color: "#ccc",
    lineHeight: 1.5,
  },
  metaKey: { color: "#9aa", display: "inline-block", width: "84px" },
  metaVal: { color: "#e0e0e0" },
  warn: { color: "#e0b050", fontStyle: "italic" },
  radioGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
    marginLeft: "0",
    marginBottom: "4px",
  },
  radioRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    cursor: "pointer",
    fontSize: "11px",
    color: "#e0e0e0",
  },
  btnRow: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "6px",
    marginTop: "10px",
  },
  btn: {
    background: "#555",
    border: "1px solid #777",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "3px 14px",
    cursor: "pointer",
    minWidth: "58px",
  },
  btnPrimary: {
    background: "#1a6ea8",
    border: "1px solid #2288cc",
    color: "#fff",
    fontSize: "11px",
    padding: "3px 14px",
    cursor: "pointer",
    minWidth: "58px",
  },
};

// ---------------------------------------------------------------------------
// VideoImportDialog
// ---------------------------------------------------------------------------

/**
 * The Import Video wizard. Surfaces the probed codec / dimensions / frame count
 * of the selected video, lets the user adjust the library item name, native
 * dimensions, and frame rate, and choose the embed target (library only, or
 * library + place on stage). Confirming creates a `VideoItem` that flows into
 * the existing publish pipeline (`DefineVideoStream`/`VideoFrame`).
 *
 * Live FLV streaming, the cue-point editor, and the skin picker are out of
 * scope for this wizard (see docs/11-video.md).
 */
export function VideoImportDialog({
  pending,
  onConfirm,
  onClose,
}: VideoImportDialogProps): React.ReactElement | null {
  const [name, setName] = useState("");
  const [width, setWidth] = useState(320);
  const [height, setHeight] = useState(240);
  const [frameRate, setFrameRate] = useState(12);
  const [target, setTarget] = useState<VideoEmbedTarget>("library");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Seed form state from the probe each time a new file is selected.
  useEffect(() => {
    if (!pending) return;
    setName(pending.suggestedName || "Video");
    setWidth(pending.probe?.width ?? 320);
    setHeight(pending.probe?.height ?? 240);
    setFrameRate(pending.probe?.frameRate ?? 12);
    setTarget("library");
    setTimeout(() => {
      nameInputRef.current?.select();
      nameInputRef.current?.focus();
    }, 0);
  }, [pending]);

  const handleOk = useCallback(() => {
    if (!pending) return;
    if (!name.trim()) return;
    const item = buildVideoItem({ pending, name, width, height, frameRate });
    onConfirm({ item, target });
  }, [pending, name, width, height, frameRate, target, onConfirm]);

  // Keyboard: Enter = OK, Escape = Cancel.
  useEffect(() => {
    if (!pending) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleOk();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, handleOk, onClose]);

  if (!pending) return null;

  const probe = pending.probe;

  return (
    <div
      style={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={styles.dialog} onMouseDown={(e) => e.stopPropagation()}>
        <div style={styles.titleBar}>
          <span style={styles.titleText}>Import Video</span>
          <button style={styles.closeBtn} onClick={onClose} title="Close">
            ×
          </button>
        </div>

        <div style={styles.body}>
          {/* Probed metadata */}
          <div style={styles.metaBox} data-testid="video-import-meta">
            <div>
              <span style={styles.metaKey}>File:</span>
              <span style={styles.metaVal}>{pending.fileName}</span>
            </div>
            {probe ? (
              <>
                <div>
                  <span style={styles.metaKey}>Codec:</span>
                  <span style={styles.metaVal}>{probe.codecName}</span>
                </div>
                <div>
                  <span style={styles.metaKey}>Dimensions:</span>
                  <span style={styles.metaVal}>
                    {probe.width} × {probe.height}
                  </span>
                </div>
                <div>
                  <span style={styles.metaKey}>Frames:</span>
                  <span style={styles.metaVal}>{probe.frameCount}</span>
                </div>
                <div>
                  <span style={styles.metaKey}>Frame rate:</span>
                  <span style={styles.metaVal}>
                    {probe.frameRate != null
                      ? `${probe.frameRate} fps`
                      : "(not in metadata)"}
                  </span>
                </div>
              </>
            ) : (
              <div style={styles.warn}>
                Could not read video metadata (not an FLV, or undecodable).
                Embeds as a stub; set dimensions and frame count manually.
              </div>
            )}
          </div>

          {/* Name */}
          <div style={styles.row}>
            <span style={styles.label}>Name:</span>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={styles.inputWide}
              placeholder="Video"
              data-testid="video-import-name"
            />
          </div>

          {/* Dimensions */}
          <div style={styles.row}>
            <span style={styles.label}>Width:</span>
            <input
              type="number"
              min={1}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              style={styles.inputNum}
              data-testid="video-import-width"
            />
            <span style={{ width: "28px", textAlign: "center", color: "#ccc" }}>×</span>
            <span style={{ ...styles.label, width: "44px" }}>Height:</span>
            <input
              type="number"
              min={1}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              style={styles.inputNum}
              data-testid="video-import-height"
            />
          </div>

          {/* Frame rate */}
          <div style={styles.row}>
            <span style={styles.label}>Frame rate:</span>
            <input
              type="number"
              min={1}
              step={0.01}
              value={frameRate}
              onChange={(e) => setFrameRate(Number(e.target.value))}
              style={styles.inputNum}
              data-testid="video-import-fps"
            />
            <span style={{ marginLeft: "6px", color: "#ccc" }}>fps</span>
          </div>

          <div style={styles.divider} />

          {/* Embed target */}
          <div style={{ marginBottom: "6px", fontSize: "11px", color: "#ccc" }}>
            Embed video in SWF:
          </div>
          <div style={styles.radioGroup}>
            <label style={styles.radioRow}>
              <input
                type="radio"
                checked={target === "library"}
                onChange={() => setTarget("library")}
                style={{ margin: 0, cursor: "pointer" }}
                data-testid="video-import-target-library"
              />
              Embed to Library only
            </label>
            <label style={styles.radioRow}>
              <input
                type="radio"
                checked={target === "stage"}
                onChange={() => setTarget("stage")}
                style={{ margin: 0, cursor: "pointer" }}
                data-testid="video-import-target-stage"
              />
              Embed to Library and place on Stage
            </label>
          </div>

          <div style={styles.btnRow}>
            <button style={styles.btn} onClick={onClose}>
              Cancel
            </button>
            <button
              style={styles.btnPrimary}
              onClick={handleOk}
              data-testid="video-import-ok"
            >
              Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

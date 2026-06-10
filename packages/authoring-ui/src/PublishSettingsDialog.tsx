import React, { useCallback, useEffect, useState } from "react";
import { withProperties } from "@flash/core";
import type { FlashDocument } from "@flash/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Kept for backward compatibility with Shell.tsx publish-output state. */
export interface PublishSettings {
  filename: string;
  jpegQuality: number;
  audioStreamFormat: "mp3" | "adpcm";
  audioEventFormat: "mp3" | "adpcm";
  /** SWF output options */
  compress: boolean;
  protect: boolean;
  debuggingPermitted: boolean;
  debugPassword: string;
}

export interface PublishSettingsDialogProps {
  /** The current document (for reading and updating doc properties). */
  doc: FlashDocument;
  /** Called when the dialog should close (Cancel or after OK). */
  onClose: () => void;
  /** Called with the updated document when the user clicks OK. */
  pushDoc: (doc: FlashDocument) => void;
  // Legacy props kept so existing Shell.tsx wiring compiles without changes
  open?: boolean;
  settings?: PublishSettings;
  onSave?: (settings: PublishSettings) => void;
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

/** Checkbox row with a label on the right side (after the checkbox). */
const checkboxRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  marginBottom: "6px",
  gap: "6px",
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
  },
  dialog: {
    background: "#3c3c3c",
    border: "1px solid #666",
    boxShadow: "4px 4px 12px rgba(0,0,0,0.6)",
    minWidth: "360px",
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
    cursor: "default",
  },
  titleText: {
    fontSize: "11px",
    fontWeight: "bold",
    color: "#e0e0e0",
  },
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
  body: {
    padding: "10px 12px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    marginBottom: "8px",
  },
  label: {
    width: "120px",
    flexShrink: 0,
    fontSize: "11px",
    color: "#ccc",
  },
  input: {
    flex: 1,
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
  },
  readOnlyValue: {
    flex: 1,
    fontSize: "11px",
    color: "#aaa",
    padding: "2px 4px",
  },
  divider: {
    height: "1px",
    background: "#555",
    margin: "8px 0",
  },
  sectionTitle: {
    fontSize: "10px",
    color: "#999",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: "6px",
    marginTop: "4px",
  },
  btnRow: {
    display: "flex",
    flexDirection: "row",
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
// PublishSettingsDialog
// ---------------------------------------------------------------------------

export function PublishSettingsDialog({
  doc,
  onClose,
  pushDoc,
  open,
  settings,
  onSave,
}: PublishSettingsDialogProps): React.ReactElement | null {
  // When used in legacy mode (open prop), respect the open flag
  const isOpen = open !== undefined ? open : true;

  const props = doc.properties;

  const [width, setWidth] = useState(props.width);
  const [height, setHeight] = useState(props.height);
  const [backgroundColor, setBackgroundColor] = useState(props.backgroundColor);
  const [frameRate, setFrameRate] = useState(props.frameRate);

  // SWF output options — seeded from the settings prop when available
  const [compress, setCompress] = useState(settings?.compress ?? false);
  const [protect, setProtect] = useState(settings?.protect ?? false);
  const [debuggingPermitted, setDebuggingPermitted] = useState(settings?.debuggingPermitted ?? false);
  const [debugPassword, setDebugPassword] = useState(settings?.debugPassword ?? "");
  const [jpegQuality, setJpegQuality] = useState(settings?.jpegQuality ?? 80);

  // Sync local state when dialog re-opens
  useEffect(() => {
    if (isOpen) {
      setWidth(doc.properties.width);
      setHeight(doc.properties.height);
      setBackgroundColor(doc.properties.backgroundColor);
      setFrameRate(doc.properties.frameRate);
      setCompress(settings?.compress ?? false);
      setProtect(settings?.protect ?? false);
      setDebuggingPermitted(settings?.debuggingPermitted ?? false);
      setDebugPassword(settings?.debugPassword ?? "");
      setJpegQuality(settings?.jpegQuality ?? 80);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, doc.properties]);

  const handleOk = useCallback(() => {
    const updatedDoc = withProperties(doc, {
      width: Math.max(1, Math.round(Number(width) || props.width)),
      height: Math.max(1, Math.round(Number(height) || props.height)),
      backgroundColor: backgroundColor || props.backgroundColor,
      frameRate: Math.max(0.01, Number(frameRate) || props.frameRate),
    });
    pushDoc(updatedDoc);
    // Persist SWF output options back to Shell via onSave
    if (onSave) {
      onSave({
        filename: settings?.filename ?? "movie.swf",
        audioStreamFormat: settings?.audioStreamFormat ?? "mp3",
        audioEventFormat: settings?.audioEventFormat ?? "mp3",
        jpegQuality,
        compress,
        protect,
        debuggingPermitted,
        debugPassword,
      });
    }
    onClose();
  }, [doc, width, height, backgroundColor, frameRate, props, pushDoc, onClose, onSave, settings, compress, protect, debuggingPermitted, debugPassword, jpegQuality]);

  // Keyboard: Enter = OK, Escape = Cancel
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== "TEXTAREA") {
          e.preventDefault();
          handleOk();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, handleOk, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={styles.dialog} onMouseDown={(e) => e.stopPropagation()}>
        {/* Title bar */}
        <div style={styles.titleBar}>
          <span style={styles.titleText}>Publish Settings</span>
          <button style={styles.closeBtn} onClick={onClose} title="Close">
            ×
          </button>
        </div>

        {/* Body */}
        <div style={styles.body}>
          {/* Version info (read-only) */}
          <div style={styles.sectionTitle}>Target Version</div>
          <div style={styles.row}>
            <span style={styles.label}>SWF Version:</span>
            <span style={styles.readOnlyValue}>SWF v8 (Flash Player 8)</span>
          </div>

          <div style={styles.divider} />

          {/* Document dimensions */}
          <div style={styles.sectionTitle}>Document Properties</div>

          <div style={styles.row}>
            <span style={styles.label}>Width (px):</span>
            <input
              type="number"
              min={1}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              style={styles.input}
              autoFocus
            />
          </div>

          <div style={styles.row}>
            <span style={styles.label}>Height (px):</span>
            <input
              type="number"
              min={1}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              style={styles.input}
            />
          </div>

          <div style={styles.row}>
            <span style={styles.label}>Background Color:</span>
            <div style={{ display: "flex", alignItems: "center", flex: 1, gap: 4 }}>
              <input
                type="color"
                value={backgroundColor}
                onChange={(e) => setBackgroundColor(e.target.value)}
                style={{ width: 32, height: 22, padding: 0, border: "1px solid #555", cursor: "pointer", background: "none" }}
              />
              <input
                type="text"
                value={backgroundColor}
                onChange={(e) => setBackgroundColor(e.target.value)}
                style={{ ...styles.input, flex: 1 }}
                spellCheck={false}
                maxLength={7}
              />
            </div>
          </div>

          <div style={styles.row}>
            <span style={styles.label}>Frame Rate (fps):</span>
            <input
              type="number"
              min={0.01}
              max={120}
              step={1}
              value={frameRate}
              onChange={(e) => setFrameRate(Number(e.target.value))}
              style={styles.input}
            />
          </div>

          <div style={styles.divider} />

          {/* SWF Output Options */}
          <div style={styles.sectionTitle}>Flash (.swf) Output</div>

          <div style={styles.row}>
            <span style={styles.label}>JPEG quality:</span>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="range"
                min={1}
                max={100}
                value={jpegQuality}
                onChange={(e) => setJpegQuality(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: "11px", color: "#ccc", minWidth: "28px", textAlign: "right" }}>
                {jpegQuality}
              </span>
            </div>
          </div>

          <div style={checkboxRowStyle}>
            <input
              id="ps-compress"
              type="checkbox"
              checked={compress}
              onChange={(e) => setCompress(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <label htmlFor="ps-compress" style={{ fontSize: "11px", color: "#ccc", cursor: "pointer" }}>
              Compress movie
            </label>
          </div>

          <div style={checkboxRowStyle}>
            <input
              id="ps-protect"
              type="checkbox"
              checked={protect}
              onChange={(e) => setProtect(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <label htmlFor="ps-protect" style={{ fontSize: "11px", color: "#ccc", cursor: "pointer" }}>
              Protect from import
            </label>
          </div>

          <div style={checkboxRowStyle}>
            <input
              id="ps-debugging"
              type="checkbox"
              checked={debuggingPermitted}
              onChange={(e) => setDebuggingPermitted(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <label htmlFor="ps-debugging" style={{ fontSize: "11px", color: "#ccc", cursor: "pointer" }}>
              Debugging permitted
            </label>
          </div>

          {debuggingPermitted && (
            <div style={styles.row}>
              <span style={styles.label}>Password:</span>
              <input
                type="password"
                value={debugPassword}
                onChange={(e) => setDebugPassword(e.target.value)}
                style={styles.input}
                placeholder="(optional)"
                autoComplete="off"
              />
            </div>
          )}

          {/* Buttons */}
          <div style={styles.btnRow}>
            <button style={styles.btn} onClick={onClose}>
              Cancel
            </button>
            <button style={styles.btnPrimary} onClick={handleOk}>
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExportFormat = "png-sequence" | "animated-gif";

export interface ExportGifOptions {
  format: ExportFormat;
  /** Frame delay in milliseconds (GIF only). Default: Math.round(1000 / frameRate) */
  frameDelay: number;
  /** Loop count: 0 = loop forever, n = loop n times (GIF only) */
  loopCount: number;
  /** Loop forever toggle (GIF only) */
  loopForever: boolean;
  /** Maximum number of colors in the palette (GIF only): 64 | 128 | 256 */
  maxColors: 64 | 128 | 256;
}

export interface ExportGifDialogProps {
  open: boolean;
  /** Document frame rate (fps) — used to calculate default delay */
  frameRate: number;
  onConfirm: (options: ExportGifOptions) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute the default per-frame delay in ms from the doc's frame rate. */
export function defaultFrameDelay(frameRate: number): number {
  return Math.round(1000 / Math.max(1, frameRate));
}

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
    zIndex: 1000,
  },
  dialog: {
    position: "fixed",
    background: "#3c3c3c",
    border: "1px solid #666",
    boxShadow: "4px 4px 12px rgba(0,0,0,0.6)",
    minWidth: "320px",
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
    padding: "12px 14px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    marginBottom: "8px",
    gap: "8px",
  },
  label: {
    width: "80px",
    flexShrink: 0,
    fontSize: "11px",
    color: "#ccc",
  },
  radioGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
    marginLeft: "88px",
    marginBottom: "10px",
  },
  radioRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    cursor: "pointer",
    fontSize: "11px",
    color: "#e0e0e0",
  },
  divider: {
    height: "1px",
    background: "#555",
    margin: "10px 0",
  },
  sectionHeader: {
    fontSize: "11px",
    color: "#aaa",
    marginBottom: "8px",
    fontStyle: "italic",
  },
  input: {
    width: "60px",
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
  },
  select: {
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
    cursor: "pointer",
  },
  btnRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: "6px",
    marginTop: "12px",
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
  disabledLabel: {
    color: "#666",
  },
};

// ---------------------------------------------------------------------------
// ExportGifDialog
// ---------------------------------------------------------------------------

export function ExportGifDialog({
  open,
  frameRate,
  onConfirm,
  onClose,
}: ExportGifDialogProps): React.ReactElement | null {
  const [format, setFormat] = useState<ExportFormat>("animated-gif");
  const [frameDelay, setFrameDelay] = useState<number>(() =>
    defaultFrameDelay(frameRate)
  );
  const [loopForever, setLoopForever] = useState(true);
  const [loopCount, setLoopCount] = useState(1);
  const [maxColors, setMaxColors] = useState<64 | 128 | 256>(256);

  // Reset state each time the dialog opens
  useEffect(() => {
    if (open) {
      setFormat("animated-gif");
      setFrameDelay(defaultFrameDelay(frameRate));
      setLoopForever(true);
      setLoopCount(1);
      setMaxColors(256);
    }
  }, [open, frameRate]);

  // Keyboard: Enter = OK, Escape = Cancel
  useEffect(() => {
    if (!open) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, format, frameDelay, loopForever, loopCount, maxColors]);

  const handleOk = useCallback(() => {
    onConfirm({
      format,
      frameDelay: Math.max(1, frameDelay),
      loopForever,
      loopCount: Math.max(1, loopCount),
      maxColors,
    });
  }, [format, frameDelay, loopForever, loopCount, maxColors, onConfirm]);

  if (!open) return null;

  const gifDisabled = format !== "animated-gif";

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
          <span style={styles.titleText}>Export Movie</span>
          <button style={styles.closeBtn} onClick={onClose} title="Close">
            x
          </button>
        </div>

        {/* Body */}
        <div style={styles.body}>
          {/* Format */}
          <div style={{ marginBottom: "6px", fontSize: "11px", color: "#ccc" }}>
            Format:
          </div>
          <div style={styles.radioGroup}>
            <label style={styles.radioRow}>
              <input
                type="radio"
                checked={format === "png-sequence"}
                onChange={() => setFormat("png-sequence")}
                style={{ margin: 0, cursor: "pointer" }}
              />
              PNG Sequence
            </label>
            <label style={styles.radioRow}>
              <input
                type="radio"
                checked={format === "animated-gif"}
                onChange={() => setFormat("animated-gif")}
                style={{ margin: 0, cursor: "pointer" }}
              />
              Animated GIF
            </label>
          </div>

          <div style={styles.divider} />

          {/* GIF options */}
          <div
            style={{
              ...styles.sectionHeader,
              ...(gifDisabled ? styles.disabledLabel : {}),
            }}
          >
            GIF options:
          </div>

          {/* Frame delay */}
          <div style={styles.row}>
            <span
              style={{
                ...styles.label,
                ...(gifDisabled ? styles.disabledLabel : {}),
              }}
            >
              Frame delay:
            </span>
            <input
              type="number"
              min={1}
              max={60000}
              value={frameDelay}
              disabled={gifDisabled}
              onChange={(e) =>
                setFrameDelay(Math.max(1, parseInt(e.target.value, 10) || 1))
              }
              style={styles.input}
            />
            <span
              style={{
                fontSize: "11px",
                color: gifDisabled ? "#666" : "#aaa",
              }}
            >
              ms
            </span>
          </div>

          {/* Loop */}
          <div style={styles.row}>
            <span
              style={{
                ...styles.label,
                ...(gifDisabled ? styles.disabledLabel : {}),
              }}
            >
              Loop:
            </span>
            <label
              style={{
                ...styles.radioRow,
                ...(gifDisabled ? styles.disabledLabel : {}),
              }}
            >
              <input
                type="checkbox"
                checked={loopForever}
                disabled={gifDisabled}
                onChange={(e) => setLoopForever(e.target.checked)}
                style={{ margin: 0, cursor: gifDisabled ? "default" : "pointer" }}
              />
              Loop forever
            </label>
          </div>

          {/* Loop count (only when not looping forever) */}
          {!loopForever && (
            <div style={styles.row}>
              <span
                style={{
                  ...styles.label,
                  ...(gifDisabled ? styles.disabledLabel : {}),
                }}
              >
                Loop count:
              </span>
              <input
                type="number"
                min={1}
                max={65535}
                value={loopCount}
                disabled={gifDisabled}
                onChange={(e) =>
                  setLoopCount(Math.max(1, parseInt(e.target.value, 10) || 1))
                }
                style={styles.input}
              />
            </div>
          )}

          {/* Max colors */}
          <div style={styles.row}>
            <span
              style={{
                ...styles.label,
                ...(gifDisabled ? styles.disabledLabel : {}),
              }}
            >
              Max colors:
            </span>
            <select
              value={maxColors}
              disabled={gifDisabled}
              onChange={(e) =>
                setMaxColors(parseInt(e.target.value, 10) as 64 | 128 | 256)
              }
              style={styles.select}
            >
              <option value={64}>64</option>
              <option value={128}>128</option>
              <option value={256}>256</option>
            </select>
          </div>

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

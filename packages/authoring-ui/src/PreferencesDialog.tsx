import React, { useEffect, useState } from "react";
import {
  type Preferences,
  UI_SCALE_MIN,
  UI_SCALE_MAX,
  DEFAULT_PREFERENCES,
} from "./preferences";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreferencesDialogProps {
  isOpen: boolean;
  preferences: Preferences;
  /** Applied live (and persisted) as the user adjusts controls. */
  onChange: (patch: Partial<Preferences>) => void;
  onReset: () => void;
  onClose: () => void;
}

/** Preference categories shown in the left sidebar. Extend as more are added. */
const CATEGORIES = ["General"] as const;
type Category = (typeof CATEGORIES)[number];

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
    background: "#3c3c3c",
    border: "1px solid #666",
    boxShadow: "4px 4px 12px rgba(0,0,0,0.6)",
    width: "460px",
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
  bodyRow: { display: "flex", flexDirection: "row", minHeight: "180px" },
  sidebar: {
    width: "120px",
    flexShrink: 0,
    background: "#333",
    borderRight: "1px solid #555",
    padding: "4px 0",
  },
  category: {
    padding: "4px 10px",
    cursor: "pointer",
    fontSize: "11px",
  },
  pane: { flex: 1, padding: "12px 14px" },
  sectionLabel: {
    fontSize: "11px",
    fontWeight: "bold",
    color: "#cfcfcf",
    marginBottom: "10px",
  },
  row: { display: "flex", alignItems: "center", marginBottom: "10px", gap: "8px" },
  label: { width: "80px", flexShrink: 0, color: "#ccc" },
  slider: { flex: 1 },
  numInput: {
    width: "52px",
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
  },
  hint: { color: "#999", fontSize: "10px", lineHeight: 1.5, marginTop: "4px" },
  presetRow: { display: "flex", gap: "6px", marginTop: "2px", marginLeft: "88px" },
  presetBtn: {
    background: "#4a4a4a",
    border: "1px solid #666",
    color: "#ddd",
    fontSize: "10px",
    padding: "2px 8px",
    cursor: "pointer",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    gap: "6px",
    padding: "8px 12px",
    borderTop: "1px solid #555",
    background: "#363636",
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

const PRESETS = [0.5, 0.75, 1] as const;

// ---------------------------------------------------------------------------
// PreferencesDialog
// ---------------------------------------------------------------------------

export function PreferencesDialog({
  isOpen,
  preferences,
  onChange,
  onReset,
  onClose,
}: PreferencesDialogProps): React.ReactElement | null {
  const [category, setCategory] = useState<Category>("General");

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const scalePct = Math.round(preferences.uiScale * 100);

  return (
    <div
      style={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={styles.dialog} onMouseDown={(e) => e.stopPropagation()}>
        <div style={styles.titleBar}>
          <span style={styles.titleText}>Preferences</span>
          <button style={styles.closeBtn} onClick={onClose} title="Close">
            x
          </button>
        </div>

        <div style={styles.bodyRow}>
          {/* Category sidebar */}
          <div style={styles.sidebar}>
            {CATEGORIES.map((c) => (
              <div
                key={c}
                style={{
                  ...styles.category,
                  background: c === category ? "#1a6ea8" : "transparent",
                  color: c === category ? "#fff" : "#ddd",
                }}
                onClick={() => setCategory(c)}
              >
                {c}
              </div>
            ))}
          </div>

          {/* Active pane */}
          <div style={styles.pane}>
            {category === "General" && (
              <>
                <div style={styles.sectionLabel}>Interface</div>
                <div style={styles.row}>
                  <span style={styles.label}>UI Scale:</span>
                  <input
                    style={styles.slider}
                    type="range"
                    min={UI_SCALE_MIN}
                    max={UI_SCALE_MAX}
                    step={0.05}
                    value={preferences.uiScale}
                    onChange={(e) => onChange({ uiScale: parseFloat(e.target.value) })}
                    title="UI scale factor"
                  />
                  <input
                    style={styles.numInput}
                    type="number"
                    min={Math.round(UI_SCALE_MIN * 100)}
                    max={Math.round(UI_SCALE_MAX * 100)}
                    step={5}
                    value={scalePct}
                    onChange={(e) => {
                      const pct = parseFloat(e.target.value);
                      if (Number.isFinite(pct)) onChange({ uiScale: pct / 100 });
                    }}
                    title="UI scale (%)"
                  />
                  <span style={{ color: "#aaa" }}>%</span>
                </div>
                <div style={styles.presetRow}>
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      style={styles.presetBtn}
                      onClick={() => onChange({ uiScale: p })}
                    >
                      {Math.round(p * 100)}%
                    </button>
                  ))}
                </div>
                <div style={styles.hint}>
                  Scales the Timeline panel (frame cells, rows, keyframe dots).
                  The Stage has its own zoom control and is unaffected.
                </div>
              </>
            )}
          </div>
        </div>

        <div style={styles.footer}>
          <button
            style={styles.btn}
            onClick={onReset}
            title={`Reset to defaults (UI Scale ${Math.round(
              DEFAULT_PREFERENCES.uiScale * 100
            )}%)`}
          >
            Reset Defaults
          </button>
          <button style={styles.btnPrimary} onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

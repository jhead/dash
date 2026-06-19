/**
 * InstancePanel — Flash 8-style Properties panel for a selected SymbolInstance.
 *
 * Shows instance name, color effect, and (for graphic symbols) loop mode.
 */

import React, { useState, useEffect, useCallback } from "react";
import type { ColorEffect, SymbolInstance } from "@flash/core";
import { chrome, halo, chromeFont, inputStyle } from "./theme/flash8Theme.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface InstancePanelProps {
  instance: SymbolInstance;
  symbolType: "movieclip" | "button" | "graphic";
  onChange: (updates: Partial<SymbolInstance>) => void;
}

// ---------------------------------------------------------------------------
// Styles (matching PropertiesPanel style conventions)
// ---------------------------------------------------------------------------

// Flash 8 "Halo" light theme — tokens from theme/flash8Theme.ts (no hardcoded hex).
// Instance properties: #ECECEC chrome, near-black Tahoma text, halo (white)
// inputs/selects, #999999 separators. See docs/30-flash8-ui-spec.md + Shell.tsx.
const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: "flex",
    flexDirection: "column",
    // Fill the Properties pane width like the sibling Transform/Align panels
    // (which set no fixed width). A hardcoded 200px capped the Instance content
    // short of the pane edge when the pane was wider (task 1292). width:100% +
    // border-box stretches to the PanelGroup content wrapper without overflow.
    width: "100%",
    boxSizing: "border-box",
    background: chrome.panelBg,
    overflowY: "auto",
    borderTop: `${chrome.borderThin}px solid ${chrome.separator}`,
    ...chromeFont(),
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    height: "22px",
    background: `linear-gradient(${halo.panelHeaderGrad[0]}, ${halo.panelHeaderGrad[1]})`,
    borderBottom: `1px solid ${halo.headerDivider}`,
    padding: "0 6px",
    flexShrink: 0,
    userSelect: "none",
  },
  sectionLabel: {
    fontSize: "11px",
    color: chrome.textDefault,
    fontWeight: "bold",
  },
  sectionBody: {
    padding: "6px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    borderBottom: `1px solid ${chrome.separator}`,
  },
  row: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "4px",
  },
  label: {
    fontSize: "11px",
    color: chrome.textDefault,
    width: "60px",
    flexShrink: 0,
  },
  labelWide: {
    fontSize: "11px",
    color: chrome.textDefault,
    width: "80px",
    flexShrink: 0,
  },
  input: {
    ...inputStyle(),
    fontSize: "11px",
    flex: 1,
  },
  inputSmall: {
    ...inputStyle(),
    fontSize: "11px",
    width: "52px",
  },
  select: {
    ...inputStyle(),
    fontSize: "11px",
    padding: "1px 2px",
    flex: 1,
  },
  colorSwatch: {
    width: "22px",
    height: "16px",
    border: `1px solid ${halo.borderColor}`,
    cursor: "pointer",
    flexShrink: 0,
  },
  colorInput: {
    ...inputStyle(),
    fontSize: "11px",
    flex: 1,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Numeric input that commits on blur or Enter, reverts on Escape. */
function NumInput({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = useCallback(() => {
    const n = parseFloat(draft);
    if (!isNaN(n)) {
      const clamped = min !== undefined || max !== undefined
        ? clamp(n, min ?? -Infinity, max ?? Infinity)
        : n;
      onChange(clamped);
    } else {
      setDraft(String(value));
    }
  }, [draft, value, min, max, onChange]);

  return (
    <input
      type="number"
      style={styles.inputSmall}
      value={draft}
      step={step}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); setDraft(String(value)); }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Blend mode constants
// ---------------------------------------------------------------------------

/** Flash 8's 14 blend modes: internal key → display label */
const BLEND_MODES: Array<{ value: SymbolInstance["blendMode"] & string; label: string }> = [
  { value: "normal",     label: "Normal" },
  { value: "layer",      label: "Layer" },
  { value: "darken",     label: "Darken" },
  { value: "multiply",   label: "Multiply" },
  { value: "lighten",    label: "Lighten" },
  { value: "screen",     label: "Screen" },
  { value: "overlay",    label: "Overlay" },
  { value: "hardlight",  label: "Hard Light" },
  { value: "add",        label: "Add" },
  { value: "subtract",   label: "Subtract" },
  { value: "difference", label: "Difference" },
  { value: "invert",     label: "Invert" },
  { value: "alpha",      label: "Alpha" },
  { value: "erase",      label: "Erase" },
];

// ---------------------------------------------------------------------------
// InstancePanel
// ---------------------------------------------------------------------------

export function InstancePanel({ instance, symbolType, onChange }: InstancePanelProps): React.ReactElement {
  const effect: ColorEffect = instance.colorEffect ?? { type: "none" };

  // --- Instance name ---
  const [nameDraft, setNameDraft] = useState(instance.instanceName ?? "");
  useEffect(() => {
    setNameDraft(instance.instanceName ?? "");
  }, [instance.instanceName, instance.id]);

  const commitName = useCallback(() => {
    onChange({ instanceName: nameDraft });
  }, [nameDraft, onChange]);

  // --- Color effect type ---
  const handleEffectTypeChange = useCallback((type: ColorEffect["type"]) => {
    const base: ColorEffect = { type };
    if (type === "brightness") {
      onChange({ colorEffect: { ...base, brightness: 0 } });
    } else if (type === "tint") {
      onChange({ colorEffect: { ...base, tintColor: "#ff0000", tintAmount: 100 } });
    } else if (type === "alpha") {
      onChange({ colorEffect: { ...base, alpha: 100 } });
    } else if (type === "advanced") {
      onChange({
        colorEffect: {
          ...base,
          redMult: 100, greenMult: 100, blueMult: 100,
          redOffset: 0, greenOffset: 0, blueOffset: 0,
        },
      });
    } else {
      onChange({ colorEffect: { type: "none" } });
    }
  }, [onChange]);

  // --- Loop mode (graphic symbols only) ---
  const loopMode = instance.loopMode ?? "loop";
  // firstFrame is stored 0-based in the model; display as 1-based
  const firstFrameDisplay = (instance.firstFrame ?? 0) + 1;

  return (
    <div style={styles.panel}>
      {/* Instance Name */}
      <div style={styles.sectionHeader}>
        <span style={styles.sectionLabel}>Instance</span>
      </div>
      <div style={styles.sectionBody}>
        <div style={styles.row}>
          <span style={styles.label}>Name:</span>
          <input
            style={styles.input}
            value={nameDraft}
            placeholder="instance name"
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitName(); }
              if (e.key === "Escape") { e.preventDefault(); setNameDraft(instance.instanceName ?? ""); }
            }}
          />
        </div>
      </div>

      {/* Color Effect */}
      <div style={styles.sectionHeader}>
        <span style={styles.sectionLabel}>Color Effect</span>
      </div>
      <div style={styles.sectionBody}>
        <div style={styles.row}>
          <span style={styles.label}>Style:</span>
          <select
            style={styles.select}
            value={effect.type}
            onChange={(e) => handleEffectTypeChange(e.target.value as ColorEffect["type"])}
          >
            <option value="none">None</option>
            <option value="brightness">Brightness</option>
            <option value="tint">Tint</option>
            <option value="alpha">Alpha</option>
            <option value="advanced">Advanced</option>
          </select>
        </div>

        {/* Brightness */}
        {effect.type === "brightness" && (
          <div style={styles.row}>
            <span style={styles.label}>Bright:</span>
            <NumInput
              value={effect.brightness ?? 0}
              min={-100}
              max={100}
              onChange={(v) => onChange({ colorEffect: { ...effect, brightness: v } })}
            />
            <span style={{ fontSize: "11px", color: chrome.textDefault }}>%</span>
          </div>
        )}

        {/* Tint */}
        {effect.type === "tint" && (
          <>
            <div style={styles.row}>
              <span style={styles.label}>Color:</span>
              <input
                type="color"
                style={{ ...styles.colorSwatch, padding: 0 }}
                value={effect.tintColor ?? "#ff0000"}
                onChange={(e) => onChange({ colorEffect: { ...effect, tintColor: e.target.value } })}
              />
              <input
                style={styles.colorInput}
                value={effect.tintColor ?? "#ff0000"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^#[0-9a-fA-F]{0,6}$/.test(v)) {
                    onChange({ colorEffect: { ...effect, tintColor: v } });
                  }
                }}
              />
            </div>
            <div style={styles.row}>
              <span style={styles.label}>Amount:</span>
              <NumInput
                value={effect.tintAmount ?? 100}
                min={0}
                max={100}
                onChange={(v) => onChange({ colorEffect: { ...effect, tintAmount: v } })}
              />
              <span style={{ fontSize: "11px", color: chrome.textDefault }}>%</span>
            </div>
          </>
        )}

        {/* Alpha */}
        {effect.type === "alpha" && (
          <div style={styles.row}>
            <span style={styles.label}>Alpha:</span>
            <NumInput
              value={effect.alpha ?? 100}
              min={0}
              max={100}
              onChange={(v) => onChange({ colorEffect: { ...effect, alpha: v } })}
            />
            <span style={{ fontSize: "11px", color: chrome.textDefault }}>%</span>
          </div>
        )}

        {/* Advanced */}
        {effect.type === "advanced" && (
          <>
            <div style={styles.row}>
              <span style={styles.labelWide}>Red ×:</span>
              <NumInput
                value={effect.redMult ?? 100}
                min={-100}
                max={100}
                onChange={(v) => onChange({ colorEffect: { ...effect, redMult: v } })}
              />
            </div>
            <div style={styles.row}>
              <span style={styles.labelWide}>Red +:</span>
              <NumInput
                value={effect.redOffset ?? 0}
                min={-255}
                max={255}
                onChange={(v) => onChange({ colorEffect: { ...effect, redOffset: v } })}
              />
            </div>
            <div style={styles.row}>
              <span style={styles.labelWide}>Green ×:</span>
              <NumInput
                value={effect.greenMult ?? 100}
                min={-100}
                max={100}
                onChange={(v) => onChange({ colorEffect: { ...effect, greenMult: v } })}
              />
            </div>
            <div style={styles.row}>
              <span style={styles.labelWide}>Green +:</span>
              <NumInput
                value={effect.greenOffset ?? 0}
                min={-255}
                max={255}
                onChange={(v) => onChange({ colorEffect: { ...effect, greenOffset: v } })}
              />
            </div>
            <div style={styles.row}>
              <span style={styles.labelWide}>Blue ×:</span>
              <NumInput
                value={effect.blueMult ?? 100}
                min={-100}
                max={100}
                onChange={(v) => onChange({ colorEffect: { ...effect, blueMult: v } })}
              />
            </div>
            <div style={styles.row}>
              <span style={styles.labelWide}>Blue +:</span>
              <NumInput
                value={effect.blueOffset ?? 0}
                min={-255}
                max={255}
                onChange={(v) => onChange({ colorEffect: { ...effect, blueOffset: v } })}
              />
            </div>
          </>
        )}
      </div>

      {/* Blend Mode */}
      <div style={styles.sectionHeader}>
        <span style={styles.sectionLabel}>Blend Mode</span>
      </div>
      <div style={styles.sectionBody}>
        <div style={styles.row}>
          <span style={styles.label}>Blend:</span>
          <select
            style={styles.select}
            value={instance.blendMode ?? "normal"}
            onChange={(e) => onChange({ blendMode: e.target.value as SymbolInstance["blendMode"] })}
          >
            {BLEND_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Loop (graphic symbols only) */}
      {symbolType === "graphic" && (
        <>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionLabel}>Loop</span>
          </div>
          <div style={styles.sectionBody}>
            <div style={styles.row}>
              <span style={styles.label}>Mode:</span>
              <select
                style={styles.select}
                value={loopMode}
                onChange={(e) => onChange({ loopMode: e.target.value as SymbolInstance["loopMode"] })}
              >
                <option value="loop">Loop</option>
                <option value="play-once">Play Once</option>
                <option value="single-frame">Single Frame</option>
              </select>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>First:</span>
              <NumInput
                value={firstFrameDisplay}
                min={1}
                onChange={(v) => onChange({ firstFrame: Math.max(0, v - 1) })}
              />
            </div>
          </div>
        </>
      )}

      {/* Display */}
      <div style={styles.sectionHeader}>
        <span style={styles.sectionLabel}>Display</span>
      </div>
      <div style={styles.sectionBody}>
        <div style={styles.row}>
          <label style={{ fontSize: "11px", color: chrome.textDefault, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={instance.cacheAsBitmap ?? false}
              onChange={(e) => onChange({ cacheAsBitmap: e.target.checked })}
            />
            Use runtime bitmap caching
          </label>
        </div>

        {/* Track as Menu Item — button instances only */}
        {symbolType === "button" && (
          <div style={styles.row}>
            <label style={{ fontSize: "11px", color: chrome.textDefault, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={instance.trackAsMenu ?? false}
                onChange={(e) => onChange({ trackAsMenu: e.target.checked })}
              />
              Track as Menu Item
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

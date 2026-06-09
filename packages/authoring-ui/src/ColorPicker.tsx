/**
 * ColorPicker — Flash 8-style color picker component.
 *
 * Shows a color swatch (with checkerboard for transparency), a hex input,
 * and a popup palette with 216 web-safe colors and an alpha slider.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColorPickerProps {
  color: string;           // CSS hex string e.g. "#FF0000" or "rgba(255,0,0,0.5)"
  onChange: (color: string) => void;
  label?: string;          // optional label shown to the left
  showAlpha?: boolean;     // default false
}

interface ParsedColor {
  r: number;
  g: number;
  b: number;
  a: number; // 0-255
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

export function parseColor(css: string): ParsedColor {
  if (!css) return { r: 0, g: 0, b: 0, a: 255 };

  // rgba(r, g, b, a)
  const rgbaMatch = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1], 10),
      g: parseInt(rgbaMatch[2], 10),
      b: parseInt(rgbaMatch[3], 10),
      a: rgbaMatch[4] !== undefined ? Math.round(parseFloat(rgbaMatch[4]) * 255) : 255,
    };
  }

  // #RGB shorthand
  const shortHex = css.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (shortHex) {
    return {
      r: parseInt(shortHex[1] + shortHex[1], 16),
      g: parseInt(shortHex[2] + shortHex[2], 16),
      b: parseInt(shortHex[3] + shortHex[3], 16),
      a: 255,
    };
  }

  // #RRGGBB
  const fullHex = css.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (fullHex) {
    return {
      r: parseInt(fullHex[1], 16),
      g: parseInt(fullHex[2], 16),
      b: parseInt(fullHex[3], 16),
      a: 255,
    };
  }

  // #RRGGBBAA
  const hexAlpha = css.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hexAlpha) {
    return {
      r: parseInt(hexAlpha[1], 16),
      g: parseInt(hexAlpha[2], 16),
      b: parseInt(hexAlpha[3], 16),
      a: parseInt(hexAlpha[4], 16),
    };
  }

  return { r: 0, g: 0, b: 0, a: 255 };
}

export function formatHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0").toUpperCase()}${g.toString(16).padStart(2, "0").toUpperCase()}${b.toString(16).padStart(2, "0").toUpperCase()}`;
}

function toRgbaString(r: number, g: number, b: number, a: number): string {
  if (a >= 255) return formatHex(r, g, b);
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

// ---------------------------------------------------------------------------
// Web-safe palette (216 colors)
// ---------------------------------------------------------------------------

const WEB_SAFE_VALUES = [0x00, 0x33, 0x66, 0x99, 0xCC, 0xFF];

const WEB_SAFE_PALETTE: string[] = [];
for (const r of WEB_SAFE_VALUES) {
  for (const g of WEB_SAFE_VALUES) {
    for (const b of WEB_SAFE_VALUES) {
      WEB_SAFE_PALETTE.push(formatHex(r, g, b));
    }
  }
}

// ---------------------------------------------------------------------------
// Checkerboard background helper
// ---------------------------------------------------------------------------

const CHECKERBOARD_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='4' height='4' fill='%23999'/%3E%3Crect x='4' y='4' width='4' height='4' fill='%23999'/%3E%3Crect x='4' width='4' height='4' fill='%23666'/%3E%3Crect y='4' width='4' height='4' fill='%23666'/%3E%3C/svg%3E\")";

// ---------------------------------------------------------------------------
// Recent colors (module-level, shared across instances)
// ---------------------------------------------------------------------------

const MAX_RECENT = 8;
let _recentColors: string[] = [];

function addRecentColor(hex: string): void {
  const clean = hex.toUpperCase();
  _recentColors = [clean, ..._recentColors.filter((c) => c !== clean)].slice(0, MAX_RECENT);
}

// ---------------------------------------------------------------------------
// ColorPicker component
// ---------------------------------------------------------------------------

export function ColorPicker({
  color,
  onChange,
  label,
  showAlpha = false,
}: ColorPickerProps): React.ReactElement {
  const parsed = parseColor(color);
  const hexValue = formatHex(parsed.r, parsed.g, parsed.b);
  const alphaPercent = Math.round((parsed.a / 255) * 100);

  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(hexValue);
  const [alphaDraft, setAlphaDraft] = useState(alphaPercent);
  const [recentColors, setRecentColors] = useState<string[]>(_recentColors);

  const containerRef = useRef<HTMLDivElement>(null);

  // Sync drafts when prop changes
  useEffect(() => {
    setHexDraft(hexValue);
    setAlphaDraft(alphaPercent);
  }, [hexValue, alphaPercent]);

  // Close popup on click-outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const commitColor = useCallback((hex: string, a: number) => {
    const clean = hex.toUpperCase().startsWith("#") ? hex.toUpperCase() : `#${hex.toUpperCase()}`;
    addRecentColor(clean);
    setRecentColors([..._recentColors]);
    const result = showAlpha && a < 100
      ? toRgbaString(parseColor(clean).r, parseColor(clean).g, parseColor(clean).b, Math.round((a / 100) * 255))
      : clean;
    onChange(result);
  }, [onChange, showAlpha]);

  const handleSwatchClick = () => setOpen((v) => !v);

  const handlePaletteColorClick = (hex: string) => {
    setHexDraft(hex);
    commitColor(hex, alphaDraft);
  };

  const handleHexCommit = () => {
    let val = hexDraft.trim();
    if (!val.startsWith("#")) val = `#${val}`;
    // Validate 6-digit hex
    if (/^#[0-9a-f]{6}$/i.test(val)) {
      commitColor(val.toUpperCase(), alphaDraft);
    } else {
      // Revert
      setHexDraft(hexValue);
    }
  };

  const handleHexKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); handleHexCommit(); }
    if (e.key === "Escape") { e.preventDefault(); setHexDraft(hexValue); }
  };

  const handleAlphaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const a = parseInt(e.target.value, 10);
    setAlphaDraft(a);
    commitColor(hexDraft.startsWith("#") ? hexDraft : `#${hexDraft}`, a);
  };

  // Inline alpha slider (next to swatch, outside popup)
  const handleInlineAlphaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const a = parseInt(e.target.value, 10);
    setAlphaDraft(a);
    commitColor(hexValue, a);
  };

  // Swatch background: checkerboard + color overlay
  const swatchStyle: React.CSSProperties = {
    width: 18,
    height: 14,
    border: "1px solid #555",
    cursor: "pointer",
    flexShrink: 0,
    position: "relative",
    backgroundImage: CHECKERBOARD_BG,
    backgroundSize: "8px 8px",
    display: "inline-block",
    verticalAlign: "middle",
  };

  const swatchOverlayStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    background: showAlpha
      ? toRgbaString(parsed.r, parsed.g, parsed.b, parsed.a)
      : hexValue,
  };

  return (
    <div
      ref={containerRef}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, position: "relative" }}
    >
      {label && (
        <span style={{ fontSize: "11px", color: "#888", whiteSpace: "nowrap", userSelect: "none" }}>
          {label}:
        </span>
      )}

      {/* Clickable swatch */}
      <div style={swatchStyle} onClick={handleSwatchClick} title="Choose color">
        <div style={swatchOverlayStyle} />
      </div>

      {/* Inline hex display */}
      <span
        style={{
          fontSize: "10px",
          color: "#aaa",
          fontFamily: "monospace",
          userSelect: "none",
          cursor: "pointer",
        }}
        onClick={handleSwatchClick}
      >
        {hexValue}
      </span>

      {/* Inline alpha (when showAlpha) */}
      {showAlpha && (
        <input
          type="range"
          min={0}
          max={100}
          value={alphaDraft}
          onChange={handleInlineAlphaChange}
          style={{ width: 48, accentColor: "#4a90e2", cursor: "pointer" }}
          title={`Alpha: ${alphaDraft}%`}
        />
      )}

      {/* Popup */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 9999,
            background: "#2a2a2a",
            border: "1px solid #555",
            boxShadow: "2px 4px 12px rgba(0,0,0,0.7)",
            padding: 8,
            minWidth: 200,
            userSelect: "none",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Recent colors row */}
          {recentColors.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: "10px", color: "#777", marginBottom: 3 }}>Recent</div>
              <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                {recentColors.map((rc) => (
                  <div
                    key={rc}
                    onClick={() => handlePaletteColorClick(rc)}
                    title={rc}
                    style={{
                      width: 16,
                      height: 16,
                      background: rc,
                      border: rc === hexValue ? "2px solid #fff" : "1px solid #555",
                      cursor: "pointer",
                      flexShrink: 0,
                      boxSizing: "border-box",
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Web-safe color grid (6×36 = 216) */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontSize: "10px", color: "#777", marginBottom: 3 }}>Web Safe</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(18, 12px)",
                gap: 1,
              }}
            >
              {WEB_SAFE_PALETTE.map((hex) => (
                <div
                  key={hex}
                  onClick={() => handlePaletteColorClick(hex)}
                  title={hex}
                  style={{
                    width: 12,
                    height: 12,
                    background: hex,
                    border: hex === hexValue.toUpperCase() ? "1px solid #fff" : "1px solid transparent",
                    cursor: "pointer",
                    boxSizing: "border-box",
                  }}
                />
              ))}
            </div>
          </div>

          {/* Hex input */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: showAlpha ? 6 : 0 }}>
            <span style={{ fontSize: "10px", color: "#888" }}>#</span>
            <input
              type="text"
              value={hexDraft.replace(/^#/, "")}
              onChange={(e) => setHexDraft(`#${e.target.value}`)}
              onBlur={handleHexCommit}
              onKeyDown={handleHexKeyDown}
              maxLength={6}
              style={{
                width: 56,
                fontSize: "11px",
                background: "#1a1a1a",
                color: "#e0e0e0",
                border: "1px solid #555",
                padding: "1px 4px",
                fontFamily: "monospace",
                outline: "none",
              }}
            />
            {/* Preview swatch in popup */}
            <div
              style={{
                width: 20,
                height: 16,
                backgroundImage: CHECKERBOARD_BG,
                backgroundSize: "8px 8px",
                position: "relative",
                border: "1px solid #555",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: showAlpha
                    ? toRgbaString(parsed.r, parsed.g, parsed.b, Math.round((alphaDraft / 100) * 255))
                    : hexDraft,
                }}
              />
            </div>
          </div>

          {/* Alpha slider */}
          {showAlpha && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: "10px", color: "#888", width: 36, flexShrink: 0 }}>Alpha</span>
              <input
                type="range"
                min={0}
                max={100}
                value={alphaDraft}
                onChange={handleAlphaChange}
                style={{ flex: 1, accentColor: "#4a90e2", cursor: "pointer" }}
              />
              <span style={{ fontSize: "10px", color: "#aaa", width: 30, textAlign: "right" }}>
                {alphaDraft}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

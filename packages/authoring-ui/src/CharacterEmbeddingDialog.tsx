/**
 * Flash 8-style "Character Embedding" dialog (opened from the text Properties
 * panel "Embed…" button).
 *
 * The user picks which glyph ranges to embed in the published SWF font:
 *   - All (the whole printable-ASCII set)
 *   - Uppercase (A–Z)
 *   - Lowercase (a–z)
 *   - Numerals (0–9)
 *   - Punctuation
 * plus a free-text "Include these characters" box for specific glyphs.
 *
 * The dialog returns the selection as { ranges, chars }. When the user has not
 * opted into subsetting (no ranges chosen and the "Don't embed" state), the
 * caller clears embedRanges so the compiler falls back to embed-everything
 * (byte-identical to the historical default).
 */

import React, { useState } from "react";
import type { EmbedRange } from "@flash/core";
import {
  chrome,
  halo,
  chromeFont,
  inputStyle,
  buttonStyle,
  type ButtonState,
} from "./theme/flash8Theme.js";

/** A Halo-skinned button that tracks its own hover/press state. */
function DialogButton({
  children,
  onClick,
  primary = false,
  testId,
  style,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  testId?: string;
  style?: React.CSSProperties;
}): React.ReactElement {
  const [state, setState] = useState<ButtonState>("up");
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      onMouseEnter={() => setState("over")}
      onMouseLeave={() => setState("up")}
      onMouseDown={() => setState("down")}
      onMouseUp={() => setState("over")}
      style={{
        ...buttonStyle(state),
        ...(primary ? { color: chrome.textDefault, fontWeight: "bold" } : {}),
        padding: "3px 12px",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export interface CharacterEmbeddingDialogProps {
  /** Currently selected named ranges (undefined = not opted into subsetting). */
  initialRanges: readonly EmbedRange[] | undefined;
  /** Currently selected specific characters. */
  initialChars: string;
  /** Called with the chosen ranges + chars when the user clicks OK. A `ranges`
   *  of undefined means "Don't embed any range explicitly" → the compiler embeds
   *  the full default set. */
  onConfirm: (selection: { ranges: readonly EmbedRange[] | undefined; chars: string }) => void;
  /** Called when the dialog should close (OK or Cancel). */
  onClose: () => void;
}

interface RangeOption {
  value: EmbedRange;
  label: string;
}

const RANGE_OPTIONS: RangeOption[] = [
  { value: "all", label: "All (32–126)" },
  { value: "uppercase", label: "Uppercase  [A–Z]" },
  { value: "lowercase", label: "Lowercase  [a–z]" },
  { value: "numerals", label: "Numerals  [0–9]" },
  { value: "punctuation", label: "Punctuation  [!@#%…]" },
];

export function CharacterEmbeddingDialog({
  initialRanges,
  initialChars,
  onConfirm,
  onClose,
}: CharacterEmbeddingDialogProps): React.ReactElement {
  // Selected named ranges (a Set for easy multi-select toggling).
  const [selected, setSelected] = useState<Set<EmbedRange>>(
    () => new Set(initialRanges ?? [])
  );
  const [chars, setChars] = useState(initialChars);
  // Whether the user has opted into subsetting at all. When the field had no
  // explicit ranges this starts off; toggling any range or the master checkbox
  // turns it on. "Off" means the published font embeds the full default set.
  const [embedEnabled, setEmbedEnabled] = useState(initialRanges !== undefined);

  const toggleRange = (r: EmbedRange) => {
    setEmbedEnabled(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  };

  const handleOk = () => {
    if (!embedEnabled) {
      onConfirm({ ranges: undefined, chars: "" });
    } else {
      onConfirm({ ranges: [...selected], chars });
    }
    onClose();
  };

  return (
    <div
      data-testid="character-embedding-dialog"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3000,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: chrome.panelBg,
          border: `1px solid ${chrome.separator}`,
          boxShadow: "4px 4px 16px rgba(0,0,0,0.4)",
          ...chromeFont(),
          userSelect: "none",
          minWidth: 300,
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: chrome.panelBg,
            borderBottom: `1px solid ${chrome.separator}`,
            padding: "4px 6px",
          }}
        >
          <span style={{ fontWeight: "bold", fontSize: 11 }}>Character Embedding</span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: `1px solid ${halo.borderColor}`,
              color: chrome.textDefault,
              cursor: "pointer",
              fontSize: 11,
              padding: "1px 5px",
              lineHeight: "14px",
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            background: halo.panelContentBg,
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={embedEnabled}
              onChange={(e) => setEmbedEnabled(e.target.checked)}
            />
            <span>Embed only selected characters (subset font)</span>
          </label>
          <div style={{ fontSize: 10, color: chrome.textDisabled, marginBottom: 4 }}>
            When off, the full character set is embedded (default).
          </div>

          {/* Range multi-select list */}
          <div
            style={{
              border: `1px solid ${halo.inputBorder}`,
              background: halo.inputBg,
              maxHeight: 140,
              overflowY: "auto",
              padding: 4,
              opacity: embedEnabled ? 1 : 0.5,
            }}
          >
            {RANGE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 2px", cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(opt.value)}
                  onChange={() => toggleRange(opt.value)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>

          {/* Specific characters */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span>Include these characters:</span>
            <input
              data-testid="embed-specific-chars"
              style={{
                ...inputStyle(),
                padding: "3px 5px",
              }}
              value={chars}
              placeholder="e.g. $.,%"
              onChange={(e) => {
                setEmbedEnabled(true);
                setChars(e.target.value);
              }}
            />
          </div>
        </div>

        {/* Footer buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 6,
            padding: "8px 12px",
            borderTop: `1px solid ${chrome.separator}`,
            background: chrome.panelBg,
          }}
        >
          <DialogButton onClick={onClose}>Cancel</DialogButton>
          <DialogButton testId="embed-dialog-ok" onClick={handleOk} primary>
            OK
          </DialogButton>
        </div>
      </div>
    </div>
  );
}

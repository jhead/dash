import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SymbolType } from "@flash/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConvertToSymbolDialogProps {
  open: boolean;
  defaultName?: string;
  onConfirm: (name: string, type: SymbolType) => void;
  onClose: () => void;
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
    minWidth: "300px",
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
    padding: "10px 12px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    marginBottom: "8px",
  },
  label: {
    width: "50px",
    flexShrink: 0,
    fontSize: "11px",
    color: "#ccc",
  },
  inputWide: {
    flex: 1,
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
  },
  radioGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
    marginLeft: "50px",
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
    margin: "8px 0",
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
// ConvertToSymbolDialog
// ---------------------------------------------------------------------------

export function ConvertToSymbolDialog({
  open,
  defaultName = "Symbol 1",
  onConfirm,
  onClose,
}: ConvertToSymbolDialogProps): React.ReactElement | null {
  const [name, setName] = useState(defaultName);
  const [type, setType] = useState<SymbolType>("movieclip");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reset state and focus name input each time the dialog opens
  useEffect(() => {
    if (open) {
      setName(defaultName);
      setType("movieclip");
      // Defer focus so the input is mounted
      setTimeout(() => {
        nameInputRef.current?.select();
        nameInputRef.current?.focus();
      }, 0);
    }
  }, [open, defaultName]);

  // Keyboard handler: Enter = OK, Escape = Cancel
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
  }, [open, name, type]);

  const handleOk = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed, type);
  }, [name, type, onConfirm]);

  if (!open) return null;

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
          <span style={styles.titleText}>Convert to Symbol</span>
          <button style={styles.closeBtn} onClick={onClose} title="Close">
            ×
          </button>
        </div>

        {/* Body */}
        <div style={styles.body}>
          {/* Name */}
          <div style={styles.row}>
            <span style={styles.label}>Name:</span>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={styles.inputWide}
              placeholder="Symbol 1"
            />
          </div>

          <div style={styles.divider} />

          {/* Type */}
          <div style={{ marginBottom: "8px", fontSize: "11px", color: "#ccc" }}>Type:</div>
          <div style={styles.radioGroup}>
            {(
              [
                { value: "movieclip", label: "Movie Clip" },
                { value: "button", label: "Button" },
                { value: "graphic", label: "Graphic" },
              ] as { value: SymbolType; label: string }[]
            ).map(({ value, label }) => (
              <label key={value} style={styles.radioRow}>
                <input
                  type="radio"
                  checked={type === value}
                  onChange={() => setType(value)}
                  style={{ margin: 0, cursor: "pointer" }}
                />
                {label}
              </label>
            ))}
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

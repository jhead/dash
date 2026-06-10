import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Library } from "@flash/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SwapSymbolDialogProps {
  open: boolean;
  library: Library;
  currentSymbolId: string;
  onConfirm: (newSymbolId: string) => void;
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
    minWidth: "320px",
    width: "320px",
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
  listLabel: {
    fontSize: "11px",
    color: "#ccc",
    marginBottom: "4px",
  },
  listBox: {
    background: "#1e1e1e",
    border: "1px solid #555",
    height: "180px",
    overflowY: "auto" as const,
    fontSize: "11px",
    marginBottom: "10px",
  },
  listItem: {
    padding: "3px 8px",
    cursor: "pointer",
    color: "#e0e0e0",
    whiteSpace: "nowrap" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  listItemSelected: {
    padding: "3px 8px",
    cursor: "pointer",
    background: "#1a6ea8",
    color: "#fff",
    whiteSpace: "nowrap" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  btnRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: "6px",
    marginTop: "4px",
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
// SwapSymbolDialog
// ---------------------------------------------------------------------------

export function SwapSymbolDialog({
  open,
  library,
  currentSymbolId,
  onConfirm,
  onClose,
}: SwapSymbolDialogProps): React.ReactElement | null {
  const [selectedId, setSelectedId] = useState<string>(currentSymbolId);
  const listRef = useRef<HTMLDivElement>(null);

  // Collect all symbols (movieclip, button, graphic) from the library
  const symbols = library.items.filter((item) => item.itemType === "symbol");

  // Reset selection to current symbol whenever the dialog opens
  useEffect(() => {
    if (open) {
      setSelectedId(currentSymbolId);
    }
  }, [open, currentSymbolId]);

  // Scroll selected item into view when dialog opens
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const el = listRef.current?.querySelector("[data-selected='true']");
      (el as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

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
  }, [open, selectedId]);

  const handleOk = useCallback(() => {
    if (!selectedId) return;
    onConfirm(selectedId);
  }, [selectedId, onConfirm]);

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
          <span style={styles.titleText}>Swap Symbol</span>
          <button style={styles.closeBtn} onClick={onClose} title="Close">
            x
          </button>
        </div>

        {/* Body */}
        <div style={styles.body}>
          <div style={styles.listLabel}>Select a symbol to swap with:</div>

          {/* Symbol list */}
          <div style={styles.listBox} ref={listRef}>
            {symbols.length === 0 && (
              <div style={{ ...styles.listItem, color: "#888", fontStyle: "italic" }}>
                No symbols in library
              </div>
            )}
            {symbols.map((sym) => {
              const isCurrent = sym.id === currentSymbolId;
              const isSelected = sym.id === selectedId;
              const typeLabel =
                sym.itemType === "symbol"
                  ? sym.symbolType === "movieclip"
                    ? "MC"
                    : sym.symbolType === "button"
                    ? "Btn"
                    : "Gfx"
                  : "";
              return (
                <div
                  key={sym.id}
                  data-selected={isSelected ? "true" : "false"}
                  style={{
                    ...(isSelected ? styles.listItemSelected : styles.listItem),
                    fontWeight: isCurrent ? "bold" : "normal",
                  }}
                  onMouseDown={() => setSelectedId(sym.id)}
                  onDoubleClick={() => {
                    setSelectedId(sym.id);
                    onConfirm(sym.id);
                  }}
                  title={isCurrent ? `${sym.name} (current)` : sym.name}
                >
                  [{typeLabel}] {sym.name}
                  {isCurrent ? " *" : ""}
                </div>
              );
            })}
          </div>

          {/* Buttons */}
          <div style={styles.btnRow}>
            <button style={styles.btn} onClick={onClose}>
              Cancel
            </button>
            <button
              style={styles.btnPrimary}
              onClick={handleOk}
              disabled={!selectedId}
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

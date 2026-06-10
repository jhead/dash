import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SymbolLinkage } from "@flash/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SymbolLinkageDialogProps {
  open: boolean;
  symbolName: string;
  linkage: SymbolLinkage;
  onConfirm: (linkage: SymbolLinkage) => void;
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
  symbolNameRow: {
    marginBottom: "10px",
    fontSize: "11px",
    color: "#aaa",
  },
  symbolName: {
    color: "#e0e0e0",
    fontWeight: "bold",
  },
  checkRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginBottom: "8px",
    cursor: "pointer",
    fontSize: "11px",
    color: "#e0e0e0",
  },
  fieldRow: {
    display: "flex",
    alignItems: "center",
    marginBottom: "8px",
    marginLeft: "18px",
  },
  fieldLabel: {
    width: "74px",
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
  inputDisabled: {
    flex: 1,
    background: "#2a2a2a",
    border: "1px solid #444",
    color: "#666",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
    cursor: "not-allowed",
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
// SymbolLinkageDialog
// ---------------------------------------------------------------------------

export function SymbolLinkageDialog({
  open,
  symbolName,
  linkage,
  onConfirm,
  onClose,
}: SymbolLinkageDialogProps): React.ReactElement | null {
  const [exportForAS, setExportForAS] = useState(linkage.exportForActionScript);
  const [identifier, setIdentifier] = useState(linkage.linkageIdentifier);
  const [className, setClassName] = useState(linkage.className);
  const [exportInFirstFrame, setExportInFirstFrame] = useState(linkage.exportInFirstFrame);

  const identifierRef = useRef<HTMLInputElement>(null);

  // Sync state when dialog opens with new linkage values
  useEffect(() => {
    if (open) {
      setExportForAS(linkage.exportForActionScript);
      setIdentifier(linkage.linkageIdentifier);
      setClassName(linkage.className);
      setExportInFirstFrame(linkage.exportInFirstFrame);
    }
  }, [open, linkage]);

  // Auto-populate identifier from symbol name if empty when checking Export
  const handleExportForASChange = useCallback((checked: boolean) => {
    setExportForAS(checked);
    if (checked && !identifier) {
      // Default identifier: symbol name with spaces removed
      setIdentifier(symbolName.replace(/\s+/g, "_"));
    }
    if (checked) {
      setTimeout(() => {
        identifierRef.current?.select();
        identifierRef.current?.focus();
      }, 0);
    }
  }, [identifier, symbolName]);

  const handleOk = useCallback(() => {
    const newLinkage: SymbolLinkage = {
      ...linkage,
      exportForActionScript: exportForAS,
      linkageIdentifier: exportForAS ? identifier.trim() : "",
      className: exportForAS ? className.trim() : "",
      exportInFirstFrame: exportForAS ? exportInFirstFrame : false,
    };
    onConfirm(newLinkage);
  }, [linkage, exportForAS, identifier, className, exportInFirstFrame, onConfirm]);

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
  }, [open, exportForAS, identifier, className, exportInFirstFrame]);

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
          <span style={styles.titleText}>Symbol Linkage Properties</span>
          <button style={styles.closeBtn} onClick={onClose} title="Close">
            x
          </button>
        </div>

        {/* Body */}
        <div style={styles.body}>
          {/* Symbol name display */}
          <div style={styles.symbolNameRow}>
            Symbol: <span style={styles.symbolName}>{symbolName}</span>
          </div>

          <div style={styles.divider} />

          {/* Export for ActionScript */}
          <label style={styles.checkRow}>
            <input
              type="checkbox"
              checked={exportForAS}
              onChange={(e) => handleExportForASChange(e.target.checked)}
              style={{ margin: 0, cursor: "pointer" }}
            />
            Export for ActionScript
          </label>

          {/* Identifier */}
          <div style={styles.fieldRow}>
            <span style={styles.fieldLabel}>Identifier:</span>
            <input
              ref={identifierRef}
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              disabled={!exportForAS}
              style={exportForAS ? styles.input : styles.inputDisabled}
              placeholder="e.g. MyClip"
            />
          </div>

          {/* AS2 Class */}
          <div style={styles.fieldRow}>
            <span style={styles.fieldLabel}>AS2 Class:</span>
            <input
              type="text"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              disabled={!exportForAS}
              style={exportForAS ? styles.input : styles.inputDisabled}
              placeholder="e.g. MyClipClass"
            />
          </div>

          {/* Export in first frame */}
          <label style={{ ...styles.checkRow, marginLeft: "0px", opacity: exportForAS ? 1 : 0.5 }}>
            <input
              type="checkbox"
              checked={exportInFirstFrame}
              onChange={(e) => setExportInFirstFrame(e.target.checked)}
              disabled={!exportForAS}
              style={{ margin: 0, cursor: exportForAS ? "pointer" : "not-allowed" }}
            />
            Export in first frame
          </label>

          <div style={styles.divider} />

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

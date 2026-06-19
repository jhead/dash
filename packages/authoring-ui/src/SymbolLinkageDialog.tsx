import React, { useCallback, useEffect, useRef, useState } from "react";
import { chrome, halo, chromeFont, inputStyle, buttonStyle } from "./theme/flash8Theme.js";
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
  /**
   * Fully-qualified AS2 class names available in the document (from
   * `doc.asClasses`), offered as autocomplete suggestions for the AS2 Class
   * field. Optional — when absent the field is a plain text input.
   */
  classNames?: string[];
}

/** Unique id for the AS2-class autocomplete <datalist>. */
const CLASS_DATALIST_ID = "symbol-linkage-class-suggestions";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  dialog: {
    position: "fixed",
    background: chrome.appBg,
    border: `1px solid ${chrome.separator}`,
    boxShadow: "4px 4px 12px rgba(0,0,0,0.45)",
    minWidth: "320px",
    zIndex: 1000,
    ...chromeFont(),
    userSelect: "none",
  },
  titleBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: `linear-gradient(${halo.panelHeaderGrad[0]}, ${halo.panelHeaderGrad[1]})`,
    borderBottom: `1px solid ${halo.headerDivider}`,
    padding: "4px 6px",
    cursor: "default",
  },
  titleText: {
    ...chromeFont(),
    fontWeight: "bold",
    color: chrome.textDefault,
  },
  closeBtn: {
    ...buttonStyle("up"),
    width: "16px",
    height: "16px",
    padding: 0,
    lineHeight: 1,
  },
  body: {
    padding: "10px 12px",
    background: halo.panelContentBg,
    color: chrome.textDefault,
  },
  symbolNameRow: {
    marginBottom: "10px",
    ...chromeFont(),
    color: chrome.textDisabled,
  },
  symbolName: {
    color: chrome.textDefault,
    fontWeight: "bold",
  },
  checkRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginBottom: "8px",
    cursor: "pointer",
    ...chromeFont(),
    color: chrome.textDefault,
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
    ...chromeFont(),
    color: chrome.textDefault,
  },
  input: {
    flex: 1,
    ...inputStyle(),
  },
  inputDisabled: {
    flex: 1,
    ...inputStyle(),
    background: chrome.insetFieldStrip,
    color: chrome.textDisabled,
    cursor: "not-allowed",
  },
  divider: {
    height: "1px",
    background: chrome.separator,
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
    ...buttonStyle("up"),
    padding: "3px 14px",
    minWidth: "58px",
  },
  btnPrimary: {
    ...buttonStyle("up"),
    padding: "3px 14px",
    minWidth: "58px",
    borderColor: halo.haloBlue,
    color: chrome.textDefault,
    fontWeight: "bold",
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
  classNames,
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

  // Sorted, de-duplicated class-name suggestions for the AS2 Class autocomplete.
  const classSuggestions = React.useMemo(
    () => Array.from(new Set((classNames ?? []).filter((c) => c.length > 0))).sort(),
    [classNames],
  );

  if (!open) return null;

  return (
    <div
      style={styles.overlay}
      data-testid="symbol-linkage-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={styles.dialog} data-testid="symbol-linkage-dialog" onMouseDown={(e) => e.stopPropagation()}>
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
              data-testid="symbol-linkage-export"
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
              data-testid="symbol-linkage-identifier"
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
              data-testid="symbol-linkage-classname"
              style={exportForAS ? styles.input : styles.inputDisabled}
              placeholder="e.g. com.example.MyClip"
              list={classSuggestions.length > 0 ? CLASS_DATALIST_ID : undefined}
              autoComplete="off"
            />
            {classSuggestions.length > 0 && (
              <datalist id={CLASS_DATALIST_ID}>
                {classSuggestions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            )}
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
            <button style={styles.btn} onClick={onClose} data-testid="symbol-linkage-cancel">
              Cancel
            </button>
            <button style={styles.btnPrimary} onClick={handleOk} data-testid="symbol-linkage-ok">
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

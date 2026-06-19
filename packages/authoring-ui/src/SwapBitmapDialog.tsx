/**
 * SwapBitmapDialog — choose a replacement bitmap from the library.
 *
 * Displays a list of all BitmapItems currently in the library.
 * The user clicks one to select it and clicks OK to confirm the swap.
 */
import React, { useState } from "react";
import type { BitmapItem } from "@flash/core";
import { chrome, halo, chromeFont, buttonStyle } from "./theme/flash8Theme.js";

// ---------------------------------------------------------------------------
// Styles (Flash 8 light "Halo" chrome)
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
  },
  dialog: {
    background: chrome.appBg,
    border: `1px solid ${chrome.separator}`,
    boxShadow: "4px 4px 12px rgba(0,0,0,0.45)",
    minWidth: "300px",
    maxWidth: "400px",
    width: "320px",
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
    padding: "10px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    background: halo.panelContentBg,
  },
  label: {
    ...chromeFont(),
    color: chrome.textDefault,
    marginBottom: "4px",
  },
  listBox: {
    background: halo.inputBg,
    border: `1px solid ${chrome.separator}`,
    height: "180px",
    overflowY: "auto",
  },
  listItem: {
    padding: "4px 8px",
    cursor: "default",
    ...chromeFont(),
    color: chrome.textDefault,
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  listItemSelected: {
    background: halo.selectionColor,
    color: chrome.textDefault,
  },
  thumbnail: {
    width: "24px",
    height: "24px",
    objectFit: "contain",
    background: halo.panelContentBg,
    border: `1px solid ${halo.borderColor}`,
    flexShrink: 0,
  },
  emptyMsg: {
    color: chrome.textDisabled,
    padding: "8px",
    ...chromeFont(),
    fontStyle: "italic",
  },
  buttons: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "6px",
    padding: "6px 10px 10px",
    borderTop: `1px solid ${chrome.separator}`,
    background: halo.panelContentBg,
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
// Props & Component
// ---------------------------------------------------------------------------

export interface SwapBitmapDialogProps {
  open: boolean;
  bitmapItems: BitmapItem[];
  onConfirm: (newLibraryItemId: string) => void;
  onClose: () => void;
}

export function SwapBitmapDialog({
  open,
  bitmapItems,
  onConfirm,
  onClose,
}: SwapBitmapDialogProps): React.ReactElement | null {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!open) return null;

  const handleOk = () => {
    if (selectedId) {
      onConfirm(selectedId);
      setSelectedId(null);
    }
  };

  const handleClose = () => {
    setSelectedId(null);
    onClose();
  };

  return (
    <div style={styles.overlay} onMouseDown={handleClose}>
      <div style={styles.dialog} onMouseDown={(e) => e.stopPropagation()}>
        <div style={styles.titleBar}>
          <span style={styles.titleText}>Swap Bitmap</span>
          <button style={styles.closeBtn} onClick={handleClose} title="Close">
            ×
          </button>
        </div>
        <div style={styles.body}>
          <div style={styles.label}>Select a bitmap from the library:</div>
          <div style={styles.listBox}>
            {bitmapItems.length === 0 ? (
              <div style={styles.emptyMsg}>No bitmaps in library</div>
            ) : (
              bitmapItems.map((item) => {
                const isSelected = item.id === selectedId;
                return (
                  <div
                    key={item.id}
                    style={{
                      ...styles.listItem,
                      ...(isSelected ? styles.listItemSelected : {}),
                    }}
                    onClick={() => setSelectedId(item.id)}
                  >
                    {item.dataUri ? (
                      <img
                        src={item.dataUri}
                        alt={item.name}
                        style={styles.thumbnail}
                      />
                    ) : (
                      <div style={styles.thumbnail} />
                    )}
                    <span>{item.name}</span>
                    {item.originalWidth > 0 && (
                      <span style={{ color: chrome.textDisabled, fontSize: "10px" }}>
                        {item.originalWidth}×{item.originalHeight}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div style={styles.buttons}>
          <button style={styles.btn} onClick={handleClose}>
            Cancel
          </button>
          <button
            style={{ ...styles.btn, ...styles.btnPrimary }}
            onClick={handleOk}
            disabled={!selectedId}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

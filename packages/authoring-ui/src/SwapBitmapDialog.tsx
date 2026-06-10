/**
 * SwapBitmapDialog — choose a replacement bitmap from the library.
 *
 * Displays a list of all BitmapItems currently in the library.
 * The user clicks one to select it and clicks OK to confirm the swap.
 */
import React, { useState } from "react";
import type { BitmapItem } from "@flash/core";

// ---------------------------------------------------------------------------
// Styles (Flash 8 dark-panel aesthetic)
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
  },
  dialog: {
    background: "#3c3c3c",
    border: "1px solid #666",
    boxShadow: "4px 4px 12px rgba(0,0,0,0.6)",
    minWidth: "300px",
    maxWidth: "400px",
    width: "320px",
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
    background: "none",
    border: "none",
    color: "#aaa",
    cursor: "pointer",
    fontSize: "13px",
    padding: "0 2px",
    lineHeight: 1,
  },
  body: {
    padding: "10px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  label: {
    fontSize: "11px",
    color: "#ccc",
    marginBottom: "4px",
  },
  listBox: {
    background: "#1e1e1e",
    border: "1px solid #555",
    height: "180px",
    overflowY: "auto",
  },
  listItem: {
    padding: "4px 8px",
    cursor: "default",
    fontSize: "11px",
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  listItemSelected: {
    background: "#0078d7",
    color: "#fff",
  },
  thumbnail: {
    width: "24px",
    height: "24px",
    objectFit: "contain",
    background: "#333",
    border: "1px solid #444",
    flexShrink: 0,
  },
  emptyMsg: {
    color: "#777",
    padding: "8px",
    fontSize: "11px",
    fontStyle: "italic",
  },
  buttons: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "6px",
    padding: "6px 10px 10px",
    borderTop: "1px solid #555",
  },
  btn: {
    padding: "3px 14px",
    fontSize: "11px",
    cursor: "pointer",
    border: "1px solid #666",
    borderRadius: "2px",
    background: "#4a4a4a",
    color: "#e0e0e0",
  },
  btnPrimary: {
    background: "#0078d7",
    borderColor: "#005fa3",
    color: "#fff",
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
                      <span style={{ color: isSelected ? "#cce0ff" : "#888", fontSize: "10px" }}>
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

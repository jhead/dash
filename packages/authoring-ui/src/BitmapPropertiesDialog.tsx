/**
 * BitmapPropertiesDialog — per-asset bitmap properties editor.
 *
 * Allows the user to:
 *  - Preview filename and original dimensions (read-only)
 *  - Choose compression type: JPEG (with quality slider) or Lossless
 *  - Toggle "Allow smoothing" for bilinear filtering when transformed
 *  - Re-import (update) the bitmap from disk via a file-picker
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { chrome, halo, chromeFont, buttonStyle } from "./theme/flash8Theme.js";
import type { BitmapItem } from "@flash/core";

// ---------------------------------------------------------------------------
// Styles (Flash 8 light Halo aesthetic — flash8Theme tokens)
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
    maxWidth: "420px",
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
  infoSection: {
    background: chrome.insetFieldStrip,
    border: `1px solid ${chrome.separator}`,
    padding: "6px 8px",
    marginBottom: "10px",
    ...chromeFont(),
    fontSize: 10,
    color: chrome.textDisabled,
  },
  infoRow: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: "2px",
  },
  infoLabel: {
    color: chrome.textDisabled,
  },
  infoValue: {
    color: chrome.textDefault,
    textAlign: "right" as const,
  },
  sectionHeader: {
    ...chromeFont(),
    fontWeight: "bold",
    color: chrome.textDefault,
    borderBottom: `1px solid ${chrome.separator}`,
    paddingBottom: "4px",
    marginBottom: "8px",
    marginTop: "4px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    marginBottom: "8px",
    gap: "8px",
  },
  label: {
    width: "80px",
    flexShrink: 0,
    ...chromeFont(),
    color: chrome.textDefault,
  },
  radioGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
  },
  radioLabel: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    cursor: "pointer",
    ...chromeFont(),
    color: chrome.textDefault,
  },
  qualityRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginLeft: "88px",
    marginBottom: "8px",
  },
  qualityLabel: {
    ...chromeFont(),
    color: chrome.textDisabled,
    width: "50px",
    flexShrink: 0,
  },
  slider: {
    flex: 1,
    accentColor: halo.haloBlue,
  },
  qualityValue: {
    ...chromeFont(),
    color: chrome.textDefault,
    width: "30px",
    textAlign: "right" as const,
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
  divider: {
    height: "1px",
    background: chrome.separator,
    margin: "8px 0",
  },
  updateBtn: {
    ...buttonStyle("up"),
    padding: "3px 10px",
    marginBottom: "4px",
  },
  updateHint: {
    ...chromeFont(),
    fontSize: 10,
    color: chrome.textDisabled,
    fontStyle: "italic",
    marginBottom: "8px",
  },
  btnRow: {
    display: "flex",
    flexDirection: "row" as const,
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
// Props
// ---------------------------------------------------------------------------

export interface BitmapPropertiesDialogProps {
  item: BitmapItem;
  onSave: (changes: Partial<BitmapItem>) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BitmapPropertiesDialog({
  item,
  onSave,
  onClose,
}: BitmapPropertiesDialogProps): React.ReactElement {
  // Local state mirrors item fields
  const [compression, setCompression] = useState<"photo" | "lossless">(
    item.compressionType ?? "photo"
  );
  const [quality, setQuality] = useState<number>(item.quality ?? 80);
  const [allowSmoothing, setAllowSmoothing] = useState<boolean>(
    item.allowSmoothing ?? false
  );

  // Hidden file input for "Update..." functionality
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync state when item changes (e.g., dialog reused for different items)
  useEffect(() => {
    setCompression(item.compressionType ?? "photo");
    setQuality(item.quality ?? 80);
    setAllowSmoothing(item.allowSmoothing ?? false);
  }, [item]);

  const handleOk = useCallback(() => {
    const changes: Partial<BitmapItem> = {
      compressionType: compression,
      quality: compression === "photo" ? quality : item.quality,
      allowSmoothing,
    };
    onSave(changes);
  }, [compression, quality, allowSmoothing, item.quality, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleOk();
      }
    },
    [onClose, handleOk]
  );

  const handleUpdateClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUri = reader.result as string;
        if (dataUri) {
          // Create an image to read natural dimensions
          const img = new Image();
          img.onload = () => {
            const changes: Partial<BitmapItem> = {
              dataUri,
              originalWidth: img.naturalWidth,
              originalHeight: img.naturalHeight,
            };
            onSave(changes);
          };
          img.onerror = () => {
            // Fallback: save without dimensions
            onSave({ dataUri });
          };
          img.src = dataUri;
        }
      };
      reader.readAsDataURL(file);
      // Reset input so the same file can be re-selected
      e.target.value = "";
    },
    [onSave]
  );

  const filename = item.name || "(unnamed)";
  const width = item.originalWidth > 0 ? item.originalWidth : "?";
  const height = item.originalHeight > 0 ? item.originalHeight : "?";

  return (
    <div
      style={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        style={styles.dialog}
        onMouseDown={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        {/* Title bar */}
        <div style={styles.titleBar}>
          <span style={styles.titleText}>Bitmap Properties</span>
          <button style={styles.closeBtn} onClick={onClose} title="Close">
            x
          </button>
        </div>

        {/* Body */}
        <div style={styles.body}>
          {/* File / dimension info (read-only) */}
          <div style={styles.infoSection}>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>File:</span>
              <span style={{ ...styles.infoValue, maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                {filename}
              </span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Dimensions:</span>
              <span style={styles.infoValue}>
                {width} x {height} px
              </span>
            </div>
          </div>

          {/* Compression section */}
          <div style={styles.sectionHeader}>Compression</div>

          <div style={styles.row}>
            <span style={styles.label}>Compression:</span>
            <div style={styles.radioGroup}>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="compression"
                  value="photo"
                  checked={compression === "photo"}
                  onChange={() => setCompression("photo")}
                  style={{ margin: 0 }}
                />
                JPEG (lossy)
              </label>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="compression"
                  value="lossless"
                  checked={compression === "lossless"}
                  onChange={() => setCompression("lossless")}
                  style={{ margin: 0 }}
                />
                Lossless (PNG/GIF)
              </label>
            </div>
          </div>

          {/* Quality slider — only visible when JPEG selected */}
          {compression === "photo" && (
            <div style={styles.qualityRow}>
              <span style={styles.qualityLabel}>Quality:</span>
              <input
                type="range"
                min={1}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                style={styles.slider}
                title={`JPEG quality: ${quality}`}
              />
              <span style={styles.qualityValue}>{quality}</span>
            </div>
          )}

          <div style={styles.divider} />

          {/* Allow smoothing */}
          <label style={styles.checkRow}>
            <input
              type="checkbox"
              checked={allowSmoothing}
              onChange={(e) => setAllowSmoothing(e.target.checked)}
              style={{ margin: 0, cursor: "pointer" }}
            />
            Allow smoothing
          </label>

          <div style={styles.divider} />

          {/* Update from disk */}
          <button
            style={styles.updateBtn}
            onClick={handleUpdateClick}
            title="Re-import bitmap from disk"
          >
            Update...
          </button>
          <div style={styles.updateHint}>
            Re-import this bitmap from a file on disk.
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />

          {/* OK / Cancel */}
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

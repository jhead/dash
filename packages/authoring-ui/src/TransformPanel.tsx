/**
 * TransformPanel — Flash 8-style Transform panel for selected display objects.
 *
 * Shows X, Y, W, H (px), rotation (degrees), skewX and skewY (degrees) with
 * optional constrain-proportions mode and a Reset Transform button.
 * Commits changes on blur or Enter, reverts on Escape.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import type { DisplayObject, ShapeDisplayObject, DrawingObject } from "@flash/core";
import { transformedShapeBounds } from "@flash/core";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type TransformUpdates = Partial<{
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  skewX: number;
  skewY: number;
  width: number;
  height: number;
}>;

export interface TransformPanelProps {
  selectedObject: DisplayObject | null;
  onTransform: (id: string, updates: TransformUpdates) => void;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: "flex",
    flexDirection: "column",
    background: "#2d2d2d",
    borderBottom: "1px solid #1a1a1a",
    flexShrink: 0,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    height: "22px",
    background: "#3a3a3a",
    borderBottom: "1px solid #1a1a1a",
    padding: "0 6px",
    flexShrink: 0,
    userSelect: "none",
  },
  sectionLabel: {
    fontSize: "11px",
    color: "#c0c0c0",
    fontWeight: "bold",
  },
  sectionBody: {
    padding: "6px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  twoCol: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "4px",
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "2px",
  },
  label: {
    fontSize: "10px",
    color: "#999",
    width: "16px",
    flexShrink: 0,
    textAlign: "right",
  },
  labelWide: {
    fontSize: "10px",
    color: "#999",
    width: "44px",
    flexShrink: 0,
    textAlign: "right",
  },
  input: {
    fontSize: "11px",
    background: "#222",
    color: "#e0e0e0",
    border: "1px solid #444",
    padding: "1px 3px",
    flex: 1,
    minWidth: 0,
    outline: "none",
  },
  inputFocused: {
    fontSize: "11px",
    background: "#1a1a2e",
    color: "#e0e0e0",
    border: "1px solid #1a6ea8",
    padding: "1px 3px",
    flex: 1,
    minWidth: 0,
    outline: "none",
  },
  placeholder: {
    padding: "6px",
    fontSize: "11px",
    color: "#666",
    fontStyle: "italic",
  },
  constrainRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "4px",
    marginTop: "2px",
  },
  constrainLabel: {
    fontSize: "10px",
    color: "#999",
    userSelect: "none",
    cursor: "pointer",
  },
  resetBtn: {
    fontSize: "10px",
    background: "#3a3a3a",
    color: "#c0c0c0",
    border: "1px solid #555",
    padding: "2px 6px",
    cursor: "pointer",
    marginTop: "4px",
    alignSelf: "center",
  },
  divider: {
    height: "1px",
    background: "#383838",
    margin: "2px 0",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Get the W/H of a display object, accounting for type. */
function getObjectSize(obj: DisplayObject): { width: number; height: number } {
  if (obj.type === "shape" || obj.type === "drawing-object") {
    const bounds = transformedShapeBounds(obj as ShapeDisplayObject | DrawingObject);
    return { width: bounds.width, height: bounds.height };
  }
  if (obj.type === "bitmap" || obj.type === "text") {
    return { width: obj.width, height: obj.height };
  }
  // instance — no guaranteed width/height; return 0
  return { width: 0, height: 0 };
}

/** Get the raw (unscaled) W/H for computing scale from desired width. */
function getRawSize(obj: DisplayObject): { width: number; height: number } {
  if (obj.type === "shape" || obj.type === "drawing-object") {
    // Get bounds without scale factor: divide current size by current scale
    const shapeObj = obj as ShapeDisplayObject;
    const scaleX = shapeObj.scaleX ?? 1;
    const scaleY = shapeObj.scaleY ?? 1;
    const bounds = transformedShapeBounds(shapeObj);
    return {
      width: scaleX !== 0 ? bounds.width / scaleX : bounds.width,
      height: scaleY !== 0 ? bounds.height / scaleY : bounds.height,
    };
  }
  if (obj.type === "bitmap" || obj.type === "text") {
    const scaleX = (obj as { scaleX?: number }).scaleX ?? 1;
    const scaleY = (obj as { scaleY?: number }).scaleY ?? 1;
    return {
      width: scaleX !== 0 ? obj.width / scaleX : obj.width,
      height: scaleY !== 0 ? obj.height / scaleY : obj.height,
    };
  }
  return { width: 0, height: 0 };
}

// ---------------------------------------------------------------------------
// Controlled numeric field with blur/Enter commit and Escape revert
// ---------------------------------------------------------------------------

interface NumFieldProps {
  fieldValue: number;
  suffix?: string;
  onCommit: (value: number) => void;
  disabled?: boolean;
}

function NumField({ fieldValue, suffix, onCommit, disabled }: NumFieldProps) {
  const [localStr, setLocalStr] = useState(String(round2(fieldValue)));
  const [focused, setFocused] = useState(false);
  const originalRef = useRef(round2(fieldValue));

  // Sync from outside when not focused
  useEffect(() => {
    if (!focused) {
      const rounded = round2(fieldValue);
      setLocalStr(String(rounded));
      originalRef.current = rounded;
    }
  }, [fieldValue, focused]);

  const commit = useCallback(() => {
    const n = parseFloat(localStr);
    if (!isNaN(n)) {
      onCommit(n);
    } else {
      setLocalStr(String(originalRef.current));
    }
  }, [localStr, onCommit]);

  return (
    <input
      type="number"
      style={focused ? styles.inputFocused : styles.input}
      value={localStr}
      disabled={disabled}
      title={suffix}
      onChange={(e) => setLocalStr(e.target.value)}
      onFocus={() => {
        setFocused(true);
        originalRef.current = round2(fieldValue);
      }}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setLocalStr(String(originalRef.current));
          setFocused(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// TransformPanel
// ---------------------------------------------------------------------------

export function TransformPanel({
  selectedObject,
  onTransform,
}: TransformPanelProps): React.ReactElement {
  const [constrain, setConstrain] = useState(false);

  if (!selectedObject) {
    return (
      <div style={styles.panel}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionLabel}>Transform</span>
        </div>
        <div style={styles.placeholder}>No selection</div>
      </div>
    );
  }

  const obj = selectedObject;
  const x = obj.x;
  const y = obj.y;
  const scaleX = (obj as ShapeDisplayObject).scaleX ?? 1;
  const scaleY = (obj as ShapeDisplayObject).scaleY ?? 1;
  const rotation = (obj as ShapeDisplayObject).rotation ?? 0;
  const skewX = (obj as ShapeDisplayObject).skewX ?? 0;
  const skewY = (obj as ShapeDisplayObject).skewY ?? 0;
  const { width, height } = getObjectSize(obj);
  const rawSize = getRawSize(obj);

  const handleX = (v: number) => onTransform(obj.id, { x: v });
  const handleY = (v: number) => onTransform(obj.id, { y: v });
  const handleRotation = (v: number) => onTransform(obj.id, { rotation: v });
  const handleSkewX = (v: number) => onTransform(obj.id, { skewX: v });
  const handleSkewY = (v: number) => onTransform(obj.id, { skewY: v });

  const handleWidth = (v: number) => {
    if (rawSize.width <= 0) return;
    const newScaleX = v / rawSize.width;
    if (constrain && rawSize.height > 0) {
      const ratio = newScaleX / (scaleX || 1);
      onTransform(obj.id, { scaleX: newScaleX, scaleY: scaleY * ratio });
    } else {
      onTransform(obj.id, { scaleX: newScaleX });
    }
  };

  const handleHeight = (v: number) => {
    if (rawSize.height <= 0) return;
    const newScaleY = v / rawSize.height;
    if (constrain && rawSize.width > 0) {
      const ratio = newScaleY / (scaleY || 1);
      onTransform(obj.id, { scaleX: scaleX * ratio, scaleY: newScaleY });
    } else {
      onTransform(obj.id, { scaleY: newScaleY });
    }
  };

  const handleResetTransform = () => {
    onTransform(obj.id, {
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      skewX: 0,
      skewY: 0,
    });
  };

  const hasSize = width > 0 || height > 0;

  return (
    <div style={styles.panel}>
      <div style={styles.sectionHeader}>
        <span style={styles.sectionLabel}>Transform</span>
      </div>
      <div style={styles.sectionBody}>
        {/* X and Y row */}
        <div style={styles.twoCol}>
          <div style={styles.fieldGroup}>
            <span style={styles.label}>X:</span>
            <NumField fieldValue={x} onCommit={handleX} suffix="px" />
          </div>
          <div style={styles.fieldGroup}>
            <span style={styles.label}>Y:</span>
            <NumField fieldValue={y} onCommit={handleY} suffix="px" />
          </div>
        </div>

        {/* W and H row */}
        {hasSize && (
          <div style={styles.twoCol}>
            <div style={styles.fieldGroup}>
              <span style={styles.label}>W:</span>
              <NumField fieldValue={width} onCommit={handleWidth} suffix="px" />
            </div>
            <div style={styles.fieldGroup}>
              <span style={styles.label}>H:</span>
              <NumField fieldValue={height} onCommit={handleHeight} suffix="px" />
            </div>
          </div>
        )}

        {/* Constrain proportions */}
        {hasSize && (
          <div style={styles.constrainRow}>
            <input
              type="checkbox"
              id="tp-constrain"
              checked={constrain}
              onChange={(e) => setConstrain(e.target.checked)}
              style={{ cursor: "pointer", accentColor: "#1a6ea8" }}
            />
            <label htmlFor="tp-constrain" style={styles.constrainLabel}>
              Constrain proportions
            </label>
          </div>
        )}

        <div style={styles.divider} />

        {/* Rotation */}
        <div style={styles.fieldGroup}>
          <span style={styles.labelWide}>Rotate:</span>
          <NumField fieldValue={rotation} onCommit={handleRotation} suffix="degrees" />
          <span style={{ fontSize: "10px", color: "#666", marginLeft: "2px", flexShrink: 0 }}>deg</span>
        </div>

        {/* Skew H and V row */}
        <div style={styles.twoCol}>
          <div style={styles.fieldGroup}>
            <span style={{ ...styles.label, width: "22px" }}>H:</span>
            <NumField fieldValue={skewX} onCommit={handleSkewX} suffix="skew H (degrees)" />
          </div>
          <div style={styles.fieldGroup}>
            <span style={{ ...styles.label, width: "22px" }}>V:</span>
            <NumField fieldValue={skewY} onCommit={handleSkewY} suffix="skew V (degrees)" />
          </div>
        </div>
        <div style={{ fontSize: "10px", color: "#666", textAlign: "center" }}>skew H / V</div>

        {/* Reset Transform */}
        <button
          style={styles.resetBtn}
          onClick={handleResetTransform}
          title="Reset rotation, scale, and skew to defaults"
        >
          Reset Transform
        </button>
      </div>
    </div>
  );
}

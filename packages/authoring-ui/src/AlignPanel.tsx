/**
 * AlignPanel — Flash 8-style Align panel (Window > Align, Ctrl+K).
 *
 * Provides align, distribute, match-size, and space-evenly operations
 * relative to the selection bounds or the stage bounds.
 */

import React, { useState, useCallback } from "react";
import type { DisplayObject, ShapeDisplayObject, DrawingObject } from "@flash/core";
import { transformedShapeBounds } from "@flash/core";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AlignPanelProps {
  visible: boolean;
  /** All display objects in the active keyframe. */
  displayObjects: readonly DisplayObject[];
  /** IDs of selected objects; if empty, all objects are used. */
  selectedIds: string[];
  stageWidth: number;
  stageHeight: number;
  onAlign: (movedObjects: { id: string; x: number; y: number }[]) => void;
  onMatchSize: (resizedObjects: { id: string; scaleX: number; scaleY: number }[]) => void;
  onClose: () => void;
  /** When true, renders inline (no fixed positioning, no title bar) for use inside a PanelGroup. */
  embedded?: boolean;
}

// ---------------------------------------------------------------------------
// Bounding box helper for any DisplayObject
// ---------------------------------------------------------------------------

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function getObjectBounds(obj: DisplayObject): Bounds {
  switch (obj.type) {
    case "shape":
      return transformedShapeBounds(obj as ShapeDisplayObject);
    case "drawing-object":
      return transformedShapeBounds(obj as DrawingObject);
    case "text":
      return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
    case "bitmap":
      return {
        x: obj.x,
        y: obj.y,
        width: obj.width * (obj.scaleX ?? 1),
        height: obj.height * (obj.scaleY ?? 1),
      };
    case "instance":
      // SymbolInstance: use x/y as origin with a 0-size bbox (best we can do without layout info)
      return { x: obj.x, y: obj.y, width: 0, height: 0 };
    case "group":
      // GroupObject: use x/y as origin with a 0-size bbox (full layout not computed here)
      return { x: obj.x, y: obj.y, width: 0, height: 0 };
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: "80px",
  right: "220px",
  width: "220px",
  background: "#2a2a2a",
  border: "1px solid #555",
  boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
  display: "flex",
  flexDirection: "column",
  zIndex: 1800,
  fontFamily: "Arial, sans-serif",
  fontSize: "11px",
  color: "#d0d0d0",
  borderRadius: "3px",
  overflow: "hidden",
  userSelect: "none",
};

const titleBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  height: "22px",
  background: "#3a3a3a",
  borderBottom: "1px solid #1a1a1a",
  padding: "0 6px",
  flexShrink: 0,
  fontSize: "11px",
  fontWeight: "bold",
  color: "#c0c0c0",
};

const closeBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#999",
  cursor: "pointer",
  fontSize: "13px",
  lineHeight: "1",
  padding: "0 2px",
};

const sectionStyle: React.CSSProperties = {
  padding: "4px 6px",
  borderBottom: "1px solid #1a1a1a",
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: "10px",
  color: "#888",
  marginBottom: "4px",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const btnRowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "row",
  gap: "3px",
  marginBottom: "3px",
};

const toStageRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "5px 6px",
};

// ---------------------------------------------------------------------------
// AlignButton — small icon-style button
// ---------------------------------------------------------------------------

interface AlignButtonProps {
  title: string;
  label: string;
  onClick: () => void;
}

function AlignButton({ title, label, onClick }: AlignButtonProps): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const style: React.CSSProperties = {
    width: "26px",
    height: "22px",
    background: hovered ? "#444" : "#333",
    border: "1px solid " + (hovered ? "#666" : "#444"),
    color: "#d0d0d0",
    cursor: "pointer",
    fontSize: "10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "2px",
    flexShrink: 0,
  };
  return (
    <button
      style={style}
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// AlignPanel
// ---------------------------------------------------------------------------

export function AlignPanel({
  visible,
  displayObjects,
  selectedIds,
  stageWidth,
  stageHeight,
  onAlign,
  onMatchSize,
  onClose,
  embedded = false,
}: AlignPanelProps): React.ReactElement | null {
  const [toStage, setToStage] = useState(false);

  // Determine the working set: selectedIds if any, otherwise all objects
  const workingObjects = useCallback((): DisplayObject[] => {
    if (selectedIds.length > 0) {
      return displayObjects.filter((o) => selectedIds.includes(o.id)) as DisplayObject[];
    }
    return [...displayObjects] as DisplayObject[];
  }, [displayObjects, selectedIds]);

  // Compute reference bounds (stage or selection bounding box)
  const getRefBounds = useCallback((): Bounds => {
    if (toStage) {
      return { x: 0, y: 0, width: stageWidth, height: stageHeight };
    }
    const objs = workingObjects();
    if (objs.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    const boundsArr = objs.map(getObjectBounds);
    const minX = Math.min(...boundsArr.map((b) => b.x));
    const minY = Math.min(...boundsArr.map((b) => b.y));
    const maxX = Math.max(...boundsArr.map((b) => b.x + b.width));
    const maxY = Math.max(...boundsArr.map((b) => b.y + b.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [toStage, stageWidth, stageHeight, workingObjects]);

  // ---------------------------------------------------------------------------
  // Align operations
  // ---------------------------------------------------------------------------

  const alignLeftEdges = useCallback(() => {
    const objs = workingObjects();
    if (objs.length < 1) return;
    const ref = getRefBounds();
    const moved = objs.map((obj) => {
      const b = getObjectBounds(obj);
      const dx = obj.x - b.x; // offset from object origin to left edge
      return { id: obj.id, x: ref.x + dx, y: obj.y };
    });
    onAlign(moved);
  }, [workingObjects, getRefBounds, onAlign]);

  const alignHorizontalCenter = useCallback(() => {
    const objs = workingObjects();
    if (objs.length < 1) return;
    const ref = getRefBounds();
    const refCenterX = ref.x + ref.width / 2;
    const moved = objs.map((obj) => {
      const b = getObjectBounds(obj);
      const dx = obj.x - b.x;
      return { id: obj.id, x: refCenterX - b.width / 2 + dx, y: obj.y };
    });
    onAlign(moved);
  }, [workingObjects, getRefBounds, onAlign]);

  const alignRightEdges = useCallback(() => {
    const objs = workingObjects();
    if (objs.length < 1) return;
    const ref = getRefBounds();
    const refRight = ref.x + ref.width;
    const moved = objs.map((obj) => {
      const b = getObjectBounds(obj);
      const dx = obj.x - b.x;
      return { id: obj.id, x: refRight - b.width + dx, y: obj.y };
    });
    onAlign(moved);
  }, [workingObjects, getRefBounds, onAlign]);

  const alignTopEdges = useCallback(() => {
    const objs = workingObjects();
    if (objs.length < 1) return;
    const ref = getRefBounds();
    const moved = objs.map((obj) => {
      const b = getObjectBounds(obj);
      const dy = obj.y - b.y;
      return { id: obj.id, x: obj.x, y: ref.y + dy };
    });
    onAlign(moved);
  }, [workingObjects, getRefBounds, onAlign]);

  const alignVerticalCenter = useCallback(() => {
    const objs = workingObjects();
    if (objs.length < 1) return;
    const ref = getRefBounds();
    const refCenterY = ref.y + ref.height / 2;
    const moved = objs.map((obj) => {
      const b = getObjectBounds(obj);
      const dy = obj.y - b.y;
      return { id: obj.id, x: obj.x, y: refCenterY - b.height / 2 + dy };
    });
    onAlign(moved);
  }, [workingObjects, getRefBounds, onAlign]);

  const alignBottomEdges = useCallback(() => {
    const objs = workingObjects();
    if (objs.length < 1) return;
    const ref = getRefBounds();
    const refBottom = ref.y + ref.height;
    const moved = objs.map((obj) => {
      const b = getObjectBounds(obj);
      const dy = obj.y - b.y;
      return { id: obj.id, x: obj.x, y: refBottom - b.height + dy };
    });
    onAlign(moved);
  }, [workingObjects, getRefBounds, onAlign]);

  // ---------------------------------------------------------------------------
  // Distribute operations
  // ---------------------------------------------------------------------------

  const distributeLeftEdges = useCallback(() => {
    const objs = workingObjects();
    if (objs.length < 3) return;
    const boundsArr = objs.map((o) => ({ obj: o, b: getObjectBounds(o) }));
    boundsArr.sort((a, b) => a.b.x - b.b.x);
    const minLeft = boundsArr[0].b.x;
    const maxLeft = boundsArr[boundsArr.length - 1].b.x;
    const step = (maxLeft - minLeft) / (boundsArr.length - 1);
    const moved = boundsArr.map(({ obj, b }, i) => {
      const dx = obj.x - b.x;
      return { id: obj.id, x: minLeft + i * step + dx, y: obj.y };
    });
    onAlign(moved);
  }, [workingObjects, onAlign]);

  const distributeHorizontalCenters = useCallback(() => {
    const objs = workingObjects();
    if (objs.length < 3) return;
    const boundsArr = objs.map((o) => ({ obj: o, b: getObjectBounds(o) }));
    boundsArr.sort((a, b) => (a.b.x + a.b.width / 2) - (b.b.x + b.b.width / 2));
    const minCenter = boundsArr[0].b.x + boundsArr[0].b.width / 2;
    const maxCenter = boundsArr[boundsArr.length - 1].b.x + boundsArr[boundsArr.length - 1].b.width / 2;
    const step = (maxCenter - minCenter) / (boundsArr.length - 1);
    const moved = boundsArr.map(({ obj, b }, i) => {
      const targetCenterX = minCenter + i * step;
      const dx = obj.x - b.x;
      return { id: obj.id, x: targetCenterX - b.width / 2 + dx, y: obj.y };
    });
    onAlign(moved);
  }, [workingObjects, onAlign]);

  const distributeRightEdges = useCallback(() => {
    const objs = workingObjects();
    if (objs.length < 3) return;
    const boundsArr = objs.map((o) => ({ obj: o, b: getObjectBounds(o) }));
    boundsArr.sort((a, b) => (a.b.x + a.b.width) - (b.b.x + b.b.width));
    const minRight = boundsArr[0].b.x + boundsArr[0].b.width;
    const maxRight = boundsArr[boundsArr.length - 1].b.x + boundsArr[boundsArr.length - 1].b.width;
    const step = (maxRight - minRight) / (boundsArr.length - 1);
    const moved = boundsArr.map(({ obj, b }, i) => {
      const dx = obj.x - b.x;
      return { id: obj.id, x: minRight + i * step - b.width + dx, y: obj.y };
    });
    onAlign(moved);
  }, [workingObjects, onAlign]);

  const distributeTopEdges = useCallback(() => {
    const objs = workingObjects();
    if (objs.length < 3) return;
    const boundsArr = objs.map((o) => ({ obj: o, b: getObjectBounds(o) }));
    boundsArr.sort((a, b) => a.b.y - b.b.y);
    const minTop = boundsArr[0].b.y;
    const maxTop = boundsArr[boundsArr.length - 1].b.y;
    const step = (maxTop - minTop) / (boundsArr.length - 1);
    const moved = boundsArr.map(({ obj, b }, i) => {
      const dy = obj.y - b.y;
      return { id: obj.id, x: obj.x, y: minTop + i * step + dy };
    });
    onAlign(moved);
  }, [workingObjects, onAlign]);

  const distributeVerticalCenters = useCallback(() => {
    const objs = workingObjects();
    if (objs.length < 3) return;
    const boundsArr = objs.map((o) => ({ obj: o, b: getObjectBounds(o) }));
    boundsArr.sort((a, b) => (a.b.y + a.b.height / 2) - (b.b.y + b.b.height / 2));
    const minCenter = boundsArr[0].b.y + boundsArr[0].b.height / 2;
    const maxCenter = boundsArr[boundsArr.length - 1].b.y + boundsArr[boundsArr.length - 1].b.height / 2;
    const step = (maxCenter - minCenter) / (boundsArr.length - 1);
    const moved = boundsArr.map(({ obj, b }, i) => {
      const targetCenterY = minCenter + i * step;
      const dy = obj.y - b.y;
      return { id: obj.id, x: obj.x, y: targetCenterY - b.height / 2 + dy };
    });
    onAlign(moved);
  }, [workingObjects, onAlign]);

  const distributeBottomEdges = useCallback(() => {
    const objs = workingObjects();
    if (objs.length < 3) return;
    const boundsArr = objs.map((o) => ({ obj: o, b: getObjectBounds(o) }));
    boundsArr.sort((a, b) => (a.b.y + a.b.height) - (b.b.y + b.b.height));
    const minBottom = boundsArr[0].b.y + boundsArr[0].b.height;
    const maxBottom = boundsArr[boundsArr.length - 1].b.y + boundsArr[boundsArr.length - 1].b.height;
    const step = (maxBottom - minBottom) / (boundsArr.length - 1);
    const moved = boundsArr.map(({ obj, b }, i) => {
      const dy = obj.y - b.y;
      return { id: obj.id, x: obj.x, y: minBottom + i * step - b.height + dy };
    });
    onAlign(moved);
  }, [workingObjects, onAlign]);

  // ---------------------------------------------------------------------------
  // Match Size operations
  // ---------------------------------------------------------------------------

  const matchWidth = useCallback(() => {
    const objs = workingObjects();
    if (objs.length < 2) return;
    const boundsArr = objs.map((o) => ({ obj: o, b: getObjectBounds(o) }));
    const maxWidth = Math.max(...boundsArr.map(({ b }) => b.width));
    const resized = boundsArr
      .filter(({ b }) => b.width > 0)
      .map(({ obj, b }) => {
        const currentScaleX = (obj as ShapeDisplayObject).scaleX ?? 1;
        const newScaleX = (maxWidth / b.width) * currentScaleX;
        return {
          id: obj.id,
          scaleX: newScaleX,
          scaleY: (obj as ShapeDisplayObject).scaleY ?? 1,
        };
      });
    onMatchSize(resized);
  }, [workingObjects, onMatchSize]);

  const matchHeight = useCallback(() => {
    const objs = workingObjects();
    if (objs.length < 2) return;
    const boundsArr = objs.map((o) => ({ obj: o, b: getObjectBounds(o) }));
    const maxHeight = Math.max(...boundsArr.map(({ b }) => b.height));
    const resized = boundsArr
      .filter(({ b }) => b.height > 0)
      .map(({ obj, b }) => {
        const currentScaleY = (obj as ShapeDisplayObject).scaleY ?? 1;
        const newScaleY = (maxHeight / b.height) * currentScaleY;
        return {
          id: obj.id,
          scaleX: (obj as ShapeDisplayObject).scaleX ?? 1,
          scaleY: newScaleY,
        };
      });
    onMatchSize(resized);
  }, [workingObjects, onMatchSize]);

  const matchWidthAndHeight = useCallback(() => {
    const objs = workingObjects();
    if (objs.length < 2) return;
    const boundsArr = objs.map((o) => ({ obj: o, b: getObjectBounds(o) }));
    const maxWidth = Math.max(...boundsArr.map(({ b }) => b.width));
    const maxHeight = Math.max(...boundsArr.map(({ b }) => b.height));
    const resized = boundsArr
      .filter(({ b }) => b.width > 0 && b.height > 0)
      .map(({ obj, b }) => {
        const currentScaleX = (obj as ShapeDisplayObject).scaleX ?? 1;
        const currentScaleY = (obj as ShapeDisplayObject).scaleY ?? 1;
        return {
          id: obj.id,
          scaleX: (maxWidth / b.width) * currentScaleX,
          scaleY: (maxHeight / b.height) * currentScaleY,
        };
      });
    onMatchSize(resized);
  }, [workingObjects, onMatchSize]);

  // ---------------------------------------------------------------------------
  // Space Evenly operations
  // ---------------------------------------------------------------------------

  const spaceEvenlyHorizontal = useCallback(() => {
    const objs = workingObjects();
    if (objs.length < 3) return;
    const boundsArr = objs.map((o) => ({ obj: o, b: getObjectBounds(o) }));
    boundsArr.sort((a, b) => a.b.x - b.b.x);
    const minLeft = boundsArr[0].b.x;
    const maxRight = boundsArr[boundsArr.length - 1].b.x + boundsArr[boundsArr.length - 1].b.width;
    const totalWidth = boundsArr.reduce((sum, { b }) => sum + b.width, 0);
    const totalGap = maxRight - minLeft - totalWidth;
    const gap = totalGap / (boundsArr.length - 1);
    let curX = minLeft;
    const moved = boundsArr.map(({ obj, b }) => {
      const dx = obj.x - b.x;
      const newX = curX + dx;
      curX += b.width + gap;
      return { id: obj.id, x: newX, y: obj.y };
    });
    onAlign(moved);
  }, [workingObjects, onAlign]);

  const spaceEvenlyVertical = useCallback(() => {
    const objs = workingObjects();
    if (objs.length < 3) return;
    const boundsArr = objs.map((o) => ({ obj: o, b: getObjectBounds(o) }));
    boundsArr.sort((a, b) => a.b.y - b.b.y);
    const minTop = boundsArr[0].b.y;
    const maxBottom = boundsArr[boundsArr.length - 1].b.y + boundsArr[boundsArr.length - 1].b.height;
    const totalHeight = boundsArr.reduce((sum, { b }) => sum + b.height, 0);
    const totalGap = maxBottom - minTop - totalHeight;
    const gap = totalGap / (boundsArr.length - 1);
    let curY = minTop;
    const moved = boundsArr.map(({ obj, b }) => {
      const dy = obj.y - b.y;
      const newY = curY + dy;
      curY += b.height + gap;
      return { id: obj.id, x: obj.x, y: newY };
    });
    onAlign(moved);
  }, [workingObjects, onAlign]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!visible) return null;

  const containerStyle: React.CSSProperties = embedded
    ? {
        display: "flex",
        flexDirection: "column",
        fontFamily: "Arial, sans-serif",
        fontSize: "11px",
        color: "#d0d0d0",
        userSelect: "none",
      }
    : panelStyle;

  return (
    <div style={containerStyle}>
      {/* Title bar — only shown when floating (not embedded) */}
      {!embedded && (
        <div style={titleBarStyle}>
          <span>Align</span>
          <button style={closeBtnStyle} onClick={onClose} title="Close">
            &#x2715;
          </button>
        </div>
      )}

      {/* Align section */}
      <div style={sectionStyle}>
        <div style={sectionLabelStyle}>Align</div>
        <div style={btnRowStyle}>
          <AlignButton title="Align Left Edges" label="|[" onClick={alignLeftEdges} />
          <AlignButton title="Align Horizontal Center" label="[-" onClick={alignHorizontalCenter} />
          <AlignButton title="Align Right Edges" label="]|" onClick={alignRightEdges} />
        </div>
        <div style={btnRowStyle}>
          <AlignButton title="Align Top Edges" label="T[" onClick={alignTopEdges} />
          <AlignButton title="Align Vertical Center" label="[-" onClick={alignVerticalCenter} />
          <AlignButton title="Align Bottom Edges" label="B[" onClick={alignBottomEdges} />
        </div>
      </div>

      {/* Distribute section */}
      <div style={sectionStyle}>
        <div style={sectionLabelStyle}>Distribute</div>
        <div style={btnRowStyle}>
          <AlignButton title="Distribute Left Edges" label="|--|" onClick={distributeLeftEdges} />
          <AlignButton title="Distribute Horizontal Centers" label="-|-" onClick={distributeHorizontalCenters} />
          <AlignButton title="Distribute Right Edges" label="|--|" onClick={distributeRightEdges} />
        </div>
        <div style={btnRowStyle}>
          <AlignButton title="Distribute Top Edges" label="T-T" onClick={distributeTopEdges} />
          <AlignButton title="Distribute Vertical Centers" label="-+-" onClick={distributeVerticalCenters} />
          <AlignButton title="Distribute Bottom Edges" label="B-B" onClick={distributeBottomEdges} />
        </div>
      </div>

      {/* Match Size section */}
      <div style={sectionStyle}>
        <div style={sectionLabelStyle}>Match Size</div>
        <div style={btnRowStyle}>
          <AlignButton title="Match Width" label="W=" onClick={matchWidth} />
          <AlignButton title="Match Height" label="H=" onClick={matchHeight} />
          <AlignButton title="Match Width and Height" label="WH=" onClick={matchWidthAndHeight} />
        </div>
      </div>

      {/* Space Evenly section */}
      <div style={sectionStyle}>
        <div style={sectionLabelStyle}>Space</div>
        <div style={btnRowStyle}>
          <AlignButton title="Space Evenly Horizontal" label="|=|" onClick={spaceEvenlyHorizontal} />
          <AlignButton title="Space Evenly Vertical" label="-=-" onClick={spaceEvenlyVertical} />
        </div>
      </div>

      {/* To Stage toggle */}
      <div style={toStageRowStyle}>
        <input
          type="checkbox"
          id="alignToStage"
          checked={toStage}
          onChange={(e) => setToStage(e.target.checked)}
          style={{ cursor: "pointer", accentColor: "#1a6ea8" }}
        />
        <label
          htmlFor="alignToStage"
          style={{ cursor: "pointer", fontSize: "11px", color: "#c0c0c0" }}
        >
          To Stage
        </label>
      </div>
    </div>
  );
}

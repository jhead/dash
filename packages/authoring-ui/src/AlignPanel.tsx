/**
 * AlignPanel — Flash 8-style Align panel (Window > Align, Ctrl+K).
 *
 * Provides align, distribute, match-size, and space-evenly operations
 * relative to the selection bounds or the stage bounds.
 */

import React, { useState, useCallback } from "react";
import type { DisplayObject, ShapeDisplayObject, DrawingObject } from "@flash/core";
import { transformedShapeBounds } from "@flash/core";
import { chrome, halo, chromeFont, buttonStyle } from "./theme/flash8Theme.js";

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
      // SymbolInstance: use naturalWidth/naturalHeight when available (populated at placement time)
      return {
        x: obj.x,
        y: obj.y,
        width: (obj.naturalWidth ?? 0) * (obj.scaleX ?? 1),
        height: (obj.naturalHeight ?? 0) * (obj.scaleY ?? 1),
      };
    case "video":
      return {
        x: obj.x,
        y: obj.y,
        width: obj.width * (obj.scaleX ?? 1),
        height: obj.height * (obj.scaleY ?? 1),
      };
    case "group":
      // GroupObject: use x/y as origin with a 0-size bbox (full layout not computed here)
      return { x: obj.x, y: obj.y, width: 0, height: 0 };
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

// Flash 8 "Halo" light theme — tokens from theme/flash8Theme.ts (no hardcoded hex).
// Align panel: #ECECEC chrome, near-black Tahoma text, halo icon buttons,
// #999999 separators. See docs/30-flash8-ui-spec.md + Shell.tsx (reference).
const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: "80px",
  right: "220px",
  width: "220px",
  background: chrome.panelBg,
  border: `1px solid ${chrome.separator}`,
  boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
  display: "flex",
  flexDirection: "column",
  zIndex: 1800,
  ...chromeFont(),
  borderRadius: "3px",
  overflow: "hidden",
  userSelect: "none",
};

const titleBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  height: "22px",
  background: `linear-gradient(${halo.panelHeaderGrad[0]}, ${halo.panelHeaderGrad[1]})`,
  borderBottom: `1px solid ${halo.headerDivider}`,
  padding: "0 6px",
  flexShrink: 0,
  fontSize: "11px",
  fontWeight: "bold",
  color: chrome.textDefault,
};

const closeBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: chrome.textDefault,
  cursor: "pointer",
  fontSize: "13px",
  lineHeight: "1",
  padding: "0 2px",
};

const sectionStyle: React.CSSProperties = {
  padding: "4px 6px",
  borderBottom: `1px solid ${chrome.separator}`,
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: "10px",
  color: chrome.textDisabled,
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
  icon: React.ReactNode;
  onClick: () => void;
}

function AlignButton({ title, icon, onClick }: AlignButtonProps): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const style: React.CSSProperties = {
    ...buttonStyle(hovered ? "over" : "up"),
    // Fixed Halo icon-button box. Override buttonStyle's text padding (2px 8px):
    // a 26px-wide button has only ~10px usable width after 8px side padding, which
    // clipped the multi-glyph icons. Center a fixed-size SVG icon with no padding,
    // box-sizing:border-box (keep the 1px border inside the 26×22 box), and clip any
    // residual overflow defensively.
    boxSizing: "border-box",
    width: "26px",
    height: "22px",
    padding: 0,
    overflow: "hidden",
    color: halo.iconColor,
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
      {icon}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Align icons — crisp inline SVG glyphs (16×16, viewBox-scaled) that fit
// cleanly inside the 26×22 button box. Per docs/30-flash8-ui-spec.md the icon
// glyph colour is halo.iconColor (#2B333C); the alignment guide uses the Halo
// blue accent (halo.haloBlue). Object bars inherit currentColor.
// ---------------------------------------------------------------------------

const ICON_SIZE = 16;
const GUIDE = halo.haloBlue; // alignment guide / reference line accent

function Icon({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 16 16"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block" }}
    >
      {children}
    </svg>
  );
}

// Align: left / hcenter / right edges (guide line + two object bars)
const IconAlignLeft = (
  <Icon>
    <rect x="1" y="1" width="1.5" height="14" fill={GUIDE} />
    <rect x="3.5" y="3" width="9" height="3.5" />
    <rect x="3.5" y="9.5" width="5.5" height="3.5" />
  </Icon>
);
const IconAlignHCenter = (
  <Icon>
    <rect x="7.25" y="1" width="1.5" height="14" fill={GUIDE} />
    <rect x="3.5" y="3" width="9" height="3.5" />
    <rect x="5.25" y="9.5" width="5.5" height="3.5" />
  </Icon>
);
const IconAlignRight = (
  <Icon>
    <rect x="13.5" y="1" width="1.5" height="14" fill={GUIDE} />
    <rect x="3.5" y="3" width="9" height="3.5" />
    <rect x="7" y="9.5" width="5.5" height="3.5" />
  </Icon>
);

// Align: top / vcenter / bottom edges
const IconAlignTop = (
  <Icon>
    <rect x="1" y="1" width="14" height="1.5" fill={GUIDE} />
    <rect x="3" y="3.5" width="3.5" height="9" />
    <rect x="9.5" y="3.5" width="3.5" height="5.5" />
  </Icon>
);
const IconAlignVCenter = (
  <Icon>
    <rect x="1" y="7.25" width="14" height="1.5" fill={GUIDE} />
    <rect x="3" y="3.5" width="3.5" height="9" />
    <rect x="9.5" y="5.25" width="3.5" height="5.5" />
  </Icon>
);
const IconAlignBottom = (
  <Icon>
    <rect x="1" y="13.5" width="14" height="1.5" fill={GUIDE} />
    <rect x="3" y="3.5" width="3.5" height="9" />
    <rect x="9.5" y="7" width="3.5" height="5.5" />
  </Icon>
);

// Distribute: three bars positioned by the distributed edge
const IconDistLeft = (
  <Icon>
    <rect x="1" y="2" width="2" height="12" />
    <rect x="7" y="2" width="2" height="12" />
    <rect x="13" y="2" width="2" height="12" />
  </Icon>
);
const IconDistHCenter = (
  <Icon>
    <rect x="1.5" y="2" width="2" height="12" />
    <rect x="7" y="2" width="2" height="12" />
    <rect x="12.5" y="2" width="2" height="12" />
    <rect x="2" y="7.25" width="12" height="1.5" fill={GUIDE} opacity="0.7" />
  </Icon>
);
const IconDistRight = (
  <Icon>
    <rect x="1" y="2" width="2" height="12" />
    <rect x="7" y="2" width="2" height="12" />
    <rect x="13" y="2" width="2" height="12" />
    <rect x="3" y="2" width="0.75" height="12" fill={GUIDE} />
    <rect x="9" y="2" width="0.75" height="12" fill={GUIDE} />
  </Icon>
);
const IconDistTop = (
  <Icon>
    <rect x="2" y="1" width="12" height="2" />
    <rect x="2" y="7" width="12" height="2" />
    <rect x="2" y="13" width="12" height="2" />
  </Icon>
);
const IconDistVCenter = (
  <Icon>
    <rect x="2" y="1.5" width="12" height="2" />
    <rect x="2" y="7" width="12" height="2" />
    <rect x="2" y="12.5" width="12" height="2" />
    <rect x="7.25" y="2" width="1.5" height="12" fill={GUIDE} opacity="0.7" />
  </Icon>
);
const IconDistBottom = (
  <Icon>
    <rect x="2" y="1" width="12" height="2" />
    <rect x="2" y="7" width="12" height="2" />
    <rect x="2" y="13" width="12" height="2" />
    <rect x="2" y="3" width="12" height="0.75" fill={GUIDE} />
    <rect x="2" y="9" width="12" height="0.75" fill={GUIDE} />
  </Icon>
);

// Match size: a small box growing to a large box, with the matched dimension marked
const IconMatchWidth = (
  <Icon>
    <rect x="1" y="5" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <rect x="8" y="3" width="7" height="10" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <rect x="1" y="14.2" width="14" height="1.4" fill={GUIDE} />
  </Icon>
);
const IconMatchHeight = (
  <Icon>
    <rect x="5" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <rect x="3" y="8" width="10" height="7" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <rect x="0.4" y="1" width="1.4" height="14" fill={GUIDE} />
  </Icon>
);
const IconMatchBoth = (
  <Icon>
    <rect x="1" y="9" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <rect x="7" y="2" width="8" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" />
  </Icon>
);

// Space evenly: bars with explicit equal-gap markers between them
const IconSpaceH = (
  <Icon>
    <rect x="1" y="2" width="3" height="12" />
    <rect x="6.5" y="2" width="3" height="12" />
    <rect x="12" y="2" width="3" height="12" />
    <rect x="4" y="7" width="2.5" height="2" fill={GUIDE} />
    <rect x="9.5" y="7" width="2.5" height="2" fill={GUIDE} />
  </Icon>
);
const IconSpaceV = (
  <Icon>
    <rect x="2" y="1" width="12" height="3" />
    <rect x="2" y="6.5" width="12" height="3" />
    <rect x="2" y="12" width="12" height="3" />
    <rect x="7" y="4" width="2" height="2.5" fill={GUIDE} />
    <rect x="7" y="9.5" width="2" height="2.5" fill={GUIDE} />
  </Icon>
);

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
        ...chromeFont(),
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
          <AlignButton title="Align Left Edges" icon={IconAlignLeft} onClick={alignLeftEdges} />
          <AlignButton title="Align Horizontal Center" icon={IconAlignHCenter} onClick={alignHorizontalCenter} />
          <AlignButton title="Align Right Edges" icon={IconAlignRight} onClick={alignRightEdges} />
        </div>
        <div style={btnRowStyle}>
          <AlignButton title="Align Top Edges" icon={IconAlignTop} onClick={alignTopEdges} />
          <AlignButton title="Align Vertical Center" icon={IconAlignVCenter} onClick={alignVerticalCenter} />
          <AlignButton title="Align Bottom Edges" icon={IconAlignBottom} onClick={alignBottomEdges} />
        </div>
      </div>

      {/* Distribute section */}
      <div style={sectionStyle}>
        <div style={sectionLabelStyle}>Distribute</div>
        <div style={btnRowStyle}>
          <AlignButton title="Distribute Left Edges" icon={IconDistLeft} onClick={distributeLeftEdges} />
          <AlignButton title="Distribute Horizontal Centers" icon={IconDistHCenter} onClick={distributeHorizontalCenters} />
          <AlignButton title="Distribute Right Edges" icon={IconDistRight} onClick={distributeRightEdges} />
        </div>
        <div style={btnRowStyle}>
          <AlignButton title="Distribute Top Edges" icon={IconDistTop} onClick={distributeTopEdges} />
          <AlignButton title="Distribute Vertical Centers" icon={IconDistVCenter} onClick={distributeVerticalCenters} />
          <AlignButton title="Distribute Bottom Edges" icon={IconDistBottom} onClick={distributeBottomEdges} />
        </div>
      </div>

      {/* Match Size section */}
      <div style={sectionStyle}>
        <div style={sectionLabelStyle}>Match Size</div>
        <div style={btnRowStyle}>
          <AlignButton title="Match Width" icon={IconMatchWidth} onClick={matchWidth} />
          <AlignButton title="Match Height" icon={IconMatchHeight} onClick={matchHeight} />
          <AlignButton title="Match Width and Height" icon={IconMatchBoth} onClick={matchWidthAndHeight} />
        </div>
      </div>

      {/* Space Evenly section */}
      <div style={sectionStyle}>
        <div style={sectionLabelStyle}>Space</div>
        <div style={btnRowStyle}>
          <AlignButton title="Space Evenly Horizontal" icon={IconSpaceH} onClick={spaceEvenlyHorizontal} />
          <AlignButton title="Space Evenly Vertical" icon={IconSpaceV} onClick={spaceEvenlyVertical} />
        </div>
      </div>

      {/* To Stage toggle */}
      <div style={toStageRowStyle}>
        <input
          type="checkbox"
          id="alignToStage"
          checked={toStage}
          onChange={(e) => setToStage(e.target.checked)}
          style={{ cursor: "pointer", accentColor: halo.haloBlue }}
        />
        <label
          htmlFor="alignToStage"
          style={{ cursor: "pointer", fontSize: "11px", color: chrome.textDefault }}
        >
          To Stage
        </label>
      </div>
    </div>
  );
}

import React, { useCallback, useRef } from "react";
import { halo } from "./theme/flash8Theme.js";

// ---------------------------------------------------------------------------
// TransformHandles
// ---------------------------------------------------------------------------
// SVG-based transform handle overlay, rendered in stage coordinate space
// (i.e., placed inside the stage container that has CSS zoom/pan applied).
// The SVG uses stage-space coordinates directly — no conversion needed.

export interface TransformBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface TransformHandlesProps {
  /** Bounding box of selected object(s) in stage coordinates */
  bounds: TransformBounds;
  onScale: (scaleX: number, scaleY: number, originX: number, originY: number) => void;
  onRotate: (deltaAngle: number, originX: number, originY: number) => void;
  onMove: (dx: number, dy: number) => void;
  /** Current zoom level — used to keep handle sizes consistent regardless of zoom */
  zoom?: number;
}

type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";

interface HandleDef {
  id: HandleId;
  cx: number;
  cy: number;
}

function computeHandles(b: TransformBounds): HandleDef[] {
  const { x, y, width: w, height: h } = b;
  return [
    { id: "nw", cx: x, cy: y },
    { id: "n", cx: x + w / 2, cy: y },
    { id: "ne", cx: x + w, cy: y },
    { id: "e", cx: x + w, cy: y + h / 2 },
    { id: "se", cx: x + w, cy: y + h },
    { id: "s", cx: x + w / 2, cy: y + h },
    { id: "sw", cx: x, cy: y + h },
    { id: "w", cx: x, cy: y + h / 2 },
  ];
}

const CURSOR_MAP: Record<HandleId, string> = {
  nw: "nw-resize",
  n: "n-resize",
  ne: "ne-resize",
  e: "e-resize",
  se: "se-resize",
  s: "s-resize",
  sw: "sw-resize",
  w: "w-resize",
  rotate: "crosshair",
};

export function TransformHandles({
  bounds,
  onScale,
  onRotate,
  onMove,
  zoom = 1,
}: TransformHandlesProps): React.ReactElement | null {
  if (bounds.width <= 0 && bounds.height <= 0) return null;

  // Handle size in visual pixels — stays constant regardless of zoom by dividing by zoom
  const HS = 6 / zoom; // half-size in stage coordinates

  const { x, y, width: w, height: h } = bounds;
  const handles = computeHandles(bounds);

  // Rotation handle sits above the top-center handle
  const rotHandleOffset = 20 / zoom;
  const rotCx = x + w / 2;
  const rotCy = y - rotHandleOffset;
  const rotRadius = 5 / zoom;

  // Stroke width in stage coordinates (thin at all zoom levels)
  const strokeW = 1 / zoom;

  // ---------------------------------------------------------------------------
  // Drag state refs (no re-render needed mid-drag)
  // ---------------------------------------------------------------------------
  const dragRef = useRef<{
    type: "scale" | "rotate" | "move";
    handle?: HandleId;
    startX: number;
    startY: number;
    origBounds: TransformBounds;
    startAngle?: number;
  } | null>(null);

  const onHandleMouseDown = useCallback(
    (e: React.MouseEvent, handle: HandleId) => {
      e.preventDefault();
      e.stopPropagation();

      if (handle === "rotate") {
        const cx = bounds.x + bounds.width / 2;
        const cy = bounds.y + bounds.height / 2;
        dragRef.current = {
          type: "rotate",
          handle,
          startX: e.clientX,
          startY: e.clientY,
          origBounds: { ...bounds },
          startAngle: Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI),
        };
      } else {
        dragRef.current = {
          type: "scale",
          handle,
          startX: e.clientX,
          startY: e.clientY,
          origBounds: { ...bounds },
        };
      }

      const onMouseMove = (ev: MouseEvent) => {
        const dr = dragRef.current;
        if (!dr) return;

        if (dr.type === "rotate") {
          const ob = dr.origBounds;
          const cx = ob.x + ob.width / 2;
          const cy = ob.y + ob.height / 2;
          const currentAngle = Math.atan2(ev.clientY - cy, ev.clientX - cx) * (180 / Math.PI);
          const delta = currentAngle - (dr.startAngle ?? currentAngle);
          onRotate(delta, cx, cy);
        } else if (dr.type === "scale") {
          // Scale handle: compute new scale based on delta in screen pixels → stage pixels
          const dxScreen = (ev.clientX - dr.startX);
          const dyScreen = (ev.clientY - dr.startY);
          const dxStage = dxScreen / zoom;
          const dyStage = dyScreen / zoom;

          const ob = dr.origBounds;
          const centerX = ob.x + ob.width / 2;
          const centerY = ob.y + ob.height / 2;

          const hid = dr.handle!;
          const isNorth = hid === "nw" || hid === "n" || hid === "ne";
          const isSouth = hid === "se" || hid === "s" || hid === "sw";
          const isWest = hid === "nw" || hid === "sw" || hid === "w";
          const isEast = hid === "ne" || hid === "e" || hid === "se";

          let newScaleX = 1;
          let newScaleY = 1;

          if (isEast) {
            const newHalfW = Math.max(1, ob.width / 2 + dxStage);
            newScaleX = (newHalfW * 2) / Math.max(0.0001, ob.width);
          } else if (isWest) {
            const newHalfW = Math.max(1, ob.width / 2 - dxStage);
            newScaleX = (newHalfW * 2) / Math.max(0.0001, ob.width);
          } else {
            newScaleX = 1;
          }

          if (isSouth) {
            const newHalfH = Math.max(1, ob.height / 2 + dyStage);
            newScaleY = (newHalfH * 2) / Math.max(0.0001, ob.height);
          } else if (isNorth) {
            const newHalfH = Math.max(1, ob.height / 2 - dyStage);
            newScaleY = (newHalfH * 2) / Math.max(0.0001, ob.height);
          } else {
            newScaleY = 1;
          }

          onScale(newScaleX, newScaleY, centerX, centerY);
        }
      };

      const onMouseUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [bounds, zoom, onScale, onRotate]
  );

  const onBoundingBoxMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      dragRef.current = {
        type: "move",
        startX: e.clientX,
        startY: e.clientY,
        origBounds: { ...bounds },
      };

      const onMouseMove = (ev: MouseEvent) => {
        const dr = dragRef.current;
        if (!dr || dr.type !== "move") return;
        const dx = (ev.clientX - dr.startX) / zoom;
        const dy = (ev.clientY - dr.startY) / zoom;
        // Update start so next move is a delta from current position
        dr.startX = ev.clientX;
        dr.startY = ev.clientY;
        onMove(dx, dy);
      };

      const onMouseUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [bounds, zoom, onMove]
  );

  return (
    <svg
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        pointerEvents: "none",
        zIndex: 100,
      }}
    >
      {/* Bounding box rectangle — pointer-events enabled for move drag */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="none"
        stroke={halo.haloBlue}
        strokeWidth={strokeW}
        strokeDasharray={`${4 / zoom} ${2 / zoom}`}
        style={{ pointerEvents: "all", cursor: "move" }}
        onMouseDown={onBoundingBoxMouseDown}
      />

      {/* 8 scale handles */}
      {handles.map((h) => (
        <rect
          key={h.id}
          x={h.cx - HS}
          y={h.cy - HS}
          width={HS * 2}
          height={HS * 2}
          fill="white"
          stroke={halo.haloBlue}
          strokeWidth={strokeW}
          style={{ pointerEvents: "all", cursor: CURSOR_MAP[h.id] }}
          onMouseDown={(e) => onHandleMouseDown(e, h.id)}
        />
      ))}

      {/* Line from top-center to rotation handle */}
      <line
        x1={x + w / 2}
        y1={y}
        x2={rotCx}
        y2={rotCy}
        stroke={halo.haloBlue}
        strokeWidth={strokeW}
        style={{ pointerEvents: "none" }}
      />

      {/* Rotation handle circle */}
      <circle
        cx={rotCx}
        cy={rotCy}
        r={rotRadius}
        fill="white"
        stroke={halo.haloBlue}
        strokeWidth={strokeW}
        style={{ pointerEvents: "all", cursor: "crosshair" }}
        onMouseDown={(e) => onHandleMouseDown(e, "rotate")}
      />
    </svg>
  );
}

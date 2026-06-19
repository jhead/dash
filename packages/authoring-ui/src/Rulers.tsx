import React, { useRef, useEffect, useCallback, useState } from "react";
import type { Guide, RulerUnits } from "@flash/core";
import { chrome, content } from "./theme/flash8Theme.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RulersProps {
  stageWidth: number;
  stageHeight: number;
  zoom: number;
  /** Stage pan offset X (in stage pixels) */
  panX: number;
  /** Stage pan offset Y (in stage pixels) */
  panY: number;
  /** Ruler thickness in px (default 20) */
  rulerSize?: number;
  visible: boolean;
  guides: readonly Guide[];
  /** Unit system to display on ruler ticks (default 'px') */
  rulerUnits?: RulerUnits;
  onGuideCreate: (orientation: "horizontal" | "vertical", position: number) => void;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

// Unit conversion: px per unit
const UNIT_CONVERSION: Record<RulerUnits, number> = {
  px: 1,
  inches: 72,       // 72px per inch (standard screen resolution)
  points: 1,        // 1 point = 1px in this context
  cm: 37.795,       // approx 37.795px per cm at 96dpi
  mm: 3.7795,       // approx 3.7795px per mm at 96dpi
};

function formatUnitLabel(stagePx: number, units: RulerUnits): string {
  const pxPerUnit = UNIT_CONVERSION[units];
  const value = stagePx / pxPerUnit;
  if (units === "px" || units === "points") {
    return String(Math.round(value));
  }
  // Round to 2 decimal places for non-pixel units, strip trailing zeros
  return parseFloat(value.toFixed(2)).toString();
}

/**
 * Draw one ruler axis onto a canvas.
 *
 * @param ctx          2D context
 * @param w            canvas pixel width
 * @param h            canvas pixel height
 * @param axis         "horizontal" draws the top ruler, "vertical" draws the left ruler
 * @param zoom         current zoom factor
 * @param panOffset    panX for horizontal, panY for vertical
 * @param stageSize    stageWidth for horizontal, stageHeight for vertical
 * @param containerSize pixel width of the work-area (for horizontal) or height (vertical)
 * @param rulerUnits   unit system for label display
 */
function drawRuler(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  axis: "horizontal" | "vertical",
  zoom: number,
  panOffset: number,
  stageSize: number,
  containerSize: number,
  rulerSize: number,
  rulerUnits: RulerUnits = "px"
): void {
  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = chrome.insetFieldStrip;
  ctx.fillRect(0, 0, w, h);

  // --- Calculate tick spacing in stage pixels ---
  // We want ticks to stay reasonably spaced on screen.
  // Use major/minor steps based on unit system.
  const pxPerUnit = UNIT_CONVERSION[rulerUnits];
  const minorStepPx = pxPerUnit < 5 ? pxPerUnit * 10 : pxPerUnit; // minor per unit
  const majorStepPx = pxPerUnit < 5 ? pxPerUnit * 50 : pxPerUnit * 5; // major per 5 units or 50px

  // Stage origin in screen space (ruler-canvas-local coordinates):
  // StageArea centers the stage in the FULL container (width = containerSize + rulerSize).
  // The ruler canvas starts at rulerSize px from the left/top of the container.
  // So the full-container center in canvas-local coords = (containerSize + rulerSize)/2 - rulerSize
  //   = containerSize/2 - rulerSize/2
  const containerCenter = containerSize / 2 - rulerSize / 2;
  const stageOriginScreen = containerCenter + panOffset * zoom - (stageSize / 2) * zoom;

  ctx.strokeStyle = chrome.textDefault;
  ctx.fillStyle = chrome.textDefault;
  ctx.font = "9px sans-serif";
  ctx.textAlign = axis === "horizontal" ? "center" : "left";
  ctx.textBaseline = axis === "horizontal" ? "top" : "middle";

  // Find the first minor tick that is visible
  const screenLength = axis === "horizontal" ? w : h;

  // Convert screen start / end to stage pixels
  const screenStart = 0;
  const screenEnd = screenLength;
  const stageStart = (screenStart - stageOriginScreen) / zoom;
  const stageEnd = (screenEnd - stageOriginScreen) / zoom;

  const firstTick = Math.ceil(stageStart / minorStepPx) * minorStepPx;

  for (let stagePx = firstTick; stagePx <= stageEnd; stagePx += minorStepPx) {
    const screenPos = stageOriginScreen + stagePx * zoom;
    if (screenPos < 0 || screenPos > screenLength) continue;

    const isMajor = Math.abs(stagePx % majorStepPx) < 0.01 || Math.abs(stagePx % majorStepPx - majorStepPx) < 0.01;
    const tickLen = isMajor ? 8 : 4;

    ctx.lineWidth = 1;
    ctx.beginPath();
    if (axis === "horizontal") {
      const x = Math.round(screenPos) + 0.5;
      ctx.moveTo(x, h - tickLen);
      ctx.lineTo(x, h);
    } else {
      const y = Math.round(screenPos) + 0.5;
      ctx.moveTo(w - tickLen, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    if (isMajor) {
      const label = formatUnitLabel(stagePx, rulerUnits);
      if (axis === "horizontal") {
        ctx.fillText(label, Math.round(screenPos), 2);
      } else {
        ctx.save();
        ctx.translate(w - 10, Math.round(screenPos));
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center";
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
  }

  // Border
  ctx.strokeStyle = chrome.separator;
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, w, h);
}

// ---------------------------------------------------------------------------
// Rulers component
// ---------------------------------------------------------------------------

export function Rulers({
  stageWidth,
  stageHeight,
  zoom,
  panX,
  panY,
  rulerSize = 20,
  visible,
  guides,
  rulerUnits = "px",
  onGuideCreate,
}: RulersProps): React.ReactElement | null {
  const hRulerRef = useRef<HTMLCanvasElement>(null);
  const vRulerRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track container dimensions for ruler drawing
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Guide being dragged out from a ruler
  const dragRef = useRef<{
    orientation: "horizontal" | "vertical";
    previewPos: number; // screen position
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    orientation: "horizontal" | "vertical";
    screenPos: number;
  } | null>(null);

  // Observe container size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
        setContainerHeight(entry.contentRect.height);
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Redraw horizontal ruler
  useEffect(() => {
    const canvas = hRulerRef.current;
    if (!canvas || containerWidth === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawRuler(ctx, canvas.width, canvas.height, "horizontal", zoom, panX, stageWidth, containerWidth - rulerSize, rulerSize, rulerUnits);
  }, [zoom, panX, stageWidth, containerWidth, rulerSize, rulerUnits]);

  // Redraw vertical ruler
  useEffect(() => {
    const canvas = vRulerRef.current;
    if (!canvas || containerHeight === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawRuler(ctx, canvas.width, canvas.height, "vertical", zoom, panY, stageHeight, containerHeight - rulerSize, rulerSize, rulerUnits);
  }, [zoom, panY, stageHeight, containerHeight, rulerSize, rulerUnits]);

  // ---------------------------------------------------------------------------
  // Drag from ruler to create a guide
  // ---------------------------------------------------------------------------

  const onHRulerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      dragRef.current = { orientation: "horizontal", previewPos: e.clientY };
      setDragPreview({ orientation: "horizontal", screenPos: e.clientY });
    },
    []
  );

  const onVRulerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      dragRef.current = { orientation: "vertical", previewPos: e.clientX };
      setDragPreview({ orientation: "vertical", screenPos: e.clientX });
    },
    []
  );

  // Global mouse move / up handlers while dragging from a ruler
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current) return;
      const pos = dragRef.current.orientation === "horizontal" ? e.clientY : e.clientX;
      dragRef.current.previewPos = pos;
      setDragPreview({ orientation: dragRef.current.orientation, screenPos: pos });
    }

    function onMouseUp(e: MouseEvent) {
      if (!dragRef.current) return;
      const { orientation } = dragRef.current;
      dragRef.current = null;
      setDragPreview(null);

      // Convert screen position to stage coordinate
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      // StageArea centers the stage in the full container (not offset by rulerSize)
      const containerCenterX = rect.left + rect.width / 2;
      const containerCenterY = rect.top + rect.height / 2;
      const stageOriginX = containerCenterX + panX * zoom - (stageWidth / 2) * zoom;
      const stageOriginY = containerCenterY + panY * zoom - (stageHeight / 2) * zoom;

      let stagePos: number;
      if (orientation === "horizontal") {
        stagePos = (e.clientY - stageOriginY) / zoom;
      } else {
        stagePos = (e.clientX - stageOriginX) / zoom;
      }

      // Only create the guide if dropped within the stage area
      const withinStage =
        orientation === "horizontal"
          ? stagePos >= 0 && stagePos <= stageHeight
          : stagePos >= 0 && stagePos <= stageWidth;

      if (withinStage) {
        onGuideCreate(orientation, Math.round(stagePos));
      }
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [zoom, panX, panY, stageWidth, stageHeight, rulerSize, onGuideCreate]);

  if (!visible) return null;

  // Compute canvas sizes — we update them based on container
  const hCanvasWidth = Math.max(1, containerWidth - rulerSize);
  const hCanvasHeight = rulerSize;
  const vCanvasWidth = rulerSize;
  const vCanvasHeight = Math.max(1, containerHeight - rulerSize);

  // Preview line screen pos relative to container
  const previewScreenPos = dragPreview
    ? dragPreview.orientation === "horizontal"
      ? dragPreview.screenPos - (containerRef.current?.getBoundingClientRect().top ?? 0)
      : dragPreview.screenPos - (containerRef.current?.getBoundingClientRect().left ?? 0)
    : null;

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 50,
      }}
    >
      {/* Corner square */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: rulerSize,
          height: rulerSize,
          background: chrome.insetFieldStrip,
          borderRight: `1px solid ${chrome.separator}`,
          borderBottom: `1px solid ${chrome.separator}`,
          pointerEvents: "auto",
          zIndex: 51,
        }}
      />

      {/* Horizontal ruler */}
      <canvas
        ref={hRulerRef}
        width={hCanvasWidth}
        height={hCanvasHeight}
        style={{
          position: "absolute",
          top: 0,
          left: rulerSize,
          cursor: "s-resize",
          pointerEvents: "auto",
          zIndex: 51,
          display: "block",
        }}
        onMouseDown={onHRulerMouseDown}
      />

      {/* Vertical ruler */}
      <canvas
        ref={vRulerRef}
        width={vCanvasWidth}
        height={vCanvasHeight}
        style={{
          position: "absolute",
          top: rulerSize,
          left: 0,
          cursor: "e-resize",
          pointerEvents: "auto",
          zIndex: 51,
          display: "block",
        }}
        onMouseDown={onVRulerMouseDown}
      />

      {/* Drag preview line */}
      {dragPreview && previewScreenPos !== null && (
        <div
          style={{
            position: "absolute",
            ...(dragPreview.orientation === "horizontal"
              ? {
                  top: previewScreenPos,
                  left: rulerSize,
                  right: 0,
                  height: 1,
                  background: content.guide,
                  opacity: 0.8,
                }
              : {
                  left: previewScreenPos,
                  top: rulerSize,
                  bottom: 0,
                  width: 1,
                  background: content.guide,
                  opacity: 0.8,
                }),
            pointerEvents: "none",
            zIndex: 52,
          }}
        />
      )}

      {/* Guide tick marks on rulers */}
      {guides.map((guide) => {
        if (guide.orientation === "vertical") {
          // Vertical guide → mark on horizontal ruler
          // StageArea centers stage in the full containerWidth; translate to ruler-relative coords
          const stageOriginScreen =
            containerWidth / 2 + panX * zoom - (stageWidth / 2) * zoom;
          const screenX = stageOriginScreen + guide.position * zoom;
          if (screenX < rulerSize || screenX > containerWidth) return null;
          return (
            <div
              key={guide.id}
              style={{
                position: "absolute",
                top: 0,
                left: screenX,
                width: 1,
                height: rulerSize,
                background: content.guide,
                pointerEvents: "none",
                zIndex: 52,
              }}
            />
          );
        } else {
          // Horizontal guide → mark on vertical ruler
          const stageOriginScreen =
            containerHeight / 2 + panY * zoom - (stageHeight / 2) * zoom;
          const screenY = stageOriginScreen + guide.position * zoom;
          if (screenY < rulerSize || screenY > containerHeight) return null;
          return (
            <div
              key={guide.id}
              style={{
                position: "absolute",
                left: 0,
                top: screenY,
                width: rulerSize,
                height: 1,
                background: content.guide,
                pointerEvents: "none",
                zIndex: 52,
              }}
            />
          );
        }
      })}
    </div>
  );
}

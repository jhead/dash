/**
 * Flash 8-style Custom Ease dialog.
 *
 * Renders a modal with a 200×200 canvas showing a cubic Bézier ease curve.
 * The two interior control-point handles are draggable.  Preset curves are
 * available from a drop-down.  The dialog calls onConfirm({ x1,y1,x2,y2 })
 * on OK and onClose on Cancel.
 *
 * Coordinate convention (matches CSS cubic-bezier):
 *   P0 = (0,0)  — implicit start (bottom-left in canvas)
 *   P1 = (x1,y1) — first handle
 *   P2 = (x2,y2) — second handle
 *   P3 = (1,1)  — implicit end (top-right in canvas)
 *
 * The canvas is drawn with time (X) running left→right and progress (Y)
 * running bottom→top.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { EaseCurve } from "@flash/core";
import {
  chrome,
  halo,
  chromeFont,
  buttonStyle,
  type ButtonState,
} from "./theme/flash8Theme.js";

/** A Halo-skinned button that tracks its own hover/press state. */
function DialogButton({
  children,
  onClick,
  primary = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}): React.ReactElement {
  const [state, setState] = useState<ButtonState>("up");
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setState("over")}
      onMouseLeave={() => setState("up")}
      onMouseDown={() => setState("down")}
      onMouseUp={() => setState("over")}
      style={{
        ...buttonStyle(state),
        ...(primary ? { color: chrome.textDefault, fontWeight: "bold" } : {}),
        padding: "3px 14px",
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EaseCurveDialogProps {
  /** Initial curve to show when the dialog opens. */
  initialCurve: EaseCurve;
  /** Called with the new curve when the user clicks OK. */
  onConfirm: (curve: EaseCurve) => void;
  /** Called when the dialog should close (OK or Cancel). */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

interface Preset {
  label: string;
  curve: EaseCurve;
}

const PRESETS: Preset[] = [
  { label: "Linear",      curve: { x1: 0.0, y1: 0.0, x2: 1.0, y2: 1.0 } },
  { label: "Ease In",     curve: { x1: 0.42, y1: 0.0, x2: 1.0, y2: 1.0 } },
  { label: "Ease Out",    curve: { x1: 0.0, y1: 0.0, x2: 0.58, y2: 1.0 } },
  { label: "Ease In-Out", curve: { x1: 0.42, y1: 0.0, x2: 0.58, y2: 1.0 } },
];

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

const CANVAS_SIZE = 200;  // px
const PADDING = 20;       // px — margin inside the canvas for labels/handles
const GRID_SIZE = CANVAS_SIZE - PADDING * 2; // usable inner area

/** Map a normalised [0,1] curve value to a canvas pixel coordinate. */
function toCanvas(nx: number, ny: number): [number, number] {
  const cx = PADDING + nx * GRID_SIZE;
  // Y is inverted: ny=0 → bottom, ny=1 → top
  const cy = CANVAS_SIZE - PADDING - ny * GRID_SIZE;
  return [cx, cy];
}

/** Map a canvas pixel coordinate back to normalised [0,1] space. */
function fromCanvas(cx: number, cy: number): [number, number] {
  const nx = (cx - PADDING) / GRID_SIZE;
  const ny = (CANVAS_SIZE - PADDING - cy) / GRID_SIZE;
  return [nx, ny];
}

/** Draw the ease curve onto the canvas. */
function drawCurve(
  ctx: CanvasRenderingContext2D,
  curve: EaseCurve,
  activeHandle: 0 | 1 | null,
): void {
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Background — white content area (Flash 8 light theme).
  ctx.fillStyle = halo.panelContentBg; // #FFFFFF
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Grid lines — light gray, readable on white.
  ctx.strokeStyle = "#CCCCCC";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const [gx1] = toCanvas(t, 0);
    const [, gy1] = toCanvas(0, t);
    const [gx2] = toCanvas(t, 1);
    const [, gy2] = toCanvas(1, t);
    // Vertical
    ctx.beginPath();
    ctx.moveTo(gx1, PADDING);
    ctx.lineTo(gx2, CANVAS_SIZE - PADDING);
    ctx.stroke();
    // Horizontal
    ctx.beginPath();
    ctx.moveTo(PADDING, gy1);
    ctx.lineTo(CANVAS_SIZE - PADDING, gy2);
    ctx.stroke();
  }

  // Diagonal reference line (linear) — medium gray, readable on white.
  ctx.strokeStyle = chrome.separator; // #999999
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  const [lx0, ly0] = toCanvas(0, 0);
  const [lx1, ly1] = toCanvas(1, 1);
  ctx.moveTo(lx0, ly0);
  ctx.lineTo(lx1, ly1);
  ctx.stroke();
  ctx.setLineDash([]);

  // Control point stems — medium gray.
  ctx.strokeStyle = chrome.bevelDark; // #808080
  ctx.lineWidth = 1;
  const [p0x, p0y] = toCanvas(0, 0);
  const [p1x, p1y] = toCanvas(curve.x1, curve.y1);
  const [p2x, p2y] = toCanvas(curve.x2, curve.y2);
  const [p3x, p3y] = toCanvas(1, 1);

  ctx.beginPath();
  ctx.moveTo(p0x, p0y);
  ctx.lineTo(p1x, p1y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(p3x, p3y);
  ctx.lineTo(p2x, p2y);
  ctx.stroke();

  // Bézier curve — Halo accent blue.
  ctx.strokeStyle = halo.haloBlue; // #009DFF
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p0x, p0y);
  ctx.bezierCurveTo(p1x, p1y, p2x, p2y, p3x, p3y);
  ctx.stroke();

  // Implicit endpoints — near-black so they read on white.
  ctx.fillStyle = chrome.bevelDark; // #808080
  ctx.beginPath();
  ctx.arc(p0x, p0y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(p3x, p3y, 4, 0, Math.PI * 2);
  ctx.fill();

  // Control handles — Halo blue, with a contrasting highlight when active.
  const handle1Color = activeHandle === 0 ? "#FF6600" : halo.haloBlue;
  const handle2Color = activeHandle === 1 ? "#FF6600" : halo.haloBlue;

  ctx.fillStyle = handle1Color;
  ctx.beginPath();
  ctx.arc(p1x, p1y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = chrome.textDefault; // dark outline reads on white
  ctx.lineWidth = 0.75;
  ctx.stroke();

  ctx.fillStyle = handle2Color;
  ctx.beginPath();
  ctx.arc(p2x, p2y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = chrome.textDefault;
  ctx.lineWidth = 0.75;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const HANDLE_RADIUS = 8; // hit radius in px

export function EaseCurveDialog({ initialCurve, onConfirm, onClose }: EaseCurveDialogProps): React.ReactElement {
  const [curve, setCurve] = useState<EaseCurve>(initialCurve);
  const [activeHandle, setActiveHandle] = useState<0 | 1 | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef<0 | 1 | null>(null);
  const curveRef = useRef<EaseCurve>(curve);

  // Keep ref in sync with state
  curveRef.current = curve;

  // Redraw when curve or active handle changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawCurve(ctx, curve, activeHandle);
  }, [curve, activeHandle]);

  // Mouse helpers
  const canvasCoords = useCallback((e: MouseEvent | React.MouseEvent): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }, []);

  const hitTestHandle = useCallback((cx: number, cy: number): 0 | 1 | null => {
    const c = curveRef.current;
    const [h1x, h1y] = toCanvas(c.x1, c.y1);
    const [h2x, h2y] = toCanvas(c.x2, c.y2);
    if (Math.hypot(cx - h1x, cy - h1y) <= HANDLE_RADIUS) return 0;
    if (Math.hypot(cx - h2x, cy - h2y) <= HANDLE_RADIUS) return 1;
    return null;
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const [cx, cy] = canvasCoords(e);
    const hit = hitTestHandle(cx, cy);
    if (hit !== null) {
      draggingRef.current = hit;
      setActiveHandle(hit);
      e.preventDefault();
    }
  }, [canvasCoords, hitTestHandle]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (draggingRef.current === null) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const [nx, ny] = fromCanvas(cx, cy);
      // Clamp X to [0,1]; Y is unconstrained (allows overshoot)
      const clampedX = Math.max(0, Math.min(1, nx));
      const h = draggingRef.current;
      setCurve((prev) => {
        if (h === 0) return { ...prev, x1: clampedX, y1: ny };
        return { ...prev, x2: clampedX, y2: ny };
      });
    };
    const onUp = () => {
      if (draggingRef.current !== null) {
        draggingRef.current = null;
        setActiveHandle(null);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const onPresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = Number(e.target.value);
    if (idx >= 0 && idx < PRESETS.length) {
      setCurve(PRESETS[idx].curve);
    }
  };

  const handleOk = () => {
    onConfirm(curveRef.current);
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3000,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: chrome.panelBg,
          border: `1px solid ${chrome.separator}`,
          boxShadow: "4px 4px 16px rgba(0,0,0,0.4)",
          ...chromeFont(),
          userSelect: "none",
          minWidth: 280,
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: chrome.panelBg,
            borderBottom: `1px solid ${chrome.separator}`,
            padding: "4px 6px",
          }}
        >
          <span style={{ fontWeight: "bold", fontSize: 11 }}>Custom Ease In/Out</span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: `1px solid ${halo.borderColor}`,
              color: chrome.textDefault,
              cursor: "pointer",
              fontSize: 11,
              padding: "1px 5px",
              lineHeight: "14px",
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: halo.panelContentBg,
          }}
        >
          {/* Preset selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: chrome.textDefault }}>Preset:</span>
            <select
              defaultValue={-1}
              onChange={onPresetChange}
              style={{
                fontSize: 11,
                background: halo.inputBg,
                color: halo.text,
                border: `1px solid ${halo.inputBorder}`,
                padding: "1px 4px",
                borderRadius: 2,
                outline: "none",
              }}
            >
              <option value={-1} disabled>— choose —</option>
              {PRESETS.map((p, i) => (
                <option key={p.label} value={i}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* Canvas */}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <canvas
              ref={canvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              style={{
                cursor: "crosshair",
                border: `1px solid ${halo.inputBorder}`,
                display: "block",
              }}
              onMouseDown={onMouseDown}
            />
          </div>

          {/* Coordinate readout */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
              fontSize: 10,
              color: chrome.textDefault,
            }}
          >
            <div>
              <span style={{ color: halo.haloBlue }}>Handle 1:</span>{" "}
              ({curve.x1.toFixed(3)}, {curve.y1.toFixed(3)})
            </div>
            <div>
              <span style={{ color: halo.haloBlue }}>Handle 2:</span>{" "}
              ({curve.x2.toFixed(3)}, {curve.y2.toFixed(3)})
            </div>
          </div>

          {/* Instructions */}
          <div style={{ fontSize: 10, color: chrome.textDisabled, textAlign: "center" }}>
            Drag the handles to shape the curve.
          </div>

          {/* OK / Cancel buttons */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 4 }}>
            <DialogButton onClick={onClose}>Cancel</DialogButton>
            <DialogButton onClick={handleOk} primary>OK</DialogButton>
          </div>
        </div>
      </div>
    </div>
  );
}

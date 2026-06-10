/**
 * Sound Envelope Edit dialog — Flash 8 style.
 *
 * Shows a 400×120 canvas with:
 *   - A grey waveform bar (placeholder — no decoded PCM needed)
 *   - Draggable In/Out point vertical markers
 *   - Two independent volume curves (Left + Right channel) each with
 *     draggable amplitude nodes
 *
 * Coordinate convention:
 *   X axis → time (sample 0 at left, totalSamples at right)
 *   Y axis → amplitude 0-100 % (top = 100%, bottom = 0%)
 *
 * SWF levels are 0-32768; we display as 0-100% and convert on OK.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SoundEnvelopePoint } from "@flash/core";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EnvelopeState {
  inPoint: number;   // sample index (0 = start)
  outPoint: number;  // sample index (totalSamples = end)
  /** Left-channel amplitude nodes: [t, level] where t ∈ [0,1], level ∈ [0,1] */
  leftNodes: Array<[number, number]>;
  /** Right-channel amplitude nodes */
  rightNodes: Array<[number, number]>;
}

export interface SoundEnvelopeEditDialogProps {
  /** Total sample count of the sound (at 44100 Hz). Used for in/out range. */
  totalSamples: number;
  /** Initial envelope state. */
  initial: EnvelopeState;
  /** Called with the confirmed envelope. */
  onConfirm: (result: {
    inPoint: number;
    outPoint: number;
    customEnvelope: SoundEnvelopePoint[];
  }) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Canvas geometry
// ---------------------------------------------------------------------------

const CW = 400;  // canvas width
const CH = 120;  // canvas height
const PAD_L = 32; // left padding (time labels)
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 20; // bottom padding (channel label)
const INNER_W = CW - PAD_L - PAD_R;
const INNER_H = (CH - PAD_T - PAD_B) / 2 - 4; // half height per channel minus gap

const NODE_R = 5; // node hit radius in px

/** Convert normalised [0,1] t to canvas X */
function tToX(t: number): number {
  return PAD_L + t * INNER_W;
}

/** Convert canvas X to normalised [0,1] t */
function xToT(x: number): number {
  return Math.max(0, Math.min(1, (x - PAD_L) / INNER_W));
}

/** Convert amplitude [0,1] to canvas Y for a channel band starting at yTop */
function ampToY(amp: number, yTop: number): number {
  return yTop + INNER_H - amp * INNER_H;
}

/** Convert canvas Y to amplitude [0,1] within a channel band starting at yTop */
function yToAmp(y: number, yTop: number): number {
  return Math.max(0, Math.min(1, (yTop + INNER_H - y) / INNER_H));
}

// Top Y of each channel band
const LEFT_TOP = PAD_T;
const RIGHT_TOP = PAD_T + INNER_H + 8;

// ---------------------------------------------------------------------------
// Default envelope factory
// ---------------------------------------------------------------------------

export function defaultEnvelope(totalSamples: number): EnvelopeState {
  return {
    inPoint: 0,
    outPoint: totalSamples,
    leftNodes: [[0, 1], [1, 1]],
    rightNodes: [[0, 1], [1, 1]],
  };
}

/** Convert the EnvelopeState to SoundEnvelopePoint[] for the SWF encoder. */
export function envelopeToPoints(
  state: EnvelopeState,
  totalSamples: number,
): SoundEnvelopePoint[] {
  // Merge left + right nodes by their normalised time into joint sample positions
  // We emit one point per unique time position, covering both channels.
  const times = new Set<number>();
  for (const [t] of state.leftNodes) times.add(t);
  for (const [t] of state.rightNodes) times.add(t);
  const sorted = Array.from(times).sort((a, b) => a - b);

  // Interpolate amplitude at a given t for a set of nodes (linear)
  function interpAmp(nodes: Array<[number, number]>, t: number): number {
    if (nodes.length === 0) return 1;
    if (t <= nodes[0][0]) return nodes[0][1];
    if (t >= nodes[nodes.length - 1][0]) return nodes[nodes.length - 1][1];
    for (let i = 0; i < nodes.length - 1; i++) {
      const [t0, v0] = nodes[i];
      const [t1, v1] = nodes[i + 1];
      if (t >= t0 && t <= t1) {
        const frac = (t - t0) / (t1 - t0);
        return v0 + (v1 - v0) * frac;
      }
    }
    return 1;
  }

  return sorted.map((t) => ({
    pos44: Math.round(t * totalSamples),
    leftLevel: Math.round(interpAmp(state.leftNodes, t) * 32768),
    rightLevel: Math.round(interpAmp(state.rightNodes, t) * 32768),
  }));
}

// ---------------------------------------------------------------------------
// Draw helpers
// ---------------------------------------------------------------------------

interface DrawState {
  inPoint: number;
  outPoint: number;
  leftNodes: Array<[number, number]>;
  rightNodes: Array<[number, number]>;
  activeItem: ActiveItem | null;
}

type ActiveItem =
  | { kind: "in" }
  | { kind: "out" }
  | { kind: "node"; channel: "left" | "right"; index: number };

function drawCanvas(ctx: CanvasRenderingContext2D, s: DrawState): void {
  ctx.clearRect(0, 0, CW, CH);

  // Background
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, CW, CH);

  // Channel bands background
  ctx.fillStyle = "#252525";
  ctx.fillRect(PAD_L, LEFT_TOP, INNER_W, INNER_H);
  ctx.fillRect(PAD_L, RIGHT_TOP, INNER_W, INNER_H);

  // Channel labels
  ctx.fillStyle = "#666";
  ctx.font = "9px Tahoma, Arial, sans-serif";
  ctx.fillText("L", PAD_L - 18, LEFT_TOP + INNER_H / 2 + 3);
  ctx.fillText("R", PAD_L - 18, RIGHT_TOP + INNER_H / 2 + 3);

  // Waveform placeholder (simple grey fill)
  ctx.fillStyle = "#383838";
  ctx.fillRect(PAD_L + 1, LEFT_TOP + 2, INNER_W - 2, INNER_H - 4);
  ctx.fillRect(PAD_L + 1, RIGHT_TOP + 2, INNER_W - 2, INNER_H - 4);

  // In/out dimming
  const inX = tToX(s.inPoint);
  const outX = tToX(s.outPoint);
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  // Before in-point
  if (inX > PAD_L) {
    ctx.fillRect(PAD_L, LEFT_TOP, inX - PAD_L, INNER_H);
    ctx.fillRect(PAD_L, RIGHT_TOP, inX - PAD_L, INNER_H);
  }
  // After out-point
  if (outX < PAD_L + INNER_W) {
    ctx.fillRect(outX, LEFT_TOP, PAD_L + INNER_W - outX, INNER_H);
    ctx.fillRect(outX, RIGHT_TOP, PAD_L + INNER_W - outX, INNER_H);
  }

  // Grid lines (25%, 50%, 75% amplitude)
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  for (const amp of [0.25, 0.5, 0.75]) {
    const lyL = ampToY(amp, LEFT_TOP);
    const lyR = ampToY(amp, RIGHT_TOP);
    ctx.beginPath(); ctx.moveTo(PAD_L, lyL); ctx.lineTo(PAD_L + INNER_W, lyL); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PAD_L, lyR); ctx.lineTo(PAD_L + INNER_W, lyR); ctx.stroke();
  }
  ctx.setLineDash([]);

  // Draw envelope curve for each channel
  function drawCurve(nodes: Array<[number, number]>, yTop: number, color: string): void {
    if (nodes.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < nodes.length; i++) {
      const [t, amp] = nodes[i];
      const x = tToX(t);
      const y = ampToY(amp, yTop);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  drawCurve(s.leftNodes, LEFT_TOP, "#44aaff");
  drawCurve(s.rightNodes, RIGHT_TOP, "#44aaff");

  // Draw envelope nodes
  function drawNodes(
    nodes: Array<[number, number]>,
    yTop: number,
    channel: "left" | "right",
  ): void {
    nodes.forEach(([t, amp], i) => {
      const x = tToX(t);
      const y = ampToY(amp, yTop);
      const isActive =
        s.activeItem?.kind === "node" &&
        s.activeItem.channel === channel &&
        s.activeItem.index === i;
      ctx.beginPath();
      ctx.arc(x, y, NODE_R, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? "#ffdd00" : "#0099ff";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    });
  }

  drawNodes(s.leftNodes, LEFT_TOP, "left");
  drawNodes(s.rightNodes, RIGHT_TOP, "right");

  // In-point marker
  const inActive = s.activeItem?.kind === "in";
  ctx.strokeStyle = inActive ? "#ffdd00" : "#00ff88";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(inX, PAD_T);
  ctx.lineTo(inX, PAD_T + INNER_H * 2 + 8);
  ctx.stroke();
  // Triangle top indicator
  ctx.fillStyle = inActive ? "#ffdd00" : "#00ff88";
  ctx.beginPath();
  ctx.moveTo(inX, PAD_T);
  ctx.lineTo(inX + 6, PAD_T - 5);
  ctx.lineTo(inX - 6, PAD_T - 5);
  ctx.closePath();
  ctx.fill();

  // Out-point marker
  const outActive = s.activeItem?.kind === "out";
  ctx.strokeStyle = outActive ? "#ffdd00" : "#ff6633";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(outX, PAD_T);
  ctx.lineTo(outX, PAD_T + INNER_H * 2 + 8);
  ctx.stroke();
  ctx.fillStyle = outActive ? "#ffdd00" : "#ff6633";
  ctx.beginPath();
  ctx.moveTo(outX, PAD_T);
  ctx.lineTo(outX + 6, PAD_T - 5);
  ctx.lineTo(outX - 6, PAD_T - 5);
  ctx.closePath();
  ctx.fill();

  // Bottom label
  ctx.fillStyle = "#555";
  ctx.font = "9px Tahoma, Arial, sans-serif";
  ctx.fillText("In", inX + 2, CH - 5);
  ctx.fillText("Out", outX + 2, CH - 5);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const MARKER_HIT = 8; // px hit width for in/out markers

export function SoundEnvelopeEditDialog({
  totalSamples,
  initial,
  onConfirm,
  onClose,
}: SoundEnvelopeEditDialogProps): React.ReactElement {
  const safe = totalSamples > 0 ? totalSamples : 44100;

  // Normalise initial state to [0,1] t
  const [state, setState] = useState<DrawState>(() => {
    const inT = initial.inPoint / safe;
    const outT = initial.outPoint / safe;
    return {
      inPoint: Math.max(0, Math.min(1, inT)),
      outPoint: Math.max(0, Math.min(1, outT)),
      leftNodes: initial.leftNodes.slice(),
      rightNodes: initial.rightNodes.slice(),
      activeItem: null,
    };
  });

  const stateRef = useRef<DrawState>(state);
  stateRef.current = state;

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Redraw when state changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawCanvas(ctx, state);
  }, [state]);

  // ---- hit testing --------------------------------------------------------

  const hitTest = useCallback(
    (cx: number, cy: number): ActiveItem | null => {
      const s = stateRef.current;

      // Check in/out markers first (vertical lines — hit by X proximity)
      const inX = tToX(s.inPoint);
      const outX = tToX(s.outPoint);
      if (Math.abs(cx - inX) <= MARKER_HIT) return { kind: "in" };
      if (Math.abs(cx - outX) <= MARKER_HIT) return { kind: "out" };

      // Check envelope nodes
      for (const channel of ["left", "right"] as const) {
        const nodes = channel === "left" ? s.leftNodes : s.rightNodes;
        const yTop = channel === "left" ? LEFT_TOP : RIGHT_TOP;
        for (let i = 0; i < nodes.length; i++) {
          const [t, amp] = nodes[i];
          const nx = tToX(t);
          const ny = ampToY(amp, yTop);
          if (Math.hypot(cx - nx, cy - ny) <= NODE_R + 3) {
            return { kind: "node", channel, index: i };
          }
        }
      }
      return null;
    },
    [],
  );

  const getCanvasXY = useCallback(
    (e: MouseEvent | React.MouseEvent): [number, number] => {
      const canvas = canvasRef.current;
      if (!canvas) return [0, 0];
      const rect = canvas.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top];
    },
    [],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const [cx, cy] = getCanvasXY(e);
      const hit = hitTest(cx, cy);
      if (hit) {
        setState((prev) => ({ ...prev, activeItem: hit }));
        e.preventDefault();
        return;
      }
      // Double-click adds a new node; single click on band adds node too
      // Determine which channel band was clicked
      if (cy >= LEFT_TOP && cy <= LEFT_TOP + INNER_H) {
        const t = xToT(cx);
        const amp = yToAmp(cy, LEFT_TOP);
        setState((prev) => {
          const nodes = insertNode(prev.leftNodes, t, amp);
          const idx = nodes.findIndex(([nt]) => nt === t);
          return {
            ...prev,
            leftNodes: nodes,
            activeItem: { kind: "node", channel: "left", index: idx },
          };
        });
        e.preventDefault();
      } else if (cy >= RIGHT_TOP && cy <= RIGHT_TOP + INNER_H) {
        const t = xToT(cx);
        const amp = yToAmp(cy, RIGHT_TOP);
        setState((prev) => {
          const nodes = insertNode(prev.rightNodes, t, amp);
          const idx = nodes.findIndex(([nt]) => nt === t);
          return {
            ...prev,
            rightNodes: nodes,
            activeItem: { kind: "node", channel: "right", index: idx },
          };
        });
        e.preventDefault();
      }
    },
    [getCanvasXY, hitTest],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const active = stateRef.current.activeItem;
      if (!active) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      if (active.kind === "in") {
        const t = Math.max(0, Math.min(stateRef.current.outPoint - 0.01, xToT(cx)));
        setState((prev) => ({ ...prev, inPoint: t }));
      } else if (active.kind === "out") {
        const t = Math.max(stateRef.current.inPoint + 0.01, Math.min(1, xToT(cx)));
        setState((prev) => ({ ...prev, outPoint: t }));
      } else if (active.kind === "node") {
        const { channel, index } = active;
        const yTop = channel === "left" ? LEFT_TOP : RIGHT_TOP;
        const amp = yToAmp(cy, yTop);
        setState((prev) => {
          const nodes = channel === "left" ? prev.leftNodes.slice() : prev.rightNodes.slice();
          // Keep t fixed; only move amplitude (except first/last which are pinned at t=0/1)
          nodes[index] = [nodes[index][0], amp];
          if (channel === "left") return { ...prev, leftNodes: nodes };
          return { ...prev, rightNodes: nodes };
        });
      }
    };

    const onUp = () => {
      if (stateRef.current.activeItem !== null) {
        setState((prev) => ({ ...prev, activeItem: null }));
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const handleRemoveNode = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 2) return; // right-click to remove
    const [cx, cy] = getCanvasXY(e);
    const hit = hitTest(cx, cy);
    if (hit?.kind === "node") {
      const { channel, index } = hit;
      setState((prev) => {
        const nodes = channel === "left" ? prev.leftNodes.slice() : prev.rightNodes.slice();
        // Don't remove first or last node
        if (index === 0 || index === nodes.length - 1) return prev;
        nodes.splice(index, 1);
        if (channel === "left") return { ...prev, leftNodes: nodes };
        return { ...prev, rightNodes: nodes };
      });
      e.preventDefault();
    }
  }, [getCanvasXY, hitTest]);

  const handleOk = () => {
    const s = stateRef.current;
    const inPt = Math.round(s.inPoint * safe);
    const outPt = Math.round(s.outPoint * safe);
    const envState: EnvelopeState = {
      inPoint: inPt,
      outPoint: outPt,
      leftNodes: s.leftNodes,
      rightNodes: s.rightNodes,
    };
    onConfirm({
      inPoint: inPt,
      outPoint: outPt >= safe ? 0 : outPt, // 0 = use full duration (SWF convention)
      customEnvelope: envelopeToPoints(envState, safe),
    });
    onClose();
  };

  const handleReset = () => {
    setState({
      inPoint: 0,
      outPoint: 1,
      leftNodes: [[0, 1], [1, 1]],
      rightNodes: [[0, 1], [1, 1]],
      activeItem: null,
    });
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3000,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "#3c3c3c",
          border: "1px solid #666",
          boxShadow: "4px 4px 16px rgba(0,0,0,0.7)",
          fontFamily: "Tahoma, Arial, sans-serif",
          fontSize: 11,
          color: "#e0e0e0",
          userSelect: "none",
          minWidth: 440,
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#2a2a2a",
            borderBottom: "1px solid #555",
            padding: "4px 6px",
          }}
        >
          <span style={{ fontWeight: "bold", fontSize: 11 }}>Edit Envelope</span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "1px solid #666",
              color: "#ccc",
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
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Canvas */}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <canvas
              ref={canvasRef}
              width={CW}
              height={CH}
              style={{
                cursor: "crosshair",
                border: "1px solid #555",
                display: "block",
              }}
              onMouseDown={onMouseDown}
              onContextMenu={handleRemoveNode}
            />
          </div>

          {/* Instructions */}
          <div style={{ fontSize: 10, color: "#666", textAlign: "center" }}>
            Drag In/Out markers to trim. Click channel band to add a volume node.
            Right-click an interior node to remove it.
          </div>

          {/* OK / Cancel / Reset */}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 6, marginTop: 4 }}>
            <button
              onClick={handleReset}
              style={{
                background: "#555",
                border: "1px solid #888",
                color: "#e0e0e0",
                cursor: "pointer",
                fontSize: 11,
                padding: "3px 10px",
                borderRadius: 2,
              }}
            >
              Reset
            </button>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={onClose}
                style={{
                  background: "#555",
                  border: "1px solid #888",
                  color: "#e0e0e0",
                  cursor: "pointer",
                  fontSize: 11,
                  padding: "3px 14px",
                  borderRadius: 2,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleOk}
                style={{
                  background: "#0066cc",
                  border: "1px solid #0099ff",
                  color: "#ffffff",
                  cursor: "pointer",
                  fontSize: 11,
                  padding: "3px 14px",
                  borderRadius: 2,
                  fontWeight: "bold",
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: insert a new node at position t, keeping nodes sorted by t
// ---------------------------------------------------------------------------

function insertNode(
  nodes: Array<[number, number]>,
  t: number,
  amp: number,
): Array<[number, number]> {
  // Don't insert if very close to an existing node
  if (nodes.some(([nt]) => Math.abs(nt - t) < 0.01)) return nodes;
  const next = [...nodes, [t, amp] as [number, number]];
  next.sort((a, b) => a[0] - b[0]);
  return next;
}

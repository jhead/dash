/**
 * Remote presence overlay (task 1345 P2) — live cursors + selection outlines.
 *
 * Rendered inside StageArea's `stageOverlay` slot, which lives in STAGE-SPACE
 * (the container has CSS zoom/pan applied), so a remote cursor's stage
 * coordinates map straight to `left`/`top`. Sizes that must stay constant on
 * screen (the cursor caret, the name label, outline stroke) are divided by
 * `zoom` to cancel the container scale.
 *
 * Only peers on the SAME scene/frame/edit-context as the local user are drawn —
 * a cursor or selection from a peer editing a different scene/symbol would be
 * meaningless in the local coordinate space. (The presence avatars still show
 * everyone, with a "follow" affordance to jump to a peer's location.)
 *
 * Solo: this renders nothing (no peers).
 */
import React from "react";
import type { DisplayObject } from "@flash/core";
import { getTransformedBounds } from "@flash/core";
import type { PeerPresence, PeerEditContext } from "./awarenessState.js";

export interface RemoteCursorsOverlayProps {
  /** Remote peers (already excludes self). */
  peers: PeerPresence[];
  /** Current zoom (to keep markers screen-constant). */
  zoom: number;
  /** Local user's location, so we only draw peers who are co-located. */
  localScene: number;
  localFrame: number;
  localEditContext: PeerEditContext;
  /** Display objects on the local active keyframe (to resolve selections). */
  activeObjects: readonly DisplayObject[];
}

/** Two peers are co-located when they share scene + frame + edit context. */
function coLocated(
  peer: PeerPresence,
  scene: number,
  frame: number,
  ec: PeerEditContext,
): boolean {
  if (peer.scene !== scene || peer.frame !== frame) return false;
  if (peer.editContext.mode !== ec.mode) return false;
  if (ec.mode === "symbol") return peer.editContext.symbolId === ec.symbolId;
  return true;
}

export function RemoteCursorsOverlay({
  peers,
  zoom,
  localScene,
  localFrame,
  localEditContext,
  activeObjects,
}: RemoteCursorsOverlayProps): React.ReactElement | null {
  const visible = peers.filter((p) =>
    coLocated(p, localScene, localFrame, localEditContext),
  );
  if (visible.length === 0) return null;

  const inv = 1 / (zoom || 1);
  const objById = new Map<string, DisplayObject>();
  for (const o of activeObjects) objById.set(o.id, o);

  return (
    <div
      data-testid="collab-remote-overlay"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "visible",
        pointerEvents: "none",
        zIndex: 40,
      }}
    >
      {/* Remote selection outlines (drawn under cursors). */}
      {visible.map((peer) => {
        const ids = peer.selection.shapeIds.concat(
          peer.selection.instanceId ? [peer.selection.instanceId] : [],
        );
        return ids.map((id) => {
          const obj = objById.get(id);
          if (!obj) return null;
          const b = getTransformedBounds(obj);
          return (
            <div
              key={`${peer.clientId}-sel-${id}`}
              data-testid="collab-remote-selection"
              style={{
                position: "absolute",
                left: b.x,
                top: b.y,
                width: b.width,
                height: b.height,
                border: `${2 * inv}px solid ${peer.user.color}`,
                boxSizing: "border-box",
                pointerEvents: "none",
              }}
            />
          );
        });
      })}

      {/* Remote cursors. */}
      {visible.map((peer) =>
        peer.cursor ? (
          <div
            key={`${peer.clientId}-cursor`}
            data-testid="collab-remote-cursor"
            style={{
              position: "absolute",
              left: peer.cursor.x,
              top: peer.cursor.y,
              transform: `scale(${inv})`,
              transformOrigin: "top left",
              pointerEvents: "none",
              willChange: "left, top",
            }}
          >
            <CursorCaret color={peer.user.color} />
            <span
              style={{
                position: "absolute",
                top: 14,
                left: 10,
                whiteSpace: "nowrap",
                background: peer.user.color,
                color: "#fff",
                fontSize: 10,
                lineHeight: "12px",
                padding: "1px 4px",
                borderRadius: 3,
                fontFamily: "sans-serif",
                boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
              }}
            >
              {peer.user.name}
            </span>
          </div>
        ) : null,
      )}
    </div>
  );
}

/** A small arrow caret in the peer's color (classic collab cursor). */
function CursorCaret({ color }: { color: string }): React.ReactElement {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" style={{ display: "block" }}>
      <path
        d="M1 1 L1 13 L4.5 9.5 L7 15 L9.5 14 L7 8.5 L12 8.5 Z"
        fill={color}
        stroke="#fff"
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </svg>
  );
}

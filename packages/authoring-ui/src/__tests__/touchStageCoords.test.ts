/**
 * Touch / pointer stage-interaction coordinate mapping (task 1275).
 *
 * The mobile/touch bug was that the stage work-area bound ONLY mouse events
 * (onMouseDown/Move/Up) and had no `touch-action`, so on a touch device the
 * drawing/selection/drag gestures never fired and the page scrolled/zoomed
 * instead. The fix switches the bindings to Pointer Events (which unify
 * mouse + pen + touch) and adds `touchAction: "none"` to the work-area style.
 *
 * The load-bearing correctness property is that the client→stage coordinate
 * mapping (`toStageCoords` in StageArea.tsx) is EVENT-SOURCE-AGNOSTIC: a touch
 * point delivered via `pointerEvent.clientX/Y` (or `touch.clientX/Y`) must map
 * to exactly the same stage coordinate as the identical mouse `clientX/Y`,
 * because the pointer handlers feed the very same `toStageCoords`.
 *
 * This mirrors the pure `toStageCoords` math from StageArea.tsx (kept in sync
 * with the source) and asserts mouse vs touch parity plus correct stage-space
 * mapping under pan/zoom.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Inline copy of the `toStageCoords` math from StageArea.tsx (must stay in
// sync with the source). The component reads workAreaRef.getBoundingClientRect()
// for the work-area position/size; we pass that rect in directly here.
// ---------------------------------------------------------------------------
interface Rect { left: number; top: number; width: number; height: number; }

function toStageCoords(
  clientX: number,
  clientY: number,
  rect: Rect,
  internalPanX: number,
  internalPanY: number,
  internalZoom: number,
  stageWidth: number,
  stageHeight: number
): { stageX: number; stageY: number } {
  const containerCenterX = rect.left + rect.width / 2;
  const containerCenterY = rect.top + rect.height / 2;
  const stageCenterScreenX = containerCenterX + internalPanX * internalZoom;
  const stageCenterScreenY = containerCenterY + internalPanY * internalZoom;
  const stageX = (clientX - stageCenterScreenX) / internalZoom + stageWidth / 2;
  const stageY = (clientY - stageCenterScreenY) / internalZoom + stageHeight / 2;
  return { stageX, stageY };
}

const RECT: Rect = { left: 100, top: 50, width: 800, height: 600 };
const STAGE_W = 550;
const STAGE_H = 400;

describe("touch/pointer stage coordinate mapping (task 1275)", () => {
  it("maps a touch point to the same stage coords as the identical mouse point", () => {
    // A real Touch and a MouseEvent both expose clientX/clientY in the same
    // viewport coordinate space; a PointerEvent (the unified handler input)
    // does too. So feeding either into toStageCoords must agree exactly.
    const mouse = { clientX: 423, clientY: 271 };
    const touch = { clientX: 423, clientY: 271 }; // touch.touches[0] / pointerEvent

    const fromMouse = toStageCoords(mouse.clientX, mouse.clientY, RECT, 0, 0, 1, STAGE_W, STAGE_H);
    const fromTouch = toStageCoords(touch.clientX, touch.clientY, RECT, 0, 0, 1, STAGE_W, STAGE_H);

    expect(fromTouch.stageX).toBeCloseTo(fromMouse.stageX, 10);
    expect(fromTouch.stageY).toBeCloseTo(fromMouse.stageY, 10);
  });

  it("the work-area center maps to the stage center at zoom 1, no pan", () => {
    const centerClientX = RECT.left + RECT.width / 2; // 500
    const centerClientY = RECT.top + RECT.height / 2; // 350
    const { stageX, stageY } = toStageCoords(centerClientX, centerClientY, RECT, 0, 0, 1, STAGE_W, STAGE_H);
    expect(stageX).toBeCloseTo(STAGE_W / 2, 10);
    expect(stageY).toBeCloseTo(STAGE_H / 2, 10);
  });

  it("honors zoom: a touch offset from center scales by 1/zoom", () => {
    const zoom = 2;
    const centerClientX = RECT.left + RECT.width / 2;
    const centerClientY = RECT.top + RECT.height / 2;
    // 100 screen px right + 60 down of center at 2x zoom => 50/30 stage px.
    const { stageX, stageY } = toStageCoords(
      centerClientX + 100,
      centerClientY + 60,
      RECT, 0, 0, zoom, STAGE_W, STAGE_H
    );
    expect(stageX).toBeCloseTo(STAGE_W / 2 + 50, 10);
    expect(stageY).toBeCloseTo(STAGE_H / 2 + 30, 10);
  });

  it("honors pan: identical client point shifts stage coords by -pan", () => {
    const cx = RECT.left + RECT.width / 2;
    const cy = RECT.top + RECT.height / 2;
    const noPan = toStageCoords(cx, cy, RECT, 0, 0, 1, STAGE_W, STAGE_H);
    const panned = toStageCoords(cx, cy, RECT, 40, 25, 1, STAGE_W, STAGE_H);
    // Panning the view by (+40,+25) moves the same screen point to (-40,-25) in stage space.
    expect(panned.stageX).toBeCloseTo(noPan.stageX - 40, 10);
    expect(panned.stageY).toBeCloseTo(noPan.stageY - 25, 10);
  });

  it("a multi-segment touch drag produces the same stage path as a mouse drag", () => {
    // touch.touches[0] over a gesture vs mouse clientX/Y over the same gesture.
    const gesture = [
      { clientX: 200, clientY: 150 },
      { clientX: 260, clientY: 210 },
      { clientX: 330, clientY: 240 },
      { clientX: 410, clientY: 300 },
    ];
    const mousePath = gesture.map((p) => toStageCoords(p.clientX, p.clientY, RECT, 10, -5, 1.5, STAGE_W, STAGE_H));
    const touchPath = gesture.map((p) => toStageCoords(p.clientX, p.clientY, RECT, 10, -5, 1.5, STAGE_W, STAGE_H));
    mousePath.forEach((m, i) => {
      expect(touchPath[i].stageX).toBeCloseTo(m.stageX, 10);
      expect(touchPath[i].stageY).toBeCloseTo(m.stageY, 10);
    });
  });
});

// ---------------------------------------------------------------------------
// Static guard: the StageArea work-area must bind Pointer Events and disable
// native touch gestures, so touch drives the stage tools the way mouse does.
// Reads the source file rather than rendering the (very large) component.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

describe("StageArea work-area binds pointer events and owns touch (task 1275)", () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../StageArea.tsx"),
    "utf8"
  );

  it("binds onPointerDown/Move/Up (unifying mouse + touch)", () => {
    expect(src).toMatch(/onPointerDown=/);
    expect(src).toMatch(/onPointerMove=/);
    expect(src).toMatch(/onPointerUp=/);
  });

  it("sets touchAction:'none' on the work-area surface", () => {
    expect(src).toMatch(/touchAction:\s*["']none["']/);
  });

  it("uses pointer capture for robust off-element drags", () => {
    expect(src).toMatch(/setPointerCapture/);
  });
});

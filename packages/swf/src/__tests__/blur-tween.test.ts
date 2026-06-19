/**
 * Timeline Effect "Blur" — emitted SWF tween (task 1210).
 *
 * The Blur timeline effect synthesizes a blur-filter tween 0 -> max -> 0 across
 * three motion-tweened keyframes. The SWF compiler interpolates the blur filter
 * per frame (via getTweenedFrame) and emits each tweened frame as a PlaceObject3
 * (tag 70) carrying a FILTERLIST with a single Blur filter (ID 1).
 *
 * This test compiles such a document and verifies that:
 *   1. Mid-tween frames emit PlaceObject3 (tag 70) with a blur filter.
 *   2. The interpolated blurX ramps UP toward the peak in the first span and
 *      DOWN toward zero in the second span (the 0 -> max -> 0 shape).
 *   3. The peak keyframe carries the full requested blur.
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import { Tag } from "../tags.js";
import type { FlashDocument, Frame, Layer, Scene, Symbol } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag parsing
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
}

function parseTags(swf: Uint8Array): SwfTag[] {
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBytes = Math.ceil((5 + 4 * nBits) / 8);
  let pos = 8 + rectBytes + 4;
  const tags: SwfTag[] = [];
  while (pos < swf.length - 1) {
    const h = swf[pos] | (swf[pos + 1] << 8);
    const code = (h >> 6) & 0x3ff;
    let len = h & 0x3f;
    let hdr = 2;
    if (len === 0x3f) {
      len = swf[pos + 2] | (swf[pos + 3] << 8) | (swf[pos + 4] << 16) | (swf[pos + 5] << 24);
      hdr = 6;
    }
    tags.push({ code, body: swf.slice(pos + hdr, pos + hdr + len) });
    pos = pos + hdr + len;
    if (code === 0) break;
  }
  return tags;
}

/**
 * Extract the blurX value (in pixels) from a PlaceObject3 body that carries a
 * single Blur filter. Returns null if no blur filter is present.
 *
 * PlaceObject3 layout: flags(2) depth(2) [chars...] then optional fields. We
 * locate the FILTERLIST by scanning for filter id 1 (Blur) followed by two
 * FIXED16 (blurX, blurY) — robust enough for this single-filter fixture where
 * the body is short and the only filter id present is 1.
 */
function blurXFromPlaceObject3(body: Uint8Array): number | null {
  // PlaceObject3 has TWO flag bytes: flags1 (body[0]) then flags2 (body[1]).
  // HasFilterList is bit 4 of flags2.
  const flags2 = body[1];
  if (!(flags2 & 0x10)) return null;
  // The FILTERLIST starts after flags(2)+depth(2)+conditional PO2 fields. Rather
  // than fully parse the matrix/cxform, scan for the Blur filter id (1) record:
  // a byte 0x01 followed by 8 bytes (blurX,blurY FIXED16) and a quality byte.
  for (let i = 4; i + 9 < body.length; i++) {
    if (body[i] === 0x01) {
      const bxRaw = body[i + 1] | (body[i + 2] << 8) | (body[i + 3] << 16) | (body[i + 4] << 24);
      const blurX = bxRaw / 65536;
      // Sanity: a plausible blur (0..255 px) — guards against false matches.
      if (blurX >= 0 && blurX <= 255) return blurX;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Document factory
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  width: 550,
  height: 400,
  frameRate: 12,
  backgroundColor: "#ffffff",
  rulerUnits: "px" as const,
  grid: { showGrid: false, snapToGrid: false, gridColor: "#999999", gridWidth: 18, gridHeight: 18 },
  guides: [],
  snapToObjects: false,
  snapToPixels: false,
  snapToGuides: false,
};

function makeFrame(displayObjects: unknown[], index: number, opts: Partial<Frame> = {}): Frame {
  return {
    index,
    isKeyframe: true,
    isEmpty: displayObjects.length === 0,
    tweenType: "none",
    label: "",
    labelType: "name",
    script: "",
    sound: null,
    motionEase: 0,
    motionEaseType: "none",
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionSnap: false,
    motionScale: true,
    shapeEase: 0,
    shapeEaseType: "none",
    shapeBlend: "distributive",
    displayObjects: displayObjects as Frame["displayObjects"],
    ...opts,
  } as Frame;
}

function makeLayer(id: string, frames: Frame[], frameCount?: number): Layer {
  return {
    id,
    name: id,
    type: "normal",
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frames,
    frameCount: frameCount ?? frames.length,
  };
}

function makeSymbol(id: string): Symbol {
  return {
    id,
    name: id,
    itemType: "symbol",
    symbolType: "movieclip",
    linkage: {
      exportForActionScript: false,
      exportInFirstFrame: false,
      linkageIdentifier: "",
      className: "",
      exportForRuntimeSharing: false,
      importForRuntimeSharing: false,
      sharedUrl: "",
    },
    scale9Grid: null,
    timeline: {
      layers: [
        makeLayer("sym-layer", [
          makeFrame(
            [{ type: "shape", id: "inner", shape: { id: "innersh", paths: [] }, x: 0, y: 0 }],
            0
          ),
        ]),
      ],
    },
  } as Symbol;
}

/** Build a blur-effect document: instance present on 3 motion-tweened keyframes. */
function makeBlurDoc(peak: number, duration: number): FlashDocument {
  const sym = makeSymbol("blurSym");
  const startFrame = 0;
  const endFrame = duration - 1;
  const midFrame = Math.floor((duration - 1) / 2);

  const blurInst = (bx: number, by: number) => ({
    type: "instance" as const,
    id: "blur-inst",
    symbolId: sym.id,
    x: 100,
    y: 100,
    filters: [{ type: "blur" as const, blurX: bx, blurY: by, quality: 1 as const, enabled: true }],
  });

  const frames: Frame[] = [
    makeFrame([blurInst(0, 0)], startFrame, { tweenType: "motion", motionEase: 0 }),
    makeFrame([blurInst(peak, peak)], midFrame, { tweenType: "motion", motionEase: 0 }),
    makeFrame([blurInst(0, 0)], endFrame),
  ];

  const scene: Scene = {
    id: "scene-1",
    name: "Scene 1",
    timeline: { layers: [makeLayer("layer", frames, duration)] },
  };

  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [scene],
    library: { items: [sym], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Blur timeline effect — emitted SWF tween", () => {
  it("emits PlaceObject3 (tag 70) blur filters on the tweened frames", () => {
    const swf = compileDocument(makeBlurDoc(20, 11));
    const tags = parseTags(swf);
    const po3 = tags.filter((t) => t.code === Tag.PlaceObject3);
    expect(po3.length).toBeGreaterThan(0);
    const withBlur = po3.filter((t) => blurXFromPlaceObject3(t.body) !== null);
    expect(withBlur.length).toBeGreaterThan(0);
  });

  it("interpolates blur 0 -> max -> 0 across the span (peak in the middle)", () => {
    const peak = 20;
    const duration = 11; // frames 0..10, mid = 5
    const swf = compileDocument(makeBlurDoc(peak, duration));
    const tags = parseTags(swf);

    // Collect per-ShowFrame blurX by walking the tag stream frame by frame.
    const perFrameBlur: (number | null)[] = [];
    let pending: number | null = null;
    for (const t of tags) {
      if (t.code === Tag.PlaceObject3) {
        const bx = blurXFromPlaceObject3(t.body);
        if (bx !== null) pending = bx;
      } else if (t.code === Tag.ShowFrame) {
        perFrameBlur.push(pending);
        // PlaceObject3 with HasMove restates the filter each frame, so reset.
        pending = null;
      }
    }

    const blurs = perFrameBlur.filter((b): b is number => b !== null);
    expect(blurs.length).toBeGreaterThanOrEqual(3);

    // Peak should reach (approximately) the requested max somewhere in the middle.
    const maxBlur = Math.max(...blurs);
    expect(maxBlur).toBeGreaterThan(peak * 0.9);
    expect(maxBlur).toBeLessThanOrEqual(peak + 0.001);

    // First emitted blur should be small (near 0) and last should be small too,
    // confirming the 0 -> max -> 0 shape.
    expect(blurs[0]).toBeLessThan(maxBlur);
    expect(blurs[blurs.length - 1]).toBeLessThan(maxBlur);
  });
});

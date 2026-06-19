/**
 * Unit-level regressions for the three Ruffle visual-oracle defects from task
 * 1216 — caught here at the SWF-byte level so they cannot silently regress
 * without an e2e run.
 *
 * (A) motion-tween.spec.ts:330 — a classic motion tween whose movement is
 *     encoded in the SHAPE GEOMETRY (both keyframes share transform x/y but the
 *     path coordinates differ) emitted NO PlaceObject2 Move tags on the
 *     in-between frames, so the object never moved (diffPixels=0). The tween
 *     interpolation now folds each keyframe's geometric origin into the
 *     position so the in-between frames carry a HasMove PlaceObject2 whose tx
 *     ramps across the span.
 *
 * (B) motion-guide.spec.ts:675 — a `stop()` parked on a NON-keyframe in-between
 *     tween frame was dropped (the frame-script emit gated on `isKeyframe`), so
 *     the movie never stopped at the apex frame and the apex region read empty.
 *     Frame scripts now emit a DoAction regardless of `isKeyframe`.
 *
 * (C) bitmap-rendering.spec.ts:202 — a lossless library bitmap rendered blank
 *     (red=0). DefineBitsLossless2 ZlibBitmapData was compressed with fflate's
 *     `deflateSync` (raw DEFLATE, no zlib header), which Flash Player / Ruffle's
 *     ZlibDecoder cannot decompress. The encoder now emits a proper ZLIB stream.
 */

import { describe, it, expect } from "vitest";
import { unzlibSync, decompressSync } from "fflate";
import { compileDocument } from "../compile.js";
import { Tag } from "../tags.js";
import type { FlashDocument, Frame } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag parsing (decompresses CWS body first, then walks tag records)
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
}

function decompressIfNeeded(swf: Uint8Array): Uint8Array {
  const sig = String.fromCharCode(swf[0]!, swf[1]!, swf[2]!);
  if (sig === "CWS") {
    const inflated = unzlibSync(swf.subarray(8));
    const out = new Uint8Array(8 + inflated.length);
    out.set(swf.subarray(0, 8), 0);
    out.set(inflated, 8);
    return out;
  }
  return swf;
}

function parseTags(rawSwf: Uint8Array): SwfTag[] {
  const swf = decompressIfNeeded(rawSwf);
  const nBits = (swf[8]! >> 3) & 0x1f;
  const rectBytes = Math.ceil((5 + 4 * nBits) / 8);
  let pos = 8 + rectBytes + 4;
  const tags: SwfTag[] = [];
  while (pos < swf.length - 1) {
    const h = swf[pos]! | (swf[pos + 1]! << 8);
    const code = (h >> 6) & 0x3ff;
    let len = h & 0x3f;
    let hdr = 2;
    if (len === 0x3f) {
      len =
        swf[pos + 2]! |
        (swf[pos + 3]! << 8) |
        (swf[pos + 4]! << 16) |
        (swf[pos + 5]! << 24);
      hdr = 6;
    }
    tags.push({ code, body: swf.slice(pos + hdr, pos + hdr + len) });
    pos = pos + hdr + len;
    if (code === 0) break;
  }
  return tags;
}

/** Decode a PlaceObject2 body → { depth, hasMove, hasChar, tx, ty } (tx/ty px). */
function decodePlaceObject2(b: Uint8Array): {
  depth: number;
  hasMove: boolean;
  hasChar: boolean;
  tx: number | null;
  ty: number | null;
} {
  let pos = 0;
  const flags = b[pos++]!;
  const depth = b[pos]! | (b[pos + 1]! << 8);
  pos += 2;
  const hasMove = (flags & 1) !== 0;
  const hasChar = (flags & 2) !== 0;
  const hasMatrix = (flags & 4) !== 0;
  if (hasChar) pos += 2;
  if (!hasMatrix) return { depth, hasMove, hasChar, tx: null, ty: null };
  let bitpos = pos * 8;
  const rd = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = b[bitpos >> 3]!;
      const bit = (byte >> (7 - (bitpos & 7))) & 1;
      v = (v << 1) | bit;
      bitpos++;
    }
    return v;
  };
  const sx = (v: number, n: number): number =>
    v & (1 << (n - 1)) ? v - (1 << n) : v;
  if (rd(1)) {
    const ns = rd(5);
    rd(ns);
    rd(ns);
  }
  if (rd(1)) {
    const nr = rd(5);
    rd(nr);
    rd(nr);
  }
  const nt = rd(5);
  const tx = sx(rd(nt), nt);
  const ty = sx(rd(nt), nt);
  return { depth, hasMove, hasChar, tx: tx / 20, ty: ty / 20 };
}

// ---------------------------------------------------------------------------
// Fixtures
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

function frame(index: number, opts: Partial<Frame> = {}): Frame {
  return {
    index,
    isKeyframe: false,
    isEmpty: false,
    tweenType: "none",
    label: "",
    labelType: "name",
    script: "",
    sound: null,
    motionEase: 0,
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionScale: false,
    shapeEase: 0,
    shapeBlend: "distributive",
    displayObjects: [],
    ...opts,
  } as Frame;
}

function redRect(id: string, x: number, y: number) {
  return {
    id,
    type: "shape" as const,
    shape: {
      id: `shape-${id}`,
      paths: [
        {
          start: { x, y },
          segments: [
            { type: "line" as const, to: { x: x + 50, y } },
            { type: "line" as const, to: { x: x + 50, y: y + 50 } },
            { type: "line" as const, to: { x, y: y + 50 } },
          ],
          closed: true,
          fill: { type: "solid" as const, color: { r: 255, g: 0, b: 0, a: 255 } },
        },
      ],
    },
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

// ---------------------------------------------------------------------------
// (A) geometry-baked motion tween emits HasMove PlaceObject2 on in-betweens
// ---------------------------------------------------------------------------

describe("task 1216 (A) — geometry-encoded motion tween animates", () => {
  const doc: FlashDocument = {
    id: "tween-doc",
    properties: BASE_PROPS,
    scenes: [
      {
        id: "s1",
        name: "Scene 1",
        timeline: {
          layers: [
            {
              id: "l",
              name: "Layer 1",
              type: "normal",
              visible: true,
              locked: false,
              outlineMode: false,
              outlineColor: "#ff0000",
              height: 20,
              parentFolderId: null,
              frameCount: 5,
              frames: [
                frame(0, { isKeyframe: true, tweenType: "motion", displayObjects: [redRect("start", 50, 175)] }),
                frame(1, { tweenType: "motion" }),
                frame(2, { tweenType: "motion" }),
                frame(3, { tweenType: "motion" }),
                frame(4, { isKeyframe: true, tweenType: "none", displayObjects: [redRect("end", 450, 175)] }),
              ],
            },
          ],
        },
      },
    ],
    library: { items: [], folders: [] },
  } as unknown as FlashDocument;

  it("emits HasMove PlaceObject2 tags whose tx ramps across the span", () => {
    const tags = parseTags(compileDocument(doc));

    // Walk tags frame-by-frame, recording each frame's PlaceObject2 tx.
    const txByFrame: (number | null)[] = [];
    let frameIdx = 0;
    let lastTx: number | null = null;
    let moveCount = 0;
    for (const t of tags) {
      if (t.code === Tag.PlaceObject2) {
        const po = decodePlaceObject2(t.body);
        lastTx = po.tx;
        if (po.hasMove) moveCount++;
      } else if (t.code === Tag.ShowFrame) {
        txByFrame[frameIdx] = lastTx;
        frameIdx++;
      }
    }

    // 5 frames rendered
    expect(frameIdx).toBe(5);
    // In-between frames (1,2,3) must each carry a HasMove placement.
    expect(moveCount).toBeGreaterThanOrEqual(3);
    // tx must strictly increase from frame 0 toward the end position.
    expect(txByFrame[0]).toBeCloseTo(0, 1); // start shape already at x=50, matrix tx=0
    expect(txByFrame[1]!).toBeGreaterThan(txByFrame[0]!);
    expect(txByFrame[2]!).toBeGreaterThan(txByFrame[1]!);
    expect(txByFrame[3]!).toBeGreaterThan(txByFrame[2]!);
  });
});

// ---------------------------------------------------------------------------
// (B) frame script on a non-keyframe in-between frame emits a DoAction
// ---------------------------------------------------------------------------

describe("task 1216 (B) — mid-tween frame script emits DoAction", () => {
  const doc: FlashDocument = {
    id: "guide-stop-doc",
    properties: BASE_PROPS,
    scenes: [
      {
        id: "s1",
        name: "Scene 1",
        timeline: {
          layers: [
            {
              id: "l",
              name: "Layer 1",
              type: "normal",
              visible: true,
              locked: false,
              outlineMode: false,
              outlineColor: "#ff0000",
              height: 20,
              parentFolderId: null,
              frameCount: 5,
              frames: [
                frame(0, { isKeyframe: true, tweenType: "motion", displayObjects: [redRect("start", 50, 175)] }),
                frame(1, { tweenType: "motion" }),
                // stop() parked on a non-keyframe in-between frame:
                frame(2, { tweenType: "motion", script: "stop();" }),
                frame(3, { tweenType: "motion" }),
                frame(4, { isKeyframe: true, tweenType: "none", displayObjects: [redRect("end", 450, 175)] }),
              ],
            },
          ],
        },
      },
    ],
    library: { items: [], folders: [] },
  } as unknown as FlashDocument;

  it("emits a DoAction at the in-between frame that carries the script", () => {
    const tags = parseTags(compileDocument(doc));
    let frameIdx = 0;
    let doActionFrame = -1;
    for (const t of tags) {
      if (t.code === Tag.DoAction) {
        doActionFrame = frameIdx; // the next ShowFrame closes this frame
      } else if (t.code === Tag.ShowFrame) {
        frameIdx++;
      }
    }
    // The DoAction must be emitted on frame index 2 (before its ShowFrame).
    expect(doActionFrame).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// (C) DefineBitsLossless2 / JPEG3 alpha are real ZLIB streams (not raw DEFLATE)
// ---------------------------------------------------------------------------

describe("task 1216 (C) — lossless bitmap uses a ZLIB stream", () => {
  // 20×20 solid-red PNG (matches the bitmap-rendering oracle fixture).
  const RED_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAG0lEQVR4nGP4z8BANiJf" +
    "56jmUc2jmkc1U0UzADHNjoAymaoJAAAAAElFTkSuQmCC";

  // Pre-decoded ARGB pixels for the lossless path (20×20 opaque red).
  const W = 20;
  const H = 20;
  const argb = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    argb[i * 4] = 255; // A
    argb[i * 4 + 1] = 255; // R
    argb[i * 4 + 2] = 0; // G
    argb[i * 4 + 3] = 0; // B
  }

  const doc: FlashDocument = {
    id: "bmp-doc",
    properties: BASE_PROPS,
    scenes: [
      {
        id: "s1",
        name: "Scene 1",
        timeline: {
          layers: [
            {
              id: "l",
              name: "Layer 1",
              type: "normal",
              visible: true,
              locked: false,
              outlineMode: false,
              outlineColor: "#ff0000",
              height: 20,
              parentFolderId: null,
              frameCount: 1,
              frames: [
                frame(0, {
                  isKeyframe: true,
                  displayObjects: [
                    { id: "bmp-obj", type: "bitmap", libraryItemId: "bi1", x: 100, y: 100, width: 20, height: 20 },
                  ] as unknown as Frame["displayObjects"],
                }),
              ],
            },
          ],
        },
      },
    ],
    library: {
      items: [
        {
          id: "bi1",
          name: "red.png",
          itemType: "bitmap",
          dataUri: `data:image/png;base64,${RED_PNG_BASE64}`,
          originalWidth: 20,
          originalHeight: 20,
          allowSmoothing: false,
          compressionType: "lossless",
          quality: 100,
        },
      ],
      folders: [],
    },
  } as unknown as FlashDocument;

  it("DefineBitsLossless2 ZlibBitmapData begins with a 0x78 zlib header and decompresses to red ARGB", () => {
    const bitmapPixels = new Map([["bi1", { width: W, height: H, pixels: argb }]]);
    const tags = parseTags(compileDocument(doc, { bitmapPixels }));

    const lossless = tags.find((t) => t.code === Tag.DefineBitsLossless2);
    expect(lossless, "must emit DefineBitsLossless2 (tag 36)").toBeDefined();

    // Body: charId(2) format(1) width(2) height(2) then ZlibBitmapData.
    const body = lossless!.body;
    expect(body[2]).toBe(5); // BitmapFormat 5 = 32-bit ARGB
    const zlibData = body.subarray(7);

    // A real ZLIB stream starts with 0x78 (CMF). Raw DEFLATE does not.
    expect(zlibData[0]).toBe(0x78);

    // Must round-trip through a strict zlib decoder (what Ruffle/Flash use).
    const decoded = unzlibSync(zlibData);
    expect(decoded.length).toBe(W * H * 4);
    // First pixel is opaque red in ARGB byte order.
    expect([decoded[0], decoded[1], decoded[2], decoded[3]]).toEqual([255, 255, 0, 0]);
    // And the format-agnostic decoder agrees.
    expect(decompressSync(zlibData).length).toBe(W * H * 4);
  });
});

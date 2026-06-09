/**
 * DefineMorphShape (tag 46) encoder for shape tween export.
 *
 * The tag body format:
 *   UI16  CharacterId
 *   RECT  StartBounds
 *   RECT  EndBounds
 *   UI32  Offset (bytes from end of Offset field to start of EndEdges)
 *   MORPHFILLSTYLEARRAY StartFillStyles
 *   MORPHLINESTYLEARRAY StartLineStyles
 *   SHAPE StartEdges
 *   SHAPE EndEdges
 *
 * This implementation supports solid fill and solid line styles only.
 * Curves are approximated as straight line sequences.
 * StartEdges and EndEdges are parallel (same record count).
 */
import { BitWriter } from "./bits.js";
import type { ShapePath, SolidFill, SolidStroke } from "@flash/core";
import { px, edgeNumBits, writeRect } from "./helpers.js";

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

interface BoundingBox {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

function computePathBounds(paths: readonly ShapePath[]): BoundingBox {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;

  function expand(x: number, y: number): void {
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }

  for (const path of paths) {
    expand(path.start.x, path.start.y);
    for (const seg of path.segments) {
      if (seg.type === "line") {
        expand(seg.to.x, seg.to.y);
      } else {
        expand(seg.control.x, seg.control.y);
        expand(seg.to.x, seg.to.y);
      }
    }
  }

  if (!isFinite(xMin)) {
    return { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
  }
  return { xMin, xMax, yMin, yMax };
}

// ---------------------------------------------------------------------------
// Style collection helpers
// ---------------------------------------------------------------------------

interface FillEntry {
  startFill: SolidFill;
  endFill: SolidFill;
}

interface StrokeEntry {
  startStroke: SolidStroke;
  endStroke: SolidStroke;
}

interface StyleMaps {
  fills: FillEntry[];
  strokes: StrokeEntry[];
  pathFillIndex: number[]; // 1-based; 0 = no fill
  pathStrokeIndex: number[]; // 1-based; 0 = no stroke
}

function collectStyles(
  startPaths: readonly ShapePath[],
  endPaths: readonly ShapePath[]
): StyleMaps {
  const fills: FillEntry[] = [];
  const strokes: StrokeEntry[] = [];
  const pathFillIndex: number[] = [];
  const pathStrokeIndex: number[] = [];

  const count = startPaths.length;
  for (let i = 0; i < count; i++) {
    const sp = startPaths[i];
    // Safe fallback if end has fewer paths
    const ep = endPaths[i] ?? sp;

    // Fill
    if (
      sp.fill?.type === "solid" &&
      ep.fill?.type === "solid"
    ) {
      const sf = sp.fill as SolidFill;
      const ef = ep.fill as SolidFill;
      fills.push({ startFill: sf, endFill: ef });
      pathFillIndex.push(fills.length); // 1-based
    } else if (sp.fill?.type === "solid") {
      // Only start has fill — use same color for both
      const sf = sp.fill as SolidFill;
      fills.push({ startFill: sf, endFill: sf });
      pathFillIndex.push(fills.length);
    } else {
      pathFillIndex.push(0);
    }

    // Stroke (solid only)
    if (
      sp.stroke?.type === "solid" &&
      ep.stroke?.type === "solid"
    ) {
      const ss = sp.stroke as SolidStroke;
      const es = ep.stroke as SolidStroke;
      strokes.push({ startStroke: ss, endStroke: es });
      pathStrokeIndex.push(strokes.length); // 1-based
    } else if (sp.stroke?.type === "solid") {
      const ss = sp.stroke as SolidStroke;
      strokes.push({ startStroke: ss, endStroke: ss });
      pathStrokeIndex.push(strokes.length);
    } else {
      pathStrokeIndex.push(0);
    }
  }

  return { fills, strokes, pathFillIndex, pathStrokeIndex };
}

// ---------------------------------------------------------------------------
// MORPHFILLSTYLEARRAY / MORPHLINESTYLEARRAY
// ---------------------------------------------------------------------------

function writeMorphFillStyleArray(
  bw: BitWriter,
  fills: FillEntry[]
): void {
  // Count
  if (fills.length >= 0xff) {
    bw.writeUI8(0xff);
    bw.writeUI16LE(fills.length);
  } else {
    bw.writeUI8(fills.length);
  }
  for (const fe of fills) {
    // MorphFillStyle type 0x00 = solid
    bw.writeUI8(0x00);
    // startColor RGBA
    bw.writeUI8(fe.startFill.color.r);
    bw.writeUI8(fe.startFill.color.g);
    bw.writeUI8(fe.startFill.color.b);
    bw.writeUI8(fe.startFill.color.a);
    // endColor RGBA
    bw.writeUI8(fe.endFill.color.r);
    bw.writeUI8(fe.endFill.color.g);
    bw.writeUI8(fe.endFill.color.b);
    bw.writeUI8(fe.endFill.color.a);
  }
}

function writeMorphLineStyleArray(
  bw: BitWriter,
  strokes: StrokeEntry[]
): void {
  // Count
  bw.writeUI8(strokes.length);
  for (const se of strokes) {
    // startWidth UI16LE in twips
    bw.writeUI16LE(px(se.startStroke.width));
    // endWidth UI16LE in twips
    bw.writeUI16LE(px(se.endStroke.width));
    // startColor RGBA
    bw.writeUI8(se.startStroke.color.r);
    bw.writeUI8(se.startStroke.color.g);
    bw.writeUI8(se.startStroke.color.b);
    bw.writeUI8(se.startStroke.color.a);
    // endColor RGBA
    bw.writeUI8(se.endStroke.color.r);
    bw.writeUI8(se.endStroke.color.g);
    bw.writeUI8(se.endStroke.color.b);
    bw.writeUI8(se.endStroke.color.a);
  }
}

// ---------------------------------------------------------------------------
// Shape records for morph shapes
// ---------------------------------------------------------------------------

/**
 * Write a StyleChangeRecord for morph shapes.
 * Morph shape SHAPE records use same bit layout as DefineShape/DefineShape2.
 * (No stateNewStyles in DefineShape1 mode, but we only need moveTo + style refs.)
 */
function writeMorphStyleChangeRecord(
  bw: BitWriter,
  options: {
    moveTo?: { x: number; y: number };
    fillStyle0?: number;
    lineStyle?: number;
    numFillBits: number;
    numLineBits: number;
  }
): void {
  const stateMoveTo = options.moveTo !== undefined ? 1 : 0;
  const stateFillStyle0 = options.fillStyle0 !== undefined ? 1 : 0;
  const stateLineStyle = options.lineStyle !== undefined ? 1 : 0;

  // Type bits: 0, 0
  bw.writeBits(0, 1);
  bw.writeBits(0, 1);
  // State flags
  bw.writeBits(0, 1); // stateNewStyles
  bw.writeBits(stateLineStyle, 1);
  bw.writeBits(0, 1); // stateFillStyle1
  bw.writeBits(stateFillStyle0, 1);
  bw.writeBits(stateMoveTo, 1);

  if (stateMoveTo) {
    const { x, y } = options.moveTo!;
    const moveBits = Math.max(edgeNumBits([x, y]), 2);
    bw.writeBits(moveBits, 5);
    bw.writeBits(x, moveBits);
    bw.writeBits(y, moveBits);
  }

  if (stateFillStyle0) {
    bw.writeBits(options.fillStyle0!, options.numFillBits);
  }

  if (stateLineStyle) {
    bw.writeBits(options.lineStyle!, options.numLineBits);
  }
}

function writeMorphStraightEdge(bw: BitWriter, dx: number, dy: number): void {
  const numBits = edgeNumBits([dx, dy]);
  const storedBits = numBits - 2;

  bw.writeBits(1, 1); // edge record
  bw.writeBits(1, 1); // straight edge
  bw.writeBits(storedBits, 4);

  const isGeneral = dx !== 0 && dy !== 0;
  const isVertical = dx === 0 && dy !== 0;

  if (isGeneral) {
    bw.writeBits(1, 1);
    bw.writeBits(dx, numBits);
    bw.writeBits(dy, numBits);
  } else if (isVertical) {
    bw.writeBits(0, 1);
    bw.writeBits(1, 1);
    bw.writeBits(dy, numBits);
  } else {
    bw.writeBits(0, 1);
    bw.writeBits(0, 1);
    bw.writeBits(dx, numBits);
  }
}

function writeMorphEndShapeRecord(bw: BitWriter): void {
  bw.writeBits(0, 6);
  bw.flushBits();
}

// ---------------------------------------------------------------------------
// Vertex list extraction (flatten curves to line segments)
// ---------------------------------------------------------------------------

interface Vertex {
  x: number; // twips
  y: number;
}

/**
 * Extract an ordered list of vertices from a ShapePath, approximating
 * curves as line segments (endpoint only, control point dropped).
 * Returns vertices in twips, including the start point.
 */
function pathToVertices(path: ShapePath): Vertex[] {
  const verts: Vertex[] = [];
  verts.push({ x: px(path.start.x), y: px(path.start.y) });
  for (const seg of path.segments) {
    // Both line and curve: just take the endpoint in twips
    verts.push({ x: px(seg.to.x), y: px(seg.to.y) });
  }
  if (path.closed) {
    // Add closing line back to start if not already there
    const last = verts[verts.length - 1];
    const first = verts[0];
    if (last.x !== first.x || last.y !== first.y) {
      verts.push({ x: first.x, y: first.y });
    }
  }
  return verts;
}

/**
 * Encode a SHAPE edge stream for one side of a morph shape.
 *
 * Each path is encoded as: StyleChangeRecord (moveTo + style refs) + StraightEdge records.
 * The EndShapeRecord is emitted at the end.
 *
 * @param paths       The shape paths for this side
 * @param vertexSets  Pre-computed vertex arrays (one per path, padded to match the other side)
 * @param pathFillIndex  1-based fill style indices per path
 * @param pathStrokeIndex  1-based line style indices per path
 * @param numFillBits
 * @param numLineBits
 */
function encodeMorphShapeEdges(
  vertexSets: Vertex[][],
  pathFillIndex: number[],
  pathStrokeIndex: number[],
  numFillBits: number,
  numLineBits: number
): Uint8Array {
  const bw = new BitWriter();

  for (let pi = 0; pi < vertexSets.length; pi++) {
    const verts = vertexSets[pi];
    if (verts.length === 0) continue;

    const fillIdx = pathFillIndex[pi] ?? 0;
    const strokeIdx = pathStrokeIndex[pi] ?? 0;

    // StyleChangeRecord: moveTo + style refs
    writeMorphStyleChangeRecord(bw, {
      moveTo: { x: verts[0].x, y: verts[0].y },
      fillStyle0: fillIdx,
      lineStyle: strokeIdx,
      numFillBits,
      numLineBits,
    });

    // Straight edge records
    let curX = verts[0].x;
    let curY = verts[0].y;

    for (let vi = 1; vi < verts.length; vi++) {
      const dx = verts[vi].x - curX;
      const dy = verts[vi].y - curY;
      if (dx !== 0 || dy !== 0) {
        writeMorphStraightEdge(bw, dx, dy);
      }
      curX = verts[vi].x;
      curY = verts[vi].y;
    }
  }

  writeMorphEndShapeRecord(bw);
  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a DefineMorphShape (tag 46) tag body.
 *
 * @param charId      SWF character ID for this morph shape
 * @param startPaths  Shape paths for the start keyframe
 * @param endPaths    Shape paths for the end keyframe
 * @returns           Tag body bytes (without SWF record header)
 */
export function encodeDefineMorphShape(
  charId: number,
  startPaths: readonly ShapePath[],
  endPaths: readonly ShapePath[]
): Uint8Array {
  // Compute bounding boxes in twips
  const sb = computePathBounds(startPaths);
  const eb = computePathBounds(endPaths);
  const startBounds = {
    xMin: px(sb.xMin), xMax: px(sb.xMax),
    yMin: px(sb.yMin), yMax: px(sb.yMax),
  };
  const endBounds = {
    xMin: px(eb.xMin), xMax: px(eb.xMax),
    yMin: px(eb.yMin), yMax: px(eb.yMax),
  };

  // Collect style information from start paths
  const { fills, strokes, pathFillIndex, pathStrokeIndex } = collectStyles(
    startPaths,
    endPaths
  );

  const numFillBits = fills.length > 0 ? Math.ceil(Math.log2(fills.length + 1)) : 1;
  const numLineBits = strokes.length > 0 ? Math.ceil(Math.log2(strokes.length + 1)) : 1;

  // Build parallel vertex sets for start and end
  // We use the path count of startPaths as the canonical count.
  // For any missing end paths, we duplicate start paths (no-op morph).
  const pathCount = startPaths.length;
  const startVertexSets: Vertex[][] = [];
  const endVertexSets: Vertex[][] = [];

  for (let i = 0; i < pathCount; i++) {
    const sp = startPaths[i];
    const ep = endPaths[i] ?? sp;

    const sv = pathToVertices(sp);
    const ev = pathToVertices(ep);

    // Pad the shorter set with zero-movement records (repeat last vertex)
    const maxLen = Math.max(sv.length, ev.length);
    while (sv.length < maxLen) {
      sv.push({ ...sv[sv.length - 1] });
    }
    while (ev.length < maxLen) {
      ev.push({ ...ev[ev.length - 1] });
    }

    startVertexSets.push(sv);
    endVertexSets.push(ev);
  }

  // Encode start and end edge streams
  const startEdgeBytes = encodeMorphShapeEdges(
    startVertexSets,
    pathFillIndex,
    pathStrokeIndex,
    numFillBits,
    numLineBits
  );
  const endEdgeBytes = encodeMorphShapeEdges(
    endVertexSets,
    pathFillIndex,
    pathStrokeIndex,
    numFillBits,
    numLineBits
  );

  // Build fill/line style arrays in a temporary writer to get byte length
  const stylesBw = new BitWriter();
  writeMorphFillStyleArray(stylesBw, fills);
  writeMorphLineStyleArray(stylesBw, strokes);
  // NumFillBits / NumLineBits packed nibbles
  stylesBw.writeBits(numFillBits, 4);
  stylesBw.writeBits(numLineBits, 4);
  const stylesBytes = stylesBw.getBytes();

  // Offset = byte length of (styles + StartEdges)
  // The Offset field in DefineMorphShape is the byte offset from immediately
  // after the Offset field to the start of EndEdges.
  const offset = stylesBytes.length + startEdgeBytes.length;

  // Assemble the final tag body
  const bw = new BitWriter();

  // UI16 CharacterId
  bw.writeUI16LE(charId);

  // StartBounds RECT
  writeRect(bw, startBounds.xMin, startBounds.xMax, startBounds.yMin, startBounds.yMax);

  // EndBounds RECT
  writeRect(bw, endBounds.xMin, endBounds.xMax, endBounds.yMin, endBounds.yMax);

  // UI32 Offset (byte distance from here to EndEdges)
  bw.writeUI32LE(offset);

  // MORPHFILLSTYLEARRAY + MORPHLINESTYLEARRAY + NumFillBits/NumLineBits
  bw.writeBytes(stylesBytes);

  // StartEdges
  bw.writeBytes(startEdgeBytes);

  // EndEdges
  bw.writeBytes(endEdgeBytes);

  return bw.getBytes();
}

/**
 * Encode a PlaceObject2 tag body with HasRatio flag set, for placing a morph
 * shape at a specific interpolation point.
 *
 * PlaceObject2 flags:
 *   bit 0: HasMove      (0x01)
 *   bit 1: HasCharacter (0x02)
 *   bit 2: HasMatrix    (0x04)
 *   bit 3: HasColorTransform (0x08)
 *   bit 4: HasRatio     (0x10)
 *   bit 5: HasName      (0x20)
 *   bit 6: HasClipDepth (0x40)
 *   bit 7: HasClipActions (0x80)
 *
 * For first placement: HasCharacter | HasMatrix | HasRatio → 0x16
 * For subsequent frames (Move+HasRatio): HasMove | HasRatio → 0x11
 * (We always include HasMatrix for position.)
 *
 * @param charId  Character ID of the DefineMorphShape
 * @param depth   Display list depth
 * @param x       X position in pixels
 * @param y       Y position in pixels
 * @param ratio   Morph ratio 0..65535 (0 = start, 65535 = end)
 * @param move    If true, emit PlaceFlagMove (update existing object)
 */
export function encodePlaceObject2WithRatio(
  charId: number,
  depth: number,
  x: number,
  y: number,
  ratio: number,
  move = false
): Uint8Array {
  const bw = new BitWriter();

  // Flags: HasCharacter(0x02) | HasMatrix(0x04) | HasRatio(0x10) = 0x16
  // Move:  HasMove(0x01) | HasCharacter(0x02) | HasMatrix(0x04) | HasRatio(0x10) = 0x17
  const flags = move ? 0x17 : 0x16;
  bw.writeUI8(flags);

  // Depth UI16
  bw.writeUI16LE(depth);

  // CharacterId UI16 (always present — morph ratio frames always reference the char)
  bw.writeUI16LE(charId);

  // MATRIX — translation only (x, y in twips)
  const txTwips = px(x);
  const tyTwips = px(y);

  // hasScale = 0, hasRotate = 0
  bw.writeBits(0, 1); // no scale
  bw.writeBits(0, 1); // no rotate

  // Translate (unconditional)
  const nBits = Math.max(edgeNumBits([txTwips, tyTwips]), 2);
  bw.writeBits(nBits, 5);
  bw.writeBits(txTwips, nBits);
  bw.writeBits(tyTwips, nBits);
  bw.flushBits();

  // Ratio UI16
  bw.writeUI16LE(Math.max(0, Math.min(65535, Math.round(ratio))));

  return bw.getBytes();
}

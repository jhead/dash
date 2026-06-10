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
import type { ShapePath, ShapeHint, SolidFill, SolidStroke } from "@flash/core";
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

/** Map StrokeCap to SWF LineStyle2 cap bits (0=round, 1=none, 2=square). */
function capStyleBits(cap: string): number {
  if (cap === "none") return 1;
  if (cap === "square") return 2;
  return 0; // round (default)
}

/** Map StrokeJoin to SWF LineStyle2 join bits (0=round, 1=bevel, 2=miter). */
function joinStyleBits(join: string): number {
  if (join === "bevel") return 1;
  if (join === "miter") return 2;
  return 0; // round (default)
}

/**
 * Write a MORPHLINESTYLE2 array for DefineMorphShape2 (tag 84).
 *
 * MORPHLINESTYLE2 format per SWF spec:
 *   UI16  StartWidth (twips)
 *   UI16  EndWidth (twips)
 *   UI16  LineStyle2 flags (same bit layout as LINESTYLE2):
 *           [15:14] StartCapStyle, [13:12] JoinStyle, [11] HasFill, [10] NoHScale,
 *           [9] NoVScale, [8] PixelHinting, [7:6] reserved, [5] NoClose,
 *           [4:3] EndCapStyle, [2:0] reserved
 *   UI16  MiterLimitFactor (FLOAT16 = 8.8 fixed) — only present when JoinStyle=2
 *   RGBA  StartColor
 *   RGBA  EndColor
 */
function writeMorphLineStyle2Array(
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

    // LineStyle2 flags UI16 (big-endian byte order as in DefineShape4)
    const startCapBits = capStyleBits(se.startStroke.caps);
    const endCapBits = capStyleBits(se.startStroke.caps);
    const joinBits = joinStyleBits(se.startStroke.joints);
    const hasMiter = se.startStroke.joints === "miter";
    // Byte 1 (high): StartCap[7:6] | Join[5:4] | HasFill[3] | NoHScale[2] | NoVScale[1] | PixelHinting[0]
    // Byte 2 (low):  Reserved[7:3] | NoClose[2] | EndCap[1:0]
    const highByte =
      ((startCapBits & 0x3) << 6) |
      ((joinBits & 0x3) << 4);
    const lowByte = (endCapBits & 0x3);
    bw.writeUI8(highByte);
    bw.writeUI8(lowByte);

    // MiterLimitFactor (FLOAT16 = FIXED8 = 8.8 fixed point) only when JoinStyle=2 (miter)
    if (hasMiter) {
      const miterVal = Math.round(Math.max(1, se.startStroke.miterLimit) * 256);
      bw.writeUI16LE(miterVal & 0xffff);
    }

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

  // Type bit: 0 = not-edge (StyleChangeRecord)
  // Followed immediately by 5 flag bits, MSB-first:
  //   bit4=stateNewStyles, bit3=stateLineStyle, bit2=stateFillStyle1,
  //   bit1=stateFillStyle0, bit0=stateMoveTo
  bw.writeBits(0, 1); // isEdge = 0
  // State flags (5 bits, MSB-first)
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
 * @param isEndShape  When true, omit fill/line style references (end shape uses 0-bit style fields)
 */
function encodeMorphShapeEdges(
  vertexSets: Vertex[][],
  pathFillIndex: number[],
  pathStrokeIndex: number[],
  numFillBits: number,
  numLineBits: number,
  isEndShape = false
): Uint8Array {
  const bw = new BitWriter();

  for (let pi = 0; pi < vertexSets.length; pi++) {
    const verts = vertexSets[pi];
    if (verts.length === 0) continue;

    const fillIdx = isEndShape ? undefined : (pathFillIndex[pi] ?? 0);
    const strokeIdx = isEndShape ? undefined : (pathStrokeIndex[pi] ?? 0);

    // StyleChangeRecord: moveTo + style refs
    // For the end shape, omit fill/line style references entirely (0-bit style fields
    // per SWF spec; Ruffle reads end shape with num_fill_bits=0 and num_line_bits=0).
    writeMorphStyleChangeRecord(bw, {
      moveTo: { x: verts[0].x, y: verts[0].y },
      ...(fillIdx !== undefined ? { fillStyle0: fillIdx } : {}),
      ...(strokeIdx !== undefined ? { lineStyle: strokeIdx } : {}),
      numFillBits: isEndShape ? 0 : numFillBits,
      numLineBits: isEndShape ? 0 : numLineBits,
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
// Shape-hint vertex reordering
// ---------------------------------------------------------------------------

/**
 * Euclidean distance squared between two twip-space coordinates.
 */
function twipDistSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Find the index of the vertex in `verts` closest to the given position (in pixels).
 */
function closestVertexIdx(
  hintX: number,
  hintY: number,
  verts: Vertex[]
): number {
  const hx = px(hintX);
  const hy = px(hintY);
  let best = 0;
  let bestDist = twipDistSq(hx, hy, verts[0]!.x, verts[0]!.y);
  for (let i = 1; i < verts.length; i++) {
    const d = twipDistSq(hx, hy, verts[i]!.x, verts[i]!.y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Rotate a Vertex array so that the element at `pivotIdx` becomes index 0.
 * Assumes a closed path (the last vertex is a duplicate of the first after closing).
 */
function rotateVertices(verts: Vertex[], pivotIdx: number): Vertex[] {
  if (pivotIdx === 0 || verts.length <= 1) return verts;
  // For closed paths, vertex[0] and vertex[verts.length-1] are the same point.
  // Rotate the interior vertices (0..n-2), then re-append the new first vertex as last.
  const interior = verts.slice(0, verts.length - 1); // drop closing duplicate
  const rotated = [...interior.slice(pivotIdx), ...interior.slice(0, pivotIdx)];
  rotated.push({ ...rotated[0]! }); // re-close
  return rotated;
}

/**
 * Build hint correspondence pairs from start and end hint arrays (matched by id).
 */
function buildHintPairs(
  startHints: readonly ShapeHint[],
  endHints: readonly ShapeHint[]
): Array<{ start: ShapeHint; end: ShapeHint }> {
  const pairs: Array<{ start: ShapeHint; end: ShapeHint }> = [];
  for (const sh of startHints) {
    const eh = endHints.find((h) => h.id === sh.id);
    if (eh) pairs.push({ start: sh, end: eh });
  }
  return pairs;
}

/**
 * Reorder parallel vertex sets for a single path pair using the first matched
 * hint pair as the rotation anchor.  Only applied to closed paths (where
 * vertex rotation makes semantic sense); open paths are returned unchanged.
 *
 * Both `sv` and `ev` are mutated in-place (they are already local copies).
 */
function applyHintsToVertexSets(
  sv: Vertex[],
  ev: Vertex[],
  isClosedPath: boolean,
  pairs: Array<{ start: ShapeHint; end: ShapeHint }>
): void {
  if (!isClosedPath || pairs.length === 0 || sv.length <= 1) return;

  const primary = pairs[0]!;

  // Find the best-matching vertex index for the start and end hint positions
  const startPivot = closestVertexIdx(primary.start.x, primary.start.y, sv);
  const endPivot = closestVertexIdx(primary.end.x, primary.end.y, ev);

  // Rotate both arrays so their pivot vertex lands at index 0
  const rotatedSv = rotateVertices(sv, startPivot);
  const rotatedEv = rotateVertices(ev, endPivot);

  // After rotation the lengths may differ if padding happened; re-pad to same length
  const maxLen = Math.max(rotatedSv.length, rotatedEv.length);
  while (rotatedSv.length < maxLen) {
    rotatedSv.push({ ...rotatedSv[rotatedSv.length - 1]! });
  }
  while (rotatedEv.length < maxLen) {
    rotatedEv.push({ ...rotatedEv[rotatedEv.length - 1]! });
  }

  // Copy back into the original arrays (in-place replacement).
  // Snapshot first in case rotatedSv/rotatedEv is the same array reference as sv/ev
  // (which happens when pivotIdx === 0 and rotateVertices returns the original array).
  const snapSv = rotatedSv.slice();
  const snapEv = rotatedEv.slice();
  sv.length = 0;
  ev.length = 0;
  for (const v of snapSv) sv.push(v);
  for (const v of snapEv) ev.push(v);
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
 *
 * @deprecated Use encodeDefineMorphShape2 (tag 84) for Flash 8 targets, which
 *   preserves LINESTYLE2 cap/join data.
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

  // Encode start and end edge streams.
  // The start shape uses the declared numFillBits/numLineBits for style references.
  // The end shape uses 0-bit style fields per SWF spec: Ruffle reads the end shape
  // with num_fill_bits=0 and num_line_bits=0, so StyleChangeRecords must not include
  // fill or line style index bits. Pass isEndShape=true to omit them.
  const startEdgeBytes = encodeMorphShapeEdges(
    startVertexSets,
    pathFillIndex,
    pathStrokeIndex,
    numFillBits,
    numLineBits,
    false
  );
  const endEdgeBytes = encodeMorphShapeEdges(
    endVertexSets,
    pathFillIndex,
    pathStrokeIndex,
    numFillBits,
    numLineBits,
    true  // isEndShape: omit fill/line style bits
  );

  // Build fill/line style arrays in a temporary writer to get byte length
  const stylesBw = new BitWriter();
  writeMorphFillStyleArray(stylesBw, fills);
  writeMorphLineStyleArray(stylesBw, strokes);
  // NumFillBits / NumLineBits packed nibbles (for start shape only)
  stylesBw.writeBits(numFillBits, 4);
  stylesBw.writeBits(numLineBits, 4);
  const stylesBytes = stylesBw.getBytes();

  // Offset = byte length of (styles + StartEdges + end-shape nibble byte).
  // The Offset field in DefineMorphShape is the byte offset from immediately
  // after the Offset field to the start of EndEdges (i.e. after the 0x00 nibble).
  const offset = stylesBytes.length + startEdgeBytes.length + 1;

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

  // MORPHFILLSTYLEARRAY + MORPHLINESTYLEARRAY + NumFillBits/NumLineBits (start shape)
  bw.writeBytes(stylesBytes);

  // StartEdges
  bw.writeBytes(startEdgeBytes);

  // End-shape NumFillBits/NumLineBits nibble — MUST be 0x00 per SWF spec.
  // Ruffle reads this byte and discards it (hardcodes num_fill_bits=0 for end shape).
  // Flash Player uses the offset field above to seek here directly.
  bw.writeUI8(0x00);

  // EndEdges (encoded with isEndShape=true: no fill/line style bits in StyleChangeRecords)
  bw.writeBytes(endEdgeBytes);

  return bw.getBytes();
}

/**
 * Encode a DefineMorphShape2 (tag 84) tag body.
 *
 * DefineMorphShape2 differs from DefineMorphShape (tag 46) in two ways:
 *   1. Two extra RECT fields after EndBounds: StartEdgeBounds and EndEdgeBounds.
 *   2. A UI8 flags field (UsesNonScalingStrokes bit 0, UsesScalingStrokes bit 1).
 *   3. MORPHLINESTYLE2 records instead of MORPHLINESTYLE1, preserving cap/join data.
 *
 * Tag 84 is required for Flash 8 targets so LINESTYLE2 cap/join/miter data is
 * not silently dropped by the player.
 *
 * @param charId      SWF character ID for this morph shape
 * @param startPaths  Shape paths for the start keyframe
 * @param endPaths    Shape paths for the end keyframe
 * @param startHints  Shape hints from the start keyframe (optional; used to reorder vertices)
 * @param endHints    Shape hints from the end keyframe (optional; paired with startHints)
 * @returns           Tag body bytes (without SWF record header)
 */
export function encodeDefineMorphShape2(
  charId: number,
  startPaths: readonly ShapePath[],
  endPaths: readonly ShapePath[],
  startHints?: readonly ShapeHint[] | null,
  endHints?: readonly ShapeHint[] | null
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

  // Collect style information from start/end paths
  const { fills, strokes, pathFillIndex, pathStrokeIndex } = collectStyles(
    startPaths,
    endPaths
  );

  const numFillBits = fills.length > 0 ? Math.ceil(Math.log2(fills.length + 1)) : 1;
  const numLineBits = strokes.length > 0 ? Math.ceil(Math.log2(strokes.length + 1)) : 1;

  // Build parallel vertex sets
  const pathCount = startPaths.length;
  const startVertexSets: Vertex[][] = [];
  const endVertexSets: Vertex[][] = [];

  // Compute hint pairs once (if any hints are present)
  const hintPairs =
    startHints && startHints.length > 0 && endHints && endHints.length > 0
      ? buildHintPairs(startHints, endHints)
      : [];

  for (let i = 0; i < pathCount; i++) {
    const sp = startPaths[i]!;
    const ep = endPaths[i] ?? sp;

    const sv = pathToVertices(sp);
    const ev = pathToVertices(ep);

    const maxLen = Math.max(sv.length, ev.length);
    while (sv.length < maxLen) sv.push({ ...sv[sv.length - 1]! });
    while (ev.length < maxLen) ev.push({ ...ev[ev.length - 1]! });

    // Apply hint-based vertex reordering when hints are available
    if (hintPairs.length > 0) {
      applyHintsToVertexSets(sv, ev, sp.closed, hintPairs);
    }

    startVertexSets.push(sv);
    endVertexSets.push(ev);
  }

  // Encode start and end edge streams.
  // The start shape uses the declared numFillBits/numLineBits for style references.
  // The end shape uses 0-bit style fields per SWF spec: Ruffle reads the end shape
  // with num_fill_bits=0 and num_line_bits=0, so StyleChangeRecords must not include
  // fill or line style index bits. Pass isEndShape=true to omit them.
  const startEdgeBytes = encodeMorphShapeEdges(
    startVertexSets,
    pathFillIndex,
    pathStrokeIndex,
    numFillBits,
    numLineBits,
    false
  );
  const endEdgeBytes = encodeMorphShapeEdges(
    endVertexSets,
    pathFillIndex,
    pathStrokeIndex,
    numFillBits,
    numLineBits,
    true  // isEndShape: omit fill/line style bits
  );

  // Build style arrays using MORPHLINESTYLE2 format
  const stylesBw = new BitWriter();
  writeMorphFillStyleArray(stylesBw, fills);
  writeMorphLineStyle2Array(stylesBw, strokes);
  // NumFillBits / NumLineBits packed nibbles (for start shape only)
  stylesBw.writeBits(numFillBits, 4);
  stylesBw.writeBits(numLineBits, 4);
  const stylesBytes = stylesBw.getBytes();

  // Offset = byte length of (styles + StartEdges + end-shape nibble byte).
  // The Offset field points from after the Offset field to the start of EndEdges
  // (i.e. after the 0x00 nibble byte that precedes the end shape records).
  const offset = stylesBytes.length + startEdgeBytes.length + 1;

  // Assemble the final tag body
  const bw = new BitWriter();

  // UI16 CharacterId
  bw.writeUI16LE(charId);

  // StartBounds RECT
  writeRect(bw, startBounds.xMin, startBounds.xMax, startBounds.yMin, startBounds.yMax);

  // EndBounds RECT
  writeRect(bw, endBounds.xMin, endBounds.xMax, endBounds.yMin, endBounds.yMax);

  // StartEdgeBounds RECT (same as StartBounds for simple shapes)
  writeRect(bw, startBounds.xMin, startBounds.xMax, startBounds.yMin, startBounds.yMax);

  // EndEdgeBounds RECT (same as EndBounds for simple shapes)
  writeRect(bw, endBounds.xMin, endBounds.xMax, endBounds.yMin, endBounds.yMax);

  // UI8 Flags (bit 0 = UsesNonScalingStrokes, bit 1 = UsesScalingStrokes)
  // Use bit 1 (UsesScalingStrokes) for standard strokes.
  bw.writeUI8(0x02);

  // UI32 Offset (byte distance from here to EndEdges, i.e. after the 0x00 nibble)
  bw.writeUI32LE(offset);

  // MORPHFILLSTYLEARRAY + MORPHLINESTYLE2ARRAY + NumFillBits/NumLineBits (start shape)
  bw.writeBytes(stylesBytes);

  // StartEdges
  bw.writeBytes(startEdgeBytes);

  // End-shape NumFillBits/NumLineBits nibble — MUST be 0x00 per SWF spec.
  // Ruffle reads this byte and discards it (hardcodes num_fill_bits=0 for end shape).
  // Flash Player seeks to this position using the Offset field above.
  bw.writeUI8(0x00);

  // EndEdges (encoded with isEndShape=true: no fill/line style bits in StyleChangeRecords)
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

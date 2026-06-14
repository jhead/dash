/**
 * SWF shape encoding — DefineShape4 and PlaceObject2 tag bodies.
 *
 * DefineShape4 (tag 83) encodes vector shapes with fill/stroke styles and
 * bit-packed shape records (StraightEdge, CurvedEdge, StyleChange, EndShape).
 *
 * Coordinates: the SWF format uses "twips" (1 pixel = 20 twips).
 */
import { BitWriter } from "./bits.js";
import type { ClipAction, Fill, Shape, ShapePath, SolidStroke } from "@flash/core";
import { toSWFMatrix, composeMatrix, compileAS2 } from "@flash/core";
import { px, edgeNumBits, writeRect } from "./helpers.js";
import { encodeCxformWithAlpha, encodeCXFormWithAlpha } from "./cxform.js";
import type { CXForm } from "./cxform.js";

// ---------------------------------------------------------------------------
// Bounding box computation
// ---------------------------------------------------------------------------

interface BoundingBox {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

function computeBounds(paths: readonly ShapePath[]): BoundingBox {
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
        // curve
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
// Shape records (bit-packed)
// ---------------------------------------------------------------------------

/**
 * Write a StyleChangeRecord.
 *
 * Bit layout:
 *   UB[1] = 0  (not an edge)
 *   UB[1] = 0  (not end-of-shape)
 *   UB[1] stateNewStyles
 *   UB[1] stateLineStyle
 *   UB[1] stateFillStyle1
 *   UB[1] stateFillStyle0
 *   UB[1] stateMoveTo
 *
 * Then conditional fields:
 *   if stateMoveTo: UB[5] moveBits, SB[moveBits] dx, SB[moveBits] dy
 *   if stateFillStyle0: UB[fillBits] index
 *   if stateFillStyle1: UB[fillBits] index
 *   if stateLineStyle: UB[lineBits] index
 *   if stateNewStyles: FILLSTYLEARRAY, LINESTYLEARRAY, UB[4] fillBits, UB[4] lineBits
 *
 * numFillBits/numLineBits: current bit widths for style indices.
 * (for our MVP we use 4 bits for each, supporting up to 15 styles)
 */
function writeStyleChangeRecord(
  bw: BitWriter,
  options: {
    moveTo?: { x: number; y: number };
    fillStyle0?: number;  // 1-based index (or 0 to clear); undefined = don't touch
    lineStyle?: number;   // 1-based index (or 0 to clear); undefined = don't touch
    numFillBits: number;
    numLineBits: number;
  }
): void {
  const stateMoveTo = options.moveTo !== undefined ? 1 : 0;
  // Always emit the state bit when an explicit value (including 0) is provided
  const stateFillStyle0 = options.fillStyle0 !== undefined ? 1 : 0;
  const stateLineStyle = options.lineStyle !== undefined ? 1 : 0;
  // stateNewStyles and stateFillStyle1 are unused for our simple case
  const stateNewStyles = 0;
  const stateFillStyle1 = 0;

  // Type bit: 0 (non-edge record)
  bw.writeBits(0, 1);
  // State flags
  bw.writeBits(stateNewStyles, 1);
  bw.writeBits(stateLineStyle, 1);
  bw.writeBits(stateFillStyle1, 1);
  bw.writeBits(stateFillStyle0, 1);
  bw.writeBits(stateMoveTo, 1);

  if (stateMoveTo) {
    const { x, y } = options.moveTo!;
    // Determine moveBits: min bits to represent both x and y as signed
    const moveBits = Math.max(edgeNumBits([x, y]), 2);
    bw.writeBits(moveBits, 5);
    bw.writeBits(x, moveBits);
    bw.writeBits(y, moveBits);
  }

  if (stateFillStyle0) {
    bw.writeBits(options.fillStyle0!, options.numFillBits);
  }

  if (stateFillStyle1) {
    // not used currently
  }

  if (stateLineStyle) {
    bw.writeBits(options.lineStyle!, options.numLineBits);
  }
}

/**
 * Write a StraightEdgeRecord.
 *
 * Bit layout:
 *   UB[1] = 1  (edge record)
 *   UB[1] = 1  (straight edge)
 *   UB[4] numBits (bits per delta - 2, so actual bits = numBits+2; range 0..15 => 2..17)
 *   UB[1] generalLineFlag (1 = both x and y, 0 = one axis only)
 *   if !generalLineFlag: UB[1] vertLineFlag
 *   SB[numBits+2] deltaX (if generalLineFlag or !vertLineFlag)
 *   SB[numBits+2] deltaY (if generalLineFlag or vertLineFlag)
 */
function writeStraightEdge(bw: BitWriter, dx: number, dy: number): void {
  const numBits = edgeNumBits([dx, dy]);
  const storedBits = numBits - 2; // stored value is numBits - 2

  bw.writeBits(1, 1); // edge record
  bw.writeBits(1, 1); // straight edge

  bw.writeBits(storedBits, 4); // numBits field

  const isGeneral = dx !== 0 && dy !== 0;
  const isVertical = dx === 0 && dy !== 0;

  if (isGeneral) {
    bw.writeBits(1, 1); // generalLineFlag
    bw.writeBits(dx, numBits);
    bw.writeBits(dy, numBits);
  } else if (isVertical) {
    bw.writeBits(0, 1); // generalLineFlag = 0
    bw.writeBits(1, 1); // vertLineFlag = 1
    bw.writeBits(dy, numBits);
  } else {
    // horizontal (or dx=0,dy=0 — degenerate, treat as horizontal)
    bw.writeBits(0, 1); // generalLineFlag = 0
    bw.writeBits(0, 1); // vertLineFlag = 0
    bw.writeBits(dx, numBits);
  }
}

/**
 * Write a CurvedEdgeRecord.
 *
 * Bit layout:
 *   UB[1] = 1  (edge record)
 *   UB[1] = 0  (curved edge)
 *   UB[4] numBits (actual bits = numBits+2)
 *   SB[numBits+2] controlDeltaX
 *   SB[numBits+2] controlDeltaY
 *   SB[numBits+2] anchorDeltaX
 *   SB[numBits+2] anchorDeltaY
 */
function writeCurvedEdge(
  bw: BitWriter,
  cdx: number,
  cdy: number,
  adx: number,
  ady: number
): void {
  const numBits = edgeNumBits([cdx, cdy, adx, ady]);
  const storedBits = numBits - 2;

  bw.writeBits(1, 1); // edge record
  bw.writeBits(0, 1); // curved edge

  bw.writeBits(storedBits, 4);
  bw.writeBits(cdx, numBits);
  bw.writeBits(cdy, numBits);
  bw.writeBits(adx, numBits);
  bw.writeBits(ady, numBits);
}

/**
 * Write the EndShapeRecord: 6 zero bits followed by bit flush.
 */
function writeEndShapeRecord(bw: BitWriter): void {
  bw.writeBits(0, 6);
  bw.flushBits();
}

// ---------------------------------------------------------------------------
// Fill and stroke style helpers
// ---------------------------------------------------------------------------

/**
 * Write a SWF MATRIX for a gradient fill (bit-packed).
 * Values a/b/c/d are 16.16 fixed-point integers; tx/ty are in twips.
 */
function writeGradientMatrix(
  bw: BitWriter,
  a: number,
  b: number,
  c: number,
  d: number,
  tx: number,
  ty: number
): void {
  // hasScale (a/d != identity 65536 or any rotation present): always write scale+rotate
  bw.writeBits(1, 1); // hasScale = 1
  const scaleBits = Math.max(edgeNumBits([a, d]), 2);
  bw.writeBits(scaleBits, 5);
  bw.writeBits(a, scaleBits);
  bw.writeBits(d, scaleBits);

  // hasRotate: write if b or c are non-zero
  const hasRotate = b !== 0 || c !== 0;
  bw.writeBits(hasRotate ? 1 : 0, 1);
  if (hasRotate) {
    const rotateBits = Math.max(edgeNumBits([b, c]), 2);
    bw.writeBits(rotateBits, 5);
    bw.writeBits(b, rotateBits);
    bw.writeBits(c, rotateBits);
  }

  // Translate (unconditional)
  const transBits = Math.max(edgeNumBits([tx, ty]), 2);
  bw.writeBits(transBits, 5);
  bw.writeBits(tx, transBits);
  bw.writeBits(ty, transBits);

  bw.flushBits();
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

/** LINESTYLE2 flag bytes for a model stroke (DefineShape4 / DefineMorphShape2).
 *
 * SWF LINESTYLE2 flags are a UI16 written little-endian. The first (low) byte
 * contains bits 0-7, the second (high) byte contains bits 8-15. From Ruffle's
 * LineStyleFlag (types.rs):
 *   bit  0: PixelHinting
 *   bit  1: NoVScale
 *   bit  2: NoHScale
 *   bit  3: HasFill
 *   bits 5-4: JoinStyle (0=round, 1=bevel, 2=miter)
 *   bits 7-6: StartCapStyle (0=round, 1=none, 2=square)
 *   bits 9-8: EndCapStyle (0=round, 1=none, 2=square)  [second byte bits 1-0]
 *   bit  10: NoClose  [second byte bit 2]
 *
 * We write the two bytes individually (highByte = first/low byte, lowByte =
 * second/high byte) matching the existing convention in this file.
 */
function lineStyle2FlagBytes(s: SolidStroke): { highByte: number; lowByte: number } {
  const startCapBits = capStyleBits(s.caps);
  const endCapBits = capStyleBits(s.caps);
  const joinBits = joinStyleBits(s.joints);
  const isHairline = s.strokeType === "hairline";

  // Compute NoHScale / NoVScale bits from strokeScaleMode (or hairline fallback).
  // strokeScaleMode:
  //   "none"       → NoHScale (bit 2) + NoVScale (bit 1)
  //   "vertical"   → NoHScale (bit 2)     [only vertical scaling → no H scaling in SWF]
  //   "horizontal" → NoVScale (bit 1)     [only horizontal scaling → no V scaling in SWF]
  //   "normal"     → no flags
  let noHScale = false;
  let noVScale = false;
  if (isHairline) {
    // Hairline always gets NoHScale + NoVScale so it stays 1px at any zoom.
    noHScale = true;
    noVScale = true;
  } else if (s.strokeScaleMode) {
    noHScale = s.strokeScaleMode === "none" || s.strokeScaleMode === "vertical";
    noVScale = s.strokeScaleMode === "none" || s.strokeScaleMode === "horizontal";
  }

  const pixelHintingBit = s.pixelHinting ? 0x01 : 0;
  const noVScaleBit = noVScale ? 0x02 : 0;
  const noHScaleBit = noHScale ? 0x04 : 0;

  // highByte = first (low) byte of the LE u16 = bits 0-7
  const highByte =
    ((startCapBits & 0x3) << 6) |
    ((joinBits & 0x3) << 4) |
    noHScaleBit |
    noVScaleBit |
    pixelHintingBit;
  // lowByte = second (high) byte of the LE u16 = bits 8-15
  const lowByte = endCapBits & 0x3;
  return { highByte, lowByte };
}

function strokeWidthTwips(s: SolidStroke): number {
  return s.strokeType === "hairline" ? 0 : px(s.width);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a single Shape as a DefineShape4 tag body (without the tag header).
 *
 * The shape's coordinate space is pixel-relative; the shape is placed at the
 * origin for the character definition — placement is handled by PlaceObject2.
 *
 * @param charId          SWF character ID for this shape
 * @param shape           The vector shape to encode
 * @param bitmapCharIdMap Optional map from BitmapFill.bitmapId (library item id) to
 *                        the SWF character ID of the corresponding DefineBits tag.
 *                        Required for shapes that contain bitmap fills.
 */
/**
 * Maximum coordinate value (in pixels) that a valid SWF shape path point can have.
 * SWF RECT fields use up to 17 signed bits → ±65,535 twips → ±3,276 pixels.
 * Flash's maximum stage size is 2880×2880 px, so any coordinate outside ±65,535 px
 * is clearly garbage (e.g. from a corrupt FLA binary import).
 */
const MAX_SHAPE_COORD_PX = 65535;

/**
 * Returns true if a path has any coordinate outside the valid SWF range.
 * Such paths are silently dropped to prevent corrupt bit-stream output.
 */
function isDegenerate(path: ShapePath): boolean {
  function badCoord(v: number): boolean {
    return !isFinite(v) || Math.abs(v) > MAX_SHAPE_COORD_PX;
  }
  if (badCoord(path.start.x) || badCoord(path.start.y)) return true;
  for (const seg of path.segments) {
    if (badCoord(seg.to.x) || badCoord(seg.to.y)) return true;
    if (seg.type === "curve" && (badCoord(seg.control.x) || badCoord(seg.control.y))) return true;
  }
  return false;
}

export function encodeDefineShape4(
  charId: number,
  shape: Shape,
  bitmapCharIdMap?: Map<string, number>
): Uint8Array {
  const bw = new BitWriter();

  // Filter out paths with out-of-range coordinates (can arise from FLA binary import
  // corruption). Such paths produce malformed bit streams that Ruffle rejects as
  // "Invalid fill style" when it misinterprets the garbage bits as stateNewStyles=1.
  const validPaths = shape.paths.filter((p) => !isDegenerate(p));
  const filteredShape: Shape = validPaths.length === shape.paths.length
    ? shape
    : { ...shape, paths: validPaths };

  // --- UI16 character ID ---
  bw.writeUI16LE(charId);

  // --- Compute bounding box in twips ---
  // EdgeBounds is the tight bound of the edge geometry (no stroke). ShapeBounds
  // additionally includes the stroke extent: Flash 8 grows the bound by half the
  // maximum stroke width on each side (a centered stroke of width W extends W/2
  // beyond the edge). Without this the published ShapeBounds came out a half-stroke
  // too small vs golden (e.g. a r=210-twip circle with a 20-twip stroke is ±220,
  // not ±210). EdgeBounds stays tight, matching real Flash DefineShape4 output.
  const bounds = computeBounds(filteredShape.paths);
  let maxStrokeTwips = 0;
  for (const path of filteredShape.paths) {
    if (path.stroke && path.stroke.type === "solid") {
      const w = strokeWidthTwips(path.stroke);
      if (w > maxStrokeTwips) maxStrokeTwips = w;
    }
  }
  const halfStroke = Math.ceil(maxStrokeTwips / 2);
  const xMinTwips = px(bounds.xMin);
  const xMaxTwips = px(bounds.xMax);
  const yMinTwips = px(bounds.yMin);
  const yMaxTwips = px(bounds.yMax);

  // ShapeBounds RECT (geometry + stroke extent)
  writeRect(
    bw,
    xMinTwips - halfStroke,
    xMaxTwips + halfStroke,
    yMinTwips - halfStroke,
    yMaxTwips + halfStroke,
  );
  // EdgeBounds RECT (tight geometry, no stroke)
  writeRect(bw, xMinTwips, xMaxTwips, yMinTwips, yMaxTwips);

  // --- UI8 flags: 0x00 (no non-scaling stroke, no pixel hinting) ---
  bw.writeUI8(0x00);

  // --- For each path, collect fill/stroke info ---
  // We encode path-by-path; each path gets its own style change record.
  // For simplicity, we enumerate per-path. But to emit correct style arrays
  // we need to know upfront. We'll build globally for the whole shape,
  // but for DefineShape4 all style arrays can be redefined via stateNewStyles.
  //
  // Simpler approach: encode all paths together in the shape record stream.
  // Emit ONE global fill style array and line style array that lists all
  // unique styles encountered, then reference by index.
  //
  // For MVP: collect all fills and strokes (de-duplicate by reference).
  // We use simple sequential style indices.

  interface FillEntry {
    fill: Fill;
    index: number;
  }
  interface StrokeEntry {
    stroke: SolidStroke;
    index: number;
  }

  const fills: FillEntry[] = [];
  const strokes: StrokeEntry[] = [];

  // Map from path index to fill/stroke style indices (1-based; 0 = none)
  const pathFillIndex: number[] = [];
  const pathStrokeIndex: number[] = [];

  for (const path of filteredShape.paths) {
    // Fill — support solid, linear-gradient, radial-gradient, bitmap
    if (path.fill) {
      const fill = path.fill;
      // For deduplication: use JSON key for gradients, color-key for solid,
      // bitmapId for bitmap fills
      let found: FillEntry | undefined;
      if (fill.type === "solid") {
        const c = fill.color;
        found = fills.find(
          (f) =>
            f.fill.type === "solid" &&
            f.fill.color.r === c.r &&
            f.fill.color.g === c.g &&
            f.fill.color.b === c.b &&
            f.fill.color.a === c.a
        );
      } else if (fill.type === "bitmap") {
        // Deduplicate bitmap fills by id + repeat + smooth + matrix
        found = fills.find(
          (f) => {
            if (f.fill.type !== "bitmap") return false;
            if (f.fill.bitmapId !== fill.bitmapId) return false;
            if (f.fill.repeat !== fill.repeat) return false;
            if (f.fill.smooth !== fill.smooth) return false;
            // Two fills with different matrices must not be deduplicated
            const ma = f.fill.matrix;
            const mb = fill.matrix;
            if (!ma && !mb) return true;
            if (!ma || !mb) return false;
            return ma.a === mb.a && ma.b === mb.b && ma.c === mb.c && ma.d === mb.d &&
              ma.tx === mb.tx && ma.ty === mb.ty;
          }
        );
      } else {
        // Gradient fills are not deduplicated (each path gets its own entry)
        found = undefined;
      }
      if (!found) {
        found = { fill, index: fills.length + 1 };
        fills.push(found);
      }
      pathFillIndex.push(found.index);
    } else {
      pathFillIndex.push(0);
    }

    // Stroke
    if (path.stroke && path.stroke.type === "solid") {
      const s = path.stroke;
      const c = s.color;
      // Warn when the stroke has a non-solid visual style (dashed/dotted/ragged/stippled/hatched).
      // The SWF LINESTYLE2 format has no native encoding for these patterns — they are a
      // Flash authoring UI concept only.  Ruffle and all other SWF players render LINESTYLE2
      // as a solid stroke regardless; the visual style is preserved only in the Canvas renderer
      // (renderer.ts applyStrokeDashStyle).  We emit a solid stroke as the best approximation.
      if (s.style && s.style.type !== "solid") {
        console.warn(
          `[SWF encoder] Non-solid stroke style "${s.style.type}" cannot be encoded in LINESTYLE2. ` +
          `Falling back to solid stroke. The dash/dot/hatch pattern will not appear in the published SWF.`
        );
      }
      // Deduplication key includes the stroke style type so that two paths whose strokes
      // differ only in their visual pattern are not collapsed into the same LINESTYLE2 entry.
      // (They still both encode as solid strokes, but keeping them separate is semantically
      // correct and avoids unexpected style bleed if the encoder is extended in the future.)
      const styleType = s.style?.type ?? "solid";
      let found = strokes.find(
        (st) =>
          st.stroke.color.r === c.r &&
          st.stroke.color.g === c.g &&
          st.stroke.color.b === c.b &&
          st.stroke.color.a === c.a &&
          st.stroke.width === s.width &&
          (st.stroke.strokeType ?? "solid") === (s.strokeType ?? "solid") &&
          st.stroke.caps === s.caps &&
          st.stroke.joints === s.joints &&
          st.stroke.miterLimit === s.miterLimit &&
          (st.stroke.style?.type ?? "solid") === styleType
      );
      if (!found) {
        found = { stroke: s, index: strokes.length + 1 };
        strokes.push(found);
      }
      pathStrokeIndex.push(found.index);
    } else {
      pathStrokeIndex.push(0);
    }
  }

  // --- FILLSTYLEARRAY ---
  if (fills.length >= 0xff) {
    bw.writeUI8(0xff);
    bw.writeUI16LE(fills.length);
  } else {
    bw.writeUI8(fills.length);
  }
  for (const fe of fills) {
    const fill = fe.fill;
    if (fill.type === "solid") {
      bw.writeUI8(0x00); // solid fill type
      bw.writeUI8(fill.color.r);
      bw.writeUI8(fill.color.g);
      bw.writeUI8(fill.color.b);
      bw.writeUI8(fill.color.a);
    } else if (fill.type === "bitmap") {
      // Bitmap fill types (SWF spec §2.4.2.2, per ruffle write.rs):
      //   0x40 = repeating bitmap, smoothed
      //   0x41 = clipped bitmap, smoothed
      //   0x42 = repeating bitmap, no smoothing
      //   0x43 = clipped bitmap, no smoothing
      let fillTypeByte: number;
      if (fill.repeat && fill.smooth) fillTypeByte = 0x40;
      else if (fill.repeat && !fill.smooth) fillTypeByte = 0x42;
      else if (!fill.repeat && fill.smooth) fillTypeByte = 0x41;
      else fillTypeByte = 0x43;
      bw.writeUI8(fillTypeByte);

      // BitmapId: UI16 — the SWF character ID of the DefineBits tag
      const bitmapCharId = bitmapCharIdMap?.get(fill.bitmapId) ?? 0xffff;
      bw.writeUI16LE(bitmapCharId);

      // BitmapMatrix: maps bitmap pixel space to shape space (twips).
      // The FLA fill matrix (if present) is in pixel space; multiply by 20 to convert to twips.
      if (fill.matrix) {
        const m = fill.matrix;
        const TWIPS = 20;
        writeBitmapFillMatrix(bw, m.a * TWIPS, m.b * TWIPS, m.c * TWIPS, m.d * TWIPS,
          Math.round(m.tx * TWIPS), Math.round(m.ty * TWIPS));
      } else {
        writeBitmapMatrix(bw, 20, 0, 0);
      }
    } else {
      // Gradient fill: linear (0x10) or radial (0x12) / focal radial (0x13)
      const isLinear = fill.type === "linear-gradient";
      const isFocal =
        fill.type === "radial-gradient" &&
        fill.focalPoint !== 0;
      const fillTypeByte = isLinear ? 0x10 : isFocal ? 0x13 : 0x12;
      bw.writeUI8(fillTypeByte);

      // Gradient matrix: maps gradient space (-16384..16384 twips) to shape space.
      //
      // When the fill carries an explicit matrix (preserved from FLA import), convert it
      // directly. The FLA binary stores the gradient matrix a/b/c/d in the SAME 16.16
      // fixed-point units as SWF (the FLA reader divides the raw int by 65536, so the
      // model floats ARE the SWF MATRIX float values). tx/ty are stored in pixels.
      //
      // Verified against the golden FLA/SWF pair (task 1198): the PlayButton face
      // gradient has model matrix {a:0, b:0.0244140625, c:-0.0750732421875, d:0,
      // tx:0.05, ty:6}, and golden.swf's published gradient MATRIX decodes to the
      // IDENTICAL floats {scaleX:0, skew0:0.0244140625, skew1:-0.0750732421875,
      // scaleY:0, translateX:1twip, translateY:120twip}. So the conversion is a plain
      // 16.16 scale for a/b/c/d and px→twips for tx/ty:
      //   SWF_a_fixed = round(model_a * 65536)
      //   SWF_tx      = round(model_tx * 20)   [pixels → twips]
      //
      // (The previous *80 factor assumed a/b/c/d were "pixels per ±1 gradient unit";
      // that collapsed the matrix to ~0, making the gradient render solid/non-smooth.)
      //
      // When no matrix is present (authoring-UI gradient), auto-fit to the bounding box.

      let a: number, b: number, c: number, d: number, tx: number, ty: number;
      if (fill.matrix) {
        // Explicit matrix from FLA import — a/b/c/d are already SWF 16.16 float values.
        a = Math.round(fill.matrix.a * 65536);
        b = Math.round(fill.matrix.b * 65536);
        c = Math.round(fill.matrix.c * 65536);
        d = Math.round(fill.matrix.d * 65536);
        tx = Math.round(fill.matrix.tx * 20);
        ty = Math.round(fill.matrix.ty * 20);
      } else {
        // Auto-fit gradient to the shape bounding box.
        const cx = (xMinTwips + xMaxTwips) / 2;
        const cy = (yMinTwips + yMaxTwips) / 2;
        const halfW = (xMaxTwips - xMinTwips) / 2;
        const halfH = (yMaxTwips - yMinTwips) / 2;
        // Gradient space is ±16384 twips; scale factor maps that to shape space
        const GRAD_HALF = 16384;

        if (isLinear) {
          const angleRad = ((fill.angle ?? 0) * Math.PI) / 180;
          const cosA = Math.cos(angleRad);
          const sinA = Math.sin(angleRad);
          // Compute independent scale factors for the gradient axes.
          //
          // The SWF canonical gradient space spans ±16384 twips.  The MATRIX
          // maps gradient-space (x_g, y_g) → shape-space (x_s, y_s):
          //
          //   x_s = a*x_g + c*y_g + tx
          //   y_s = b*x_g + d*y_g + ty
          //
          // For a gradient at angle θ we construct a rotation-scale matrix where:
          //   • scaleX = scale along the gradient direction (covers shape projection)
          //   • scaleY = scale perpendicular to gradient direction
          //
          // Both are computed from the shape's bounding box via independent
          // projections so rectangular shapes get a properly fitted gradient.
          const scaleX = (Math.abs(cosA) * halfW + Math.abs(sinA) * halfH) / GRAD_HALF;
          const scaleY = (Math.abs(sinA) * halfW + Math.abs(cosA) * halfH) / GRAD_HALF;
          // a = scaleX*cosA  (x_g along gradient direction → shape x)
          // b = scaleX*sinA  (x_g along gradient direction → shape y)
          // c = -scaleY*sinA (y_g perpendicular → shape x)
          // d =  scaleY*cosA (y_g perpendicular → shape y)
          a = Math.round(cosA * scaleX * 65536);
          b = Math.round(sinA * scaleX * 65536);
          c = Math.round(-sinA * scaleY * 65536);
          d = Math.round(cosA * scaleY * 65536);
        } else {
          // Radial: scale to cover the circle of radius = max(halfW, halfH)
          const radius = Math.max(halfW, halfH);
          const scale = radius / GRAD_HALF;
          a = Math.round(scale * 65536);
          b = 0;
          c = 0;
          d = Math.round(scale * 65536);
        }
        tx = Math.round(cx);
        ty = Math.round(cy);
      }

      // Write MATRIX (SWF bit-packed)
      writeGradientMatrix(bw, a, b, c, d, tx, ty);

      // Write GRADIENT record
      // SWF GRADIENT first byte layout (per SWF19 §2.4.2.4 and Ruffle read.rs):
      //   bits[7:6] SpreadMode:        0=pad/extend, 1=reflect, 2=repeat
      //   bits[5:4] InterpolationMode: 0=normal RGB, 1=linear RGB
      //   bits[3:0] NumGradients
      const gradBw = new BitWriter();
      const spreadModeVal =
        fill.spreadMode === "reflect" ? 1 :
        fill.spreadMode === "repeat"  ? 2 : 0;
      const interpolationModeVal = fill.interpolation === "linearRGB" ? 1 : 0;
      const numGradients = Math.min(fill.stops.length, 15);
      gradBw.writeBits(spreadModeVal, 2);
      gradBw.writeBits(interpolationModeVal, 2);
      gradBw.writeBits(numGradients, 4);
      // Flush so stop bytes are byte-aligned
      gradBw.flushBits();
      for (let si = 0; si < numGradients; si++) {
        const stop = fill.stops[si];
        gradBw.writeUI8(stop.ratio);
        gradBw.writeUI8(stop.color.r);
        gradBw.writeUI8(stop.color.g);
        gradBw.writeUI8(stop.color.b);
        gradBw.writeUI8(stop.color.a);
      }
      // For focal radial (FOCALGRADIENT), append FocalPoint as FLOAT16
      if (isFocal && fill.type === "radial-gradient") {
        // FLOAT16 — SWF 8.8 fixed-point signed (same as FIXED8 in Flash)
        const fp = Math.round(fill.focalPoint * 256);
        gradBw.writeSI16LE(fp);
      }
      bw.writeBytes(gradBw.getBytes());
    }
  }

  // --- LINESTYLEARRAY (LineStyle2 for DefineShape4) ---
  bw.writeUI8(strokes.length);
  for (const se of strokes) {
    const s = se.stroke;
    bw.writeUI16LE(strokeWidthTwips(s)); // width in twips (0 = hairline)

    // LineStyle2 flags (UI16):
    //   bits 15-14: StartCapStyle  (0=round, 1=none, 2=square)
    //   bits 13-12: JoinStyle      (0=round, 1=bevel, 2=miter)
    //   bit  11:    HasFillFlag    (0 = color in record, 1 = FILLSTYLE)
    //   bit  10:    NoHScaleFlag
    //   bit   9:    NoVScaleFlag
    //   bits  9-8:  EndCapStyle    (same encoding as StartCap)
    //   bit   8:    PixelHintingFlag
    //   bits  7-6:  (reserved, 0)
    //   bit   5:    NoClose
    //   bits  3-2:  (reserved, 0)
    //   bit   1:    (reserved, 0)
    //   bit   0:    (reserved, 0)
    // SWF spec bit layout for LineStyle2 flags UI16 (LSB = bit 0):
    //   [15:14] StartCapStyle, [13:12] JoinStyle, [11] HasFill, [10] NoHScale,
    //   [9] NoVScale, [8] PixelHinting, [7:6] reserved, [5] NoClose,
    //   [4:3] EndCapStyle, [2:0] reserved
    const hasMiter = s.joints === "miter";
    // LINESTYLE2 flags — 16 bits MSB-first (NOT LE).
    const { highByte, lowByte } = lineStyle2FlagBytes(s);
    bw.writeUI8(highByte); // high byte first (MSB)
    bw.writeUI8(lowByte);  // low byte second

    // MiterLimitFactor (FLOAT16 = FIXED8 = 8.8 fixed) only when JoinStyle=2 (miter)
    if (hasMiter) {
      // SWF miter limit is stored as a FLOAT16 (actually a UI16 in 8.8 fixed point)
      const miterVal = Math.round(Math.max(1, s.miterLimit) * 256);
      bw.writeUI16LE(miterVal & 0xffff);
    }

    // Color: RGBA
    bw.writeUI8(s.color.r);
    bw.writeUI8(s.color.g);
    bw.writeUI8(s.color.b);
    bw.writeUI8(s.color.a);
  }

  // --- NumFillBits / NumLineBits (4 bits each, UI4 UI4 packed in one byte) ---
  // These determine index bit widths for the shape record stream.
  const numFillBits = fills.length > 0 ? Math.ceil(Math.log2(fills.length + 1)) : 1;
  const numLineBits = strokes.length > 0 ? Math.ceil(Math.log2(strokes.length + 1)) : 1;
  // Packed as two nibbles in one byte (UB[4] + UB[4])
  bw.writeBits(numFillBits, 4);
  bw.writeBits(numLineBits, 4);
  // (already byte-aligned since 4+4=8 bits)

  // --- Shape records ---
  // Emit one StyleChangeRecord + edge records per path.
  for (let pi = 0; pi < filteredShape.paths.length; pi++) {
    const path = filteredShape.paths[pi];
    const fillIdx = pathFillIndex[pi];
    const strokeIdx = pathStrokeIndex[pi];

    // Start point in twips
    const startX = px(path.start.x);
    const startY = px(path.start.y);

    // StyleChangeRecord: moveTo start, always set fill0 and lineStyle (even to 0 to prevent leakage)
    writeStyleChangeRecord(bw, {
      moveTo: { x: startX, y: startY },
      fillStyle0: fillIdx,
      lineStyle: strokeIdx,
      numFillBits,
      numLineBits,
    });

    // Edge records
    let curX = startX;
    let curY = startY;

    for (const seg of path.segments) {
      if (seg.type === "line") {
        const toX = px(seg.to.x);
        const toY = px(seg.to.y);
        const dx = toX - curX;
        const dy = toY - curY;
        if (dx !== 0 || dy !== 0) {
          writeStraightEdge(bw, dx, dy);
        }
        curX = toX;
        curY = toY;
      } else {
        // curve
        const ctrlX = px(seg.control.x);
        const ctrlY = px(seg.control.y);
        const toX = px(seg.to.x);
        const toY = px(seg.to.y);
        const cdx = ctrlX - curX;
        const cdy = ctrlY - curY;
        const adx = toX - ctrlX;
        const ady = toY - ctrlY;
        if (cdx !== 0 || cdy !== 0 || adx !== 0 || ady !== 0) {
          writeCurvedEdge(bw, cdx, cdy, adx, ady);
        }
        curX = toX;
        curY = toY;
      }
    }

    // Close the path if needed
    if (path.closed) {
      const dx = startX - curX;
      const dy = startY - curY;
      if (dx !== 0 || dy !== 0) {
        writeStraightEdge(bw, dx, dy);
      }
    }
  }

  // EndShapeRecord: 6 zero bits
  writeEndShapeRecord(bw);

  return bw.getBytes();
}

/**
 * Encode a PlaceObject2 tag body with PlaceFlagMove set, for updating an
 * already-placed object at the given depth. If `replaceCharacter` is true,
 * the new character ID is included (PlaceFlagHasCharacter | PlaceFlagMove).
 * Otherwise only the matrix is updated (PlaceFlagMove | PlaceFlagHasMatrix).
 */
export function encodePlaceObject2Move(
  charId: number,
  depth: number,
  x: number,
  y: number,
  transform?: {
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    skewX?: number;
    skewY?: number;
  },
  replaceCharacter = false
): Uint8Array {
  const bw = new BitWriter();

  // Flags:
  //   bit0 = PlaceFlagMove (0x01)
  //   bit1 = PlaceFlagHasCharacter (0x02) — only if replacing the character
  //   bit2 = PlaceFlagHasMatrix (0x04)
  const flags = replaceCharacter ? 0x07 : 0x05; // Move+HasMatrix(+HasCharacter)
  bw.writeUI8(flags);

  // Depth: UI16
  bw.writeUI16LE(depth);

  // CharacterId only when replacing the character at this depth
  if (replaceCharacter) {
    bw.writeUI16LE(charId);
  }

  // Build the full affine matrix from the position + optional transform params
  const m = composeMatrix({
    tx: x,
    ty: y,
    scaleX: transform?.scaleX ?? 1,
    scaleY: transform?.scaleY ?? 1,
    rotation: transform?.rotation ?? 0,
    skewX: transform?.skewX ?? 0,
    skewY: transform?.skewY ?? 0,
  });
  const swfM = toSWFMatrix(m);

  const { hasScale, scaleX, scaleY, hasRotate, rotateSkew0, rotateSkew1, translateX, translateY } = swfM;

  bw.writeBits(hasScale ? 1 : 0, 1);
  if (hasScale) {
    const nBits = Math.max(edgeNumBits([scaleX, scaleY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(scaleX, nBits);
    bw.writeBits(scaleY, nBits);
  }

  bw.writeBits(hasRotate ? 1 : 0, 1);
  if (hasRotate) {
    const nBits = Math.max(edgeNumBits([rotateSkew0, rotateSkew1]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(rotateSkew0, nBits);
    bw.writeBits(rotateSkew1, nBits);
  }

  {
    const nBits = Math.max(edgeNumBits([translateX, translateY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(translateX, nBits);
    bw.writeBits(translateY, nBits);
  }

  bw.flushBits();

  return bw.getBytes();
}

/**
 * Encode a PlaceObject2 tag body, placing a character at (x, y) with an
 * optional full affine transform (scale, rotation, skew).
 *
 * When `transform` is omitted the output is identical to the original
 * translation-only encoding (backward compatible).
 *
 * MATRIX bit layout (SWF spec):
 *   UB[1] hasScale
 *     if hasScale: UB[5] nBits, SB[nBits] scaleX, SB[nBits] scaleY  (16.16 fixed-point)
 *   UB[1] hasRotate
 *     if hasRotate: UB[5] nBits, SB[nBits] rotateSkew0, SB[nBits] rotateSkew1  (16.16)
 *   UB[5] nTranslateBits  (UNCONDITIONAL — no flag bit)
 *   SB[nTranslateBits] translateX  (twips)
 *   SB[nTranslateBits] translateY  (twips)
 *   flushBits()
 *
 * @param charId     Character ID to place
 * @param depth      Display list depth (1-based)
 * @param x          X position in pixels
 * @param y          Y position in pixels
 * @param transform  Optional scale/rotation/skew (all default to identity)
 */
export function encodePlaceObject2(
  charId: number,
  depth: number,
  x: number,
  y: number,
  transform?: {
    scaleX?: number;    // 1.0 = no scale
    scaleY?: number;
    rotation?: number;  // degrees
    skewX?: number;
    skewY?: number;
  }
): Uint8Array {
  const bw = new BitWriter();

  // Flags: hasCharacter (bit 1) | hasMatrix (bit 2) → 0x06
  bw.writeUI8(0x06);

  // Depth: UI16
  bw.writeUI16LE(depth);

  // CharacterId: UI16
  bw.writeUI16LE(charId);

  // Build the full affine matrix from the position + optional transform params
  const m = composeMatrix({
    tx: x,
    ty: y,
    scaleX: transform?.scaleX ?? 1,
    scaleY: transform?.scaleY ?? 1,
    rotation: transform?.rotation ?? 0,
    skewX: transform?.skewX ?? 0,
    skewY: transform?.skewY ?? 0,
  });
  const swfM = toSWFMatrix(m);

  const { hasScale, scaleX, scaleY, hasRotate, rotateSkew0, rotateSkew1, translateX, translateY } = swfM;

  // hasScale
  bw.writeBits(hasScale ? 1 : 0, 1);
  if (hasScale) {
    const nBits = Math.max(edgeNumBits([scaleX, scaleY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(scaleX, nBits);
    bw.writeBits(scaleY, nBits);
  }

  // hasRotate
  bw.writeBits(hasRotate ? 1 : 0, 1);
  if (hasRotate) {
    const nBits = Math.max(edgeNumBits([rotateSkew0, rotateSkew1]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(rotateSkew0, nBits);
    bw.writeBits(rotateSkew1, nBits);
  }

  // Translate is unconditional per SWF spec (no flag bit)
  {
    const nBits = Math.max(edgeNumBits([translateX, translateY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(translateX, nBits);
    bw.writeBits(translateY, nBits);
  }

  bw.flushBits();

  return bw.getBytes();
}

/**
 * Encode a PlaceObject2 tag body that includes an instance name (HasName flag).
 *
 * Flags: PlaceFlagHasCharacter (0x02) | PlaceFlagHasMatrix (0x04) | PlaceFlagHasName (0x20)
 *  → 0x26
 *
 * PlaceObject2 flags byte:
 *   bit 0: HasMove      (0x01)
 *   bit 1: HasCharacter (0x02)
 *   bit 2: HasMatrix    (0x04)
 *   bit 3: HasColorTransform (0x08)
 *   bit 4: HasRatio     (0x10)
 *   bit 5: HasName      (0x20)
 *   bit 6: HasClipDepth (0x40)
 *   bit 7: HasClipActions (0x80)
 *
 * When HasName is set, the Name string (null-terminated) is written after the
 * other optional fields (after the MATRIX, or after CXFORM if present).
 *
 * @param charId     Character ID to place
 * @param depth      Display list depth (1-based)
 * @param x          X position in pixels
 * @param y          Y position in pixels
 * @param name       Instance name string (non-empty)
 * @param transform  Optional scale/rotation/skew
 */
export function encodePlaceObject2WithName(
  charId: number,
  depth: number,
  x: number,
  y: number,
  name: string,
  transform?: {
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    skewX?: number;
    skewY?: number;
  }
): Uint8Array {
  const bw = new BitWriter();

  // Flags: HasCharacter (0x02) | HasMatrix (0x04) | HasName (0x20) = 0x26
  bw.writeUI8(0x26);

  // Depth: UI16
  bw.writeUI16LE(depth);

  // CharacterId: UI16
  bw.writeUI16LE(charId);

  // MATRIX
  const m = composeMatrix({
    tx: x,
    ty: y,
    scaleX: transform?.scaleX ?? 1,
    scaleY: transform?.scaleY ?? 1,
    rotation: transform?.rotation ?? 0,
    skewX: transform?.skewX ?? 0,
    skewY: transform?.skewY ?? 0,
  });
  const swfM = toSWFMatrix(m);
  const { hasScale, scaleX, scaleY, hasRotate, rotateSkew0, rotateSkew1, translateX, translateY } = swfM;

  bw.writeBits(hasScale ? 1 : 0, 1);
  if (hasScale) {
    const nBits = Math.max(edgeNumBits([scaleX, scaleY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(scaleX, nBits);
    bw.writeBits(scaleY, nBits);
  }
  bw.writeBits(hasRotate ? 1 : 0, 1);
  if (hasRotate) {
    const nBits = Math.max(edgeNumBits([rotateSkew0, rotateSkew1]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(rotateSkew0, nBits);
    bw.writeBits(rotateSkew1, nBits);
  }
  {
    const nBits = Math.max(edgeNumBits([translateX, translateY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(translateX, nBits);
    bw.writeBits(translateY, nBits);
  }
  bw.flushBits();

  // Name: null-terminated string (written after MATRIX, no CXFORM present)
  bw.writeString(name);

  return bw.getBytes();
}

/**
 * Encode a PlaceObject2 tag body with an alpha color transform.
 *
 * When move=false (default):
 *   Flags: PlaceFlagHasCharacter (0x02) | PlaceFlagHasMatrix (0x04) |
 *          PlaceFlagHasColorTransform (0x08)  → 0x0E
 * When move=true:
 *   Flags: PlaceFlagMove (0x01) | PlaceFlagHasMatrix (0x04) |
 *          PlaceFlagHasColorTransform (0x08)  → 0x0D
 *   (charId is NOT included in the move-only case)
 *
 * Structure: flags (UI8), depth (UI16), [charId (UI16)], MATRIX, CXFORMWITHALPHA
 *
 * @param charId    Character to place
 * @param depth     Display list depth
 * @param x         X position in pixels
 * @param y         Y position in pixels
 * @param alpha     Opacity 0–1 (1 = fully opaque)
 * @param transform Optional scale/rotation/skew
 * @param move      If true, emit as PlaceFlagMove (update existing, no charId)
 */
export function encodePlaceObject2WithAlpha(
  charId: number,
  depth: number,
  x: number,
  y: number,
  alpha: number,
  transform?: {
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    skewX?: number;
    skewY?: number;
  },
  move = false
): Uint8Array {
  const bw = new BitWriter();

  // Flags: (Move | HasMatrix | HasColorTransform) or (HasCharacter | HasMatrix | HasColorTransform)
  if (move) {
    // PlaceFlagMove (0x01) | PlaceFlagHasMatrix (0x04) | PlaceFlagHasColorTransform (0x08) = 0x0D
    bw.writeUI8(0x0d);
  } else {
    // PlaceFlagHasCharacter (0x02) | PlaceFlagHasMatrix (0x04) | PlaceFlagHasColorTransform (0x08) = 0x0E
    bw.writeUI8(0x0e);
  }

  bw.writeUI16LE(depth);
  // CharId only included on first placement (not move)
  if (!move) {
    bw.writeUI16LE(charId);
  }

  // Build matrix
  const m = composeMatrix({
    tx: x,
    ty: y,
    scaleX: transform?.scaleX ?? 1,
    scaleY: transform?.scaleY ?? 1,
    rotation: transform?.rotation ?? 0,
    skewX: transform?.skewX ?? 0,
    skewY: transform?.skewY ?? 0,
  });
  const swfM = toSWFMatrix(m);
  const { hasScale, scaleX, scaleY, hasRotate, rotateSkew0, rotateSkew1, translateX, translateY } = swfM;

  bw.writeBits(hasScale ? 1 : 0, 1);
  if (hasScale) {
    const nBits = Math.max(edgeNumBits([scaleX, scaleY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(scaleX, nBits);
    bw.writeBits(scaleY, nBits);
  }
  bw.writeBits(hasRotate ? 1 : 0, 1);
  if (hasRotate) {
    const nBits = Math.max(edgeNumBits([rotateSkew0, rotateSkew1]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(rotateSkew0, nBits);
    bw.writeBits(rotateSkew1, nBits);
  }
  {
    const nBits = Math.max(edgeNumBits([translateX, translateY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(translateX, nBits);
    bw.writeBits(translateY, nBits);
  }
  bw.flushBits();

  // CXFORMWITHALPHA: alphaMult = alpha * 256, others = 256 (no change), no add
  const alphaMult = Math.round(Math.max(0, Math.min(1, alpha)) * 256);
  const cxform = encodeCxformWithAlpha(256, 256, 256, alphaMult, 0, 0, 0, 0);
  bw.writeBytes(cxform);

  return bw.getBytes();
}

/**
 * Encode a PlaceObject2 tag body with a full CXFormWithAlpha color transform.
 *
 * When name is absent:
 *   Flags: PlaceFlagHasCharacter (0x02) | PlaceFlagHasMatrix (0x04) |
 *          PlaceFlagHasColorTransform (0x08)  → 0x0E
 * When name is present:
 *   Flags: PlaceFlagHasCharacter (0x02) | PlaceFlagHasMatrix (0x04) |
 *          PlaceFlagHasColorTransform (0x08) | PlaceFlagHasName (0x20) → 0x2E
 *
 * @param charId    Character to place
 * @param depth     Display list depth
 * @param x         X position in pixels
 * @param y         Y position in pixels
 * @param cxform    Color transform to apply
 * @param transform Optional scale/rotation/skew
 * @param move      If true, emit as PlaceFlagMove (update existing, no charId)
 * @param name      Optional instance name (sets HasName flag)
 */
export function encodePlaceObject2WithCXForm(
  charId: number,
  depth: number,
  x: number,
  y: number,
  cxform: CXForm,
  transform?: {
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    skewX?: number;
    skewY?: number;
  },
  move = false,
  name?: string
): Uint8Array {
  const bw = new BitWriter();
  const hasName = !!name && name.length > 0;

  if (move) {
    // PlaceFlagMove (0x01) | PlaceFlagHasMatrix (0x04) | PlaceFlagHasColorTransform (0x08)
    // + optional PlaceFlagHasName (0x20)
    bw.writeUI8(0x0d | (hasName ? 0x20 : 0x00));
  } else {
    // PlaceFlagHasCharacter (0x02) | PlaceFlagHasMatrix (0x04) | PlaceFlagHasColorTransform (0x08)
    // + optional PlaceFlagHasName (0x20)
    bw.writeUI8(0x0e | (hasName ? 0x20 : 0x00));
  }

  bw.writeUI16LE(depth);
  if (!move) {
    bw.writeUI16LE(charId);
  }

  // Build matrix
  const m = composeMatrix({
    tx: x,
    ty: y,
    scaleX: transform?.scaleX ?? 1,
    scaleY: transform?.scaleY ?? 1,
    rotation: transform?.rotation ?? 0,
    skewX: transform?.skewX ?? 0,
    skewY: transform?.skewY ?? 0,
  });
  const swfM = toSWFMatrix(m);
  const { hasScale, scaleX, scaleY, hasRotate, rotateSkew0, rotateSkew1, translateX, translateY } = swfM;

  bw.writeBits(hasScale ? 1 : 0, 1);
  if (hasScale) {
    const nBits = Math.max(edgeNumBits([scaleX, scaleY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(scaleX, nBits);
    bw.writeBits(scaleY, nBits);
  }
  bw.writeBits(hasRotate ? 1 : 0, 1);
  if (hasRotate) {
    const nBits = Math.max(edgeNumBits([rotateSkew0, rotateSkew1]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(rotateSkew0, nBits);
    bw.writeBits(rotateSkew1, nBits);
  }
  {
    const nBits = Math.max(edgeNumBits([translateX, translateY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(translateX, nBits);
    bw.writeBits(translateY, nBits);
  }
  bw.flushBits();

  // CXFORMWITHALPHA
  bw.writeBytes(encodeCXFormWithAlpha(cxform));

  // Optional: instance name — written after CXFORM per SWF spec field order
  if (hasName) {
    bw.writeString(name!);
  }

  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// PlaceObject2 with ClipDepth (mask layer)
// ---------------------------------------------------------------------------

/**
 * Encode a PlaceObject2 tag body for a mask-layer shape.
 *
 * Sets the HasClipDepth flag (bit 6 = 0x40) so the Flash Player / Ruffle
 * treats this object as a clipping mask. All display-list entries at depths
 * from (depth + 1) through clipDepth (inclusive) are clipped by this shape.
 *
 * PlaceObject2 flags:
 *   HasCharacter (0x02) | HasMatrix (0x04) | HasClipDepth (0x40) → 0x46
 *
 * @param charId     Character ID of the mask shape
 * @param depth      Display list depth of the mask shape
 * @param x          X position in pixels
 * @param y          Y position in pixels
 * @param clipDepth  The highest depth of the masked layers (the clip region
 *                   covers depths depth+1 … clipDepth inclusive)
 */
export function encodePlaceObject2WithClipDepth(
  charId: number,
  depth: number,
  x: number,
  y: number,
  clipDepth: number,
  transform?: { scaleX?: number; scaleY?: number; rotation?: number; skewX?: number; skewY?: number }
): Uint8Array {
  const bw = new BitWriter();

  // Flags: HasCharacter (0x02) | HasMatrix (0x04) | HasClipDepth (0x40) = 0x46
  bw.writeUI8(0x46);

  // Depth: UI16
  bw.writeUI16LE(depth);

  // CharacterId: UI16
  bw.writeUI16LE(charId);

  // MATRIX: translation + optional scale/rotation
  const m = composeMatrix({
    tx: x,
    ty: y,
    scaleX: transform?.scaleX ?? 1,
    scaleY: transform?.scaleY ?? 1,
    rotation: transform?.rotation ?? 0,
    skewX: transform?.skewX ?? 0,
    skewY: transform?.skewY ?? 0,
  });
  const swfM = toSWFMatrix(m);
  const { hasScale, scaleX, scaleY, hasRotate, rotateSkew0, rotateSkew1, translateX, translateY } = swfM;

  bw.writeBits(hasScale ? 1 : 0, 1);
  if (hasScale) {
    const nBits = Math.max(edgeNumBits([scaleX, scaleY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(scaleX, nBits);
    bw.writeBits(scaleY, nBits);
  }
  bw.writeBits(hasRotate ? 1 : 0, 1);
  if (hasRotate) {
    const nBits = Math.max(edgeNumBits([rotateSkew0, rotateSkew1]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(rotateSkew0, nBits);
    bw.writeBits(rotateSkew1, nBits);
  }
  {
    const nBits = Math.max(edgeNumBits([translateX, translateY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(translateX, nBits);
    bw.writeBits(translateY, nBits);
  }
  bw.flushBits();

  // ClipDepth: UI16 (written after MATRIX, no CXFORM or Name present)
  bw.writeUI16LE(clipDepth);

  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// ClipEventFlags lookup (SWF spec 8.4.6.2)
// ---------------------------------------------------------------------------

/** Maps a ClipAction event name to its SWF ClipEventFlags bit. */
const CLIP_EVENT_FLAGS: Record<ClipAction['event'], number> = {
  load:       0x00000001,
  enterFrame: 0x00000002,
  unload:     0x00000004,
  mouseMove:  0x00000008,
  mouseDown:  0x00000010,
  mouseUp:    0x00000020,
  keyDown:    0x00000040,
  keyUp:      0x00000080,
  data:       0x00000100,
};

/**
 * Encode a PlaceObject2 tag body that includes one or more CLIPACTIONRECORD entries
 * (HasClipActions flag, SWF v8 / Flash 8).
 *
 * Structure (SWF ≥ 6):
 *   flags     UI8   — PlaceFlagHasCharacter (0x02) | PlaceFlagHasMatrix (0x04) |
 *                     PlaceFlagHasClipActions (0x80)  = 0x86
 *             (add 0x20 when instanceName is supplied)
 *   depth     UI16
 *   charId    UI16
 *   MATRIX    (bit-packed)
 *   [Name     null-terminated string, only when instanceName given]
 *   Reserved  UI16 = 0 (must be 0, read by Ruffle before AllEventFlags)
 *   AllEventFlags  UI32 — union of all ClipEventFlags in the record set
 *   for each ClipAction:
 *     ClipEventFlags  UI32
 *     ActionRecordSize UI32 — byte length of bytecode (including ActionEnd 0x00)
 *     ActionBytes     UI8[]
 *     ActionEnd       UI8  (0x00) — already included in compileAS2 output
 *   Terminator   UI32 = 0x00000000
 *
 * @param charId        Character ID to place
 * @param depth         Display list depth (1-based)
 * @param x             X position in pixels
 * @param y             Y position in pixels
 * @param clipActions   Array of clip event handlers (must be non-empty)
 * @param transform     Optional scale/rotation/skew
 * @param instanceName  Optional AS2 instance name
 */
export function encodePlaceObject2WithClipActions(
  charId: number,
  depth: number,
  x: number,
  y: number,
  clipActions: readonly ClipAction[],
  transform?: {
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    skewX?: number;
    skewY?: number;
  },
  instanceName?: string
): Uint8Array {
  const bw = new BitWriter();

  // Flags: HasCharacter (0x02) | HasMatrix (0x04) | HasClipActions (0x80) = 0x86
  // Add HasName (0x20) if instanceName is provided
  const flags = 0x86 | (instanceName && instanceName.length > 0 ? 0x20 : 0x00);
  bw.writeUI8(flags);

  // Depth: UI16
  bw.writeUI16LE(depth);

  // CharacterId: UI16
  bw.writeUI16LE(charId);

  // MATRIX
  const m = composeMatrix({
    tx: x,
    ty: y,
    scaleX: transform?.scaleX ?? 1,
    scaleY: transform?.scaleY ?? 1,
    rotation: transform?.rotation ?? 0,
    skewX: transform?.skewX ?? 0,
    skewY: transform?.skewY ?? 0,
  });
  const swfM = toSWFMatrix(m);
  const { hasScale, scaleX, scaleY, hasRotate, rotateSkew0, rotateSkew1, translateX, translateY } = swfM;

  bw.writeBits(hasScale ? 1 : 0, 1);
  if (hasScale) {
    const nBits = Math.max(edgeNumBits([scaleX, scaleY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(scaleX, nBits);
    bw.writeBits(scaleY, nBits);
  }
  bw.writeBits(hasRotate ? 1 : 0, 1);
  if (hasRotate) {
    const nBits = Math.max(edgeNumBits([rotateSkew0, rotateSkew1]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(rotateSkew0, nBits);
    bw.writeBits(rotateSkew1, nBits);
  }
  {
    const nBits = Math.max(edgeNumBits([translateX, translateY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(translateX, nBits);
    bw.writeBits(translateY, nBits);
  }
  bw.flushBits();

  // Optional: instance name (written after MATRIX, before clip actions)
  if (instanceName && instanceName.length > 0) {
    bw.writeString(instanceName);
  }

  // Compile each action and build records.
  // Each record's bytecode must end with ActionEnd (0x00) per SWF spec §8.4.6.2.
  // compileAS2 does NOT emit ActionEnd, so we append it here (same as DoAction).
  const records: Array<{ flags: number; bytecode: Uint8Array }> = [];
  let allEventFlags = 0;
  for (const action of clipActions) {
    const eventFlag = CLIP_EVENT_FLAGS[action.event] ?? 0;
    allEventFlags |= eventFlag;
    const raw = compileAS2(action.script);
    // Append ActionEnd (0x00) terminator — required by SWF spec and Ruffle's parser
    const bytecode = new Uint8Array(raw.length + 1);
    bytecode.set(raw);
    // bytecode[raw.length] is already 0x00 (ActionEnd)
    records.push({ flags: eventFlag, bytecode });
  }

  // Reserved UI16 = 0 (required by SWF spec before AllEventFlags; Ruffle reads this)
  bw.writeUI16LE(0);

  // AllEventFlags: UI32 (union of all event flags in this record set)
  bw.writeUI32LE(allEventFlags);

  // Emit each CLIPACTIONRECORD
  for (const record of records) {
    // ClipEventFlags: UI32
    bw.writeUI32LE(record.flags);
    // ActionRecordSize: UI32 (byte count of bytecode including 0x00 ActionEnd)
    bw.writeUI32LE(record.bytecode.length);
    // Action bytes (including ActionEnd at the end)
    bw.writeBytes(record.bytecode);
  }

  // Terminator: UI32 = 0x00000000
  bw.writeUI32LE(0x00000000);

  return bw.getBytes();
}

/**
 * Encode a PlaceObject2 tag body that modifies an existing display-list entry
 * by attaching clip actions (HasMove | HasClipActions, no CharacterId or Matrix).
 *
 * Use this when an object has already been placed via PlaceObject3 (e.g. with
 * blend mode or filters) and clip actions need to be attached at the same depth
 * in the same frame.  HasMove (0x01) tells the player to modify the existing
 * object rather than place a new one; omitting HasCharacter / HasMatrix leaves
 * those properties untouched.
 *
 * Structure:
 *   flags    UI8   — HasMove (0x01) | HasClipActions (0x80) = 0x81
 *   depth    UI16
 *   Reserved UI16 = 0
 *   AllEventFlags UI32
 *   for each ClipAction:
 *     ClipEventFlags UI32
 *     ActionRecordSize UI32
 *     ActionBytes UI8[]
 *   Terminator UI32 = 0x00000000
 */
export function encodePlaceObject2MoveWithClipActions(
  depth: number,
  clipActions: readonly ClipAction[]
): Uint8Array {
  const bw = new BitWriter();

  // HasMove (0x01) | HasClipActions (0x80)
  bw.writeUI8(0x81);

  // Depth: UI16
  bw.writeUI16LE(depth);

  // Compile each action and build records.
  const records: Array<{ flags: number; bytecode: Uint8Array }> = [];
  let allEventFlags = 0;
  for (const action of clipActions) {
    const eventFlag = CLIP_EVENT_FLAGS[action.event] ?? 0;
    allEventFlags |= eventFlag;
    const raw = compileAS2(action.script);
    // Append ActionEnd (0x00) terminator — required by SWF spec and Ruffle's parser
    const bytecode = new Uint8Array(raw.length + 1);
    bytecode.set(raw);
    records.push({ flags: eventFlag, bytecode });
  }

  // Reserved UI16 = 0 (required by SWF spec before AllEventFlags; Ruffle reads this)
  bw.writeUI16LE(0);

  // AllEventFlags: UI32 (union of all event flags in this record set)
  bw.writeUI32LE(allEventFlags);

  // Emit each CLIPACTIONRECORD
  for (const record of records) {
    // ClipEventFlags: UI32
    bw.writeUI32LE(record.flags);
    // ActionRecordSize: UI32 (byte count of bytecode including 0x00 ActionEnd)
    bw.writeUI32LE(record.bytecode.length);
    // Action bytes (including ActionEnd at the end)
    bw.writeBytes(record.bytecode);
  }

  // Terminator: UI32 = 0x00000000
  bw.writeUI32LE(0x00000000);

  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// Bitmap fill shape
// ---------------------------------------------------------------------------

/**
 * Write a SWF MATRIX (bit-packed) for a bitmap fill.
 * The matrix maps from image pixel space to twip space.
 *
 * For a bitmap placed at (tx, ty) in twips with a 1:1 pixel-to-twip mapping:
 *   scale = 20 (20 twips per pixel) stored as 16.16 fixed-point = 20 * 65536
 *   translate = (tx, ty) in twips
 */
function writeBitmapMatrix(
  bw: BitWriter,
  scaleTwipsPerPx: number,
  tx: number,
  ty: number
): void {
  // scale values in 16.16 fixed-point
  const scaleFixed = Math.round(scaleTwipsPerPx * 65536);

  // hasScale = 1 (we always include scale to map px→twips)
  bw.writeBits(1, 1);
  const nScaleBits = Math.max(edgeNumBits([scaleFixed]), 2);
  bw.writeBits(nScaleBits, 5);
  bw.writeBits(scaleFixed, nScaleBits); // scaleX
  bw.writeBits(scaleFixed, nScaleBits); // scaleY

  // hasRotate = 0
  bw.writeBits(0, 1);

  // translate
  const nTransBits = Math.max(edgeNumBits([tx, ty]), 2);
  bw.writeBits(nTransBits, 5);
  bw.writeBits(tx, nTransBits);
  bw.writeBits(ty, nTransBits);

  bw.flushBits();
}

/**
 * Write a SWF MATRIX (bit-packed) for a bitmap fill with a full affine transform.
 *
 * All values are already in twips (16.16 fixed-point for a/b/c/d, integer twips for tx/ty).
 * The matrix maps from bitmap pixel space to shape space (twips):
 *   a, d  = scale components (twipsPerPx * scaleX/Y)
 *   b, c  = rotation/skew components (twipsPerPx * rotation factor)
 *   tx,ty = translation in twips
 */
function writeBitmapFillMatrix(
  bw: BitWriter,
  aTwips: number,
  bTwips: number,
  cTwips: number,
  dTwips: number,
  txTwips: number,
  tyTwips: number
): void {
  // Convert a,b,c,d to 16.16 fixed-point integers
  const aFixed = Math.round(aTwips * 65536);
  const bFixed = Math.round(bTwips * 65536);
  const cFixed = Math.round(cTwips * 65536);
  const dFixed = Math.round(dTwips * 65536);

  // hasScale = 1
  bw.writeBits(1, 1);
  const nScaleBits = Math.max(edgeNumBits([aFixed, dFixed]), 2);
  bw.writeBits(nScaleBits, 5);
  bw.writeBits(aFixed, nScaleBits); // scaleX
  bw.writeBits(dFixed, nScaleBits); // scaleY

  // hasRotate: write b and c if non-zero
  const hasRotate = bFixed !== 0 || cFixed !== 0;
  bw.writeBits(hasRotate ? 1 : 0, 1);
  if (hasRotate) {
    const nRotBits = Math.max(edgeNumBits([bFixed, cFixed]), 2);
    bw.writeBits(nRotBits, 5);
    bw.writeBits(bFixed, nRotBits); // rotateSkew0 (b)
    bw.writeBits(cFixed, nRotBits); // rotateSkew1 (c)
  }

  // translate
  const nTransBits = Math.max(edgeNumBits([txTwips, tyTwips]), 2);
  bw.writeBits(nTransBits, 5);
  bw.writeBits(txTwips, nTransBits);
  bw.writeBits(tyTwips, nTransBits);

  bw.flushBits();
}

/**
 * Encode a DefineShape4 tag body for a bitmap fill shape.
 *
 * The shape is a filled rectangle of (width × height) pixels placed at origin
 * (0, 0) in shape-local space; the PlaceObject2 matrix handles the (x, y)
 * translation on stage.
 *
 * Fill type:
 *   0x42 = clipped non-smoothed bitmap fill
 *   0x43 = clipped smoothed bitmap fill
 *
 * @param charId         SWF character ID for this shape
 * @param bitmapCharId   Character ID of the DefineBitsJPEG2 bitmap
 * @param width          Display width in pixels
 * @param height         Display height in pixels
 * @param allowSmoothing Whether to use smoothed bitmap fill (0x43 vs 0x42)
 */
export function encodeBitmapFillShape(
  charId: number,
  bitmapCharId: number,
  width: number,
  height: number,
  allowSmoothing: boolean
): Uint8Array {
  const bw = new BitWriter();

  // Character ID
  bw.writeUI16LE(charId);

  // Bounding box in twips (shape-local: 0,0 to w,h)
  const wTwips = px(width);
  const hTwips = px(height);

  // ShapeBounds RECT
  writeRect(bw, 0, wTwips, 0, hTwips);
  // EdgeBounds RECT (same)
  writeRect(bw, 0, wTwips, 0, hTwips);

  // DefineShape4 flags byte (no non-scaling strokes, no pixel hinting)
  bw.writeUI8(0x00);

  // --- FILLSTYLEARRAY: 1 fill style (bitmap fill) ---
  bw.writeUI8(1); // fillStyleCount = 1

  // FillType: 0x42 = clipped non-smoothed, 0x43 = clipped smoothed
  const fillType = allowSmoothing ? 0x43 : 0x42;
  bw.writeUI8(fillType);

  // BitmapId: UI16
  bw.writeUI16LE(bitmapCharId);

  // BitmapMatrix MATRIX: scale pixels to twips, translate to (0, 0)
  // The bitmap fill matrix maps from bitmap pixel space to shape space (twips).
  // Scale = 20 twips/pixel = identity in twips-per-pixel terms.
  writeBitmapMatrix(bw, 20, 0, 0);

  // --- LINESTYLEARRAY: 0 line styles ---
  bw.writeUI8(0);

  // --- NumFillBits = 1, NumLineBits = 0 (packed in one byte) ---
  // UB[4] NumFillBits, UB[4] NumLineBits
  bw.writeBits(1, 4); // 1 fill style → need 1 bit
  bw.writeBits(0, 4); // 0 line styles → 0 bits
  // (already byte-aligned)

  // --- Shape records: rectangle path ---
  // StyleChangeRecord: moveTo (0,0), fillStyle0 = 1
  writeStyleChangeRecord(bw, {
    moveTo: { x: 0, y: 0 },
    fillStyle0: 1,
    lineStyle: 0,
    numFillBits: 1,
    numLineBits: 0,
  });

  // Four edges of the rectangle (all straight lines)
  writeStraightEdge(bw, wTwips, 0);       // top edge → (w, 0)
  writeStraightEdge(bw, 0, hTwips);       // right edge → (w, h)
  writeStraightEdge(bw, -wTwips, 0);      // bottom edge → (0, h)
  writeStraightEdge(bw, 0, -hTwips);      // left edge → (0, 0)

  // EndShapeRecord
  writeEndShapeRecord(bw);

  return bw.getBytes();
}


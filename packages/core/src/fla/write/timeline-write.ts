/**
 * `Page N` / `Symbol N` timeline-stream writer (§7–§19 of
 * docs/21-fla-binary-format.md).
 *
 * Produces the MFC CArchive body for one timeline (a scene or a symbol):
 *
 *   u8 = 0x01                      // root marker
 *   NEWCLASS "CPicPage"
 *   CPicPage
 *   └── CPicLayer*   (emitted BOTTOM-TO-TOP — §8.2)
 *       └── CPicFrame*
 *           └── <element>*  (CPicShape | CPicSymbol/Sprite/Button | CPicText | CPicBitmap)
 *
 * Every node is a CPicObjBase (§5.3). We deliberately use schema byte = 1 for
 * the base of every record so the post-children tail is exactly
 * `s32 regX; s32 regY` with the INT_MIN sentinel — which, combined with the
 * NULL child terminator, produces the 10-byte object-tail signature
 * (`00 00 00 00 00 80 00 00 00 80`) the reader's boundary scanners look for.
 *
 * Confidence: the record FIELD ORDER is taken from the importer (the inverse
 * oracle) and the v2 spec. It is structurally faithful and round-trips through
 * `tryLoadRealFla`, but is NOT yet byte-verified against a Win7 Flash 8 oracle.
 */

import type { Frame, Layer, Timeline } from "../../model/types.js";
import type {
  DisplayObject,
  ShapeDisplayObject,
  SymbolInstance,
  TextDisplayObject,
  BitmapDisplayObject,
  Fill,
  Stroke,
  PathSegment,
  Point,
} from "../../engine/types.js";
import {
  ByteWriter,
  ClassTable,
  writeMatrix,
  writeRGBA,
  writeBomString,
  writePlainStringUnicode,
  type WColor,
  type WMatrix,
} from "./carchive-write.js";
import { PAGE_FRAME_BODY, PAGE_TAIL } from "./empty-templates.js";

/**
 * Deterministic frameId stamped into the big-endian frameId field of an empty
 * keyframe body. The real fixture stores 0xE14A; a fixed value keeps Flash happy.
 */
const FIXED_FRAME_ID = 0xe14a;
/** Big-endian frameId offset within PAGE_FRAME_BODY. */
const FRAME_BODY_FRAMEID_OFFSET = 0x57;

const INT_MIN = 0x80000000;
/** Shape edge coordinates are 8.8 fixed-point twips: 1 px = 20*256 = 5120. */
const EDGE_UNIT = 5120;

/** Resolve a model symbolId / libraryItemId to its 1-based "Symbol N" number. */
export interface WriteIndex {
  /** model library-item id -> symbol stream number */
  symbolNumById: Map<string, number>;
  /** model library-item id -> media stream number (bitmaps/sounds/video) */
  mediaNumById: Map<string, number>;
  /** model library-item id -> SymbolType */
  symbolTypeById: Map<string, "movieclip" | "button" | "graphic">;
}

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

export function writeTimelineStream(timeline: Timeline, idx: WriteIndex): Uint8Array {
  const w = new ByteWriter(1024);
  const ct = new ClassTable();
  w.u8(0x01); // root marker
  ct.useClass(w, "CPicPage", 1);
  writeCPicPage(w, ct, timeline, idx);
  return w.finish();
}

/** True for a default empty keyframe (no display objects). */
function isEmptyKeyframe(f: Frame): boolean {
  return f.isEmpty || f.displayObjects.length === 0;
}

// ---------------------------------------------------------------------------
// CPicObjBase helpers
// ---------------------------------------------------------------------------

/**
 * Open a CPicObjBase with schema=1 and the given flags byte. The caller is
 * responsible for emitting children (via the supplied ClassTable) and then
 * calling `closeObjBase`.
 */
function openObjBaseHeader(w: ByteWriter, flags = 0): void {
  w.u8(1); // schema = 1 (regX/regY tail only)
  w.u8(flags);
}

/** Terminate the children list and write the INT_MIN registration sentinel. */
function closeObjBase(w: ByteWriter, ct: ClassTable, reg?: { x: number; y: number }): void {
  ct.writeNull(w); // end of children
  if (reg && (reg.x !== 0 || reg.y !== 0)) {
    w.s32(Math.round(reg.x * 20));
    w.s32(Math.round(reg.y * 20));
  } else {
    w.u32(INT_MIN); // regX absent
    w.u32(INT_MIN); // regY absent
  }
}

// ---------------------------------------------------------------------------
// CPicPage (§8.1)
// ---------------------------------------------------------------------------

function writeCPicPage(w: ByteWriter, ct: ClassTable, timeline: Timeline, idx: WriteIndex): void {
  // §10.1: u8 pageVersion = 0x04, u8 0x00.
  w.u8(0x04).u8(0x00);
  // Children: layers BOTTOM-TO-TOP. The model stores top-to-bottom (li=0 = top),
  // so reverse for the binary (§9).
  const bottomToTop = [...timeline.layers].reverse();
  for (const layer of bottomToTop) {
    ct.useClass(w, "CPicLayer", 1);
    writeCPicLayer(w, ct, layer, idx);
  }
  // CPicPage tail (§10.1). Byte-matches the genuine empty fixture: the null child
  // tag, sentinel registration point, F8 skip(2), pageVersionB, nextLayerId,
  // currentFrame, and guide count.
  w.bytes(PAGE_TAIL);
}

// ---------------------------------------------------------------------------
// CPicLayer (§10.2)
// ---------------------------------------------------------------------------

const LAYER_TYPE_BYTE: Record<Layer["type"], number> = {
  normal: 0,
  guide: 1,
  guided: 2,
  folder: 3,
  mask: 4,
  masked: 0, // masked children carry layerType 0 + a parentLayerRef
};

function writeCPicLayer(w: ByteWriter, ct: ClassTable, layer: Layer, idx: WriteIndex): void {
  // §10.2: u8 layerVersion = 0x04, u8 0x00.
  w.u8(0x04).u8(0x00);
  // Children: frames (only keyframes become CPicFrame records).
  const keyframes = layer.frames.filter((f) => f.isKeyframe);
  const frameList = keyframes.length > 0 ? keyframes : [layer.frames[0]!];
  for (let i = 0; i < frameList.length; i++) {
    const f = frameList[i]!;
    const next = frameList[i + 1];
    const span = next ? next.index - f.index : Math.max(1, layer.frameCount - f.index);
    ct.useClass(w, "CPicFrame", 1);
    writeCPicFrame(w, ct, f, Math.max(1, span), idx);
  }
  // Post-frames lead-in (§10.2): null child tag, sentinel regpoint, F8 skip(2).
  ct.writeNull(w); // 00 00
  w.u32(INT_MIN).u32(INT_MIN); // sentinel registration point
  w.raw(0x00, 0x00); // F8 skip(2)
  // u8 layerVersionB = 0x0B, then the layer name BomString.
  w.u8(0x0b);
  writeBomString(w, layer.name);
  // F4+ properties block. Defaults match a genuine new layer.
  w.u8(layer.locked || !layer.visible ? 0 : 1); // isSelected (a fresh layer is selected)
  w.u8(layer.visible ? 0 : 1); // hidden
  w.u8(layer.locked ? 1 : 0); // locked
  w.u32(0xffffffff); // skip(4) sentinel
  writeRGBA(w, parseHexColor(layer.outlineColor)); // outline color RGBA
  w.u8(layer.outlineMode ? 1 : 0); // showOutlines
  w.raw(0x00, 0x00, 0x00); // skip(3)
  w.u8(Math.max(1, Math.round((layer.height || 20) / 20)) || 1); // heightMultiplier
  w.raw(0x00, 0x00, 0x00); // skip(3)
  w.u8(LAYER_TYPE_BYTE[layer.type] ?? 0); // layerType
  // MX block: parent reference (0 = none), open, autoNamed.
  w.u16(0); // parentReference (u16 0 when no parent)
  w.u8(1); // open
  w.u8(1); // autoNamed
}

// ---------------------------------------------------------------------------
// CPicFrame (§11)
// ---------------------------------------------------------------------------

function writeCPicFrame(
  w: ByteWriter,
  ct: ClassTable,
  frame: Frame,
  duration: number,
  idx: WriteIndex,
): void {
  // §11: u8 frameVersion = 0x04, u8 0x00.
  w.u8(0x04).u8(0x00);

  if (isEmptyKeyframe(frame)) {
    // Empty keyframe: emit the genuine empty-keyframe body verbatim (the null
    // child tag, sentinel regpoint, inherited empty CPicShape, and the frame
    // fields). The big-endian frameId is stamped deterministically. The duration
    // for the default empty doc is the fixture's value; for a custom span we
    // patch the duration field too.
    const body = new Uint8Array(PAGE_FRAME_BODY);
    body[FRAME_BODY_FRAMEID_OFFSET] = (FIXED_FRAME_ID >>> 8) & 0xff;
    body[FRAME_BODY_FRAMEID_OFFSET + 1] = FIXED_FRAME_ID & 0xff;
    w.bytes(body);
    return;
  }

  // Non-empty keyframe: real serialization.
  //
  // Real Flash stores a frame's raw vector graphics as the frame's OWN inline
  // shape body (part of the CPicFrame/CPicShape serialization), NOT as separate
  // tagged CPicShape children. Only PLACED objects (instances, text, bitmaps,
  // groups) are tagged children in the frame's child list. So:
  //   1. Partition displayObjects into raw shapes vs placed objects.
  //   2. Emit ONLY the placed objects as tagged children.
  //   3. Write the merged raw-shape geometry as the frame's INLINE shape body.
  // This keeps the running CArchive class table to {CPicPage,CPicLayer,CPicFrame}
  // for a shape-only doc (no spurious CPicShape NEWCLASS that derails the reader).
  const rawShapes: ShapeDisplayObject[] = [];
  const placed: DisplayObject[] = [];
  for (const obj of frame.displayObjects) {
    if (obj.type === "shape") {
      rawShapes.push(obj);
    } else if (obj.type === "drawing-object") {
      // A drawing object's geometry merges into the inline shape too (it has no
      // separate placeable identity in this writer).
      rawShapes.push({ type: "shape", id: obj.id, shape: obj.shape, x: obj.x, y: obj.y });
    } else {
      placed.push(obj);
    }
  }

  // Children = placed objects only (shapes are skipped — they go inline below).
  for (const obj of placed) {
    writeElement(w, ct, obj, idx);
  }
  // Close the frame's CPicObjBase (schema=4, from the `04 00` header above): end
  // of children, sentinel registration point, then the schema>2 / schema>3 skip
  // bytes the reader consumes for a schema-4 base.
  ct.writeNull(w); // end of children
  w.u32(INT_MIN).u32(INT_MIN); // sentinel registration point
  w.u8(0x00); // schema > 2 skip(1)
  w.u8(0x00); // schema > 3 skip(1)

  // Inherited inline CPicShape body (NO ObjBase/instance-header/matrix-tag wrapper —
  // it is part of the frame's own serialization). Lead-in: u8 shapeSchema=0x03,
  // then an identity matrix, then the merged shape geometry. The geometry of all
  // the frame's raw shapes is merged into ONE inline shape (Flash merges raw
  // graphics on a layer/keyframe into a single editable shape). Zero raw shapes =>
  // an empty inline shape, byte-matching the genuine empty keyframe.
  w.u8(0x03); // shapeSchema (matches the real fixture's inline-shape lead-in)
  writeMatrix(w, identity());
  if (rawShapes.length === 0) {
    writeEmptyShapeData(w);
  } else {
    writeMergedShapeGeometry(w, rawShapes);
  }

  // Frame fields. fs (frame schema) = 0x18 (frameVersionB).
  const fs = 0x18;
  w.u8(fs);
  w.u16(Math.max(1, duration));
  // keyMode (§11.1). Base idle bits 0x600; OR the tween bit.
  let keyMode = 0x600;
  if (frame.tweenType === "motion") keyMode |= 0x0001;
  else if (frame.tweenType === "shape") keyMode |= 0x0002;
  if (frame.tweenType === "motion" && !frame.motionScale) keyMode |= 0x0400;
  if (frame.tweenType === "motion" && frame.motionSync) keyMode |= 0x0800;
  w.u16(keyMode);
  w.s16(easeAccel(frame)); // acceleration
  w.u16(0); // soundId
  w.u16(0); // sound envelope count
  w.u16(0).u8(0).u32(0).u32(0); // soundLoop, soundSync, inPoint, outPoint
  w.u16(0); // soundZoom
  writeBomString(w, frame.label);
  writeTimelineSubObject(w, frame.script);
  w.u32(rotateFlaValue(frame.motionRotate));
  w.u32(frame.motionRotateCount | 0);
  w.u32(frame.labelType === "comment" ? 1 : frame.labelType === "anchor" ? 2 : 0);
  w.u16(0); // morphTag
  w.u32((frame.motionOrientToPath ? 0x01 : 0) | (frame.motionSnap ? 0x02 : 0));
  w.u16(0); // oblistTag
  writeBomString(w, ""); // tweenInstanceName
}

function easeAccel(frame: Frame): number {
  if (frame.tweenType === "shape") return clampEase(frame.shapeEase);
  if (frame.tweenType === "motion") return clampEase(frame.motionEase);
  return 0;
}

function clampEase(v: number): number {
  return Math.max(-100, Math.min(100, Math.round(v || 0)));
}

function rotateFlaValue(r: Frame["motionRotate"]): number {
  switch (r) {
    case "auto":
      return 2;
    case "cw":
      return 3;
    case "ccw":
      return 4;
    default:
      return 1;
  }
}

/**
 * TimelineSubObject (§9.2) carrying the frame's AS2 source. typeId=4 (MX2004/F8),
 * formatType=1 (authored frame). Matches `readTimelineSubObject`.
 */
function writeTimelineSubObject(w: ByteWriter, script: string): void {
  w.u32(4); // typeId (frameVersionC: 4 = MX2004/F8)
  w.u32(1); // formatType = 1 (authored)
  // typeId >= 1: skip(4) then u32 count (we use 0).
  w.u32(0); // 4 reserved bytes
  w.u32(0); // id-list count = 0
  // typeId >= 5 would skip(4) — typeId is 4, so none.
  writeBomString(w, script ?? "");
}

// ---------------------------------------------------------------------------
// Shape data (§10.4) + edges (§10.5)
// ---------------------------------------------------------------------------

/**
 * An empty inline shape body, byte-matching the genuine empty keyframe fixture:
 * internal schema 0x05, edge-count hint 0, 0 fills, 0 lines, edge terminator, and
 * the schema>4 cubic-bezier post-stream count (0). (14 bytes, identical to the
 * `05 00000000 0000 0000 00 00000000` run in flash8-empty.fla's Page 1.)
 */
function writeEmptyShapeData(w: ByteWriter): void {
  w.u8(0x05); // internal shape-data schema (>4 => cubic post-stream present)
  w.u32(0); // edge count hint
  w.u16(0); // fillCount
  w.u16(0); // lineCount
  w.u8(0); // edge terminator (flags == 0)
  w.u32(0); // cubicCount (schema > 4 post-edge stream)
}

// ---------------------------------------------------------------------------
// CPicShape (§10.1)
// ---------------------------------------------------------------------------

/**
 * Serialize the merged geometry of one or more raw shapes as a fill/line style
 * table + edge stream (caps = true / F8), in the REAL inline-shape format decoded
 * from `fixtures/square-canon.fla`:
 *
 *   u8  schema = 0x05              // internal shape-data schema (>4)
 *   u32 edgeCountHint = 0
 *   u16 fillCount;   FillStyle[]   // §12.1 solid = RGBA + 00 00
 *   u16 strokeCount; LineStyle[]   // F8 caps stroke (22 bytes each)
 *   <edge stream> ... u8 0         // edge terminator
 *   u32 cubicCount = 0             // schema>4 cubic-bezier post-stream
 *
 * Flash merges all raw graphics on a layer/keyframe into ONE editable shape, so
 * when several raw shapes share a frame their fills/strokes/edges are concatenated
 * into a single table here (1-based, in shape-then-path order). Each shape's x/y
 * offset is baked into its edge coordinates because the inline shape carries an
 * identity matrix (the offset is NOT a separate placement).
 */
function writeMergedShapeGeometry(w: ByteWriter, shapes: readonly ShapeDisplayObject[]): void {
  // Build merged fill + stroke style tables (1-based indices) across all shapes.
  const fills: Fill[] = [];
  const strokes: Stroke[] = [];
  const fillIndexOf = (f: Fill): number => {
    fills.push(f);
    return fills.length;
  };
  const strokeIndexOf = (s: Stroke): number => {
    strokes.push(s);
    return strokes.length;
  };

  interface EdgeRun {
    fill0: number;
    fill1: number;
    line: number;
    start: Point;
    segs: readonly PathSegment[];
    /** per-shape pixel offset baked into edge coords (identity inline matrix). */
    ox: number;
    oy: number;
  }
  const runs: EdgeRun[] = [];
  for (const shape of shapes) {
    for (const p of shape.shape.paths) {
      const fill0 = 0;
      const fill1 = p.fill ? fillIndexOf(p.fill) : 0;
      const line = p.stroke ? strokeIndexOf(p.stroke) : 0;
      if (fill1 === 0 && line === 0) continue;
      runs.push({ fill0, fill1, line, start: p.start, segs: p.segments, ox: shape.x, oy: shape.y });
    }
  }

  // edgeCountHint = total segment count across all runs (Flash stores the real
  // edge count here; the reader skips it, but the genuine fixture populates it —
  // e.g. square-canon's 4-segment rectangle stores 0x04).
  let edgeCount = 0;
  for (const run of runs) edgeCount += run.segs.length;

  w.u8(0x05); // internal shape-data schema (>4 => cubic post-stream present)
  w.u32(edgeCount); // edge count hint
  w.u16(fills.length);
  for (const f of fills) writeFillStyle(w, f);
  w.u16(strokes.length);
  for (const s of strokes) writeLineStyle(w, s);

  // Edge stream (§12.3) — Flash's canonical encoding. Two fixes vs the old
  // emitter (which crashed Flash): (1) the initial moveTo is FOLDED into the
  // first edge record's FROM field — a record always carries a TO — so N
  // segments produce exactly N edge records == edgeCount (the old code wrote a
  // standalone FROM-only move record + one per segment = N+1 records, so Flash
  // read edgeCount records, hit the surplus record where it expected the
  // terminator+cubicCount, read a garbage cubic count, and crashed). (2) Coords
  // use the smallest form that fits: SHORT (s16 = round(px*40), 15.1 twips) when
  // in range, else FLOAT (s32 of round(px*5120) = u8 frac + s24 int, 8.8 twips).
  // For a plain rectangle this reproduces real Flash's exact type bytes
  // (0xF3, 0x30, 0x30, 0x30) — verified against square-canon.fla.
  const SHORT = 3;
  const FLOAT = 2;
  const SHORT_UNIT = EDGE_UNIT / 128; // 40 = px -> 15.1 twips
  const formOf = (dx: number, dy: number): number => {
    const sx = Math.round(dx * SHORT_UNIT);
    const sy = Math.round(dy * SHORT_UNIT);
    return sx >= -32768 && sx <= 32767 && sy >= -32768 && sy <= 32767 ? SHORT : FLOAT;
  };
  const emitDelta = (form: number, dx: number, dy: number): void => {
    if (form === SHORT) {
      w.s16(Math.round(dx * SHORT_UNIT)).s16(Math.round(dy * SHORT_UNIT));
    } else {
      w.s32(Math.round(dx * EDGE_UNIT)).s32(Math.round(dy * EDGE_UNIT));
    }
  };
  let penX = 0;
  let penY = 0;
  for (const run of runs) {
    const sx = run.ox + run.start.x;
    const sy = run.oy + run.start.y;
    let first = true;
    for (const seg of run.segs) {
      const tx = run.ox + seg.to.x;
      const ty = run.oy + seg.to.y;
      if (first) {
        // First record: style change (0x40) + no-sel (0x80), the folded move
        // (FROM = pen -> run start, omitted if zero), then the first edge.
        const fdx = sx - penX;
        const fdy = sy - penY;
        const hasFrom = Math.round(fdx * SHORT_UNIT) !== 0 || Math.round(fdy * SHORT_UNIT) !== 0;
        const fForm = hasFrom ? formOf(fdx, fdy) : 0;
        if (seg.type === "line") {
          const tForm = formOf(tx - sx, ty - sy);
          w.u8(0x80 | 0x40 | (tForm << 4) | fForm);
          w.u8(run.line & 0xff).u8(run.fill0 & 0xff).u8(run.fill1 & 0xff);
          if (hasFrom) emitDelta(fForm, fdx, fdy);
          emitDelta(tForm, tx - sx, ty - sy);
        } else {
          const cx = run.ox + seg.control.x;
          const cy = run.oy + seg.control.y;
          const cForm = formOf(cx - sx, cy - sy);
          const tForm = formOf(tx - cx, ty - cy);
          w.u8(0x80 | 0x40 | (tForm << 4) | (cForm << 2) | fForm);
          w.u8(run.line & 0xff).u8(run.fill0 & 0xff).u8(run.fill1 & 0xff);
          if (hasFrom) emitDelta(fForm, fdx, fdy);
          emitDelta(cForm, cx - sx, cy - sy);
          emitDelta(tForm, tx - cx, ty - cy);
        }
        first = false;
      } else if (seg.type === "line") {
        const tForm = formOf(tx - penX, ty - penY);
        w.u8(tForm << 4);
        emitDelta(tForm, tx - penX, ty - penY);
      } else {
        const cx = run.ox + seg.control.x;
        const cy = run.oy + seg.control.y;
        const cForm = formOf(cx - penX, cy - penY);
        const tForm = formOf(tx - cx, ty - cy);
        w.u8((tForm << 4) | (cForm << 2));
        emitDelta(cForm, cx - penX, cy - penY);
        emitDelta(tForm, tx - cx, ty - cy);
      }
      penX = tx;
      penY = ty;
    }
  }
  w.u8(0); // edge terminator
  w.u32(0); // cubicCount (schema > 4 post-edge stream)
}

function writeFillStyle(w: ByteWriter, fill: Fill): void {
  // Only solid fills are written byte-faithfully; gradients/bitmaps fall back to
  // a solid approximation (their first stop / a neutral color) to keep the
  // stream parseable. (Gradient/bitmap fill writing is approximated — see report.)
  if (fill.type === "solid") {
    writeRGBA(w, fill.color);
    w.u8(0x00); // subtype: solid
    w.u8(0); // more_flags
    return;
  }
  if (fill.type === "linear-gradient" || fill.type === "radial-gradient") {
    const first = fill.stops[0]?.color ?? { r: 0, g: 0, b: 0, a: 255 };
    writeRGBA(w, first);
    w.u8(0x00); // approximated as solid
    w.u8(0);
    return;
  }
  // bitmap fill -> approximate as solid white.
  writeRGBA(w, { r: 255, g: 255, b: 255, a: 255 });
  w.u8(0x00);
  w.u8(0);
}

const CAP_BYTE: Record<string, number> = { round: 0, none: 1, square: 2 };
const JOIN_BYTE: Record<string, number> = { round: 0, bevel: 1, miter: 2 };
const SCALE_MODE_BYTE: Record<string, number> = { normal: 0, horizontal: 1, vertical: 2, none: 3 };

function writeLineStyle(w: ByteWriter, s: Stroke): void {
  // caps = true layout: RGBA, u16 width twips, u32 styleParams, pixelHinting,
  // scaleMode, capStyle, joinStyle, miterFrac, miterInt, then a full fill style.
  writeRGBA(w, s.color);
  w.u16(Math.round((s.width || 0) * 20));
  w.u32(0); // styleParam1 + styleParam2
  w.u8(s.pixelHinting ? 1 : 0);
  w.u8(SCALE_MODE_BYTE[s.strokeScaleMode ?? "normal"] ?? 0);
  w.u8(CAP_BYTE[s.caps] ?? 0);
  w.u8(JOIN_BYTE[s.joints] ?? 0);
  const miter = s.miterLimit || 3;
  const miterInt = Math.floor(miter);
  const miterFrac = Math.round((miter - miterInt) * 256) & 0xff;
  w.u8(miterFrac);
  w.u8(miterInt & 0xff);
  // Stroke paint as a solid fill.
  writeRGBA(w, s.color);
  w.u8(0x00);
  w.u8(0);
}

// ---------------------------------------------------------------------------
// Symbol instances (§12)
// ---------------------------------------------------------------------------

function writeElement(w: ByteWriter, ct: ClassTable, obj: DisplayObject, idx: WriteIndex): void {
  switch (obj.type) {
    case "shape":
    case "drawing-object":
      // Raw shapes / drawing objects are NOT tagged children: their geometry is
      // merged into the frame's own inline shape body (see writeCPicFrame). They
      // are partitioned out before writeElement is called, so reaching here would
      // be a caller bug — never emit a CPicShape class (it would corrupt the §5.2
      // running index that later backrefs depend on). Skip defensively.
      return;
    case "instance":
      writeInstance(w, ct, obj, idx);
      return;
    case "text":
      ct.useClass(w, "CPicText", 0x0d);
      writeCPicText(w, ct, obj);
      return;
    case "bitmap":
      ct.useClass(w, "CPicBitmap", 2);
      writeCPicBitmap(w, ct, obj, idx);
      return;
    default:
      // group / video — not serialized (out of scope for round-trip tests).
      return;
  }
}

function instanceMatrix(obj: SymbolInstance): WMatrix {
  const rot = ((obj.rotation ?? 0) * Math.PI) / 180;
  const skewX = ((obj.skewX ?? 0) * Math.PI) / 180;
  const sx = obj.scaleX ?? 1;
  const sy = obj.scaleY ?? 1;
  // a,b from rotation; c,d from rotation+skewX (matches importer's decompose()).
  const a = sx * Math.cos(rot);
  const b = sx * Math.sin(rot);
  const c = -sy * Math.sin(rot + skewX);
  const d = sy * Math.cos(rot + skewX);
  return { a, b, c, d, tx: obj.x, ty: obj.y };
}

function writeInstance(w: ByteWriter, ct: ClassTable, obj: SymbolInstance, idx: WriteIndex): void {
  const symbolType = idx.symbolTypeById.get(obj.symbolId) ?? "movieclip";
  if (symbolType === "button") {
    ct.useClass(w, "CPicButton", 0x13);
    writeSymbolBaseFields(w, ct, obj, idx);
    writeButtonTail(w, obj);
  } else if (symbolType === "graphic") {
    ct.useClass(w, "CPicSymbol", 0x13);
    writeSymbolBaseFields(w, ct, obj, idx);
    // graphic ends after base fields.
  } else {
    ct.useClass(w, "CPicSprite", 0x13);
    writeSymbolBaseFields(w, ct, obj, idx);
    writeSpriteTail(w, obj);
  }
}

/**
 * SymbolBaseFields (§12) at symbolSchema 0x13 (F8). Mirrors
 * `readCPicSymbolFields`.
 */
function writeSymbolBaseFields(
  w: ByteWriter,
  ct: ClassTable,
  obj: SymbolInstance,
  idx: WriteIndex,
): void {
  openObjBaseHeader(w);
  closeObjBase(
    w,
    ct,
    obj.registrationPoint ? { x: obj.registrationPoint.x, y: obj.registrationPoint.y } : undefined,
  );

  const symbolSchema = 0x13;
  w.u8(symbolSchema);
  writeMatrix(w, instanceMatrix(obj));
  w.u16(obj.firstFrame ?? 0); // firstFrame (0-based)
  w.u8(loopModeByte(obj.loopMode)); // loopMode
  w.u8(0); // reserved
  // symbolSchema >= 7 => skip(1)
  w.u8(0);
  // symbolSchema >= 4 => COLOR TRANSFORM. schema 0x13 >= 6 so alpha pair present.
  // Per channel: u16 mult (0x100=1.0) + s16 off. Order: alpha, red, green, blue.
  const ce = colorEffectChannels(obj);
  w.u16(ce.aMult).s16(ce.aOff);
  w.u16(ce.rMult).s16(ce.rOff);
  w.u16(ce.gMult).s16(ce.gOff);
  w.u16(ce.bMult).s16(ce.bOff);
  w.u16(0); // effect type (UI hint)
  w.u16(0); // value percent
  w.u32(0); // effect color
  // symbolSchema >= 6 => empty CString.
  writeBomString(w, "");
  // libraryIndex (u16) + skip(2).
  w.u16(idx.symbolNumById.get(obj.symbolId) ?? 0);
  w.u16(0);
  // symbolSchema >= 0x0e => skip(3).
  w.u8(0).u8(0).u8(0);
  // symbolSchema >= 0x13 => filterCount(u8) + (no filters) + blendMode(u8) + skip(2).
  w.u8(0); // filterCount = 0 (filters approximated/omitted)
  w.u8(blendModeByte(obj.blendMode));
  w.u16(0); // 2 reserved bytes
  // symbolSchema >= 0x16 (CS4) not used (0x13).
}

function loopModeByte(mode: SymbolInstance["loopMode"]): number {
  switch (mode) {
    case "play-once":
      return 1;
    case "single-frame":
      return 2;
    default:
      return 0;
  }
}

const BLEND_NAMES = [
  "normal",
  "normal",
  "layer",
  "multiply",
  "screen",
  "lighten",
  "darken",
  "difference",
  "add",
  "subtract",
  "invert",
  "alpha",
  "erase",
  "overlay",
  "hardlight",
];

function blendModeByte(mode: SymbolInstance["blendMode"]): number {
  if (!mode || mode === "normal") return 0;
  const i = BLEND_NAMES.indexOf(mode, 1);
  return i < 0 ? 0 : i;
}

function colorEffectChannels(obj: { colorEffect?: { type: string; alpha?: number } | undefined }): {
  aMult: number;
  aOff: number;
  rMult: number;
  rOff: number;
  gMult: number;
  gOff: number;
  bMult: number;
  bOff: number;
} {
  const ident = { aMult: 256, aOff: 0, rMult: 256, rOff: 0, gMult: 256, gOff: 0, bMult: 256, bOff: 0 };
  const ce = obj.colorEffect;
  if (!ce) return ident;
  if (ce.type === "alpha" && ce.alpha != null) {
    return { ...ident, aMult: Math.round((ce.alpha / 100) * 256) };
  }
  return ident; // other effects approximated as identity (documented gap)
}

/** CPicSprite tail (§12.2): g (trailer version) + TimelineSubObject + name + reserved. */
function writeSpriteTail(w: ByteWriter, obj: SymbolInstance): void {
  const g = 8; // MX2004+ trailer
  w.u8(g);
  // g >= 3: TimelineSubObject (onClipEvent script) + instanceName.
  writeTimelineSubObject(w, clipActionsToScript(obj));
  writeBomString(w, obj.instanceName ?? "");
  // g >= 6: skip(9), accessibility (absent => leading 0 byte), skip(8).
  for (let i = 0; i < 9; i++) w.u8(0);
  w.u8(0); // accessibility version 0 => absent
  for (let i = 0; i < 8; i++) w.u8(0);
  // g >= 8: skip(5) + component metadata XML CString.
  for (let i = 0; i < 5; i++) w.u8(0);
  writeBomString(w, "");
}

/** CPicButton tail (§12.3): b + TimelineSubObject + trackAsMenu + name + accessibility + skip(4). */
function writeButtonTail(w: ByteWriter, obj: SymbolInstance): void {
  const b = 0x0b; // MX2004+ trailer
  w.u8(b);
  writeTimelineSubObject(w, buttonHandlersToScript(obj));
  w.u8(obj.trackAsMenu ? 1 : 0); // trackAsMenu
  writeBomString(w, obj.instanceName ?? "");
  // b >= 8: accessibility (absent => leading 0).
  w.u8(0);
  // skip(4).
  w.u32(0);
}

function clipActionsToScript(obj: SymbolInstance): string {
  if (!obj.clipActions || obj.clipActions.length === 0) return "";
  return obj.clipActions.map((a) => `onClipEvent(${a.event}){${a.script}}`).join("");
}

function buttonHandlersToScript(obj: SymbolInstance): string {
  if (!obj.buttonHandlers || obj.buttonHandlers.length === 0) return "";
  return obj.buttonHandlers
    .map((h) => {
      const ev = typeof h.event === "string" ? h.event : `keyPress "${h.event.keyPress}"`;
      return `on(${ev}){${h.script}}`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// CPicBitmap (§16)
// ---------------------------------------------------------------------------

function writeCPicBitmap(w: ByteWriter, ct: ClassTable, obj: BitmapDisplayObject, idx: WriteIndex): void {
  openObjBaseHeader(w);
  closeObjBase(w, ct);
  w.u8(2); // schema (>=2 => filterCount byte present)
  writeMatrix(w, { a: obj.scaleX ?? 1, b: 0, c: 0, d: obj.scaleY ?? 1, tx: obj.x, ty: obj.y });
  w.u16(idx.mediaNumById.get(obj.libraryItemId) ?? 0); // mediaId
  w.u8(0); // filterCount = 0
}

// ---------------------------------------------------------------------------
// CPicText (§15 / §17)
// ---------------------------------------------------------------------------

const ALIGN_BYTE: Record<string, number> = { left: 0, right: 1, center: 2, justify: 3 };

function writeCPicText(w: ByteWriter, ct: ClassTable, obj: TextDisplayObject): void {
  openObjBaseHeader(w);
  closeObjBase(w, ct);

  const ts = 0x0d; // F8
  w.u8(ts);
  // The importer folds left/top into placement (matrix.tx + left/20). We put the
  // full placement in the matrix and set the box origin to (0,0).
  writeMatrix(w, { a: 1, b: 0, c: 0, d: 1, tx: obj.x, ty: obj.y });
  const left = 0;
  const top = 0;
  const right = Math.round(obj.width * 20);
  const bottom = Math.round(obj.height * 20);
  w.s32(left).s32(right).s32(top).s32(bottom);
  w.u8(autoSizeOf(obj)); // autoExpand
  // ts >= 4 => skip(1) reserved.
  w.u8(0);
  // ts >= 4 => textFlags + embedFlag.
  w.u8(textFlagsByte(obj));
  w.u8(0); // embedFlag
  // ts >= 5 => selectable + reserved.
  w.u8(obj.textType === "static" ? 0 : 1);
  w.u8(0);
  // ts >= 4 => maxChars (u16) + as2VariableName.
  w.u16(obj.maxChars ?? 0);
  writeBomString(w, obj.as2VariableName ?? "");
  // embedFlag & 0x20 not set.
  // ts >= 0x0e not used.

  // Runs. embedFlag & 0x40 not set => loop of (u16 charCount, run, chars).
  if (obj.text.length > 0) {
    w.u16(obj.text.length);
    writeTextRunFields(w, obj, ts);
    for (let i = 0; i < obj.text.length; i++) w.u16(obj.text.charCodeAt(i)); // unicode chars
  }
  w.u16(0); // charCount = 0 terminates the run loop.

  // ts >= 9 tail: instanceName, accessibility, reserved, scrollable, reserved,
  // (ts>=0x0c) two CStrings, (ts>=0x0d) filter block.
  writeBomString(w, obj.instanceName ?? "");
  w.u8(0); // accessibility absent
  w.u32(0); // 4 reserved
  w.u8(obj.scrollable ? 1 : 0); // scrollable
  w.u8(0).u8(0).u8(0); // 3 reserved
  // ts >= 0x0c
  writeBomString(w, ""); // reserved
  writeBomString(w, ""); // font embed ranges
  // ts >= 0x0d: hasFilters marker + trailing u16.
  w.u8(0); // hasFilters = 0
  w.u16(0); // trailing
}

/** One text run's formatting block (§15.2). Mirrors `readTextRunFields` (ts=0x0d). */
function writeTextRunFields(w: ByteWriter, obj: TextDisplayObject, ts: number): void {
  const unicode = ts >= 0x0c;
  w.u8(1); // run version
  w.u16(Math.round(obj.fontSize * 20)); // size*20
  // fontName: plain unicode string (not CS4).
  writePlainStringUnicode(w, obj.fontFamily || "Arial");
  writeRGBA(w, obj.color);
  w.u16(0); // font category
  w.u8(obj.bold ? 1 : 0);
  w.u8(obj.italic ? 1 : 0);
  w.u8(0); // reserved
  w.u8(obj.autoKern ? 1 : 0);
  w.u8(0); // charPos
  w.u8(ALIGN_BYTE[obj.align] ?? 0);
  w.u16(Math.round((obj.leading ?? 0) * 20));
  w.u16(Math.round((obj.indent ?? 0) * 20));
  w.u16(Math.round((obj.leftMargin ?? 0) * 20));
  w.u16(Math.round((obj.rightMargin ?? 0) * 20));
  // ts >= 5 => letterSpacing s16.
  w.s16(Math.round((obj.letterSpacing ?? 0) * 20));
  // linkUrl
  if (unicode) writePlainStringUnicode(w, obj.linkUrl ?? "");
  else writePlainStringUnicode(w, obj.linkUrl ?? "");
  // ts >= 9: vertical, rtl, rotation, (ts>=0x0c) bitmapRender, linkTarget.
  const orient = obj.orientation ?? "horizontal";
  w.u8(orient === "vertical-rtl" || orient === "vertical-ltr" ? 1 : 0); // vertical
  w.u8(orient === "vertical-rtl" ? 1 : 0); // rtl
  w.u8(0); // rotation
  w.u8(0); // bitmapRender (ts>=0x0c)
  writePlainStringUnicode(w, obj.linkTarget ?? "");
  // ts >= 0x0d: 0x02 marker, renderMode, thickness f32, sharpness f32, url.
  w.u8(0x02);
  w.u8(renderModeByte(obj.antiAlias));
  w.f32(obj.csm?.thickness ?? 0);
  w.f32(obj.csm?.sharpness ?? 0);
  writePlainStringUnicode(w, "");
}

const ANTI_ALIAS_BYTE: Record<string, number> = {
  device: 0,
  bitmap: 1,
  animation: 2,
  readability: 3,
  custom: 4,
};

function renderModeByte(aa: TextDisplayObject["antiAlias"]): number {
  return ANTI_ALIAS_BYTE[aa ?? "animation"] ?? 2;
}

function textFlagsByte(obj: TextDisplayObject): number {
  let f = 0;
  if (obj.textType === "dynamic") f |= 0x01 | 0x02;
  else if (obj.textType === "input") f |= 0x01;
  if (obj.password) f |= 0x04;
  if (obj.wordWrap) f |= 0x08;
  if (obj.multiline) f |= 0x10;
  if (obj.hasBackground) f |= 0x20;
  if (obj.hasBorder) f |= 0x40;
  return f;
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function identity(): WMatrix {
  return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
}

export function parseHexColor(hex: string): WColor {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 255, a: 255 };
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 255 };
}

// Provide the autoSizeFlag helper at runtime (the model TextDisplayObject has
// `autoSize?: boolean`; the writer reads it directly here to avoid relying on a
// method).
function autoSizeOf(obj: TextDisplayObject): number {
  return (obj as unknown as { autoSize?: boolean }).autoSize ? 1 : 0;
}

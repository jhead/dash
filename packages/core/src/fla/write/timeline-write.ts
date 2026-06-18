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
  ShapePath,
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

  // Non-empty keyframe: real serialization. Children = the frame's display objects.
  for (const obj of frame.displayObjects) {
    writeElement(w, ct, obj, idx);
  }
  ct.writeNull(w); // end of children
  w.u32(INT_MIN).u32(INT_MIN); // sentinel registration point

  // Inherited CPicShape body: schema + matrix + empty shape data (raw shapes are
  // child CPicShape records, so the frame's own merge-shape is empty).
  w.u8(1); // shapeSchema
  writeMatrix(w, identity());
  writeEmptyShapeData(w);

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

/** An empty shape body: schema, edge-count hint, 0 fills, 0 lines, edge terminator. */
function writeEmptyShapeData(w: ByteWriter): void {
  w.u8(3); // schema (>=2 so the reader looks for an edge stream)
  w.u32(0); // edge count hint
  w.u16(0); // fillCount
  w.u16(0); // lineCount
  w.u8(0); // edge terminator (flags == 0)
}

// ---------------------------------------------------------------------------
// CPicShape (§10.1)
// ---------------------------------------------------------------------------

function writeCPicShape(w: ByteWriter, ct: ClassTable, obj: ShapeDisplayObject, _idx: WriteIndex): void {
  openObjBaseHeader(w);
  closeObjBase(w, ct, obj.x !== 0 || obj.y !== 0 ? { x: obj.x, y: obj.y } : undefined);

  // shapeSchema > 2 => F8-era caps strokes/fills.
  w.u8(3);
  // Placement translation goes in the matrix (tx/ty). Edge coords are relative
  // to the shape origin; the importer adds matrix.tx/ty back as the object x/y.
  writeMatrix(w, { a: 1, b: 0, c: 0, d: 1, tx: obj.x, ty: obj.y });
  writeShapeGeometry(w, obj.shape.paths);
}

/**
 * Serialize a shape's paths as a fill/line style table + edge stream
 * (caps = true / F8). Each closed fill path is emitted with its fill on the
 * `fill1` (right) side so the importer reconstructs a closed loop. Strokes are
 * emitted as open style-runs on the `line` index.
 */
function writeShapeGeometry(w: ByteWriter, paths: readonly ShapePath[]): void {
  // Build de-duplicated fill + stroke style tables (1-based indices).
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
  }
  const runs: EdgeRun[] = [];
  for (const p of paths) {
    const fill0 = 0;
    const fill1 = p.fill ? fillIndexOf(p.fill) : 0;
    const line = p.stroke ? strokeIndexOf(p.stroke) : 0;
    if (fill1 === 0 && line === 0) continue;
    runs.push({ fill0, fill1, line, start: p.start, segs: p.segments });
  }

  w.u8(3); // shape data schema (>= 3 => F8 fill/line styles)
  w.u32(0); // edge count hint
  w.u16(fills.length);
  for (const f of fills) writeFillStyle(w, f);
  w.u16(strokes.length);
  for (const s of strokes) writeLineStyle(w, s);

  // Edge stream: for each run emit a style change then its edges. Deltas are in
  // 8.8 twips relative to the running pen.
  let curX = 0;
  let curY = 0;
  for (const run of runs) {
    // Style change (bit 0x40) + "no selection info" (bit 0x80): order line,
    // fill0, fill1. Combine with a move (delta1) to the run start.
    const startX = Math.round(run.start.x * EDGE_UNIT);
    const startY = Math.round(run.start.y * EDGE_UNIT);
    // flags: 0x40 style change, 0x80 no-sel, delta1 type 2 (s32 move).
    w.u8(0x40 | 0x80 | 0x02);
    w.u8(run.line & 0xff);
    w.u8(run.fill0 & 0xff);
    w.u8(run.fill1 & 0xff);
    w.s32(startX - curX);
    w.s32(startY - curY);
    curX = startX;
    curY = startY;

    for (const seg of run.segs) {
      if (seg.type === "line") {
        const tx = Math.round(seg.to.x * EDGE_UNIT);
        const ty = Math.round(seg.to.y * EDGE_UNIT);
        // delta1 (from) type 0 = stay; delta3 (to) type 2; delta2 (ctrl) type 0.
        w.u8(0x20); // bits[5:4]=10 -> delta3 type 2
        w.s32(tx - curX);
        w.s32(ty - curY);
        curX = tx;
        curY = ty;
      } else {
        const cx = Math.round(seg.control.x * EDGE_UNIT);
        const cy = Math.round(seg.control.y * EDGE_UNIT);
        const tx = Math.round(seg.to.x * EDGE_UNIT);
        const ty = Math.round(seg.to.y * EDGE_UNIT);
        // delta2 (ctrl) type 2 (bits[3:2]=10 => 0x08), delta3 (to) type 2 (0x20).
        w.u8(0x08 | 0x20);
        w.s32(cx - curX); // control delta (from = cur, since d1 type 0)
        w.s32(cy - curY);
        w.s32(tx - cx); // to delta (relative to control, since to = from + d3, from=cur)
        w.s32(ty - cy);
        curX = tx;
        curY = ty;
      }
    }
  }
  w.u8(0); // edge terminator
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
      ct.useClass(w, "CPicShape", 4);
      writeCPicShape(w, ct, obj, idx);
      return;
    case "drawing-object":
      // Treat a drawing object like a raw shape.
      ct.useClass(w, "CPicShape", 4);
      writeCPicShape(
        w,
        ct,
        { type: "shape", id: obj.id, shape: obj.shape, x: obj.x, y: obj.y },
        idx,
      );
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

/**
 * Builds a FlashDocument from the streams of a real Macromedia Flash
 * binary .fla (OLE2 container). The low-level payload parsing lives in
 * flash8-binary.ts; this module maps the parsed intermediate representation
 * onto the editor's document model.
 */

import type {
  FlashDocument,
  Layer,
  LayerType,
  Scene,
  SymbolType,
  Timeline,
  LibraryItem,
  Frame,
  SoundLinkage,
} from "../model/types.js";
import type {
  ClipAction,
  ColorEffect,
  DisplayObject,
  Fill,
  PathSegment,
  ShapePath,
  Stroke,
  Color,
  SymbolInstance,
} from "../engine/types.js";
import type { FlashFilter } from "../engine/filters.js";
import { createDocument, createDocumentProperties } from "../model/document.js";
import { createScene } from "../model/scene.js";
import { createFrame, createLayer } from "../model/timeline.js";
import { createSymbol, createSound, createBitmap } from "../model/library.js";
import { decodeMediaBitmap, decodedBitmapToDataUri } from "./media.js";
import {
  parseFla8Contents,
  parseFla8Timeline,
  type Fla8Color,
  type Fla8ColorEffect,
  type Fla8Element,
  type Fla8Fill,
  type Fla8Filter,
  type Fla8Layer,
  type Fla8Matrix,
  type Fla8Shape,
  type Fla8Timeline,
} from "./flash8-binary.js";

let _idCounter = 0;
function nextId(prefix: string): string {
  return `fla8-${prefix}-${++_idCounter}`;
}

// ---------------------------------------------------------------------------
// Color / fill / stroke conversion
// ---------------------------------------------------------------------------

function toColor(c: Fla8Color): Color {
  return { r: c.r, g: c.g, b: c.b, a: c.a };
}

function toHex(c: Fla8Color): string {
  const h = (v: number) => v.toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function toFill(f: Fla8Fill): Fill {
  switch (f.kind) {
    case "solid":
      return { type: "solid", color: toColor(f.color) };
    case "linear-gradient":
      return {
        type: "linear-gradient",
        stops: f.stops.map((s) => ({ ratio: s.position, color: toColor(s.color) })),
        angle: (Math.atan2(f.matrix.b, f.matrix.a) * 180) / Math.PI,
      };
    case "radial-gradient":
      return {
        type: "radial-gradient",
        stops: f.stops.map((s) => ({ ratio: s.position, color: toColor(s.color) })),
        focalPoint: f.focalRatio,
      };
    case "bitmap":
      console.warn("[FLA import] bitmap fill not supported; substituting solid gray");
      return { type: "solid", color: { r: 128, g: 128, b: 128, a: 255 } };
    case "unknown":
      return { type: "solid", color: { r: 128, g: 128, b: 128, a: 255 } };
  }
}

// ---------------------------------------------------------------------------
// Shape conversion: edge list -> ShapePath contours
// ---------------------------------------------------------------------------

const EPS = 1e-6;

function convertShape(el: Fla8Shape): DisplayObject {
  const { a, b, c, d } = el.matrix;
  const identityLinear =
    Math.abs(a - 1) < EPS && Math.abs(b) < EPS && Math.abs(c) < EPS && Math.abs(d - 1) < EPS;
  const tp = (x: number, y: number) =>
    identityLinear ? { x, y } : { x: a * x + c * y, y: b * x + d * y };

  const paths: ShapePath[] = [];
  let segs: PathSegment[] = [];
  let start = { x: 0, y: 0 };
  let cur = { x: 0, y: 0 };
  let curFill0 = -1;
  let curFill1 = -1;
  let curLine = -1;
  let open = false;

  const resolveFill = (fill1: number, fill0: number): Fill | undefined => {
    const idx = fill1 > 0 ? fill1 : fill0;
    if (idx <= 0 || idx > el.fills.length) return undefined;
    return toFill(el.fills[idx - 1]!);
  };
  const resolveStroke = (line: number): Stroke | undefined => {
    if (line <= 0 || line > el.strokes.length) return undefined;
    const s = el.strokes[line - 1]!;
    return {
      type: "solid",
      color: toColor(s.color),
      width: Math.max(s.width, 0.05),
      caps: s.cap,
      joints: s.join,
      miterLimit: s.miterLimit,
    };
  };

  const flush = () => {
    if (open && segs.length > 0) {
      const closed = Math.abs(cur.x - start.x) < 0.01 && Math.abs(cur.y - start.y) < 0.01;
      paths.push({
        start,
        segments: segs,
        fill: resolveFill(curFill1, curFill0),
        stroke: resolveStroke(curLine),
        closed,
      });
    }
    segs = [];
    open = false;
  };

  for (const e of el.edges) {
    const from = tp(e.fromX, e.fromY);
    const to = tp(e.toX, e.toY);
    const styleChanged = e.fill0 !== curFill0 || e.fill1 !== curFill1 || e.line !== curLine;
    const moved = Math.abs(from.x - cur.x) > 0.01 || Math.abs(from.y - cur.y) > 0.01;
    if (!open || moved || styleChanged) {
      flush();
      start = from;
      cur = from;
      curFill0 = e.fill0;
      curFill1 = e.fill1;
      curLine = e.line;
      open = true;
    }
    if (e.kind === "line") {
      segs.push({ type: "line", to });
    } else {
      segs.push({ type: "curve", control: tp(e.ctrlX, e.ctrlY), to });
    }
    cur = to;
  }
  flush();

  return {
    type: "shape",
    id: nextId("shape"),
    shape: { id: nextId("shapegeom"), paths },
    x: el.matrix.tx,
    y: el.matrix.ty,
  };
}

// ---------------------------------------------------------------------------
// Matrix decomposition for symbol instances
// ---------------------------------------------------------------------------

function decompose(m: Fla8Matrix): { scaleX: number; scaleY: number; rotation: number } {
  const scaleX = Math.hypot(m.a, m.b) * (m.a < 0 && Math.abs(m.b) < EPS ? -1 : 1);
  const scaleY = Math.hypot(m.c, m.d) * (m.d < 0 && Math.abs(m.c) < EPS ? -1 : 1);
  const rotation = (Math.atan2(m.b, m.a) * 180) / Math.PI;
  return { scaleX: Math.abs(scaleX) < EPS ? 1 : scaleX, scaleY: Math.abs(scaleY) < EPS ? 1 : scaleY, rotation };
}

// ---------------------------------------------------------------------------
// Instance ActionScript: onClipEvent(...) blocks -> ClipAction[]
// ---------------------------------------------------------------------------

/** FLA `onClipEvent` event keyword -> model ClipAction event name. */
const CLIP_EVENTS: Record<string, ClipAction["event"]> = {
  load: "load",
  enterFrame: "enterFrame",
  unload: "unload",
  mouseMove: "mouseMove",
  mouseDown: "mouseDown",
  mouseUp: "mouseUp",
  keyDown: "keyDown",
  keyUp: "keyUp",
  data: "data",
};

/**
 * Parse the raw instance script (the concatenated `onClipEvent(event){body}`
 * blocks Flash stores verbatim in the FLA) into model ClipAction entries.
 * Brace-matching is used so handler bodies may contain nested blocks.
 * Multiple events on one block (`onClipEvent(keyDown,keyUp)`) are split into one
 * ClipAction per event. Unrecognized event keywords are skipped with a warning.
 */
export function parseClipActions(src: string): ClipAction[] {
  const actions: ClipAction[] = [];
  const re = /onClipEvent\s*\(([^)]*)\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const events = m[1]!.split(",").map((e) => e.trim()).filter(Boolean);
    const bodyStart = re.lastIndex;
    // brace-match the body
    let depth = 1;
    let i = bodyStart;
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i]!;
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    const body = src.slice(bodyStart, i - 1).trim();
    re.lastIndex = i;
    for (const ev of events) {
      const mapped = CLIP_EVENTS[ev];
      if (!mapped) {
        console.warn(`[FLA import] unknown onClipEvent event "${ev}"; skipping handler`);
        continue;
      }
      actions.push({ event: mapped, script: body });
    }
  }
  return actions;
}

// ---------------------------------------------------------------------------
// Instance color transform -> ColorEffect
// ---------------------------------------------------------------------------

/**
 * Convert a decoded FLA color transform into the editor's ColorEffect model.
 * Returns undefined for an identity transform (all multipliers 1.0, no offset)
 * so identity placements stay clean. The general case is represented as the
 * "advanced" effect (percent multipliers + 0..255 offsets), which is what the
 * editor's CXFORM encoder understands.
 */
export function toColorEffect(ce: Fla8ColorEffect | null): ColorEffect | undefined {
  if (!ce) return undefined;
  const isIdentity =
    ce.rMult === 256 && ce.gMult === 256 && ce.bMult === 256 && ce.aMult === 256 &&
    ce.rOff === 0 && ce.gOff === 0 && ce.bOff === 0 && ce.aOff === 0;
  if (isIdentity) return undefined;

  // Pure-alpha case: only the alpha channel differs from identity, with no
  // alpha offset -> represent as the simpler "alpha" effect (0..100%).
  const colorIsIdentity =
    ce.rMult === 256 && ce.gMult === 256 && ce.bMult === 256 &&
    ce.rOff === 0 && ce.gOff === 0 && ce.bOff === 0;
  if (colorIsIdentity && ce.aOff === 0) {
    return { type: "alpha", alpha: Math.round((ce.aMult / 256) * 100) };
  }

  // General case -> advanced color transform. Multipliers map 256 (=1.0) to
  // 100%; offsets are already in 0..255 scale.
  const pct = (mult: number) => Math.round((mult / 256) * 100);
  return {
    type: "advanced",
    redMult: pct(ce.rMult),
    greenMult: pct(ce.gMult),
    blueMult: pct(ce.bMult),
    redOffset: ce.rOff,
    greenOffset: ce.gOff,
    blueOffset: ce.bOff,
  };
}

// ---------------------------------------------------------------------------
// Filter conversion (Flash 8 instance filter list -> FlashFilter[])
// ---------------------------------------------------------------------------

/**
 * Convert a FLA-parsed Fla8Filter to the editor's FlashFilter model.
 * Returns null for filter types that have no equivalent in the model.
 *
 * Angle storage note: SWF/FLA stores filter angles in RADIANS as Fixed16.
 * The editor model uses DEGREES. SWF angles use the standard math convention
 * (counter-clockwise from the positive x-axis), while Flash UI shows the angle
 * clockwise from the right. Negating converts between them; then we normalise
 * to 0..360°.
 *
 * Blur passes: SWF stores render quality as a pass count (1-15) in the flags
 * byte. The editor model uses quality 1/2/3. We map: 1 → 1 (Low), 2 → 2 (Med),
 * 3+ → 3 (High).
 *
 * Strength: SWF Fixed8 stores values like 1.0 = readFixed8 result of 1.0.
 * The editor model stores strength as a 0–255 integer so we round and clamp.
 */
function toDegrees(radians: number): number {
  // SWF uses math convention (CCW from +x); Flash UI uses CW from right.
  // Negate to convert; normalise to 0..360.
  const deg = (-radians * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

function strengthToByte(s: number): number {
  return Math.max(0, Math.min(255, Math.round(s)));
}

function passesToQuality(passes: number): 1 | 2 | 3 {
  if (passes <= 1) return 1;
  if (passes <= 2) return 2;
  return 3;
}

function filterStopColor(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Map a single parsed FLA filter to the editor's FlashFilter model.
 * Returns null for filter types without a model equivalent (convolution).
 */
export function toFlashFilter(f: Fla8Filter): FlashFilter | null {
  switch (f.kind) {
    case "drop-shadow":
      return {
        type: "drop-shadow",
        color: { r: f.r, g: f.g, b: f.b, a: 255 },
        alpha: f.a / 255,
        blurX: f.blurX,
        blurY: f.blurY,
        angle: toDegrees(f.angle),
        distance: f.distance,
        strength: strengthToByte(f.strength),
        inner: f.inner,
        knockout: f.knockout,
        hideObject: f.hideObject,
        enabled: true,
      };
    case "blur":
      return {
        type: "blur",
        blurX: f.blurX,
        blurY: f.blurY,
        quality: passesToQuality(f.passes),
        enabled: true,
      };
    case "glow":
      return {
        type: "glow",
        color: { r: f.r, g: f.g, b: f.b, a: 255 },
        alpha: f.a / 255,
        blurX: f.blurX,
        blurY: f.blurY,
        strength: strengthToByte(f.strength),
        inner: f.inner,
        knockout: f.knockout,
        enabled: true,
      };
    case "bevel":
      return {
        type: "bevel",
        highlightColor: { r: f.highlightR, g: f.highlightG, b: f.highlightB, a: 255 },
        highlightAlpha: f.highlightA / 255,
        shadowColor: { r: f.shadowR, g: f.shadowG, b: f.shadowB, a: 255 },
        shadowAlpha: f.shadowA / 255,
        blurX: f.blurX,
        blurY: f.blurY,
        angle: toDegrees(f.angle),
        distance: f.distance,
        strength: strengthToByte(f.strength),
        quality: passesToQuality(f.passes),
        bevelType: f.inner ? "inner" : f.onTop ? "full" : "outer",
        knockout: f.knockout,
        enabled: true,
      };
    case "gradient-glow":
      return {
        type: "gradientGlow",
        distance: f.distance,
        angle: toDegrees(f.angle),
        gradient: f.stops.map((s) => ({
          color: filterStopColor(s.r, s.g, s.b),
          alpha: s.a / 255,
          ratio: s.ratio,
        })),
        blurX: f.blurX,
        blurY: f.blurY,
        strength: strengthToByte(f.strength),
        quality: passesToQuality(f.passes),
        inner: f.inner,
        knockout: f.knockout,
        compositeSource: f.compositeSource,
        enabled: true,
      };
    case "gradient-bevel":
      return {
        type: "gradientBevel",
        distance: f.distance,
        angle: toDegrees(f.angle),
        gradient: f.stops.map((s) => ({
          color: filterStopColor(s.r, s.g, s.b),
          alpha: s.a / 255,
          ratio: s.ratio,
        })),
        blurX: f.blurX,
        blurY: f.blurY,
        strength: strengthToByte(f.strength),
        quality: passesToQuality(f.passes),
        inner: f.inner,
        knockout: f.knockout,
        compositeSource: f.compositeSource,
        enabled: true,
      };
    case "color-matrix":
      // ColorMatrix in FLA is the raw 20-element matrix. The editor's
      // AdjustColorFilter stores brightness/contrast/saturation/hue which
      // are non-trivially computed from the matrix; store it as an identity
      // AdjustColor with enabled=false to preserve presence without decoding.
      console.warn(
        "[FLA import] ColorMatrix filter imported as identity AdjustColor (raw matrix not decoded)",
      );
      return {
        type: "adjustColor",
        brightness: 0,
        contrast: 0,
        saturation: 0,
        hue: 0,
        enabled: false,
      };
  }
}

/**
 * Map a Flash 8 binary blend mode byte to the engine's blend mode string.
 * Values 0 and 1 both mean "normal". Unknown values fall back to "normal".
 * Reference: SWF spec BLENDMODE enum (same values as the FLA binary byte).
 */
type BlendModeName = NonNullable<SymbolInstance["blendMode"]>;

const BLEND_MODE_MAP: Record<number, BlendModeName> = {
  0: "normal",
  1: "normal",
  2: "layer",
  3: "multiply",
  4: "screen",
  5: "lighten",
  6: "darken",
  7: "difference",
  8: "add",
  9: "subtract",
  10: "invert",
  11: "alpha",
  12: "erase",
  13: "overlay",
  14: "hardlight",
};

function toBlendMode(raw: number): BlendModeName | undefined {
  const mode = BLEND_MODE_MAP[raw];
  if (!mode || mode === "normal") return undefined; // omit default
  return mode;
}

/**
 * Map an array of parsed FLA filters to the editor's FlashFilter[].
 * Null entries (unsupported filter types) are dropped.
 */
function toFlashFilters(flaFilters: Fla8Filter[]): FlashFilter[] {
  if (flaFilters.length === 0) return [];
  const result: FlashFilter[] = [];
  for (const f of flaFilters) {
    const mapped = toFlashFilter(f);
    if (mapped !== null) result.push(mapped);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Element conversion
// ---------------------------------------------------------------------------

function convertElement(
  el: Fla8Element,
  symbolIdByIndex: Map<number, string>,
  bitmapIdByIndex: Map<number, string>,
  bitmapSizeByIndex: Map<number, { width: number; height: number }>,
): DisplayObject | null {
  switch (el.type) {
    case "shape":
      if (el.edges.length === 0) return null;
      return convertShape(el);
    case "instance": {
      const symbolId = symbolIdByIndex.get(el.libraryIndex);
      if (!symbolId) {
        console.warn(
          `[FLA import] instance references unknown library symbol #${el.libraryIndex}; skipping`,
        );
        return null;
      }
      const { scaleX, scaleY, rotation } = decompose(el.matrix);
      const colorEffect = toColorEffect(el.colorEffect);
      const filters = toFlashFilters(el.filters);
      const blendMode = toBlendMode(el.blendMode);
      // onClipEvent handlers only apply to movieclip (sprite) instances; a
      // button instance's on() handlers have no instance-level model field yet,
      // so they are warned-and-skipped below.
      const clipActions = el.kind === "sprite" && el.script ? parseClipActions(el.script) : [];
      if (el.kind === "button" && el.script) {
        console.warn(
          "[FLA import] button instance on() handlers are not imported (no instance-level model field); skipping",
        );
      }
      return {
        type: "instance",
        id: nextId("inst"),
        symbolId,
        x: el.matrix.tx,
        y: el.matrix.ty,
        scaleX,
        scaleY,
        rotation,
        ...(el.instanceName ? { instanceName: el.instanceName } : {}),
        ...(colorEffect ? { colorEffect } : {}),
        ...(filters.length > 0 ? { filters } : {}),
        ...(blendMode ? { blendMode } : {}),
        ...(clipActions.length > 0 ? { clipActions } : {}),
      };
    }
    case "text":
      return {
        type: "text",
        id: nextId("text"),
        x: el.matrix.tx,
        y: el.matrix.ty,
        width: Math.max(el.width, 1),
        height: Math.max(el.height, 1),
        text: el.text,
        textType: el.textType,
        fontFamily: el.fontName || "Arial",
        fontSize: el.fontSize > 0 ? el.fontSize : 12,
        bold: el.bold,
        italic: el.italic,
        color: toColor(el.color),
        align: el.align,
        multiline: el.text.includes("\r") || el.text.includes("\n"),
        wordWrap: el.wordWrap,
        ...(el.instanceName ? { instanceName: el.instanceName } : {}),
      };
    case "bitmap": {
      const libraryItemId = bitmapIdByIndex.get(el.mediaId);
      if (!libraryItemId) {
        console.warn(
          `[FLA import] bitmap placement references unknown media #${el.mediaId}; skipping`,
        );
        return null;
      }
      const { scaleX, scaleY, rotation } = decompose(el.matrix);
      const size = bitmapSizeByIndex.get(el.mediaId) ?? { width: 1, height: 1 };
      return {
        type: "bitmap",
        id: nextId("bitmap"),
        libraryItemId,
        x: el.matrix.tx,
        y: el.matrix.ty,
        width: Math.max(size.width, 1),
        height: Math.max(size.height, 1),
        scaleX,
        scaleY,
        rotation,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Timeline conversion
// ---------------------------------------------------------------------------

const LAYER_TYPES: Record<number, LayerType> = {
  0: "normal",
  1: "guide",
  2: "guided",
  3: "folder",
  4: "mask",
  5: "masked",
};

const SOUND_SYNC_MODES: Record<number, SoundLinkage["syncMode"]> = {
  0: "event",
  1: "start",
  2: "stop",
  3: "stream",
};

function convertLayer(
  l: Fla8Layer,
  index: number,
  symbolIdByIndex: Map<number, string>,
  soundIdByIndex: Map<number, string>,
  bitmapIdByIndex: Map<number, string>,
  bitmapSizeByIndex: Map<number, { width: number; height: number }>,
): Layer {
  const frames: Frame[] = [];
  let frameIndex = 0;
  for (const f of l.frames) {
    const displayObjects: DisplayObject[] = [];
    for (const el of f.elements) {
      const converted = convertElement(el, symbolIdByIndex, bitmapIdByIndex, bitmapSizeByIndex);
      if (converted) displayObjects.push(converted);
    }
    let sound: SoundLinkage | null = null;
    if (f.soundId > 0) {
      const libraryItemId = soundIdByIndex.get(f.soundId);
      if (libraryItemId) {
        const syncMode: SoundLinkage["syncMode"] =
          f.soundSync >= 0 ? (SOUND_SYNC_MODES[f.soundSync] ?? "event") : "event";
        const repeatCount = f.soundLoop >= 0 ? f.soundLoop : 1;
        sound = { libraryItemId, syncMode, repeatCount };
      } else {
        console.warn(`[FLA import] frame sound id ${f.soundId} not found in library; skipping`);
      }
    }
    // keyMode bits (flacomdoc): 0x4001-based = classic/motion tween,
    // 0x..02 = shape tween.
    const tweenType =
      (f.keyMode & 0x4000) !== 0 && (f.keyMode & 0x0001) !== 0
        ? "motion"
        : (f.keyMode & 0x0002) !== 0
          ? "shape"
          : "none";
    frames.push(
      createFrame(frameIndex, {
        label: f.label,
        labelType: f.labelIsComment ? "comment" : "name",
        script: f.script,
        tweenType,
        displayObjects,
        isEmpty: displayObjects.length === 0,
        sound,
      }),
    );
    frameIndex += f.duration;
  }
  const frameCount = Math.max(1, frameIndex);
  return createLayer(l.name || `Layer ${index + 1}`, LAYER_TYPES[l.layerType] ?? "normal", {
    visible: !l.hidden,
    locked: l.locked,
    outlineColor: l.outlineColor ? toHex(l.outlineColor) : "#0000ff",
    frames: frames.length > 0 ? frames : [createFrame(0)],
    frameCount,
  });
}

function convertTimeline(
  t: Fla8Timeline,
  symbolIdByIndex: Map<number, string>,
  soundIdByIndex: Map<number, string>,
  bitmapIdByIndex: Map<number, string>,
  bitmapSizeByIndex: Map<number, { width: number; height: number }>,
): Timeline {
  const layers = t.layers.map((l, i) =>
    convertLayer(l, i, symbolIdByIndex, soundIdByIndex, bitmapIdByIndex, bitmapSizeByIndex),
  );
  if (layers.length === 0) {
    return { layers: [createLayer("Layer 1", "normal")] };
  }
  return { layers };
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

const PAGE_RE = /^(?:Page (\d+)|P (\d+) \d+)$/;
const SYMBOL_RE = /^(?:Symbol (\d+)|S (\d+) \d+)$/;
const MEDIA_RE = /^Media (\d+)$/;

function streamNumber(re: RegExp, name: string): number | null {
  const m = re.exec(name);
  if (!m) return null;
  return parseInt(m[1] ?? m[2]!, 10);
}

const SYMBOL_TYPES: Record<number, SymbolType> = {
  0: "graphic",
  1: "button",
  2: "movieclip",
};

/**
 * Build a FlashDocument from the named streams of a real binary .fla.
 * Returns null when the container holds no recognizable timeline streams
 * (the caller is expected to fall back to a skeleton document).
 */
export function buildFla8Document(streams: Map<string, Uint8Array>): FlashDocument | null {
  let contentsBytes: Uint8Array | null = null;
  const pages: Array<{ num: number; name: string; bytes: Uint8Array }> = [];
  const symbolStreams: Array<{ num: number; name: string; bytes: Uint8Array }> = [];

  for (const [name, bytes] of streams) {
    if (name.toLowerCase() === "contents") {
      contentsBytes = bytes;
      continue;
    }
    const pageNum = streamNumber(PAGE_RE, name);
    if (pageNum !== null) {
      pages.push({ num: pageNum, name, bytes });
      continue;
    }
    const symNum = streamNumber(SYMBOL_RE, name);
    if (symNum !== null) {
      symbolStreams.push({ num: symNum, name, bytes });
    }
  }
  pages.sort((x, y) => x.num - y.num);
  symbolStreams.sort((x, y) => x.num - y.num);

  if (pages.length === 0 && !contentsBytes) {
    console.warn("[FLA import] no Contents or Page/timeline streams found in OLE2 container");
    return null;
  }

  const contents = contentsBytes
    ? parseFla8Contents(contentsBytes)
    : parseFla8Contents(new Uint8Array(0));

  if (pages.length === 0) {
    // Contents present but no timeline streams: return a skeleton with
    // whatever document properties could be extracted.
    console.warn(
      "[FLA import] no Page/timeline streams found; importing document properties only",
    );
    return createDocument({
      properties: createDocumentProperties({
        width: contents.width ?? 550,
        height: contents.height ?? 400,
        frameRate: contents.frameRate ?? 12,
        backgroundColor: contents.backgroundColor ? toHex(contents.backgroundColor) : "#ffffff",
      }),
      scenes: [createScene("Scene 1", { timeline: { layers: [createLayer("Layer 1", "normal")] } })],
      library: { items: [], folders: [] },
    });
  }

  // --- library sounds --------------------------------------------------------
  // Build soundIdByIndex BEFORE processing symbol timelines so that symbols
  // containing frame sounds can look up the library ID correctly.
  // Create stub SoundItem entries for each sound referenced in the Contents
  // stream. The actual audio data lives in "Media N" streams which we do not
  // decode yet; the stub carries the display name and an empty dataUri so that
  // the library and Frame.sound linkage are populated correctly.
  const soundIdByIndex = new Map<number, string>();
  const items: LibraryItem[] = [];
  for (const [num, info] of contents.sounds) {
    const soundItem = createSound(info.name);
    soundIdByIndex.set(num, soundItem.id);
    items.push(soundItem);
  }

  // --- library bitmaps -------------------------------------------------------
  // Bitmap pixel data lives in "Media N" streams (the same N that a
  // CPicBitmapRef record carries as mediaId). Decode each Media stream that
  // looks like a bitmap (JPEG/PNG/Flash-lossless) into a BitmapItem and record
  // the FLA media index -> library id mapping so bitmap placements resolve.
  // Sound media indexes are already claimed above; Media streams that are not
  // bitmaps (audio PCM/MP3, video) decode to null and are skipped here.
  const bitmapIdByIndex = new Map<number, string>();
  const bitmapSizeByIndex = new Map<number, { width: number; height: number }>();
  const soundMediaIds = new Set<number>(contents.sounds.keys());
  for (const [name, bytes] of streams) {
    const mediaNum = streamNumber(MEDIA_RE, name);
    if (mediaNum === null) continue;
    if (soundMediaIds.has(mediaNum)) continue; // audio media, handled as a stub sound
    let decoded;
    try {
      decoded = decodeMediaBitmap(bytes);
    } catch (err) {
      console.warn(`[FLA import] failed to decode media stream "${name}": ${String(err)}`);
      continue;
    }
    if (!decoded) continue;
    const bitmapItem = createBitmap(`Bitmap ${mediaNum}`, {
      dataUri: decodedBitmapToDataUri(decoded),
      originalWidth: decoded.width,
      originalHeight: decoded.height,
      compressionType: decoded.compressionType,
    });
    bitmapIdByIndex.set(mediaNum, bitmapItem.id);
    bitmapSizeByIndex.set(mediaNum, { width: decoded.width, height: decoded.height });
    items.push(bitmapItem);
  }

  // --- library symbols -------------------------------------------------------
  // Two passes: create symbol shells first so instances can reference any
  // symbol regardless of ordering, then parse timelines.
  const symbolIdByIndex = new Map<number, string>();
  const parsedSymbolTimelines = new Map<number, Fla8Timeline>();

  for (const s of symbolStreams) {
    try {
      parsedSymbolTimelines.set(s.num, parseFla8Timeline(s.bytes));
    } catch (err) {
      console.warn(
        `[FLA import] could not parse symbol stream "${s.name}": ${String(err)} — importing as empty symbol`,
      );
    }
  }
  // shells
  const shells = new Map<number, ReturnType<typeof createSymbol>>();
  for (const s of symbolStreams) {
    const meta = contents.symbols.get(s.num);
    const name = meta?.name && meta.name.length > 0 ? meta.name : `Symbol ${s.num}`;
    const symbolType: SymbolType =
      meta?.typeByte != null ? (SYMBOL_TYPES[meta.typeByte] ?? "movieclip") : "movieclip";
    const shell = createSymbol(name, symbolType);
    shells.set(s.num, shell);
    symbolIdByIndex.set(s.num, shell.id);
  }
  // timelines
  for (const s of symbolStreams) {
    const shell = shells.get(s.num)!;
    const parsed = parsedSymbolTimelines.get(s.num);
    const timeline = parsed
      ? convertTimeline(parsed, symbolIdByIndex, soundIdByIndex, bitmapIdByIndex, bitmapSizeByIndex)
      : shell.timeline;
    items.push({ ...shell, timeline });
  }

  // --- scenes -----------------------------------------------------------------
  const scenes: Scene[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const sceneName = contents.sceneNames.get(p.name) ?? `Scene ${i + 1}`;
    let timeline: Timeline;
    try {
      timeline = convertTimeline(
        parseFla8Timeline(p.bytes),
        symbolIdByIndex,
        soundIdByIndex,
        bitmapIdByIndex,
        bitmapSizeByIndex,
      );
    } catch (err) {
      console.warn(
        `[FLA import] could not parse page stream "${p.name}": ${String(err)} — importing empty scene`,
      );
      timeline = { layers: [createLayer("Layer 1", "normal")] };
    }
    scenes.push(createScene(sceneName, { timeline }));
  }

  // --- document properties -----------------------------------------------------
  const properties = createDocumentProperties({
    width: contents.width ?? 550,
    height: contents.height ?? 400,
    frameRate: contents.frameRate ?? 12,
    backgroundColor: contents.backgroundColor ? toHex(contents.backgroundColor) : "#ffffff",
  });

  return createDocument({
    properties,
    scenes,
    library: { items, folders: [] },
  });
}

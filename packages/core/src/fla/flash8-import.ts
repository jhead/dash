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
  Scale9Grid,
  Scene,
  SymbolType,
  Timeline,
  LibraryItem,
  Frame,
  SoundLinkage,
  FlaSwfBlob,
  Guide,
  GridSettings,
  RulerUnits,
} from "../model/types.js";
import type {
  ButtonHandler,
  ClipAction,
  ColorEffect,
  DisplayObject,
  Fill,
  PathSegment,
  ShapePath,
  Stroke,
  Color,
  ObjectAccessibility,
  SymbolInstance,
  TextDisplayObject,
} from "../engine/types.js";
import type { AdjustColorFilter, ConvolutionFilter, FlashFilter } from "../engine/filters.js";
import { createDocument, createDocumentProperties, createGridSettings } from "../model/document.js";
import { createScene } from "../model/scene.js";
import { createFrame, createLayer } from "../model/timeline.js";
import { createSymbol, createSound, createBitmap, createVideo, createFont, createSymbolLinkage, createLibraryFolder } from "../model/library.js";
import type { LibraryFolder } from "../model/types.js";
import { decodeMediaAudio, decodeMediaBitmap, decodedBitmapToDataUri, bytesToBase64 } from "./media.js";
import {
  parseFla8Contents,
  parseFla8Timeline,
  type Fla8Accessibility,
  type Fla8Color,
  type Fla8ColorEffect,
  type Fla8Element,
  type Fla8Fill,
  type Fla8Filter,
  type Fla8Layer,
  type Fla8Matrix,
  type Fla8Shape,
  type Fla8Stroke,
  type Fla8Text,
  type Fla8TextRun,
  type Fla8Timeline,
} from "./flash8-binary.js";

let _idCounter = 0;
function nextId(prefix: string): string {
  return `fla8-${prefix}-${++_idCounter}`;
}

// ---------------------------------------------------------------------------
// HTML rich-text builder
// ---------------------------------------------------------------------------

/**
 * Escape text for Flash HTML content (avoid breaking markup tags).
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Build a Flash HTML string from multiple formatting runs.
 * Uses `<font>`, `<b>`, `<i>` tags supported by Flash's HTML text renderer.
 * Each run gets a `<font face="..." size="N" color="#rrggbb">` wrapper;
 * bold/italic are applied via inner `<b>`/`<i>` tags.
 */
export function buildHtmlText(runs: readonly Fla8TextRun[]): string {
  return runs
    .map((r) => {
      const face = r.fontName || "Arial";
      const size = Math.round(r.fontSize > 0 ? r.fontSize : 12);
      const h = (v: number) => v.toString(16).padStart(2, "0");
      const color = `#${h(r.color.r)}${h(r.color.g)}${h(r.color.b)}`;
      let inner = escapeHtml(r.text);
      if (r.italic) inner = `<i>${inner}</i>`;
      if (r.bold) inner = `<b>${inner}</b>`;
      if (r.characterPosition === 1) inner = `<sup>${inner}</sup>`;
      else if (r.characterPosition === 2) inner = `<sub>${inner}</sub>`;
      return `<font face="${face}" size="${size}" color="${color}">${inner}</font>`;
    })
    .join("");
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

/** Map FLA binary spreadMode integer (bits[7:6]) to the model string union. */
function toSpreadMode(n: number | undefined): "extend" | "reflect" | "repeat" | undefined {
  if (n === undefined) return undefined;
  if (n === 1) return "reflect";
  if (n === 2) return "repeat";
  return undefined; // 0 = pad/extend (model default — omit field)
}

function toFill(f: Fla8Fill, bitmapIdByIndex: Map<number, string>): Fill {
  switch (f.kind) {
    case "solid":
      return { type: "solid", color: toColor(f.color) };
    case "linear-gradient": {
      const spreadMode = toSpreadMode(f.spreadMode);
      const interpolation = f.linearRGB ? "linearRGB" : undefined;
      return {
        type: "linear-gradient",
        stops: f.stops.map((s) => ({ ratio: s.position, color: toColor(s.color) })),
        angle: (Math.atan2(f.matrix.b, f.matrix.a) * 180) / Math.PI,
        matrix: { a: f.matrix.a, b: f.matrix.b, c: f.matrix.c, d: f.matrix.d, tx: f.matrix.tx, ty: f.matrix.ty },
        ...(spreadMode ? { spreadMode } : {}),
        ...(interpolation ? { interpolation } : {}),
      };
    }
    case "radial-gradient": {
      const spreadMode = toSpreadMode(f.spreadMode);
      const interpolation = f.linearRGB ? "linearRGB" : undefined;
      return {
        type: "radial-gradient",
        stops: f.stops.map((s) => ({ ratio: s.position, color: toColor(s.color) })),
        focalPoint: f.focalRatio,
        matrix: { a: f.matrix.a, b: f.matrix.b, c: f.matrix.c, d: f.matrix.d, tx: f.matrix.tx, ty: f.matrix.ty },
        ...(spreadMode ? { spreadMode } : {}),
        ...(interpolation ? { interpolation } : {}),
      };
    }
    case "bitmap": {
      const bitmapId = bitmapIdByIndex.get(f.bitmapId);
      if (!bitmapId) {
        console.warn(
          `[FLA import] bitmap fill references unknown media #${f.bitmapId}; substituting solid gray`,
        );
        return { type: "solid", color: { r: 128, g: 128, b: 128, a: 255 } };
      }
      return { type: "bitmap", bitmapId, repeat: f.repeat, smooth: f.smooth, matrix: f.matrix };
    }
    case "unknown":
      return { type: "solid", color: { r: 128, g: 128, b: 128, a: 255 } };
  }
}

/** Map a parsed FLA stroke onto the editor model stroke type. */
export function strokeFromFla8(s: Fla8Stroke): Stroke {
  if (s.width === 0) {
    return {
      type: "solid",
      strokeType: "hairline",
      color: toColor(s.color),
      width: 0,
      caps: s.cap,
      joints: s.join,
      miterLimit: s.miterLimit,
      ...(s.pixelHinting ? { pixelHinting: true } : {}),
      ...(s.scaleMode && s.scaleMode !== "normal" ? { strokeScaleMode: s.scaleMode } : {}),
      ...(s.style ? { style: s.style } : {}),
    };
  }
  return {
    type: "solid",
    strokeType: "solid",
    color: toColor(s.color),
    width: Math.max(s.width, 0.05),
    caps: s.cap,
    joints: s.join,
    miterLimit: s.miterLimit,
    ...(s.pixelHinting ? { pixelHinting: true } : {}),
    ...(s.scaleMode && s.scaleMode !== "normal" ? { strokeScaleMode: s.scaleMode } : {}),
    ...(s.style ? { style: s.style } : {}),
  };
}

// ---------------------------------------------------------------------------
// Shape conversion: edge list -> ShapePath contours
// ---------------------------------------------------------------------------

const EPS = 1e-6;

// ---------------------------------------------------------------------------
// SWF/FLA fill0/fill1 edge model -> closed ShapePath contours.
//
// In the Flash shape format every edge records the fill style on its LEFT
// (fill0) and RIGHT (fill1) side, plus an optional stroke (line). A single
// filled region is bounded by edges scattered throughout the stream, and an
// edge that borders region R on its fill0 side runs in the OPPOSITE direction
// to the region's outline. To reconstruct a region we therefore: accumulate a
// per-style pending path, add fill1 runs forward and fill0 runs REVERSED, then
// link the runs end-to-start into closed loops. This mirrors Ruffle's
// `ShapeConverter` (render/src/shape_utils.rs). The old converter emitted one
// open ribbon per style-run, which left traced-bitmap shapes (hundreds/thousands
// of fills) as thousands of un-closed slivers — mangled on stage, dropped in SWF.
// ---------------------------------------------------------------------------

interface FillPt {
  readonly x: number;
  readonly y: number;
  /** true when this point is a quadratic-Bézier control point. */
  readonly ctrl: boolean;
}

/** A polyline run of points (some flagged as Bézier controls). */
class RunSeg {
  points: FillPt[];
  constructor(start: FillPt) {
    this.points = [start];
  }
  add(p: FillPt): void {
    this.points.push(p);
  }
  startPt(): FillPt {
    return this.points[0]!;
  }
  endPt(): FillPt {
    return this.points[this.points.length - 1]!;
  }
  isEmpty(): boolean {
    return this.points.length <= 1;
  }
  flip(): void {
    this.points.reverse();
  }
}

/** Quantise a coordinate to the source twip grid for exact endpoint matching. */
function ptKey(p: FillPt): number {
  // 5120 units/px is the FLA edge resolution (8.8 fixed-point twips).
  return Math.round(p.x * 5120) * 100000 + Math.round(p.y * 5120);
}

function swapRemove<T>(arr: T[], i: number): T {
  const v = arr[i]!;
  const last = arr.pop()!;
  if (i < arr.length) arr[i] = last;
  return v;
}

/**
 * Link `seg` into `list`, merging with any existing run whose endpoint matches
 * the new run's start or end (faithful port of Ruffle PendingPath::add_segment).
 */
function linkSegment(list: RunSeg[], seg: RunSeg): void {
  if (seg.isEmpty()) return;
  let startOpen = true;
  let endOpen = true;
  let i = 0;
  while ((startOpen || endOpen) && i < list.length) {
    const other = list[i]!;
    if (startOpen && ptKey(other.endPt()) === ptKey(seg.startPt())) {
      for (let k = 1; k < seg.points.length; k++) other.points.push(seg.points[k]!);
      seg = swapRemove(list, i);
      startOpen = false;
    } else if (endOpen && ptKey(seg.endPt()) === ptKey(other.startPt())) {
      const merged = seg.points;
      for (let k = 1; k < other.points.length; k++) merged.push(other.points[k]!);
      other.points = merged;
      seg = swapRemove(list, i);
      endOpen = false;
    } else {
      i++;
    }
  }
  list.push(seg);
}

/** Convert a linked run of points into model PathSegments + closed flag. */
function runToPath(
  run: RunSeg,
  fill: Fill | undefined,
  stroke: Stroke | undefined,
): ShapePath {
  const pts = run.points;
  const start = { x: pts[0]!.x, y: pts[0]!.y };
  const segments: PathSegment[] = [];
  let i = 1;
  while (i < pts.length) {
    const p = pts[i]!;
    if (p.ctrl && i + 1 < pts.length) {
      const anchor = pts[i + 1]!;
      segments.push({ type: "curve", control: { x: p.x, y: p.y }, to: { x: anchor.x, y: anchor.y } });
      i += 2;
    } else {
      segments.push({ type: "line", to: { x: p.x, y: p.y } });
      i += 1;
    }
  }
  const end = run.endPt();
  const closed = ptKey(run.startPt()) === ptKey(end);
  return { start, segments, fill, stroke, closed };
}

function convertShape(el: Fla8Shape, bitmapIdByIndex: Map<number, string>): DisplayObject {
  const { a, b, c, d } = el.matrix;
  const identityLinear =
    Math.abs(a - 1) < EPS && Math.abs(b) < EPS && Math.abs(c) < EPS && Math.abs(d - 1) < EPS;
  const tp = (x: number, y: number): FillPt =>
    identityLinear ? { x, y, ctrl: false } : { x: a * x + c * y, y: b * x + d * y, ctrl: false };

  const resolveFill = (idx: number): Fill | undefined => {
    if (idx <= 0 || idx > el.fills.length) return undefined;
    return toFill(el.fills[idx - 1]!, bitmapIdByIndex);
  };
  const resolveStroke = (line: number): Stroke | undefined => {
    if (line <= 0 || line > el.strokes.length) return undefined;
    return strokeFromFla8(el.strokes[line - 1]!);
  };

  // Per-style pending runs (style id -> linked runs).
  const fillRuns = new Map<number, RunSeg[]>();
  const strokeRuns = new Map<number, RunSeg[]>();
  const runsFor = (m: Map<number, RunSeg[]>, id: number): RunSeg[] => {
    let l = m.get(id);
    if (!l) {
      l = [];
      m.set(id, l);
    }
    return l;
  };

  // Active accumulators for the three styles.
  let f0Style = 0;
  let f1Style = 0;
  let lineStyle = 0;
  let f0Seg = new RunSeg({ x: 0, y: 0, ctrl: false });
  let f1Seg = new RunSeg({ x: 0, y: 0, ctrl: false });
  let lineSeg = new RunSeg({ x: 0, y: 0, ctrl: false });

  const flushFill1 = (start: FillPt) => {
    if (f1Style > 0 && !f1Seg.isEmpty()) linkSegment(runsFor(fillRuns, f1Style), f1Seg);
    f1Seg = new RunSeg(start);
  };
  const flushFill0 = (start: FillPt) => {
    if (f0Style > 0 && !f0Seg.isEmpty()) {
      f0Seg.flip(); // fill0 runs border their region in reverse
      linkSegment(runsFor(fillRuns, f0Style), f0Seg);
    }
    f0Seg = new RunSeg(start);
  };
  const flushStroke = (start: FillPt) => {
    // Strokes are not linked into loops; each run is its own (possibly open) path.
    if (lineStyle > 0 && !lineSeg.isEmpty()) runsFor(strokeRuns, lineStyle).push(lineSeg);
    lineSeg = new RunSeg(start);
  };

  let cursor: FillPt | null = null;
  for (const e of el.edges) {
    const from = tp(e.fromX, e.fromY);
    const to = tp(e.toX, e.toY);
    // Pen move (gap): flush all active runs and restart them at `from`.
    if (cursor === null || ptKey(cursor) !== ptKey(from)) {
      flushFill1(from);
      flushFill0(from);
      flushStroke(from);
    }
    // Style transitions flush only the affected accumulator.
    if (e.fill1 !== f1Style) {
      flushFill1(from);
      f1Style = e.fill1;
    }
    if (e.fill0 !== f0Style) {
      flushFill0(from);
      f0Style = e.fill0;
    }
    if (e.line !== lineStyle) {
      flushStroke(from);
      lineStyle = e.line;
    }
    // Append this edge's geometry to every active accumulator.
    if (e.kind === "line") {
      if (f1Style > 0) f1Seg.add(to);
      if (f0Style > 0) f0Seg.add(to);
      if (lineStyle > 0) lineSeg.add(to);
    } else {
      const ctrl = tp(e.ctrlX, e.ctrlY);
      const ctrlPt: FillPt = { x: ctrl.x, y: ctrl.y, ctrl: true };
      if (f1Style > 0) {
        f1Seg.add(ctrlPt);
        f1Seg.add(to);
      }
      if (f0Style > 0) {
        f0Seg.add(ctrlPt);
        f0Seg.add(to);
      }
      if (lineStyle > 0) {
        lineSeg.add(ctrlPt);
        lineSeg.add(to);
      }
    }
    cursor = to;
  }
  const last = cursor ?? { x: 0, y: 0, ctrl: false };
  flushFill1(last);
  flushFill0(last);
  flushStroke(last);

  // Emit fills first (ascending style id, matching Ruffle's draw order), then strokes.
  const paths: ShapePath[] = [];
  for (const id of [...fillRuns.keys()].sort((x, y) => x - y)) {
    const fill = resolveFill(id);
    for (const run of fillRuns.get(id)!) paths.push(runToPath(run, fill, undefined));
  }
  for (const id of [...strokeRuns.keys()].sort((x, y) => x - y)) {
    const stroke = resolveStroke(id);
    for (const run of strokeRuns.get(id)!) paths.push(runToPath(run, undefined, stroke));
  }

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

function decompose(m: Fla8Matrix): { scaleX: number; scaleY: number; rotation: number; skewX: number; skewY: number } {
  const scaleX = Math.hypot(m.a, m.b) * (m.a < 0 && Math.abs(m.b) < EPS ? -1 : 1);
  const scaleY = Math.hypot(m.c, m.d) * (m.d < 0 && Math.abs(m.c) < EPS ? -1 : 1);
  // skewY = rotation angle on the X-axis (how x-vector is rotated)
  const skewYRad = Math.atan2(m.b, m.a);
  // skewX = rotation angle on the Y-axis, independent of skewY
  const skewXRad = Math.atan2(-m.c, m.d);
  const rotation = (skewYRad * 180) / Math.PI;
  // skewX in Flash convention: difference between the two axis angles (degrees)
  const skewX = (skewXRad * 180) / Math.PI - rotation;
  const skewY = 0; // skewY is baked into rotation; only delta (skewX) is extra
  return {
    scaleX: Math.abs(scaleX) < EPS ? 1 : scaleX,
    scaleY: Math.abs(scaleY) < EPS ? 1 : scaleY,
    rotation,
    skewX: Math.abs(skewX) < EPS ? 0 : skewX,
    skewY,
  };
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
 * Scan `src` starting at `start` (which must be just inside an already-opened
 * `{`), and return the index one past the matching closing `}`.
 *
 * The scanner skips:
 *  - String literals delimited by `"` or `'` (respecting `\` escapes)
 *  - Single-line comments `// …`
 *  - Block comments `/* … *​/`
 *
 * so brace characters inside those contexts are never counted.
 */
function scanToMatchingBrace(src: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < src.length && depth > 0) {
    const ch = src[i]!;
    // Single-line comment: skip to end of line
    if (ch === "/" && src[i + 1] === "/") {
      i += 2;
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    // Block comment: skip to */
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2; // skip the closing */
      continue;
    }
    // String literal
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < src.length) {
        const sc = src[i]!;
        if (sc === "\\") {
          i += 2; // skip escaped character
          continue;
        }
        if (sc === quote) {
          i++; // skip closing quote
          break;
        }
        i++;
      }
      continue;
    }
    // Brace counting (only reached when outside strings/comments)
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return i;
}

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
    // brace-match the body (string-literal and comment aware)
    const i = scanToMatchingBrace(src, bodyStart);
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

/** FLA `on()` plain event keyword → ButtonHandler event name (excluding keyPress). */
const BUTTON_EVENTS: Record<string, Exclude<ButtonHandler["event"], { keyPress: string }>> = {
  press: "press",
  release: "release",
  releaseOutside: "releaseOutside",
  rollOut: "rollOut",
  rollOver: "rollOver",
  dragOut: "dragOut",
  dragOver: "dragOver",
};

/**
 * Map a single `on()` event token (which may be `keyPress '<key>'`) to a
 * ButtonHandler event value. Returns `null` for unrecognized events.
 *
 * In the FLA the keyPress event is stored as two tokens: the identifier
 * `keyPress` followed by a quoted string (single or double quotes), e.g.:
 *   `keyPress '<Left>'`
 *   `keyPress "a"`
 * After the split(",") pass these arrive as a single string like
 * `keyPress '<Left>'` because keyPress handlers are never comma-combined
 * with other events in authoring tool output.
 */
function mapButtonEvent(ev: string): ButtonHandler["event"] | null {
  // Check for keyPress '<key>' or keyPress "<key>"
  const kpMatch = ev.match(/^keyPress\s+(['"])(.+)\1$/);
  if (kpMatch) {
    return { keyPress: kpMatch[2]! };
  }
  const mapped = BUTTON_EVENTS[ev];
  return mapped ?? null;
}

/**
 * Parse the raw button instance script (concatenated `on(event){body}` blocks
 * that Flash stores verbatim in the FLA) into model ButtonHandler entries.
 * Brace-matching is used so handler bodies may contain nested blocks.
 * Multiple events on one block (`on(release,rollOver)`) are split into one
 * ButtonHandler per event. Unrecognized event keywords are skipped with a warning.
 *
 * Note: `on(keyPress '<key>')` handlers are never combined with other events
 * (the Flash authoring tool always emits them as standalone blocks). The
 * keyPress token and its string argument are captured together as one event
 * token by the split-and-trim pass below.
 */
export function parseButtonHandlers(src: string): ButtonHandler[] {
  const handlers: ButtonHandler[] = [];
  // The regex captures everything inside on(...) including keyPress '<key>' strings.
  // [^)']* won't work for keyPress since the key string contains quotes but not ')'.
  // We use [^)]* (greedy, stops at first ')') which is correct because the key string
  // uses '<' and '>' or regular chars — never an unquoted ')'.
  const re = /\bon\s*\(([^)]*)\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const eventsStr = m[1]!;
    const bodyStart = re.lastIndex;
    // brace-match the body (string-literal and comment aware)
    const i = scanToMatchingBrace(src, bodyStart);
    const body = src.slice(bodyStart, i - 1).trim();
    re.lastIndex = i;

    // Split on commas but be careful not to split inside a keyPress string.
    // In practice, keyPress handlers are never comma-combined with other events,
    // but we handle it defensively by treating the whole eventsStr as a single
    // event token when it starts with 'keyPress'.
    const trimmed = eventsStr.trim();
    let eventTokens: string[];
    if (/^keyPress\s+/.test(trimmed)) {
      // Entire parenthetical content is a keyPress event — don't split on comma
      eventTokens = [trimmed];
    } else {
      eventTokens = trimmed.split(",").map((e) => e.trim()).filter(Boolean);
    }

    for (const ev of eventTokens) {
      const mapped = mapButtonEvent(ev);
      if (mapped === null) {
        console.warn(`[FLA import] unknown on() button event "${ev}"; skipping handler`);
        continue;
      }
      handlers.push({ event: mapped, script: body });
    }
  }
  return handlers;
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

  // Check if alpha is unmodified (identity alpha: multiplier 1.0, offset 0).
  // Brightness and tint never touch the alpha channel.
  const alphaIsIdentity = ce.aMult === 256 && ce.aOff === 0;

  // Brightness: all three RGB multipliers are equal, all three RGB offsets are equal,
  // alpha is identity, and the offset is consistent with Flash 8 brightness encoding:
  //   Brighter (b > 0): mult = 256*(1-b/100), offset = 255*b/100  → offset ≈ 255-mult
  //   Darker  (b < 0): mult = 256*(1+b/100), offset = 0
  if (alphaIsIdentity &&
      ce.rMult === ce.gMult && ce.rMult === ce.bMult &&
      ce.rOff === ce.gOff && ce.rOff === ce.bOff) {
    const m = ce.rMult;
    const o = ce.rOff;
    // Darker case: offset is 0 (or very close), multiplier reduced below 256
    if (o === 0 && m <= 256) {
      const b = Math.round((256 - m) / 256 * -100); // negative: darker
      if (b >= -100 && b <= 0) {
        return { type: "brightness", brightness: b };
      }
    }
    // Brighter case: offset > 0, multiplier reduced, offset ≈ 255 - mult
    if (o > 0 && m < 256 && Math.abs(o - (255 - m)) <= 2) {
      const b = Math.round((o / 255) * 100); // positive: brighter
      if (b > 0 && b <= 100) {
        return { type: "brightness", brightness: b };
      }
    }
    // Equal RGB but not a clean brightness formula — could be tint
  }

  // Tint: all three RGB multipliers are equal and reduced below identity (> 0%
  // tint), alpha is identity. At least one color offset must be non-zero.
  // Flash tint: mult = 256*(1-tintAmount/100), offsets = tintColor * tintAmount/100
  if (alphaIsIdentity &&
      ce.rMult === ce.gMult && ce.rMult === ce.bMult &&
      ce.rMult < 256 && // require non-identity multiplier (tintAmount > 0)
      (ce.rOff !== 0 || ce.gOff !== 0 || ce.bOff !== 0)) {
    const m = ce.rMult;
    // tintAmount = (1 - m/256)*100, i.e. 100% tint when m=0
    const tintAmount = Math.round((1 - m / 256) * 100);
    if (tintAmount > 0 && tintAmount <= 100) {
      // Recover tint color: tintColor_channel = offset / (tintAmount/100)
      const scale = 100 / tintAmount;
      const tintR = Math.max(0, Math.min(255, Math.round(ce.rOff * scale)));
      const tintG = Math.max(0, Math.min(255, Math.round(ce.gOff * scale)));
      const tintB = Math.max(0, Math.min(255, Math.round(ce.bOff * scale)));
      const h = (v: number) => v.toString(16).padStart(2, "0");
      return {
        type: "tint",
        tintColor: `#${h(tintR)}${h(tintG)}${h(tintB)}`,
        tintAmount,
      };
    }
  }

  // General case -> advanced color transform. Multipliers map 256 (=1.0) to
  // 100%; offsets are already in 0..255 scale.
  const pct = (mult: number) => Math.round((mult / 256) * 100);
  return {
    type: "advanced",
    redMult: pct(ce.rMult),
    greenMult: pct(ce.gMult),
    blueMult: pct(ce.bMult),
    alphaMult: pct(ce.aMult),
    redOffset: ce.rOff,
    greenOffset: ce.gOff,
    blueOffset: ce.bOff,
    alphaOffset: ce.aOff,
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
        bevelType: f.onTop ? "full" : f.inner ? "inner" : "outer",
        enabled: true,
      };
    case "adjust-color":
      // AdjustColor filter (FLA type 0x06): the four params are stored directly
      // in the binary, so pass them straight through — no matrix math needed.
      return {
        type: "adjustColor" as const,
        brightness: f.brightness,
        contrast: f.contrast,
        saturation: f.saturation,
        hue: f.hue,
        enabled: true,
      };
    case "color-matrix":
      // ColorMatrix in FLA is a raw 4×5 matrix (20 floats) applied to
      // [R,G,B,A,1]. Decompose to best-effort brightness/contrast/saturation/hue.
      return decodeColorMatrix(f.matrix);
    case "convolution": {
      const cf: ConvolutionFilter = {
        type: "convolution",
        matrixX: f.matrixX,
        matrixY: f.matrixY,
        matrix: f.matrix,
        divisor: f.divisor,
        bias: f.bias,
        defaultColor: { r: f.defaultR, g: f.defaultG, b: f.defaultB, a: f.defaultA },
        clamp: f.clamp,
        preserveAlpha: f.preserveAlpha,
        enabled: true,
      };
      return cf;
    }
  }
}

/**
 * Decompose a Flash 8 ColorMatrix filter (4×5 row-major matrix, 20 floats)
 * into brightness/contrast/saturation/hue values for AdjustColorFilter.
 *
 * Matrix row layout (applied to [R, G, B, A, 1]):
 *   R' = m[0]*R + m[1]*G + m[2]*B + m[3]*A + m[4]
 *   G' = m[5]*R + m[6]*G + m[7]*B + m[8]*A + m[9]
 *   B' = m[10]*R + m[11]*G + m[12]*B + m[13]*A + m[14]
 *   A' = m[15]*R + m[16]*G + m[17]*B + m[18]*A + m[19]
 *
 * Brightness: average RGB offset (m[4], m[9], m[14]) mapped to −100..100.
 *   Flash's +100% brightness adds 255 to each channel, so scale by 100/255.
 * Contrast: RGB diagonal average (m[0], m[6], m[12]) minus 1, scaled to −100..100.
 *   Flash's +100 contrast sets diagonal ≈ 2 and offsets to re-center around 128.
 * Saturation: approximated from the luminance weights in row 0 (desaturation
 *   pushes m[0] toward the luminance weight ~0.299). s = (m[0] − 0.299) / (1 − 0.299).
 *   Mapped to 0..100; partial desaturation gives 0..100; negative = hypersaturate.
 * Hue: estimated from the rotation angle encoded in the R→G and G→R cross-terms
 *   (m[1] and m[5]). For a pure hue rotation θ, m[1] ≈ sin(θ) (scaled). This is
 *   a best-effort approximation — exact recovery requires full matrix decomposition.
 *
 * All values are clamped to their valid ranges before returning.
 */
function decodeColorMatrix(m: readonly number[]): AdjustColorFilter {
  // Brightness: average of the RGB offset terms (m[4], m[9], m[14]), scaled to −100..100.
  const rawBrightness = (m[4] + m[9] + m[14]) / 3;
  const brightness = Math.round(rawBrightness * (100 / 255));

  // Contrast: average of the RGB diagonal scale terms minus 1, scaled to −100..100.
  // Identity diagonal = 1; +100 contrast ≈ diagonal 2 (after centering offset).
  const rawContrast = ((m[0] + m[6] + m[12]) / 3 - 1);
  const contrast = Math.round(rawContrast * 100);

  // Saturation: for a fully desaturated matrix, each diagonal approaches
  // the luminance weight (~0.299 for R). s=0 when m[0]≈0.299, s=1 when m[0]≈1.
  // Formula: sat = (m[0] - 0.299) / (1 - 0.299) * 100  — clamped to −100..100.
  const sat = (m[0] - 0.299) / (1 - 0.299) * 100;
  const saturation = Math.round(Math.max(-100, Math.min(100, sat)));

  // Hue: for a pure hue rotation of θ degrees in Flash's color space, the
  // R→G cross-term m[1] encodes some portion of sin(θ). Best-effort extraction.
  const hueRad = Math.asin(Math.max(-1, Math.min(1, m[1])));
  const hue = Math.round(hueRad * (180 / Math.PI));

  return {
    type: "adjustColor",
    brightness: Math.max(-100, Math.min(100, brightness)),
    contrast: Math.max(-100, Math.min(100, contrast)),
    saturation,
    hue: Math.max(-180, Math.min(180, hue)),
    enabled: true,
  };
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

function importVisible(el: { visible?: boolean }): { visible?: false } {
  return el.visible === false ? { visible: false } : {};
}

export function toObjectAccessibility(acc: Fla8Accessibility | undefined): ObjectAccessibility | undefined {
  if (!acc) return undefined;
  const hasExtra =
    acc.name != null ||
    acc.description != null ||
    acc.shortcut != null ||
    acc.tabIndex != null ||
    acc.forceSimple === true;
  if (acc.enabled && !hasExtra) return undefined;
  return {
    enabled: acc.enabled,
    ...(acc.name ? { name: acc.name } : {}),
    ...(acc.description ? { description: acc.description } : {}),
    ...(acc.shortcut ? { shortcut: acc.shortcut } : {}),
    ...(acc.tabIndex != null ? { tabIndex: acc.tabIndex } : {}),
    ...(acc.forceSimple ? { forceSimple: true } : {}),
  };
}

function convertElement(
  el: Fla8Element,
  symbolIdByIndex: Map<number, string>,
  bitmapIdByIndex: Map<number, string>,
  bitmapSizeByIndex: Map<number, { width: number; height: number }>,
  videoIdByIndex: Map<number, string>,
  videoSizeByIndex: Map<number, { width: number; height: number }>,
): DisplayObject | null {
  switch (el.type) {
    case "shape":
      if (el.edges.length === 0) return null;
      return { ...convertShape(el, bitmapIdByIndex), ...importVisible(el) };
    case "instance": {
      const symbolId = symbolIdByIndex.get(el.libraryIndex);
      if (!symbolId) {
        console.warn(
          `[FLA import] instance references unknown library symbol #${el.libraryIndex}; skipping`,
        );
        return null;
      }
      const { scaleX, scaleY, rotation, skewX, skewY } = decompose(el.matrix);
      const colorEffect = toColorEffect(el.colorEffect);
      const filters = toFlashFilters(el.filters);
      const blendMode = toBlendMode(el.blendMode);
      // onClipEvent handlers apply to movieclip (sprite) instances; on()
      // handlers apply to button instances.
      const clipActions = el.kind === "sprite" && el.script ? parseClipActions(el.script) : [];
      const buttonHandlers = el.kind === "button" && el.script ? parseButtonHandlers(el.script) : [];
      const accessibility = toObjectAccessibility(el.accessibility);
      return {
        type: "instance",
        id: nextId("inst"),
        symbolId,
        x: el.matrix.tx,
        y: el.matrix.ty,
        scaleX,
        scaleY,
        rotation,
        ...(skewX !== 0 ? { skewX } : {}),
        ...(skewY !== 0 ? { skewY } : {}),
        ...(el.instanceName ? { instanceName: el.instanceName } : {}),
        ...(colorEffect ? { colorEffect } : {}),
        ...(filters.length > 0 ? { filters } : {}),
        ...(blendMode ? { blendMode } : {}),
        ...(clipActions.length > 0 ? { clipActions } : {}),
        ...(buttonHandlers.length > 0 ? { buttonHandlers } : {}),
        ...(el.trackAsMenu ? { trackAsMenu: true } : {}),
        ...(accessibility ? { accessibility } : {}),
        ...(el.loopMode !== 0 ? { loopMode: (["loop", "play-once", "single-frame"][el.loopMode] ?? "loop") as "loop" | "play-once" | "single-frame" } : {}),
        ...(el.firstFrame !== 0 ? { firstFrame: el.firstFrame } : {}),
        ...(el.registrationX !== 0 || el.registrationY !== 0 ? { registrationPoint: { x: el.registrationX / 20, y: el.registrationY / 20 } } : {}),
        ...importVisible(el),
      };
    }
    case "text": {
      const textFilters = toFlashFilters(el.filters);
      const textColorEffect = toColorEffect(el.colorEffect);
      // Build HTML markup when there are multiple formatting runs, each potentially
      // with different font/size/color/bold/italic. DefineEditText only holds a single
      // style, but the HTML flag (bit 9) allows per-run formatting via Flash HTML tags.
      const isMultiRun = el.runs.length > 1;
      const htmlText = isMultiRun ? buildHtmlText(el.runs) : undefined;
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
        multiline: el.multiline,
        wordWrap: el.wordWrap,
        ...(el.instanceName ? { instanceName: el.instanceName } : {}),
        ...(el.password ? { password: true } : {}),
        ...(el.maxChars > 0 ? { maxChars: el.maxChars } : {}),
        ...(el.hasBorder ? { hasBorder: true } : {}),
        ...(el.hasBackground ? { hasBackground: true } : {}),
        ...(el.as2VariableName ? { as2VariableName: el.as2VariableName } : {}),
        ...(el.scrollable ? { scrollable: true } : {}),
        ...(el.autoExpand ? { autoSize: true } : {}),
        ...(el.leading != null && el.leading !== 0 ? { leading: el.leading } : {}),
        ...(el.indent != null && el.indent !== 0 ? { indent: el.indent } : {}),
        ...(el.leftMargin != null && el.leftMargin !== 0 ? { leftMargin: el.leftMargin } : {}),
        ...(el.rightMargin != null && el.rightMargin !== 0 ? { rightMargin: el.rightMargin } : {}),
        ...(el.letterSpacing != null && el.letterSpacing !== 0 ? { letterSpacing: el.letterSpacing } : {}),
        ...(el.autoKern ? { autoKern: true } : {}),
        ...(el.linkUrl ? { linkUrl: el.linkUrl } : {}),
        ...(el.linkTarget ? { linkTarget: el.linkTarget } : {}),
        ...(textColorEffect ? { colorEffect: textColorEffect } : {}),
        ...(textFilters.length > 0 ? { filters: textFilters } : {}),
        ...(isMultiRun ? { html: true, htmlText } : {}),
        ...importVisible(el),
      };
    }
    case "bitmap": {
      const libraryItemId = bitmapIdByIndex.get(el.mediaId);
      if (!libraryItemId) {
        console.warn(
          `[FLA import] bitmap placement references unknown media #${el.mediaId}; skipping`,
        );
        return null;
      }
      const { scaleX, scaleY, rotation, skewX: bitmapSkewX, skewY: bitmapSkewY } = decompose(el.matrix);
      const size = bitmapSizeByIndex.get(el.mediaId) ?? { width: 1, height: 1 };
      const bitmapFilters = toFlashFilters(el.filters);
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
        ...(bitmapSkewX !== 0 ? { skewX: bitmapSkewX } : {}),
        ...(bitmapSkewY !== 0 ? { skewY: bitmapSkewY } : {}),
        ...(bitmapFilters.length > 0 ? { filters: bitmapFilters } : {}),
        ...importVisible(el),
      };
    }
    case "video": {
      const videoItemId = videoIdByIndex.get(el.mediaId);
      if (!videoItemId) {
        console.warn(
          `[FLA import] video placement references unknown media #${el.mediaId}; skipping`,
        );
        return null;
      }
      const { scaleX, scaleY, rotation } = decompose(el.matrix);
      const size = videoSizeByIndex.get(el.mediaId) ?? { width: 320, height: 240 };
      return {
        type: "video",
        id: nextId("video"),
        videoItemId,
        x: el.matrix.tx,
        y: el.matrix.ty,
        width: Math.max(size.width, 1),
        height: Math.max(size.height, 1),
        scaleX,
        scaleY,
        rotation,
      };
    }
    case "swf": {
      // CPicSwf places an external SWF asset imported via File > Import (a legacy
      // record; see binary-FLA spec §18.3). The raw record bytes ARE preserved at
      // the document level as `flaSwfBlobs` (see collectSwfBlobs) so a re-export can
      // reproduce them; they are not lost. What is dropped here is only the on-stage
      // *rendered* representation: the decoded header carries just a placement matrix
      // (the instance name / AS2 clip-event scripts / source SWF filename / color
      // transform live in the undecoded variable tail), and there is no model
      // display-object type to map an embedded SWF placement to. So the element is
      // omitted from the rendered stage while its bytes survive for round-trip.
      const { scaleX, scaleY, rotation } = decompose(el.matrix);
      console.warn(
        `[FLA import] CPicSwf placement not rendered on stage (bytes preserved in flaSwfBlobs for re-export). ` +
          `Placement: x=${el.matrix.tx.toFixed(0)}, y=${el.matrix.ty.toFixed(0)}, ` +
          `scaleX=${scaleX.toFixed(3)}, scaleY=${scaleY.toFixed(3)}, ` +
          `rotation=${rotation.toFixed(1)}°.`,
      );
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Text element conversion (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Convert a parsed FLA text element to the editor's TextDisplayObject model.
 * Exported so that unit tests can directly exercise the conversion with
 * synthetic Fla8Text objects (including those with a non-null colorEffect).
 */
export function convertFla8Text(el: Fla8Text): TextDisplayObject {
  const textFilters = toFlashFilters(el.filters);
  const textColorEffect = toColorEffect(el.colorEffect);
  const isMultiRun = el.runs.length > 1;
  const htmlText = isMultiRun ? buildHtmlText(el.runs) : undefined;
  // For a single-run field, forward characterPosition to the top-level model field.
  const singleRunCharPos =
    !isMultiRun && el.runs.length === 1 ? el.runs[0].characterPosition : undefined;
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
    ...(el.orientation !== "horizontal" ? { orientation: el.orientation } : {}),
    multiline: el.multiline,
    wordWrap: el.wordWrap,
    ...(el.instanceName ? { instanceName: el.instanceName } : {}),
    ...(el.password ? { password: true } : {}),
    ...(el.maxChars > 0 ? { maxChars: el.maxChars } : {}),
    ...(el.hasBorder ? { hasBorder: true } : {}),
    ...(el.hasBackground ? { hasBackground: true } : {}),
    ...(el.as2VariableName ? { as2VariableName: el.as2VariableName } : {}),
    ...(el.scrollable ? { scrollable: true } : {}),
    // selectable defaults to true; only emit when explicitly false
    ...(el.selectable === false ? { selectable: false } : {}),
    ...(el.autoKern ? { autoKern: true } : {}),
    ...(el.linkUrl ? { linkUrl: el.linkUrl } : {}),
    ...(el.linkTarget ? { linkTarget: el.linkTarget } : {}),
    ...(textColorEffect ? { colorEffect: textColorEffect } : {}),
    ...(textFilters.length > 0 ? { filters: textFilters } : {}),
    ...(isMultiRun ? { html: true, htmlText } : {}),
    ...(singleRunCharPos ? { characterPosition: singleRunCharPos } : {}),
    ...(el.antiAlias != null ? { antiAlias: el.antiAlias } : {}),
    ...(el.csm != null ? { csm: el.csm } : {}),
  };
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

// §8.4 rulerUnitType -> model RulerUnits. The binary distinguishes fractional
// (0) from decimal (1) inches; the model has a single "inches", so both map to
// it. Anything unrecognised falls back to "px".
const RULER_UNIT_TYPES: Record<number, RulerUnits> = {
  0: "inches",
  1: "inches",
  2: "points",
  3: "cm",
  4: "mm",
  5: "px",
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
  videoIdByIndex: Map<number, string>,
  videoSizeByIndex: Map<number, { width: number; height: number }>,
): Layer {
  const frames: Frame[] = [];
  let frameIndex = 0;
  for (const f of l.frames) {
    const displayObjects: DisplayObject[] = [];
    for (const el of f.elements) {
      const converted = convertElement(el, symbolIdByIndex, bitmapIdByIndex, bitmapSizeByIndex, videoIdByIndex, videoSizeByIndex);
      if (converted) displayObjects.push(converted);
    }
    let sound: SoundLinkage | null = null;
    if (f.soundId > 0) {
      const libraryItemId = soundIdByIndex.get(f.soundId);
      if (libraryItemId) {
        const syncMode: SoundLinkage["syncMode"] =
          f.soundSync >= 0 ? (SOUND_SYNC_MODES[f.soundSync] ?? "event") : "event";
        const repeatCount = f.soundLoop >= 0 ? f.soundLoop : 1;
        sound = {
          libraryItemId,
          syncMode,
          repeatCount,
          ...(f.inPoint !== undefined && f.inPoint > 0 ? { inPoint: f.inPoint } : {}),
          ...(f.outPoint !== undefined && f.outPoint > 0 ? { outPoint: f.outPoint } : {}),
          ...(f.envelopePoints && f.envelopePoints.length > 0 ? { customEnvelope: f.envelopePoints.map(ep => ({ pos44: ep.pos, leftLevel: ep.leftLevel, rightLevel: ep.rightLevel })) } : {}),
        };
      } else {
        console.warn(`[FLA import] frame sound id ${f.soundId} not found in library; skipping`);
      }
    }
    // keyMode tween flags (flacomdoc): bit 0x0001 = classic/motion tween,
    // bit 0x0002 = shape tween. The remaining bits (observed base 0x600 =
    // 0x400|0x200, and an occasional 0x4000 on some authoring versions) are
    // unrelated motion-tween-scale / sync state, so they must NOT gate tween
    // detection. Real Flash 8 FLAs (e.g. Magnet.fla's sliding menu buttons)
    // store motion-tween keyframes as keyMode=0x601 (base 0x600 + bit 0x0001),
    // never 0x4001 — so the old `(keyMode & 0x4000) && (keyMode & 0x0001)`
    // requirement dropped every motion tween.
    const tweenType =
      (f.keyMode & 0x0001) !== 0
        ? "motion"
        : (f.keyMode & 0x0002) !== 0
          ? "shape"
          : "none";
    // field_190 stores signed acceleration (strength + direction). Forward
    // strength as motionEase/shapeEase and direction as motionEaseType/shapeEaseType.
    const easeOverrides =
      tweenType === "shape"
        ? { shapeEase: f.motionEase, shapeEaseType: f.easeType }
        : {
            motionEase: f.motionEase,
            motionEaseType: f.easeType,
            motionEaseCurve: f.motionEaseCurve,
            easeForPosition: f.easeForPosition,
            easeForRotation: f.easeForRotation,
            easeForScale: f.easeForScale,
            easeForColor: f.easeForColor,
            easeForFilters: f.easeForFilters,
          };
    frames.push(
      createFrame(frameIndex, {
        label: f.label,
        labelType: f.labelIsAnchor ? "anchor" : f.labelIsComment ? "comment" : "name",
        script: f.script,
        tweenType,
        ...easeOverrides,
        shapeBlend: f.shapeBlend === 1 ? "angular" : "distributive",
        motionRotate: f.motionRotate,
        motionRotateCount: f.motionRotateCount,
        motionOrientToPath: f.motionOrientToPath,
        motionSnap: f.motionSnap,
        motionSync: f.motionSync,
        motionScale: f.motionTweenScale,
        displayObjects,
        isEmpty: displayObjects.length === 0,
        sound,
      }),
    );
    frameIndex += f.duration;
  }
  const frameCount = Math.max(1, frameIndex);
  // The binary stores a row-height MULTIPLIER (1 = the base 20 px row); the
  // model carries the row height in pixels (docs/21 §10.2).
  const height = Math.max(1, l.heightMultiplier) * 20;
  return createLayer(l.name || `Layer ${index + 1}`, LAYER_TYPES[l.layerType] ?? "normal", {
    visible: !l.hidden,
    locked: l.locked,
    outlineMode: l.outlineMode,
    outlineColor: l.outlineColor ? toHex(l.outlineColor) : "#0000ff",
    height,
    frames: frames.length > 0 ? frames : [createFrame(0)],
    frameCount,
  });
}

/** CArchive backref-tag bit set on a backref-form `parentLayerRef`. */
const PARENT_REF_BACKREF_BIT = 0x8000;

/**
 * Resolve mask→masked hierarchy in the binary layer list (bottom-to-top order).
 *
 * In the Flash 8 binary format a masked child carries `layerType=0` (normal)
 * plus a `parentReference` in its CPicLayer trailer (docs/21 §10.2) that names
 * its mask layer by the §5.2 running object index.  Two on-wire forms occur:
 *
 *   1. **Raw running-index form** — `parentLayerRef` equals the mask layer's
 *      `ownObjectIndex` directly.  This is how Flash stores the masked children
 *      that sit ABOVE the mask in binary order (Magnet.fla AA: Magnets / Walls /
 *      Ball all carry the mask's index; Scene 5: the masked "Layer 5").
 *
 *   2. **Backref-tag form** — `parentLayerRef` has the 0x8000 CArchive backref
 *      bit set (e.g. 0x8003).  Flash emits this for the one masked child stored
 *      IMMEDIATELY BELOW its mask in binary order; its literal index is a
 *      backref to an earlier shared object, NOT the mask, so it is resolved
 *      positionally to the nearest mask layer at a higher binary index.
 *      (Magnet.fla Scene 5: 'Ball' at bin 1, the mask at bin 2.)
 *
 * The previous single forward scan promoted only a consecutive run of children
 * AFTER the mask and required matching non-zero refs, so it silently dropped a
 * backref-form child sitting before the mask — Scene 5's 'Ball' lost its mask
 * membership and rendered un-masked (task 1341).  This pass is now
 * order-independent: it indexes every mask by `ownObjectIndex`, then promotes
 * any layer whose `parentReference` resolves (by either form) to a mask.
 */
function resolveMaskedLayers(binaryLayers: readonly Fla8Layer[]): Fla8Layer[] {
  const result: Fla8Layer[] = [...binaryLayers];

  // Map each mask layer's running object index → its binary position.
  const maskIndexByObjId = new Map<number, number>();
  for (let i = 0; i < result.length; i++) {
    const layer = result[i]!;
    if (layer.layerType === 4) maskIndexByObjId.set(layer.ownObjectIndex, i);
  }
  if (maskIndexByObjId.size === 0) return result;

  /** Nearest mask layer at a strictly higher binary index than `from`, or -1. */
  const nearestMaskAbove = (from: number): number => {
    for (let j = from + 1; j < result.length; j++) {
      if (result[j]!.layerType === 4) return j;
    }
    return -1;
  };

  for (let i = 0; i < result.length; i++) {
    const layer = result[i]!;
    if (layer.layerType !== 0 || layer.parentLayerRef === 0) continue;

    let belongsToMask = false;
    if ((layer.parentLayerRef & PARENT_REF_BACKREF_BIT) !== 0) {
      // Backref-tag form: positionally attach to the nearest mask above. Flash
      // only uses this form for the masked child directly below the mask, so the
      // child must be adjacent (no other layer between it and that mask).
      const maskIdx = nearestMaskAbove(i);
      belongsToMask = maskIdx === i + 1;
    } else {
      // Raw running-index form: must equal a mask layer's own object index.
      belongsToMask = maskIndexByObjId.has(layer.parentLayerRef);
    }

    if (belongsToMask) result[i] = { ...layer, layerType: 5 };
  }
  return result;
}

function convertTimeline(
  t: Fla8Timeline,
  symbolIdByIndex: Map<number, string>,
  soundIdByIndex: Map<number, string>,
  bitmapIdByIndex: Map<number, string>,
  bitmapSizeByIndex: Map<number, { width: number; height: number }>,
  videoIdByIndex: Map<number, string>,
  videoSizeByIndex: Map<number, { width: number; height: number }>,
): Timeline {
  // Flash binary FLA stores layers from bottom-to-top (background first, foreground last).
  // The Flash 8 clone model convention (and compile.ts) expect layers stored top-to-bottom
  // (li=0 = topmost/frontmost, li=n-1 = bottommost/background).
  // Reverse the array so the frontmost layer ends up at index 0.

  // Pre-process: resolve mask→masked hierarchy from parentLayerRef.
  //
  // In the binary stream, masked layers have layerType=0 (normal) but carry a
  // non-zero parentLayerRef in their CPicLayer trailer — a CArchive object-
  // reference index pointing to their mask parent.  Layers with parentLayerRef=0
  // are top-level (no mask parent).
  //
  // We detect masked children by scanning the binary (bottom-to-top) layer list:
  // after a mask layer (type=4), consecutive layers with the same non-zero
  // parentLayerRef are its masked children → promote their layerType to 5.
  const resolvedLayers: Fla8Layer[] = resolveMaskedLayers(t.layers);

  const reversedBinary = [...resolvedLayers].reverse();
  let layers = reversedBinary.map((l, i) =>
    convertLayer(l, i, symbolIdByIndex, soundIdByIndex, bitmapIdByIndex, bitmapSizeByIndex, videoIdByIndex, videoSizeByIndex),
  );
  if (layers.length === 0) {
    return { layers: [createLayer("Layer 1", "normal")] };
  }

  // After binary-order reversal, mask groups are inverted: masked children end up
  // at LOWER li indices than their owning mask layer.  The model invariant is
  // [mask, …masked] (mask above its masked children, contiguous).  Because a
  // masked child may have been stored on EITHER side of the mask in the binary
  // (Scene 5's 'Ball' was below the mask, so after reversal it lands AFTER the
  // mask, while the mask's other masked children land BEFORE it — task 1341),
  // gather the masked layers from BOTH the already-emitted tail and the run that
  // follows the mask, and re-emit them all directly after the mask.
  const reordered: Layer[] = [];
  let i = 0;
  while (i < layers.length) {
    const layer = layers[i]!;
    if (layer.type === "mask") {
      // Masked children that ended up before the mask (pull them off the tail).
      const maskedBefore: Layer[] = [];
      while (reordered.length > 0 && reordered[reordered.length - 1]!.type === "masked") {
        maskedBefore.unshift(reordered.pop()!);
      }
      // Masked children that ended up immediately after the mask.
      const maskedAfter: Layer[] = [];
      let j = i + 1;
      while (j < layers.length && layers[j]!.type === "masked") {
        maskedAfter.push(layers[j]!);
        j++;
      }
      reordered.push(layer, ...maskedBefore, ...maskedAfter);
      i = j;
    } else {
      reordered.push(layer);
      i++;
    }
  }
  layers = reordered;

  return { layers: assignFolderParents(layers) };
}

/**
 * Assign `parentFolderId` to layers based on their positional order in the
 * top-to-bottom list (post-reversal).
 *
 * Convention: a "folder" type layer immediately precedes its children in the
 * list.  Each non-folder layer is assigned to the most recently seen folder
 * layer.  A new folder layer resets the context so sibling folders are
 * handled correctly.  Layers before any folder, or after a folder has been
 * exhausted by more folders, keep `parentFolderId === null`.
 *
 * Exported for unit testing.
 */
export function assignFolderParents(layers: readonly Layer[]): Layer[] {
  const result: Layer[] = [];
  let currentFolderId: string | null = null;
  for (const layer of layers) {
    if (layer.type === "folder") {
      // This layer IS a folder — it sits at the top level (no parent folder
      // itself; nested-folder support would need explicit depth info).
      currentFolderId = layer.id;
      result.push(layer); // parentFolderId already null from createLayer
    } else {
      // Assign to the most recently seen folder, or null if none.
      result.push(currentFolderId !== null ? { ...layer, parentFolderId: currentFolderId } : layer);
    }
  }
  return result;
}

/**
 * Strip the trailing "!" from a folder segment name.
 * In the binary FLA, folder names end with "!" to indicate the folder was
 * expanded in Flash's library panel UI (e.g. "Assets!" → "Assets").
 */
function stripFolderExpanded(segmentName: string): string {
  return segmentName.endsWith("!") ? segmentName.slice(0, -1) : segmentName;
}

/**
 * Derive LibraryFolder objects and a symbol→folderId map from the full
 * library paths stored in the Contents stream.
 *
 * Flash encodes the folder hierarchy in each symbol's full library path:
 *   "FolderA!/NestedFolder!/SymbolName"
 *
 * The last path segment is the symbol display name; all preceding segments
 * are folder names (ordered outermost to innermost). Folder names may end
 * with "!" indicating the folder was expanded in the authoring UI — that
 * suffix is stripped before becoming the folder's display name.
 *
 * @param symbolMeta  Map of symbol-stream-number → { name, fullPath }
 * @returns { folders, symbolFolderIdByNum }
 *   folders              — array of LibraryFolder objects (de-duplicated)
 *   symbolFolderIdByNum  — Map<streamNum, folderId> for symbols in folders
 */
export function deriveFoldersFromPaths(
  symbolMeta: Map<number, { name: string; fullPath: string }>,
): { folders: LibraryFolder[]; symbolFolderIdByNum: Map<number, string> } {
  // Map from canonical path key → LibraryFolder (de-duplicate across symbols)
  // Key is the full folder path joined with "/" using the ORIGINAL segment names
  // (including "!" if present) so we can look up by key consistently.
  const folderByPath = new Map<string, LibraryFolder>();

  // Helper: create-or-get a folder given its path segments (outermost first)
  function getOrCreateFolder(segments: string[]): LibraryFolder {
    const key = segments.join("/");
    if (folderByPath.has(key)) return folderByPath.get(key)!;

    let parentFolderId: string | null = null;
    if (segments.length > 1) {
      const parent = getOrCreateFolder(segments.slice(0, -1));
      parentFolderId = parent.id;
    }

    const name = stripFolderExpanded(segments[segments.length - 1]!);
    const folder = createLibraryFolder(name, parentFolderId);
    folderByPath.set(key, folder);
    return folder;
  }

  const symbolFolderIdByNum = new Map<number, string>();

  for (const [num, meta] of symbolMeta) {
    const path = meta.fullPath;
    if (!path || !path.includes("/")) continue;

    // Split into segments; the last segment is the symbol display name.
    const segments = path.split("/");
    if (segments.length < 2) continue;

    const folderSegments = segments.slice(0, -1);
    const folder = getOrCreateFolder(folderSegments);
    symbolFolderIdByNum.set(num, folder.id);
  }

  // Return folders in stable order: parents before children
  const folders: LibraryFolder[] = [];
  const seen = new Set<string>();
  function addFolderTree(key: string): void {
    if (seen.has(key)) return;
    seen.add(key);
    const folder = folderByPath.get(key)!;
    // Add parent first (if any)
    const segs = key.split("/");
    if (segs.length > 1) {
      addFolderTree(segs.slice(0, -1).join("/"));
    }
    if (!folders.some((f) => f.id === folder.id)) {
      folders.push(folder);
    }
  }
  for (const key of folderByPath.keys()) {
    addFolderTree(key);
  }

  return { folders, symbolFolderIdByNum };
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

const PAGE_RE = /^(?:Page (\d+)|P (\d+) \d+)$/;
const SYMBOL_RE = /^(?:Symbol (\d+)|S (\d+) \d+)$/;
const MEDIA_RE = /^Media (\d+)$/;
// "Sound N" OLE streams (pre-CS4 / Flash 5-MX era) carry raw audio payload
// directly in the OLE2 container, keyed by the same stream number used in
// the Contents-stream sound table.
const SOUND_RE = /^(?:Sound (\d+)|So (\d+) \d+)$/;

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

// ---------------------------------------------------------------------------
// FLV dimension extractor (used during binary FLA import)
// ---------------------------------------------------------------------------

/**
 * Attempt to extract frame dimensions from an FLV byte buffer.
 *
 * Checks (in priority order):
 *   1. FLV Script tag (type 18) carrying an AMF0 onMetaData object with
 *      "width" / "height" Number fields.
 *   2. Sorenson H.263 bitstream header of the first keyframe (codecId = 2).
 *
 * Returns { width, height } or null if dimensions could not be determined.
 * The caller falls back to 320×240 when null is returned.
 *
 * This function mirrors the logic in packages/swf/src/video.ts demuxFlv()
 * but is kept here to avoid a circular dependency between @flash/core and
 * @flash/swf.
 */
function extractFlvDims(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 9) return null;
  if (buf[0] !== 0x46 || buf[1] !== 0x4c || buf[2] !== 0x56) return null;

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dataOffset = view.getUint32(5, false);
  let pos = (dataOffset >= 9 ? dataOffset : 9) + 4; // skip PreviousTagSize

  let firstVideoData: Uint8Array | null = null;
  let firstVideoCodecId = -1;

  while (pos + 11 <= buf.length) {
    const tagType = buf[pos];
    const dataSize = (buf[pos + 1]! << 16) | (buf[pos + 2]! << 8) | buf[pos + 3]!;
    const dataStart = pos + 11;
    const dataEnd = dataStart + dataSize;
    if (dataEnd > buf.length) break;

    if (tagType === 18 /* Script */ && dataSize > 0) {
      // Try to parse AMF0 onMetaData for width/height.
      const dims = parseFlvMetaDimsFromAmf0(buf.slice(dataStart, dataEnd));
      if (dims) return dims;
    } else if (tagType === 9 /* Video */ && dataSize > 0 && firstVideoData === null) {
      const flags = buf[dataStart]!;
      firstVideoCodecId = flags & 0x0f;
      firstVideoData = buf.slice(dataStart, dataEnd);
    }

    pos = dataEnd + 4; // advance past tag + trailing PreviousTagSize
  }

  // Fall back to codec bitstream parsing.
  if (firstVideoData !== null && firstVideoCodecId === 2 /* Sorenson H.263 */) {
    return parseH263DimsFromVideoData(firstVideoData);
  }

  return null;
}

/**
 * Parse "width" and "height" from an FLV Script tag payload (AMF0).
 *
 * Expected layout:
 *   UI8(0x02) UI16-BE(len) "onMetaData"
 *   UI8(0x08) UI32-BE(count)
 *   [ UI16-BE(keyLen) key AMF0Value ]*
 */
function parseFlvMetaDimsFromAmf0(
  payload: Uint8Array,
): { width: number; height: number } | null {
  if (payload.length < 3 || payload[0] !== 0x02) return null;
  const strLen = (payload[1]! << 8) | payload[2]!;
  const strEnd = 3 + strLen;
  if (strEnd > payload.length) return null;
  const onMeta = "onMetaData";
  if (strLen !== onMeta.length) return null;
  for (let i = 0; i < strLen; i++) {
    if (payload[3 + i] !== onMeta.charCodeAt(i)) return null;
  }
  // ECMA Array (type 0x08)
  let pos = strEnd;
  if (pos + 5 > payload.length || payload[pos] !== 0x08) return null;
  pos += 5; // skip type + 4-byte count

  let foundW: number | null = null;
  let foundH: number | null = null;

  while (pos + 2 <= payload.length) {
    const keyLen = (payload[pos]! << 8) | payload[pos + 1]!;
    pos += 2;
    if (keyLen === 0) break; // end marker
    if (pos + keyLen > payload.length) break;
    let key = "";
    for (let i = 0; i < keyLen; i++) key += String.fromCharCode(payload[pos + i]!);
    pos += keyLen;
    if (pos >= payload.length) break;
    const vtype = payload[pos++]!;
    if (vtype === 0x00 /* Number (float64 BE) */) {
      if (pos + 8 > payload.length) break;
      const dv = new DataView(payload.buffer, payload.byteOffset + pos, 8);
      const v = dv.getFloat64(0, false);
      pos += 8;
      if (key === "width") foundW = v;
      else if (key === "height") foundH = v;
    } else if (vtype === 0x02 /* String */) {
      if (pos + 2 > payload.length) break;
      const sLen = (payload[pos]! << 8) | payload[pos + 1]!;
      pos += 2 + sLen;
    } else if (vtype === 0x01 /* Boolean */) {
      pos += 1;
    } else {
      break; // unknown type
    }
    if (foundW !== null && foundH !== null) {
      const w = Math.round(foundW);
      const h = Math.round(foundH);
      if (w > 0 && h > 0) return { width: w, height: h };
    }
  }

  if (foundW !== null && foundH !== null) {
    const w = Math.round(foundW);
    const h = Math.round(foundH);
    if (w > 0 && h > 0) return { width: w, height: h };
  }
  return null;
}

/**
 * Extract frame dimensions from a Sorenson H.263 FLV video payload.
 *
 * `videoData` is the full VIDEODATA bytes (first byte = FrameType/CodecId).
 * The H.263 bitstream starts at byte 1.
 *
 * Sorenson picture header bit layout (h263-rs decode_sorenson_ptype):
 *   17 bits PSC (0x00001)  +  5 bits version  +  8 bits temporal-ref  +  3 bits psize
 *   psize: 0=custom(8+8), 1=custom(16+16), 2=CIF(352×288), 3=QCIF(176×144),
 *          4=SubQCIF(128×96), 5=320×240, 6=160×120, 7=reserved
 */
function parseH263DimsFromVideoData(
  videoData: Uint8Array,
): { width: number; height: number } | null {
  if (videoData.length < 5) return null;

  // Bit reader over videoData starting at byte 1 (skip FLV FrameType/CodecId byte).
  let bytePos = 1;
  let bitOff = 0;

  function readBits(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (bytePos >= videoData.length) return -1;
      const bit = (videoData[bytePos]! >> (7 - bitOff)) & 1;
      result = (result << 1) | bit;
      if (++bitOff === 8) { bitOff = 0; bytePos++; }
    }
    return result;
  }

  // Scan for PSC: 17-bit pattern == 1 (16 zeros + 1).
  const maxScan = Math.min((videoData.length - 1) * 8, 64);
  let found = false;
  for (let skip = 0; skip <= maxScan; skip++) {
    bytePos = 1 + Math.floor(skip / 8);
    bitOff = skip % 8;
    if (readBits(17) === 1) { found = true; break; }
  }
  if (!found) return null;

  // Skip 5 (version) + 8 (temporal ref) = 13 bits.
  if (readBits(13) < 0) return null;

  const psize = readBits(3);
  if (psize < 0) return null;

  switch (psize) {
    case 0: { const w = readBits(8); const h = readBits(8); return w > 0 && h > 0 ? { width: w, height: h } : null; }
    case 1: { const w = readBits(16); const h = readBits(16); return w > 0 && h > 0 ? { width: w, height: h } : null; }
    case 2: return { width: 352, height: 288 };
    case 3: return { width: 176, height: 144 };
    case 4: return { width: 128, height: 96 };
    case 5: return { width: 320, height: 240 };
    case 6: return { width: 160, height: 120 };
    default: return null;
  }
}

/**
 * Build a FlashDocument from the named streams of a real binary .fla.
 * Returns null when the container holds no recognizable timeline streams
 * (the caller is expected to fall back to a skeleton document).
 */
/**
 * Walk a parsed timeline and capture every CPicSwf record's raw bytes as an
 * opaque blob for lossless re-export. The CPicSwf tail is undecoded ([X] in the
 * format spec) so these records have no rendered display object; capturing the
 * bytes avoids silently dropping them.
 */
function collectSwfBlobs(
  timeline: Fla8Timeline,
  sceneIndex: number | undefined,
  out: FlaSwfBlob[],
): void {
  for (const layer of timeline.layers) {
    for (const frame of layer.frames) {
      for (const el of frame.elements) {
        if (el.type === "swf") {
          out.push({
            bytes: el.rawBytes,
            matrix: {
              a: el.matrix.a, b: el.matrix.b, c: el.matrix.c, d: el.matrix.d,
              tx: el.matrix.tx, ty: el.matrix.ty,
            },
            ...(sceneIndex !== undefined ? { sceneIndex } : {}),
          });
        }
      }
    }
  }
}

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
  // stream. The actual audio data lives in "Media N" streams; we decode those
  // streams below and update each stub with a populated dataUri.
  const soundIdByIndex = new Map<number, string>();
  const items: LibraryItem[] = [];
  // Keep mutable stubs keyed by media index so we can enrich them with audio
  // data when we encounter the corresponding "Media N" stream.
  const soundStubByIndex = new Map<number, import("../model/types.js").SoundItem>();
  for (const [num, info] of contents.sounds) {
    // Forward AS2 linkage metadata decoded from the Contents stream.
    const soundItem = createSound(info.name, {
      ...(info.linkageId ? { linkageIdentifier: info.linkageId } : {}),
      ...(info.exportForActionScript ? { exportForActionScript: true } : {}),
      flaItemId: { order: num },
    });
    soundIdByIndex.set(num, soundItem.id);
    soundStubByIndex.set(num, soundItem);
    // items will be populated after audio streams are decoded below
  }

  // --- library bitmaps + audio + video ----------------------------------------
  // "Media N" streams carry bitmap, audio, and video (FLV) payloads. Process
  // each stream in priority order:
  //   1. Audio (for media indexes listed as sounds in the Contents stream)
  //   2. Video (FLV magic "FLV" = 0x46 0x4C 0x56 at offset 0)
  //   3. Bitmap fallback (JPEG / PNG / lossless)
  // Additionally, pre-CS4 FLAs may store raw audio directly in "Sound N" OLE
  // streams keyed by the same stream number as in the Contents sound table.
  // These are decoded using the same audio-detection logic as "Media N".
  const bitmapIdByIndex = new Map<number, string>();
  const bitmapSizeByIndex = new Map<number, { width: number; height: number }>();
  const videoIdByIndex = new Map<number, string>();
  const videoSizeByIndex = new Map<number, { width: number; height: number }>();
  for (const [name, bytes] of streams) {
    // Resolve stream number: prefer "Media N" first, then "Sound N".
    let mediaNum = streamNumber(MEDIA_RE, name);
    const isSoundStream = mediaNum === null && streamNumber(SOUND_RE, name) !== null;
    if (isSoundStream) mediaNum = streamNumber(SOUND_RE, name);
    if (mediaNum === null) continue;

    const soundStub = soundStubByIndex.get(mediaNum);
    if (soundStub !== undefined) {
      // This stream belongs to a sound library item — attempt audio decode.
      let decoded = null;
      try {
        decoded = decodeMediaAudio(bytes);
      } catch (err) {
        console.warn(`[FLA import] failed to decode audio stream "${name}": ${String(err)}`);
      }
      if (decoded) {
        // Replace stub with an enriched SoundItem carrying the real dataUri.
        soundStubByIndex.set(mediaNum, {
          ...soundStub,
          dataUri: decoded.dataUri,
          compressionType: decoded.compressionType,
        });
      }
      continue; // audio stream — never treat as bitmap or video
    }

    // "Sound N" streams only carry audio — never process as bitmap/video.
    if (isSoundStream) continue;

    // Detect FLV video payload: magic bytes "FLV" (0x46 0x4C 0x56) at offset 0.
    if (bytes.length >= 3 && bytes[0] === 0x46 && bytes[1] === 0x4c && bytes[2] === 0x56) {
      // FLV stream — create a VideoItem. Use the Contents-stream display name if
      // we know it, otherwise fall back to a generic "Video N" label.
      const videoInfo = contents.videos.get(mediaNum);
      const videoName = videoInfo?.name ?? `Video ${mediaNum}`;
      const dataUri = `data:video/x-flv;base64,${bytesToBase64(bytes)}`;
      // Extract actual frame dimensions from the FLV metadata or codec bitstream.
      // Falls back to 320×240 when the bitstream cannot be parsed.
      const extractedDims = extractFlvDims(bytes);
      const width = extractedDims?.width ?? 320;
      const height = extractedDims?.height ?? 240;
      const videoItem = createVideo(videoName, { dataUri, width, height, flaItemId: { order: mediaNum } });
      videoIdByIndex.set(mediaNum, videoItem.id);
      videoSizeByIndex.set(mediaNum, { width, height });
      items.push(videoItem);
      continue; // do not fall through to bitmap decode
    }

    // Non-sound, non-video media stream — try bitmap decode.
    let decoded;
    try {
      decoded = decodeMediaBitmap(bytes);
    } catch (err) {
      console.warn(`[FLA import] failed to decode media stream "${name}": ${String(err)}`);
      continue;
    }
    if (!decoded) continue;
    // Prefer the authored library display name from the CMediaBits catalog;
    // fall back to a generic "Bitmap N" when the record carried no name.
    const bitmapName = contents.bitmaps.get(mediaNum)?.name ?? `Bitmap ${mediaNum}`;
    const bitmapItem = createBitmap(bitmapName, {
      dataUri: decodedBitmapToDataUri(decoded),
      originalWidth: decoded.width,
      originalHeight: decoded.height,
      compressionType: decoded.compressionType,
      flaItemId: { order: mediaNum },
    });
    bitmapIdByIndex.set(mediaNum, bitmapItem.id);
    bitmapSizeByIndex.set(mediaNum, { width: decoded.width, height: decoded.height });
    items.push(bitmapItem);
  }

  // Flush all sound items (stubs or audio-enriched) into the library.
  for (const soundItem of soundStubByIndex.values()) {
    items.push(soundItem);
  }

  // --- library fonts ---------------------------------------------------------
  // Create FontItem entries for each embedded font in the Contents stream.
  // The Contents stream records "Font N" entries with a font family name
  // (e.g. "_sans", "Arial"). We use the family name as both the library
  // display name and the fontName.
  for (const [fontNum, fontInfo] of contents.fonts) {
    const fontItem = createFont(fontInfo.name, fontInfo.fontName, { flaItemId: { order: fontNum } });
    items.push(fontItem);
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

  // Derive library folder structure from symbol full-path metadata.
  // The fullPath field in Fla8SymbolInfo encodes the folder hierarchy as a
  // slash-separated path (e.g. "Assets!/Enemies/Drone"). The last segment is
  // the symbol display name; preceding segments are folder names (with "!"
  // stripped). Symbols at the root have fullPath === "" or no "/".
  const symbolMetaForFolders = new Map<number, { name: string; fullPath: string }>();
  for (const s of symbolStreams) {
    const meta = contents.symbols.get(s.num);
    if (meta) {
      symbolMetaForFolders.set(s.num, { name: meta.name, fullPath: meta.fullPath });
    }
  }
  const { folders, symbolFolderIdByNum } = deriveFoldersFromPaths(symbolMetaForFolders);

  // shells
  const shells = new Map<number, ReturnType<typeof createSymbol>>();
  for (const s of symbolStreams) {
    const meta = contents.symbols.get(s.num);
    const name = meta?.name && meta.name.length > 0 ? meta.name : `Symbol ${s.num}`;
    const symbolType: SymbolType =
      meta?.typeByte != null ? (SYMBOL_TYPES[meta.typeByte] ?? "movieclip") : "movieclip";
    // Populate AS2 linkage from the Contents stream data.
    // className is decoded from the writeAsLinkage block in the Contents stream
    // (s.end + 41 offset, verified against flacomdoc FlaConverter.writeAsLinkage).
    const linkage = createSymbolLinkage({
      linkageIdentifier: meta?.linkageIdentifier ?? "",
      className: meta?.className ?? "",
      exportForActionScript: meta?.exportForActionScript ?? false,
      exportInFirstFrame: meta?.exportInFirstFrame ?? false,
      exportForRuntimeSharing: meta?.exportForRuntimeSharing ?? false,
      importForRuntimeSharing: meta?.importForRuntimeSharing ?? false,
    });
    // Decode scale9Grid from the binary Contents stream, converting
    // { left, top, right, bottom } (twips already converted to px) to
    // the model's { x, y, width, height } format.
    let scale9Grid: Scale9Grid | null = null;
    if (meta?.scale9Grid != null) {
      const sg = meta.scale9Grid;
      scale9Grid = {
        x: sg.left,
        y: sg.top,
        width: sg.right - sg.left,
        height: sg.bottom - sg.top,
      };
    }
    // Assign folderId when this symbol lives inside a library folder.
    const folderId = symbolFolderIdByNum.get(s.num) ?? null;
    const folderOverride = folderId !== null ? { folderId } : {};
    const shell = createSymbol(name, symbolType, { linkage, scale9Grid, ...folderOverride });
    shells.set(s.num, shell);
    symbolIdByIndex.set(s.num, shell.id);
  }
  // Accumulate opaque CPicSwf records (raw bytes) across both symbol and scene
  // timelines so a future re-export can reproduce them verbatim; the format spec
  // marks the CPicSwf tail [X] (undecoded), so these placements have no rendered
  // display representation. Surfaced on the document via `flaSwfBlobs` below.
  const flaSwfBlobs: FlaSwfBlob[] = [];

  // timelines
  for (const s of symbolStreams) {
    const shell = shells.get(s.num)!;
    const parsed = parsedSymbolTimelines.get(s.num);
    if (parsed) collectSwfBlobs(parsed, undefined, flaSwfBlobs);
    const timeline = parsed
      ? convertTimeline(parsed, symbolIdByIndex, soundIdByIndex, bitmapIdByIndex, bitmapSizeByIndex, videoIdByIndex, videoSizeByIndex)
      : shell.timeline;
    // flaItemId.order is the "Symbol N" stream number (creation/storage order).
    items.push({ ...shell, timeline, flaItemId: { order: s.num } });
  }

  // --- scenes -----------------------------------------------------------------
  // Scene PLAY ORDER is the order the CDocumentPage records appear in the
  // Contents stream, NOT the numeric order of their "Page N" OLE2 streams. The
  // "Page N" suffix is creation/storage order (the first scene authored becomes
  // "Page 1" and keeps that stream name even when later dragged to a different
  // position in the Scenes panel). `contents.sceneNames` is a Map populated in
  // Contents byte-scan order, so its key order is the authored scene order.
  // Order pages to match it; any page missing from the map (name extraction
  // failed) is appended afterwards in page-number order as a fallback. See
  // CLAUDE.md "FLA binary layer ordering" learnings — this is the scene-level
  // analogue of that ordering distinction.
  const pageByName = new Map(pages.map((p) => [p.name, p]));
  const orderedPages: typeof pages = [];
  const usedPageNames = new Set<string>();
  for (const streamName of contents.sceneNames.keys()) {
    const p = pageByName.get(streamName);
    if (p && !usedPageNames.has(streamName)) {
      orderedPages.push(p);
      usedPageNames.add(streamName);
    }
  }
  for (const p of pages) {
    if (!usedPageNames.has(p.name)) {
      orderedPages.push(p);
      usedPageNames.add(p.name);
    }
  }

  // Ruler guides are stored per-timeline in the binary (each CPicPage tail),
  // but the model carries a single doc-level guide list. Union the guides read
  // from every scene, de-duplicating by orientation + rounded position so two
  // scenes that share the authored default guides do not double them up.
  const guideAcc: Guide[] = [];
  const guideSeen = new Set<string>();
  const addGuides = (parsed: { guides: { direction: number; valueTwips: number }[] }): void => {
    for (const g of parsed.guides) {
      const orientation: Guide["orientation"] = g.direction === 1 ? "vertical" : "horizontal";
      const position = g.valueTwips / 20;
      const key = `${orientation}:${Math.round(position * 100)}`;
      if (guideSeen.has(key)) continue;
      guideSeen.add(key);
      guideAcc.push({ id: `guide-${orientation}-${guideAcc.length}`, orientation, position });
    }
  };

  const scenes: Scene[] = [];
  for (let i = 0; i < orderedPages.length; i++) {
    const p = orderedPages[i]!;
    const sceneName = contents.sceneNames.get(p.name) ?? `Scene ${i + 1}`;
    let timeline: Timeline;
    try {
      const parsedTimeline = parseFla8Timeline(p.bytes);
      collectSwfBlobs(parsedTimeline, i, flaSwfBlobs);
      addGuides(parsedTimeline);
      timeline = convertTimeline(
        parsedTimeline,
        symbolIdByIndex,
        soundIdByIndex,
        bitmapIdByIndex,
        bitmapSizeByIndex,
        videoIdByIndex,
        videoSizeByIndex,
      );
    } catch (err) {
      console.warn(
        `[FLA import] could not parse page stream "${p.name}": ${String(err)} — importing empty scene`,
      );
      timeline = { layers: [createLayer("Layer 1", "normal")] };
    }
    // flaItemId.order is the "Page N" stream number (creation/storage order),
    // which is distinct from this scene's authored play order (the loop index).
    scenes.push(createScene(sceneName, { timeline, flaItemId: { order: p.num } }));
  }

  // --- button symbol-type promotion -------------------------------------------
  // A symbol placed as a button instance carries instance-level on() handlers
  // (decoded into `buttonHandlers`). In Flash only button (and movieclip)
  // instances accept on() handlers, and an on()-bearing graphic instance is
  // really a button whose Contents-stream type byte was written as graphic
  // (observed in real Flash 8 binaries, e.g. the golden fixture's PlayButton).
  // Promote any such symbol to symbolType: "button" so the SWF compiler emits a
  // DefineButton2 for it rather than a DefineSprite. This is the import-side
  // counterpart to the compiler's inline-DefineButton2 path.
  const buttonInstanceSymbolIds = new Set<string>();
  {
    const allTimelines: Timeline[] = [
      ...scenes.map((sc) => sc.timeline),
      ...items
        .filter((it): it is Extract<LibraryItem, { itemType: "symbol" }> => it.itemType === "symbol")
        .map((it) => it.timeline),
    ];
    for (const timeline of allTimelines) {
      for (const layer of timeline.layers) {
        for (const frame of layer.frames) {
          for (const obj of frame.displayObjects) {
            if (
              obj.type === "instance" &&
              obj.buttonHandlers &&
              obj.buttonHandlers.length > 0
            ) {
              buttonInstanceSymbolIds.add(obj.symbolId);
            }
          }
        }
      }
    }
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (
      it.itemType === "symbol" &&
      it.symbolType !== "button" &&
      buttonInstanceSymbolIds.has(it.id)
    ) {
      items[i] = { ...it, symbolType: "button" };
    }
  }

  // --- document properties -----------------------------------------------------
  // Grid settings + ruler units come from the §8.4 stage block; guides are the
  // union collected above. Fall back to the model defaults when a field could
  // not be decoded.
  const gridOverrides: { -readonly [K in keyof GridSettings]?: GridSettings[K] } = {};
  if (contents.gridVisible !== null) gridOverrides.showGrid = contents.gridVisible;
  if (contents.gridSpacingPx !== null && contents.gridSpacingPx > 0) {
    gridOverrides.gridWidth = contents.gridSpacingPx;
    gridOverrides.gridHeight = contents.gridSpacingPx;
  }
  if (contents.gridColor !== null) gridOverrides.gridColor = toHex(contents.gridColor);
  const grid = createGridSettings(gridOverrides);

  const rulerUnits: RulerUnits =
    contents.rulerUnitType !== null
      ? (RULER_UNIT_TYPES[contents.rulerUnitType] ?? "px")
      : "px";

  const properties = createDocumentProperties({
    width: contents.width ?? 550,
    height: contents.height ?? 400,
    frameRate: contents.frameRate ?? 12,
    backgroundColor: contents.backgroundColor ? toHex(contents.backgroundColor) : "#ffffff",
    rulerUnits,
    grid,
    guides: guideAcc,
  });

  return createDocument({
    properties,
    scenes,
    library: { items, folders },
    ...(flaSwfBlobs.length > 0 ? { flaSwfBlobs } : {}),
  });
}

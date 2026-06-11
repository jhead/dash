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
import { createDocument, createDocumentProperties } from "../model/document.js";
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
  };
}

// ---------------------------------------------------------------------------
// Shape conversion: edge list -> ShapePath contours
// ---------------------------------------------------------------------------

const EPS = 1e-6;

function convertShape(el: Fla8Shape, bitmapIdByIndex: Map<number, string>): DisplayObject {
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
    return toFill(el.fills[idx - 1]!, bitmapIdByIndex);
  };
  const resolveStroke = (line: number): Stroke | undefined => {
    if (line <= 0 || line > el.strokes.length) return undefined;
    return strokeFromFla8(el.strokes[line - 1]!);
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
      // CPicSwf places an external SWF asset imported via File > Import.
      // The binary parser extracts only the fixed header (placement matrix);
      // the variable-length tail (instance name, AS2 clip-event scripts, source
      // SWF filename, color transforms) is skipped by skipToNextBoundary() and
      // is not decoded.  There is no library-symbol linkage id in the decoded
      // record, so there is no existing model type to map this to — mapping to
      // SymbolInstance would require a symbolId, and VideoDisplayObject requires
      // a videoItemId.  A new dedicated model type would be needed for full
      // support.  For now, emit a descriptive warning and drop the element.
      const { scaleX, scaleY, rotation } = decompose(el.matrix);
      console.warn(
        `[FLA import] CPicSwf skipped — embedded SWF display objects are not yet supported. ` +
          `Placement: x=${el.matrix.tx.toFixed(0)}, y=${el.matrix.ty.toFixed(0)}, ` +
          `scaleX=${scaleX.toFixed(3)}, scaleY=${scaleY.toFixed(3)}, ` +
          `rotation=${rotation.toFixed(1)}°. ` +
          `The source SWF filename and instance name are in the undecoded variable tail.`,
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
    ...(textColorEffect ? { colorEffect: textColorEffect } : {}),
    ...(textFilters.length > 0 ? { filters: textFilters } : {}),
    ...(isMultiRun ? { html: true, htmlText } : {}),
    ...(singleRunCharPos ? { characterPosition: singleRunCharPos } : {}),
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
    // keyMode bits (flacomdoc): 0x4001-based = classic/motion tween,
    // 0x..02 = shape tween.
    const tweenType =
      (f.keyMode & 0x4000) !== 0 && (f.keyMode & 0x0001) !== 0
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
  return createLayer(l.name || `Layer ${index + 1}`, LAYER_TYPES[l.layerType] ?? "normal", {
    visible: !l.hidden,
    locked: l.locked,
    outlineMode: l.outlineMode,
    outlineColor: l.outlineColor ? toHex(l.outlineColor) : "#0000ff",
    frames: frames.length > 0 ? frames : [createFrame(0)],
    frameCount,
  });
}

/**
 * Resolve mask→masked hierarchy in the binary layer list (bottom-to-top order).
 *
 * In the Flash 8 binary format, layers that are masked children of a mask layer
 * have `layerType=0` (normal) but carry a non-zero `parentLayerRef` in their
 * CPicLayer trailer — a CArchive object-reference pointing to the mask parent.
 *
 * This function scans the binary (bottom-to-top) layer array: after finding a
 * mask layer (type=4), consecutive layers with the same non-zero parentLayerRef
 * are promoted to layerType=5 (masked).
 *
 * The mask group ends when a layer has parentLayerRef=0 (no parent / different
 * group) or a different parentLayerRef value (belongs to a nested/different mask).
 */
function resolveMaskedLayers(binaryLayers: readonly Fla8Layer[]): Fla8Layer[] {
  const result: Fla8Layer[] = [...binaryLayers];
  // Whether we are currently tracking a mask group (just passed a type=4 layer)
  let inMaskGroup = false;
  // The parentLayerRef value shared by all children of the current mask
  let maskRef = 0;

  for (let i = 0; i < result.length; i++) {
    const layer = result[i]!;
    if (layer.layerType === 4) {
      // Just encountered a mask layer — activate tracking for its children.
      inMaskGroup = true;
      maskRef = 0; // will be set from the first child's parentLayerRef
    } else if (inMaskGroup && layer.parentLayerRef !== 0) {
      // Inside a mask group: this layer has a parent reference.
      if (maskRef === 0) {
        // First child: record the shared parentLayerRef for this mask group.
        maskRef = layer.parentLayerRef;
      }
      if (layer.parentLayerRef === maskRef && layer.layerType === 0) {
        // Promote to masked type.
        result[i] = { ...layer, layerType: 5 };
      } else if (layer.parentLayerRef !== maskRef) {
        // Different parent ref → exit this mask group.
        inMaskGroup = false;
        maskRef = 0;
      }
    } else {
      // parentLayerRef=0 or not in a mask group → exit mask group tracking.
      inMaskGroup = false;
      maskRef = 0;
    }
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
  // at LOWER li indices than their owning mask layer.  Fix: collect any run of
  // 'masked' layers immediately preceding a 'mask' layer and re-insert them right
  // after the mask so the group becomes [mask, …masked].
  const reordered: Layer[] = [];
  let i = 0;
  while (i < layers.length) {
    const layer = layers[i]!;
    if (layer.type === "mask") {
      const hasConsecutiveMaskedAfter =
        i + 1 < layers.length && layers[i + 1]!.type === "masked";
      if (hasConsecutiveMaskedAfter) {
        reordered.push(layer);
        i++;
      } else {
        const maskedBefore: Layer[] = [];
        while (reordered.length > 0 && reordered[reordered.length - 1]!.type === "masked") {
          maskedBefore.unshift(reordered.pop()!);
        }
        reordered.push(layer, ...maskedBefore);
        i++;
      }
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
      const videoItem = createVideo(videoName, { dataUri, width, height });
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

  // Flush all sound items (stubs or audio-enriched) into the library.
  for (const soundItem of soundStubByIndex.values()) {
    items.push(soundItem);
  }

  // --- library fonts ---------------------------------------------------------
  // Create FontItem entries for each embedded font in the Contents stream.
  // The Contents stream records "Font N" entries with a font family name
  // (e.g. "_sans", "Arial"). We use the family name as both the library
  // display name and the fontName.
  for (const [, fontInfo] of contents.fonts) {
    const fontItem = createFont(fontInfo.name, fontInfo.fontName);
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
  // timelines
  for (const s of symbolStreams) {
    const shell = shells.get(s.num)!;
    const parsed = parsedSymbolTimelines.get(s.num);
    const timeline = parsed
      ? convertTimeline(parsed, symbolIdByIndex, soundIdByIndex, bitmapIdByIndex, bitmapSizeByIndex, videoIdByIndex, videoSizeByIndex)
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
        videoIdByIndex,
        videoSizeByIndex,
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
    library: { items, folders },
  });
}

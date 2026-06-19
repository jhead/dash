/**
 * Placed v2-component synthesis pass.
 *
 * Flash 8 ships the v2 component architecture (`mx.controls.*` / `mx.containers.*`):
 * authoring-time UI controls backed by AS2 classes. A `ComponentItem` placed on
 * the stage produces a `SymbolInstance` whose `symbolId` points at the
 * ComponentItem's id (see `engine/libraryplace.ts`). The library-symbol pass only
 * handles `itemType === "symbol"`, so a placed component never received a SWF
 * character id and was SILENTLY DROPPED from the published movie.
 *
 * PART 1 (task 1229) closed the plumbing gap: each placed component emitted an
 * (empty) DefineSprite + ExportAssets(class name) + a DoInitAction calling
 * `Object.registerClass`. The component registered but rendered as nothing.
 *
 * PART 2.1 (task 1231) makes ONE component genuinely render + react in Ruffle
 * using AS2 WE author — NOT Adobe's real `mx.*` framework, and with NO Halo skin
 * asset. For each placed component we now emit:
 *
 *   1. A self-authored AS2 class compiled via `compileAS2()` (from @flash/core),
 *      wrapped in a DoInitAction. The class lives at the component's fully-qualified
 *      dotted global path (e.g. `_global.mx.controls.Button`) so the existing
 *      registerClass DoInitAction's `ActionGetVariable "mx.controls.Button"`
 *      resolves to it. This DoInitAction is ordered BEFORE the registerClass one so
 *      the constructor exists when registerClass binds it to the exported sprite.
 *
 *   2. A REAL skin DefineSprite: a DefineShape4 rounded-rect face (component default
 *      size) plus a named DefineEditText `label_txt` placed on the sprite timeline.
 *      The shape + edit-text are hoisted to top level (definition tags may not live
 *      inside a sprite) and placed via PlaceObject2 inside the sprite body.
 *
 *   3. The author's label text statically seeded into the EditText at compile time.
 *      The class `setLabel()` / `setText()` methods also update `label_txt.text` at
 *      runtime.
 *
 *   4. The ExportAssets entry + registerClass DoInitAction from Part 1 (unchanged).
 *
 * PART 2.2 (task 1232) delivers the author's full `componentParameters` to the LIVE
 * runtime instance, GENERICALLY (not hardcoded to Button.label). The skin sprite now
 * carries a class method `setComponentParam(name, value)`; for each placed component
 * instance the frame loop (compiler/frames.ts) emits a per-instance DoAction that,
 * for every parameter the author changed from its catalog default, calls
 * `_root.<instanceName>.setComponentParam(name, value)`. Values are typed from the
 * component catalog (packages/core/src/model/components.ts): number/boolean literals
 * vs quoted strings. This generalizes over the whole catalog parameter set, so future
 * controls (CheckBox/List/...) get author params for free. See
 * `buildComponentParamScript()` below.
 *
 * PART 2.3 (task 1233) extends the SAME infra to two more form controls —
 * `mx.controls.CheckBox` and `mx.controls.RadioButton` — and GENERALIZES the
 * class/skin emission so adding a control is registry-driven (see `CONTROL_REGISTRY`).
 * Each control is described by a `ControlSpec`:
 *   - `kind`              — discriminant resolved from the class name.
 *   - `buildMarks(...)`   — the NAMED OVERLAY MARKS (e.g. a check tick / radio dot)
 *                          drawn as extra named children so the class can toggle their
 *                          `_visible` when `selected` changes.
 *   - `authorClassBody(fqn,labelLit)` — the control-specific AS2 method bodies appended
 *                          to the shared base class (constructor seeds + setComponentParam
 *                          + label mirroring are shared).
 * CheckBox toggles a boolean `selected` on release (reflecting it into the `check_mk`
 * mark's visibility) and honours the author's `selected`/`label`. RadioButton adds
 * `groupName` mutual-exclusivity: selecting one deselects its group siblings via a
 * `_root.__radioGroups` registry, and carries `data`/`value`.
 *
 * EXPLICITLY OUT OF SCOPE (later waves): the full `mx.controls.*` AS2 framework,
 * Halo skins, and the niche long tail (List / ComboBox / DataGrid / Tree / containers).
 */
import type {
  Color,
  ComponentDef,
  ComponentItem,
  ComponentLinkage,
  ComponentParamDef,
  DisplayObject,
  FlashDocument,
  PathSegment,
  Shape,
  SymbolInstance,
  TextDisplayObject,
} from "@flash/core";
import { compileAS2, getComponentDef } from "@flash/core";
import { BitWriter } from "../bits.js";
import { Tag } from "../tags.js";
import { SwfWriter } from "../writer.js";
import { encodeDoInitAction, encodeRawDoInitAction } from "../doInitAction.js";
import { encodeDefineShape4, encodePlaceObject2, encodePlaceObject2WithName } from "../shapes.js";
import { encodeDefineEditText } from "../text.js";
import { flattenDisplayObjects } from "./display.js";

/** Inputs the component-synthesis pass needs. */
export interface ComponentPassInput {
  writer: SwfWriter;
  doc: FlashDocument;
  /** Shared symbolId → charId map; the synthetic sprite ids are added here. */
  charIdMap: Map<string, number>;
}

/**
 * Linkage entries collected during component synthesis. The orchestrator appends
 * these to the symbol-pass results so they are emitted by the existing first-frame
 * ExportAssets / DoInitAction machinery (see `compiler/frames.ts`).
 */
export interface ComponentPassResult {
  exportEntries: { charId: number; name: string }[];
  /**
   * DoInitAction bodies, emitted by the orchestrator IN ARRAY ORDER. The class
   * definition body is pushed BEFORE the registerClass body so the constructor
   * exists when registerClass resolves the class name.
   */
  doInitActionBodies: Uint8Array[];
}

// ---------------------------------------------------------------------------
// Default component skin geometry / label
// ---------------------------------------------------------------------------

/** Flash 8 Button component's default placed size (px). */
const DEFAULT_BUTTON_WIDTH = 100;
const DEFAULT_BUTTON_HEIGHT = 22;

/** Face fill (light grey) + border (medium grey) for the self-authored skin. */
const FACE_COLOR: Color = { r: 0xe6, g: 0xe6, b: 0xe6, a: 0xff };
const BORDER_COLOR: Color = { r: 0x66, g: 0x66, b: 0x66, a: 0xff };
const LABEL_COLOR: Color = { r: 0x00, g: 0x00, b: 0x00, a: 0xff };

/** Indicator box/circle fill (white) + the tick/dot mark colour (dark) for toggles. */
const BOX_FILL_COLOR: Color = { r: 0xff, g: 0xff, b: 0xff, a: 0xff };
const MARK_COLOR: Color = { r: 0x00, g: 0x33, b: 0x99, a: 0xff };

/** Corner radius (px) of the rounded-rect face. */
const CORNER_RADIUS = 6;

/** Side length (px) of a CheckBox/RadioButton indicator box, left-aligned and centered vertically. */
const INDICATOR_SIZE = 13;
/** Left inset (px) of the indicator box. */
const INDICATOR_INSET = 1;

/**
 * Fully-qualified AS2 class name for a component, e.g. `mx.controls.Button`.
 * An explicit `linkage.className` overrides the derived form.
 */
export function componentClassName(item: ComponentItem): string {
  if (item.linkage?.className) return item.linkage.className;
  const pkg = item.packageName?.trim();
  const cls = item.componentName?.trim() || item.name;
  return pkg ? `${pkg}.${cls}` : cls;
}

/** ExportAssets linkage identifier for a component (defaults to the class name). */
export function componentLinkageIdentifier(item: ComponentItem): string {
  return item.linkage?.linkageIdentifier || componentClassName(item);
}

/** Resolve the built-in catalog definition for a placed component (by class/display name). */
export function componentDefFor(item: ComponentItem): ComponentDef | undefined {
  return (
    getComponentDef(item.componentName?.trim() || "") ??
    getComponentDef(item.name?.trim() || "")
  );
}

/**
 * The label text statically seeded into the skin's EditText. Prefers the catalog's
 * default `label`/`text` param (e.g. "CheckBox", "Radio Button") so the seeded text
 * matches Flash's default, falling back to the item/class name.
 */
export function componentLabel(item: ComponentItem): string {
  const def = componentDefFor(item);
  if (def) {
    const labelParam = def.parameters.find((p) => p.name === "label" || p.name === "text");
    if (labelParam && labelParam.defaultValue) return labelParam.defaultValue;
  }
  const cls = item.componentName?.trim() || item.name;
  return cls || "Button";
}

// ---------------------------------------------------------------------------
// Control registry (task 1233, Part 2.3)
// ---------------------------------------------------------------------------

/**
 * Which built-in control a placed component is. Resolved from the class name's
 * trailing identifier so an explicit dotted `linkage.className` still classifies.
 * Everything that is not a recognised toggle control falls back to `"button"`
 * (the Part-2.1 behaviour), so existing controls + the long tail are unaffected.
 */
export type ControlKind = "button" | "checkbox" | "radiobutton";

/** Resolve a control's kind from its (possibly dotted) class name. */
export function controlKindFor(className: string): ControlKind {
  const leaf = className.split(".").pop() || className;
  if (leaf === "CheckBox") return "checkbox";
  if (leaf === "RadioButton") return "radiobutton";
  return "button";
}

/**
 * A named overlay mark (besides the face + label) placed as an extra named child in
 * the skin sprite so the AS2 class can toggle its `_visible`. e.g. the check tick or
 * the radio dot. Each carries its own DefineShape4 geometry (hoisted top-level).
 */
interface SkinMark {
  /** PlaceObject2 instance name (resolvable as `this.<name>` from the class). */
  readonly name: string;
  /** The mark geometry (origin-relative; placed at depth>face). */
  readonly shape: Shape;
}

/** Per-control description driving skin + class emission (replaces per-control if-chains). */
interface ControlSpec {
  /** Named overlay marks (check tick / radio dot). Empty for a plain Button. */
  buildMarks(width: number, height: number): SkinMark[];
  /**
   * Control-specific AS2 method/handler bodies appended to the shared base class.
   * `fqn` is the fully-qualified `_global.<class>` path; `labelLit` the seeded label.
   * The shared base already defines the constructor, setLabel/getLabel, setText,
   * setComponentParam (label/text mirroring), onLoad, onRollOver/Out. A control adds
   * its selection state + click handler here.
   */
  authorClassBody(fqn: string, labelLit: string): string;
}

// ---------------------------------------------------------------------------
// Live parameter delivery (task 1232, Part 2.2)
// ---------------------------------------------------------------------------

/**
 * Render one parameter value as an AS2 literal, typed from the catalog definition:
 *   - number  → bare numeric literal (NaN-guarded; falls back to a quoted string)
 *   - boolean → `true` / `false`
 *   - string / list / array → a quoted, escaped string literal
 *
 * `array` parameters (ComboBox/List data & labels, DateChooser dayNames) are stored
 * as a comma-joined string in the model; we deliver them verbatim as a string and
 * leave parsing to the (future) control implementation — the generic mechanism only
 * guarantees the AUTHOR'S value reaches `_root.<name>.<param>`.
 */
function paramValueLiteral(value: string, type: ComponentParamDef["type"]): string {
  if (type === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : JSON.stringify(value);
  }
  if (type === "boolean") {
    return value === "true" ? "true" : "false";
  }
  // string | list | array → quoted/escaped literal.
  return JSON.stringify(value);
}

/**
 * Build the AS2 source that delivers a placed instance's authored
 * `componentParameters` onto the live (registerClass-bound) runtime instance at
 * `_root.<instanceName>`. GENERIC over the catalog's parameter set — every
 * parameter the author changed from its catalog default is assigned via the
 * class's `setComponentParam(name, value)` shim (which also mirrors label/text
 * into the skin's `label_txt`). Returns "" when there is nothing to deliver
 * (no catalog def, no params, or all params at their default).
 *
 * Only NON-DEFAULT params are emitted: the constructor already seeds defaults
 * (and label/text are statically pre-seeded into the EditText), so re-asserting
 * a default would be wasted bytecode. Targeting via `_root.<name>` requires the
 * placement to carry the instance name (the frame loop guarantees this for placed
 * components — see compiler/frames.ts).
 */
export function buildComponentParamScript(
  item: ComponentItem,
  componentParameters: Record<string, string> | undefined,
  instanceName: string,
): string {
  if (!componentParameters || !instanceName) return "";
  const def = componentDefFor(item);
  if (!def) return "";

  const lines: string[] = [];
  // Iterate the CATALOG parameter order (deterministic output), not the model map.
  for (const p of def.parameters) {
    const authored = componentParameters[p.name];
    if (authored === undefined) continue;
    if (authored === p.defaultValue) continue; // unchanged — constructor already seeded it
    const literal = paramValueLiteral(authored, p.type);
    lines.push(`_root.${instanceName}.setComponentParam(${JSON.stringify(p.name)}, ${literal});`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// AS2 class authoring
// ---------------------------------------------------------------------------

/**
 * The SHARED base-class AS2 source common to every control: constructor (label
 * seed + mirror), setLabel/getLabel, setText, the generic setComponentParam shim
 * (label/text mirroring + a `selected` reflection hook), onLoad, and roll hover.
 *
 * `setComponentParam` here also forwards a `selected` param to `this.setSelected`
 * when the subclass defines one — so the generic Part-2.2 param delivery
 * (`_root.<name>.setComponentParam("selected", true)`) drives the toggle controls
 * without any control-specific param plumbing in frames.ts.
 */
function authorBaseClassBody(fqn: string, labelLit: string): string {
  return `
${fqn} = function() {
  this.label = ${labelLit};
  if (this.label_txt != undefined) {
    this.label_txt.text = this.label;
  }
  if (this.__init != undefined) { this.__init(); }
};
${fqn}.prototype.setLabel = function(s) {
  this.label = s;
  if (this.label_txt != undefined) {
    this.label_txt.text = s;
  }
};
${fqn}.prototype.getLabel = function() {
  return this.label;
};
${fqn}.prototype.setText = function(s) {
  this.text = s;
  if (this.label_txt != undefined) {
    this.label_txt.text = s;
  }
};
${fqn}.prototype.setComponentParam = function(name, value) {
  if (name == "selected" && this.setSelected != undefined) {
    this.setSelected(value);
    return;
  }
  this[name] = value;
  if ((name == "label" || name == "text") && this.label_txt != undefined) {
    this.label_txt.text = value;
  }
};
${fqn}.prototype.onLoad = function() {
  if (this.label_txt != undefined) {
    this.label_txt.text = this.label;
  }
  if (this.__refresh != undefined) { this.__refresh(); }
};
${fqn}.prototype.onRollOver = function() {
  this._alpha = 70;
};
${fqn}.prototype.onRollOut = function() {
  this._alpha = 100;
};
${fqn}.prototype.__inBounds = function() {
  // Manual point-in-bbox test in PARENT (_root) coords. We do NOT use
  // MovieClip.hitTest: the bundled Ruffle build returns false for a registerClass'd
  // movieclip's bbox/shape hitTest, so we compare the parent-space mouse position to
  // the clip's own _x/_y/_width/_height (all in parent space). This is the reliable
  // headless click path; broadcast onMouseDown delivers the event to every clip.
  var mx = this._parent._xmouse;
  var my = this._parent._ymouse;
  return (mx >= this._x && mx <= this._x + this._width && my >= this._y && my <= this._y + this._height);
};
${fqn}.prototype.onMouseDown = function() {
  // Broadcast mouse handler (Ruffle dispatches onMouseDown to EVERY movieclip that
  // defines it). Gate on the manual bbox test so only a press ON THIS control toggles
  // it. (Real Flash would use the button-mode onPress; this manual path matches it and
  // also fires in headless Ruffle.)
  if (this.__inBounds()) {
    this.__handleClick();
  }
};
`;
}

/** Button's runtime click handler (Part 2.1 behaviour, unchanged trace). */
function authorButtonClassBody(fqn: string, _labelLit: string): string {
  return `
${fqn}.prototype.__handleClick = function() {
  this._alpha = 100;
  trace("[component] " + this.label + " released");
};
`;
}

/**
 * CheckBox: a boolean `selected` that toggles on each click. `setSelected` reflects
 * the value into both `this.selected` and the named `check_mk` tick child's
 * `_visible` (the observable pixel change for the Ruffle oracle). `__init`/`__refresh`
 * seed the initial (deselected) visual.
 */
function authorCheckBoxClassBody(fqn: string, _labelLit: string): string {
  return `
${fqn}.prototype.__init = function() {
  this.selected = false;
};
${fqn}.prototype.setSelected = function(v) {
  this.selected = (v == true);
  this.__refresh();
};
${fqn}.prototype.getSelected = function() {
  return this.selected;
};
${fqn}.prototype.__refresh = function() {
  if (this.check_mk != undefined) {
    this.check_mk._visible = this.selected;
  }
};
${fqn}.prototype.__handleClick = function() {
  this.setSelected(!this.selected);
  trace("[component] " + this.label + " selected=" + this.selected);
};
`;
}

/**
 * RadioButton: like CheckBox but selection is MUTUALLY EXCLUSIVE within a
 * `groupName`. A `_root.__radioGroups` registry maps groupName → the currently
 * selected member; selecting one deselects the prior member of its group. Carries
 * `data`/`value`. Clicking an already-selected radio keeps it selected (Flash
 * behaviour — a radio cannot toggle itself off by clicking).
 */
function authorRadioButtonClassBody(fqn: string, _labelLit: string): string {
  return `
${fqn}.prototype.__init = function() {
  this.selected = false;
  if (this.groupName == undefined) { this.groupName = "radioGroup"; }
};
${fqn}.prototype.setSelected = function(v) {
  if (v == true) {
    this.__selectInGroup();
  } else {
    this.selected = false;
    this.__refresh();
  }
};
${fqn}.prototype.getSelected = function() {
  return this.selected;
};
${fqn}.prototype.getValue = function() {
  if (this.value != undefined) { return this.value; }
  return this.data;
};
${fqn}.prototype.__refresh = function() {
  if (this.dot_mk != undefined) {
    this.dot_mk._visible = this.selected;
  }
};
${fqn}.prototype.__selectInGroup = function() {
  if (_root.__radioGroups == undefined) { _root.__radioGroups = {}; }
  var prev = _root.__radioGroups[this.groupName];
  if (prev != undefined && prev != this) {
    prev.selected = false;
    prev.__refresh();
  }
  _root.__radioGroups[this.groupName] = this;
  this.selected = true;
  this.__refresh();
};
${fqn}.prototype.__handleClick = function() {
  this.__selectInGroup();
  trace("[component] radio " + this.label + " group=" + this.groupName + " selected");
};
`;
}

const CONTROL_REGISTRY: Record<ControlKind, ControlSpec> = {
  button: {
    buildMarks: () => [],
    authorClassBody: authorButtonClassBody,
  },
  checkbox: {
    buildMarks: (w, h) => [{ name: "check_mk", shape: buildCheckMarkShape(w, h) }],
    authorClassBody: authorCheckBoxClassBody,
  },
  radiobutton: {
    buildMarks: (w, h) => [{ name: "dot_mk", shape: buildRadioDotShape(w, h) }],
    authorClassBody: authorRadioButtonClassBody,
  },
};

/**
 * Author a FLAT, self-contained AS2 class for a placed component and return the
 * compiled AVM1 bytecode (via @flash/core's `compileAS2`).
 *
 * The class is authored as plain dotted-global assignments rather than `class`
 * syntax. The AS2 compiler's `compileClassDecl` only supports a single-identifier
 * class name (it emits `Name = function ...` via ActionSetVariable), but a
 * component's class name is dotted (`mx.controls.Button`). Authoring it as
 * `_global.mx.controls.Button = function(){...}` lets the existing registerClass
 * DoInitAction (`ActionGetVariable "mx.controls.Button"`) resolve the constructor:
 * AVM1's GetVariable walks the dotted path and falls back to `_global`.
 *
 * Shared base methods (constructor/label/setComponentParam/onLoad/hover) are emitted
 * for EVERY control; the registry-selected `authorClassBody` appends the control's
 * selection state + click handler (toggle for CheckBox, group-exclusive for
 * RadioButton, trace-only for Button).
 */
export function authorComponentClassBytecode(className: string, label: string): Uint8Array {
  // Build the namespace guards + the fully-qualified global path. e.g.
  // mx.controls.Button → ensure _global.mx and _global.mx.controls exist first.
  const parts = className.split(".");
  const guards: string[] = [];
  let path = "_global";
  for (let i = 0; i < parts.length - 1; i++) {
    path += "." + parts[i];
    guards.push(`if (${path} == undefined) { ${path} = {}; }`);
  }
  const fqn = "_global." + className;
  // JSON.stringify gives a correctly quoted/escaped AS2 string literal.
  const labelLit = JSON.stringify(label);

  const spec = CONTROL_REGISTRY[controlKindFor(className)];
  const src =
    "\n" +
    guards.join("\n") +
    "\n" +
    authorBaseClassBody(fqn, labelLit) +
    spec.authorClassBody(fqn, labelLit) +
    "\n";
  return compileAS2(src);
}

// ---------------------------------------------------------------------------
// Skin geometry
// ---------------------------------------------------------------------------

/**
 * Build a rounded-rectangle filled+stroked Shape for the component face, sized to
 * (width, height) in pixels with origin at (0,0).
 */
function buildButtonFaceShape(width: number, height: number): Shape {
  const r = Math.min(CORNER_RADIUS, width / 2, height / 2);
  const x0 = 0;
  const y0 = 0;
  const x1 = width;
  const y1 = height;

  // Quadratic-corner rounded rect, clockwise from the top-left tangent point.
  const segments: PathSegment[] = [
    // top edge → top-right corner
    { type: "line", to: { x: x1 - r, y: y0 } },
    { type: "curve", control: { x: x1, y: y0 }, to: { x: x1, y: y0 + r } },
    // right edge → bottom-right corner
    { type: "line", to: { x: x1, y: y1 - r } },
    { type: "curve", control: { x: x1, y: y1 }, to: { x: x1 - r, y: y1 } },
    // bottom edge → bottom-left corner
    { type: "line", to: { x: x0 + r, y: y1 } },
    { type: "curve", control: { x: x0, y: y1 }, to: { x: x0, y: y1 - r } },
    // left edge → top-left corner
    { type: "line", to: { x: x0, y: y0 + r } },
    { type: "curve", control: { x: x0, y: y0 }, to: { x: x0 + r, y: y0 } },
  ];

  return {
    id: "component-face",
    paths: [
      {
        start: { x: x0 + r, y: y0 },
        segments,
        closed: true,
        fill: { type: "solid", color: FACE_COLOR },
        stroke: {
          type: "solid",
          color: BORDER_COLOR,
          width: 1,
          caps: "round",
          joints: "round",
          miterLimit: 3,
        },
      },
    ],
  };
}

/** Geometry of a toggle control's left indicator (box for CheckBox, circle for RadioButton). */
function indicatorBox(height: number): { x0: number; y0: number; size: number } {
  const size = Math.min(INDICATOR_SIZE, height - 2);
  return { x0: INDICATOR_INSET, y0: (height - size) / 2, size };
}

/**
 * CheckBox / RadioButton face: a small left indicator (a square outline box for the
 * CheckBox, a circle for the RadioButton) — the clickable visual that the tick/dot
 * mark overlays. Origin (0,0); the label EditText is placed to its right.
 */
function buildToggleFaceShape(kind: "checkbox" | "radiobutton", _width: number, height: number): Shape {
  const { x0, y0, size } = indicatorBox(height);
  const stroke = {
    type: "solid" as const,
    color: BORDER_COLOR,
    width: 1,
    caps: "round" as const,
    joints: "round" as const,
    miterLimit: 3,
  };

  if (kind === "radiobutton") {
    // A circle approximated by 4 quadratic arcs (radius = size/2).
    const cx = x0 + size / 2;
    const cy = y0 + size / 2;
    const r = size / 2;
    const k = r; // quadratic control offset for a near-circular arc
    return {
      id: "component-face",
      paths: [
        {
          start: { x: cx + r, y: cy },
          segments: [
            { type: "curve", control: { x: cx + k, y: cy + k }, to: { x: cx, y: cy + r } },
            { type: "curve", control: { x: cx - k, y: cy + k }, to: { x: cx - r, y: cy } },
            { type: "curve", control: { x: cx - k, y: cy - k }, to: { x: cx, y: cy - r } },
            { type: "curve", control: { x: cx + k, y: cy - k }, to: { x: cx + r, y: cy } },
          ],
          closed: true,
          fill: { type: "solid", color: BOX_FILL_COLOR },
          stroke,
        },
      ],
    };
  }

  // CheckBox: a square outline box.
  const x1 = x0 + size;
  const y1 = y0 + size;
  return {
    id: "component-face",
    paths: [
      {
        start: { x: x0, y: y0 },
        segments: [
          { type: "line", to: { x: x1, y: y0 } },
          { type: "line", to: { x: x1, y: y1 } },
          { type: "line", to: { x: x0, y: y1 } },
          { type: "line", to: { x: x0, y: y0 } },
        ],
        closed: true,
        fill: { type: "solid", color: BOX_FILL_COLOR },
        stroke,
      },
    ],
  };
}

/** Resolve the face Shape for a control kind. */
function buildFaceShape(kind: ControlKind, width: number, height: number): Shape {
  if (kind === "checkbox" || kind === "radiobutton") return buildToggleFaceShape(kind, width, height);
  return buildButtonFaceShape(width, height);
}

/** The check tick (a filled ✓ chevron) drawn inside the CheckBox indicator box. */
function buildCheckMarkShape(_width: number, height: number): Shape {
  const { x0, y0, size } = indicatorBox(height);
  // A bold tick: down-stroke to the elbow, up-stroke to the top-right, traced as a
  // filled quad outline so it survives Ruffle's tessellator (no thin 1px fills).
  const lx = x0 + size * 0.22; // left arm start
  const ly = y0 + size * 0.52;
  const mx = x0 + size * 0.42; // elbow
  const my = y0 + size * 0.74;
  const rx = x0 + size * 0.82; // top-right tip
  const ry = y0 + size * 0.2;
  const t = Math.max(1.6, size * 0.16); // stroke thickness baked into the fill
  return {
    id: "check-mark",
    paths: [
      {
        start: { x: lx, y: ly },
        segments: [
          { type: "line", to: { x: mx, y: my } },
          { type: "line", to: { x: rx, y: ry } },
          { type: "line", to: { x: rx - t * 0.7, y: ry - t * 0.7 } },
          { type: "line", to: { x: mx, y: my - t } },
          { type: "line", to: { x: lx + t * 0.7, y: ly - t * 0.7 } },
          { type: "line", to: { x: lx, y: ly } },
        ],
        closed: true,
        fill: { type: "solid", color: MARK_COLOR },
      },
    ],
  };
}

/** The radio dot (a filled circle) drawn inside the RadioButton indicator circle. */
function buildRadioDotShape(_width: number, height: number): Shape {
  const { x0, y0, size } = indicatorBox(height);
  const cx = x0 + size / 2;
  const cy = y0 + size / 2;
  const r = size * 0.28;
  const k = r;
  return {
    id: "radio-dot",
    paths: [
      {
        start: { x: cx + r, y: cy },
        segments: [
          { type: "curve", control: { x: cx + k, y: cy + k }, to: { x: cx, y: cy + r } },
          { type: "curve", control: { x: cx - k, y: cy + k }, to: { x: cx - r, y: cy } },
          { type: "curve", control: { x: cx - k, y: cy - k }, to: { x: cx, y: cy - r } },
          { type: "curve", control: { x: cx + k, y: cy - k }, to: { x: cx + r, y: cy } },
        ],
        closed: true,
        fill: { type: "solid", color: MARK_COLOR },
      },
    ],
  };
}

/**
 * Build a dynamic-text TextDisplayObject for the component label. It is given the
 * instance name `label_txt` at PLACEMENT time (PlaceObject2 name); the DefineEditText
 * itself carries the statically seeded initial text.
 *
 * A plain Button centers its label across the whole face. A CheckBox/RadioButton
 * left-aligns the label to the RIGHT of the indicator box (matching Flash's layout).
 */
function buildLabelTextObject(
  kind: ControlKind,
  label: string,
  width: number,
  height: number,
): TextDisplayObject {
  const toggle = kind === "checkbox" || kind === "radiobutton";
  const { x0, size } = indicatorBox(height);
  const labelX = toggle ? x0 + size + 4 : 0;
  return {
    type: "text",
    id: "label_txt",
    x: labelX,
    y: 0,
    width: Math.max(10, width - labelX),
    height,
    text: label,
    textType: "dynamic",
    fontFamily: "Arial",
    fontSize: 12,
    bold: false,
    italic: false,
    color: LABEL_COLOR,
    align: toggle ? "left" : "center",
    multiline: false,
    wordWrap: false,
    instanceName: "label_txt",
  };
}

// ---------------------------------------------------------------------------
// Skin sprite emission
// ---------------------------------------------------------------------------

/** Encode a tag record (header + body), large-tag aware. */
function encodeTagRecord(tagType: number, body: Uint8Array): Uint8Array {
  const bw = new BitWriter();
  if (body.length < 0x3f) {
    bw.writeUI16LE((tagType << 6) | body.length);
  } else {
    bw.writeUI16LE((tagType << 6) | 0x3f);
    bw.writeSI32LE(body.length);
  }
  bw.writeBytes(body);
  return bw.getBytes();
}

/** A named overlay mark already hoisted to a char id, to be placed inside the skin sprite. */
interface PlacedMark {
  readonly name: string;
  readonly charId: number;
}

/**
 * Build the DefineSprite tag *body* for the component skin: a single-frame
 * timeline that places the face shape (depth 1), the named label EditText
 * (depth 2, instance name `label_txt`), and any NAMED OVERLAY MARKS (depth 3+,
 * e.g. `check_mk` / `dot_mk`), then ShowFrame + End.
 *
 * The face shape, EditText, and mark shapes must be defined at TOP LEVEL before this
 * sprite (definition tags are forbidden inside a sprite), so the caller hoists
 * `encodeDefineShape4` / `encodeDefineEditText` first; this body only carries the
 * PlaceObject2 control tags. The marks are placed VISIBLE at compile time; the
 * registerClass-bound AS2 class hides them via `_visible = selected` in its
 * constructor/`__refresh` (initial state deselected).
 */
export function encodeComponentSkinSprite(
  spriteId: number,
  faceCharId: number,
  labelCharId: number,
  labelObj: TextDisplayObject,
  marks: readonly PlacedMark[] = [],
): Uint8Array {
  const bw = new BitWriter();
  bw.writeUI16LE(spriteId);
  bw.writeUI16LE(1); // FrameCount

  // Place the face shape at depth 1.
  bw.writeBytes(encodeTagRecord(Tag.PlaceObject2, encodePlaceObject2(faceCharId, 1, 0, 0)));

  // Place the named label EditText at depth 2 — the instance name makes
  // `this.label_txt` resolvable from the class methods.
  bw.writeBytes(
    encodeTagRecord(
      Tag.PlaceObject2,
      encodePlaceObject2WithName(labelCharId, 2, labelObj.x, labelObj.y, labelObj.instanceName!),
    ),
  );

  // Place each named overlay mark at depth 3+ — the instance name makes
  // `this.check_mk` / `this.dot_mk` resolvable so the class can toggle `_visible`.
  let depth = 3;
  for (const mark of marks) {
    bw.writeBytes(
      encodeTagRecord(
        Tag.PlaceObject2,
        encodePlaceObject2WithName(mark.charId, depth, 0, 0, mark.name),
      ),
    );
    depth++;
  }

  bw.writeBytes(encodeTagRecord(Tag.ShowFrame, new Uint8Array(0)));
  bw.writeBytes(encodeTagRecord(Tag.End, new Uint8Array(0)));
  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// Placement collection
// ---------------------------------------------------------------------------

/**
 * Collect the set of ComponentItem ids that are actually PLACED on any scene or
 * symbol timeline (a SymbolInstance whose symbolId resolves to a ComponentItem).
 * Only placed components are emitted — an unplaced library component costs nothing.
 */
function collectPlacedComponentIds(doc: FlashDocument): Set<string> {
  const componentIds = new Set<string>();
  for (const item of doc.library.items) {
    if (item.itemType === "component") componentIds.add(item.id);
  }
  const placed = new Set<string>();
  if (componentIds.size === 0) return placed;

  const scan = (objs: readonly DisplayObject[]): void => {
    for (const obj of flattenDisplayObjects(objs)) {
      if (obj.type === "instance") {
        const inst = obj as SymbolInstance;
        if (componentIds.has(inst.symbolId)) placed.add(inst.symbolId);
      }
    }
  };

  for (const scene of doc.scenes) {
    for (const layer of scene.timeline.layers) {
      for (const frame of layer.frames) scan(frame.displayObjects);
    }
  }
  // Components nested inside symbol timelines also count.
  for (const item of doc.library.items) {
    if (item.itemType !== "symbol") continue;
    for (const layer of item.timeline.layers) {
      for (const frame of layer.frames) scan(frame.displayObjects);
    }
  }
  return placed;
}

// ---------------------------------------------------------------------------
// Pass
// ---------------------------------------------------------------------------

/**
 * Emit, for every placed v2 component: the hoisted skin definitions
 * (DefineShape4 + DefineEditText), the skin DefineSprite (registered under the
 * ComponentItem id), the class-definition DoInitAction, the registerClass
 * DoInitAction, and the ExportAssets linkage entry.
 *
 * Must run AFTER the symbol pass (so library-symbol char ids are already assigned
 * and the synthetic ids never collide) and BEFORE the frame loop (so the placement
 * path can resolve `charIdMap.get(displayObj.symbolId)`).
 */
export function runComponentPass(input: ComponentPassInput): ComponentPassResult {
  const { writer, doc, charIdMap } = input;
  const exportEntries: { charId: number; name: string }[] = [];
  const doInitActionBodies: Uint8Array[] = [];

  const placedIds = collectPlacedComponentIds(doc);
  if (placedIds.size === 0) return { exportEntries, doInitActionBodies };

  // Emit in stable library order for deterministic output.
  for (const item of doc.library.items) {
    if (item.itemType !== "component") continue;
    if (!placedIds.has(item.id)) continue;
    const component = item as ComponentItem;

    const className = componentClassName(component);
    const linkageId = componentLinkageIdentifier(component);
    const label = componentLabel(component);
    const kind = controlKindFor(className);
    const spec = CONTROL_REGISTRY[kind];
    // Default placement size from the catalog when known (falls back to the Button size).
    const def = componentDefFor(component);
    const width = def?.defaultWidth ?? DEFAULT_BUTTON_WIDTH;
    const height = def?.defaultHeight ?? DEFAULT_BUTTON_HEIGHT;

    // 1. Hoisted skin definitions (top-level, BEFORE the DefineSprite).
    const faceCharId = writer.nextCharId();
    writer.writeTag(Tag.DefineShape4, encodeDefineShape4(faceCharId, buildFaceShape(kind, width, height)));

    const labelObj = buildLabelTextObject(kind, label, width, height);
    const labelCharId = writer.nextCharId();
    // No embedded font id → device-font rendering (HasFont unset); text still seeded.
    writer.writeTag(Tag.DefineEditText, encodeDefineEditText(labelCharId, labelObj));

    // Hoist each control mark's DefineShape4 (check tick / radio dot) above the sprite.
    const placedMarks: PlacedMark[] = [];
    for (const mark of spec.buildMarks(width, height)) {
      const markCharId = writer.nextCharId();
      writer.writeTag(Tag.DefineShape4, encodeDefineShape4(markCharId, mark.shape));
      placedMarks.push({ name: mark.name, charId: markCharId });
    }

    // 2. The skin DefineSprite, registered under the ComponentItem id so the stage
    //    SymbolInstance resolves to it.
    const spriteId = writer.nextCharId();
    charIdMap.set(component.id, spriteId);
    writer.writeTag(
      Tag.DefineSprite,
      encodeComponentSkinSprite(spriteId, faceCharId, labelCharId, labelObj, placedMarks),
    );

    // 3. ExportAssets entry under the linkage identifier (defaults to class name).
    exportEntries.push({ charId: spriteId, name: linkageId });

    // 4. DoInitAction ORDER: class definition FIRST, then registerClass — so the
    //    constructor exists in _global when registerClass resolves it.
    const classBytecode = authorComponentClassBytecode(className, label);
    doInitActionBodies.push(encodeRawDoInitAction(spriteId, classBytecode));
    doInitActionBodies.push(encodeDoInitAction(spriteId, className, linkageId));
  }

  return { exportEntries, doInitActionBodies };
}

// Re-export the linkage type for downstream convenience.
export type { ComponentLinkage };

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
 * PART 2.4 (task 1234) extends the SAME registry to the three standard TEXT controls —
 * `mx.controls.Label`, `mx.controls.TextInput`, and `mx.controls.TextArea`. Unlike the
 * button-family controls these have NO indicator-overlay mark; the EditText skin child
 * IS the control. The `ControlSpec` now carries a `textField` descriptor selecting the
 * skin EditText's `textType` (dynamic = read-only for Label; input = editable for
 * TextInput/TextArea), its `multiline`/`wordWrap` flags, and a `faceKind` ("none" for
 * Label — text only, no box; "input" — a bordered white field box for TextInput/TextArea).
 * The author's `text` param is statically pre-seeded into the EditText and mirrored live
 * via the shared `setComponentParam` (which already forwards `text`/`label` to
 * `label_txt.text`); the controls add `getText`/`setText` and a `change` broadcast on
 * edit. NOTE: headless Ruffle cannot be reliably driven to type keystrokes into an input
 * field, so keyboard EDITING is verified STRUCTURALLY (the editable EditText carries the
 * input/editable flags) — the Ruffle oracle asserts the author text RENDERS and that the
 * field is structurally editable, not that a synthesized keypress mutates it.
 *
 * PART 2.5 (task 1235) extends the SAME registry to the two SELECTION controls —
 * `mx.controls.List` and `mx.controls.ComboBox` — the final standard-controls slice.
 * Unlike every prior control these need a REPEATED-ROW skin: a fixed POOL of named
 * row EditText children (`row0_txt`..`rowN_txt`) plus a movable selection-highlight
 * shape (`hl_mk`). The registry gains two declarative hooks for this:
 *   - `extraTextFields(w,h)` — extra named EditText skin children beyond `label_txt`
 *     (the List/ComboBox rows). Each carries its own placement (x,y,w,h) + type.
 *   - a mark may carry an (x,y) placement offset (the highlight starts on row 0).
 * The author's items arrive via the GENERIC param path: `dataProvider`/`labels` is a
 * comma-joined string delivered by `setComponentParam`; the class splits it and seeds
 * the row fields + manages selection. List renders the rows stacked, click-to-select
 * highlights a row and exposes `selectedIndex`/`selectedItem`/`getSelectedItem`.
 * ComboBox collapses to a single row + a ▼ toggle; the toggle shows/hides the row pool
 * (the dropdown), selecting a row collapses it and updates the collapsed label.
 * SCOPE: static items from the param + click selection + ComboBox show/hide. DEFERRED
 * as follow-on (NOT built): live scrollbar/scrolling for long lists (the row pool is a
 * fixed size — items beyond the pool are not shown) and keyboard navigation.
 *
 * EXPLICITLY OUT OF SCOPE (later waves): the full `mx.controls.*` AS2 framework,
 * Halo skins, and the remaining long tail (DataGrid / Tree / DateChooser / ScrollPane /
 * Window / containers / data-binding).
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

/** Selection-highlight fill (Halo light blue) behind a selected List/ComboBox row. */
const HIGHLIGHT_COLOR: Color = { r: 0x7d, g: 0xa6, b: 0xe0, a: 0xff };

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
export type ControlKind =
  | "button"
  | "checkbox"
  | "radiobutton"
  | "label"
  | "textinput"
  | "textarea"
  | "list"
  | "combobox";

/** Resolve a control's kind from its (possibly dotted) class name. */
export function controlKindFor(className: string): ControlKind {
  const leaf = className.split(".").pop() || className;
  if (leaf === "CheckBox") return "checkbox";
  if (leaf === "RadioButton") return "radiobutton";
  if (leaf === "Label") return "label";
  if (leaf === "TextInput") return "textinput";
  if (leaf === "TextArea") return "textarea";
  if (leaf === "List") return "list";
  if (leaf === "ComboBox") return "combobox";
  return "button";
}

// ---------------------------------------------------------------------------
// Selection-control (List / ComboBox) row-pool geometry (task 1235, Part 2.5)
// ---------------------------------------------------------------------------

/** Height (px) of one List/ComboBox row (matches the catalog rowHeight default). */
export const ROW_HEIGHT = 20;
/**
 * Size of the fixed row POOL for the repeated-row skin. The flat compile-time model
 * does not know the author's item count (delivered live via `labels`), so we emit a
 * fixed pool of named EditText children and the class shows only as many as there are
 * items. Items beyond the pool are NOT rendered (scrolling is the deferred follow-on).
 */
export const LIST_ROW_POOL = 8;

/**
 * How a control's skin face/box is drawn:
 *   - "button"  — the rounded-rect button face (default).
 *   - "toggle"  — the CheckBox box / RadioButton circle indicator.
 *   - "input"   — a bordered white text-field box (TextInput / TextArea).
 *   - "none"    — no face at all; the EditText is the only visible child (Label).
 */
export type FaceKind = "button" | "toggle" | "input" | "none" | "list";

/**
 * Descriptor for the control's skin EditText (`label_txt`). Selects the SWF
 * DefineEditText `textType` (which the encoder turns into ReadOnly vs editable) plus
 * the `multiline`/`wordWrap` flags so a TextInput is a single-line editable field and
 * a TextArea is a multi-line word-wrapping editable field. Label uses a read-only
 * `dynamic` field.
 */
interface TextFieldSpec {
  /** SWF text type: "dynamic" → read-only display; "input" → editable field. */
  readonly textType: "dynamic" | "input";
  /** Multi-line field (TextArea). */
  readonly multiline: boolean;
  /** Word-wrap within the field bounds (TextArea). */
  readonly wordWrap: boolean;
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
  /** Optional placement offset (px) — defaults to (0,0). The List/ComboBox highlight
   *  is placed on the first row and re-positioned at runtime by the class. */
  readonly x?: number;
  readonly y?: number;
}

/**
 * An extra named EditText skin child beyond the primary `label_txt` (the List/ComboBox
 * row pool). Each carries its own placement + the text type so the class can resolve
 * `this.<name>` and seed/show it from the delivered items.
 */
interface ExtraTextField {
  /** PlaceObject2 instance name (e.g. `row0_txt`). */
  readonly name: string;
  /** Placement + size (px), origin-relative. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** SWF text type ("dynamic" read-only display for rows). */
  readonly textType: "dynamic" | "input";
}

/** Per-control description driving skin + class emission (replaces per-control if-chains). */
interface ControlSpec {
  /** Named overlay marks (check tick / radio dot). Empty for a plain Button or text control. */
  buildMarks(width: number, height: number): SkinMark[];
  /**
   * Control-specific AS2 method/handler bodies appended to the shared base class.
   * `fqn` is the fully-qualified `_global.<class>` path; `labelLit` the seeded label.
   * The shared base already defines the constructor, setLabel/getLabel, setText,
   * setComponentParam (label/text mirroring), onLoad, onRollOver/Out. A control adds
   * its selection state + click handler here.
   */
  authorClassBody(fqn: string, labelLit: string): string;
  /**
   * Which skin face/box to draw. Defaults to "button" when omitted; the toggle
   * controls override to "toggle", the text controls to "input"/"none".
   */
  readonly faceKind?: FaceKind;
  /**
   * Overrides the skin EditText's type/flags. When omitted the field is a read-only
   * single-line `dynamic` label (the button-family default). Text controls supply this
   * to make TextInput/TextArea editable and TextArea multi-line.
   */
  readonly textField?: TextFieldSpec;
  /**
   * Extra named EditText skin children beyond the primary `label_txt`. Selection
   * controls (List/ComboBox) supply the repeated row pool here. Empty/omitted for
   * every other control. `height` is the skin box height; the row-pool impls derive
   * their per-row geometry from a fixed `ROW_HEIGHT`, so it is optional (the call site
   * still passes it for parity with `buildMarks`).
   */
  extraTextFields?(width: number, height?: number): ExtraTextField[];
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

/**
 * Label: a STATIC display control. The skin EditText is `dynamic` (read-only), so the
 * field only shows text. `getText`/`setText` mirror `this.text` into `label_txt.text`
 * (the shared `setText`/`setComponentParam` already do the mirroring; we add `getText`
 * + the `text` constructor seed). No click/selection handler — Label is non-interactive.
 */
function authorLabelClassBody(fqn: string, _labelLit: string): string {
  return `
${fqn}.prototype.__init = function() {
  this.text = this.label;
};
${fqn}.prototype.getText = function() {
  return this.text;
};
`;
}

/**
 * TextInput / TextArea: an EDITABLE field. The skin EditText is `input` (the encoder
 * sets the editable/selectable flags). `getText` reads the live `label_txt.text`,
 * `setText` writes it (and `this.text`); an `onChanged` handler bound to the field
 * broadcasts a `change` event (mirrors Flash's mx change broadcast — a `change`
 * listener / `_root`-visible callback). `__init` seeds the field's initial text +
 * installs the change relay. Shared between TextInput and TextArea (the multi-line
 * difference is purely the EditText flags, not the class behaviour).
 */
function authorTextFieldClassBody(fqn: string, _labelLit: string): string {
  return `
${fqn}.prototype.__init = function() {
  this.text = this.label;
  if (this.label_txt != undefined) {
    this.label_txt.text = this.text;
    var self = this;
    this.label_txt.onChanged = function() {
      self.text = this.text;
      self.dispatchChange();
    };
  }
};
${fqn}.prototype.getText = function() {
  if (this.label_txt != undefined) { return this.label_txt.text; }
  return this.text;
};
${fqn}.prototype.setText = function(s) {
  this.text = s;
  if (this.label_txt != undefined) { this.label_txt.text = s; }
};
${fqn}.prototype.addEventListener = function(event, fn) {
  if (event == "change") { this.__changeListener = fn; }
};
${fqn}.prototype.dispatchChange = function() {
  this.__changed = true;
  if (this.__changeListener != undefined) {
    this.__changeListener({ type: "change", target: this });
  }
  if (this.onChange != undefined) { this.onChange(this); }
};
`;
}

/**
 * Shared AS2 helpers for the row-pool selection controls (List + ComboBox). Both
 * split the delivered `labels`/`dataProvider` comma-string into items, seed the named
 * row EditText pool from them (hiding unused rows), and manage a click-to-select index
 * reflected into a movable `hl_mk` highlight. Authored as a string fragment appended to
 * the per-control body so List + ComboBox share the same row/selection machinery.
 *
 * `rowPool` is the fixed number of row fields emitted in the skin (LIST_ROW_POOL). Rows
 * beyond the pool are not rendered (scrolling is the deferred follow-on).
 * `rowHeight` is the per-row height (px). `rowTop` is the y of row 0 (0 for List; one
 * row down for ComboBox so the collapsed label_txt sits on top).
 */
function authorRowPoolHelpers(fqn: string, rowPool: number, rowHeight: number, rowTop: number): string {
  return `
${fqn}.prototype.__rowPool = ${rowPool};
${fqn}.prototype.__rowHeight = ${rowHeight};
${fqn}.prototype.__rowTop = ${rowTop};
${fqn}.prototype.__splitItems = function(s) {
  var out = [];
  if (s == undefined || s == "") { return out; }
  var cur = "";
  var i = 0;
  while (i < s.length) {
    var ch = s.charAt(i);
    if (ch == ",") { out.push(cur); cur = ""; } else { cur = cur + ch; }
    i++;
  }
  out.push(cur);
  return out;
};
${fqn}.prototype.__rowField = function(i) {
  return this["row" + i + "_txt"];
};
${fqn}.prototype.__seedRows = function() {
  var n = this.__items.length;
  var i = 0;
  while (i < this.__rowPool) {
    var f = this.__rowField(i);
    if (f != undefined) {
      if (i < n) { f.text = this.__items[i]; f._visible = true; }
      else { f.text = ""; f._visible = false; }
    }
    i++;
  }
};
${fqn}.prototype.setItems = function(arr) {
  this.__items = arr;
  this.__seedRows();
  if (this.selectedIndex >= this.__items.length) { this.selectedIndex = -1; }
  this.__refresh();
};
${fqn}.prototype.getLength = function() {
  return this.__items.length;
};
${fqn}.prototype.getItemAt = function(i) {
  return this.__items[i];
};
${fqn}.prototype.getSelectedIndex = function() {
  return this.selectedIndex;
};
${fqn}.prototype.getSelectedItem = function() {
  if (this.selectedIndex >= 0 && this.selectedIndex < this.__items.length) {
    return this.__items[this.selectedIndex];
  }
  return undefined;
};
${fqn}.prototype.setSelectedIndex = function(i) {
  if (i >= -1 && i < this.__items.length) {
    this.selectedIndex = i;
    this.selectedItem = this.getSelectedItem();
    this.__refresh();
    this.dispatchChange();
  }
};
${fqn}.prototype.addEventListener = function(event, fn) {
  if (event == "change") { this.__changeListener = fn; }
};
${fqn}.prototype.dispatchChange = function() {
  if (this.__changeListener != undefined) {
    this.__changeListener({ type: "change", target: this, index: this.selectedIndex });
  }
  if (this.onChange != undefined) { this.onChange(this); }
};
${fqn}.prototype.__rowYForIndex = function(i) {
  return this.__rowTop + i * this.__rowHeight;
};
${fqn}.prototype.__rowAtMouse = function() {
  // Which visible row the parent-space mouse Y lands on (-1 = none / outside).
  var my = this._parent._ymouse - this._y;
  var rel = my - this.__rowTop;
  if (rel < 0) { return -1; }
  var idx = Math.floor(rel / this.__rowHeight);
  if (idx < 0 || idx >= this.__rowPool || idx >= this.__items.length) { return -1; }
  return idx;
};
`;
}

/**
 * List: a stacked-row selection control. Rows render from the delivered `labels`/
 * `dataProvider` items; clicking a row selects it (a movable `hl_mk` highlight marks the
 * selection) and exposes `selectedIndex`/`selectedItem`. `label_txt` is unused for the
 * List (the rows are the content) so it is hidden. The author's items arrive via the
 * generic param path (`setComponentParam("labels"|"dataProvider", "...")` → setItems).
 */
function authorListClassBody(fqn: string): string {
  return (
    authorRowPoolHelpers(fqn, LIST_ROW_POOL, ROW_HEIGHT, 0) +
    `
${fqn}.prototype.__init = function() {
  this.__items = [];
  this.selectedIndex = -1;
  this.selectedItem = undefined;
  if (this.label_txt != undefined) { this.label_txt._visible = false; }
};
${fqn}.prototype.setComponentParam = function(name, value) {
  if (name == "labels" || name == "dataProvider" || name == "data") {
    this.setItems(this.__splitItems(value));
    return;
  }
  this[name] = value;
};
${fqn}.prototype.__refresh = function() {
  if (this.hl_mk != undefined) {
    if (this.selectedIndex >= 0) {
      this.hl_mk._visible = true;
      this.hl_mk._y = this.__rowYForIndex(this.selectedIndex);
    } else {
      this.hl_mk._visible = false;
    }
  }
};
${fqn}.prototype.__handleClick = function() {
  var idx = this.__rowAtMouse();
  if (idx >= 0) {
    this.setSelectedIndex(idx);
    trace("[component] list select index=" + idx + " item=" + this.getSelectedItem());
  }
};
${fqn}.prototype.onMouseDown = function() {
  // The row-pool spans the full List bbox; gate the click on the bbox then resolve the row.
  if (this.__inBounds()) { this.__handleClick(); }
};
`
  );
}

/**
 * ComboBox: a collapsed single-row display (`label_txt`) + a ▼ toggle (`arrow_mk`) that
 * shows/hides the dropdown (the row pool, placed one row below). Clicking the collapsed
 * row (or the arrow) toggles the dropdown open/closed; clicking a dropdown row selects
 * it, updates the collapsed label, and closes the dropdown. Exposes the same
 * selectedIndex/selectedItem API as List.
 */
export function authorComboBoxClassBody(fqn: string): string {
  return (
    authorRowPoolHelpers(fqn, LIST_ROW_POOL, ROW_HEIGHT, ROW_HEIGHT) +
    `
${fqn}.prototype.__init = function() {
  this.__items = [];
  this.selectedIndex = -1;
  this.selectedItem = undefined;
  this.__open = false;
  this.__setOpen(false);
};
${fqn}.prototype.setComponentParam = function(name, value) {
  if (name == "labels" || name == "dataProvider" || name == "data") {
    this.setItems(this.__splitItems(value));
    return;
  }
  this[name] = value;
};
${fqn}.prototype.__setOpen = function(v) {
  this.__open = (v == true);
  var i = 0;
  while (i < this.__rowPool) {
    var f = this.__rowField(i);
    if (f != undefined) {
      f._visible = (this.__open && i < this.__items.length);
    }
    i++;
  }
  // Toggle the ▼ overlay so the open/closed state has a visual cue (hidden while open).
  if (this.arrow_mk != undefined) {
    this.arrow_mk._visible = !this.__open;
  }
  this.__refresh();
};
${fqn}.prototype.isOpen = function() {
  return this.__open;
};
${fqn}.prototype.open = function() { this.__setOpen(true); };
${fqn}.prototype.close = function() { this.__setOpen(false); };
${fqn}.prototype.__refresh = function() {
  // Collapsed label shows the selected item (or empty).
  if (this.label_txt != undefined) {
    this.label_txt.text = (this.selectedIndex >= 0) ? this.getSelectedItem() : "";
  }
  // Highlight only while open + something selected.
  if (this.hl_mk != undefined) {
    if (this.__open && this.selectedIndex >= 0) {
      this.hl_mk._visible = true;
      this.hl_mk._y = this.__rowYForIndex(this.selectedIndex);
    } else {
      this.hl_mk._visible = false;
    }
  }
};
${fqn}.prototype.__inCollapsed = function() {
  // Parent-space hit test of the collapsed row (the top __rowHeight band of the bbox).
  var mx = this._parent._xmouse;
  var my = this._parent._ymouse;
  return (mx >= this._x && mx <= this._x + this._width && my >= this._y && my <= this._y + this.__rowHeight);
};
${fqn}.prototype.__handleClick = function() {
  if (!this.__open) {
    // Collapsed: a press on the collapsed row / arrow opens the dropdown.
    if (this.__inCollapsed()) {
      this.__setOpen(true);
      trace("[component] combobox open");
    }
    return;
  }
  // Open: a press on a dropdown row selects it and closes; elsewhere just closes.
  var idx = this.__rowAtMouse();
  if (idx >= 0) {
    this.setSelectedIndex(idx);
    trace("[component] combobox select index=" + idx + " item=" + this.getSelectedItem());
  }
  this.__setOpen(false);
};
${fqn}.prototype.onMouseDown = function() {
  // Gate on the bbox (collapsed row OR the open dropdown area both lie within _width;
  // the open dropdown extends below, still inside the skin bbox since rows are children).
  var mx = this._parent._xmouse;
  var my = this._parent._ymouse;
  // Visible bottom edge: the collapsed row (__rowTop = one row) plus, when open, the N
  // item rows. No trailing +__rowHeight — that added a phantom extra row (closed box
  // accepted clicks ~2 rows down; open box accepted a row below the last item).
  var bottom = this._y + this.__rowTop + (this.__open ? this.__items.length * this.__rowHeight : 0);
  if (mx >= this._x && mx <= this._x + this._width && my >= this._y && my <= bottom) {
    this.__handleClick();
  } else if (this.__open) {
    // Click-away closes the open dropdown.
    this.__setOpen(false);
  }
};
`
  );
}

const CONTROL_REGISTRY: Record<ControlKind, ControlSpec> = {
  button: {
    buildMarks: () => [],
    authorClassBody: authorButtonClassBody,
  },
  checkbox: {
    buildMarks: (w, h) => [{ name: "check_mk", shape: buildCheckMarkShape(w, h) }],
    authorClassBody: authorCheckBoxClassBody,
    faceKind: "toggle",
  },
  radiobutton: {
    buildMarks: (w, h) => [{ name: "dot_mk", shape: buildRadioDotShape(w, h) }],
    authorClassBody: authorRadioButtonClassBody,
    faceKind: "toggle",
  },
  label: {
    buildMarks: () => [],
    authorClassBody: authorLabelClassBody,
    faceKind: "none",
    textField: { textType: "dynamic", multiline: false, wordWrap: false },
  },
  textinput: {
    buildMarks: () => [],
    authorClassBody: authorTextFieldClassBody,
    faceKind: "input",
    textField: { textType: "input", multiline: false, wordWrap: false },
  },
  textarea: {
    buildMarks: () => [],
    authorClassBody: authorTextFieldClassBody,
    faceKind: "input",
    textField: { textType: "input", multiline: true, wordWrap: true },
  },
  list: {
    // The selection highlight sits behind the rows, placed on row 0 (y=0) initially and
    // moved/hidden at runtime by the class.
    buildMarks: (w) => [{ name: "hl_mk", shape: buildHighlightShape(w, ROW_HEIGHT), x: 0, y: 0 }],
    authorClassBody: (fqn) => authorListClassBody(fqn),
    faceKind: "list",
    // The List has no single label; rows are the content (label_txt is hidden at init).
    extraTextFields: (w) => buildRowPoolFields(w, 0),
  },
  combobox: {
    // Highlight starts on the first dropdown row (one row below the collapsed display).
    buildMarks: (w) => [
      { name: "hl_mk", shape: buildHighlightShape(w, ROW_HEIGHT), x: 0, y: ROW_HEIGHT },
      { name: "arrow_mk", shape: buildArrowShape(w), x: 0, y: 0 },
    ],
    authorClassBody: (fqn) => authorComboBoxClassBody(fqn),
    faceKind: "list",
    // Rows form the dropdown, placed one row below the collapsed label.
    extraTextFields: (w) => buildRowPoolFields(w, ROW_HEIGHT),
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

/**
 * A bordered white input-field box (TextInput / TextArea face): a plain rectangle
 * outline with a white fill, sized to the field. Origin (0,0). Distinct from the
 * rounded button face — input fields are square-cornered in Flash 8's Halo skin.
 */
function buildInputFaceShape(width: number, height: number): Shape {
  return {
    id: "component-face",
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: width, y: 0 } },
          { type: "line", to: { x: width, y: height } },
          { type: "line", to: { x: 0, y: height } },
          { type: "line", to: { x: 0, y: 0 } },
        ],
        closed: true,
        fill: { type: "solid", color: BOX_FILL_COLOR },
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

/**
 * A selection-highlight rectangle (light blue fill) drawn behind the selected List/
 * ComboBox row. Origin (0,0), one row tall; the class repositions its `_y` to the
 * selected row and toggles `_visible`.
 */
function buildHighlightShape(width: number, height: number): Shape {
  return {
    id: "row-highlight",
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: width, y: 0 } },
          { type: "line", to: { x: width, y: height } },
          { type: "line", to: { x: 0, y: height } },
          { type: "line", to: { x: 0, y: 0 } },
        ],
        closed: true,
        fill: { type: "solid", color: HIGHLIGHT_COLOR },
      },
    ],
  };
}

/** The ComboBox ▼ toggle arrow: a small downward filled triangle at the right edge. */
function buildArrowShape(width: number): Shape {
  const boxW = 16;
  const cx = width - boxW / 2;
  const cy = ROW_HEIGHT / 2;
  const r = 4;
  return {
    id: "combo-arrow",
    paths: [
      {
        start: { x: cx - r, y: cy - r / 2 },
        segments: [
          { type: "line", to: { x: cx + r, y: cy - r / 2 } },
          { type: "line", to: { x: cx, y: cy + r } },
          { type: "line", to: { x: cx - r, y: cy - r / 2 } },
        ],
        closed: true,
        fill: { type: "solid", color: MARK_COLOR },
      },
    ],
  };
}

/**
 * Build the fixed pool of named row EditText descriptors (`row0_txt`..`rowN_txt`) for a
 * List/ComboBox skin. Stacked from `topY`, one ROW_HEIGHT each, full control width
 * (inset 2px). All read-only `dynamic` rows — the class seeds + shows/hides them from
 * the delivered items.
 */
function buildRowPoolFields(width: number, topY: number): ExtraTextField[] {
  const fields: ExtraTextField[] = [];
  for (let i = 0; i < LIST_ROW_POOL; i++) {
    fields.push({
      name: `row${i}_txt`,
      x: 4,
      y: topY + i * ROW_HEIGHT + 2,
      width: Math.max(10, width - 8),
      height: ROW_HEIGHT,
      textType: "dynamic",
    });
  }
  return fields;
}

/**
 * Resolve the face Shape for a control, or `null` when it draws no face at all (Label —
 * the EditText is the only visible child). The face kind is read from the registry spec;
 * the toggle kind additionally needs the control kind to pick box (CheckBox) vs circle
 * (RadioButton).
 */
function buildFaceShape(kind: ControlKind, width: number, height: number): Shape | null {
  const faceKind = CONTROL_REGISTRY[kind].faceKind ?? "button";
  switch (faceKind) {
    case "none":
      return null;
    case "toggle":
      return buildToggleFaceShape(kind === "radiobutton" ? "radiobutton" : "checkbox", width, height);
    case "input":
      return buildInputFaceShape(width, height);
    case "list":
      // A bordered white box, same as an input field — the row pool draws on top.
      return buildInputFaceShape(width, height);
    case "button":
    default:
      return buildButtonFaceShape(width, height);
  }
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
 * Build the skin's text TextDisplayObject (`label_txt`). It is given the instance name
 * `label_txt` at PLACEMENT time (PlaceObject2 name); the DefineEditText itself carries
 * the statically seeded initial text.
 *
 * Layout + type vary by control kind:
 *   - Button: centered single-line read-only (dynamic) label across the whole face.
 *   - CheckBox/RadioButton: left-aligned single-line dynamic label to the RIGHT of the
 *     indicator box.
 *   - Label: left-aligned single-line read-only dynamic text spanning the full box (no
 *     face), so it reads as a plain static label.
 *   - TextInput: left-aligned single-line EDITABLE (input) field, inset 2px inside the
 *     bordered box.
 *   - TextArea: left-aligned multi-line word-wrapping EDITABLE (input) field, inset.
 *
 * The `textType`/`multiline`/`wordWrap` come from the registry's `textField` spec; the
 * encoder turns `input` into an editable/selectable field and `dynamic` into a read-only
 * one (see encodeDefineEditText), and sets the Multiline/WordWrap SWF flags from those
 * booleans.
 */
function buildLabelTextObject(
  kind: ControlKind,
  label: string,
  width: number,
  height: number,
): TextDisplayObject {
  const spec = CONTROL_REGISTRY[kind];
  const faceKind = spec.faceKind ?? "button";
  const field = spec.textField ?? { textType: "dynamic" as const, multiline: false, wordWrap: false };

  const toggle = faceKind === "toggle";
  const { x0, size } = indicatorBox(height);
  // Toggle controls inset the label past the indicator; input fields inset 2px inside
  // the border; plain Button/Label start at the left edge.
  const inset = faceKind === "input" ? 2 : 0;
  const labelX = toggle ? x0 + size + 4 : inset;
  const labelY = inset;
  // Button centers its label; everything else is left-aligned (Flash field/label layout).
  const align: TextDisplayObject["align"] = faceKind === "button" ? "center" : "left";

  return {
    type: "text",
    id: "label_txt",
    x: labelX,
    y: labelY,
    width: Math.max(10, width - labelX - inset),
    height: Math.max(10, height - labelY - inset),
    text: label,
    textType: field.textType,
    fontFamily: "Arial",
    fontSize: 12,
    bold: false,
    italic: false,
    color: LABEL_COLOR,
    align,
    multiline: field.multiline,
    wordWrap: field.wordWrap,
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
  /** Placement offset (px); defaults to (0,0). */
  readonly x?: number;
  readonly y?: number;
}

/** A named extra EditText (List/ComboBox row) hoisted to a char id, placed in the sprite. */
interface PlacedTextField {
  readonly name: string;
  readonly charId: number;
  readonly x: number;
  readonly y: number;
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
  faceCharId: number | null,
  labelCharId: number,
  labelObj: TextDisplayObject,
  marks: readonly PlacedMark[] = [],
  rows: readonly PlacedTextField[] = [],
): Uint8Array {
  const bw = new BitWriter();
  bw.writeUI16LE(spriteId);
  bw.writeUI16LE(1); // FrameCount

  // Place the face shape at depth 1 — unless the control has no face (Label), where the
  // EditText is the only child.
  if (faceCharId !== null) {
    bw.writeBytes(encodeTagRecord(Tag.PlaceObject2, encodePlaceObject2(faceCharId, 1, 0, 0)));
  }

  // Depth ordering: face(1) < selection highlight (a mark, behind text) < label_txt +
  // rows < the rest. The highlight must sit BELOW the row text so the row labels read on
  // top of the blue band; we place highlight marks first (low depth), then the text, then
  // any non-highlight marks (e.g. the ComboBox arrow) on top.
  let depth = 2;

  // Highlight marks first (behind the text rows).
  for (const mark of marks) {
    if (mark.name !== "hl_mk") continue;
    bw.writeBytes(
      encodeTagRecord(
        Tag.PlaceObject2,
        encodePlaceObject2WithName(mark.charId, depth, mark.x ?? 0, mark.y ?? 0, mark.name),
      ),
    );
    depth++;
  }

  // Place the named label EditText — the instance name makes `this.label_txt` resolvable.
  bw.writeBytes(
    encodeTagRecord(
      Tag.PlaceObject2,
      encodePlaceObject2WithName(labelCharId, depth, labelObj.x, labelObj.y, labelObj.instanceName!),
    ),
  );
  depth++;

  // Place each extra named EditText (List/ComboBox row pool) on top of the highlight.
  for (const row of rows) {
    bw.writeBytes(
      encodeTagRecord(
        Tag.PlaceObject2,
        encodePlaceObject2WithName(row.charId, depth, row.x, row.y, row.name),
      ),
    );
    depth++;
  }

  // Place remaining (non-highlight) marks on top — the check tick / radio dot / combo arrow.
  for (const mark of marks) {
    if (mark.name === "hl_mk") continue;
    bw.writeBytes(
      encodeTagRecord(
        Tag.PlaceObject2,
        encodePlaceObject2WithName(mark.charId, depth, mark.x ?? 0, mark.y ?? 0, mark.name),
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

    // 1. Hoisted skin definitions (top-level, BEFORE the DefineSprite). A control with
    //    no face (Label) skips the face DefineShape4 entirely; the EditText is its only
    //    visible child.
    const faceShape = buildFaceShape(kind, width, height);
    let faceCharId: number | null = null;
    if (faceShape !== null) {
      faceCharId = writer.nextCharId();
      writer.writeTag(Tag.DefineShape4, encodeDefineShape4(faceCharId, faceShape));
    }

    const labelObj = buildLabelTextObject(kind, label, width, height);
    const labelCharId = writer.nextCharId();
    // No embedded font id → device-font rendering (HasFont unset); text still seeded.
    writer.writeTag(Tag.DefineEditText, encodeDefineEditText(labelCharId, labelObj));

    // Hoist each control mark's DefineShape4 (check tick / radio dot / row highlight /
    //    combo arrow) above the sprite, carrying its placement offset.
    const placedMarks: PlacedMark[] = [];
    for (const mark of spec.buildMarks(width, height)) {
      const markCharId = writer.nextCharId();
      writer.writeTag(Tag.DefineShape4, encodeDefineShape4(markCharId, mark.shape));
      placedMarks.push({ name: mark.name, charId: markCharId, x: mark.x, y: mark.y });
    }

    // Hoist each extra named EditText (List/ComboBox row pool) above the sprite.
    const placedRows: PlacedTextField[] = [];
    for (const field of spec.extraTextFields?.(width, height) ?? []) {
      const rowCharId = writer.nextCharId();
      const rowObj: TextDisplayObject = {
        type: "text",
        id: field.name,
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height,
        text: "",
        textType: field.textType,
        fontFamily: "Arial",
        fontSize: 12,
        bold: false,
        italic: false,
        color: LABEL_COLOR,
        align: "left",
        multiline: false,
        wordWrap: false,
        instanceName: field.name,
      };
      writer.writeTag(Tag.DefineEditText, encodeDefineEditText(rowCharId, rowObj));
      placedRows.push({ name: field.name, charId: rowCharId, x: field.x, y: field.y });
    }

    // 2. The skin DefineSprite, registered under the ComponentItem id so the stage
    //    SymbolInstance resolves to it.
    const spriteId = writer.nextCharId();
    charIdMap.set(component.id, spriteId);
    writer.writeTag(
      Tag.DefineSprite,
      encodeComponentSkinSprite(spriteId, faceCharId, labelCharId, labelObj, placedMarks, placedRows),
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

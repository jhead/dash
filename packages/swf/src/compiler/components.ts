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
 * EXPLICITLY OUT OF SCOPE (later waves): the full `mx.controls.*` AS2 framework,
 * Halo skins, and other controls (CheckBox / List / ComboBox / ...).
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

/** Corner radius (px) of the rounded-rect face. */
const CORNER_RADIUS = 6;

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

/** The label text statically seeded into the skin's EditText (defaults to the item name). */
export function componentLabel(item: ComponentItem): string {
  const cls = item.componentName?.trim() || item.name;
  return cls || "Button";
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
 * The class implements:
 *   - constructor:  seeds `this.label`, mirrors it into the named `label_txt`
 *                   child (the EditText placed in the skin sprite).
 *   - setLabel(s):  param-driven update of both `this.label` and `label_txt.text`.
 *   - getLabel():   accessor.
 *   - onLoad:       re-asserts the label once the child is attached (clip-event
 *                   parity for the Ruffle oracle).
 *   - onRollOver / onRollOut: dim/restore the face alpha on hover.
 *   - onRelease:    runtime click handler (sprites with onRelease become buttons
 *                   in AVM1) — restores alpha and traces, proving the instance is live.
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

  const src = `
${guards.join("\n")}
${fqn} = function() {
  this.label = ${labelLit};
  if (this.label_txt != undefined) {
    this.label_txt.text = this.label;
  }
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
  this[name] = value;
  if ((name == "label" || name == "text") && this.label_txt != undefined) {
    this.label_txt.text = value;
  }
};
${fqn}.prototype.onLoad = function() {
  if (this.label_txt != undefined) {
    this.label_txt.text = this.label;
  }
};
${fqn}.prototype.onRollOver = function() {
  this._alpha = 70;
};
${fqn}.prototype.onRollOut = function() {
  this._alpha = 100;
};
${fqn}.prototype.onRelease = function() {
  this._alpha = 100;
  trace("[component] " + this.label + " released");
};
`;
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

/**
 * Build a centered dynamic-text TextDisplayObject for the component label. It is
 * given the instance name `label_txt` at PLACEMENT time (PlaceObject2 name); the
 * DefineEditText itself carries the statically seeded initial text.
 */
function buildLabelTextObject(label: string, width: number, height: number): TextDisplayObject {
  return {
    type: "text",
    id: "label_txt",
    x: 0,
    y: 0,
    width,
    height,
    text: label,
    textType: "dynamic",
    fontFamily: "Arial",
    fontSize: 12,
    bold: false,
    italic: false,
    color: LABEL_COLOR,
    align: "center",
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

/**
 * Build the DefineSprite tag *body* for the component skin: a single-frame
 * timeline that places the face shape (depth 1) and the named label EditText
 * (depth 2, instance name `label_txt`), then ShowFrame + End.
 *
 * The face shape and EditText characters must be defined at TOP LEVEL before this
 * sprite (definition tags are forbidden inside a sprite), so the caller hoists
 * `encodeDefineShape4` / `encodeDefineEditText` first; this body only carries the
 * two PlaceObject2 control tags.
 */
export function encodeComponentSkinSprite(
  spriteId: number,
  faceCharId: number,
  labelCharId: number,
  labelObj: TextDisplayObject,
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
    const width = DEFAULT_BUTTON_WIDTH;
    const height = DEFAULT_BUTTON_HEIGHT;

    // 1. Hoisted skin definitions (top-level, BEFORE the DefineSprite).
    const faceCharId = writer.nextCharId();
    writer.writeTag(Tag.DefineShape4, encodeDefineShape4(faceCharId, buildButtonFaceShape(width, height)));

    const labelObj = buildLabelTextObject(label, width, height);
    const labelCharId = writer.nextCharId();
    // No embedded font id → device-font rendering (HasFont unset); text still seeded.
    writer.writeTag(Tag.DefineEditText, encodeDefineEditText(labelCharId, labelObj));

    // 2. The skin DefineSprite, registered under the ComponentItem id so the stage
    //    SymbolInstance resolves to it.
    const spriteId = writer.nextCharId();
    charIdMap.set(component.id, spriteId);
    writer.writeTag(
      Tag.DefineSprite,
      encodeComponentSkinSprite(spriteId, faceCharId, labelCharId, labelObj),
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

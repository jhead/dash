# 13 — Components

Components are pre-built, parameterized **compiled MovieClip symbols** (with AS2 classes) for
common UI and data tasks. Flash 8 ships the **Version 2 (v2) component architecture**.

## Component model

- Components live in the **Components panel** (`Window > Components`); drag onto the stage.
- Each instance is configured via the **Property inspector** or the **Component Inspector**
  (Parameters, Bindings, Schema tabs).
- Backed by AS2 classes; styling via the **v2 styles/skinning** system (themes: Halo Theme).
- Distributed as **.swc** / compiled clips; users can build custom components.
- **`UIComponent`** base class; focus management, events (via `EventDispatcher`),
  `setStyle`/`getStyle`, `setSize`, invalidation/`doLater`.

## UI components (v2 set)

`Button, CheckBox, RadioButton, Label, TextInput, TextArea, ComboBox, List, DataGrid,
NumericStepper, ScrollPane, ProgressBar, Loader, Window, Alert, Accordion, MenuBar, Menu,
Tree, DateChooser, DateField, ColorPicker, UIScrollBar`

(Plus support classes: `RectBorder`, `ScrollSelectList`, `View`, `CellRenderer`, etc.)

## Media & video components

- **FLVPlayback** (Pro) + **FLVPlaybackCaptioning** — external FLV playback with skins/cue
  points (see `11`).
- Legacy **Media components** (Player 6/7): `MediaController`, `MediaDisplay`, `MediaPlayback`.

## Data components (Pro)

Used with **Data Integration** (see `17`):

- `DataSet`, `XMLConnector`, `WebServiceConnector`, `XUpdateResolver`, `RDBMSResolver`,
  data **binding** + **schema** (Component Inspector Bindings/Schema tabs).

## Manager classes

- `FocusManager`, `DepthManager`, `PopUpManager`, `StyleManager`, `SystemManager`.

## Accessibility

- v2 UI components expose accessibility (MSAA) when `enableAccessibility()` is called
  (see `17`).

## Accuracy targets

- The full v2 component set with matching parameters, default skins (Halo), and runtime
  behavior/events.
- Component Inspector (Parameters/Bindings/Schema) and live binding semantics.
- FLVPlayback skins + cue-point/caption behavior.

## Implementation notes

- Components are normal symbols + AS2 classes in our model; ship a built-in component library
  (compiled clips) that authors can drag in, plus an SDK for custom components.
- Skinning system implemented over our symbol/9-slice + style registry; themes are swappable.
- Because components are "just" symbols + AS2, correct AVM1/AS2 runtime (`12`) largely
  guarantees component behavior.

## Implementation status (task 1222)

**Implemented — Components panel + Component Inspector (Parameters tab):**

- **Built-in v2 component catalog** — `packages/core/src/model/components.ts`. Each
  `ComponentDef` carries the display name, AS2 `className`/`packageName`, a default placement
  size, and its inspectable **parameters** (`ComponentParamDef`: `string | number | boolean |
  list | array`, with a default value and, for `list`, the option set). The built-in set
  (`BUILTIN_COMPONENTS`) covers the v2 UI controls: Button, CheckBox, RadioButton, Label,
  TextInput, TextArea, ComboBox, List, DataGrid, NumericStepper, ScrollPane, ProgressBar,
  Loader, Window, Accordion, MenuBar, Tree, DateChooser, DateField, UIScrollBar.
  Helpers: `getComponentDef(name)`, `defaultComponentParameters(def)`.
- **Components panel** — `packages/authoring-ui/src/ComponentsPanel.tsx`. Toggled via
  `Window > Components` (Ctrl+F7); floating panel listing the built-in components grouped by
  category. **Double-click** instantiates a component on the stage; rows are also
  **draggable** onto the stage (dataTransfer MIME `application/flash-component`).
- **Instantiation** — a placed component is a library **`ComponentItem`** plus a
  **`SymbolInstance`** whose `symbolId` references it. One library `ComponentItem` is reused
  across instances of the same class. The instance is seeded with the component's default
  parameters. Drop-to-instantiate is wired through `StageArea` (`onDropComponent`) and the
  Shell handler `handleInstantiateComponent`; core `placeLibraryItem` also handles
  `itemType === "component"`.
- **Parameter storage** — `SymbolInstance.componentParameters?: Record<string, string>`
  (`packages/core/src/engine/types.ts`). Values are stored as strings (the editor's
  serialized form) on the instance model and persist through the normal
  `updateDisplayObject` document-mutation path (undoable).
- **Component Inspector (Parameters tab)** — `packages/authoring-ui/src/ComponentInspectorPanel.tsx`.
  Shown in the right-hand Properties column when the selected instance references a
  `ComponentItem`. Renders one editor per parameter (text/number field, checkbox, or
  `<select>` for list types) and commits edits as a complete default-backed parameter map.

**Deferred (out of scope, separate tasks):** the **Bindings** and **Schema** tabs (rendered
as disabled stubs) and the **Data Integration** components — `DataSet`, `XMLConnector`,
`WebServiceConnector`, `XUpdateResolver`, `RDBMSResolver` — plus live binding/schema
semantics. v2 styling/skinning (Halo theme) and runtime component behavior are also future
work; the current scope is authoring-time placement + parameter editing only.

## Publishing placed components (task 1229, Part 1 — runtime plumbing)

Before this task, a placed `ComponentItem` was **silently dropped** from the published SWF:
the SWF compiler's symbol pass only maps `itemType === "symbol"`, so the component's
character id never entered `charIdMap`; the stage `SymbolInstance` (whose `symbolId` points at
the `ComponentItem.id`) then resolved to nothing in the frame loop and was omitted entirely.
`ComponentItem` also carried no AS2 linkage, so no `ExportAssets`/`DoInitAction` was emitted.

**Part 1 closes the plumbing gap** in `packages/swf/src/compiler/components.ts` (`runComponentPass`),
invoked by the orchestrator (`compile.ts`) AFTER the symbol pass and BEFORE the frame loop.
For every component **actually placed** on a scene or symbol timeline it:

1. **Synthesizes a DefineSprite** (an empty placeholder timeline — `SpriteID + 1 frame +
   ShowFrame + End`) and registers it in `charIdMap` under the `ComponentItem.id`, so the
   stage instance resolves to a real character id via the existing
   `charIdMap.get(displayObj.symbolId)` placement path (no change needed in `frames.ts`).
2. **Exports it under its fully-qualified AS2 class name** (e.g. `mx.controls.Button`,
   derived from `packageName + "." + componentName`) by appending an `ExportAssets` entry.
3. **Emits a `DoInitAction`** calling `Object.registerClass(linkageId, ClassName)`, reusing
   the same `encodeDoInitAction` machinery library symbols use. The export/init entries are
   merged into the symbol-pass result lists so the existing first-frame
   `ExportAssets → DoInitAction` emission (`compiler/frames.ts`, scene 0 frame 0) handles them.

`ComponentItem` now has an optional `linkage?: ComponentLinkage` (`{ className,
linkageIdentifier? }`, `packages/core/src/model/types.ts`) to override the derived class
name; when absent the compiler derives it. Unplaced library components emit nothing.

**Explicitly OUT OF SCOPE (Part 2, separate effort):** the real `mx.controls.*` AS2
framework, skins, and behaviour. Without it the component **registers but renders as an empty
placeholder sprite** — the accepted Part-1 outcome. The class is registered so
`attachMovie`/`registerClass`/`new ClassName()` resolve at runtime once Part 2 lands.

Acceptance: `packages/swf/src/__tests__/component-place.test.ts` publishes a doc with a placed
Button component, decodes the OWN compiled SWF (no real-Flash binary), and asserts (a) a
DefineSprite exists for it, (b) ExportAssets lists `mx.controls.Button`, (c) a DoInitAction
registers the class (`Object.registerClass` bytecode), and (d) the stage PlaceObject
references the synthetic sprite's char id.

## Functional component class + skin (task 1231, Part 2.1)

Part 2.1 is the **load-bearing first slice** that makes ONE placed component genuinely
**render and react** in the published SWF — using AS2 **we author**, NOT Adobe's real
`mx.*` framework, and with **no Halo skin asset**. It builds directly on Part 1's
ExportAssets + registerClass plumbing. For every placed component `runComponentPass` now
emits (all in `packages/swf/src/compiler/components.ts`):

1. **A self-authored AS2 class**, compiled with `compileAS2()` (`@flash/core`) and wrapped
   in a **raw-bytecode `DoInitAction`** (new `encodeRawDoInitAction` in
   `doInitAction.ts`). The class is authored as **dotted-global assignments** —
   `_global.mx.controls.Button = function(){…}` plus `…prototype.setLabel / onRelease /
   onRollOver / onRollOut / onLoad` — rather than `class` syntax, because the AS2 compiler's
   `compileClassDecl` only supports a single-identifier class name (it emits `Name =
   function` via ActionSetVariable) and a component's name is dotted. Authoring it at the
   global dotted path lets the existing registerClass `DoInitAction`
   (`ActionGetVariable "mx.controls.Button"`) resolve the constructor (AVM1 GetVariable
   walks the dotted path / falls back to `_global`). **The class-definition `DoInitAction`
   is pushed BEFORE the registerClass one** (array order = emission order in
   `compiler/frames.ts`), so the constructor exists when registerClass binds it.
2. **A real skin `DefineSprite`** replacing the Part-1 empty placeholder: a **DefineShape4**
   rounded-rect face (100×22 default, light-grey fill + grey border) and a **named
   DefineEditText `label_txt`**, both hoisted to top level (definition tags are forbidden
   inside a sprite) and placed via `PlaceObject2` on the sprite's single frame. The
   EditText uses a device font (no embedded `DefineFont3`).
3. **The author's label statically seeded** into the EditText's initial text at compile
   time (derived from `componentName`/`name`; live param-passing is a follow-on). The
   class `setLabel()` / `onLoad` also write `label_txt.text` at runtime.

### KEY UNKNOWN — RESOLVED: Ruffle binds DoInitAction classes via registerClass

The central open question for the whole Part-2 effort was: **does Ruffle bind a
DoInitAction-defined class (via `Object.registerClass`) to the exported placeholder sprite
at runtime?** The Ruffle oracle `apps/desktop/e2e/component-oracle.spec.ts` answers **YES,
confirmed**:

- **RENDER** — the published SWF shows ~2400 non-white, button-shaped pixels (the skin
  renders; not the Part-1 empty placeholder).
- **BINDING** — a root `onEnterFrame` polls `_root.myButton instanceof mx.controls.Button`
  and advances the stage **RED→BLUE only when true**. It flips to blue within a tick or
  two, proving the registerClass binding made the exported sprite an instance of the
  DoInitAction-defined class. (`onEnterFrame`, NOT headless `mouseDown`, per the
  headless-Ruffle clip-event constraint.)
- **NEGATIVE CONTROL** — an identical doc with **no component placed** never advances
  (stays red), proving the advance is impossible without the bound class.

Structural acceptance (`component-place.test.ts`, decoding our own SWF): the class
`DoInitAction` body contains `DefineFunction2` (0x8e) and is **ordered before** the
registerClass `DoInitAction`; the skin `DefineSprite` places a hoisted `DefineShape4` +
`DefineEditText`; the seeded label appears in the EditText InitialText.

**Still OUT OF SCOPE (later waves):** the full `mx.controls.*` AS2 framework, Halo skins,
and other controls (CheckBox / List / ComboBox / …).

## Live parameter passing (task 1232, Part 2.2)

Part 2.1 only *statically* seeded the EditText with a label derived from the component's
class/display name. The author's actual **per-instance** `componentParameters` (the
Component Inspector Parameters tab, task 1222, stored on the `SymbolInstance` model) did
not reach the runtime instance. Part 2.2 delivers them **live and GENERICALLY** — over the
whole catalog parameter set, not hardcoded to `Button.label`.

How it works:

1. **A generic setter on the authored class.** Every component skin's self-authored AS2
   class now carries `setComponentParam(name, value)` (in addition to `setLabel` /
   `setText`). It assigns `this[name] = value` and, for the `label`/`text` params, mirrors
   the value into the skin's `label_txt.text` so the visible caption updates. See
   `authorComponentClassBytecode` in `packages/swf/src/compiler/components.ts`.

2. **A per-instance param DoAction.** For each *placed* component instance, the frame loop
   (`compiler/frames.ts`) emits a `DoAction` **after** the instance's `PlaceObject2` on the
   same frame. `buildComponentParamScript(item, componentParameters, instanceName)` walks
   the **catalog** definition (`BUILTIN_COMPONENTS` / `getComponentDef`) and, for every
   parameter the author changed **from its catalog default**, emits
   `_root.<instanceName>.setComponentParam(name, value)`. Defaults are skipped (the
   constructor already seeds them). Values are typed from the catalog: `number`/`boolean`
   become bare literals, `string`/`list`/`array` become quoted strings.

3. **Instance naming.** Targeting `_root.<name>` requires the placement to carry an
   instance name. Placed components often have none authored, so the frame loop synthesizes
   a stable, unique fallback name (`__cmp_<scene>_<depth>`); an authored name always wins.

Because the mechanism is driven entirely by the catalog parameter definitions, future
controls (CheckBox / List / ComboBox / …) get author-param delivery for free once they ship
a skin + class — no per-control encoder code.

**Verification.** `packages/swf/src/__tests__/component-place.test.ts` ("live component
parameter delivery") decodes our own SWF and asserts the per-instance `setComponentParam`
DoAction carries the author's non-default param name+value (and is *absent* when all params
are at their defaults; and that an unnamed component still gets a synthesized addressable
name). The Ruffle acceptance oracle
`apps/desktop/e2e/component-oracle.spec.ts` ("v2 component LIVE parameter delivery")
publishes a Button with a **non-default** label and advances the stage RED→BLUE only when a
root `onEnterFrame` observes `_root.myButton.getLabel() == "<author value>"` — runtime proof
the author's param reached the live registerClass-bound instance (a default-labelled
instance can never satisfy the poll).

**Still OUT OF SCOPE (later waves):** the full `mx.controls.*` AS2 framework, Halo skins,
and the actual behaviours of params beyond `label`/`text` (e.g. `toggle`/`selected` visual
state, `data`/`labels` list population) — Part 2.2 guarantees the author's value *reaches*
`_root.<name>.<param>`; wiring each param into real control behaviour is per-control work,
gated on demand. Other controls (CheckBox / List / ComboBox / …) likewise await their skins.

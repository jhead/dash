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

## Functional CheckBox + RadioButton (task 1233, Part 2.3)

Part 2.3 extends the proven Part-2.1/2.2 infrastructure to two more form controls so the
tool has a usable minimal set (**Button / CheckBox / RadioButton**), and **generalizes the
class/skin emission so adding a control is registry-driven** rather than per-control
copy-paste. The new machinery lives in `packages/swf/src/compiler/components.ts`:

1. **A `ControlKind` discriminant** (`controlKindFor(className)`) resolved from the class
   name's trailing identifier (`CheckBox` → `checkbox`, `RadioButton` → `radiobutton`, else
   `button` — so the long tail and existing controls are unaffected).

2. **A `CONTROL_REGISTRY`** mapping each kind to a `ControlSpec`:
   - `buildMarks(w,h)` returns the control's **named overlay marks** — extra named children
     (`check_mk` tick / `dot_mk` dot) placed in the skin sprite at depth 3+. The skin sprite
     emitter (`encodeComponentSkinSprite`) now places face (depth 1) + `label_txt` (depth 2)
     + each mark (depth 3+). Marks carry their own hoisted `DefineShape4`.
   - `authorClassBody(fqn,labelLit)` returns the **control-specific AS2 method bodies**
     appended to a SHARED base class (constructor + label mirroring + `setComponentParam` +
     hover are emitted once for every control). The base `setComponentParam` forwards a
     `selected` param to `this.setSelected(...)` so the generic Part-2.2 delivery drives the
     toggle controls with **no control-specific plumbing in `frames.ts`**.

3. **Toggle skins**: CheckBox draws a small white indicator **box** at the left with a left-
   aligned label to its right; RadioButton draws an indicator **circle**. The check tick /
   radio dot are separate `DefineShape4` marks toggled via `_visible = selected`.

4. **Selection behaviour** (self-authored AS2, bound via the same registerClass DoInitAction):
   - **CheckBox** — a boolean `selected` toggled on each click; `setSelected` mirrors it into
     `check_mk._visible`. Honours author `selected`/`label`.
   - **RadioButton** — mutual exclusivity within a `groupName`: a `_root.__radioGroups`
     registry maps groupName → the currently-selected member, and selecting one deselects the
     prior member of its group. Carries `data`/`value` (`getValue()` prefers `value`). A radio
     cannot toggle itself off by clicking (Flash behaviour).

**Click path (headless-Ruffle constraint).** Button-mode `onPress`/`onRelease` are not
dispatched to a `registerClass`'d movieclip in the bundled Ruffle build, and that build's
`MovieClip.hitTest(x,y,flag)` returns false for these clips. The reliable path: a **broadcast
`onMouseDown`** (Ruffle dispatches it to every movieclip defining it) gated on a **manual
point-in-bbox test** (`__inBounds()` compares `_parent._xmouse/_ymouse` to the clip's
`_x/_y/_width/_height` — all in parent space). This was isolated empirically (a root `Mouse`
listener + manual bbox advances the frame; `hitTest` does not).

**Verification.** Structural unit tests (`component-place.test.ts`, "functional CheckBox +
RadioButton controls") decode our own SWF and assert each control emits its class-definition
DoInitAction (DefineFunction2) **before** registerClass, ExportAssets under the FQ class name,
a skin sprite that places a `DefineShape4` face + a named `DefineEditText` + the control's
mark (3 placements; 2 shapes), and that author `selected`/`groupName`/`data` params are
delivered via `setComponentParam`. The Ruffle acceptance oracle (`component-oracle.spec.ts`,
"v2 CheckBox + RadioButton runtime oracle") proves runtime behaviour: a placed CheckBox starts
deselected (background RED) and a click toggles `selected` → background advances RED→BLUE; a
two-member RadioButton group starts with A selected, and clicking B deselects A
(`rbB.getSelected() && !rbA.getSelected()`) → RED→BLUE, confirming single-selection.

## Functional Label + TextInput + TextArea (task 1234, Part 2.4)

Part 2.4 adds the three standard **text controls** on the SAME `CONTROL_REGISTRY` — no
per-control if-chains. These differ from the button family in two ways the registry now
expresses declaratively: they have **no indicator-overlay mark** (the EditText child *is*
the control), and their skin EditText must select its **editable/multiline flags** per
control.

1. **Two new `ControlSpec` fields:**
   - `faceKind` (`"button" | "toggle" | "input" | "none"`) — how/whether the skin draws a
     face. Button → rounded face; CheckBox/RadioButton → toggle box/circle; TextInput/
     TextArea → a **bordered white input box** (`buildInputFaceShape`); **Label → `none`**
     (no face shape is emitted at all; the EditText is the sprite's only child).
   - `textField` (`{ textType, multiline, wordWrap }`) — overrides the skin EditText's
     SWF flags. Label uses a read-only `dynamic` field; TextInput uses an editable `input`
     single-line field; TextArea uses an editable `input` **multi-line + word-wrapping**
     field. `encodeDefineEditText` turns `input` into an editable/selectable field (ReadOnly
     clear) and `dynamic` into read-only (ReadOnly set), and emits the Multiline/WordWrap
     bits from the booleans. `buildLabelTextObject` reads these from the registry so the
     field's type/layout follows the spec (Button centers; Label/inputs left-align, inputs
     inset 2px inside the border).

2. **`controlKindFor`** now also resolves `Label`/`TextInput`/`TextArea` leaf names to the
   new kinds; everything else still falls back to `button`.

3. **Class behaviour** (self-authored AS2, bound via the same registerClass DoInitAction):
   - **Label** — static display text. `__init` seeds `this.text` from the label; `getText`
     returns it. No click/selection handler (non-interactive). The shared
     `setComponentParam`/`setText` already mirror `text` into `label_txt.text`, so the live
     `text` param updates the display.
   - **TextInput / TextArea** — editable fields (shared class body). `getText` reads the
     live `label_txt.text`; `setText` writes it. `__init` installs an `onChanged` relay on
     the field that mirrors edits back into `this.text` and calls `dispatchChange()`, which
     fires an `addEventListener("change", …)` listener / `onChange` callback (Flash's mx
     change-broadcast shape). The multi-line difference between the two is purely the
     EditText flags, not the class.

**Verification.** Structural unit tests (`component-place.test.ts`, "functional text
controls") decode our own SWF and assert, for each control: ExportAssets under the FQ class
name, a class-definition DoInitAction (DefineFunction2) **before** registerClass, and the
skin EditText's decoded flags — **Label** read-only/single-line with **no face shape** (one
placement), **TextInput** editable/single-line, **TextArea** editable/**multiline+wordwrap**,
both with a bordered face + the editable field (two placements) — plus that a non-default
author `text` param is delivered via `setComponentParam`. The Ruffle acceptance oracle
(`component-oracle.spec.ts`, "v2 text controls runtime oracle") proves runtime behaviour:
each control's author text **renders** as non-blank pixels, and a root `onEnterFrame` polls
`label_txt.type == "input"` for TextInput/TextArea → RED→BLUE, confirming the EditText is
**editable** at runtime (a read-only `dynamic` field could never satisfy it).

**Keyboard-entry caveat (explicit):** headless Ruffle cannot be reliably driven to type
keystrokes into a focused input field, so keyboard EDITING is verified **structurally** (the
editable `input` EditText carries the editable flags, confirmed by both the unit test flag
decode and the runtime `type=="input"` probe). The oracle does **not** synthesize keypresses
and assert the field mutated — that path is acknowledged as not headless-drivable, not faked.

**Still OUT OF SCOPE (after Part 2.4):** the selection controls (List / ComboBox) — closed
by Part 2.5 below — and the remaining long tail (DataGrid / Tree / containers / data-binding)
plus the real Halo skin assets.

## Functional List + ComboBox (task 1235, Part 2.5)

Part 2.5 closes the standard-controls slice with the two **selection controls** on the SAME
`CONTROL_REGISTRY`. Unlike every prior control these need a **repeated-row skin**: the flat
compile-time model does not know the author's item count (delivered live via the `labels`/
`dataProvider`/`data` param), so the registry gains two declarative hooks and the skin emits a
**fixed pool of named row EditText children** plus a movable selection highlight.

1. **New registry plumbing (still declarative — no per-control if-chains):**
   - `extraTextFields(w,h)` on `ControlSpec` — extra named EditText skin children beyond the
     primary `label_txt`. List/ComboBox supply the row pool `row0_txt`..`row{N-1}_txt`
     (`LIST_ROW_POOL = 8`), each with its own placement + read-only `dynamic` type. Items
     beyond the pool are **not rendered** (scrolling is the deferred follow-on).
   - `SkinMark` gains an optional `(x,y)` placement so the selection-highlight shape
     (`hl_mk`) is placed on the first row and **re-positioned at runtime** by the class.
   - A new `faceKind: "list"` draws the bordered white field box (same `buildInputFaceShape`).
   - `encodeComponentSkinSprite` now layers depths so the highlight sits **below** the row
     text (rows read on top of the blue band) and the ComboBox arrow on top: face(1) →
     `hl_mk` → `label_txt` → row pool → remaining marks (`arrow_mk`).
   - `controlKindFor` resolves `List`/`ComboBox` leaf names; everything else still → `button`.

2. **Item delivery is the GENERIC param path — no new frames.ts plumbing.** The catalog
   `labels`/`data` params are `array`-typed; `paramValueLiteral` already delivers them as the
   model's comma-joined string via `setComponentParam`. Each control overrides
   `setComponentParam` to split that string (`__splitItems`) and call `setItems`, which seeds
   the row fields (`__seedRows`, hiding unused rows) and resets selection.

3. **Class behaviour** (self-authored AS2, bound via the same registerClass DoInitAction;
   shared row/selection machinery in `authorRowPoolHelpers`):
   - **List** — rows render stacked from y=0; `label_txt` is hidden (the rows are the
     content). A bbox-gated `onMouseDown` resolves the clicked row (`__rowAtMouse`) and
     `setSelectedIndex` reflects it into a movable `hl_mk` highlight. Exposes
     `getSelectedIndex`/`getSelectedItem`/`selectedIndex`/`selectedItem`, `getLength`,
     `getItemAt`, and a `change` broadcast (`addEventListener`/`onChange`).
   - **ComboBox** — a collapsed single-row display (`label_txt`) + a ▼ `arrow_mk` toggle;
     the row pool is the **dropdown**, placed one row below and hidden until opened.
     Clicking the collapsed row opens the dropdown (`__setOpen(true)`); clicking a dropdown
     row selects it, updates the collapsed label, and closes; a click-away closes it. Same
     selection API as List plus `isOpen`/`open`/`close`.

**ComboBox hit-test boundary (task 1237 polish).** The `onMouseDown` clickable area matches
the **visible** rows exactly: `bottom = _y + __rowTop + (open ? items*__rowHeight : 0)` and the
gate is `my <= bottom` (NOT `bottom + __rowHeight`). `__rowTop` is one row (the collapsed
display sits on top), so a **collapsed** box accepts clicks only in its single top row, and an
**open** box accepts the collapsed row + the N item rows — no phantom extra row below either.
`__setOpen` also toggles `arrow_mk._visible` (hidden while open, shown while collapsed; guarded
for `undefined`) so the open/closed state has a visual cue. Verified structurally in
`component-place.test.ts` ("corrected hit-test boundary (task 1237)") — a Ruffle hit oracle is
impractical because headless Ruffle does not dispatch global mouse clip (`onMouseDown`) events.

**Verification.** Structural unit tests (`component-place.test.ts`, "functional selection
controls") decode our own SWF and assert, per control: ExportAssets under the FQ class name, a
class-definition DoInitAction (DefineFunction2) **before** registerClass, the **fixed row pool**
of `label_txt + 8` placed EditTexts plus the highlight (List = face+highlight; ComboBox =
face+highlight+arrow), and that the author's `labels` reach `setComponentParam`. The Ruffle
acceptance oracle (`component-oracle.spec.ts`, "v2 selection controls runtime oracle") proves
runtime behaviour with the RED→BLUE pattern: the author's items reach + parse into the live
instance (`getItemAt(0)` == first item), a **List row click selects it** (`getSelectedIndex()`
== clicked row), and the **ComboBox toggle opens the dropdown** (`isOpen()`).

**Render-oracle note (explicit):** the field box is a white fill on a white
`SetBackgroundColor`, so a raw non-white pixel count is an unreliable render signal for these
controls (it reads ~0). The oracle therefore probes the **live item/selection model**
(RED→BLUE) rather than counting pixels — the meaningful proof that items rendered into the rows
AND selection/toggle work. Not faked: the model probe runs in real Ruffle.

**DEFERRED as follow-on (NOT built):** a live scrollbar / scrolling for lists longer than the
fixed row pool, and keyboard navigation (arrow-key row movement). Both are explicitly out of
this slice's scope.

## Functional NumericStepper + ProgressBar (task 1288, Part 2.6)

Part 2.6 adds the two remaining COMMON standard controls on the SAME `CONTROL_REGISTRY` — no
per-control hand-coding beyond a registry entry + an `authorClassBody`.

1. **Skin.** Both reuse the shared hoisted-definition + DefineSprite path.
   - **NumericStepper** (catalog 60×22): `faceKind: "input"` (a bordered white field box) +
     a read-only `dynamic` `label_txt` VALUE field whose width is shrunk by the right-hand
     `STEPPER_BTN_WIDTH` (16px) arrow column, plus two arrow marks `up_mk` (top half) and
     `down_mk` (bottom half).
   - **ProgressBar** (catalog 150×16): `faceKind: "progressbar"` (a bordered GREY track
     groove) + a single `fill_mk` blue bar authored at FULL inner width. `label_txt` is
     hidden (the bar is the content).
   - `controlKindFor` resolves the `NumericStepper`/`ProgressBar` leaf names; everything else
     still → `button`.

2. **Class behaviour (registry `authorClassBody`).**
   - **NumericStepper** seeds the author's `value`/`minimum`/`maximum`/`stepSize` (catalog
     params, guarded for `undefined`), clamps `value` into `[minimum, maximum]`, and renders
     `String(value)` into `label_txt`. Its OVERRIDDEN `setComponentParam` re-clamps + re-renders
     when `value`/`minimum`/`maximum` arrive live. The shared manual-bbox `onMouseDown` gate is
     refined to count ONLY presses in the right arrow column (`mx >= _x + _width - btnWidth`):
     the top half `stepUp()` (+`stepSize`, clamped), the bottom half `stepDown()`. Exposes
     `getValue`/`setValue`/`stepUp`/`stepDown` + a `change` broadcast.
   - **ProgressBar** is NON-interactive. It has NO `value`/`maximum` CATALOG param, so progress
     is driven at RUNTIME (Flash's `manual` mode) via `setProgress(done, total)` / `setValue(v)`
     / `setMaximum(m)`; `value`/`maximum` default to 0/100. `__render` scales `fill_mk._xscale`
     to `value/maximum` (clamped to 0..100%) so the bar length is proportional, and honors the
     author's `direction` param ("left" pins the bar's right edge to the track's right edge).
     Exposes `getValue`/`getMaximum`/`getPercentComplete`.

3. **Verification.** Structural unit tests (`component-place.test.ts`, "functional NumericStepper
   + ProgressBar controls") decode our own SWF and assert, per control: ExportAssets under the FQ
   class name, a class-definition DoInitAction (DefineFunction2) **before** registerClass, and the
   skin shapes placed inside the sprite (NumericStepper = track face + up_mk + down_mk = 3 shapes
   + 1 EditText; ProgressBar = track face + fill_mk = 2 shapes + 1 EditText). Source-level
   assertions pin the clamp/step/getValue-setValue (NumericStepper) and the `_xscale`-proportional
   fill / setProgress / direction handling (ProgressBar). The Ruffle acceptance oracle
   (`component-oracle.spec.ts`, "v2 NumericStepper + ProgressBar runtime oracle") proves runtime
   behaviour with the RED→BLUE pattern: the **NumericStepper UP-button click increments** the
   value (`getValue() > 0` after the click on the up arrow), and **ProgressBar `setProgress(80,
   100)` reflects into the fill** (`getPercentComplete() >= 75`).

**Render-oracle note (explicit):** as with the selection controls, a raw non-white pixel count is
an unreliable render signal here — the z-indexed headless wgpu-webgl player returns a blank
capture for the small top-left skin (both `page.screenshot` and `locator().screenshot()`). The
oracle therefore probes the **live behaviour** (RED→BLUE: up-click increments; setProgress fills)
rather than counting pixels, which is the meaningful proof the skins render AND react. The static
skin shapes are covered structurally in the swf unit tests. NumericStepper keyboard entry into
the value field is NOT exercised (headless Ruffle cannot be reliably driven to type into a field);
the value is changed via the arrow buttons + `setValue` instead.

**Still OUT OF SCOPE:** DataGrid / Tree / DateChooser / ScrollPane / Window / containers /
Accordion / Menu / data-binding, and the real Halo skin assets remain gated on demand.

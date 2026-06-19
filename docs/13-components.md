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

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

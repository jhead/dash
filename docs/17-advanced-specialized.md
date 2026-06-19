# 17 — Advanced & Specialized Features

Lower-priority but definitive Flash 8 capabilities. Most are **Flash Professional 8** only.
These are real parity targets but reasonable to schedule in later phases.

## Accessibility

**Status: implemented (task 1202)**

- **Accessibility panel** — `Window > Accessibility` floating panel. Document section:
  "Make movie accessible", "Make child objects accessible", "Use custom tab order" checkboxes.
  Object section (shown when a SymbolInstance or text object is selected): "Make object
  accessible" checkbox, Name, Description, Shortcut, Tab index fields, and "Force simple"
  checkbox.
- **Model**: `DocumentAccessibility` on `FlashDocument.accessibility`; `ObjectAccessibility`
  on `SymbolInstance.accessibility` / `TextDisplayObject.accessibility`. Both are pure-data
  interfaces in `packages/core`. Changes propagate through history via `pushDoc`.
- **SWF emit** (`packages/swf/src/compiler/frames.ts`):
  - `useCustomTabOrder=true` → emits a DoAction `_root.tabChildren = false;` on frame 0.
  - Instance with `accessibility.tabIndex` + `instanceName` → emits DoAction
    `_root.name.tabEnabled = T; _root.name.tabIndex = N;` when first placed.
  - Instance with `accessibility.name/description/shortcut/forceSimple` + `instanceName`
    → emits a DoAction that sets `_accProps` on the instance:
    `var _ap=new Object(); _ap.name="…"; … _root.name._accProps=_ap;`
  - Instance with `accessibility.enabled === false` ("Make object accessible" unchecked)
    + `instanceName` → emits `_ap.silent = true;` so MSAA screen readers skip the
    instance. Emitted alongside any other `_accProps` fields (Flash still silences the
    object even when name/description/etc. are also set). Document-level
    `DocumentAccessibility.enabled` is a separate, document-wide setting.
- Per-object and per-document accessibility settings; `_accProps` via ActionScript;
  `System.capabilities.hasAccessibility`.
- **Tab order / reading order** — author tab index for keyboard navigation; Accessibility
  panel tab-order tools (Pro).
- Accessible v2 components (`enableAccessibility()`); captions/text alternatives for
  hearing-impaired users — **not yet implemented**.

## Screens — Slides & Forms (Pro only)

A screen-based authoring paradigm layered over timelines:

- **Slide presentations** — sequential, slide-deck style (built-in nav/transitions).
- **Form applications** — nested, application-style screens (state shown/hidden).
- **Screen Outline pane** — tree of screens; add/nest/name/reorder.
- Per-screen properties/parameters; transitions/behaviors; ActionScript via the screen class
  hierarchy (`mx.screens.*`: `Screen`, `Slide`, `Form`).

## Data Integration (Pro only)

Bind external data into a movie largely without code:

- **Connectors**: `XMLConnector`, `WebServiceConnector` (SOAP/WSDL).
- **`DataSet`** — client-side data with deltas/transactions.
- **Data binding** — wire component properties to data via the Component Inspector
  **Bindings** + **Schema** tabs.
- **Resolvers**: `XUpdateResolver`, `RDBMSResolver` for round-tripping changes.

## E-learning (Pro templates)

- **Learning interactions** (templates): Drag-and-Drop, Fill-in-the-Blank, Hot Object,
  Hot Spot, Multiple Choice, True/False.
- Quiz templates with scoring, feedback, navigation, control buttons.
- **AICC / SCORM** tracking to LMSs (Knowledge Track).

## Printing from SWF

- The **`PrintJob`** class (`addPage`, `start`, `send`) for high-quality, paginated printing
  from content.
- Frame-label `#p` to mark printable frames; `#b` for print bounding box; legacy
  `print()`/`printAsBitmap()`.
- Disable printing via frame labels; control printed background color.

## Templates & automation

- **Document templates** (`File > New from Template`): advertising, banners, mobile,
  presentations, quiz, photo slideshows, etc.
- **Commands menu / History panel** — save replayable command sequences.
- **JSFL (Flash JavaScript API)** — script the authoring tool (`.jsfl`), the basis for
  custom commands, tools, and extensions (Extension/MXP packaging). A strong **future**
  extensibility target.
- **XML-to-UI** — define custom dialog UIs (used by commands/effects).

## Mobile authoring (Flash Lite)

- Publish targets for **Flash Lite 1.x/2.x** with device emulation/templates (Pro).
- Lower-priority for a desktop-focused clone, but part of the definitive feature set.

## Accuracy targets

- Accessibility data must surface to platform screen readers (where the host allows) and
  match `_accProps` semantics.
- `PrintJob` pagination and `#p`/`#b` frame-label behavior.
- Screens class hierarchy + transitions behave as Flash 8 (if/when implemented).
- E-learning SCORM/AICC tracking payloads match the template scripts.

## Implementation notes

- Treat these as **post-core milestones**: implement after the authoring core, rendering,
  ActionScript, and SWF/FLA I/O are solid.
- JSFL is the highest-leverage extensibility investment — design the document model + command
  system (`01`) to be scriptable from day one so JSFL can be layered on later.
- Screens, data, and e-learning are largely **AS2 + components** on top of the runtime, so
  they mostly fall out of correct `12`/`13` implementations.

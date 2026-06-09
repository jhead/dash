# 12 — ActionScript 1 & 2

Flash 8 uses **ActionScript 1.0 and 2.0**, both executed by **AVM1** (ActionScript Virtual
Machine 1) in Flash Player 8. (ActionScript 3 / AVM2 arrived later, in Player 9 — out of
scope for Flash 8 fidelity, but a candidate for future expansion.)

## Language overview

- **ECMAScript-derived**, dynamically typed at runtime.
- **AS1** — prototype-based, loose, frame/object handlers (`onClipEvent`, `on`).
- **AS2** — adds compile-time **classes, interfaces, packages, inheritance, type
  annotations, getters/setters, access modifiers** — all compiled **down to AS1/AVM1
  bytecode** (type checks are author-time only).
- Data types: Number, String, Boolean, Object, Array, MovieClip, Function, `null`,
  `undefined`. `==` vs `===`, `typeof`, `instanceof`.
- Control flow, `for..in`, `with`, `try/catch/finally`, `switch`.

## Where code lives

- **Frame scripts** — attached to keyframes (run when the playhead reaches them).
- **Object scripts** — on button/MovieClip instances via `on(...)` / `onClipEvent(...)`
  (AS1 style).
- **External `.as` files / classes** — AS2 class files compiled into the SWF.
- **`#include`** directives.

## Actions panel

`Window > Actions` (F9):

- Code editor with syntax highlighting, code hints, auto-format, **Check Syntax**.
- **Actions toolbox** — categorized API tree to insert statements.
- **Script Assist mode** (new in 8, replaces "Normal mode") — form-based, fill-in-the-blanks
  authoring of statements without typing syntax (see also `13`).
- Pin scripts, find/replace, debugger integration, breakpoints.

## Scope & timeline model

- **`this`**, **`_root`**, **`_parent`**, **`_global`**, `_levelN`.
- Target paths (dot and slash syntax) to address nested clips.
- Variables on timelines; `var` (local in functions) vs timeline properties.
- Frame execution order and the **frame action** lifecycle within a frame.

## Events

- **MovieClip events**: `onLoad, onEnterFrame, onUnload, onMouseDown/Up/Move,
  onKeyDown/Up, onPress, onRelease, onReleaseOutside, onRollOver/Out, onDragOver/Out,
  onData, onSetFocus, onKillFocus`.
- **Button events**: `onPress, onRelease, onReleaseOutside, onRollOver, onRollOut,
  onDragOver, onDragOut, onKeyUp/Down`.
- AS1 handlers `onClipEvent(...)` / `on(...)`; AS2 listener model (`addListener`,
  `AsBroadcaster`), `setInterval`/`clearInterval`.

## Core API surface (AVM1) to implement

Representative, not exhaustive — the goal is full Player 8 AS2 stdlib parity:

- **Display/timeline**: `MovieClip` (createEmptyMovieClip, attachMovie, duplicateMovieClip,
  getNextHighestDepth, swapDepths, hitTest, startDrag, getBounds, localToGlobal, beginFill,
  lineStyle, moveTo, lineTo, curveTo, beginGradientFill, beginBitmapFill, etc.), `Button`,
  `TextField`, `TextFormat`, `StyleSheet`, `Stage`, `MovieClipLoader`, `Mouse`, `Key`,
  `ContextMenu`/`ContextMenuItem`.
- **Drawing API** — runtime vector drawing on MovieClips (lineStyle/beginFill/curveTo…).
- **Data/IO**: `LoadVars`, `XML`, `XMLNode`, `XMLSocket`, `SharedObject` (local storage),
  `NetConnection`, `NetStream`, `LocalConnection`, `System`, `System.capabilities`,
  `System.security`, External API (`ExternalInterface` via `flash.external`), `fscommand`.
- **Media**: `Sound`, `Video`, `Camera`, `Microphone`, `NetStream`.
- **Graphics (new in 8)**: `flash.display.BitmapData`, `flash.filters.*` (DropShadowFilter,
  BlurFilter, GlowFilter, BevelFilter, GradientGlowFilter, GradientBevelFilter,
  ColorMatrixFilter, ConvolutionFilter, DisplacementMapFilter), `flash.geom.*`
  (Matrix, Point, Rectangle, ColorTransform, Transform), `MovieClip.filters`,
  `cacheAsBitmap`, `scrollRect`, `blendMode`, `scale9Grid`, `opaqueBackground`.
- **Language**: `Object, Array, String, Number, Boolean, Math, Date, Function, RegExp(?),
  Error`, `Color` (legacy), `setInterval/setTimeout`.
- **Globals**: `trace`, `gotoAndPlay/Stop`, `play/stop`, `getURL`, `loadMovie/unloadMovie`,
  `loadVariables`, `stopAllSounds`, `getTimer`, `updateAfterEvent`, `targetPath`, etc.

## Debugging & testing

- **Test Movie** (Ctrl/Cmd+Enter) — compile + run in the player.
- **Debugger** — variables, watch, call stack, breakpoints; `trace()` to Output panel.
- **Bandwidth Profiler** (in test mode) — frame-by-frame size/streaming graph.

## Accuracy targets

- AVM1 execution semantics: type coercion, scope chain, `with`, prototype lookup, event
  order, frame timing — must match Player 8 observable behavior.
- AS2 compiler emits the same AVM1 actions Flash 8 produced (or behavior-equivalent),
  including class → prototype translation and `__proto__`/`__constructor__` wiring.
- Drawing API, BitmapData, filters, geom classes match Flash 8 numeric results.

## Implementation notes

- One part: an **AS1/AS2 compiler** (lexer/parser → AVM1 action bytecode in `DoAction`
  tags). **We do not implement an AVM1 interpreter/VM — this is explicitly out of scope.**
  All execution happens in Ruffle; do not create tasks to build a custom interpreter.
- For playback fidelity, **Ruffle's AVM1** is the sole execution engine and the reference;
  our compiler output is validated against Ruffle + Flash Player 8 captures.
- Authoring-time stage playback is geometry/tween preview only (no script execution).
  Running scripts means Test Movie: publish the SWF and play it in the embedded Ruffle.

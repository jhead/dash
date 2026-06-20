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

## AS2 class compile pipeline (`doc.asClasses` → SWF)

External `.as` class files attached to the document (`FlashDocument.asClasses`, each
`{ path, source }`; classpaths in `FlashDocument.classpaths`) are compiled into the
published SWF so library symbols linked to a class resolve at runtime.

Pipeline (all in `@flash/swf compileDocument`, orchestrated by `compile.ts`):

1. **`runSymbolPass`** (`compiler/symbols.ts`) emits, for every library symbol whose
   linkage has `exportForActionScript` + a `className`, an `ExportAssets` entry
   (`linkageIdentifier → charId`) and a **registerClass** `DoInitAction`:
   `Object.registerClass(linkageId, ClassName)`. `ActionGetVariable ClassName`
   resolves a dotted name (`com.example.Foo`) by walking the path.
2. **`runClassPass`** (`compiler/classes.ts`, task 1299) parses every `asClasses`
   entry, **topologically orders them by `extends`** (a superclass DoInitAction must
   run before a subclass's — `ActionExtends` dereferences the superclass constructor),
   compiles each via `compileAS2`, and wraps it with `encodeRawDoInitAction` as a
   **class-DEFINITION** DoInitAction. v1 compiles EVERY `asClasses` entry
   deterministically; `import` is a pure resolution hint (no bytecode).
3. **Ordering (load-bearing):** the orchestrator **prepends** the class-definition
   bodies BEFORE the symbol-pass registerClass bodies in `doInitActionBodies`, so the
   constructor exists in `_global` when registerClass resolves it. All DoInitActions are
   emitted in scene-0 frame-0, after `ExportAssets`/`ImportAssets2`, before any
   `PlaceObject`. This mirrors the v2-component pass (`compiler/components.ts`), which
   solves the same definition-before-binding problem for synthesized `mx.controls.*`.

**Fully-qualified names** (`com.example.Foo`) register at `_global.com.example.Foo`. The
parser (`as2/parser.ts`) accepts a dotted class/interface name (`parseTypeName`), and
`compileClassDecl` (`as2/compiler.ts`) emits `_global`-anchored package guards
(`if (_global.com == undefined) _global.com = {}; …`) BEFORE the class binding —
AVM1's `resolve_target_path` does NOT auto-create missing intermediate package objects,
so a bare dotted `ActionSetVariable` would silently no-op without them. The constructor
method is matched by the LEAF segment (`Foo`), not the dotted name.

**Interfaces** compile to an empty global constructor (`IFoo = function(){};`) so a
class's `implements` clause — `ActionImplementsOp` (0x2c), which does
`ActionGetVariable "IFoo"` — resolves to a real value. (Previously a no-op.)

**Instance field initializers are hoisted into the constructor (task 1314).** A class
instance field declared with an initializer — `var n:Number = 7;` or `private var vy =
0;` — is compiled to a `this.<name> = <init>;` assignment at the START of the constructor
body, BEFORE the author's constructor statements (Flash 8 ordering). If the class has no
explicit constructor, `compileClassDecl` synthesizes one containing only these
assignments. This matches real Flash 8 / MTASC and is the ONLY way the initial value runs
for EVERY instance — in particular a MovieClip symbol linked to the class via `className`
linkage and placed on stage or `attachMovie`d: Ruffle sets such an instance's `__proto__`
to `ClassName.prototype` and invokes the class constructor, so the previous behavior
(emitting the initializer as a SHARED `ClassName.prototype.n = 7` assignment) did not take
effect for className-linked placed instances — the field read `undefined`, cascading to
`NaN`. Only **instance** field initializers move into the constructor; **static** fields
stay on the class object (`ClassName.n = …`), and methods stay on the prototype. An
instance field with NO initializer emits nothing (an unset field is simply `undefined`,
as in Flash). For a subclass, `super(...)` (written first in the user body) still runs
after these own-property writes, which is valid because `ActionExtends` linked the
prototype chain at class-definition time; Flash likewise initializes field defaults before
executing the authored constructor body.

**Acceptance:** structural unit tests in `packages/swf/src/__tests__/classes.test.ts`
(definition-before-registerClass ordering; extends ordering; dotted-name registration)
PLUS the Ruffle runtime oracles: `apps/desktop/e2e/as2-class-attach.spec.ts` — a `.as`
class linked to a library MovieClip, `attachMovie`d at runtime, whose method `trace()`s
a known line surfaced through Ruffle's trace observer — and
`apps/desktop/e2e/as2-class-field-init.spec.ts` (task 1314), which links a class with a
field initializer to a MovieClip, attaches it, and asserts the field reads the INITIALIZED
value at runtime (7 with no constructor; 15 = 5+10 with an explicit constructor, proving
the initializer ran before the ctor body). Byte-presence tests are necessary but not
sufficient; the Ruffle e2e is the gate.

# 00 — Overview & Architecture

## What this project is

A faithful re-implementation of the **Macromedia Flash Professional 8** authoring tool
_and_ a compatible playback runtime, built for modern browsers and packaged as a desktop
app. It must reproduce Flash 8's authoring experience and output format with high fidelity,
while taking advantage of GPU acceleration and modern engineering.

Flash 8 shipped in two editions; we target the **Professional 8** feature superset:

- **Flash Basic 8** — core drawing, animation, text, symbols, ActionScript.
- **Flash Professional 8** — adds filters, blend modes, On2 VP6 video + alpha,
  custom easing, 9-slice scaling, the standalone Video Encoder, Screens, Script Assist,
  data integration, and project management.

## Accuracy strategy (non-negotiable)

1. **Tool parity.** Each tool reproduces Flash 8's exact behavior, options/modifiers,
   default values, and keyboard shortcut. See `04-toolbox.md`.
2. **Rendering parity.** Vector rasterization, anti-aliasing (FlashType), strokes
   (caps/joins/scaling), gradients, filters, and blend modes must match the original
   visually. Differences should be measurable against reference SWFs in Flash Player 8 /
   Ruffle.
3. **Format parity.** Output is valid **SWF v8**; project files round-trip through **FLA**.
   See `15-file-formats-fla-swf.md`.
4. **Runtime parity.** AVM1 (AS1/AS2) semantics, display-list/depth model, frame timing,
   and the document object model match Flash Player 8. See `12-actionscript.md` and
   `16-player-runtime.md`.
5. **Regression harness.** A golden-file test suite renders authored content and compares
   against Flash Player 8 / Ruffle reference captures, frame by frame.

## High-level architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Desktop shell (Tauri or Electron) — webview + native FS/dialogs │
├──────────────────────────────────────────────────────────────┤
│ Authoring UI (panels, docking, menus, dialogs)                  │
│   Stage view · Timeline · Tools · Library · Color · Actions ... │
├──────────────────────────────────────────────────────────────┤
│ Document model (FLA in memory): scenes, timelines, layers,      │
│   frames, symbols, library, AS classes — the "edit graph"       │
├──────────────────────────────────────────────────────────────┤
│ Engines                                                          │
│   • Vector/scene engine (drawing models, geometry, booleans)    │
│   • Render engine (GPU: WebGL2/WebGPU + shaders)                 │
│   • Animation/tween engine (motion, shape, easing)              │
│   • AS1/AS2 → AVM1 compiler (execution: Ruffle only)            │
│   • Media pipeline (image/audio/video decode + encode)          │
├──────────────────────────────────────────────────────────────┤
│ I/O                                                              │
│   • FLA reader/writer (project save/open)                       │
│   • SWF compiler (publish/export) + tag writer                  │
│   • Player: Ruffle (test/playback) + custom render path         │
└──────────────────────────────────────────────────────────────┘
```

## Proposed technology stack

| Concern         | Choice                                                       | Rationale                                                                                    |
| --------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Desktop shell   | **Tauri** (preferred) or Electron                            | Native FS/dialogs for FLA/SWF, smaller footprint; user rule favors a pre-scaffolded monorepo |
| UI framework    | React + TypeScript                                           | Mature panel/docking ecosystem                                                               |
| Package mgmt    | **pnpm + corepack** (monorepo)                               | Per user rule; scaffold workspaces up front                                                  |
| Rendering       | **WebGPU** (preferred) → WebGL2 fallback                     | Shader-based vector fills, filters, blend modes, bitmap caching                              |
| Vector geometry | Custom + (e.g. Lyon/earcut-style tessellation)               | Match Flash fill/stroke rules incl. even-odd + edge merging                                  |
| Text shaping    | HarfBuzz (wasm) + custom FlashType-style rasterizer          | Match anti-aliasing settings                                                                 |
| ActionScript    | Custom AS1/AS2 compiler; **no custom interpreter** (Ruffle executes) | Compiling is the gap Ruffle doesn't fill; re-implementing AVM1 would duplicate Ruffle |
| SWF I/O         | Custom writer; parser reuse from Ruffle's `swf` crate        | Standards-accurate tags                                                                      |
| Playback        | **Ruffle** (wasm) embedded for test movie                    | Proven AVM1/AVM2 emulator                                                                    |
| Media codecs    | wasm decoders/encoders (MP3, ADPCM, JPEG, PNG, GIF, FLV/VP6) | Import + publish                                                                             |

> Per project rules, when implementing against any of these libraries we verify current
> APIs from their live docs rather than assuming.

## GPU / shader usage

- **Vector fills**: tessellate paths to triangles; solid/gradient/bitmap fills as shaders.
- **Gradients**: linear/radial computed in fragment shaders (incl. focal/overflow modes).
- **Strokes**: GPU stroking with Flash 8 cap/join/scale semantics.
- **Filters**: drop shadow, blur (separable Gaussian), glow, bevel, gradient glow/bevel,
  adjust color — all as render-to-texture shader passes.
- **Blend modes**: 14 author-exposed modes implemented as blend state + shader composites.
- **Runtime bitmap caching**: cache a clip's rendered texture and transform it on the GPU.
- **Color transforms**: per-instance multiply/add color applied in shader.

## Build / packaging targets

- **Authoring app**: desktop (macOS/Windows/Linux) via webview; optional browser build.
- **Exports**: `.swf` (v8), projector (self-contained app), images (PNG/JPEG/GIF), and
  HTML embed pages. See `14-publishing-export.md`.

## Glossary (Flash-specific terms)

- **Stage** — the rectangular authoring/playback canvas.
- **Timeline** — frames × layers; the time axis of a movie or symbol.
- **Symbol** — reusable asset (MovieClip / Button / Graphic) stored in the Library.
- **Instance** — a placed copy of a symbol on the Stage.
- **Tween** — interpolated animation (motion or shape).
- **Keyframe** — a frame where content/state is explicitly defined.
- **Depth / display list** — z-ordering and the set of objects rendered per frame.
- **AVM1** — ActionScript Virtual Machine 1 (runs AS1/AS2).
- **SWF** — compiled, published movie (the deliverable).
- **FLA** — editable project/source file.

# Flash 8 Clone — Feature Documentation

A pixel- and behavior-accurate clone of **Macromedia Flash Professional 8** (2005),
rebuilt on modern web technologies and packaged as a desktop application.

## Project goals

- Fully functioning **Stage/canvas**, **Timeline**, and **vector graphics** engine.
- An **identical toolbox** to Flash 8 (every tool, modifier, and shortcut).
- **ActionScript 1 & 2** authoring + runtime (AVM1 semantics).
- Full **symbol model**: MovieClip, Button, Graphic, plus instances and the Library.
- A **player** for testing/playback (Ruffle-based, with a custom renderer path).
- **Produces SWF files** (target: SWF v8 / Flash Player 8).
- **Saves and opens FLA project files**.
- Runs in a **web browser / desktop webview** (e.g. Tauri/Electron).
- Heavy use of **GPU acceleration / shaders** for rendering and effects.

## Documentation

These documents define **what Flash 8 actually did**, domain by domain, so that the
implementation can reproduce it *exactly*. Each doc lists the definitive feature set,
notes Flash 8–specific behaviors that must be matched, and includes light implementation
notes mapping the feature onto the clone's web stack.

> **Guiding principle — accuracy first.** Every authoring tool, panel, and runtime
> behavior must work *identically* to Flash 8. New features/tools/APIs may be added
> later, but never at the expense of fidelity to the original.

Start with `00-overview-and-architecture.md`, then read by domain.

| # | Document | Domain |
|---|----------|--------|
| 00 | [Overview & Architecture](./00-overview-and-architecture.md) | Vision, tech stack, accuracy strategy |
| 01 | [Documents, Stage & Scenes](./01-documents-stage-scenes.md) | Document model, stage, scenes, timelines |
| 02 | [Timeline & Animation](./02-timeline-and-animation.md) | Frames, layers, tweens, easing |
| 03 | [Drawing & Vector Graphics](./03-drawing-vector-graphics.md) | Drawing models, shapes, strokes |
| 04 | [Toolbox](./04-toolbox.md) | Every tool, options, shortcuts |
| 05 | [Color, Strokes & Fills](./05-color-strokes-fills.md) | Color Mixer, gradients, fills |
| 06 | [Text & Typography](./06-text-typography.md) | Text types, FlashType, fonts |
| 07 | [Symbols, Instances & Library](./07-symbols-instances-library.md) | Symbols, library, 9-slice, caching |
| 08 | [Filters & Blend Modes](./08-filters-blend-modes.md) | Filters, blends (Pro) |
| 09 | [Bitmaps & Imported Artwork](./09-bitmaps-imported-artwork.md) | Image import, BitmapData |
| 10 | [Sound](./10-sound.md) | Audio import, sync, compression |
| 11 | [Video](./11-video.md) | FLV, On2 VP6, FLVPlayback |
| 12 | [ActionScript 1 & 2](./12-actionscript.md) | Language, AVM1, APIs, Actions panel |
| 13 | [Components](./13-components.md) | V2 component architecture |
| 14 | [Publishing & Export](./14-publishing-export.md) | Publish settings, formats |
| 15 | [File Formats: FLA & SWF](./15-file-formats-fla-swf.md) | Project + output binary formats |
| 16 | [Player Runtime](./16-player-runtime.md) | Display list, playback, Ruffle |
| 17 | [Advanced & Specialized](./17-advanced-specialized.md) | Accessibility, screens, data, printing |
| 18 | [Verification & Agent Automation](./18-verification-and-automation.md) | E2E test harness, SWF oracles, automation bridge, JSFL |
| 19 | [Agent Control Interface](./19-agent-interface.md) | MCP server + thin CLI: live editor control for LLM agents |

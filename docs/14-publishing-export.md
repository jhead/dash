# 14 — Publishing & Export

Turning an FLA into deliverables. **Publish** generates the SWF (+ wrappers/alt formats);
**Export** produces single files/sequences.

## Publish Settings

`File > Publish Settings` — tabbed dialog; selectable formats each add a tab.

### Formats
- **Flash (.swf)** — the primary output.
- **HTML (.html)** — wrapper page embedding the SWF (templates, sizing, params).
- **GIF, JPEG, PNG** — static or (GIF) animated image versions.
- **Windows Projector (.exe)** / **Macintosh Projector** — standalone self-running apps.
- **QuickTime (.mov)** (legacy).

### Flash (SWF) tab
- **Version** — target Flash Player (default **Flash Player 8** → SWF v8).
- **ActionScript version** — AS1 / AS2.
- **Load order** — bottom-up / top-down.
- **JPEG quality** (global bitmap quality), audio stream/event defaults (see `10`).
- **Generate size report**, **Protect from import**, **Omit trace actions**,
  **Permit debugging** (+ password), **Compress movie** (zlib, Player 6+),
  **Optimize for Flash Player 6 r65**, **local playback security** (local/network),
  **hardware acceleration** metadata.
- Script time limit.

### HTML tab
- Template (e.g. Flash Only, Image, Detect-version), dimensions (%/px/match),
  playback (loop, menu, device font), quality, window mode (window/opaque/transparent),
  scale, alignment, **Flash version detection**, `<object>/<embed>` params.

## Publish profiles
- Named, saved Publish Settings configurations; import/export profiles for reuse/sharing.

## Test / preview
- **Test Movie** (Ctrl/Cmd+Enter) and **Test Scene**; **Publish Preview** per format.
- **Bandwidth Profiler** + **simulate download** for streaming analysis.

## Export
- **Export Movie** — SWF, image sequences (PNG/JPEG/GIF/BMP), animated GIF, QuickTime, AVI
  (Win), WAV (Win audio), SWF.
- **Export Image** — current frame/selection to PNG/JPEG/GIF/BMP/PICT/etc.
- **Export file formats** vary by OS (QuickTime/PICT on Mac; AVI/WMF/EMF on Win).

## Accuracy targets

- SWF v8 output must be valid and play in Flash Player 8 / Ruffle, including FileAttributes
  (first tag for SWF 8+), Metadata, compression, and protect/debug flags.
- Publish Settings options must map to the correct SWF header bits/tags.
- HTML templates and detection markup should match Flash 8's generated output closely.
- Projector = SWF bundled with a player executable (we bundle a Ruffle/desktop runtime).

## Implementation notes

- The **SWF compiler** walks the document model → tag stream (`15`), applying publish
  options (compression, AS version, bitmap/audio settings).
- Projector export bundles the SWF with the desktop runtime shell.
- Image/sequence export renders frames via the GPU render engine to PNG/JPEG/GIF encoders.

# 11 — Video

Video was a headline area for Flash 8, adding the **On2 VP6** codec and alpha-channel video.

## Codecs

- **Sorenson Spark** — the legacy codec (Flash Player 6/7 compatible).
- **On2 VP6** (new in Flash 8) — higher quality at smaller sizes; **8-bit alpha channel**
  support → video with transparency composited over Flash content. Requires Flash Player 8.
- Audio in video: typically MP3.

## Flash Video format (FLV)

- **FLV** is Flash's video container (video + audio + metadata + **cue points**).
- Video can be **embedded** in the SWF/timeline or played **externally** (streamed/progressive)
  from an FLV file.

## Importing video

The **Video Import wizard**:

- Source: local file or already-deployed (progressive/streaming/FMS) URL.
- Deployment choice: progressive download, stream (Flash Media Server), or **embed in SWF**.
- **Encoding profiles**: codec (Spark/VP6), data rate, quality, dimensions, frame rate,
  keyframe interval, audio settings, **alpha** (VP6).
- **Crop & trim**, advanced settings, and **cue points** (Event / Navigation) with names and
  parameters.
- Choose a **skin** for the playback component.

## Standalone Flash Video Encoder (Pro)

A separate app shipped with Flash Pro 8 for **batch** encoding many files to FLV with the same
profiles (Spark/VP6, alpha, cue points).

## Playback options

- **FLVPlayback component (Pro)** — drop-in external-FLV player with skins, cue-point events,
  and the `FLVPlayback`/`cuePoint` API.
- **Media components** (Player 6/7 legacy): MediaPlayback / MediaController / MediaDisplay.
- **Embedded video** — on the timeline as a Video object synced to frames (large SWFs; best
  for short clips).
- **`Video` object + `NetStream`/`NetConnection`** — script-driven external playback.
- Behaviors for basic play/pause/stop/seek control.

## Video object properties

- Instance name, dimensions, smoothing; bound to a NetStream for external playback.

## Accuracy targets

- VP6 (incl. alpha) and Spark decode; FLV container parsing incl. metadata + cue points.
- Cue-point event timing (Event vs Navigation) and the FLVPlayback API surface.
- Embedded-video timeline sync semantics.
- Encoder profile parity (data rate/keyframe/quality → comparable output).

## Implementation notes

- FLV demux + VP6/Spark decode via wasm (Ruffle's `flv`/`video` work is a reference); frames
  uploaded to GPU textures; alpha video composited like any RGBA source.
- External playback modeled on `NetConnection`/`NetStream` (AVM1) feeding the `Video` object.
- The standalone encoder maps to a CLI/batch mode of the media pipeline (later phase).

## Embedded-video SWF emit (implemented)

Embedded video — a library `VideoItem` published into the SWF timeline — is fully wired
through the compiler. The pipeline emits **DefineVideoStream (tag 60)** to declare each
video character and **VideoFrame (tag 61)** to deliver each compressed frame.

### Tag byte layouts

Verified against `ruffle/swf/src/{read,write}.rs` and pinned by
`packages/swf/src/__tests__/videostream.test.ts` (30 tests). Encoders live in
`packages/swf/src/video.ts`; `Tag.DefineVideoStream = 60` / `Tag.VideoFrame = 61` in
`packages/swf/src/tags.ts`.

- **`DefineVideoStream` (tag 60)** — exactly 10 bytes:
  `UI16 CharacterID`, `UI16 NumFrames`, `UI16 Width`, `UI16 Height`,
  `UI8 Flags = (Deblocking << 1) | IsSmoothed` (top 4 bits reserved), `UI8 CodecID`.
- **`VideoFrame` (tag 61)** — `UI16 StreamID` (references the stream's CharacterID),
  `UI16 FrameNum` (0-based), then the raw compressed `VIDEODATA` payload for that frame.

### Codec mapping

`VideoCodec` (`video.ts`) mirrors Ruffle's `VideoCodec` enum: `None=0`, `H263=2`
(Sorenson Spark), `ScreenVideo=3`, `Vp6=4` (On2 VP6), `Vp6WithAlpha=5`,
`ScreenVideoV2=6`, `H264=7`. `flvCodecToSwfCodec()` passes the FLV video-tag CodecId
nibble through (they line up 1:1), defaulting to H.263.

### FLV demux

`demuxFlv()` parses an FLV container (`"FLV"` magic) and returns the ordered video
frames (each with `frameNum`, `frameType`, `codecId`, and the raw `data` including the
leading FrameType/CodecId nibble byte) plus the stream's `width`/`height`/`codecId`.
Dimensions come from (in priority order) the `onMetaData` Script-tag width/height, else
the Sorenson H.263 bitstream `psize` field (CIF/QCIF/SubQCIF/320×240 or custom 8/16-bit
dims), falling back to 320×240. Non-FLV or empty input returns `null`.

### Compiler wiring

- **`compiler/media.ts` `runMediaPass`** filters library `VideoItem`s, demuxes each
  `dataUri`, and emits one `DefineVideoStream` per item. When the dataURI demuxes to real
  frames, `NumFrames`/`Width`/`Height`/`CodecID` come from the demuxed stream and one
  `VideoFrame` payload is collected per decoded frame. When the dataURI is an undecodable
  stub (or absent), it synthesizes `VideoItem.frameCount` empty `VideoFrame` payloads so
  the stream still advances one frame per `ShowFrame`. It returns a `videoCharIdMap`
  (VideoItem id → character id) and `videoStreams` (per-stream payloads) for downstream
  passes (`compiler/symbols.ts` and the frame loop consume them).
- **`VideoFrame` (tag 61)** records are emitted during the frame loop, one per
  `ShowFrame`, advancing each placed stream; `StreamID` matches the owning
  `DefineVideoStream` CharacterID.
- **Placement**: a `VideoDisplayObject` on the timeline places its stream at the model
  position/depth (not a legacy fixed depth); `videoFitTransform` (`media.ts`) scales the
  native stream dimensions to the placed box. Library videos with no on-stage placement
  still emit their `DefineVideoStream`.

The standalone encoder (re-encoding source media to Spark/VP6 FLV) remains a later phase;
the emit path above consumes an already-FLV-encoded `dataUri`.

## Import Video wizard (implemented)

**File > Import > Import Video...** opens the Import Video wizard
(`packages/authoring-ui/src/VideoImportDialog.tsx`). The flow:

1. `useFileActions.probeVideoFile()` opens a native file dialog filtered to
   `.flv`/`.mp4`/`.avi`, reads the bytes, builds a base64 `dataUri`, and probes the
   container via `probeFlv()` (`packages/swf/src/video.ts`). The result is held in
   `uiStore.videoImportPending` (a `PendingVideoImport`).
2. The wizard surfaces the probed **codec** (`videoCodecName()` label), **dimensions**,
   **frame count**, and **frame rate** (from the FLV `onMetaData` `framerate` key). The
   user can edit the library item **name**, native **width/height**, and **frame rate**,
   and choose the **embed target**:
   - *Embed to Library only* — creates the `VideoItem` library entry.
   - *Embed to Library and place on Stage* — also drops a `VideoDisplayObject` centered on
     the stage on the active layer/frame.
3. Confirming builds the `VideoItem` (`buildVideoItem()` → `createVideo()`), which the
   media compiler pass (`runMediaPass`) automatically encodes into `DefineVideoStream` +
   `VideoFrame` tags at publish time.

`probeFlv()` returns a `VideoProbe` (`codecId`, `codecName`, `width`, `height`,
`frameCount`, `frameRate`) or `null` for a non-FLV / undecodable container. When the probe
is null the wizard warns and falls back to user-editable defaults (320×240, 12 fps); the
item still embeds as a stub whose `frameCount` advances one empty `VideoFrame` per
`ShowFrame`. Probe dimensions come from FLV `onMetaData` (preferred) or the Sorenson H.263
bitstream — this replaces the old hardcoded 320×240 silent import. Gates:
`packages/swf/src/__tests__/videoprobe.test.ts` and
`packages/authoring-ui/src/__tests__/videoImportDialog.test.ts`.

**Out of scope (deferred):** live FLV streaming / progressive-download deployment, the
cue-point editor (Event/Navigation), encoding-profile controls (data rate / quality /
keyframe interval / re-encode to Spark/VP6), crop & trim, and the FLVPlayback skin picker.

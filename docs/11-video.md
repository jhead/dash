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

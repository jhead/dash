# 10 — Sound

Importing, sequencing, editing, and compressing audio.

## Importing sounds

`File > Import` into the Library. Supported source formats: **WAV, AIFF, MP3** (and, where
QuickTime is present, Sound Designer II, AU, etc.). Imported sounds become Library assets.

## Placing & syncing sounds

Sounds attach to keyframes on a layer (Property inspector with a keyframe selected):

- **Sound** — choose the Library sound; **Effect** — None, Left/Right channel, Fade L→R /
  R→L, Fade In, Fade Out, **Custom** (envelope editor).
- **Sync** modes:
  - **Event** — plays independently to completion; can overlap itself; tied to its start
    keyframe.
  - **Start** — like Event but won't start a new instance if already playing.
  - **Stop** — stops the specified sound.
  - **Stream** — synced to the timeline; forces playback to keep pace with frames; stops at
    the end of frames. Used for lip-sync/music-to-animation.
- **Loop / Repeat (n times)**.

## Sound editing controls

The in-panel **Edit Envelope** dialog:

- Shows the decoded **audio waveform** behind the envelope. Uncompressed WAV
  sources are decoded to per-channel min/max peaks (`decodeWavPeaks` in
  `@flash/core`, a pure-TS RIFF/WAVE PCM reader supporting 8/16/24/32-bit PCM and
  IEEE float). Compressed sources (MP3/AAC/OGG) cannot be decoded in pure TS, so a
  flat grey placeholder is drawn instead.
- Drag envelope handles to shape left/right channel volume over time. Click a
  channel band to add a node; right-click an interior node to remove it.
- Trim start/end (time-in / time-out) of the clip via the In/Out markers.
- **Time-zoom** control (1× / 2× / 4× / 8×) with a horizontal scroll slider to
  magnify the visible time window for precise editing of dense envelopes. Zoom
  changes only the view; the stored envelope/in/out values are unaffected.

The envelope persists on the frame's sound instance (`SoundLinkage.customEnvelope`
as `SoundEnvelopePoint[]` with `pos44`/`leftLevel`/`rightLevel`) and is encoded at
publish into the SWF `SoundInfo` envelope points (HasEnvelope flag); see
`packages/swf/src/sounds.ts`.

## Sounds on buttons

Attach sounds to a button's **Over**/**Down** states (and others) for UI feedback.

## ActionScript sound

The `Sound` object (AVM1):

- `attachSound`, `start`, `stop`, `setVolume`, `setPan`, `setTransform`.
- `onSoundComplete` event; `loadSound` for external MP3 (streaming or event).
- **ID3** metadata access for MP3 (`id3` properties); `onID3`.
- `duration` / `position` for progress.

## Compression (export settings)

Per-sound (Bitmap/Sound Properties) or document-wide (Publish Settings) **Audio stream** vs
**Audio event** defaults:

- **MP3** — bit rate (8–160 kbps), quality (Fast/Medium/Best), mono/stereo.
- **ADPCM** — 2/3/4/5-bit, sample rate (5/11/22/44 kHz).
- **Raw** — no compression; sample rate + mono/stereo.
- **Speech (Nellymoser)** — for voice.
- Convert stereo to mono; sample-rate downsampling.

Audio is written as SWF sound tags (`DefineSound`, `SoundStreamHead/Block`, `StartSound`).

## Accuracy targets

- Event/Start/Stop/Stream sync semantics (esp. Stream's frame-locked behavior and truncation).
- Envelope/effect presets and custom envelope output.
- Compression codecs (MP3/ADPCM/Raw/Nellymoser) producing valid SWF sound tags.
- `Sound` object API + ID3 + `onSoundComplete` parity (AVM1).

## Implementation notes

- Decode to PCM via wasm decoders; mix through Web Audio for authoring preview.
- Stream sounds are interleaved with frames (SoundStreamBlock) at publish; authoring preview
  must keep frame/audio sync to match Stream behavior.
- Encoders (MP3/ADPCM/Nellymoser) run at publish to emit SWF-accurate sound data.

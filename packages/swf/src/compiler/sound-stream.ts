/**
 * Stream-sound chunking: split each "stream" sync sound on a scene's timeline
 * into one chunk per SWF frame and pre-build its SoundStreamHead body, so the
 * frame loop can emit SoundStreamHead → (SoundStreamBlock → ShowFrame)×N.
 */
import type { Layer, SoundItem } from "@flash/core";
import { dataUriToBytes } from "../bitmaps.js";
import { encodeSoundStreamHead, soundFormat, soundRate } from "../audio.js";

/** A stream sound split into per-frame chunks, ready for block emission. */
export interface StreamSoundState {
  startFrame: number;
  chunks: Uint8Array[];       // one entry per frame starting at startFrame
  samplesPerFrame: number;    // used in SoundStreamHead.streamSampleCount
  isMP3: boolean;
  // SoundStreamHead tag body — emitted once at the stream's start frame
  headBody: Uint8Array;
}

/**
 * Pre-compute the per-frame stream-sound chunks for one scene. SWF requires one
 * SoundStreamBlock per ShowFrame carrying only that frame's samples; this splits
 * each stream sound's audio bytes into `totalAudioFrames` chunks (exact for PCM,
 * estimated from durationSeconds for MP3) and builds its SoundStreamHead body.
 */
export function computeStreamSounds(
  layers: readonly Layer[],
  soundItems: SoundItem[],
  frameRate: number,
  maxFrames: number
): StreamSoundState[] {
  const streamSounds: StreamSoundState[] = [];

  for (const layer of layers) {
    for (const frame of layer.frames) {
      if (
        frame.isKeyframe &&
        frame.sound !== null &&
        frame.sound.syncMode === "stream"
      ) {
        const soundItem = soundItems.find(
          (si) => si.id === frame.sound!.libraryItemId
        );
        if (!soundItem) continue;

        const fps = frameRate;
        const samplesPerFrame = Math.floor(soundItem.sampleRate / fps);
        const isMP3 = soundItem.compressionType === "mp3";
        const audioBytes = dataUriToBytes(soundItem.dataUri);

        // Estimate number of frames this sound spans. For raw PCM we can
        // calculate exactly; for MP3 we estimate from durationSeconds.
        let totalAudioFrames: number;
        if (isMP3) {
          // Estimate from declared duration; fall back to covering maxFrames
          const estimatedFrames = soundItem.durationSeconds > 0
            ? Math.ceil(soundItem.durationSeconds * fps)
            : maxFrames - frame.index;
          totalAudioFrames = Math.max(1, estimatedFrames);
        } else {
          // For raw PCM: exact calculation from byte count
          const bytesPerSample = soundItem.sampleSize === 16 ? 2 : 1;
          const channels = soundItem.isStereo ? 2 : 1;
          const bytesPerFrame = samplesPerFrame * bytesPerSample * channels;
          totalAudioFrames = bytesPerFrame > 0
            ? Math.max(1, Math.ceil(audioBytes.length / bytesPerFrame))
            : Math.max(1, maxFrames - frame.index);
        }

        // Split audio bytes into per-frame chunks.
        const chunks: Uint8Array[] = [];
        if (audioBytes.length === 0) {
          // No audio data — emit one empty block per frame
          for (let i = 0; i < totalAudioFrames; i++) {
            chunks.push(new Uint8Array(0));
          }
        } else {
          const bytesPerChunk = Math.max(
            1,
            Math.floor(audioBytes.length / totalAudioFrames)
          );
          let offset = 0;
          for (let i = 0; i < totalAudioFrames; i++) {
            const isLast = i === totalAudioFrames - 1;
            const end = isLast
              ? audioBytes.length
              : Math.min(offset + bytesPerChunk, audioBytes.length);
            chunks.push(audioBytes.slice(offset, end));
            offset = end;
            if (offset >= audioBytes.length) {
              // Remaining frames get empty blocks
              for (let j = i + 1; j < totalAudioFrames; j++) {
                chunks.push(new Uint8Array(0));
              }
              break;
            }
          }
        }

        // Build SoundStreamHead body — emitted at the stream's start frame
        const fmt = soundFormat(soundItem.compressionType);
        const rate = soundRate(soundItem.sampleRate);
        const sizeBit = (soundItem.sampleSize === 16 ? 1 : 0) as 0 | 1;
        const stereoBit = (soundItem.isStereo ? 1 : 0) as 0 | 1;
        const headBody = encodeSoundStreamHead({
          playbackRate: rate,
          playbackSize: sizeBit,
          playbackStereo: stereoBit,
          streamFormat: fmt,
          streamRate: rate,
          streamSize: sizeBit,
          streamStereo: stereoBit,
          streamSampleCount: samplesPerFrame,
        });

        streamSounds.push({
          startFrame: frame.index,
          chunks,
          samplesPerFrame,
          isMP3,
          headBody,
        });
      }
    }
  }

  return streamSounds;
}

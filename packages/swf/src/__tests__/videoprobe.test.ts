import { describe, it, expect } from "vitest";
import { probeFlv, videoCodecName, VideoCodec } from "../video.js";

// ---------------------------------------------------------------------------
// FLV builder: header + onMetaData (width/height/framerate) + N video tags.
// ---------------------------------------------------------------------------

function buildAmf0Meta(opts: {
  width?: number;
  height?: number;
  framerate?: number;
}): Uint8Array {
  const parts: number[] = [];
  const meta = "onMetaData";
  parts.push(0x02, 0x00, meta.length);
  for (const c of meta) parts.push(c.charCodeAt(0));

  const entries: [string, number][] = [];
  if (opts.width !== undefined) entries.push(["width", opts.width]);
  if (opts.height !== undefined) entries.push(["height", opts.height]);
  if (opts.framerate !== undefined) entries.push(["framerate", opts.framerate]);

  // ECMA Array (0x08) + count.
  parts.push(0x08, 0x00, 0x00, 0x00, entries.length);
  for (const [key, val] of entries) {
    parts.push((key.length >> 8) & 0xff, key.length & 0xff);
    for (const c of key) parts.push(c.charCodeAt(0));
    parts.push(0x00); // AMF0 Number
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, val, false);
    parts.push(...new Uint8Array(buf));
  }
  parts.push(0x00, 0x00, 0x09); // end marker
  return new Uint8Array(parts);
}

function buildFlv(opts: {
  videoFrames: number;
  codec?: number;
  meta?: { width?: number; height?: number; framerate?: number };
}): Uint8Array {
  const codec = opts.codec ?? VideoCodec.Vp6;
  const parts: number[] = [];
  // Header: "FLV" v1, flags audio+video=0x05, DataOffset=9.
  parts.push(0x46, 0x4c, 0x56, 0x01, 0x05, 0x00, 0x00, 0x00, 0x09);
  parts.push(0x00, 0x00, 0x00, 0x00); // first PreviousTagSize

  if (opts.meta) {
    const amf0 = buildAmf0Meta(opts.meta);
    parts.push(18); // script tag
    parts.push((amf0.length >> 16) & 0xff, (amf0.length >> 8) & 0xff, amf0.length & 0xff);
    parts.push(0, 0, 0, 0); // timestamp + ext
    parts.push(0, 0, 0); // stream id
    parts.push(...amf0);
    parts.push(0, 0, 0, 11 + amf0.length); // trailing PreviousTagSize
  }

  for (let i = 0; i < opts.videoFrames; i++) {
    const payloadLen = 2; // type byte + 1 data byte
    parts.push(9); // video tag
    parts.push((payloadLen >> 16) & 0xff, (payloadLen >> 8) & 0xff, payloadLen & 0xff);
    parts.push(0, 0, 0, 0); // timestamp + ext
    parts.push(0, 0, 0); // stream id
    const frameType = i === 0 ? 1 : 2;
    parts.push((frameType << 4) | (codec & 0x0f));
    parts.push(0xaa);
    parts.push(0, 0, 0, 11 + payloadLen);
  }
  return new Uint8Array(parts);
}

describe("video.ts — videoCodecName", () => {
  it("maps each codec id to a human-readable label", () => {
    expect(videoCodecName(VideoCodec.H263)).toBe("Sorenson Spark (H.263)");
    expect(videoCodecName(VideoCodec.Vp6)).toBe("On2 VP6");
    expect(videoCodecName(VideoCodec.Vp6WithAlpha)).toBe("On2 VP6 (alpha)");
    expect(videoCodecName(VideoCodec.H264)).toBe("H.264");
    expect(videoCodecName(99)).toBe("Unknown (99)");
  });
});

describe("video.ts — probeFlv", () => {
  it("returns null for non-FLV input", () => {
    expect(probeFlv(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(probeFlv(new Uint8Array(0))).toBeNull();
  });

  it("returns codec, dimensions, frame count and frame rate from metadata", () => {
    const flv = buildFlv({
      videoFrames: 12,
      codec: VideoCodec.Vp6,
      meta: { width: 640, height: 480, framerate: 24 },
    });
    const probe = probeFlv(flv);
    expect(probe).not.toBeNull();
    expect(probe!.codecId).toBe(VideoCodec.Vp6);
    expect(probe!.codecName).toBe("On2 VP6");
    expect(probe!.width).toBe(640);
    expect(probe!.height).toBe(480);
    expect(probe!.frameCount).toBe(12);
    expect(probe!.frameRate).toBe(24);
  });

  it("reports frameRate null when metadata omits framerate", () => {
    const flv = buildFlv({
      videoFrames: 3,
      codec: VideoCodec.H263,
      meta: { width: 320, height: 240 },
    });
    const probe = probeFlv(flv);
    expect(probe).not.toBeNull();
    expect(probe!.frameCount).toBe(3);
    expect(probe!.frameRate).toBeNull();
    expect(probe!.codecName).toBe("Sorenson Spark (H.263)");
  });

  it("rounds fractional frame rates and rejects implausible ones", () => {
    const ok = probeFlv(buildFlv({ videoFrames: 2, meta: { framerate: 29.97 } }));
    expect(ok!.frameRate).toBe(29.97);
    // 1000 fps is implausible → frameRate stays null.
    const bad = probeFlv(buildFlv({ videoFrames: 2, meta: { framerate: 1000 } }));
    expect(bad!.frameRate).toBeNull();
  });
});

/**
 * BomString length-prefix escalation — byte-boundary round-trip coverage.
 *
 * The FLA writer encodes every unicode CString ("BomString") length prefix with
 * an escalating width (`writeBomLength` in write/carchive-write.ts):
 *
 *   len <  0xff               -> u8(len)
 *   0xff <= len < 0xffff      -> 0xff, u16(len)
 *   len >= 0xffff             -> 0xff, u16(0xffff), u32(len)
 *
 * The reader (`readCString` in flash8-binary.ts) mirrors it exactly:
 *
 *   read u8 len; if len==0xff { read u16 len; if len==0xffff read u32 len }
 *
 * These three escalation points are the classic off-by-one byte boundary that
 * hid task 1369's frame-tail bug. This suite pins them: it exercises BomString
 * values of length 254, 255, 256, 65534, 65535 and 65536 *code units* — one on
 * each side of every prefix transition — through (a) the real writer -> real
 * reader at the primitive level with explicit prefix-byte assertions, and
 * (b) the genuine BomString call sites (layer names, frame labels, symbol AS2
 * classNames, and library item display names) end-to-end through
 * saveRealFla -> tryLoadRealFla / parseFla8Timeline / parseFla8Contents.
 *
 * THIS IS TEST-ONLY HARDENING. The byte-path audit found NO bug here. If any
 * assertion below fails, the writer/reader escalation has diverged and must be
 * triaged with an oracle (a real Flash 8 fixture) — DO NOT "fix" the byte logic
 * to make the test pass. See task 1370.
 */

import { describe, it, expect } from "vitest";
import {
  writeBomString,
  writePlainStringUnicode,
  ByteWriter,
} from "../write/carchive-write.js";
import {
  __readBomStringForTest,
  parseFla8Timeline,
  parseFla8Contents,
} from "../flash8-binary.js";
import { saveRealFla } from "../write/fla-write.js";
import { tryLoadRealFla, __readAllStreamsForTest } from "../ole.js";
import { createDocument, createDocumentProperties } from "../../model/document.js";
import { createScene } from "../../model/scene.js";
import { createLayer, createFrame } from "../../model/timeline.js";
import { createSymbol, createSound } from "../../model/library.js";
import type { FlashDocument, Frame, Layer, Scene, SoundLinkage } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Boundary lengths: one code unit on each side of every prefix escalation.
//   254  -> last single-byte length            (< 0xff)
//   255  -> first 0xff-marker + u16 length      (== 0xff)
//   256  -> still 0xff-marker + u16
//   65534-> last u16 length                     (< 0xffff)
//   65535-> first 0xff + u16(0xffff) + u32      (== 0xffff)
//   65536-> u32 length                          (> 0xffff)
// ---------------------------------------------------------------------------
const BOUNDARY_LENS = [254, 255, 256, 65534, 65535, 65536];

// The u32-escalation tier (len >= 0xffff). The Page-stream call sites (layer
// names, frame labels) read via the canonical `readCString`, which handles this
// tier and round-trips. The CONTENTS-stream call sites (symbol display names,
// AS2 classNames, scene names, linkage ids, paths, media names) read via the
// separate scanner `tryReadBomStringAt`, which is MISSING the u32 tier — a real
// reader bug surfaced by this suite and filed for triage as task 1371. Those
// cases are quarantined with `it.fails` below: they prove the divergence and
// flip to passing the moment 1371 extends tryReadBomStringAt to match
// readCString. Per task 1370's STOP-on-bug rule, this suite does NOT touch the
// byte/decode logic.
const isU32Tier = (len: number) => len >= 0xffff;

/** ASCII filler of exactly `n` code units (each char is one UTF-16 code unit). */
function ascii(n: number): string {
  return "a".repeat(n);
}

/**
 * A string of exactly `n` code units that ENDS with a non-ASCII multi-byte
 * UTF-16 char sitting right on the length boundary. "é" (U+00E9) and "中"
 * (U+4E2D) are single UTF-16 code units but >1 byte when UTF-8-encoded, and
 * each occupies a full 2-byte slot in the UTF-16LE wire form — so the boundary
 * char's high byte is non-zero, catching any truncation that only manifests on
 * non-ASCII content. Length is still `n` *code units* (the unit the prefix
 * counts), so it lands exactly on the escalation point.
 */
function withMultibyteTail(n: number): string {
  if (n < 2) return "中".repeat(n);
  return "a".repeat(n - 2) + "中" + "é";
}

/** Expected escalation prefix bytes for a BomString of `len` code units. */
function expectedPrefix(len: number): number[] {
  if (len < 0xff) return [len];
  if (len < 0xffff) return [0xff, len & 0xff, (len >>> 8) & 0xff];
  return [
    0xff,
    0xff,
    0xff, // u16(0xffff)
    len & 0xff,
    (len >>> 8) & 0xff,
    (len >>> 16) & 0xff,
    (len >>> 24) & 0xff,
  ];
}

// ---------------------------------------------------------------------------
// (a) Primitive writer -> reader, with explicit prefix-byte assertions.
// ---------------------------------------------------------------------------
describe("BomString primitive — writeBomString -> readCString at the escalation boundaries", () => {
  for (const len of BOUNDARY_LENS) {
    for (const [label, make] of [
      ["ASCII", ascii],
      ["multibyte tail", withMultibyteTail],
    ] as const) {
      it(`len ${len} (${label}) emits the right prefix and round-trips byte-exactly`, () => {
        const s = make(len);
        expect(s.length).toBe(len); // sanity: code-unit count is the boundary

        const w = new ByteWriter(len * 2 + 16);
        writeBomString(w, s);
        const bytes = w.finish();

        // Marker FF FE FF, then the escalated length prefix.
        expect(Array.from(bytes.slice(0, 3))).toEqual([0xff, 0xfe, 0xff]);
        const prefix = expectedPrefix(len);
        expect(Array.from(bytes.slice(3, 3 + prefix.length))).toEqual(prefix);

        // Total size: marker(3) + prefix + 2 bytes per code unit.
        expect(bytes.length).toBe(3 + prefix.length + len * 2);

        // The boundary char's high byte must survive (non-zero for "中"=U+4E2D).
        if (label === "multibyte tail") {
          const lastCharLo = bytes[bytes.length - 2]!;
          const lastCharHi = bytes[bytes.length - 1]!;
          expect((lastCharHi << 8) | lastCharLo).toBe("é".charCodeAt(0));
        }

        // Real reader decodes it back, consuming EXACTLY the bytes written.
        const { value, next } = __readBomStringForTest(bytes, 0);
        expect(value).toBe(s);
        expect(next).toBe(bytes.length);
      });
    }
  }

  it("writePlainStringUnicode shares the same escalation (no leading marker)", () => {
    // The contents/text paths reuse writeBomLength via writePlainStringUnicode;
    // its prefix must escalate identically. (No FF FE FF marker, so this is not
    // a readCString input — assert the prefix bytes directly.)
    for (const len of BOUNDARY_LENS) {
      const w = new ByteWriter(len * 2 + 16);
      writePlainStringUnicode(w, ascii(len));
      const bytes = w.finish();
      const prefix = expectedPrefix(len);
      expect(Array.from(bytes.slice(0, prefix.length))).toEqual(prefix);
      expect(bytes.length).toBe(prefix.length + len * 2);
    }
  });

  it("a BomString embedded between other bytes leaves the cursor exactly past it", () => {
    // Guards the reader's consumed-length at the boundary: a wrong prefix width
    // would desync every following field (the 1369 failure mode).
    for (const len of [255, 65535]) {
      const s = withMultibyteTail(len);
      const w = new ByteWriter(len * 2 + 16);
      w.u32(0xdeadbeef);
      writeBomString(w, s);
      w.u16(0x1234); // sentinel that must remain readable after the string
      const bytes = w.finish();

      const { value, next } = __readBomStringForTest(bytes, 4);
      expect(value).toBe(s);
      // Sentinel is intact at `next`.
      expect(bytes[next]! | (bytes[next + 1]! << 8)).toBe(0x1234);
      expect(next).toBe(bytes.length - 2);
    }
  });
});

// ---------------------------------------------------------------------------
// Shared document builders for the end-to-end call-site tests.
// ---------------------------------------------------------------------------
function baseDoc(scenes: Scene[], extra?: Partial<FlashDocument>): FlashDocument {
  return createDocument({
    properties: createDocumentProperties({
      width: 640,
      height: 480,
      frameRate: 24,
      backgroundColor: "#336699",
    }),
    scenes,
    library: { items: [], folders: [] },
    ...extra,
  });
}

function sceneWith(name: string, layers: Layer[]): Scene {
  return createScene(name, { timeline: { layers } });
}

// A frame sound forces the FULL serialization path (isEmptyKeyframe()===false),
// the same path that carries the real frame-tail; this is where 1369 lived.
function soundFrame(extra?: Partial<Frame>): { frame: Frame; sound: ReturnType<typeof createSound> } {
  const snd = createSound("boom.mp3");
  const sound: SoundLinkage = {
    libraryItemId: snd.id,
    syncMode: "start",
    repeatCount: 1,
    inPoint: 0,
    outPoint: 0,
  };
  const frame = createFrame(0, { isKeyframe: true, isEmpty: true, sound, ...extra });
  return { frame, sound: snd };
}

// ---------------------------------------------------------------------------
// (b1) Layer names through the full Page-stream path.
// ---------------------------------------------------------------------------
describe("BomString call site — LAYER NAME boundary round-trip (Page stream)", () => {
  for (const len of BOUNDARY_LENS) {
    for (const [label, make] of [
      ["ASCII", ascii],
      ["multibyte tail", withMultibyteTail],
    ] as const) {
      it(`layer name len ${len} (${label}) round-trips via parseFla8Timeline + tryLoadRealFla`, () => {
        const name = make(len);
        const { frame, sound } = soundFrame();
        const layer = createLayer(name, "normal", { frames: [frame], frameCount: 1 });
        const doc = baseDoc([sceneWith("Scene 1", [layer])], {
          library: { items: [sound], folders: [] },
        });

        const bytes = saveRealFla(doc);
        const page = __readAllStreamsForTest(bytes).get("Page 1")!;
        const tl = parseFla8Timeline(page);
        expect(tl.layers.map((l) => l.name)).toEqual([name]);

        // The sound sub-block after the layer body must still decode — proof the
        // escalated prefix did not desync the rest of the stream.
        expect(tl.layers[0]!.frames[0]!.soundLoop).toBe(1);

        const out = tryLoadRealFla(bytes);
        expect(out).not.toBeNull();
        expect(out!.scenes[0]!.timeline.layers.map((l) => l.name)).toEqual([name]);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// (b2) Frame labels through the full Page-stream path.
// ---------------------------------------------------------------------------
describe("BomString call site — FRAME LABEL boundary round-trip (Page stream)", () => {
  for (const len of BOUNDARY_LENS) {
    for (const [label, make] of [
      ["ASCII", ascii],
      ["multibyte tail", withMultibyteTail],
    ] as const) {
      it(`frame label len ${len} (${label}) round-trips via parseFla8Timeline + tryLoadRealFla`, () => {
        const labelText = make(len);
        // Frame label is only serialized on the full path; attach a sound so the
        // full path is taken, and set the label.
        const { frame, sound } = soundFrame({ label: labelText, labelType: "name" });
        const layer = createLayer("Layer 1", "normal", { frames: [frame], frameCount: 1 });
        const doc = baseDoc([sceneWith("Scene 1", [layer])], {
          library: { items: [sound], folders: [] },
        });

        const bytes = saveRealFla(doc);
        const page = __readAllStreamsForTest(bytes).get("Page 1")!;
        const tl = parseFla8Timeline(page);
        expect(tl.layers[0]!.frames[0]!.label).toBe(labelText);

        const out = tryLoadRealFla(bytes);
        expect(out).not.toBeNull();
        const f = out!.scenes[0]!.timeline.layers[0]!.frames[0]!;
        expect(f.label).toBe(labelText);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// (b3) Symbol AS2 className (linkage) through the Contents stream.
// ---------------------------------------------------------------------------
describe("BomString call site — SYMBOL className (AS2 linkage) boundary round-trip (Contents stream)", () => {
  for (const len of BOUNDARY_LENS) {
    for (const [label, make] of [
      ["ASCII", ascii],
      ["multibyte tail", withMultibyteTail],
    ] as const) {
      // u32-tier cases are quarantined: tryReadBomStringAt under-reads them (task 1371).
      const tc = isU32Tier(len) ? it.fails : it;
      tc(`className len ${len} (${label}) round-trips through the writeAsLinkage block`, () => {
        const className = make(len);
        const sym = createSymbol("Ball", "movieclip", {
          linkage: {
            exportForActionScript: true,
            exportInFirstFrame: true,
            linkageIdentifier: "BallLinkage",
            className,
            exportForRuntimeSharing: false,
            importForRuntimeSharing: false,
            sharedUrl: "",
          },
        });
        const doc = baseDoc([sceneWith("Scene 1", [createLayer("Layer 1", "normal", {
          frames: [createFrame(0)], frameCount: 1,
        })])], {
          library: { items: [sym], folders: [] },
        });

        const contents = __readAllStreamsForTest(saveRealFla(doc)).get("Contents")!;
        const decoded = parseFla8Contents(contents).symbols.get(1)!;
        expect(decoded).toBeDefined();
        expect(decoded.name).toBe("Ball");
        expect(decoded.className).toBe(className);
        expect(decoded.exportForActionScript).toBe(true);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// (b4) Library item display name (symbol page name) through the Contents stream.
// ---------------------------------------------------------------------------
describe("BomString call site — LIBRARY ITEM display name boundary round-trip (Contents stream)", () => {
  for (const len of BOUNDARY_LENS) {
    for (const [label, make] of [
      ["ASCII", ascii],
      ["multibyte tail", withMultibyteTail],
    ] as const) {
      // u32-tier cases are quarantined: tryReadBomStringAt under-reads them (task 1371).
      const tc = isU32Tier(len) ? it.fails : it;
      tc(`symbol display name len ${len} (${label}) round-trips through the CDocumentPage record`, () => {
        const displayName = make(len);
        const sym = createSymbol(displayName, "movieclip");
        const doc = baseDoc([sceneWith("Scene 1", [createLayer("Layer 1", "normal", {
          frames: [createFrame(0)], frameCount: 1,
        })])], {
          library: { items: [sym], folders: [] },
        });

        const contents = __readAllStreamsForTest(saveRealFla(doc)).get("Contents")!;
        const decoded = parseFla8Contents(contents).symbols.get(1)!;
        expect(decoded).toBeDefined();
        expect(decoded.name).toBe(displayName);
      });
    }
  }
});

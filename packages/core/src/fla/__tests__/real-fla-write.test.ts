/**
 * Binary FLA writer round-trip tests.
 *
 * Build small documents via the model factories, serialize with saveRealFla(),
 * assert the bytes are a valid OLE2 container, then round-trip through the
 * existing importer (tryLoadRealFla) and check that key structure is recovered.
 *
 * Byte-presence is necessary but not sufficient (per CLAUDE.md); these are
 * structural round-trip checks against the inverse-oracle importer.
 */

import { describe, it, expect } from "vitest";
import { saveRealFla } from "../write/fla-write.js";
import { isOle2, tryLoadRealFla, __readAllStreamsForTest } from "../ole.js";
import { validateContentsStream, validateTimelineStream } from "../write/carchive-validate.js";
import { parseFla8Timeline } from "../flash8-binary.js";
import { createDocument, createDocumentProperties } from "../../model/document.js";
import { createScene } from "../../model/scene.js";
import { createLayer, createFrame } from "../../model/timeline.js";
import { createSymbol, createSound, createBitmap } from "../../model/library.js";
import type { EaseCurve, FlashDocument, Frame, Layer, Scene, SoundLinkage } from "../../model/types.js";
import type {
  ColorEffect,
  Fill,
  ShapeDisplayObject,
  SymbolInstance,
  TextDisplayObject,
} from "../../engine/types.js";
import type { FlashFilter } from "../../engine/filters.js";

function frameWith(objects: Frame["displayObjects"]): Frame {
  return createFrame(0, { isEmpty: objects.length === 0, displayObjects: objects });
}

function layerWith(name: string, type: Layer["type"], objects: Frame["displayObjects"]): Layer {
  return createLayer(name, type, { frames: [frameWith(objects)], frameCount: 1 });
}

function sceneWith(name: string, layers: Layer[]): Scene {
  return createScene(name, { timeline: { layers } });
}

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

const solidRectShape = (x: number, y: number): ShapeDisplayObject => ({
  type: "shape",
  id: "shape1",
  x,
  y,
  shape: {
    id: "geom1",
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 100, y: 0 } },
          { type: "line", to: { x: 100, y: 60 } },
          { type: "line", to: { x: 0, y: 60 } },
          { type: "line", to: { x: 0, y: 0 } },
        ],
        fill: { type: "solid", color: { r: 200, g: 30, b: 40, a: 255 } },
        closed: true,
      },
    ],
  },
});

describe("saveRealFla — container + document properties", () => {
  it("produces a valid OLE2 container", () => {
    const doc = baseDoc([sceneWith("Scene 1", [layerWith("Layer 1", "normal", [])])]);
    const bytes = saveRealFla(doc);
    expect(isOle2(bytes)).toBe(true);
  });

  it("round-trips stage width/height/fps/background", () => {
    const doc = baseDoc([sceneWith("Scene 1", [layerWith("Layer 1", "normal", [])])]);
    const out = tryLoadRealFla(saveRealFla(doc));
    expect(out).not.toBeNull();
    expect(out!.properties.width).toBe(640);
    expect(out!.properties.height).toBe(480);
    expect(out!.properties.frameRate).toBe(24);
    expect(out!.properties.backgroundColor.toLowerCase()).toBe("#336699");
  });
});

describe("saveRealFla — scenes", () => {
  it("recovers scene count + names in play order", () => {
    const doc = baseDoc([
      sceneWith("Intro", [layerWith("Layer 1", "normal", [])]),
      sceneWith("Main", [layerWith("Layer 1", "normal", [])]),
      sceneWith("Outro", [layerWith("Layer 1", "normal", [])]),
    ]);
    const out = tryLoadRealFla(saveRealFla(doc));
    expect(out).not.toBeNull();
    expect(out!.scenes.map((s) => s.name)).toEqual(["Intro", "Main", "Outro"]);
  });
});

describe("saveRealFla — layers", () => {
  it("recovers layer count and names (handling bottom-to-top storage)", () => {
    // Model top-to-bottom: li=0 "Top", li=1 "Mid", li=2 "Bottom".
    const layers = [
      layerWith("Top", "normal", []),
      layerWith("Mid", "normal", []),
      layerWith("Bottom", "normal", []),
    ];
    const doc = baseDoc([sceneWith("Scene 1", layers)]);
    const out = tryLoadRealFla(saveRealFla(doc));
    expect(out).not.toBeNull();
    const names = out!.scenes[0]!.timeline.layers.map((l) => l.name);
    expect(names).toEqual(["Top", "Mid", "Bottom"]);
  });

  it("preserves layer visible/locked", () => {
    const layers = [
      createLayer("Hidden", "normal", { visible: false, frames: [createFrame(0)], frameCount: 1 }),
      createLayer("Locked", "normal", { locked: true, frames: [createFrame(0)], frameCount: 1 }),
    ];
    const doc = baseDoc([sceneWith("Scene 1", layers)]);
    const out = tryLoadRealFla(saveRealFla(doc));
    const ls = out!.scenes[0]!.timeline.layers;
    const hidden = ls.find((l) => l.name === "Hidden");
    const locked = ls.find((l) => l.name === "Locked");
    expect(hidden?.visible).toBe(false);
    expect(locked?.locked).toBe(true);
  });
});

// Regression for task 1369: a frame written via the FULL serialization path (NOT the
// empty-keyframe template) stamps frame schema fs=0x18, and the reader consumes a fixed
// 20-byte higher-schema tail after the tweenInstanceName (`fs>19/>20/>=22 skip(4)` +
// `fs>=24` ease-curve header `useSingleEaseCurve/hasCustomEase`). The writer used to omit
// those 20 bytes, so the reader over-read the frame body by exactly 20 bytes and the layer
// name / trailer parsed off-by-20. The corruption appeared LAYER-NAME-LENGTH-dependent (a
// 1-char 'L' truncated; the 7-char default 'Layer 1' fell back to a default reconstruction)
// because the off-by-20 landed on different bytes per name length, but the root cause is the
// missing frame-tail bytes, NOT the layer-name field. These cases force the full path (a
// frame sound makes isEmptyKeyframe() false) and assert ANY valid layer-name length
// round-trips through both the lenient reader (parseFla8Timeline) and the full importer
// (tryLoadRealFla) with the frame sound link rebuilt and no parse warnings.
describe("saveRealFla — short/edge layer names round-trip on the full frame path (task 1369)", () => {
  function soundDocWithLayerName(layerName: string): FlashDocument {
    const snd = createSound("boom.mp3");
    const sound: SoundLinkage = {
      libraryItemId: snd.id,
      syncMode: "start",
      repeatCount: 3,
      inPoint: 100,
      outPoint: 5000,
    };
    const frame = createFrame(0, { isKeyframe: true, isEmpty: true, sound });
    const layer = createLayer(layerName, "normal", { frames: [frame], frameCount: 1 });
    return baseDoc([sceneWith("Scene 1", [layer])], {
      library: { items: [snd], folders: [] },
    });
  }

  // 1-char (the task's repro), plus a spread of edge lengths around the BomString single-byte
  // length-prefix boundary and a few short ones the off-by-20 used to mangle.
  const NAMES = ["L", "La", "Lay", "AB", "ABCD", "ABCDE", "ABCDEF", "Layer 1", "X".repeat(40)];

  for (const name of NAMES) {
    it(`layer name ${JSON.stringify(name)} (len ${name.length}) round-trips via parseFla8Timeline`, () => {
      const page = __readAllStreamsForTest(saveRealFla(soundDocWithLayerName(name))).get("Page 1")!;
      const tl = parseFla8Timeline(page);
      expect(tl.layers.map((l) => l.name)).toEqual([name]);
      // The §11 sound sub-block must still decode (full path emitted it).
      expect(tl.layers[0]!.frames[0]!.soundLoop).toBe(3);
      expect(tl.layers[0]!.frames[0]!.inPoint).toBe(100);
    });

    it(`layer name ${JSON.stringify(name)} (len ${name.length}) round-trips via tryLoadRealFla`, () => {
      const warnings: string[] = [];
      const orig = console.warn;
      console.warn = (...a: unknown[]) => {
        warnings.push(a.map(String).join(" "));
      };
      let out: ReturnType<typeof tryLoadRealFla>;
      try {
        out = tryLoadRealFla(saveRealFla(soundDocWithLayerName(name)));
      } finally {
        console.warn = orig;
      }
      expect(out).not.toBeNull();
      expect(out!.scenes[0]!.timeline.layers.map((l) => l.name)).toEqual([name]);
      // The frame-sound LINK is rebuilt (the full importer resolved it) and the page parsed
      // cleanly — the regression manifested as a "could not parse page"/"truncated" warning.
      const f = out!.scenes[0]!.timeline.layers[0]!.frames[0]!;
      expect(f.sound).not.toBeNull();
      expect(f.sound!.repeatCount).toBe(3);
      expect(warnings.filter((w) => /could not parse page|truncated/.test(w))).toEqual([]);
    });
  }

  it("a non-empty SHAPE frame with a 1-char layer name is a strict-valid CArchive timeline", () => {
    // The shape path also takes the full serialization path; confirm the strict validator
    // (the real-Flash acceptance bar) accepts it for a short name too.
    const doc = baseDoc([sceneWith("Scene 1", [layerWith("L", "normal", [solidRectShape(10, 10)])])]);
    const streams = __readAllStreamsForTest(saveRealFla(doc));
    validateContentsStream(streams.get("Contents")!);
    const page = validateTimelineStream(streams.get("Page 1")!);
    expect(page.classes.sort()).toEqual(["CPicFrame", "CPicLayer", "CPicPage"]);
    expect(tryLoadRealFla(saveRealFla(doc))!.scenes[0]!.timeline.layers.map((l) => l.name)).toEqual([
      "L",
    ]);
  });
});

// Regression for task 1384: the empty-keyframe fast path (writeCPicFrame) emitted the
// PAGE_FRAME_BODY template verbatim, and that template hardcodes the §11 span duration
// (little-endian u16 at bytes 52-53) to 1. The computed span argument was ignored, so a
// blank keyframe held N frames was written span=1; on re-import convertLayer does
// `frameIndex += f.duration`, collapsing every empty span to a single frame (layer lengths
// shrink, later keyframes shift). The fix patches the duration field with max(1, span).
describe("saveRealFla — empty keyframe span/duration round-trips (task 1384)", () => {
  function blankKeyframeLayer(frameCount: number): FlashDocument {
    // One blank (empty) keyframe held `frameCount` frames.
    const frame = createFrame(0, { isKeyframe: true, isEmpty: true });
    const layer = createLayer("Layer 1", "normal", { frames: [frame], frameCount });
    return baseDoc([sceneWith("Scene 1", [layer])]);
  }

  for (const span of [1, 2, 5, 24, 300]) {
    it(`a blank keyframe held ${span} frame(s) writes span=${span} (lenient reader)`, () => {
      const page = __readAllStreamsForTest(saveRealFla(blankKeyframeLayer(span))).get("Page 1")!;
      const tl = parseFla8Timeline(page);
      expect(tl.layers[0]!.frames[0]!.duration).toBe(span);
    });

    it(`a blank keyframe held ${span} frame(s) recovers frameCount=${span} (tryLoadRealFla)`, () => {
      const out = tryLoadRealFla(saveRealFla(blankKeyframeLayer(span)));
      expect(out).not.toBeNull();
      const layer = out!.scenes[0]!.timeline.layers[0]!;
      expect(layer.frameCount).toBe(span);
      // The single blank keyframe stays a single keyframe at index 0.
      expect(layer.frames.filter((f) => f.isKeyframe).map((f) => f.index)).toEqual([0]);
    });
  }

  it("a later keyframe does not shift when an earlier blank span is multi-frame", () => {
    // Blank keyframe at 0 held 10 frames, then a shape keyframe at 10.
    const blank = createFrame(0, { isKeyframe: true, isEmpty: true });
    const shapeKf = createFrame(10, {
      isKeyframe: true,
      isEmpty: false,
      displayObjects: [solidRectShape(20, 20)],
    });
    const layer = createLayer("Layer 1", "normal", {
      frames: [blank, shapeKf],
      frameCount: 11,
    });
    const doc = baseDoc([sceneWith("Scene 1", [layer])]);
    const out = tryLoadRealFla(saveRealFla(doc));
    expect(out).not.toBeNull();
    const kfs = out!.scenes[0]!.timeline.layers[0]!.frames.filter((f) => f.isKeyframe);
    // Before the fix the blank span collapsed to 1 and the shape keyframe landed at index 1.
    expect(kfs.map((f) => f.index)).toEqual([0, 10]);
  });
});

// Content-bearing timelines are asserted against the STRICT CArchive validator
// (real-Flash byte structure), not against the lenient importer's round-trip. The
// writer's contract is byte-compatibility with Flash 8; importer round-tripping is
// not a goal and must not drive the writer. The validator enforces the §5.1 tag
// invariant and §5.2 index allocation — i.e. it rejects exactly what Flash rejects.

describe("saveRealFla — shape (strict CArchive structure)", () => {
  it("a solid-fill rectangle keyframe stores its geometry INLINE (no CPicShape class)", () => {
    // Real Flash keeps a frame's raw vector graphics as the frame's own inline
    // shape body — NOT a tagged CPicShape child. A shape-only doc's Page 1 must
    // therefore declare exactly {CPicPage, CPicLayer, CPicFrame} and nothing else;
    // a stray CPicShape NEWCLASS corrupts the §5.2 running index and Flash refuses
    // to open the doc.
    const doc = baseDoc([
      sceneWith("Scene 1", [layerWith("Layer 1", "normal", [solidRectShape(40, 50)])]),
    ]);
    const streams = __readAllStreamsForTest(saveRealFla(doc));
    validateContentsStream(streams.get("Contents")!);
    const page = validateTimelineStream(streams.get("Page 1")!);
    expect(page.classes.sort()).toEqual(["CPicFrame", "CPicLayer", "CPicPage"]);
    expect(page.classes).not.toContain("CPicShape");
  });

  it("two raw shapes on one frame merge into ONE inline shape (still no CPicShape)", () => {
    const doc = baseDoc([
      sceneWith("Scene 1", [
        layerWith("Layer 1", "normal", [solidRectShape(10, 10), solidRectShape(120, 80)]),
      ]),
    ]);
    const streams = __readAllStreamsForTest(saveRealFla(doc));
    validateContentsStream(streams.get("Contents")!);
    const page = validateTimelineStream(streams.get("Page 1")!);
    expect(page.classes.sort()).toEqual(["CPicFrame", "CPicLayer", "CPicPage"]);
    expect(page.classes).not.toContain("CPicShape");
  });
});

describe("saveRealFla — symbol + instance (strict CArchive structure)", () => {
  it("a graphic symbol + instance frames the catalog + the page/symbol graphs", () => {
    const sym = createSymbol("MyGraphic", "graphic");
    const inst: SymbolInstance = {
      type: "instance",
      id: "inst1",
      symbolId: sym.id,
      x: 120,
      y: 80,
      scaleX: 2,
      scaleY: 0.5,
      rotation: 0,
    };
    const doc = baseDoc([sceneWith("Scene 1", [layerWith("Layer 1", "normal", [inst])])], {
      library: { items: [sym], folders: [] },
    });
    const streams = __readAllStreamsForTest(saveRealFla(doc));
    const cat = validateContentsStream(streams.get("Contents")!);
    expect(cat.documentPages).toBe(2); // scene + symbol CDocumentPage records
    const page = validateTimelineStream(streams.get("Page 1")!);
    expect(page.classes).toContain("CPicSymbol"); // graphic instance class
    expect(streams.has("Symbol 1")).toBe(true);
    validateTimelineStream(streams.get("Symbol 1")!);
  });
});

describe("saveRealFla — text (strict CArchive structure)", () => {
  it("a static text field parses cleanly and frames a CPicText", () => {
    const text: TextDisplayObject = {
      type: "text",
      id: "t1",
      x: 30,
      y: 40,
      width: 200,
      height: 24,
      text: "Hello",
      textType: "static",
      fontFamily: "Arial",
      fontSize: 18,
      bold: false,
      italic: false,
      color: { r: 10, g: 20, b: 30, a: 255 },
      align: "left",
      multiline: false,
      wordWrap: false,
    };
    const doc = baseDoc([sceneWith("Scene 1", [layerWith("Layer 1", "normal", [text])])]);
    const streams = __readAllStreamsForTest(saveRealFla(doc));
    validateContentsStream(streams.get("Contents")!);
    const page = validateTimelineStream(streams.get("Page 1")!);
    expect(page.classes).toContain("CPicText");
  });
});

// The §11 frame-record sound sub-block (soundId, envelope, soundLoop, soundSync,
// inPoint, outPoint, soundZoom) was previously hardcoded to zeros, silently
// dropping every frame sound attachment on save even though the model carries it
// (Frame.sound: SoundLinkage) and the binary reader decodes it. These tests assert
// the written bytes round-trip through the SAME reader the importer uses
// (parseFla8Timeline) — proving the on-wire layout matches — and that the strict
// CArchive validator still accepts a sound-bearing frame as a structurally valid
// timeline stream.
describe("saveRealFla — frame sound (§11 sound sub-block)", () => {
  function docWithFrameSound(sound: SoundLinkage | null) {
    const snd = createSound("boom.mp3");
    const frame = createFrame(0, { isKeyframe: true, isEmpty: true, sound });
    const layer = createLayer("Layer 1", "normal", { frames: [frame], frameCount: 1 });
    return baseDoc([sceneWith("Scene 1", [layer])], {
      library: { items: [snd], folders: [] },
    });
  }

  it("a sound-bearing keyframe still validates as a strict CArchive timeline", () => {
    const snd = createSound("boom.mp3");
    const sound: SoundLinkage = { libraryItemId: snd.id, syncMode: "event", repeatCount: 1 };
    const frame = createFrame(0, { isKeyframe: true, isEmpty: true, sound });
    const layer = createLayer("Layer 1", "normal", { frames: [frame], frameCount: 1 });
    const doc = baseDoc([sceneWith("Scene 1", [layer])], {
      library: { items: [snd], folders: [] },
    });
    const streams = __readAllStreamsForTest(saveRealFla(doc));
    validateContentsStream(streams.get("Contents")!);
    const page = validateTimelineStream(streams.get("Page 1")!);
    expect(page.classes.sort()).toEqual(["CPicFrame", "CPicLayer", "CPicPage"]);
  });

  it("soundId / syncMode / repeatCount / in-out points round-trip through parseFla8Timeline", () => {
    const snd = createSound("boom.mp3");
    const sound: SoundLinkage = {
      libraryItemId: snd.id,
      syncMode: "start",
      repeatCount: 3,
      inPoint: 100,
      outPoint: 5000,
    };
    const frame = createFrame(0, { isKeyframe: true, isEmpty: true, sound });
    const layer = createLayer("Layer 1", "normal", { frames: [frame], frameCount: 1 });
    const doc = baseDoc([sceneWith("Scene 1", [layer])], {
      library: { items: [snd], folders: [] },
    });
    const streams = __readAllStreamsForTest(saveRealFla(doc));
    const tl = parseFla8Timeline(streams.get("Page 1")!);
    const f = tl.layers[0]!.frames[0]!;
    // mediaNumById allocates the lone sound stream number 1.
    expect(f.soundId).toBe(1);
    expect(f.soundSync).toBe(1); // "start" => 1
    expect(f.soundLoop).toBe(3);
    expect(f.inPoint).toBe(100);
    expect(f.outPoint).toBe(5000);
  });

  it("each syncMode maps to its §11 soundSync byte (event/start/stop/stream = 0/1/2/3)", () => {
    const cases: Array<[SoundLinkage["syncMode"], number]> = [
      ["event", 0],
      ["start", 1],
      ["stop", 2],
      ["stream", 3],
    ];
    for (const [mode, expected] of cases) {
      const snd = createSound("s.mp3");
      const sound: SoundLinkage = { libraryItemId: snd.id, syncMode: mode, repeatCount: 1 };
      const frame = createFrame(0, { isKeyframe: true, isEmpty: true, sound });
      const layer = createLayer("Layer 1", "normal", { frames: [frame], frameCount: 1 });
      const doc = baseDoc([sceneWith("Scene 1", [layer])], {
        library: { items: [snd], folders: [] },
      });
      const tl = parseFla8Timeline(__readAllStreamsForTest(saveRealFla(doc)).get("Page 1")!);
      expect(tl.layers[0]!.frames[0]!.soundSync).toBe(expected);
    }
  });

  it("a custom volume envelope round-trips point-for-point", () => {
    const snd = createSound("boom.mp3");
    const sound: SoundLinkage = {
      libraryItemId: snd.id,
      syncMode: "event",
      repeatCount: 1,
      customEnvelope: [
        { pos44: 0, leftLevel: 32768, rightLevel: 16000 },
        { pos44: 2205, leftLevel: 0, rightLevel: 0 },
      ],
    };
    const frame = createFrame(0, { isKeyframe: true, isEmpty: true, sound });
    const layer = createLayer("Layer 1", "normal", { frames: [frame], frameCount: 1 });
    const doc = baseDoc([sceneWith("Scene 1", [layer])], {
      library: { items: [snd], folders: [] },
    });
    const tl = parseFla8Timeline(__readAllStreamsForTest(saveRealFla(doc)).get("Page 1")!);
    const env = tl.layers[0]!.frames[0]!.envelopePoints;
    expect(env).toEqual([
      { pos: 0, leftLevel: 32768, rightLevel: 16000 },
      { pos: 2205, leftLevel: 0, rightLevel: 0 },
    ]);
  });

  it("a soundless keyframe writes the all-zero sub-block (soundId 0)", () => {
    const doc = docWithFrameSound(null);
    const tl = parseFla8Timeline(__readAllStreamsForTest(saveRealFla(doc)).get("Page 1")!);
    expect(tl.layers[0]!.frames[0]!.soundId).toBe(0);
  });
});

// The Contents media catalog (CMediaSound / CMediaBits records, §8.6) is what lets
// the FULL importer (tryLoadRealFla) rebuild a saved frame sound's library LINK: the
// importer resolves a frame's `soundId` to a library item by scanning the "Media N"
// CMediaSound catalog. Before this catalog was written, a saved frame sound was
// byte-correct in the Page stream but its library link was dropped on re-import
// (the importer warned "frame sound id N not found in library"). These tests assert
// the round-trip now RESOLVES frame.sound.libraryItemId with no such warning.
describe("saveRealFla — Contents media catalog (CMediaSound/CMediaBits)", () => {
  function captureWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => {
      warnings.push(a.map(String).join(" "));
    };
    try {
      return { result: fn(), warnings };
    } finally {
      console.warn = orig;
    }
  }

  it("a saved sound library item + frame sound round-trips with libraryItemId RESOLVED", () => {
    const snd = createSound("boom.mp3");
    const sound: SoundLinkage = {
      libraryItemId: snd.id,
      syncMode: "start",
      repeatCount: 3,
      inPoint: 100,
      outPoint: 5000,
    };
    // createLayer's default "Layer 1" name is used (the byte layout the §11 sound
    // sub-block round-trip in this file is verified against).
    const frame = createFrame(0, { isKeyframe: true, isEmpty: true, sound });
    const layer = createLayer("Layer 1", "normal", { frames: [frame], frameCount: 1 });
    const doc = baseDoc([sceneWith("Scene 1", [layer])], {
      library: { items: [snd], folders: [] },
    });

    const { result: out, warnings } = captureWarnings(() => tryLoadRealFla(saveRealFla(doc)));

    // The sound library item is rebuilt from the CMediaSound catalog record.
    const soundItem = out.library.items.find((i) => i.itemType === "sound");
    expect(soundItem).toBeDefined();
    expect(soundItem!.name).toBe("boom.mp3");

    // The frame sound resolves to that library item — the LINK is rebuilt.
    const f = out.scenes[0]!.timeline.layers[0]!.frames[0]!;
    expect(f.sound).not.toBeNull();
    expect(f.sound!.libraryItemId).toBe(soundItem!.id);
    expect(f.sound!.syncMode).toBe("start");
    expect(f.sound!.repeatCount).toBe(3);
    expect(f.sound!.inPoint).toBe(100);
    expect(f.sound!.outPoint).toBe(5000);

    // No "not found in library" warning (the regression this catalog fixes), and the
    // page stream parsed cleanly.
    expect(warnings.filter((w) => /not found in library/.test(w))).toEqual([]);
    expect(warnings.filter((w) => /could not parse page/.test(w))).toEqual([]);
  });

  it("emits a CMediaSound NEWCLASS record whose body matches what the importer reads", () => {
    const snd = createSound("boom.mp3");
    const sound: SoundLinkage = { libraryItemId: snd.id, syncMode: "event", repeatCount: 1 };
    const frame = createFrame(0, { isKeyframe: true, isEmpty: true, sound });
    const layer = createLayer("Layer 1", "normal", { frames: [frame], frameCount: 1 });
    const doc = baseDoc([sceneWith("Scene 1", [layer])], {
      library: { items: [snd], folders: [] },
    });
    const c = __readAllStreamsForTest(saveRealFla(doc)).get("Contents")!;

    // Exactly one CMediaSound NEWCLASS declaration (schema-1 class, schema-6 record).
    expect(countClassDecls(c, "CMediaSound")).toBe(1);
    // The record body: schema u8 = 6, then the "Media 1" stream name in UTF-16LE,
    // then a BomString display name "boom.mp3" — the exact bytes registerCMediaSoundObject reads.
    const decl = indexOf(c, asciiOf("CMediaSound"));
    expect(decl).toBeGreaterThan(0);
    const bodyStart = decl + "CMediaSound".length;
    expect(c[bodyStart]).toBe(6); // record schema
    const streamNameLen = c[bodyStart + 1]!;
    expect(streamNameLen).toBe("Media 1".length);
    const streamName = utf16Read(c, bodyStart + 2, streamNameLen);
    expect(streamName).toBe("Media 1");
    // displayName BomString right after the stream name.
    const bomAt = bodyStart + 2 + streamNameLen * 2;
    expect(c[bomAt]).toBe(0xff);
    expect(c[bomAt + 1]).toBe(0xfe);
    expect(c[bomAt + 2]).toBe(0xff);
    const dispLen = c[bomAt + 3]!;
    expect(utf16Read(c, bomAt + 4, dispLen)).toBe("boom.mp3");
  });

  it("emits a CMediaBits record byte-identical (through displayName) to the evaporatingdrip layout", () => {
    // evaporatingdrip.fla's genuine CMediaBits record for "Media 4" (display "metal")
    // is: NEWCLASS CMediaBits(schema 1) / record-schema 6 / "Media N" / BomString name.
    // We emit a single bitmap "metal" (→ Media 1) and assert the record header+body
    // through the displayName is byte-identical to that genuine layout, modulo the
    // stream number ("Media 1" here vs "Media 4" in the fixture — same field shape).
    const ORACLE_MEDIA1 = new Uint8Array([
      0xff, 0xff, 0x01, 0x00, 0x0a, 0x00, // NEWCLASS, schema 1, nameLen 10
      0x43, 0x4d, 0x65, 0x64, 0x69, 0x61, 0x42, 0x69, 0x74, 0x73, // "CMediaBits"
      0x06, 0x07, // record schema 6, stream-name len 7
      0x4d, 0x00, 0x65, 0x00, 0x64, 0x00, 0x69, 0x00, 0x61, 0x00, 0x20, 0x00, 0x31, 0x00, // "Media 1"
      0xff, 0xfe, 0xff, 0x05, // BomString marker + len 5
      0x6d, 0x00, 0x65, 0x00, 0x74, 0x00, 0x61, 0x00, 0x6c, 0x00, // "metal"
    ]);
    const bmp = createBitmap("metal", {
      // 1x1 transparent PNG so a Media stream is written.
      dataUri:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    });
    const doc = baseDoc([sceneWith("Scene 1", [])], {
      library: { items: [bmp], folders: [] },
    });
    const c = __readAllStreamsForTest(saveRealFla(doc)).get("Contents")!;

    // Locate the CMediaBits class decl and assert the full header+body through
    // displayName matches the genuine field layout.
    const decl = indexOf(c, asciiOf("CMediaBits"));
    expect(decl).toBeGreaterThan(0);
    const recordStart = decl - 6; // back up to the FFFF tag
    const actual = c.subarray(recordStart, recordStart + ORACLE_MEDIA1.length);
    expect(Array.from(actual)).toEqual(Array.from(ORACLE_MEDIA1));
  });
});

// ---------------------------------------------------------------------------
// task 1386: features the writer used to silently DROP even though the importer
// fully decodes them. Each block writes the feature, reads it back through the
// importer's own reader (parseFla8Timeline / tryLoadRealFla) — the inverse oracle
// — and asserts it is preserved.
// ---------------------------------------------------------------------------

function graphicInstanceDoc(inst: Partial<SymbolInstance>): FlashDocument {
  const sym = createSymbol("MyGraphic", "graphic");
  const instance: SymbolInstance = {
    type: "instance",
    id: "inst1",
    symbolId: sym.id,
    x: 100,
    y: 60,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    ...inst,
  };
  return baseDoc([sceneWith("Scene 1", [layerWith("Layer 1", "normal", [instance])])], {
    library: { items: [sym], folders: [] },
  });
}

function firstInstance(doc: FlashDocument): SymbolInstance | undefined {
  for (const layer of doc.scenes[0]!.timeline.layers) {
    for (const f of layer.frames) {
      const inst = f.displayObjects.find((o) => o.type === "instance");
      if (inst) return inst as SymbolInstance;
    }
  }
  return undefined;
}

describe("saveRealFla — instance color effects (§12 CXFORM) round-trip (task 1386)", () => {
  it("brightness round-trips (was: only alpha encoded, others dropped to identity)", () => {
    for (const brightness of [-60, -20, 40, 80]) {
      const ce: ColorEffect = { type: "brightness", brightness };
      const out = tryLoadRealFla(saveRealFla(graphicInstanceDoc({ colorEffect: ce })));
      const inst = firstInstance(out!);
      expect(inst?.colorEffect?.type).toBe("brightness");
      expect(inst?.colorEffect?.brightness).toBe(brightness);
    }
  });

  it("tint round-trips (color + amount)", () => {
    const ce: ColorEffect = { type: "tint", tintColor: "#ff3300", tintAmount: 60 };
    const out = tryLoadRealFla(saveRealFla(graphicInstanceDoc({ colorEffect: ce })));
    const inst = firstInstance(out!);
    expect(inst?.colorEffect?.type).toBe("tint");
    expect(inst?.colorEffect?.tintAmount).toBe(60);
    // The tint color round-trips within the CXFORM offset quantisation (offset is an
    // integer 0..255, so a channel can drift ±1–2 after the mult/offset recovery).
    const hex = inst!.colorEffect!.tintColor!;
    const ch = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    expect(Math.abs(ch(0) - 0xff)).toBeLessThanOrEqual(2);
    expect(Math.abs(ch(1) - 0x33)).toBeLessThanOrEqual(2);
    expect(Math.abs(ch(2) - 0x00)).toBeLessThanOrEqual(2);
  });

  it("advanced (per-channel mult+offset) round-trips", () => {
    const ce: ColorEffect = {
      type: "advanced",
      redMult: 50, greenMult: 75, blueMult: 100, alphaMult: 90,
      redOffset: 20, greenOffset: -10, blueOffset: 5, alphaOffset: 0,
    };
    const out = tryLoadRealFla(saveRealFla(graphicInstanceDoc({ colorEffect: ce })));
    const inst = firstInstance(out!);
    expect(inst?.colorEffect?.type).toBe("advanced");
    expect(inst?.colorEffect?.redMult).toBe(50);
    expect(inst?.colorEffect?.greenMult).toBe(75);
    expect(inst?.colorEffect?.redOffset).toBe(20);
    expect(inst?.colorEffect?.greenOffset).toBe(-10);
  });

  it("alpha still round-trips (unchanged behaviour)", () => {
    const out = tryLoadRealFla(saveRealFla(graphicInstanceDoc({ colorEffect: { type: "alpha", alpha: 50 } })));
    const inst = firstInstance(out!);
    expect(inst?.colorEffect?.type).toBe("alpha");
    expect(inst?.colorEffect?.alpha).toBe(50);
  });
});

describe("saveRealFla — instance filters (SWF filter list) round-trip (task 1386)", () => {
  it("a drop-shadow filter round-trips (was: filterCount always 0)", () => {
    const filters: FlashFilter[] = [
      {
        type: "drop-shadow",
        distance: 4, angle: 45, color: { r: 10, g: 20, b: 30, a: 255 }, alpha: 0.8,
        blurX: 6, blurY: 6, strength: 2, inner: false, knockout: false, hideObject: false,
        quality: 2, enabled: true,
      },
    ];
    const out = tryLoadRealFla(saveRealFla(graphicInstanceDoc({ filters })));
    const inst = firstInstance(out!);
    expect(inst?.filters?.length).toBe(1);
    const f = inst!.filters![0]!;
    expect(f.type).toBe("drop-shadow");
    if (f.type === "drop-shadow") {
      expect(f.color).toEqual({ r: 10, g: 20, b: 30, a: 255 });
      expect(Math.round(f.alpha * 100)).toBe(80);
      expect(f.blurX).toBeCloseTo(6, 3);
      expect(Math.round(f.angle)).toBe(45);
    }
  });

  it("a blur + glow stack round-trips in order", () => {
    const filters: FlashFilter[] = [
      { type: "blur", blurX: 8, blurY: 4, quality: 3, enabled: true },
      {
        type: "glow", color: { r: 255, g: 0, b: 0, a: 255 }, alpha: 1, blurX: 5, blurY: 5,
        strength: 3, quality: 1, inner: true, knockout: false, enabled: true,
      },
    ];
    const out = tryLoadRealFla(saveRealFla(graphicInstanceDoc({ filters })));
    const inst = firstInstance(out!);
    expect(inst?.filters?.map((f) => f.type)).toEqual(["blur", "glow"]);
    const blur = inst!.filters![0]!;
    if (blur.type === "blur") {
      expect(blur.blurX).toBeCloseTo(8, 3);
      expect(blur.blurY).toBeCloseTo(4, 3);
    }
    const glow = inst!.filters![1]!;
    if (glow.type === "glow") {
      expect(glow.color).toEqual({ r: 255, g: 0, b: 0, a: 255 });
      expect(glow.inner).toBe(true);
    }
  });

  it("a movieclip (sprite) instance with a filter still parses its trailer (name preserved)", () => {
    const sym = createSymbol("MyClip", "movieclip");
    const instance: SymbolInstance = {
      type: "instance", id: "i1", symbolId: sym.id, x: 20, y: 20, scaleX: 1, scaleY: 1, rotation: 0,
      instanceName: "clipA",
      filters: [{ type: "blur", blurX: 4, blurY: 4, quality: 1, enabled: true }],
    };
    const doc = baseDoc([sceneWith("Scene 1", [layerWith("Layer 1", "normal", [instance])])], {
      library: { items: [sym], folders: [] },
    });
    const out = tryLoadRealFla(saveRealFla(doc));
    const inst = firstInstance(out!);
    expect(inst?.instanceName).toBe("clipA");
    expect(inst?.filters?.[0]?.type).toBe("blur");
  });

  it("a disabled filter is NOT emitted (count reflects only enabled)", () => {
    const filters: FlashFilter[] = [
      { type: "blur", blurX: 4, blurY: 4, quality: 1, enabled: false },
      { type: "blur", blurX: 9, blurY: 9, quality: 1, enabled: true },
    ];
    const out = tryLoadRealFla(saveRealFla(graphicInstanceDoc({ filters })));
    const inst = firstInstance(out!);
    expect(inst?.filters?.length).toBe(1);
    const f = inst!.filters![0]!;
    if (f.type === "blur") expect(f.blurX).toBeCloseTo(9, 3);
  });
});

describe("saveRealFla — shape gradient/bitmap fills round-trip (task 1386)", () => {
  function gradientRectDoc(fill: Fill): FlashDocument {
    const shape: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      x: 0,
      y: 0,
      shape: {
        id: "g1",
        paths: [
          {
            start: { x: 0, y: 0 },
            segments: [
              { type: "line", to: { x: 80, y: 0 } },
              { type: "line", to: { x: 80, y: 50 } },
              { type: "line", to: { x: 0, y: 50 } },
              { type: "line", to: { x: 0, y: 0 } },
            ],
            fill,
            closed: true,
          },
        ],
      },
    };
    return baseDoc([sceneWith("Scene 1", [layerWith("Layer 1", "normal", [shape])])]);
  }

  function firstShapeFill(doc: FlashDocument) {
    const tl = parseFla8Timeline(__readAllStreamsForTest(saveRealFla(doc)).get("Page 1")!);
    const el = tl.layers[0]!.frames[0]!.elements.find((e) => e.type === "shape");
    return (el as { fills: Array<Record<string, unknown>> }).fills[0]!;
  }

  it("a linear gradient round-trips (stops + spread + interpolation) — was: written as first-stop solid", () => {
    const fill: Fill = {
      type: "linear-gradient",
      angle: 0,
      matrix: { a: 2, b: 0, c: 0, d: 2, tx: 3, ty: 4 },
      stops: [
        { ratio: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
        { ratio: 128, color: { r: 0, g: 255, b: 0, a: 255 } },
        { ratio: 255, color: { r: 0, g: 0, b: 255, a: 255 } },
      ],
      spreadMode: "reflect",
      interpolation: "linearRGB",
    };
    const f = firstShapeFill(gradientRectDoc(fill)) as {
      kind: string; stops: Array<{ position: number; color: Record<string, number> }>;
      spreadMode?: number; linearRGB?: boolean; matrix: Record<string, number>;
    };
    expect(f.kind).toBe("linear-gradient");
    expect(f.stops.map((s) => s.position)).toEqual([0, 128, 255]);
    expect(f.stops[0]!.color).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(f.stops[2]!.color).toEqual({ r: 0, g: 0, b: 255, a: 255 });
    expect(f.spreadMode).toBe(1); // reflect
    expect(f.linearRGB).toBe(true);
    expect(f.matrix.a).toBeCloseTo(2, 3);
    expect(f.matrix.tx).toBeCloseTo(3, 3);
  });

  it("a radial gradient round-trips (focal + stops) — was: written as first-stop solid", () => {
    const fill: Fill = {
      type: "radial-gradient",
      focalPoint: 0.5,
      matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      stops: [
        { ratio: 0, color: { r: 255, g: 255, b: 255, a: 255 } },
        { ratio: 255, color: { r: 0, g: 0, b: 0, a: 255 } },
      ],
    };
    const f = firstShapeFill(gradientRectDoc(fill)) as {
      kind: string; focalRatio: number; stops: Array<{ position: number }>;
    };
    expect(f.kind).toBe("radial-gradient");
    expect(f.stops.map((s) => s.position)).toEqual([0, 255]);
    expect(f.focalRatio).toBeCloseTo(0.5, 2);
  });

  it("a bitmap fill round-trips (media id + repeat/smooth) — was: written as solid white", () => {
    const bmp = createBitmap("tex", {
      dataUri:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    });
    const shape: ShapeDisplayObject = {
      type: "shape", id: "s1", x: 0, y: 0,
      shape: {
        id: "g1",
        paths: [
          {
            start: { x: 0, y: 0 },
            segments: [
              { type: "line", to: { x: 60, y: 0 } },
              { type: "line", to: { x: 60, y: 40 } },
              { type: "line", to: { x: 0, y: 40 } },
              { type: "line", to: { x: 0, y: 0 } },
            ],
            fill: { type: "bitmap", bitmapId: bmp.id, repeat: false, smooth: true },
            closed: true,
          },
        ],
      },
    };
    const doc = baseDoc([sceneWith("Scene 1", [layerWith("Layer 1", "normal", [shape])])], {
      library: { items: [bmp], folders: [] },
    });
    const tl = parseFla8Timeline(__readAllStreamsForTest(saveRealFla(doc)).get("Page 1")!);
    const el = tl.layers[0]!.frames[0]!.elements.find((e) => e.type === "shape");
    const f = (el as { fills: Array<Record<string, unknown>> }).fills[0]! as {
      kind: string; bitmapId: number; repeat: boolean; smooth: boolean;
    };
    expect(f.kind).toBe("bitmap");
    expect(f.bitmapId).toBe(1); // the lone bitmap => Media 1
    expect(f.repeat).toBe(false);
    expect(f.smooth).toBe(true);
  });
});

describe("saveRealFla — custom per-property motion ease round-trips (task 1386)", () => {
  function motionTweenDoc(overrides: Partial<Frame>): FlashDocument {
    const sym = createSymbol("G", "graphic");
    const inst: SymbolInstance = {
      type: "instance", id: "i1", symbolId: sym.id, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
    };
    const frame = createFrame(0, {
      isKeyframe: true,
      isEmpty: false,
      tweenType: "motion",
      displayObjects: [inst],
      ...overrides,
    });
    const layer = createLayer("Layer 1", "normal", { frames: [frame], frameCount: 10 });
    return baseDoc([sceneWith("Scene 1", [layer])], { library: { items: [sym], folders: [] } });
  }

  it("a single custom ease curve round-trips (was: hasCustomEase always 0)", () => {
    const curve: EaseCurve = { x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.9 };
    const tl = parseFla8Timeline(
      __readAllStreamsForTest(saveRealFla(motionTweenDoc({ motionEaseCurve: curve }))).get("Page 1")!,
    );
    const f = tl.layers[0]!.frames[0]!;
    expect(f.motionEaseCurve).not.toBeNull();
    expect(f.motionEaseCurve!.x1).toBeCloseTo(0.25, 4);
    expect(f.motionEaseCurve!.y1).toBeCloseTo(0.1, 4);
    expect(f.motionEaseCurve!.x2).toBeCloseTo(0.75, 4);
    expect(f.motionEaseCurve!.y2).toBeCloseTo(0.9, 4);
  });

  it("per-property ease curves round-trip (position + scale)", () => {
    const pos: EaseCurve = { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 };
    const scale: EaseCurve = { x1: 0.6, y1: 0.7, x2: 0.8, y2: 1.2 };
    const tl = parseFla8Timeline(
      __readAllStreamsForTest(
        saveRealFla(motionTweenDoc({ easeForPosition: pos, easeForScale: scale })),
      ).get("Page 1")!,
    );
    const f = tl.layers[0]!.frames[0]!;
    expect(f.easeForPosition?.x1).toBeCloseTo(0.1, 4);
    expect(f.easeForPosition?.y2).toBeCloseTo(0.4, 4);
    expect(f.easeForScale?.x1).toBeCloseTo(0.6, 4);
    expect(f.easeForScale?.y2).toBeCloseTo(1.2, 4);
  });

  it("a motion tween WITHOUT a custom curve still emits the no-curve header (validates)", () => {
    const doc = motionTweenDoc({ motionEase: 50 });
    const streams = __readAllStreamsForTest(saveRealFla(doc));
    validateContentsStream(streams.get("Contents")!);
    const page = validateTimelineStream(streams.get("Page 1")!);
    expect(page.classes).toContain("CPicFrame");
    const tl = parseFla8Timeline(streams.get("Page 1")!);
    expect(tl.layers[0]!.frames[0]!.motionEaseCurve).toBeNull();
  });
});

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function asciiOf(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function utf16Read(data: Uint8Array, at: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(data[at + i * 2]! | (data[at + i * 2 + 1]! << 8));
  return s;
}

function countClassDecls(data: Uint8Array, name: string): number {
  const ascii = asciiOf(name);
  let n = 0;
  for (let i = 0; i + 6 + name.length <= data.length; i++) {
    if (data[i] === 0xff && data[i + 1] === 0xff) {
      const len = data[i + 4]! | (data[i + 5]! << 8);
      if (len === name.length && indexOf(data.subarray(i + 6, i + 6 + name.length), ascii) === 0) n++;
    }
  }
  return n;
}

/**
 * Tests for SceneAndFrameLabelData (SWF tag 86) encoding.
 *
 * Covers:
 *  - encodeU32: 1-byte encoding for values ≤ 127, 2-byte encoding for value 128
 *  - encodeSceneAndFrameLabelData: single scene/no labels, two scenes with offsets,
 *    frame labels with correct absolute frame numbers, comment-type label exclusion
 *  - Tag header code = 86
 *  - compileDocument integration: tag 86 emitted when 2+ scenes or any named labels
 *
 * Tag code: 86  SceneAndFrameLabelData
 */

import { describe, it, expect } from 'vitest';
import {
  encodeU32,
  encodeSceneAndFrameLabelData,
  hasAnyLabels,
  TAG_SCENE_AND_FRAME_LABEL_DATA,
} from '../scenelabels.js';
import { compileDocument } from '../compile.js';
import type { FlashDocument, Frame, Layer, Scene } from '@flash/core';

// ---------------------------------------------------------------------------
// SWF binary parser helpers (for integration tests)
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
}

function parseTags(swf: Uint8Array): SwfTag[] {
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4;

  const tags: SwfTag[] = [];
  while (pos < swf.length) {
    const recordHeader = swf[pos] | (swf[pos + 1] << 8);
    const tagCode = (recordHeader >> 6) & 0x3ff;
    let bodyLength = recordHeader & 0x3f;
    let headerSize = 2;
    if (bodyLength === 0x3f) {
      bodyLength =
        swf[pos + 2] |
        (swf[pos + 3] << 8) |
        (swf[pos + 4] << 16) |
        (swf[pos + 5] << 24);
      headerSize = 6;
    }
    const bodyStart = pos + headerSize;
    tags.push({
      code: tagCode,
      body: swf.slice(bodyStart, bodyStart + bodyLength),
    });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Tag record parser (for unit tests — parses a standalone tag record byte array)
// ---------------------------------------------------------------------------

function parseTagRecord(bytes: Uint8Array): { code: number; body: Uint8Array } {
  const recordHeader = bytes[0] | (bytes[1] << 8);
  const tagCode = (recordHeader >> 6) & 0x3ff;
  let bodyLength = recordHeader & 0x3f;
  let headerSize = 2;
  if (bodyLength === 0x3f) {
    bodyLength =
      bytes[2] |
      (bytes[3] << 8) |
      (bytes[4] << 16) |
      (bytes[5] << 24);
    headerSize = 6;
  }
  return {
    code: tagCode,
    body: bytes.slice(headerSize, headerSize + bodyLength),
  };
}

// ---------------------------------------------------------------------------
// EncodedU32 body parser
// ---------------------------------------------------------------------------

function readU32(body: Uint8Array, pos: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  while (true) {
    const byte = body[pos + bytesRead];
    bytesRead++;
    value |= (byte & 0x7f) << shift;
    shift += 7;
    if ((byte & 0x80) === 0) break;
  }
  return { value, bytesRead };
}

function readNullString(body: Uint8Array, pos: number): { str: string; bytesRead: number } {
  let end = pos;
  while (end < body.length && body[end] !== 0) end++;
  const str = new TextDecoder().decode(body.slice(pos, end));
  return { str, bytesRead: end - pos + 1 }; // +1 for null byte
}

// ---------------------------------------------------------------------------
// Document factory helpers
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  width: 550,
  height: 400,
  frameRate: 12,
  backgroundColor: '#ffffff',
  rulerUnits: 'px' as const,
  grid: {
    showGrid: false,
    snapToGrid: false,
    gridColor: '#999999',
    gridWidth: 18,
    gridHeight: 18,
  },
  guides: [],
  snapToObjects: false,
  snapToPixels: false,
  snapToGuides: false,
};

function makeFrame(
  index: number,
  label = '',
  labelType: 'name' | 'anchor' | 'comment' = 'name'
): Frame {
  return {
    index,
    isKeyframe: true,
    isEmpty: true,
    tweenType: 'none',
    label,
    labelType,
    script: '',
    sound: null,
    motionEase: 0,
    motionRotate: 'none',
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionScale: false,
    shapeEase: 0,
    shapeBlend: 'distributive',
    displayObjects: [],
  };
}

function makeLayer(id: string, frames: Frame[]): Layer {
  return {
    id,
    name: id,
    type: 'normal',
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: '#ff0000',
    height: 20,
    parentFolderId: null,
    frames,
    frameCount: frames.length,
  };
}

function makeScene(id: string, name: string, frames: Frame[]): Scene {
  return {
    id,
    name,
    timeline: {
      layers: [makeLayer(`${id}-layer`, frames)],
    },
  };
}

function makeDoc(scenes: Scene[]): FlashDocument {
  return {
    id: 'doc-1',
    properties: BASE_PROPS,
    scenes,
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// encodeU32 unit tests
// ---------------------------------------------------------------------------

describe('encodeU32', () => {
  it('encodes value 0 as a single byte 0x00', () => {
    const result = encodeU32(0);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(0x00);
  });

  it('encodes value 1 as a single byte 0x01', () => {
    const result = encodeU32(1);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(0x01);
  });

  it('encodes value 127 as a single byte 0x7F', () => {
    const result = encodeU32(127);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(0x7f);
  });

  it('encodes value 128 as two bytes', () => {
    const result = encodeU32(128);
    expect(result.length).toBe(2);
    // 128 = 0b10000000; low 7 bits = 0, more follows, so first byte = 0x80
    expect(result[0]).toBe(0x80);
    // Second group = 1 (128 >>> 7 = 1), no more follows
    expect(result[1]).toBe(0x01);
  });

  it('encodes value 255 as two bytes', () => {
    const result = encodeU32(255);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(0xff); // low 7 bits = 0x7f with continuation bit = 0xff
    expect(result[1]).toBe(0x01); // 255 >>> 7 = 1
  });

  it('round-trips correctly for various values', () => {
    for (const v of [0, 1, 63, 127, 128, 255, 1000, 16383, 16384, 65535]) {
      const encoded = encodeU32(v);
      const { value } = readU32(encoded, 0);
      expect(value).toBe(v);
    }
  });
});

// ---------------------------------------------------------------------------
// encodeSceneAndFrameLabelData unit tests
// ---------------------------------------------------------------------------

describe('encodeSceneAndFrameLabelData', () => {
  it('single scene no labels: scene count = 1, offset = 0, frame label count = 0', () => {
    const doc = makeDoc([makeScene('s1', 'Scene 1', [makeFrame(0)])]);
    const tagRecord = encodeSceneAndFrameLabelData(doc);
    const { code, body } = parseTagRecord(tagRecord);

    expect(code).toBe(86);

    let pos = 0;

    // SceneCount = 1
    const sceneCountResult = readU32(body, pos);
    expect(sceneCountResult.value).toBe(1);
    pos += sceneCountResult.bytesRead;

    // Scene 0: FrameOffset = 0
    const frameOffsetResult = readU32(body, pos);
    expect(frameOffsetResult.value).toBe(0);
    pos += frameOffsetResult.bytesRead;

    // Scene 0: Name = "Scene 1"
    const nameResult = readNullString(body, pos);
    expect(nameResult.str).toBe('Scene 1');
    pos += nameResult.bytesRead;

    // FrameLabelCount = 0
    const labelCountResult = readU32(body, pos);
    expect(labelCountResult.value).toBe(0);
  });

  it('two scenes produce correct cumulative frame offsets', () => {
    const doc = makeDoc([
      makeScene('s1', 'Scene 1', [makeFrame(0), makeFrame(1), makeFrame(2)]),
      makeScene('s2', 'Scene 2', [makeFrame(0), makeFrame(1)]),
    ]);
    const tagRecord = encodeSceneAndFrameLabelData(doc);
    const { body } = parseTagRecord(tagRecord);

    let pos = 0;

    // SceneCount = 2
    const { value: sceneCount, bytesRead: scr } = readU32(body, pos);
    expect(sceneCount).toBe(2);
    pos += scr;

    // Scene 0 offset = 0, name = "Scene 1"
    const { value: offset0, bytesRead: o0r } = readU32(body, pos);
    expect(offset0).toBe(0);
    pos += o0r;
    const { str: name0, bytesRead: n0r } = readNullString(body, pos);
    expect(name0).toBe('Scene 1');
    pos += n0r;

    // Scene 1 offset = 3 (3 frames in scene 1)
    const { value: offset1, bytesRead: o1r } = readU32(body, pos);
    expect(offset1).toBe(3);
    pos += o1r;
    const { str: name1, bytesRead: n1r } = readNullString(body, pos);
    expect(name1).toBe('Scene 2');
    pos += n1r;

    // FrameLabelCount = 0
    const { value: labelCount } = readU32(body, pos);
    expect(labelCount).toBe(0);
  });

  it('frame label in scene 1 appears with correct absolute frame number', () => {
    // Scene 1: 3 frames, Scene 2: frame 1 labeled "myLabel"
    const doc = makeDoc([
      makeScene('s1', 'Scene 1', [makeFrame(0), makeFrame(1), makeFrame(2)]),
      makeScene('s2', 'Scene 2', [makeFrame(0), makeFrame(1, 'myLabel', 'name'), makeFrame(2)]),
    ]);
    const tagRecord = encodeSceneAndFrameLabelData(doc);
    const { body } = parseTagRecord(tagRecord);

    let pos = 0;

    // SceneCount = 2
    const { value: sceneCount, bytesRead: scr } = readU32(body, pos);
    expect(sceneCount).toBe(2);
    pos += scr;

    // Skip scene data
    for (let i = 0; i < 2; i++) {
      const { bytesRead } = readU32(body, pos);
      pos += bytesRead;
      const { bytesRead: nb } = readNullString(body, pos);
      pos += nb;
    }

    // FrameLabelCount = 1
    const { value: labelCount, bytesRead: lcr } = readU32(body, pos);
    expect(labelCount).toBe(1);
    pos += lcr;

    // Label 0: absolute frame = 3 + 1 = 4
    const { value: frameNum, bytesRead: fnr } = readU32(body, pos);
    expect(frameNum).toBe(4); // 3 frames in scene 1, then frame index 1 in scene 2
    pos += fnr;

    const { str: labelName } = readNullString(body, pos);
    expect(labelName).toBe('myLabel');
  });

  it('comment-type labels are excluded from frame label data', () => {
    const doc = makeDoc([
      makeScene('s1', 'Scene 1', [
        makeFrame(0),
        makeFrame(1, 'commentLabel', 'comment'),
        makeFrame(2, 'namedLabel', 'name'),
      ]),
    ]);
    const tagRecord = encodeSceneAndFrameLabelData(doc);
    const { body } = parseTagRecord(tagRecord);

    let pos = 0;

    // Skip scene count + scene data
    const { value: sceneCount, bytesRead: scr } = readU32(body, pos);
    pos += scr;
    for (let i = 0; i < sceneCount; i++) {
      const { bytesRead: or } = readU32(body, pos);
      pos += or;
      const { bytesRead: nr } = readNullString(body, pos);
      pos += nr;
    }

    // FrameLabelCount should be 1 (only the 'name' type label)
    const { value: labelCount, bytesRead: lcr } = readU32(body, pos);
    expect(labelCount).toBe(1);
    pos += lcr;

    // The frame label should be 'namedLabel', not 'commentLabel'
    const { value: frameNum, bytesRead: fnr } = readU32(body, pos);
    expect(frameNum).toBe(2); // frame index 2
    pos += fnr;
    const { str: labelName } = readNullString(body, pos);
    expect(labelName).toBe('namedLabel');
  });

  it('anchor-type labels are excluded from frame label data', () => {
    const doc = makeDoc([
      makeScene('s1', 'Scene 1', [
        makeFrame(0),
        makeFrame(1, 'anchorLabel', 'anchor'),
        makeFrame(2, 'namedLabel', 'name'),
      ]),
    ]);
    const tagRecord = encodeSceneAndFrameLabelData(doc);
    const { body } = parseTagRecord(tagRecord);

    let pos = 0;
    const { value: sceneCount, bytesRead: scr } = readU32(body, pos);
    pos += scr;
    for (let i = 0; i < sceneCount; i++) {
      const { bytesRead: or } = readU32(body, pos);
      pos += or;
      const { bytesRead: nr } = readNullString(body, pos);
      pos += nr;
    }

    // FrameLabelCount should be 1 (only the 'name' type label)
    const { value: labelCount } = readU32(body, pos);
    expect(labelCount).toBe(1);
  });

  it('tag code in header is 86', () => {
    const doc = makeDoc([makeScene('s1', 'Scene 1', [makeFrame(0)])]);
    const tagRecord = encodeSceneAndFrameLabelData(doc);
    const { code } = parseTagRecord(tagRecord);
    expect(code).toBe(TAG_SCENE_AND_FRAME_LABEL_DATA);
    expect(code).toBe(86);
  });

  it('multiple labeled frames across scenes encode correctly', () => {
    // Scene 1: 2 frames, labeled frame at index 1
    // Scene 2: 3 frames, labeled frames at index 0 and 2
    const doc = makeDoc([
      makeScene('s1', 'Intro', [makeFrame(0), makeFrame(1, 'start', 'name')]),
      makeScene('s2', 'Main', [
        makeFrame(0, 'main', 'name'),
        makeFrame(1),
        makeFrame(2, 'end', 'name'),
      ]),
    ]);
    const tagRecord = encodeSceneAndFrameLabelData(doc);
    const { body } = parseTagRecord(tagRecord);

    let pos = 0;
    const { value: sceneCount, bytesRead: scr } = readU32(body, pos);
    expect(sceneCount).toBe(2);
    pos += scr;

    // Skip scene data
    for (let i = 0; i < 2; i++) {
      const { bytesRead: or } = readU32(body, pos);
      pos += or;
      const { bytesRead: nr } = readNullString(body, pos);
      pos += nr;
    }

    // FrameLabelCount = 3
    const { value: labelCount, bytesRead: lcr } = readU32(body, pos);
    expect(labelCount).toBe(3);
    pos += lcr;

    // Label 0: frame 1, name "start"
    const { value: fn0, bytesRead: fn0r } = readU32(body, pos);
    expect(fn0).toBe(1);
    pos += fn0r;
    const { str: ln0, bytesRead: ln0r } = readNullString(body, pos);
    expect(ln0).toBe('start');
    pos += ln0r;

    // Label 1: frame 2+0=2, name "main"
    const { value: fn1, bytesRead: fn1r } = readU32(body, pos);
    expect(fn1).toBe(2);
    pos += fn1r;
    const { str: ln1, bytesRead: ln1r } = readNullString(body, pos);
    expect(ln1).toBe('main');
    pos += ln1r;

    // Label 2: frame 2+2=4, name "end"
    const { value: fn2, bytesRead: fn2r } = readU32(body, pos);
    expect(fn2).toBe(4);
    pos += fn2r;
    const { str: ln2 } = readNullString(body, pos);
    expect(ln2).toBe('end');
  });
});

// ---------------------------------------------------------------------------
// hasAnyLabels unit tests
// ---------------------------------------------------------------------------

describe('hasAnyLabels', () => {
  it('returns false when no frames have labels', () => {
    const doc = makeDoc([makeScene('s1', 'Scene 1', [makeFrame(0), makeFrame(1)])]);
    expect(hasAnyLabels(doc)).toBe(false);
  });

  it('returns true when a frame has a name-type label', () => {
    const doc = makeDoc([
      makeScene('s1', 'Scene 1', [makeFrame(0), makeFrame(1, 'myLabel', 'name')]),
    ]);
    expect(hasAnyLabels(doc)).toBe(true);
  });

  it('returns false when only comment-type labels exist', () => {
    const doc = makeDoc([
      makeScene('s1', 'Scene 1', [makeFrame(0), makeFrame(1, 'comment', 'comment')]),
    ]);
    expect(hasAnyLabels(doc)).toBe(false);
  });

  it('returns false when only anchor-type labels exist', () => {
    const doc = makeDoc([
      makeScene('s1', 'Scene 1', [makeFrame(0), makeFrame(1, 'anchor', 'anchor')]),
    ]);
    expect(hasAnyLabels(doc)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// compileDocument integration tests
// ---------------------------------------------------------------------------

describe('compileDocument SceneAndFrameLabelData integration', () => {
  it('single scene with no labels does NOT emit tag 86', () => {
    const doc = makeDoc([makeScene('s1', 'Scene 1', [makeFrame(0), makeFrame(1)])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const tag86 = tags.find((t) => t.code === 86);
    expect(tag86).toBeUndefined();
  });

  it('two named scenes emit tag 86', () => {
    const doc = makeDoc([
      makeScene('s1', 'Scene 1', [makeFrame(0)]),
      makeScene('s2', 'Scene 2', [makeFrame(0)]),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const tag86 = tags.find((t) => t.code === 86);
    expect(tag86).toBeDefined();
  });

  it('single scene with a named label emits tag 86', () => {
    const doc = makeDoc([
      makeScene('s1', 'Scene 1', [makeFrame(0), makeFrame(1, 'myLabel', 'name')]),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const tag86 = tags.find((t) => t.code === 86);
    expect(tag86).toBeDefined();
  });

  it('tag 86 appears immediately after FileAttributes (tag 69)', () => {
    const doc = makeDoc([
      makeScene('s1', 'Scene 1', [makeFrame(0)]),
      makeScene('s2', 'Scene 2', [makeFrame(0)]),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const fileAttrsIdx = tags.findIndex((t) => t.code === 69);
    const tag86Idx = tags.findIndex((t) => t.code === 86);

    expect(fileAttrsIdx).toBeGreaterThanOrEqual(0);
    expect(tag86Idx).toBe(fileAttrsIdx + 1);
  });

  it('tag 86 in compiled SWF has correct scene count for 2-scene document', () => {
    const doc = makeDoc([
      makeScene('s1', 'Intro', [makeFrame(0), makeFrame(1), makeFrame(2)]),
      makeScene('s2', 'Main', [makeFrame(0), makeFrame(1)]),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const tag86 = tags.find((t) => t.code === 86)!;
    expect(tag86).toBeDefined();

    // Parse scene count from body
    const { value: sceneCount } = readU32(tag86.body, 0);
    expect(sceneCount).toBe(2);
  });

  it('tag 86 body includes correct frame offsets for 2 scenes', () => {
    const doc = makeDoc([
      makeScene('s1', 'Intro', [makeFrame(0), makeFrame(1), makeFrame(2)]),
      makeScene('s2', 'Main', [makeFrame(0), makeFrame(1)]),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const tag86 = tags.find((t) => t.code === 86)!;
    const body = tag86.body;

    let pos = 0;
    const { value: sceneCount, bytesRead: scr } = readU32(body, pos);
    expect(sceneCount).toBe(2);
    pos += scr;

    // Scene 0 offset = 0
    const { value: offset0, bytesRead: o0r } = readU32(body, pos);
    expect(offset0).toBe(0);
    pos += o0r;
    const { str: name0, bytesRead: n0r } = readNullString(body, pos);
    expect(name0).toBe('Intro');
    pos += n0r;

    // Scene 1 offset = 3 (3 frames in Intro)
    const { value: offset1, bytesRead: o1r } = readU32(body, pos);
    expect(offset1).toBe(3);
    pos += o1r;
    const { str: name1 } = readNullString(body, pos);
    expect(name1).toBe('Main');
  });
});

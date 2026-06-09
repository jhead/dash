/**
 * Tests for SceneAndFrameLabelData (SWF tag 86) in compiled SWF output.
 *
 * Covers:
 *  1. Single-scene document compiles without error (tag 86 may or may not be present)
 *  2. Multi-scene document (2 scenes with different names): tag 86 is emitted with
 *     correct scene count in the compiled SWF
 *  3. Document with a named frame: FrameLabel tag (type 43) exists in the output
 *
 * Note: Tag 86 IS implemented — the compiler emits it when doc.scenes.length > 1
 * OR when any frame has a name-type label.
 *
 * Tag codes:
 *    0  End
 *    1  ShowFrame
 *   43  FrameLabel
 *   86  SceneAndFrameLabelData
 */

import { describe, it, expect } from 'vitest';
import { compileDocument } from '../compile.js';
import type { FlashDocument, Frame, Layer, Scene } from '@flash/core';

// ---------------------------------------------------------------------------
// SWF binary parser helper
// ---------------------------------------------------------------------------

interface SwfTag {
  type: number;
  body: Uint8Array;
}

function findTags(bytes: Uint8Array): SwfTag[] {
  const nbits = (bytes[8] >> 3) & 0x1f;
  const rectBytes = Math.ceil((5 + 4 * nbits) / 8);
  let i = 8 + rectBytes + 4;
  const tags: SwfTag[] = [];
  while (i < bytes.length - 1) {
    const h = bytes[i] | (bytes[i + 1] << 8);
    i += 2;
    const type = (h >> 6) & 0x3ff;
    let len = h & 0x3f;
    if (len === 63) {
      len =
        bytes[i] |
        (bytes[i + 1] << 8) |
        (bytes[i + 2] << 16) |
        (bytes[i + 3] << 24);
      i += 4;
    }
    tags.push({ type, body: bytes.slice(i, i + len) });
    if (type === 0) break;
    i += len;
  }
  return tags;
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
    id: 'doc-sceneframes',
    properties: BASE_PROPS,
    scenes,
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sceneframes: SWF tag 86 (SceneAndFrameLabelData)', () => {
  it('single-scene document exports without error', () => {
    const doc = makeDoc([makeScene('s1', 'Scene 1', [makeFrame(0)])]);
    let swf: Uint8Array | undefined;
    expect(() => {
      swf = compileDocument(doc);
    }).not.toThrow();
    // Must produce valid SWF: begins with FWS signature
    expect(swf).toBeDefined();
    expect(swf![0]).toBe(0x46); // 'F'
    expect(swf![1]).toBe(0x57); // 'W'
    expect(swf![2]).toBe(0x53); // 'S'
  });

  it('multi-scene document emits tag 86 with correct scene count', () => {
    const doc = makeDoc([
      makeScene('s1', 'Intro', [makeFrame(0), makeFrame(1)]),
      makeScene('s2', 'Main', [makeFrame(0), makeFrame(1), makeFrame(2)]),
    ]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const tag86 = tags.find((t) => t.type === 86);

    // Tag 86 IS implemented: multi-scene docs must emit it
    expect(tag86).toBeDefined();

    // Parse scene count from body (EncodedU32: value <= 127 fits in one byte)
    const sceneCount = tag86!.body[0];
    expect(sceneCount).toBe(2);
  });

  it('document with a named frame has FrameLabel tag (type 43) in output', () => {
    const doc = makeDoc([
      makeScene('s1', 'Scene 1', [
        makeFrame(0),
        makeFrame(1, 'myLabel', 'name'),
        makeFrame(2),
      ]),
    ]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);

    // The scene name ("Scene 1") is also emitted as a FrameLabel at the start of the scene.
    // Find the FrameLabel whose body contains "myLabel".
    const frameLabelTags = tags.filter((t) => t.type === 43);
    expect(frameLabelTags.length).toBeGreaterThanOrEqual(1);

    const decodeLabel = (body: Uint8Array): string => {
      const nullIdx = body.indexOf(0);
      return new TextDecoder().decode(body.slice(0, nullIdx < 0 ? body.length : nullIdx));
    };

    const labelNames = frameLabelTags.map((t) => decodeLabel(t.body));
    expect(labelNames).toContain('myLabel');
  });
});

/**
 * Tests for FLA round-trip preservation of sound linkage.
 *
 * Verifies that frame sound references (SoundLinkage) and SoundItem library
 * entries survive saveFla/loadFla without loss.
 */

import { describe, it, expect } from "vitest";
import { createDocument } from "../../model/document.js";
import { createFrame, createLayer } from "../../model/timeline.js";
import { createScene } from "../../model/scene.js";
import { saveFla, loadFla } from "../zip.js";
import type {
  FlashDocument,
  Scene,
  SoundItem,
  SoundLinkage,
} from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal SoundItem for the library. */
function makeSoundItem(id: string, name: string): SoundItem {
  return {
    id,
    name,
    itemType: "sound",
    dataUri: "data:audio/mp3;base64,AAAA",
    sampleRate: 44100,
    sampleSize: 16,
    isStereo: false,
    durationSeconds: 1.5,
    compressionType: "mp3",
  };
}

/** Build a FlashDocument with a single frame that has the given sound linkage. */
function makeDocWithFrameSound(
  sound: SoundLinkage | null,
  extraLibraryItems: SoundItem[] = []
): FlashDocument {
  const frame = createFrame(0, {
    isKeyframe: true,
    isEmpty: true,
    sound,
  });
  const layer = createLayer("Layer 1", "normal", { frames: [frame] });
  const scene: Scene = {
    id: "sc-1",
    name: "Scene 1",
    timeline: { layers: [layer] },
  };
  return {
    ...createDocument(),
    scenes: [scene],
    library: { items: extraLibraryItems, folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Test 1: syncMode='event' + repeatCount=1 survives round-trip
// ---------------------------------------------------------------------------

describe("FLA round-trip: frame sound linkage", () => {
  it("1. syncMode='event' + repeatCount=1 survive saveFla/loadFla", () => {
    const soundLinkage: SoundLinkage = {
      libraryItemId: "snd1",
      syncMode: "event",
      repeatCount: 1,
    };
    const doc = makeDocWithFrameSound(soundLinkage);
    const restored = loadFla(saveFla(doc));
    const restoredSound = restored.scenes[0]?.timeline.layers[0]?.frames[0]?.sound;

    expect(restoredSound).not.toBeNull();
    expect(restoredSound?.libraryItemId).toBe("snd1");
    expect(restoredSound?.syncMode).toBe("event");
    expect(restoredSound?.repeatCount).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Test 2: syncMode='start' is preserved
  // ---------------------------------------------------------------------------

  it("2. syncMode='start' is preserved", () => {
    const soundLinkage: SoundLinkage = {
      libraryItemId: "snd-start",
      syncMode: "start",
      repeatCount: 1,
    };
    const doc = makeDocWithFrameSound(soundLinkage);
    const restored = loadFla(saveFla(doc));
    const restoredSound = restored.scenes[0]?.timeline.layers[0]?.frames[0]?.sound;

    expect(restoredSound?.syncMode).toBe("start");
  });

  // ---------------------------------------------------------------------------
  // Test 3: syncMode='stop' is preserved
  // ---------------------------------------------------------------------------

  it("3. syncMode='stop' is preserved", () => {
    const soundLinkage: SoundLinkage = {
      libraryItemId: "snd-stop",
      syncMode: "stop",
      repeatCount: 0,
    };
    const doc = makeDocWithFrameSound(soundLinkage);
    const restored = loadFla(saveFla(doc));
    const restoredSound = restored.scenes[0]?.timeline.layers[0]?.frames[0]?.sound;

    expect(restoredSound?.syncMode).toBe("stop");
  });

  // ---------------------------------------------------------------------------
  // Test 4: syncMode='stream' is preserved
  // ---------------------------------------------------------------------------

  it("4. syncMode='stream' is preserved", () => {
    const soundLinkage: SoundLinkage = {
      libraryItemId: "snd-stream",
      syncMode: "stream",
      repeatCount: 1,
    };
    const doc = makeDocWithFrameSound(soundLinkage);
    const restored = loadFla(saveFla(doc));
    const restoredSound = restored.scenes[0]?.timeline.layers[0]?.frames[0]?.sound;

    expect(restoredSound?.syncMode).toBe("stream");
  });

  // ---------------------------------------------------------------------------
  // Test 5: repeatCount=0 (loop forever) is preserved
  // ---------------------------------------------------------------------------

  it("5. repeatCount=0 (loop forever) is preserved", () => {
    const soundLinkage: SoundLinkage = {
      libraryItemId: "snd-loop",
      syncMode: "event",
      repeatCount: 0,
    };
    const doc = makeDocWithFrameSound(soundLinkage);
    const restored = loadFla(saveFla(doc));
    const restoredSound = restored.scenes[0]?.timeline.layers[0]?.frames[0]?.sound;

    expect(restoredSound?.repeatCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test 6: sound=null (no sound) stays null after round-trip
  // ---------------------------------------------------------------------------

  it("6. sound=null stays null after round-trip", () => {
    const doc = makeDocWithFrameSound(null);
    const restored = loadFla(saveFla(doc));
    const restoredSound = restored.scenes[0]?.timeline.layers[0]?.frames[0]?.sound;

    expect(restoredSound).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Test 7: SoundItem in library — name and itemType survive
  // ---------------------------------------------------------------------------

  it("7. SoundItem in library — name and itemType survive round-trip", () => {
    const soundItem = makeSoundItem("snd-lib-1", "boom.mp3");
    const doc = makeDocWithFrameSound(null, [soundItem]);
    const restored = loadFla(saveFla(doc));
    const restoredItem = restored.library.items.find((i) => i.id === "snd-lib-1");

    expect(restoredItem).toBeDefined();
    expect(restoredItem?.name).toBe("boom.mp3");
    expect(restoredItem?.itemType).toBe("sound");
  });
});

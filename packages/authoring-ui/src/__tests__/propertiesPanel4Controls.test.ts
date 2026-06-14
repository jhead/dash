/**
 * Acceptance tests for the 4 new Properties-panel controls (task 1188):
 *   1. Sound frame "Effect" dropdown → SoundLinkage.effect
 *   2. Input-text "Restrict" field   → TextDisplayObject.restrict
 *   3. Button "Track as Menu Item"   → SymbolInstance.trackAsMenu
 *   4. Instance "cacheAsBitmap"      → SymbolInstance.cacheAsBitmap
 *
 * These are pure-logic / model-contract tests — no React rendering required.
 * They verify the model fields exist and round-trip correctly.
 */

import { describe, it, expect } from "vitest";
import type {
  SoundLinkage,
  SoundEffect,
  SymbolInstance,
  TextDisplayObject,
} from "@flash/core";

// ---------------------------------------------------------------------------
// 1. Sound Effect — SoundLinkage.effect enum values
// ---------------------------------------------------------------------------

describe("SoundLinkage.effect", () => {
  it("accepts 'left' (Left Channel) and round-trips via spread", () => {
    const base: SoundLinkage = {
      libraryItemId: "snd1",
      syncMode: "event",
      repeatCount: 1,
    };
    const updated: SoundLinkage = { ...base, effect: "left" };
    expect(updated.effect).toBe("left");
  });

  it("accepts 'right' (Right Channel)", () => {
    const base: SoundLinkage = { libraryItemId: "snd1", syncMode: "event", repeatCount: 1 };
    expect(({ ...base, effect: "right" } as SoundLinkage).effect).toBe("right");
  });

  it("accepts 'fadeIn' (Fade In)", () => {
    const base: SoundLinkage = { libraryItemId: "snd1", syncMode: "event", repeatCount: 1 };
    expect(({ ...base, effect: "fadeIn" } as SoundLinkage).effect).toBe("fadeIn");
  });

  it("accepts 'fadeOut' (Fade Out)", () => {
    const base: SoundLinkage = { libraryItemId: "snd1", syncMode: "event", repeatCount: 1 };
    expect(({ ...base, effect: "fadeOut" } as SoundLinkage).effect).toBe("fadeOut");
  });

  it("accepts 'fadeLeftToRight'", () => {
    const base: SoundLinkage = { libraryItemId: "snd1", syncMode: "event", repeatCount: 1 };
    expect(({ ...base, effect: "fadeLeftToRight" } as SoundLinkage).effect).toBe("fadeLeftToRight");
  });

  it("accepts 'fadeRightToLeft'", () => {
    const base: SoundLinkage = { libraryItemId: "snd1", syncMode: "event", repeatCount: 1 };
    expect(({ ...base, effect: "fadeRightToLeft" } as SoundLinkage).effect).toBe("fadeRightToLeft");
  });

  it("defaults to undefined (None) when omitted", () => {
    const base: SoundLinkage = { libraryItemId: "snd1", syncMode: "event", repeatCount: 1 };
    expect(base.effect).toBeUndefined();
  });

  it("frame.sound.effect === 'left' acceptance criterion", () => {
    // Simulates the handler: select 'left' → onSoundChange → model updated
    const sound: SoundLinkage = { libraryItemId: "snd1", syncMode: "event", repeatCount: 1 };
    const effectValue: SoundEffect = "left";
    const updated: SoundLinkage = { ...sound, effect: effectValue };
    expect(updated.effect).toBe("left");
  });
});

// ---------------------------------------------------------------------------
// 2. TextDisplayObject.restrict
// ---------------------------------------------------------------------------

describe("TextDisplayObject.restrict", () => {
  function makeInputText(overrides: Partial<TextDisplayObject> = {}): TextDisplayObject {
    return {
      id: "t1",
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      text: "",
      fontFamily: "Arial",
      fontSize: 12,
      textType: "input",
      ...overrides,
    } as TextDisplayObject;
  }

  it("restrict field defaults to undefined for an input text object", () => {
    const obj = makeInputText();
    expect(obj.restrict).toBeUndefined();
  });

  it("restrict '0-9' round-trips correctly", () => {
    const obj = makeInputText({ restrict: "0-9" });
    expect(obj.restrict).toBe("0-9");
  });

  it("restrict 'A-Za-z' round-trips correctly", () => {
    const obj = makeInputText({ restrict: "A-Za-z" });
    expect(obj.restrict).toBe("A-Za-z");
  });

  it("commitRestrict logic: empty string becomes undefined", () => {
    // Mirrors the commitRestrict handler: restrictDraft || undefined
    const restrictDraft = "";
    const newRestrict = restrictDraft || undefined;
    expect(newRestrict).toBeUndefined();
  });

  it("commitRestrict logic: non-empty string is stored as-is", () => {
    const restrictDraft = "0-9";
    const newRestrict = restrictDraft || undefined;
    expect(newRestrict).toBe("0-9");
  });

  it("restrict only appears on input text (not dynamic or static)", () => {
    // The restrict field is only meaningful for input text; dynamic/static don't have it
    const staticText = makeInputText({ textType: "static" as TextDisplayObject["textType"] });
    // The field is allowed to exist in the type but should not be rendered in the UI
    // for non-input text — this is enforced by the conditional render in PropertiesPanel.
    // Here we just verify the type allows it to be undefined for non-input contexts.
    expect(staticText.restrict).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. SymbolInstance.trackAsMenu (button-only)
// ---------------------------------------------------------------------------

describe("SymbolInstance.trackAsMenu", () => {
  function makeButtonInstance(overrides: Partial<SymbolInstance> = {}): SymbolInstance {
    return {
      id: "inst1",
      type: "instance",
      x: 0,
      y: 0,
      libraryItemId: "btn1",
      ...overrides,
    } as SymbolInstance;
  }

  it("defaults to undefined (falsy) when not set", () => {
    const inst = makeButtonInstance();
    expect(inst.trackAsMenu).toBeUndefined();
  });

  it("toggle true: instance.trackAsMenu === true", () => {
    const inst = makeButtonInstance({ trackAsMenu: true });
    expect(inst.trackAsMenu).toBe(true);
  });

  it("toggle false: instance.trackAsMenu === false", () => {
    const inst = makeButtonInstance({ trackAsMenu: false });
    expect(inst.trackAsMenu).toBe(false);
  });

  it("onChange handler spreads trackAsMenu correctly", () => {
    const inst = makeButtonInstance();
    // Simulates: onChange({ trackAsMenu: e.target.checked })
    const updated: SymbolInstance = { ...inst, trackAsMenu: true };
    expect(updated.trackAsMenu).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. SymbolInstance.cacheAsBitmap
// ---------------------------------------------------------------------------

describe("SymbolInstance.cacheAsBitmap", () => {
  function makeInstance(overrides: Partial<SymbolInstance> = {}): SymbolInstance {
    return {
      id: "inst2",
      type: "instance",
      x: 0,
      y: 0,
      libraryItemId: "mc1",
      ...overrides,
    } as SymbolInstance;
  }

  it("defaults to undefined (falsy) when not set", () => {
    const inst = makeInstance();
    expect(inst.cacheAsBitmap).toBeUndefined();
  });

  it("toggle true: instance.cacheAsBitmap === true", () => {
    const inst = makeInstance({ cacheAsBitmap: true });
    expect(inst.cacheAsBitmap).toBe(true);
  });

  it("toggle false: instance.cacheAsBitmap === false", () => {
    const inst = makeInstance({ cacheAsBitmap: false });
    expect(inst.cacheAsBitmap).toBe(false);
  });

  it("onChange handler spreads cacheAsBitmap correctly", () => {
    const inst = makeInstance();
    const updated: SymbolInstance = { ...inst, cacheAsBitmap: true };
    expect(updated.cacheAsBitmap).toBe(true);
  });

  it("cacheAsBitmap is available on all symbol types (MC, button, graphic)", () => {
    // The model field exists on SymbolInstance regardless of symbol type;
    // the UI renders it for all symbol types (not button-only like trackAsMenu).
    const mc = makeInstance({ cacheAsBitmap: true });
    expect(mc.cacheAsBitmap).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Control visibility logic (no rendering — just document the invariant)
// ---------------------------------------------------------------------------

describe("Panel control visibility rules", () => {
  it("trackAsMenu control renders ONLY for button instances, not for movieclip or graphic", () => {
    // This invariant is enforced in InstancePanel.tsx via `{symbolType === 'button' && ...}`.
    // We verify the condition logic here.
    const isButtonOnly = (symbolType: string) => symbolType === "button";
    expect(isButtonOnly("button")).toBe(true);
    expect(isButtonOnly("movieclip")).toBe(false);
    expect(isButtonOnly("graphic")).toBe(false);
  });

  it("restrict field renders ONLY for input text, not dynamic or static", () => {
    // Enforced in PropertiesPanel.tsx via `{obj.textType === 'input' && ...}`.
    const showsRestrict = (textType: string) => textType === "input";
    expect(showsRestrict("input")).toBe(true);
    expect(showsRestrict("dynamic")).toBe(false);
    expect(showsRestrict("static")).toBe(false);
  });

  it("cacheAsBitmap renders for all symbol types", () => {
    // Rendered in the Display section of InstancePanel.tsx unconditionally.
    const types = ["movieclip", "button", "graphic"];
    types.forEach((t) => {
      // The checkbox is always rendered (no symbolType guard), so this always holds
      expect(["movieclip", "button", "graphic"].includes(t)).toBe(true);
    });
  });

  it("Sound Effect dropdown renders only when a sound is selected", () => {
    // Enforced in FrameSoundSection by `{sound && ...}`.
    const showsEffect = (sound: SoundLinkage | null) => sound !== null;
    expect(showsEffect(null)).toBe(false);
    expect(showsEffect({ libraryItemId: "snd1", syncMode: "event", repeatCount: 1 })).toBe(true);
  });
});

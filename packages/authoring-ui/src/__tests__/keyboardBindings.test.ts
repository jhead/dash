import { describe, it, expect } from "vitest";
import {
  resolveKeyBinding,
  isTimelineOwnedBinding,
  type KeyChord,
} from "../dispatch/keyboard.js";

const chord = (key: string, mods: Partial<KeyChord> = {}): KeyChord => ({ key, ...mods });

describe("resolveKeyBinding", () => {
  it("maps the core editor shortcuts to command ids", () => {
    expect(resolveKeyBinding(chord("z", { ctrlKey: true }))).toMatchObject({ id: "history.undo" });
    expect(resolveKeyBinding(chord("z", { ctrlKey: true, shiftKey: true }))).toMatchObject({ id: "history.redo" });
    expect(resolveKeyBinding(chord("y", { metaKey: true }))).toMatchObject({ id: "history.redo" });
    expect(resolveKeyBinding(chord("c", { ctrlKey: true }))).toMatchObject({ id: "edit.copy" });
    expect(resolveKeyBinding(chord("v", { ctrlKey: true, shiftKey: true }))).toMatchObject({ id: "edit.pasteInPlace" });
    expect(resolveKeyBinding(chord("a", { ctrlKey: true }))).toMatchObject({ id: "edit.selectAll" });
    expect(resolveKeyBinding(chord("g", { ctrlKey: true }))).toMatchObject({ id: "edit.group" });
    expect(resolveKeyBinding(chord("g", { ctrlKey: true, shiftKey: true }))).toMatchObject({ id: "edit.ungroup" });
    expect(resolveKeyBinding(chord("b", { ctrlKey: true }))).toMatchObject({ id: "edit.breakApart" });
  });

  it("F5/F6/F7 ignore Shift (preserves the old behaviour)", () => {
    expect(resolveKeyBinding(chord("F5"))).toMatchObject({ id: "timeline.insertFrame" });
    expect(resolveKeyBinding(chord("F5", { shiftKey: true }))).toMatchObject({ id: "timeline.insertFrame" });
    expect(resolveKeyBinding(chord("F6"))).toMatchObject({ id: "timeline.insertKeyframe" });
  });

  it("ctrl+shift+B is bold, ctrl+B (no shift) is break-apart", () => {
    expect(resolveKeyBinding(chord("b", { ctrlKey: true, shiftKey: true }))).toMatchObject({ id: "text.bold" });
    expect(resolveKeyBinding(chord("b", { ctrlKey: true }))).toMatchObject({ id: "edit.breakApart" });
  });

  it("Escape and Enter do not preventDefault", () => {
    expect(resolveKeyBinding(chord("Escape"))).toEqual({ type: "command", id: "edit.deselectAll", preventDefault: false });
    expect(resolveKeyBinding(chord("Enter"))).toEqual({ type: "command", id: "playback.toggle", preventDefault: false });
  });

  it("Delete maps to edit.delete and preventDefaults", () => {
    expect(resolveKeyBinding(chord("Delete"))).toEqual({ type: "command", id: "edit.delete", preventDefault: true });
    expect(resolveKeyBinding(chord("Backspace"))).toMatchObject({ id: "edit.delete" });
  });

  it("arrows nudge with Shift = 8px, plain = 1px", () => {
    expect(resolveKeyBinding(chord("ArrowLeft"))).toEqual({ type: "nudge", dx: -1, dy: 0 });
    expect(resolveKeyBinding(chord("ArrowRight", { shiftKey: true }))).toEqual({ type: "nudge", dx: 8, dy: 0 });
    expect(resolveKeyBinding(chord("ArrowUp"))).toEqual({ type: "nudge", dx: 0, dy: -1 });
    expect(resolveKeyBinding(chord("ArrowDown", { shiftKey: true }))).toEqual({ type: "nudge", dx: 0, dy: 8 });
  });

  it("Alt+arrows are text tracking, not nudge", () => {
    expect(resolveKeyBinding(chord("ArrowRight", { altKey: true }))).toMatchObject({ id: "text.trackingIncrease" });
    expect(resolveKeyBinding(chord("ArrowLeft", { altKey: true }))).toMatchObject({ id: "text.trackingDecrease" });
    expect(resolveKeyBinding(chord("ArrowRight", { ctrlKey: true, altKey: true }))).toMatchObject({ id: "text.trackingReset" });
  });

  it("returns null for unmapped chords", () => {
    expect(resolveKeyBinding(chord("q"))).toBeNull();
    expect(resolveKeyBinding(chord("1", { ctrlKey: true }))).toBeNull();
  });
});

describe("isTimelineOwnedBinding (task 1376)", () => {
  const owned = (key: string, mods: Partial<KeyChord> = {}) => {
    const b = resolveKeyBinding(chord(key, mods));
    expect(b).not.toBeNull();
    return isTimelineOwnedBinding(b!);
  };

  it("claims the keys the Timeline panel handler consumes", () => {
    // Insert frame / keyframe / blank keyframe.
    expect(owned("F5")).toBe(true);
    expect(owned("F6")).toBe(true);
    expect(owned("F7")).toBe(true);
    // Play toggle.
    expect(owned("Enter")).toBe(true);
    // Frame clipboard (Timeline's Ctrl+V ignores Shift, so paste-in-place too).
    expect(owned("c", { ctrlKey: true })).toBe(true);
    expect(owned("x", { ctrlKey: true })).toBe(true);
    expect(owned("v", { ctrlKey: true })).toBe(true);
    expect(owned("v", { ctrlKey: true, shiftKey: true })).toBe(true);
    // Remove frame.
    expect(owned("Delete")).toBe(true);
    expect(owned("Backspace")).toBe(true);
    // Arrow scrubbing / nudge.
    expect(owned("ArrowLeft")).toBe(true);
    expect(owned("ArrowRight", { shiftKey: true })).toBe(true);
  });

  it("does NOT claim commands the Timeline leaves to the global dispatcher", () => {
    expect(owned("z", { ctrlKey: true })).toBe(false); // undo
    expect(owned("z", { ctrlKey: true, shiftKey: true })).toBe(false); // redo
    expect(owned("g", { ctrlKey: true })).toBe(false); // group
    expect(owned("d", { ctrlKey: true })).toBe(false); // duplicate
    expect(owned("a", { ctrlKey: true })).toBe(false); // select all
    expect(owned("b", { ctrlKey: true, shiftKey: true })).toBe(false); // bold
  });
});

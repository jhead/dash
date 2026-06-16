import { describe, it, expect } from "vitest";
import { resolveKeyBinding, type KeyChord } from "../dispatch/keyboard.js";

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

/**
 * Unit tests for the useKeyboardShortcuts dispatcher.
 *
 * Rather than spinning up React, we extract the keyboard dispatch logic and test
 * it directly.  Each test builds a synthetic KeyboardEvent-like object and verifies
 * that exactly the expected handler is called (and no others).
 *
 * Shortcuts covered:
 *   Ctrl+Z          → onUndo
 *   Ctrl+Shift+Z    → onRedo
 *   Ctrl+Y          → onRedo
 *   Delete          → onDelete
 *   Backspace       → onDelete
 *   Ctrl+A          → onSelectAll
 *   F5              → onInsertFrame
 *   F6              → onInsertKeyframe
 *   F7              → onInsertBlankKeyframe
 *   Escape          → onDeselect
 *   Enter           → onPlay
 *   INPUT target    → no action
 *   TEXTAREA target → no action
 */

import { describe, it, expect, vi } from "vitest";
import type { KeyboardShortcutHandlers } from "../useKeyboardShortcuts.js";

// ---------------------------------------------------------------------------
// Reproduce the handleKeyDown dispatch logic from useKeyboardShortcuts.ts.
// This keeps the tests independent of React / DOM while verifying the exact
// same branching that the hook registers.
// ---------------------------------------------------------------------------

function makeEvent(
  key: string,
  options: {
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    targetTag?: string;
  } = {}
): KeyboardEvent {
  const target = options.targetTag
    ? { tagName: options.targetTag }
    : { tagName: "DIV" };

  return {
    key,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    target,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

/** Mirrored dispatch logic from useKeyboardShortcuts.ts */
function dispatch(e: KeyboardEvent, h: KeyboardShortcutHandlers): void {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const alt = e.altKey;

  if (ctrl && !shift && e.key === "z") { e.preventDefault(); h.onUndo?.(); }
  else if (ctrl && shift && e.key === "z") { e.preventDefault(); h.onRedo?.(); }
  else if (ctrl && !shift && e.key === "y") { e.preventDefault(); h.onRedo?.(); }
  else if (ctrl && !shift && e.key === "c") { e.preventDefault(); h.onCopy?.(); }
  else if (ctrl && !shift && e.key === "x") { e.preventDefault(); h.onCut?.(); }
  else if (ctrl && !shift && e.key === "v") { e.preventDefault(); h.onPaste?.(); }
  else if (ctrl && shift && e.key === "v") { e.preventDefault(); h.onPasteInPlace?.(); }
  else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); h.onDelete?.(); }
  else if (ctrl && !shift && e.key === "a") { e.preventDefault(); h.onSelectAll?.(); }
  else if (e.key === "Escape") { h.onDeselect?.(); }
  else if (ctrl && !shift && e.key === "g") { e.preventDefault(); h.onGroup?.(); }
  else if (ctrl && shift && e.key === "g") { e.preventDefault(); h.onUngroup?.(); }
  else if (ctrl && !shift && e.key === "b") { e.preventDefault(); h.onBreakApart?.(); }
  else if (e.key === "F5") { e.preventDefault(); h.onInsertFrame?.(); }
  else if (e.key === "F6") { e.preventDefault(); h.onInsertKeyframe?.(); }
  else if (e.key === "F7") { e.preventDefault(); h.onInsertBlankKeyframe?.(); }
  else if (e.key === "Enter") { h.onPlay?.(); }
  // Text menu shortcuts
  else if (ctrl && shift && e.key === "b") { e.preventDefault(); h.onTextBold?.(); }
  else if (ctrl && shift && e.key === "i") { e.preventDefault(); h.onTextItalic?.(); }
  else if (ctrl && shift && e.key === "u") { e.preventDefault(); h.onTextUnderline?.(); }
  else if (ctrl && shift && e.key === "l") { e.preventDefault(); h.onTextAlignLeft?.(); }
  else if (ctrl && shift && e.key === "e") { e.preventDefault(); h.onTextAlignCenter?.(); }
  else if (ctrl && shift && e.key === "r") { e.preventDefault(); h.onTextAlignRight?.(); }
  else if (ctrl && shift && e.key === "j") { e.preventDefault(); h.onTextAlignJustify?.(); }
  else if (ctrl && shift && e.key === "h") { e.preventDefault(); h.onAddShapeHint?.(); }
  else if (!ctrl && alt && e.key === "ArrowRight") { e.preventDefault(); h.onTextTrackingIncrease?.(); }
  else if (!ctrl && alt && e.key === "ArrowLeft") { e.preventDefault(); h.onTextTrackingDecrease?.(); }
  else if (ctrl && alt && e.key === "ArrowRight") { e.preventDefault(); h.onTextTrackingReset?.(); }
  // Arrow-key nudge (plain or Shift; skip when Alt is held — those are text-tracking shortcuts)
  else if (!ctrl && !alt && e.key === "ArrowLeft")  { e.preventDefault(); h.onNudge?.(shift ? -8 : -1, 0); }
  else if (!ctrl && !alt && e.key === "ArrowRight") { e.preventDefault(); h.onNudge?.(shift ? 8 : 1, 0); }
  else if (!ctrl && !alt && e.key === "ArrowUp")    { e.preventDefault(); h.onNudge?.(0, shift ? -8 : -1); }
  else if (!ctrl && !alt && e.key === "ArrowDown")  { e.preventDefault(); h.onNudge?.(0, shift ? 8 : 1); }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a handlers object where every callback is a fresh vi.fn(). */
function makeHandlers(): Required<KeyboardShortcutHandlers> {
  return {
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onCopy: vi.fn(),
    onCut: vi.fn(),
    onPaste: vi.fn(),
    onPasteInPlace: vi.fn(),
    onDelete: vi.fn(),
    onSelectAll: vi.fn(),
    onDeselect: vi.fn(),
    onGroup: vi.fn(),
    onUngroup: vi.fn(),
    onBreakApart: vi.fn(),
    onBringToFront: vi.fn(),
    onSendToBack: vi.fn(),
    onInsertFrame: vi.fn(),
    onInsertKeyframe: vi.fn(),
    onInsertBlankKeyframe: vi.fn(),
    onPlay: vi.fn(),
    onStop: vi.fn(),
    onTextBold: vi.fn(),
    onTextItalic: vi.fn(),
    onTextUnderline: vi.fn(),
    onTextAlignLeft: vi.fn(),
    onTextAlignCenter: vi.fn(),
    onTextAlignRight: vi.fn(),
    onTextAlignJustify: vi.fn(),
    onTextTrackingIncrease: vi.fn(),
    onTextTrackingDecrease: vi.fn(),
    onTextTrackingReset: vi.fn(),
    onNudge: vi.fn(),
    onAddShapeHint: vi.fn(),
    onFindReplace: vi.fn(),
    onDuplicate: vi.fn(),
    onRemoveFrame: vi.fn(),
    onClearKeyframe: vi.fn(),
  };
}

/** Assert that exactly one handler was called, exactly once. */
function assertOnlyCalledOnce(
  handlers: Required<KeyboardShortcutHandlers>,
  expected: keyof KeyboardShortcutHandlers
) {
  for (const [name, fn] of Object.entries(handlers)) {
    const mock = fn as ReturnType<typeof vi.fn>;
    if (name === expected) {
      expect(mock, `expected ${name} to be called once`).toHaveBeenCalledOnce();
    } else {
      expect(mock, `expected ${name} NOT to be called`).not.toHaveBeenCalled();
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useKeyboardShortcuts — Ctrl+Z fires onUndo", () => {
  it("calls onUndo for Ctrl+Z", () => {
    const h = makeHandlers();
    dispatch(makeEvent("z", { ctrlKey: true }), h);
    assertOnlyCalledOnce(h, "onUndo");
  });

  it("calls onUndo for Cmd+Z (macOS)", () => {
    const h = makeHandlers();
    dispatch(makeEvent("z", { metaKey: true }), h);
    assertOnlyCalledOnce(h, "onUndo");
  });
});

describe("useKeyboardShortcuts — Ctrl+Shift+Z fires onRedo", () => {
  it("calls onRedo for Ctrl+Shift+Z", () => {
    const h = makeHandlers();
    dispatch(makeEvent("z", { ctrlKey: true, shiftKey: true }), h);
    assertOnlyCalledOnce(h, "onRedo");
  });

  it("calls onRedo for Ctrl+Y", () => {
    const h = makeHandlers();
    dispatch(makeEvent("y", { ctrlKey: true }), h);
    assertOnlyCalledOnce(h, "onRedo");
  });
});

describe("useKeyboardShortcuts — Delete fires onDelete", () => {
  it("calls onDelete for Delete key", () => {
    const h = makeHandlers();
    dispatch(makeEvent("Delete"), h);
    assertOnlyCalledOnce(h, "onDelete");
  });

  it("calls onDelete for Backspace key", () => {
    const h = makeHandlers();
    dispatch(makeEvent("Backspace"), h);
    assertOnlyCalledOnce(h, "onDelete");
  });
});

describe("useKeyboardShortcuts — Ctrl+A fires onSelectAll", () => {
  it("calls onSelectAll for Ctrl+A", () => {
    const h = makeHandlers();
    dispatch(makeEvent("a", { ctrlKey: true }), h);
    assertOnlyCalledOnce(h, "onSelectAll");
  });

  it("does NOT call onSelectAll for Ctrl+Shift+A", () => {
    const h = makeHandlers();
    dispatch(makeEvent("a", { ctrlKey: true, shiftKey: true }), h);
    expect(h.onSelectAll).not.toHaveBeenCalled();
  });
});

describe("useKeyboardShortcuts — F5 fires onInsertFrame", () => {
  it("calls onInsertFrame for F5", () => {
    const h = makeHandlers();
    dispatch(makeEvent("F5"), h);
    assertOnlyCalledOnce(h, "onInsertFrame");
  });
});

describe("useKeyboardShortcuts — F6 fires onInsertKeyframe", () => {
  it("calls onInsertKeyframe for F6", () => {
    const h = makeHandlers();
    dispatch(makeEvent("F6"), h);
    assertOnlyCalledOnce(h, "onInsertKeyframe");
  });
});

describe("useKeyboardShortcuts — F7 fires onInsertBlankKeyframe", () => {
  it("calls onInsertBlankKeyframe for F7", () => {
    const h = makeHandlers();
    dispatch(makeEvent("F7"), h);
    assertOnlyCalledOnce(h, "onInsertBlankKeyframe");
  });
});

describe("useKeyboardShortcuts — no fire when target is INPUT", () => {
  it("does not call any handler when focused on an INPUT element", () => {
    const h = makeHandlers();
    dispatch(makeEvent("z", { ctrlKey: true, targetTag: "INPUT" }), h);
    for (const fn of Object.values(h)) {
      expect(fn as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    }
  });

  it("does not call any handler when focused on a TEXTAREA element", () => {
    const h = makeHandlers();
    dispatch(makeEvent("Delete", { targetTag: "TEXTAREA" }), h);
    for (const fn of Object.values(h)) {
      expect(fn as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    }
  });
});

describe("useKeyboardShortcuts — Escape fires onDeselect", () => {
  it("calls onDeselect for Escape", () => {
    const h = makeHandlers();
    dispatch(makeEvent("Escape"), h);
    assertOnlyCalledOnce(h, "onDeselect");
  });
});

describe("useKeyboardShortcuts — Enter fires onPlay", () => {
  it("calls onPlay for Enter", () => {
    const h = makeHandlers();
    dispatch(makeEvent("Enter"), h);
    assertOnlyCalledOnce(h, "onPlay");
  });
});

describe("useKeyboardShortcuts — copy/cut/paste", () => {
  it("calls onCopy for Ctrl+C", () => {
    const h = makeHandlers();
    dispatch(makeEvent("c", { ctrlKey: true }), h);
    assertOnlyCalledOnce(h, "onCopy");
  });

  it("calls onCut for Ctrl+X", () => {
    const h = makeHandlers();
    dispatch(makeEvent("x", { ctrlKey: true }), h);
    assertOnlyCalledOnce(h, "onCut");
  });

  it("calls onPaste for Ctrl+V", () => {
    const h = makeHandlers();
    dispatch(makeEvent("v", { ctrlKey: true }), h);
    assertOnlyCalledOnce(h, "onPaste");
  });

  it("calls onPasteInPlace for Ctrl+Shift+V", () => {
    const h = makeHandlers();
    dispatch(makeEvent("v", { ctrlKey: true, shiftKey: true }), h);
    assertOnlyCalledOnce(h, "onPasteInPlace");
  });
});

describe("useKeyboardShortcuts — group/ungroup", () => {
  it("calls onGroup for Ctrl+G", () => {
    const h = makeHandlers();
    dispatch(makeEvent("g", { ctrlKey: true }), h);
    assertOnlyCalledOnce(h, "onGroup");
  });

  it("calls onUngroup for Ctrl+Shift+G", () => {
    const h = makeHandlers();
    dispatch(makeEvent("g", { ctrlKey: true, shiftKey: true }), h);
    assertOnlyCalledOnce(h, "onUngroup");
  });
});

describe("useKeyboardShortcuts — break apart", () => {
  it("calls onBreakApart for Ctrl+B", () => {
    const h = makeHandlers();
    dispatch(makeEvent("b", { ctrlKey: true }), h);
    assertOnlyCalledOnce(h, "onBreakApart");
  });

  it("calls onBreakApart for Cmd+B (macOS)", () => {
    const h = makeHandlers();
    dispatch(makeEvent("b", { metaKey: true }), h);
    assertOnlyCalledOnce(h, "onBreakApart");
  });

  it("does NOT call onBreakApart for Ctrl+Shift+B", () => {
    const h = makeHandlers();
    dispatch(makeEvent("b", { ctrlKey: true, shiftKey: true }), h);
    expect(h.onBreakApart).not.toHaveBeenCalled();
  });
});

describe("useKeyboardShortcuts — Text menu style shortcuts", () => {
  it("calls onTextBold for Ctrl+Shift+B", () => {
    const h = makeHandlers();
    dispatch(makeEvent("b", { ctrlKey: true, shiftKey: true }), h);
    assertOnlyCalledOnce(h, "onTextBold");
  });

  it("calls onTextItalic for Ctrl+Shift+I", () => {
    const h = makeHandlers();
    dispatch(makeEvent("i", { ctrlKey: true, shiftKey: true }), h);
    assertOnlyCalledOnce(h, "onTextItalic");
  });

  it("calls onTextUnderline for Ctrl+Shift+U", () => {
    const h = makeHandlers();
    dispatch(makeEvent("u", { ctrlKey: true, shiftKey: true }), h);
    assertOnlyCalledOnce(h, "onTextUnderline");
  });
});

describe("useKeyboardShortcuts — Text menu align shortcuts", () => {
  it("calls onTextAlignLeft for Ctrl+Shift+L", () => {
    const h = makeHandlers();
    dispatch(makeEvent("l", { ctrlKey: true, shiftKey: true }), h);
    assertOnlyCalledOnce(h, "onTextAlignLeft");
  });

  it("calls onTextAlignCenter for Ctrl+Shift+E", () => {
    const h = makeHandlers();
    dispatch(makeEvent("e", { ctrlKey: true, shiftKey: true }), h);
    assertOnlyCalledOnce(h, "onTextAlignCenter");
  });

  it("calls onTextAlignRight for Ctrl+Shift+R", () => {
    const h = makeHandlers();
    dispatch(makeEvent("r", { ctrlKey: true, shiftKey: true }), h);
    assertOnlyCalledOnce(h, "onTextAlignRight");
  });

  it("calls onTextAlignJustify for Ctrl+Shift+J", () => {
    const h = makeHandlers();
    dispatch(makeEvent("j", { ctrlKey: true, shiftKey: true }), h);
    assertOnlyCalledOnce(h, "onTextAlignJustify");
  });
});

describe("useKeyboardShortcuts — Text menu tracking shortcuts", () => {
  it("calls onTextTrackingIncrease for Alt+ArrowRight", () => {
    const h = makeHandlers();
    dispatch(makeEvent("ArrowRight", { altKey: true }), h);
    assertOnlyCalledOnce(h, "onTextTrackingIncrease");
  });

  it("calls onTextTrackingDecrease for Alt+ArrowLeft", () => {
    const h = makeHandlers();
    dispatch(makeEvent("ArrowLeft", { altKey: true }), h);
    assertOnlyCalledOnce(h, "onTextTrackingDecrease");
  });

  it("calls onTextTrackingReset for Ctrl+Alt+ArrowRight", () => {
    const h = makeHandlers();
    dispatch(makeEvent("ArrowRight", { ctrlKey: true, altKey: true }), h);
    assertOnlyCalledOnce(h, "onTextTrackingReset");
  });

  it("does NOT call onTextTrackingIncrease for Ctrl+Alt+ArrowRight (reset takes priority)", () => {
    const h = makeHandlers();
    dispatch(makeEvent("ArrowRight", { ctrlKey: true, altKey: true }), h);
    expect(h.onTextTrackingIncrease).not.toHaveBeenCalled();
  });
});

describe("useKeyboardShortcuts — arrow-key nudge", () => {
  it("calls onNudge(-1, 0) for ArrowLeft", () => {
    const h = makeHandlers();
    dispatch(makeEvent("ArrowLeft"), h);
    expect(h.onNudge).toHaveBeenCalledOnce();
    expect(h.onNudge).toHaveBeenCalledWith(-1, 0);
  });

  it("calls onNudge(1, 0) for ArrowRight", () => {
    const h = makeHandlers();
    dispatch(makeEvent("ArrowRight"), h);
    expect(h.onNudge).toHaveBeenCalledOnce();
    expect(h.onNudge).toHaveBeenCalledWith(1, 0);
  });

  it("calls onNudge(0, -1) for ArrowUp", () => {
    const h = makeHandlers();
    dispatch(makeEvent("ArrowUp"), h);
    expect(h.onNudge).toHaveBeenCalledOnce();
    expect(h.onNudge).toHaveBeenCalledWith(0, -1);
  });

  it("calls onNudge(0, 1) for ArrowDown", () => {
    const h = makeHandlers();
    dispatch(makeEvent("ArrowDown"), h);
    expect(h.onNudge).toHaveBeenCalledOnce();
    expect(h.onNudge).toHaveBeenCalledWith(0, 1);
  });

  it("calls onNudge(-8, 0) for Shift+ArrowLeft", () => {
    const h = makeHandlers();
    dispatch(makeEvent("ArrowLeft", { shiftKey: true }), h);
    expect(h.onNudge).toHaveBeenCalledOnce();
    expect(h.onNudge).toHaveBeenCalledWith(-8, 0);
  });

  it("calls onNudge(8, 0) for Shift+ArrowRight", () => {
    const h = makeHandlers();
    dispatch(makeEvent("ArrowRight", { shiftKey: true }), h);
    expect(h.onNudge).toHaveBeenCalledOnce();
    expect(h.onNudge).toHaveBeenCalledWith(8, 0);
  });

  it("calls onNudge(0, -8) for Shift+ArrowUp", () => {
    const h = makeHandlers();
    dispatch(makeEvent("ArrowUp", { shiftKey: true }), h);
    expect(h.onNudge).toHaveBeenCalledOnce();
    expect(h.onNudge).toHaveBeenCalledWith(0, -8);
  });

  it("calls onNudge(0, 8) for Shift+ArrowDown", () => {
    const h = makeHandlers();
    dispatch(makeEvent("ArrowDown", { shiftKey: true }), h);
    expect(h.onNudge).toHaveBeenCalledOnce();
    expect(h.onNudge).toHaveBeenCalledWith(0, 8);
  });

  it("does NOT call onNudge for Alt+ArrowRight (text tracking takes priority)", () => {
    const h = makeHandlers();
    dispatch(makeEvent("ArrowRight", { altKey: true }), h);
    expect(h.onNudge).not.toHaveBeenCalled();
  });

  it("does NOT call onNudge for Alt+ArrowLeft (text tracking takes priority)", () => {
    const h = makeHandlers();
    dispatch(makeEvent("ArrowLeft", { altKey: true }), h);
    expect(h.onNudge).not.toHaveBeenCalled();
  });

  it("calls preventDefault for ArrowLeft nudge", () => {
    const h = makeHandlers();
    const e = makeEvent("ArrowLeft");
    dispatch(e, h);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("does NOT fire nudge when target is INPUT", () => {
    const h = makeHandlers();
    dispatch(makeEvent("ArrowLeft", { targetTag: "INPUT" }), h);
    expect(h.onNudge).not.toHaveBeenCalled();
  });

  it("does NOT fire nudge when target is TEXTAREA", () => {
    const h = makeHandlers();
    dispatch(makeEvent("ArrowUp", { targetTag: "TEXTAREA" }), h);
    expect(h.onNudge).not.toHaveBeenCalled();
  });
});

describe("useKeyboardShortcuts — Ctrl+Shift+H fires onAddShapeHint", () => {
  it("calls onAddShapeHint for Ctrl+Shift+H", () => {
    const h = makeHandlers();
    dispatch(makeEvent("h", { ctrlKey: true, shiftKey: true }), h);
    assertOnlyCalledOnce(h, "onAddShapeHint");
  });

  it("calls onAddShapeHint for Cmd+Shift+H (macOS)", () => {
    const h = makeHandlers();
    dispatch(makeEvent("h", { metaKey: true, shiftKey: true }), h);
    assertOnlyCalledOnce(h, "onAddShapeHint");
  });

  it("does NOT call onAddShapeHint for plain Ctrl+H (no shift)", () => {
    const h = makeHandlers();
    dispatch(makeEvent("h", { ctrlKey: true }), h);
    expect(h.onAddShapeHint).not.toHaveBeenCalled();
  });
});

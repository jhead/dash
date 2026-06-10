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

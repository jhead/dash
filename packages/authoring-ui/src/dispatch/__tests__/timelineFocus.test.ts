import { describe, it, expect, afterEach } from "vitest";
import { isTimelinePanelFocused, TIMELINE_PANEL_ATTR } from "../timelineFocus.js";

/**
 * Minimal fake Element supporting `closest(selector)` for the
 * `[data-timeline-panel]` selector. The test env is `node` (no DOM), so the
 * production `document.activeElement` / `closest` path is exercised via
 * hand-rolled stand-ins (mirrors playerFocus.test.ts).
 */
class FakeEl {
  parent: FakeEl | null = null;
  private attrs: Record<string, string> = {};
  constructor(attrs: Record<string, string> = {}) {
    this.attrs = attrs;
  }
  setParent(p: FakeEl | null): this {
    this.parent = p;
    return this;
  }
  closest(selector: string): FakeEl | null {
    const wantAttr = selector.replace(/^\[/, "").replace(/\]$/, "");
    let cur: FakeEl | null = this;
    while (cur) {
      if (wantAttr in cur.attrs) return cur;
      cur = cur.parent;
    }
    return null;
  }
}

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  if ("document" in g) delete g.document;
});

describe("isTimelinePanelFocused", () => {
  it("returns true when the focused element IS the timeline panel", () => {
    const panel = new FakeEl({ [TIMELINE_PANEL_ATTR]: "true" });
    g.document = { activeElement: panel };
    expect(isTimelinePanelFocused()).toBe(true);
  });

  it("returns true when focus is NESTED inside the timeline panel", () => {
    const panel = new FakeEl({ [TIMELINE_PANEL_ATTR]: "true" });
    const inner = new FakeEl().setParent(panel);
    const deepest = new FakeEl().setParent(inner);
    g.document = { activeElement: deepest };
    expect(isTimelinePanelFocused()).toBe(true);
  });

  it("returns false when focus is on the stage / another panel", () => {
    const stage = new FakeEl({ "data-testid": "stage-canvas" });
    g.document = { activeElement: new FakeEl().setParent(stage) };
    expect(isTimelinePanelFocused()).toBe(false);
  });

  it("returns false when nothing is focused (activeElement null)", () => {
    g.document = { activeElement: null };
    expect(isTimelinePanelFocused()).toBe(false);
  });

  it("returns false when there is no document (node/headless)", () => {
    // No `g.document` installed.
    expect(isTimelinePanelFocused()).toBe(false);
  });
});

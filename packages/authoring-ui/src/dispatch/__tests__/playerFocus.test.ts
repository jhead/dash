import { describe, it, expect, afterEach } from "vitest";
import { isWithinRufflePlayer, RUFFLE_HOST_ATTR } from "../playerFocus.js";

/**
 * Minimal fake Element supporting `closest(selector)` for the `[data-ruffle-host]`
 * selector. The test env is `node` (no DOM), so the real `closest`/`document`
 * paths are exercised via hand-rolled stand-ins. This mirrors the production
 * containment check without pulling in jsdom.
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
  // Walks up the parent chain; matches only the data-ruffle-host attribute selector.
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
  // Clean up any document shim a test installed.
  if ("document" in g) delete g.document;
});

describe("isWithinRufflePlayer", () => {
  it("returns true when the event target IS the ruffle host", () => {
    const host = new FakeEl({ [RUFFLE_HOST_ATTR]: "true" });
    expect(isWithinRufflePlayer({ target: host as unknown as EventTarget })).toBe(true);
  });

  it("returns true when the event target is NESTED inside a ruffle host", () => {
    const host = new FakeEl({ [RUFFLE_HOST_ATTR]: "true" });
    const inner = new FakeEl().setParent(host);
    const deepest = new FakeEl().setParent(inner);
    expect(isWithinRufflePlayer({ target: deepest as unknown as EventTarget })).toBe(true);
  });

  it("returns false for a target outside any ruffle host (e.g. the stage canvas)", () => {
    const stage = new FakeEl({ "data-testid": "stage-canvas" });
    const child = new FakeEl().setParent(stage);
    expect(isWithinRufflePlayer({ target: child as unknown as EventTarget })).toBe(false);
  });

  it("returns false for a null/window target with no focused player", () => {
    expect(isWithinRufflePlayer({ target: null })).toBe(false);
    expect(isWithinRufflePlayer({})).toBe(false);
  });

  it("falls back to document.activeElement when target is not an Element (Ruffle listens on window)", () => {
    const host = new FakeEl({ [RUFFLE_HOST_ATTR]: "true" });
    const focused = new FakeEl().setParent(host);
    // Simulate a key event whose target is `window` (no closest), but focus is
    // genuinely inside the player.
    g.document = { activeElement: focused };
    expect(isWithinRufflePlayer({ target: null })).toBe(true);
  });

  it("does NOT fall back to a focused element outside the player", () => {
    const outside = new FakeEl({ "data-testid": "properties-panel" });
    g.document = { activeElement: outside };
    expect(isWithinRufflePlayer({ target: null })).toBe(false);
  });
});

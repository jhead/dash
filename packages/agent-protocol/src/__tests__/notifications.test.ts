/**
 * Unit tests for BridgeNotification schemas (task 0617).
 *
 * Verifies that the doc-changed, selection-changed, and playhead-moved
 * notification schemas parse correctly and reject invalid payloads.
 */

import { describe, it, expect } from "vitest";
import {
  BridgeDocChangedSchema,
  BridgeSelectionChangedSchema,
  BridgePlayheadMovedSchema,
  BridgeNotificationSchema,
} from "../index.js";

describe("BridgeDocChangedSchema", () => {
  it("parses a valid doc-changed notification", () => {
    const n = BridgeDocChangedSchema.parse({ type: "doc-changed", rev: 3 });
    expect(n.type).toBe("doc-changed");
    expect(n.rev).toBe(3);
  });

  it("accepts rev=0", () => {
    const n = BridgeDocChangedSchema.parse({ type: "doc-changed", rev: 0 });
    expect(n.rev).toBe(0);
  });

  it("rejects negative rev", () => {
    expect(() =>
      BridgeDocChangedSchema.parse({ type: "doc-changed", rev: -1 })
    ).toThrow();
  });

  it("rejects wrong type", () => {
    expect(() =>
      BridgeDocChangedSchema.parse({ type: "selection-changed", rev: 1 })
    ).toThrow();
  });

  it("rejects missing rev", () => {
    expect(() =>
      BridgeDocChangedSchema.parse({ type: "doc-changed" })
    ).toThrow();
  });
});

describe("BridgeSelectionChangedSchema", () => {
  it("parses a valid selection-changed notification", () => {
    const n = BridgeSelectionChangedSchema.parse({
      type: "selection-changed",
      ids: ["obj-1", "obj-2"],
      rev: 5,
    });
    expect(n.type).toBe("selection-changed");
    expect(n.ids).toEqual(["obj-1", "obj-2"]);
  });

  it("parses empty selection", () => {
    const n = BridgeSelectionChangedSchema.parse({
      type: "selection-changed",
      ids: [],
      rev: 0,
    });
    expect(n.ids).toHaveLength(0);
  });

  it("rejects missing ids", () => {
    expect(() =>
      BridgeSelectionChangedSchema.parse({ type: "selection-changed", rev: 1 })
    ).toThrow();
  });
});

describe("BridgePlayheadMovedSchema", () => {
  it("parses a valid playhead-moved notification", () => {
    const n = BridgePlayheadMovedSchema.parse({
      type: "playhead-moved",
      frameIndex: 12,
      rev: 0,
    });
    expect(n.type).toBe("playhead-moved");
    expect(n.frameIndex).toBe(12);
  });

  it("rejects negative frameIndex", () => {
    expect(() =>
      BridgePlayheadMovedSchema.parse({
        type: "playhead-moved",
        frameIndex: -1,
        rev: 0,
      })
    ).toThrow();
  });

  it("rejects fractional frameIndex", () => {
    expect(() =>
      BridgePlayheadMovedSchema.parse({
        type: "playhead-moved",
        frameIndex: 1.5,
        rev: 0,
      })
    ).toThrow();
  });
});

describe("BridgeNotificationSchema (discriminated union)", () => {
  it("discriminates doc-changed", () => {
    const n = BridgeNotificationSchema.parse({ type: "doc-changed", rev: 1 });
    expect(n.type).toBe("doc-changed");
  });

  it("discriminates selection-changed", () => {
    const n = BridgeNotificationSchema.parse({
      type: "selection-changed",
      ids: [],
      rev: 2,
    });
    expect(n.type).toBe("selection-changed");
  });

  it("discriminates playhead-moved", () => {
    const n = BridgeNotificationSchema.parse({
      type: "playhead-moved",
      frameIndex: 0,
      rev: 0,
    });
    expect(n.type).toBe("playhead-moved");
  });

  it("rejects unknown notification type", () => {
    expect(() =>
      BridgeNotificationSchema.parse({ type: "unknown-event", rev: 0 })
    ).toThrow();
  });
});

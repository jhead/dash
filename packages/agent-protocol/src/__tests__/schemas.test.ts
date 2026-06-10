/**
 * Unit tests for @flash/agent-protocol Zod schemas.
 *
 * Verifies that valid inputs parse and invalid inputs fail.
 */

import { describe, it, expect } from "vitest";
import {
  EditorStatusResultSchema,
  DocGetParamsSchema,
  DocGetResultSchema,
  DocSummaryResultSchema,
  BridgeRequestSchema,
  BridgeResponseSchema,
  SceneAddParamsSchema,
  SceneAddResultSchema,
  SceneRemoveParamsSchema,
  SceneRenameParamsSchema,
  SceneSelectParamsSchema,
} from "../index.js";

describe("EditorStatusResultSchema", () => {
  it("parses a valid editor_status result", () => {
    const valid = {
      alive: true,
      version: "8.0.0",
      docId: "doc-1",
      docName: "550x400",
      width: 550,
      height: 400,
      frameRate: 12,
      backgroundColor: "#ffffff",
      frameCount: 1,
      layerCount: 1,
      sceneCount: 1,
      currentFrame: 0,
      activeTool: "selection",
      editContext: { mode: "document" as const },
      rev: 0,
    };
    const result = EditorStatusResultSchema.parse(valid);
    expect(result.alive).toBe(true);
    expect(result.rev).toBe(0);
  });

  it("rejects missing required fields", () => {
    expect(() =>
      EditorStatusResultSchema.parse({ alive: true })
    ).toThrow();
  });

  it("accepts optional activeLayerId", () => {
    const withLayer = {
      alive: true,
      version: "8.0.0",
      docId: "doc-1",
      docName: "550x400",
      width: 550,
      height: 400,
      frameRate: 12,
      backgroundColor: "#ffffff",
      frameCount: 1,
      layerCount: 1,
      sceneCount: 1,
      currentFrame: 0,
      activeLayerId: "layer-1",
      activeTool: "selection",
      editContext: { mode: "document" as const },
      rev: 5,
    };
    const result = EditorStatusResultSchema.parse(withLayer);
    expect(result.activeLayerId).toBe("layer-1");
    expect(result.rev).toBe(5);
  });
});

describe("DocGetParamsSchema", () => {
  it("parses empty params", () => {
    const result = DocGetParamsSchema.parse({});
    expect(result.path).toBeUndefined();
  });

  it("parses with path", () => {
    const result = DocGetParamsSchema.parse({ path: "/scenes/0" });
    expect(result.path).toBe("/scenes/0");
  });
});

describe("DocGetResultSchema", () => {
  it("parses a doc_get result with value", () => {
    const result = DocGetResultSchema.parse({
      path: "/scenes/0",
      value: { name: "Scene 1" },
      rev: 3,
    });
    expect(result.path).toBe("/scenes/0");
    expect(result.rev).toBe(3);
  });
});

describe("DocSummaryResultSchema", () => {
  it("parses a minimal doc_summary result", () => {
    const valid = {
      docId: "doc-1",
      docName: "550x400",
      width: 550,
      height: 400,
      frameRate: 12,
      backgroundColor: "#ffffff",
      sceneCount: 1,
      scenes: [
        {
          index: 0,
          name: "Scene 1",
          layerCount: 1,
          frameCount: 1,
          layers: [
            {
              id: "layer-1",
              name: "Layer 1",
              type: "normal",
              frameCount: 1,
              visible: true,
              locked: false,
              keyframes: [
                {
                  index: 0,
                  objectCount: 0,
                  hasScript: false,
                  tween: null,
                },
              ],
            },
          ],
        },
      ],
      libraryItemCount: 0,
      library: [],
      rev: 0,
    };
    const result = DocSummaryResultSchema.parse(valid);
    expect(result.sceneCount).toBe(1);
    expect(result.scenes[0].layers[0].id).toBe("layer-1");
  });
});

describe("BridgeRequestSchema", () => {
  it("parses a valid bridge request", () => {
    const req = BridgeRequestSchema.parse({
      id: "req-001",
      command: "editor_status",
    });
    expect(req.command).toBe("editor_status");
  });

  it("parses doc_get with params", () => {
    const req = BridgeRequestSchema.parse({
      id: "req-002",
      command: "doc_get",
      params: { path: "/scenes/0" },
    });
    expect(req.params?.["path"]).toBe("/scenes/0");
  });

  it("rejects unknown commands", () => {
    expect(() =>
      BridgeRequestSchema.parse({ id: "x", command: "unknown_command" })
    ).toThrow();
  });
});

describe("BridgeResponseSchema", () => {
  it("parses a success response", () => {
    const resp = BridgeResponseSchema.parse({
      ok: true,
      id: "req-001",
      result: { alive: true },
    });
    expect(resp.ok).toBe(true);
  });

  it("parses an error response", () => {
    const resp = BridgeResponseSchema.parse({
      ok: false,
      id: "req-002",
      error: "editor not connected",
    });
    expect(resp.ok).toBe(false);
    if (!resp.ok) {
      expect(resp.error).toContain("not connected");
    }
  });
});

// ---------------------------------------------------------------------------
// Scene command schemas
// ---------------------------------------------------------------------------

describe("SceneAddParamsSchema", () => {
  it("accepts an empty object (no name)", () => {
    const result = SceneAddParamsSchema.parse({});
    expect(result.name).toBeUndefined();
  });

  it("accepts a name string", () => {
    const result = SceneAddParamsSchema.parse({ name: "Level 1" });
    expect(result.name).toBe("Level 1");
  });

  it("rejects unknown extra fields via strict mode? (not strict, should pass through)", () => {
    // SceneAddParamsSchema is not strict, so extra fields are stripped
    const result = SceneAddParamsSchema.parse({ name: "X", extra: true });
    expect(result.name).toBe("X");
  });
});

describe("SceneAddResultSchema", () => {
  it("parses a valid scene_add result", () => {
    const result = SceneAddResultSchema.parse({
      sceneIndex: 1,
      sceneName: "Scene 2",
      rev: 5,
    });
    expect(result.sceneIndex).toBe(1);
    expect(result.sceneName).toBe("Scene 2");
    expect(result.rev).toBe(5);
  });

  it("rejects negative sceneIndex", () => {
    expect(() =>
      SceneAddResultSchema.parse({ sceneIndex: -1, sceneName: "X", rev: 0 })
    ).toThrow();
  });
});

describe("SceneRemoveParamsSchema", () => {
  it("accepts a valid index", () => {
    const result = SceneRemoveParamsSchema.parse({ index: 2 });
    expect(result.index).toBe(2);
  });

  it("rejects missing index", () => {
    expect(() => SceneRemoveParamsSchema.parse({})).toThrow();
  });

  it("rejects negative index", () => {
    expect(() => SceneRemoveParamsSchema.parse({ index: -1 })).toThrow();
  });
});

describe("SceneRenameParamsSchema", () => {
  it("accepts valid index + name", () => {
    const result = SceneRenameParamsSchema.parse({ index: 0, name: "Intro" });
    expect(result.index).toBe(0);
    expect(result.name).toBe("Intro");
  });

  it("rejects missing name", () => {
    expect(() => SceneRenameParamsSchema.parse({ index: 0 })).toThrow();
  });

  it("rejects missing index", () => {
    expect(() => SceneRenameParamsSchema.parse({ name: "Intro" })).toThrow();
  });
});

describe("SceneSelectParamsSchema", () => {
  it("accepts a valid index", () => {
    const result = SceneSelectParamsSchema.parse({ index: 0 });
    expect(result.index).toBe(0);
  });

  it("rejects missing index", () => {
    expect(() => SceneSelectParamsSchema.parse({})).toThrow();
  });

  it("rejects negative index", () => {
    expect(() => SceneSelectParamsSchema.parse({ index: -1 })).toThrow();
  });
});

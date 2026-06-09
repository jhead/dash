/**
 * Unit tests for the full @flash/agent-protocol Zod schema set (task 0614).
 *
 * Covers all new schemas added in the full MCP tool surface expansion.
 */

import { describe, it, expect } from "vitest";
import {
  // Document
  DocLoadParamsSchema,
  DocSetPropertiesParamsSchema,
  OkRevResultSchema,
  HistoryDepthResultSchema,
  // Stage
  StageAddShapeParamsSchema,
  StageAddTextParamsSchema,
  StagePlaceInstanceParamsSchema,
  StageUpdateParamsSchema,
  StageRemoveParamsSchema,
  StageArrangeParamsSchema,
  StageGroupParamsSchema,
  StageUngroupParamsSchema,
  SelectionGetResultSchema,
  SelectionSetParamsSchema,
  ViewSetParamsSchema,
  ToolSelectParamsSchema,
  // Timeline
  TimelineAddLayerParamsSchema,
  TimelineAddLayerResultSchema,
  TimelineRemoveLayerParamsSchema,
  TimelineUpdateLayerParamsSchema,
  TimelineFrameParamsSchema,
  TimelineSetFrameLabelParamsSchema,
  TimelineSetTweenParamsSchema,
  TimelineGotoFrameParamsSchema,
  // Code
  DiagnosticSchema,
  ScriptGetParamsSchema,
  ScriptSetParamsSchema,
  ScriptSetResultSchema,
  ScriptCheckParamsSchema,
  ScriptListResultSchema,
  // Library
  LibraryListResultSchema,
  LibraryCreateSymbolParamsSchema,
  LibraryCreateSymbolResultSchema,
  LibraryConvertToSymbolParamsSchema,
  LibraryRenameParamsSchema,
  LibraryRemoveParamsSchema,
  // Output
  JsflRunParamsSchema,
  JsflRunResultSchema,
  StageScreenshotParamsSchema,
  PublishSwfParamsSchema,
  PublishSwfResultSchema,
  FileSaveFlaParamsSchema,
  FileSaveFlaResultSchema,
  FileLoadFlaParamsSchema,
  // Bridge
  BridgeRequestSchema,
  ALL_COMMANDS,
} from "../index.js";

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

describe("DocLoadParamsSchema", () => {
  it("accepts any document payload", () => {
    const result = DocLoadParamsSchema.parse({ document: { id: "doc-1" } });
    expect(result.document).toEqual({ id: "doc-1" });
  });
});

describe("DocSetPropertiesParamsSchema", () => {
  it("accepts partial properties", () => {
    const result = DocSetPropertiesParamsSchema.parse({ width: 800, height: 600 });
    expect(result.width).toBe(800);
    expect(result.frameRate).toBeUndefined();
  });

  it("accepts only backgroundColor", () => {
    const result = DocSetPropertiesParamsSchema.parse({ backgroundColor: "#ff0000" });
    expect(result.backgroundColor).toBe("#ff0000");
  });

  it("accepts empty object (all optional)", () => {
    const result = DocSetPropertiesParamsSchema.parse({});
    expect(result.width).toBeUndefined();
  });
});

describe("OkRevResultSchema", () => {
  it("parses valid result", () => {
    const result = OkRevResultSchema.parse({ ok: true, rev: 5 });
    expect(result.ok).toBe(true);
    expect(result.rev).toBe(5);
  });

  it("rejects false ok", () => {
    expect(() => OkRevResultSchema.parse({ ok: false, rev: 0 })).toThrow();
  });
});

describe("HistoryDepthResultSchema", () => {
  it("parses undo/redo counts", () => {
    const result = HistoryDepthResultSchema.parse({ undo: 3, redo: 1 });
    expect(result.undo).toBe(3);
    expect(result.redo).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

describe("StageAddShapeParamsSchema", () => {
  it("accepts rect params", () => {
    const result = StageAddShapeParamsSchema.parse({
      kind: "rect",
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 50,
      fill: "#ff0000",
    });
    expect(result.kind).toBe("rect");
    expect(result.fill).toBe("#ff0000");
    expect(result.layerId).toBeUndefined();
  });

  it("accepts oval with stroke", () => {
    const result = StageAddShapeParamsSchema.parse({
      kind: "oval",
      x1: 10,
      y1: 10,
      x2: 110,
      y2: 110,
      stroke: "#000000",
      strokeWidth: 2,
    });
    expect(result.kind).toBe("oval");
    expect(result.strokeWidth).toBe(2);
  });

  it("accepts line with layerId and frameIndex", () => {
    const result = StageAddShapeParamsSchema.parse({
      kind: "line",
      x1: 0,
      y1: 0,
      x2: 200,
      y2: 100,
      layerId: "layer-1",
      frameIndex: 3,
    });
    expect(result.frameIndex).toBe(3);
  });

  it("rejects invalid kind", () => {
    expect(() =>
      StageAddShapeParamsSchema.parse({ kind: "triangle", x1: 0, y1: 0, x2: 10, y2: 10 })
    ).toThrow();
  });
});

describe("StageAddTextParamsSchema", () => {
  it("parses minimal text params", () => {
    const result = StageAddTextParamsSchema.parse({
      x: 10,
      y: 20,
      width: 200,
      height: 30,
      text: "Hello",
    });
    expect(result.text).toBe("Hello");
    expect(result.fontFamily).toBeUndefined();
  });

  it("parses full text params", () => {
    const result = StageAddTextParamsSchema.parse({
      x: 10,
      y: 20,
      width: 200,
      height: 30,
      text: "Hello",
      textType: "dynamic",
      fontFamily: "Arial",
      fontSize: 14,
      color: "#000000",
      bold: true,
      italic: false,
      align: "center",
    });
    expect(result.textType).toBe("dynamic");
    expect(result.bold).toBe(true);
  });
});

describe("StagePlaceInstanceParamsSchema", () => {
  it("parses required fields", () => {
    const result = StagePlaceInstanceParamsSchema.parse({
      symbolId: "sym-1",
      x: 50,
      y: 100,
    });
    expect(result.symbolId).toBe("sym-1");
  });
});

describe("StageUpdateParamsSchema", () => {
  it("parses update params", () => {
    const result = StageUpdateParamsSchema.parse({
      id: "obj-1",
      updates: { x: 100, y: 200 },
    });
    expect(result.id).toBe("obj-1");
    expect((result.updates as Record<string, unknown>).x).toBe(100);
  });
});

describe("StageRemoveParamsSchema", () => {
  it("parses remove params with ids", () => {
    const result = StageRemoveParamsSchema.parse({ ids: ["obj-1", "obj-2"] });
    expect(result.ids).toHaveLength(2);
  });
});

describe("StageArrangeParamsSchema", () => {
  it("accepts all ops", () => {
    for (const op of ["front", "back", "forward", "backward"] as const) {
      const result = StageArrangeParamsSchema.parse({ ids: ["obj-1"], op });
      expect(result.op).toBe(op);
    }
  });
});

describe("StageGroupParamsSchema / StageUngroupParamsSchema", () => {
  it("parses group params", () => {
    const result = StageGroupParamsSchema.parse({ ids: ["obj-1", "obj-2"] });
    expect(result.ids).toHaveLength(2);
  });

  it("parses ungroup params", () => {
    const result = StageUngroupParamsSchema.parse({ id: "group-1" });
    expect(result.id).toBe("group-1");
  });
});

describe("SelectionGetResultSchema", () => {
  it("parses selection result", () => {
    const result = SelectionGetResultSchema.parse({
      ids: ["obj-1"],
      objects: [{ type: "shape", id: "obj-1" }],
    });
    expect(result.ids).toContain("obj-1");
  });
});

describe("SelectionSetParamsSchema", () => {
  it("parses ids selection", () => {
    const result = SelectionSetParamsSchema.parse({ ids: ["obj-1"] });
    expect(result.ids).toContain("obj-1");
  });

  it("parses all:true", () => {
    const result = SelectionSetParamsSchema.parse({ all: true });
    expect(result.all).toBe(true);
  });
});

describe("ViewSetParamsSchema", () => {
  it("accepts partial view params", () => {
    const result = ViewSetParamsSchema.parse({ zoom: 2.0, currentFrame: 5 });
    expect(result.zoom).toBe(2.0);
    expect(result.currentFrame).toBe(5);
  });
});

describe("ToolSelectParamsSchema", () => {
  it("parses toolId", () => {
    const result = ToolSelectParamsSchema.parse({ toolId: "pen" });
    expect(result.toolId).toBe("pen");
  });
});

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

describe("TimelineAddLayerParamsSchema", () => {
  it("accepts empty object", () => {
    const result = TimelineAddLayerParamsSchema.parse({});
    expect(result.name).toBeUndefined();
  });

  it("accepts name and type", () => {
    const result = TimelineAddLayerParamsSchema.parse({ name: "BG", type: "guide" });
    expect(result.type).toBe("guide");
  });
});

describe("TimelineAddLayerResultSchema", () => {
  it("parses result with layerId", () => {
    const result = TimelineAddLayerResultSchema.parse({ layerId: "layer-2", rev: 1 });
    expect(result.layerId).toBe("layer-2");
  });
});

describe("TimelineRemoveLayerParamsSchema", () => {
  it("requires layerId", () => {
    expect(() => TimelineRemoveLayerParamsSchema.parse({})).toThrow();
    const result = TimelineRemoveLayerParamsSchema.parse({ layerId: "layer-1" });
    expect(result.layerId).toBe("layer-1");
  });
});

describe("TimelineUpdateLayerParamsSchema", () => {
  it("accepts all optional fields", () => {
    const result = TimelineUpdateLayerParamsSchema.parse({
      layerId: "layer-1",
      name: "Background",
      locked: true,
      visible: false,
      type: "mask",
    });
    expect(result.locked).toBe(true);
    expect(result.type).toBe("mask");
  });
});

describe("TimelineFrameParamsSchema", () => {
  it("requires layerId and frameIndex", () => {
    const result = TimelineFrameParamsSchema.parse({ layerId: "layer-1", frameIndex: 4 });
    expect(result.frameIndex).toBe(4);
  });
});

describe("TimelineSetFrameLabelParamsSchema", () => {
  it("parses required + optional", () => {
    const result = TimelineSetFrameLabelParamsSchema.parse({
      layerId: "layer-1",
      frameIndex: 0,
      label: "start",
      labelType: "anchor",
    });
    expect(result.labelType).toBe("anchor");
  });
});

describe("TimelineSetTweenParamsSchema", () => {
  it("accepts motion tween", () => {
    const result = TimelineSetTweenParamsSchema.parse({
      layerId: "layer-1",
      frameIndex: 0,
      kind: "motion",
      props: { ease: 50 },
    });
    expect(result.kind).toBe("motion");
  });

  it("accepts null to clear tween", () => {
    const result = TimelineSetTweenParamsSchema.parse({
      layerId: "layer-1",
      frameIndex: 0,
      kind: null,
    });
    expect(result.kind).toBeNull();
  });
});

describe("TimelineGotoFrameParamsSchema", () => {
  it("parses frameIndex", () => {
    const result = TimelineGotoFrameParamsSchema.parse({ frameIndex: 10 });
    expect(result.frameIndex).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Code (AS2)
// ---------------------------------------------------------------------------

describe("DiagnosticSchema", () => {
  it("parses minimal diagnostic", () => {
    const result = DiagnosticSchema.parse({ message: "Unexpected token" });
    expect(result.message).toBe("Unexpected token");
  });

  it("parses full diagnostic", () => {
    const result = DiagnosticSchema.parse({
      message: "Parse error",
      line: 3,
      column: 7,
      severity: "error",
    });
    expect(result.line).toBe(3);
    expect(result.severity).toBe("error");
  });
});

describe("ScriptGetParamsSchema", () => {
  it("requires layerId and frameIndex", () => {
    const result = ScriptGetParamsSchema.parse({ layerId: "layer-1", frameIndex: 0 });
    expect(result.layerId).toBe("layer-1");
  });
});

describe("ScriptSetResultSchema", () => {
  it("parses result with diagnostics", () => {
    const result = ScriptSetResultSchema.parse({
      ok: true,
      rev: 2,
      diagnostics: [{ message: "Parse error", severity: "error" }],
    });
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("ScriptCheckParamsSchema", () => {
  it("parses script source", () => {
    const result = ScriptCheckParamsSchema.parse({ script: "stop();" });
    expect(result.script).toBe("stop();");
  });
});

describe("ScriptListResultSchema", () => {
  it("parses script list", () => {
    const result = ScriptListResultSchema.parse({
      scripts: [
        {
          sceneIndex: 0,
          layerId: "layer-1",
          layerName: "Layer 1",
          frameIndex: 4,
          preview: "stop();",
        },
      ],
      rev: 1,
    });
    expect(result.scripts).toHaveLength(1);
    expect(result.scripts[0].preview).toBe("stop();");
  });
});

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

describe("LibraryListResultSchema", () => {
  it("parses empty library", () => {
    const result = LibraryListResultSchema.parse({ items: [], rev: 0 });
    expect(result.items).toHaveLength(0);
  });

  it("parses library with items", () => {
    const result = LibraryListResultSchema.parse({
      items: [{ id: "sym-1", name: "Ball", type: "symbol" }],
      rev: 1,
    });
    expect(result.items[0].name).toBe("Ball");
  });
});

describe("LibraryCreateSymbolParamsSchema", () => {
  it("accepts all symbol types", () => {
    for (const symbolType of ["movieclip", "button", "graphic"] as const) {
      const result = LibraryCreateSymbolParamsSchema.parse({ name: "Test", symbolType });
      expect(result.symbolType).toBe(symbolType);
    }
  });
});

describe("LibraryCreateSymbolResultSchema", () => {
  it("parses result with symbolId", () => {
    const result = LibraryCreateSymbolResultSchema.parse({ symbolId: "sym-5", rev: 3 });
    expect(result.symbolId).toBe("sym-5");
  });
});

describe("LibraryConvertToSymbolParamsSchema", () => {
  it("parses required fields", () => {
    const result = LibraryConvertToSymbolParamsSchema.parse({
      ids: ["obj-1"],
      name: "MySymbol",
      symbolType: "movieclip",
    });
    expect(result.ids).toContain("obj-1");
    expect(result.symbolType).toBe("movieclip");
  });
});

describe("LibraryRenameParamsSchema", () => {
  it("parses rename params", () => {
    const result = LibraryRenameParamsSchema.parse({ itemId: "sym-1", name: "NewName" });
    expect(result.name).toBe("NewName");
  });
});

describe("LibraryRemoveParamsSchema", () => {
  it("parses remove params", () => {
    const result = LibraryRemoveParamsSchema.parse({ itemId: "sym-1" });
    expect(result.itemId).toBe("sym-1");
  });
});

// ---------------------------------------------------------------------------
// Output & escape hatches
// ---------------------------------------------------------------------------

describe("JsflRunParamsSchema", () => {
  it("parses source", () => {
    const result = JsflRunParamsSchema.parse({ source: "fl.trace('hello');" });
    expect(result.source).toContain("trace");
  });
});

describe("JsflRunResultSchema", () => {
  it("parses success result", () => {
    const result = JsflRunResultSchema.parse({
      traces: ["hello"],
      returnValue: 42,
      rev: 0,
    });
    expect(result.traces).toContain("hello");
    expect(result.returnValue).toBe(42);
  });

  it("parses error result", () => {
    const result = JsflRunResultSchema.parse({
      traces: [],
      error: "ReferenceError: x is not defined",
      rev: 0,
    });
    expect(result.error).toContain("not defined");
  });
});

describe("StageScreenshotParamsSchema", () => {
  it("parses with optional frameIndex", () => {
    expect(StageScreenshotParamsSchema.parse({}).frameIndex).toBeUndefined();
    expect(StageScreenshotParamsSchema.parse({ frameIndex: 3 }).frameIndex).toBe(3);
  });
});

describe("PublishSwfResultSchema", () => {
  it("parses result with base64 and byte length", () => {
    const result = PublishSwfResultSchema.parse({ swfBase64: "abc==", byteLength: 3 });
    expect(result.byteLength).toBe(3);
  });
});

describe("FileSaveFlaResultSchema", () => {
  it("parses result with base64 and byte length", () => {
    const result = FileSaveFlaResultSchema.parse({ flaBase64: "abc==", byteLength: 3 });
    expect(result.byteLength).toBe(3);
  });
});

describe("FileLoadFlaParamsSchema", () => {
  it("requires flaBase64", () => {
    const result = FileLoadFlaParamsSchema.parse({ flaBase64: "abc==" });
    expect(result.flaBase64).toBe("abc==");
  });
});

// ---------------------------------------------------------------------------
// Bridge request covers all commands
// ---------------------------------------------------------------------------

describe("BridgeRequestSchema — all commands", () => {
  it("ALL_COMMANDS list is non-empty", () => {
    expect(ALL_COMMANDS.length).toBeGreaterThan(40);
  });

  it("accepts all known commands", () => {
    for (const command of ALL_COMMANDS) {
      const req = BridgeRequestSchema.parse({ id: "x", command });
      expect(req.command).toBe(command);
    }
  });

  it("rejects an unknown command", () => {
    expect(() =>
      BridgeRequestSchema.parse({ id: "x", command: "not_a_real_command" })
    ).toThrow();
  });
});

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
  PublishSwfResultSchema,
  FileSaveFlaResultSchema,
  FileLoadFlaParamsSchema,
  // Bridge
  BridgeRequestSchema,
  ALL_COMMANDS,
  COMMAND_SCHEMAS,
  COMMAND_DESCRIPTIONS,
  StageSetInstanceNameParamsSchema,
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

  // task 1367: the updates bag was z.record(z.string(), z.unknown()); it is now
  // an enumerated DisplayObjectUpdatesSchema that strips unknown keys and rejects
  // wrong-typed known scalars.
  it("STRIPS unknown structural keys from the updates bag", () => {
    const result = StageUpdateParamsSchema.parse({
      id: "obj-1",
      updates: { x: 1, shape: { paths: [] }, bogus: 42 } as Record<string, unknown>,
    });
    const updates = result.updates as Record<string, unknown>;
    expect(updates.x).toBe(1);
    expect("shape" in updates).toBe(false);
    expect("bogus" in updates).toBe(false);
  });

  it("REJECTS a wrong-typed known scalar (x as a string)", () => {
    expect(() =>
      StageUpdateParamsSchema.parse({ id: "o", updates: { x: "50" } })
    ).toThrow();
  });

  it("accepts a typed colorEffect via the enumerated schema", () => {
    const result = StageUpdateParamsSchema.parse({
      id: "o",
      updates: { colorEffect: { type: "alpha", alpha: 50 } },
    });
    expect((result.updates as Record<string, unknown>).colorEffect).toBeDefined();
  });

  it("allows updates to be omitted entirely", () => {
    const result = StageUpdateParamsSchema.parse({ id: "o", instanceName: "p" });
    expect(result.id).toBe("o");
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

  it("parses a P3 partial sub-selection (face + segment keys)", () => {
    const result = SelectionGetResultSchema.parse({
      ids: [],
      objects: [],
      subSelection: {
        shapeId: "merged-1",
        keys: [
          { kind: "face", interior: "1400,700" },
          { kind: "segment", a: "0,600", b: "2000,600", mid: "1000,600" },
        ],
      },
    });
    expect(result.subSelection?.shapeId).toBe("merged-1");
    expect(result.subSelection?.keys).toHaveLength(2);
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

  // task 1367: props was z.record(z.string(), z.unknown()); now the enumerated
  // TweenPropsSchema strips unknown keys and rejects wrong-typed known fields.
  it("STRIPS unknown keys and keeps the known motion/shape props", () => {
    const result = TimelineSetTweenParamsSchema.parse({
      layerId: "l",
      frameIndex: 0,
      kind: "motion",
      props: { ease: 25, rotate: "cw", garbage: { nested: true } } as Record<string, unknown>,
    });
    const props = result.props as Record<string, unknown>;
    expect(props.ease).toBe(25);
    expect(props.rotate).toBe("cw");
    expect("garbage" in props).toBe(false);
  });

  it("REJECTS a wrong-typed known prop (ease as a string)", () => {
    expect(() =>
      TimelineSetTweenParamsSchema.parse({
        layerId: "l",
        frameIndex: 0,
        kind: "motion",
        props: { ease: "fast" },
      })
    ).toThrow();
  });

  it("REJECTS an out-of-enum rotate value", () => {
    expect(() =>
      TimelineSetTweenParamsSchema.parse({
        layerId: "l",
        frameIndex: 0,
        kind: "motion",
        props: { rotate: "spin" },
      })
    ).toThrow();
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
  it("parses result with summary fields, byte length and base64", () => {
    const result = PublishSwfResultSchema.parse({
      ok: true,
      width: 550,
      height: 400,
      byteLength: 3,
      swfBase64: "abc==",
    });
    expect(result.byteLength).toBe(3);
    expect(result.ok).toBe(true);
    expect(result.width).toBe(550);
    expect(result.height).toBe(400);
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

  it("every command has a schema and a description (auto-generated tool surface)", () => {
    for (const command of ALL_COMMANDS) {
      expect(COMMAND_SCHEMAS[command]).toBeDefined();
      expect(typeof COMMAND_DESCRIPTIONS[command]).toBe("string");
      expect(COMMAND_DESCRIPTIONS[command].length).toBeGreaterThan(0);
    }
  });
});

describe("stage_set_instance_name schema", () => {
  it("is registered in ALL_COMMANDS + schema + description maps", () => {
    expect(ALL_COMMANDS).toContain("stage_set_instance_name");
    expect(COMMAND_SCHEMAS["stage_set_instance_name"]).toBe(StageSetInstanceNameParamsSchema);
    expect(COMMAND_DESCRIPTIONS["stage_set_instance_name"]).toMatch(/instance name/i);
  });

  it("parses params with id + name", () => {
    const p = StageSetInstanceNameParamsSchema.parse({ id: "obj-1", name: "player" });
    expect(p.id).toBe("obj-1");
    expect(p.name).toBe("player");
  });

  it("requires both id and name", () => {
    expect(() => StageSetInstanceNameParamsSchema.parse({ id: "obj-1" })).toThrow();
    expect(() => StageSetInstanceNameParamsSchema.parse({ name: "player" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// task 1393: the schemas are the single source of truth for BOTH transports
// (the MCP plugin now generates its tool set from them, exactly like the
// in-browser Agent Chat bridge). They must therefore describe the params the
// registry handler actually honors, not a narrower subset.
// ---------------------------------------------------------------------------

describe("StageAddShapeParamsSchema — gradient fill (task 1393)", () => {
  it("still accepts a solid #RRGGBB string fill", () => {
    const r = StageAddShapeParamsSchema.parse({
      kind: "rect", x1: 0, y1: 0, x2: 10, y2: 10, fill: "#123456",
    });
    expect(r.fill).toBe("#123456");
  });

  it("accepts a linear gradient descriptor with stops", () => {
    const r = StageAddShapeParamsSchema.parse({
      kind: "rect", x1: 0, y1: 0, x2: 10, y2: 10,
      fill: {
        type: "linear",
        angle: 45,
        stops: [
          { color: "#000000", ratio: 0 },
          { color: "#ffffff", ratio: 1, alpha: 0.5 },
        ],
      },
    });
    expect(typeof r.fill).toBe("object");
  });

  it("rejects a gradient with fewer than 2 stops", () => {
    expect(() =>
      StageAddShapeParamsSchema.parse({
        kind: "rect", x1: 0, y1: 0, x2: 10, y2: 10,
        fill: { type: "radial", stops: [{ color: "#000", ratio: 0 }] },
      })
    ).toThrow();
  });
});

describe("StageAddTextParamsSchema — honored extras (task 1393)", () => {
  it("accepts the input-text / layout extras the handler applies", () => {
    const r = StageAddTextParamsSchema.parse({
      x: 0, y: 0, width: 100, height: 20, text: "hi",
      multiline: true,
      wordWrap: true,
      instanceName: "field1",
      password: false,
      maxChars: 10,
      hasBorder: true,
      html: false,
      autoSize: true,
      letterSpacing: 1,
      leading: 2,
      restrict: "0-9",
    });
    expect(r.multiline).toBe(true);
    expect(r.maxChars).toBe(10);
    expect(r.instanceName).toBe("field1");
  });
});

describe("StagePlaceInstanceParamsSchema — transform params (task 1393)", () => {
  it("accepts scale/rotation/blendMode/colorEffect/loopMode/firstFrame", () => {
    const r = StagePlaceInstanceParamsSchema.parse({
      symbolId: "sym-1", x: 0, y: 0,
      scaleX: 2, scaleY: 0.5, rotation: 90,
      blendMode: "multiply",
      colorEffect: { type: "alpha", alpha: 50 },
      loopMode: "single-frame",
      firstFrame: 3,
    });
    expect(r.scaleX).toBe(2);
    expect(r.blendMode).toBe("multiply");
    expect(r.loopMode).toBe("single-frame");
    expect(r.firstFrame).toBe(3);
  });

  it("rejects an unknown blend mode", () => {
    expect(() =>
      StagePlaceInstanceParamsSchema.parse({
        symbolId: "s", x: 0, y: 0, blendMode: "not-a-mode",
      })
    ).toThrow();
  });
});

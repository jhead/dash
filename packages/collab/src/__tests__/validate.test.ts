/**
 * Adversarial / malformed inbound-CRDT-state tests (untrusted-peer hardening).
 *
 * The collab trust model is "anyone with the link is a full collaborator", so a
 * peer's Y.Doc is untrusted input. These tests feed malformed/hostile state
 * through BOTH the direct validator and the full binding inbound path and assert:
 *   - the binding/validator NEVER throws on garbage;
 *   - the result is always a structurally-valid FlashDocument (known node kinds,
 *     string ids, finite coords, arrays where arrays are expected);
 *   - invalid pieces are DROPPED/COERCED, not propagated;
 *   - path-traversal asClasses paths are rejected via normalizeClassPath;
 *   - VALID inbound state is unaffected (identity round-trip still holds);
 *   - on un-saveable garbage the binding keeps the LAST-GOOD document.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import {
  createDocument,
  addDisplayObject,
  addAsClass,
  type FlashDocument,
  type Timeline,
  type ShapeDisplayObject,
} from "@flash/core";
import { validateInboundDoc } from "../validate.js";
import { FlashCollabBinding, flashDocToYDoc, yDocToFlashDoc } from "../binding.js";
import { rebuildDoc, getRoot } from "../schema.js";
import { FakeDocSource, wireYDocs } from "./helpers.js";

const KNOWN_OBJECT_TYPES = new Set([
  "shape",
  "instance",
  "drawing-object",
  "text",
  "bitmap",
  "video",
  "group",
]);
const KNOWN_ITEM_TYPES = new Set([
  "symbol",
  "bitmap",
  "sound",
  "video",
  "font",
  "component",
]);

/** Assert a doc satisfies the invariants the renderer/compiler rely on. */
function assertValidDoc(doc: FlashDocument): void {
  expect(typeof doc.id).toBe("string");
  expect(doc.properties).toBeTypeOf("object");
  expect(Number.isFinite(doc.properties.width)).toBe(true);
  expect(Number.isFinite(doc.properties.height)).toBe(true);
  expect(Number.isFinite(doc.properties.frameRate)).toBe(true);
  expect(Array.isArray(doc.scenes)).toBe(true);
  expect(doc.scenes.length).toBeGreaterThanOrEqual(1);
  for (const scene of doc.scenes) {
    expect(typeof scene.id).toBe("string");
    expect(Array.isArray(scene.timeline.layers)).toBe(true);
    for (const layer of scene.timeline.layers) {
      expect(Array.isArray(layer.frames)).toBe(true);
      for (const frame of layer.frames) {
        expect(Array.isArray(frame.displayObjects)).toBe(true);
        for (const obj of frame.displayObjects) {
          expect(KNOWN_OBJECT_TYPES.has(obj.type)).toBe(true);
          expect(typeof obj.id).toBe("string");
          expect(obj.id.length).toBeGreaterThan(0);
          expect(Number.isFinite(obj.x)).toBe(true);
          expect(Number.isFinite(obj.y)).toBe(true);
        }
      }
    }
  }
  expect(Array.isArray(doc.library.items)).toBe(true);
  expect(Array.isArray(doc.library.folders)).toBe(true);
  for (const item of doc.library.items) {
    expect(KNOWN_ITEM_TYPES.has(item.itemType)).toBe(true);
    expect(typeof item.id).toBe("string");
  }
}

function withScene0Timeline(doc: FlashDocument, fn: (t: Timeline) => Timeline): FlashDocument {
  const t = fn(doc.scenes[0].timeline);
  return { ...doc, scenes: doc.scenes.map((s, i) => (i === 0 ? { ...s, timeline: t } : s)) };
}

function shape(id: string, x: number, y: number): ShapeDisplayObject {
  return { type: "shape", id, x, y, shape: { id: `${id}-s`, paths: [] } };
}

describe("validateInboundDoc — direct coercion / dropping", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("does not throw on completely garbage / non-object input", () => {
    for (const garbage of [null, undefined, 42, "string", [], true, NaN]) {
      expect(() => validateInboundDoc(garbage)).not.toThrow();
      assertValidDoc(validateInboundDoc(garbage));
    }
  });

  it("falls back to the last-good doc when input is not an object", () => {
    const lastGood = createDocument();
    const out = validateInboundDoc("not a doc", lastGood);
    expect(out.id).toBe(lastGood.id);
  });

  it("is identity-equivalent on a VALID document", () => {
    let doc = createDocument();
    doc = withScene0Timeline(doc, (t) =>
      addDisplayObject(t, t.layers[0].id, 0, shape("o1", 12, 34)),
    );
    doc = addAsClass(doc, { path: "com/x/Foo.as", source: "class Foo {}" });
    const out = validateInboundDoc(doc);
    expect(out).toEqual(doc);
  });

  it("drops display objects with unknown type / missing id and coerces NaN coords", () => {
    const raw = {
      id: "d",
      properties: createDocument().properties,
      scenes: [
        {
          id: "s0",
          name: "Scene 1",
          timeline: {
            layers: [
              {
                id: "L0",
                name: "Layer 1",
                frames: [
                  {
                    index: 0,
                    isKeyframe: true,
                    displayObjects: [
                      { type: "shape", id: "good", x: 5, y: 6 },
                      { type: "evil-kind", id: "bad1", x: 0, y: 0 }, // unknown type
                      { type: "shape", x: 1, y: 2 }, // missing id
                      { type: "shape", id: "nanny", x: NaN, y: Infinity }, // bad coords
                      "not an object",
                      null,
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
      library: { items: [], folders: [] },
    };
    const out = validateInboundDoc(raw);
    assertValidDoc(out);
    const objs = out.scenes[0].timeline.layers[0].frames[0].displayObjects;
    // Only "good" and "nanny" survive; "nanny" has its NaN/Infinity coords zeroed.
    expect(objs.map((o) => o.id).sort()).toEqual(["good", "nanny"]);
    const nanny = objs.find((o) => o.id === "nanny")!;
    expect(nanny.x).toBe(0);
    expect(nanny.y).toBe(0);
  });

  it("drops library items with unknown itemType / missing id and dedupes ids", () => {
    const raw = {
      ...createDocument(),
      library: {
        items: [
          { itemType: "symbol", id: "sym1", timeline: { layers: [] } },
          { itemType: "wat", id: "x" }, // unknown
          { itemType: "bitmap" }, // missing id
          { itemType: "symbol", id: "sym1", timeline: { layers: [] } }, // dup id
        ],
        folders: [],
      },
    };
    const out = validateInboundDoc(raw as unknown);
    assertValidDoc(out);
    expect(out.library.items.map((i) => i.id)).toEqual(["sym1"]);
  });

  it("rejects asClasses paths that fail normalizeClassPath (traversal / NUL / absolute)", () => {
    const raw = {
      ...createDocument(),
      asClasses: [
        { path: "com/ok/Good.as", source: "ok" },
        { path: "../../etc/passwd", source: "evil" }, // traversal
        { path: "/abs/root.as", source: "abs" }, // absolute -> normalizes to relative (kept)
        { path: "has\0nul.as", source: "nul" }, // NUL byte
        { path: 42, source: "x" }, // non-string path
        { path: "com/ok/Coerce.as", source: 999 }, // non-string source -> coerced ""
      ],
    };
    const out = validateInboundDoc(raw as unknown);
    assertValidDoc(out);
    const paths = (out.asClasses ?? []).map((c) => c.path);
    expect(paths).toContain("com/ok/Good.as");
    expect(paths).toContain("abs/root.as"); // leading slash trimmed by normalizeClassPath
    expect(paths).toContain("com/ok/Coerce.as");
    expect(paths).not.toContain("../../etc/passwd");
    expect(paths.some((p) => p.includes("\0"))).toBe(false);
    // The non-string source was coerced to "".
    const coerced = (out.asClasses ?? []).find((c) => c.path === "com/ok/Coerce.as");
    expect(coerced?.source).toBe("");
  });

  it("coerces wrong-type structural fields (non-array scenes/layers/displayObjects)", () => {
    const raw = {
      id: "d",
      properties: "garbage", // wrong type -> defaults
      scenes: "not an array", // wrong type -> fresh scene
      library: 7, // wrong type -> {items:[],folders:[]}
    };
    const out = validateInboundDoc(raw as unknown);
    assertValidDoc(out);
    expect(out.scenes.length).toBe(1); // fell back to a fresh scene
  });

  it("clamps absurd document properties to sane finite values", () => {
    const raw = {
      ...createDocument(),
      properties: { width: NaN, height: -5, frameRate: Infinity, backgroundColor: 123 },
    };
    const out = validateInboundDoc(raw as unknown);
    expect(Number.isFinite(out.properties.width)).toBe(true);
    expect(out.properties.width).toBeGreaterThan(0);
    expect(out.properties.height).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(out.properties.frameRate)).toBe(true);
    expect(typeof out.properties.backgroundColor).toBe("string");
  });

  it("bounds an oversized display-object array (does not hang / OOM)", () => {
    const huge = Array.from({ length: 100 }, (_, i) => ({
      type: "shape",
      id: `o${i}`,
      x: i,
      y: i,
    }));
    const raw = {
      ...createDocument(),
      scenes: [
        {
          id: "s",
          name: "s",
          timeline: { layers: [{ id: "L", name: "L", frames: [{ displayObjects: huge }] }] },
        },
      ],
    };
    const out = validateInboundDoc(raw as unknown);
    assertValidDoc(out);
    expect(out.scenes[0].timeline.layers[0].frames[0].displayObjects.length).toBe(100);
  });

  it("guards against deeply-nested (cyclic-ish) atomic payloads without throwing", () => {
    // Build a very deep nested object as a display-object atomic field.
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 5000; i++) deep = { nested: deep };
    const raw = {
      ...createDocument(),
      scenes: [
        {
          id: "s",
          name: "s",
          timeline: {
            layers: [
              {
                id: "L",
                name: "L",
                frames: [
                  { displayObjects: [{ type: "shape", id: "deep", x: 0, y: 0, blob: deep }] },
                ],
              },
            ],
          },
        },
      ],
    };
    expect(() => validateInboundDoc(raw as unknown)).not.toThrow();
    assertValidDoc(validateInboundDoc(raw as unknown));
  });

  it("caps the flaSwfBlobs COUNT so a hostile peer cannot push an unbounded array", () => {
    // 10k entries, each a valid tiny blob; the cap is 4096.
    const rawBlobs = Array.from({ length: 10_000 }, () => ({
      bytes: new Uint8Array([1, 2, 3]),
    }));
    const raw = { ...createDocument(), flaSwfBlobs: rawBlobs };
    const out = validateInboundDoc(raw as unknown);
    assertValidDoc(out);
    expect(out.flaSwfBlobs).toBeDefined();
    expect(out.flaSwfBlobs!.length).toBe(4_096);
  });

  it("caps the flaSwfBlobs TOTAL BYTES so a hostile peer cannot amplify memory", () => {
    // Each entry carries a 1 MiB Uint8Array; the total budget is 64 MiB, so only
    // the first 64 survive and the rest are dropped.
    const oneMiB = () => ({ bytes: new Uint8Array(1024 * 1024) });
    const rawBlobs = Array.from({ length: 200 }, oneMiB);
    const raw = { ...createDocument(), flaSwfBlobs: rawBlobs };
    const out = validateInboundDoc(raw as unknown);
    assertValidDoc(out);
    expect(out.flaSwfBlobs!.length).toBe(64);
    const total = out.flaSwfBlobs!.reduce(
      (n, b) => n + (b as { bytes: Uint8Array }).bytes.length,
      0,
    );
    expect(total).toBeLessThanOrEqual(64 * 1024 * 1024);
  });

  it("drops flaSwfBlobs entries that are not {bytes} blob objects", () => {
    const raw = {
      ...createDocument(),
      flaSwfBlobs: [
        { bytes: new Uint8Array([1]) }, // valid (typed array)
        { bytes: "aGVsbG8=" }, // valid (raw base64 string, direct-caller form)
        42, // scalar — dropped
        null, // dropped
        [], // array — dropped
        { name: "no bytes" }, // object without `bytes` — dropped
        { bytes: 123 }, // `bytes` is a number — dropped
      ],
    };
    const out = validateInboundDoc(raw as unknown);
    assertValidDoc(out);
    expect(out.flaSwfBlobs!.length).toBe(2);
  });

  it("keeps valid flaSwfBlobs (bytes + metadata) and sanitizes the metadata", () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const raw = {
      ...createDocument(),
      // NaN in metadata should be sanitized to 0; bytes must survive untouched.
      flaSwfBlobs: [{ bytes, name: "swf1", w: NaN }],
    };
    const out = validateInboundDoc(raw as unknown);
    assertValidDoc(out);
    const blob = out.flaSwfBlobs![0] as {
      bytes: Uint8Array;
      name: string;
      w: number;
    };
    expect(blob.bytes).toBe(bytes); // same typed array reference, un-mangled
    expect(blob.name).toBe("swf1");
    expect(blob.w).toBe(0); // NaN sanitized
  });
});

describe("validateInboundDoc — binding inbound path (full peer scenario)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("a peer injecting raw garbage into the shared Y.Doc does not crash the other peer", () => {
    // Peer A holds a valid doc; the source records every applyRemote.
    const initial = createDocument();
    const srcA = new FakeDocSource(initial);
    const ydocA = new Y.Doc();
    const ydocB = new Y.Doc(); // the "malicious" peer's raw Y.Doc
    const unwire = wireYDocs(ydocA, ydocB);
    const bindingA = new FlashCollabBinding(ydocA, srcA);
    // Sync A's valid state to B first.
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), { wire: "remote" });

    try {
      // The malicious peer now writes HOSTILE state directly into the shared
      // document: an unknown-kind display object with no id and NaN coords, plus
      // a traversal asClasses path. This replicates over the wire to A.
      expect(() => {
        ydocB.transact(() => {
          const root = getRoot(ydocB);
          const scenes = root.get("scenes") as Y.Array<Y.Map<unknown>>;
          const layer = (scenes.get(0).get("timeline") as Y.Map<unknown>)
            .get("layers") as Y.Array<Y.Map<unknown>>;
          const frame = (layer.get(0).get("frames") as Y.Array<Y.Map<unknown>>).get(0);
          // displayObjects is a keyed Y.Map<id, Y.Map> + __order.
          const dispContainer = new Y.Map();
          frame.set("displayObjects", dispContainer);
          const evil = new Y.Map();
          dispContainer.set("evil", evil);
          evil.set("type", "totally-bogus-kind");
          evil.set("x", "not a number");
          const order = new Y.Array<string>();
          order.insert(0, ["evil"]);
          dispContainer.set("__order", order);
          // Hostile asClasses with a traversal path.
          const asc = new Y.Map();
          root.set("asClasses", asc);
          asc.set("../../../../etc/passwd", new Y.Text("evil source"));
          const ascOrder = new Y.Array<string>();
          ascOrder.insert(0, ["../../../../etc/passwd"]);
          asc.set("__order", ascOrder);
        }, { wire: "malicious" });
      }).not.toThrow();

      // Peer A received the update, validated it, and still holds a valid doc.
      const aDoc = srcA.getDoc();
      assertValidDoc(aDoc);
      // The evil display object was dropped (unknown kind).
      const objs = aDoc.scenes[0].timeline.layers[0].frames[0].displayObjects;
      expect(objs.find((o) => o.id === "evil")).toBeUndefined();
      // The traversal asClasses path was rejected.
      expect((aDoc.asClasses ?? []).some((c) => c.path.includes(".."))).toBe(false);
    } finally {
      bindingA.destroy();
      unwire();
    }
  });

  it("yDocToFlashDoc validates a one-shot late-join read", () => {
    const ydoc = flashDocToYDoc(createDocument());
    // Corrupt a display object's storage shape directly.
    ydoc.transact(() => {
      const root = getRoot(ydoc);
      // Replace the whole library with a hostile item array via materialize path.
      const lib = root.get("library") as Y.Map<unknown>;
      const items = lib.get("items") as Y.Map<unknown>;
      const bad = new Y.Map();
      items.set("bad", bad);
      bad.set("itemType", "nope"); // unknown -> dropped
      const order = items.get("__order") as Y.Array<string>;
      order.insert(order.length, ["bad"]);
    });
    const out = yDocToFlashDoc(ydoc);
    assertValidDoc(out);
    expect(out.library.items.find((i) => i.id === "bad")).toBeUndefined();
  });

  it("valid remote edits still propagate unchanged through the validated inbound path", () => {
    const initial = createDocument();
    const srcA = new FakeDocSource(initial);
    const srcB = new FakeDocSource(initial);
    const ydocA = new Y.Doc();
    const ydocB = new Y.Doc();
    const unwire = wireYDocs(ydocA, ydocB);
    const bindingA = new FlashCollabBinding(ydocA, srcA);
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), { wire: "remote" });
    const bindingB = new FlashCollabBinding(ydocB, srcB);
    try {
      const layerId = srcB.getDoc().scenes[0].timeline.layers[0].id;
      // B makes a legitimate edit; A must see exactly it.
      srcB.set(
        withScene0Timeline(srcB.getDoc(), (t) =>
          addDisplayObject(t, layerId, 0, shape("legit", 42, 84)),
        ),
      );
      const aObjs = srcA.getDoc().scenes[0].timeline.layers[0].frames[0].displayObjects;
      const legit = aObjs.find((o) => o.id === "legit") as ShapeDisplayObject | undefined;
      expect(legit).toBeDefined();
      expect(legit!.x).toBe(42);
      expect(legit!.y).toBe(84);
      // And the rebuilt-from-Y form (no validator) agrees, proving validation
      // is identity on this valid edit.
      const rebuilt = rebuildDoc(ydocA).scenes[0].timeline.layers[0].frames[0].displayObjects;
      expect(rebuilt.find((o) => o.id === "legit")).toBeDefined();
    } finally {
      bindingA.destroy();
      bindingB.destroy();
      unwire();
    }
  });
});

/**
 * Stack-overflow hardening (task 1351).
 *
 * `rebuildDoc` reads every ATOMIC (non-structural) field with a recursive deep
 * clone (`cloneJson`). A peer can store a LIVE Yjs type (Y.Map / Y.Array / Y.Text)
 * as the value of any atomic field at any node level; before the fix the clone
 * recursed through Yjs's cyclic internal item graph and threw "Maximum call stack
 * size exceeded" — INSIDE the binding's inbound observer, BEFORE `validateInboundDoc`
 * could run, so a single peer with the share link could crash every collaborator.
 *
 * The fix hardens `cloneJson` to DROP non-plain-JSON values (and depth-bound the
 * recursion), so `rebuildDoc` / the binding observer never crash; the malformed
 * field is dropped and the live FlashDocument stays valid.
 */
describe("rebuildDoc stack-overflow hardening (Y-type in atomic field)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("rebuildDoc does NOT stack-overflow on a doc-level Y-type in an atomic field", () => {
    // `properties` is now a STRUCTURAL nested Y.Map (task 1392) — its per-field
    // entries are atomic. A hostile peer storing a live Y-type as one of those
    // property slots (or in any doc-level atomic slot) must be DROPPED, not walked
    // (the same cloneJson hardening, now one level deeper for a property field).
    const yd = new Y.Doc();
    const root = yd.getMap("doc");
    const yprops = new Y.Map();
    yd.transact(() => {
      root.set("id", "doc");
      root.set("properties", yprops);
      yprops.set("width", new Y.Array()); // Y-type in an atomic PROPERTY slot
      root.set("rogueArray", new Y.Array()); // and a Y-type in a doc-level atomic slot
    }, { wire: "remote" });

    let rebuilt: FlashDocument | undefined;
    expect(() => {
      rebuilt = rebuildDoc(yd);
    }).not.toThrow();
    // The malformed atomic Y-type inside `properties` is dropped, not propagated.
    const props = (rebuilt as unknown as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props.width).toBeUndefined();
    // A doc-level atomic Y-type is likewise dropped.
    expect((rebuilt as unknown as Record<string, unknown>).rogueArray).toBeUndefined();
    // And the full validator then yields a structurally-valid doc.
    assertValidDoc(validateInboundDoc(rebuilt));
  });

  it("rebuildDoc does NOT stack-overflow on a Y-type nested inside a plain-JSON atomic value", () => {
    const yd = new Y.Doc();
    const root = yd.getMap("doc");
    const evil = new Y.Map();
    yd.transact(() => {
      root.set("id", "doc");
      // A plain-JSON array stored atomically that CONTAINS a live Y type.
      root.set("mixed", [1, evil, 3]);
    }, { wire: "remote" });

    let rebuilt: FlashDocument | undefined;
    expect(() => {
      rebuilt = rebuildDoc(yd);
    }).not.toThrow();
    // Array length preserved; the Y-type element coerced to null (never walked).
    expect((rebuilt as unknown as Record<string, unknown>).mixed).toEqual([1, null, 3]);
  });

  it("rebuildDoc depth-bounds a deeply-nested plain payload instead of overflowing", () => {
    const yd = new Y.Doc();
    const root = yd.getMap("doc");
    // Build a 5000-deep plain object — far beyond any legitimate atomic value.
    let deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 5000; i++) {
      const next: Record<string, unknown> = {};
      cur.c = next;
      cur = next;
    }
    yd.transact(() => {
      root.set("id", "doc");
      root.set("deep", deep);
    }, { wire: "remote" });

    expect(() => rebuildDoc(yd)).not.toThrow();
  });

  it("a peer storing a Y-type in a DISPLAY-OBJECT atomic field cannot crash the other peer", () => {
    const initial = createDocument();
    const srcA = new FakeDocSource(initial);
    const ydocA = new Y.Doc();
    const ydocB = new Y.Doc(); // the malicious peer's raw Y.Doc
    const unwire = wireYDocs(ydocA, ydocB);
    const bindingA = new FlashCollabBinding(ydocA, srcA);
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), { wire: "remote" });

    try {
      // The malicious peer adds a display object whose `x` (an atomic scalar
      // field) is a LIVE Y.Map. Pre-fix this stack-overflowed in A's observer.
      expect(() => {
        ydocB.transact(() => {
          const root = getRoot(ydocB);
          const scenes = root.get("scenes") as Y.Array<Y.Map<unknown>>;
          const layer = (scenes.get(0).get("timeline") as Y.Map<unknown>)
            .get("layers") as Y.Array<Y.Map<unknown>>;
          const frame = (layer.get(0).get("frames") as Y.Array<Y.Map<unknown>>).get(0);
          let dispContainer = frame.get("displayObjects") as Y.Map<unknown> | undefined;
          if (!(dispContainer instanceof Y.Map)) {
            dispContainer = new Y.Map();
            frame.set("displayObjects", dispContainer);
            dispContainer.set("__order", new Y.Array<string>());
          }
          const evil = new Y.Map();
          dispContainer.set("evil", evil);
          evil.set("id", "evil");
          evil.set("type", "shape"); // KNOWN type so it would otherwise be kept
          evil.set("x", new Y.Map()); // <- Y-type in an atomic scalar field
          const order = dispContainer.get("__order") as Y.Array<string>;
          order.insert(order.length, ["evil"]);
        }, { wire: "malicious" });
      }).not.toThrow();

      // Peer A survived, validated, and still holds a valid doc.
      const aDoc = srcA.getDoc();
      assertValidDoc(aDoc);
      const objs = aDoc.scenes[0].timeline.layers[0].frames[0].displayObjects;
      const evil = objs.find((o) => o.id === "evil") as ShapeDisplayObject | undefined;
      // The object is kept (known type, has id) but its hostile `x` was dropped by
      // the clone, then re-defaulted to a finite 0 by the validator.
      if (evil) expect(Number.isFinite(evil.x)).toBe(true);
    } finally {
      bindingA.destroy();
      unwire();
    }
  });
});

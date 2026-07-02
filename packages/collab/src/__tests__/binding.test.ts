/**
 * Binding behavior tests: origin filtering, inbound replaceDoc (no undo entry),
 * per-field merge, atomic geometry last-writer-wins, character-level asClasses
 * merge, and a late-joining peer adopting existing state.
 *
 * Two in-process Y.Docs are wired together (NO networking) to simulate two peers.
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  createDocument,
  updateDisplayObject,
  addDisplayObject,
  setBackgroundColor,
  setFrameRate,
  setDocumentWidth,
  updateDocumentProperties,
  addAsClass,
  updateAsClass,
  type FlashDocument,
  type Timeline,
  type ShapeDisplayObject,
} from "@flash/core";
import { FlashCollabBinding } from "../binding.js";
import { rebuildDoc } from "../schema.js";
import { FakeDocSource, wireYDocs } from "./helpers.js";

function withScene0Timeline(doc: FlashDocument, fn: (t: Timeline) => Timeline): FlashDocument {
  const t = fn(doc.scenes[0].timeline);
  return { ...doc, scenes: doc.scenes.map((s, i) => (i === 0 ? { ...s, timeline: t } : s)) };
}

function shape(id: string, x: number, y: number): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    x,
    y,
    shape: { id: `${id}-s`, paths: [] },
  };
}

/** Stand up two wired peers each with their own binding + source. */
function twoPeers(initial: FlashDocument) {
  const srcA = new FakeDocSource(initial);
  const srcB = new FakeDocSource(initial);
  const ydocA = new Y.Doc();
  const ydocB = new Y.Doc();
  const bindingA = new FlashCollabBinding(ydocA, srcA);
  // Replicate A's initial state into B before B's binding adopts it.
  let unwire = wireYDocs(ydocA, ydocB);
  Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), { wire: "remote" });
  const bindingB = new FlashCollabBinding(ydocB, srcB);

  /**
   * Run a genuinely CONCURRENT pair of edits: disconnect the wire, let each
   * peer edit from the SAME base, then reconnect and exchange state so Yjs
   * merges them. Without this the synchronous wire would deliver A's edit to B
   * before B's edit is computed, which is sequential, not concurrent.
   */
  function concurrent(editA: () => void, editB: () => void): void {
    unwire(); // disconnect
    editA();
    editB();
    // Exchange both peers' full state both ways with a remote origin.
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), { wire: "remote" });
    Y.applyUpdate(ydocA, Y.encodeStateAsUpdate(ydocB), { wire: "remote" });
    unwire = wireYDocs(ydocA, ydocB); // reconnect for any later edits
  }

  return {
    srcA,
    srcB,
    ydocA,
    ydocB,
    bindingA,
    bindingB,
    concurrent,
    unwire: () => unwire(),
  };
}

describe("origin filtering & inbound replaceDoc", () => {
  it("a local edit on A propagates to B via applyRemote (not the local-edit path)", () => {
    const initial = createDocument();
    const { srcA, srcB, bindingA, bindingB, unwire } = twoPeers(initial);
    try {
      const before = srcB.remoteApplications;
      const edited = setBackgroundColor(srcA.getDoc(), "#abcdef");
      srcA.set(edited);

      // B received it as a REMOTE application (the replaceDoc path).
      expect(srcB.remoteApplications).toBe(before + 1);
      expect(srcB.getDoc().properties.backgroundColor).toBe("#abcdef");
    } finally {
      bindingA.destroy();
      bindingB.destroy();
      unwire();
    }
  });

  it("the binding ignores its OWN transactions (no echo / infinite loop)", () => {
    const initial = createDocument();
    const srcA = new FakeDocSource(initial);
    const ydocA = new Y.Doc();
    const binding = new FlashCollabBinding(ydocA, srcA);
    try {
      const before = srcA.remoteApplications;
      srcA.set(setFrameRate(srcA.getDoc(), 30));
      // No remote peer; the binding's own write must not call applyRemote.
      expect(srcA.remoteApplications).toBe(before);
      expect(rebuildDoc(ydocA).properties.frameRate).toBe(30);
    } finally {
      binding.destroy();
    }
  });
});

describe("per-field merge (concurrent disjoint scalar edits)", () => {
  it("A edits x while B edits y of the SAME display object — both survive", () => {
    // Seed with one shape on scene 0 / layer 0.
    let base = createDocument();
    base = withScene0Timeline(base, (t) =>
      addDisplayObject(t, t.layers[0].id, 0, shape("obj1", 10, 10)),
    );
    const { srcA, srcB, ydocA, ydocB, bindingA, bindingB, concurrent, unwire } = twoPeers(base);
    try {
      const layerId = srcA.getDoc().scenes[0].timeline.layers[0].id;

      // Concurrent edits from the same base: A sets x=99, B sets y=77.
      concurrent(
        () =>
          srcA.set(
            withScene0Timeline(srcA.getDoc(), (t) =>
              updateDisplayObject(t, layerId, 0, "obj1", { x: 99 }),
            ),
          ),
        () =>
          srcB.set(
            withScene0Timeline(srcB.getDoc(), (t) =>
              updateDisplayObject(t, layerId, 0, "obj1", { y: 77 }),
            ),
          ),
      );

      // Both Y.Docs converge to x=99 AND y=77 (per-field merge).
      for (const yd of [ydocA, ydocB]) {
        const d = rebuildDoc(yd);
        const obj = d.scenes[0].timeline.layers[0].frames[0].displayObjects[0] as ShapeDisplayObject;
        expect(obj.x).toBe(99);
        expect(obj.y).toBe(77);
      }
    } finally {
      bindingA.destroy();
      bindingB.destroy();
      unwire();
    }
  });
});

describe("per-field merge of document properties (task 1392)", () => {
  it("A edits stage width while B edits frameRate — both survive", () => {
    const base = createDocument();
    const { srcA, srcB, ydocA, ydocB, bindingA, bindingB, concurrent, unwire } = twoPeers(base);
    try {
      const w0 = srcA.getDoc().properties.width;
      const fr0 = srcA.getDoc().properties.frameRate;

      // Concurrent edits to DIFFERENT property fields from the same base.
      concurrent(
        () => srcA.set(setDocumentWidth(srcA.getDoc(), w0 + 123)),
        () => srcB.set(setFrameRate(srcB.getDoc(), fr0 + 24)),
      );

      // Both Y.Docs converge to BOTH edits — neither field clobbers the other.
      for (const yd of [ydocA, ydocB]) {
        const props = rebuildDoc(yd).properties;
        expect(props.width).toBe(w0 + 123);
        expect(props.frameRate).toBe(fr0 + 24);
      }
    } finally {
      bindingA.destroy();
      bindingB.destroy();
      unwire();
    }
  });

  it("A toggles snapToObjects while B changes backgroundColor — both survive", () => {
    const base = createDocument();
    const { srcA, srcB, ydocA, ydocB, bindingA, bindingB, concurrent, unwire } = twoPeers(base);
    try {
      const snap0 = srcA.getDoc().properties.snapToObjects;

      concurrent(
        () => srcA.set(updateDocumentProperties(srcA.getDoc(), { snapToObjects: !snap0 })),
        () => srcB.set(setBackgroundColor(srcB.getDoc(), "#123456")),
      );

      for (const yd of [ydocA, ydocB]) {
        const props = rebuildDoc(yd).properties;
        expect(props.snapToObjects).toBe(!snap0);
        expect(props.backgroundColor).toBe("#123456");
      }
    } finally {
      bindingA.destroy();
      bindingB.destroy();
      unwire();
    }
  });
});

describe("atomic geometry is whole-value last-writer-wins", () => {
  it("converges to ONE shape geometry (no half-merged segments)", () => {
    let base = createDocument();
    base = withScene0Timeline(base, (t) =>
      addDisplayObject(t, t.layers[0].id, 0, shape("g1", 0, 0)),
    );
    const { srcA, srcB, ydocA, ydocB, bindingA, bindingB, concurrent, unwire } = twoPeers(base);
    try {
      const layerId = srcA.getDoc().scenes[0].timeline.layers[0].id;
      const geomA = { id: "ga", paths: [{ start: { x: 0, y: 0 }, segments: [{ type: "line", to: { x: 5, y: 5 } }], closed: false }] };
      const geomB = { id: "gb", paths: [{ start: { x: 1, y: 1 }, segments: [{ type: "line", to: { x: 9, y: 9 } }], closed: true }] };
      concurrent(
        () => srcA.set(withScene0Timeline(srcA.getDoc(), (t) => updateDisplayObject(t, layerId, 0, "g1", { shape: geomA } as Partial<ShapeDisplayObject>))),
        () => srcB.set(withScene0Timeline(srcB.getDoc(), (t) => updateDisplayObject(t, layerId, 0, "g1", { shape: geomB } as Partial<ShapeDisplayObject>))),
      );

      const da = (rebuildDoc(ydocA).scenes[0].timeline.layers[0].frames[0].displayObjects[0] as ShapeDisplayObject).shape;
      const db = (rebuildDoc(ydocB).scenes[0].timeline.layers[0].frames[0].displayObjects[0] as ShapeDisplayObject).shape;
      // Both peers agree on the SAME atomic geometry, and it is exactly one of
      // the two whole values (never a structural blend).
      expect(da).toEqual(db);
      expect([JSON.stringify(geomA), JSON.stringify(geomB)]).toContain(JSON.stringify(da));
    } finally {
      bindingA.destroy();
      bindingB.destroy();
      unwire();
    }
  });
});

describe("asClasses character-level merge (Y.Text)", () => {
  it("concurrent disjoint text inserts both survive", () => {
    let base = createDocument();
    base = addAsClass(base, { path: "p/C.as", source: "class C {\n\n}\n" });
    const { srcA, srcB, ydocA, ydocB, bindingA, bindingB, concurrent, unwire } = twoPeers(base);
    try {
      // A appends a method line; B appends a field line — into the same blank line.
      concurrent(
        () => srcA.set(updateAsClass(srcA.getDoc(), "p/C.as", "class C {\n  function foo() {}\n}\n")),
        () => srcB.set(updateAsClass(srcB.getDoc(), "p/C.as", "class C {\n\n  var bar;\n}\n")),
      );

      const a = rebuildDoc(ydocA).asClasses?.[0].source ?? "";
      const b = rebuildDoc(ydocB).asClasses?.[0].source ?? "";
      // Converge identically and retain BOTH disjoint insertions.
      expect(a).toBe(b);
      expect(a).toContain("function foo");
      expect(a).toContain("var bar");
    } finally {
      bindingA.destroy();
      bindingB.destroy();
      unwire();
    }
  });
});

describe("late-joining peer adopts existing Y.Doc state", () => {
  it("a peer joining a populated Y.Doc applies the existing doc (no overwrite)", () => {
    let base = createDocument();
    base = setBackgroundColor(base, "#0a0b0c");
    base = addAsClass(base, { path: "p/X.as", source: "class X {}" });

    // Peer A populates its Y.Doc.
    const srcA = new FakeDocSource(base);
    const ydocA = new Y.Doc();
    const bindingA = new FlashCollabBinding(ydocA, srcA);

    // Peer B starts with a DIFFERENT (fresh) doc, then its Y.Doc receives A's state.
    const srcB = new FakeDocSource(createDocument());
    const ydocB = new Y.Doc();
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), { wire: "remote" });
    const bindingB = new FlashCollabBinding(ydocB, srcB);

    try {
      // B's source must now reflect A's document, not B's original fresh doc.
      expect(srcB.getDoc().properties.backgroundColor).toBe("#0a0b0c");
      expect(srcB.getDoc().asClasses?.[0].path).toBe("p/X.as");
    } finally {
      bindingA.destroy();
      bindingB.destroy();
    }
  });
});

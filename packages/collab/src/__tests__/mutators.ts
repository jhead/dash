/**
 * Random mutation generator driving the REAL @flash/core pure functions.
 *
 * Each mutator takes the current FlashDocument + an rng and returns a new
 * FlashDocument (or the same reference for a no-op). Coverage spans:
 *   scenes      add / remove / rename / move
 *   layers      add / delete / rename / visible / locked / type
 *   frames      insertFrame / insertKeyframe / insertBlankKeyframe / removeFrame
 *               clearKeyframe / setFrameLabel / setFrameScript / tween
 *   displayObj  add / update (scalars + atomic shape/filters) / remove / reorder
 *   library     add symbol (nested timeline) / bitmap / rename / remove + folders
 *   symbol tl   mutate a symbol's nested timeline (layers/frames/objects)
 *   asClasses   add / update / remove
 *   properties  bg / frameRate / size / grid
 */
import {
  // scene
  addScene,
  removeScene,
  renameScene,
  moveScene,
  // layer
  addLayer,
  deleteLayer,
  renameLayer,
  setLayerVisible,
  setLayerLocked,
  setLayerType,
  // frame
  insertFrame,
  insertKeyframe,
  insertBlankKeyframe,
  removeFrame,
  clearKeyframe,
  setFrameLabel,
  setFrameScript,
  setMotionTween,
  setShapeTween,
  // display object
  addDisplayObject,
  updateDisplayObject,
  removeDisplayObject,
  setKeyframeDisplayObjects,
  // library
  createSymbolInLibrary,
  addLibraryItem,
  removeLibraryItem,
  renameLibraryItem,
  createBitmap,
  addLibraryFolder,
  // doc props
  setBackgroundColor,
  setFrameRate,
  setDocumentWidth,
  updateGridSettings,
  // asClasses
  addAsClass,
  updateAsClass,
  removeAsClass,
  // types
  type FlashDocument,
  type Timeline,
  type Library,
  type LayerType,
} from "@flash/core";
import type { DisplayObject, ShapeDisplayObject, SymbolInstance } from "@flash/core";
import { pick, randInt } from "./helpers.js";

let _idc = 0;
const nid = (p: string) => `${p}-${++_idc}`;

// --- store-level helpers (mirror authoring-ui documentStore withX helpers) ---

function withSceneTimeline(
  doc: FlashDocument,
  sceneIndex: number,
  updater: (t: Timeline) => Timeline,
): FlashDocument {
  const idx = Math.min(sceneIndex, doc.scenes.length - 1);
  if (idx < 0) return doc;
  const scene = doc.scenes[idx];
  const t = updater(scene.timeline);
  if (t === scene.timeline) return doc;
  const scenes = doc.scenes.map((s, i) => (i === idx ? { ...s, timeline: t } : s));
  return { ...doc, scenes };
}

function withSymbolTimeline(
  doc: FlashDocument,
  symbolId: string,
  updater: (t: Timeline) => Timeline,
): FlashDocument {
  let touched = false;
  const items = doc.library.items.map((item) => {
    if (item.id === symbolId && item.itemType === "symbol") {
      const t = updater(item.timeline);
      if (t !== item.timeline) touched = true;
      return { ...item, timeline: t };
    }
    return item;
  });
  if (!touched) return doc;
  return { ...doc, library: { ...doc.library, items } };
}

function withLibrary(doc: FlashDocument, updater: (l: Library) => Library): FlashDocument {
  const lib = updater(doc.library);
  if (lib === doc.library) return doc;
  return { ...doc, library: lib };
}

// --- random factories ---

function makeShapeObject(rng: () => number): ShapeDisplayObject {
  const color = { r: randInt(rng, 0, 255), g: randInt(rng, 0, 255), b: randInt(rng, 0, 255), a: 255 };
  return {
    type: "shape",
    id: nid("shape"),
    x: randInt(rng, 0, 400),
    y: randInt(rng, 0, 300),
    shape: {
      id: nid("shp"),
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: randInt(rng, 10, 100), y: 0 } },
            { type: "curve", control: { x: 50, y: 50 }, to: { x: 0, y: randInt(rng, 10, 100) } },
          ],
          fill: { type: "solid", color },
          closed: true,
        },
      ],
    },
  };
}

function makeInstance(rng: () => number, symbolId: string): SymbolInstance {
  return {
    type: "instance",
    id: nid("inst"),
    symbolId,
    x: randInt(rng, 0, 400),
    y: randInt(rng, 0, 300),
  };
}

// --- timeline-level mutation applied to either a scene or a symbol timeline ---

function mutateTimeline(t: Timeline, rng: () => number, knownSymbolIds: string[]): Timeline {
  const layerIds = t.layers.map((l) => l.id);
  const layerId = layerIds.length > 0 ? pick(rng, layerIds) : null;
  const op = randInt(rng, 0, 17);
  switch (op) {
    case 0:
      return addLayer(t, `L${_idc++}`);
    case 1:
      return layerId ? deleteLayer(t, layerId) : t;
    case 2:
      return layerId ? renameLayer(t, layerId, `R${_idc++}`) : t;
    case 3:
      return layerId ? setLayerVisible(t, layerId, rng() < 0.5) : t;
    case 4:
      return layerId ? setLayerLocked(t, layerId, rng() < 0.5) : t;
    case 5: {
      const types: LayerType[] = ["normal", "guide", "mask"];
      return layerId ? setLayerType(t, layerId, pick(rng, types)) : t;
    }
    case 6:
      return layerId ? insertFrame(t, layerId, randInt(rng, 0, 6)) : t;
    case 7:
      return layerId ? insertKeyframe(t, layerId, randInt(rng, 0, 6)) : t;
    case 8:
      return layerId ? insertBlankKeyframe(t, layerId, randInt(rng, 0, 6)) : t;
    case 9:
      return layerId ? removeFrame(t, layerId, randInt(rng, 0, 6)) : t;
    case 10:
      return layerId ? clearKeyframe(t, layerId, randInt(rng, 1, 6)) : t;
    case 11:
      return layerId ? setFrameLabel(t, layerId, 0, `lbl${_idc++}`) : t;
    case 12:
      return layerId ? setFrameScript(t, layerId, 0, `trace(${_idc++});`) : t;
    case 13:
      return layerId ? setMotionTween(t, layerId, 0, rng() < 0.5) : t;
    case 14:
      return layerId ? setShapeTween(t, layerId, 0, rng() < 0.5) : t;
    case 15:
      return layerId ? addDisplayObject(t, layerId, 0, makeShapeObject(rng)) : t;
    case 16: {
      // update OR remove a random display object on layer 0
      if (!layerId) return t;
      const layer = t.layers.find((l) => l.id === layerId);
      const kf = layer?.frames.find((f) => f.isKeyframe);
      const objs = kf?.displayObjects ?? [];
      if (objs.length === 0) return addDisplayObject(t, layerId, 0, makeShapeObject(rng));
      const obj = pick(rng, objs);
      if (rng() < 0.4) return removeDisplayObject(t, layerId, kf!.index, obj.id);
      // scalar update vs atomic (shape) update vs filters
      const r = rng();
      let updates: Partial<DisplayObject>;
      if (r < 0.4) updates = { x: randInt(rng, 0, 500), y: randInt(rng, 0, 500) } as Partial<DisplayObject>;
      else if (r < 0.7) updates = { alpha: rng(), rotation: randInt(rng, 0, 359) } as Partial<DisplayObject>;
      else if (r < 0.85)
        updates = {
          shape: makeShapeObject(rng).shape,
        } as Partial<DisplayObject>;
      else
        updates = {
          filters: [{ type: "blur", blurX: randInt(rng, 0, 20), blurY: 4, quality: 1, enabled: true }],
        } as unknown as Partial<DisplayObject>;
      return updateDisplayObject(t, layerId, kf!.index, obj.id, updates);
    }
    case 17: {
      // reorder display objects on layer 0 (exercise z-order / order array)
      if (!layerId) return t;
      const layer = t.layers.find((l) => l.id === layerId);
      const kf = layer?.frames.find((f) => f.isKeyframe);
      const objs = kf?.displayObjects ?? [];
      if (objs.length < 2) {
        const sym = knownSymbolIds.length > 0 ? pick(rng, knownSymbolIds) : null;
        return sym ? addDisplayObject(t, layerId, 0, makeInstance(rng, sym)) : t;
      }
      const reversed = [...objs].reverse();
      return setKeyframeDisplayObjects(t, layerId, kf!.index, reversed as DisplayObject[]);
    }
    default:
      return t;
  }
}

/** Apply ONE random top-level mutation. Returns the new doc (may equal input). */
export function applyRandomMutation(doc: FlashDocument, rng: () => number): FlashDocument {
  const symbolIds = doc.library.items.filter((i) => i.itemType === "symbol").map((i) => i.id);
  const op = randInt(rng, 0, 12);
  switch (op) {
    case 0:
      return addScene(doc, `Scene${_idc++}`);
    case 1:
      return doc.scenes.length > 1 ? removeScene(doc, pick(rng, doc.scenes).id) : doc;
    case 2:
      return renameScene(doc, pick(rng, doc.scenes).id, `S${_idc++}`);
    case 3:
      return doc.scenes.length > 1
        ? moveScene(doc, pick(rng, doc.scenes).id, randInt(rng, 0, doc.scenes.length - 1))
        : doc;
    case 4:
    case 5:
    case 6:
      // scene timeline mutation (weighted heavier — the bulk of edits)
      return withSceneTimeline(doc, randInt(rng, 0, doc.scenes.length - 1), (t) =>
        mutateTimeline(t, rng, symbolIds),
      );
    case 7:
      // library: add symbol or bitmap
      if (rng() < 0.6) {
        return withLibrary(doc, (lib) => createSymbolInLibrary(lib, `Sym${_idc++}`, "movieclip").library);
      }
      return withLibrary(doc, (lib) =>
        addLibraryItem(
          lib,
          createBitmap(`Bmp${_idc++}`, {
            dataUri: "data:image/png;base64,AAAA",
            originalWidth: 32,
            originalHeight: 32,
          }),
        ),
      );
    case 8:
      // library: rename / remove / folder
      if (doc.library.items.length > 0 && rng() < 0.5) {
        const item = pick(rng, doc.library.items);
        return rng() < 0.5
          ? withLibrary(doc, (lib) => renameLibraryItem(lib, item.id, `RN${_idc++}`))
          : withLibrary(doc, (lib) => removeLibraryItem(lib, item.id));
      }
      return withLibrary(doc, (lib) => addLibraryFolder(lib, `Folder${_idc++}`));
    case 9:
      // mutate a symbol's nested timeline
      if (symbolIds.length === 0) {
        return withLibrary(doc, (lib) => createSymbolInLibrary(lib, `Sym${_idc++}`, "movieclip").library);
      }
      return withSymbolTimeline(doc, pick(rng, symbolIds), (t) =>
        mutateTimeline(t, rng, symbolIds),
      );
    case 10:
      // document properties
      switch (randInt(rng, 0, 3)) {
        case 0:
          return setBackgroundColor(doc, `#${randInt(rng, 0, 0xffffff).toString(16).padStart(6, "0")}`);
        case 1:
          return setFrameRate(doc, randInt(rng, 1, 60));
        case 2:
          return setDocumentWidth(doc, randInt(rng, 100, 1200));
        default:
          return updateGridSettings(doc, { gridWidth: randInt(rng, 5, 40) });
      }
    case 11:
      // asClasses add/update
      if ((doc.asClasses?.length ?? 0) === 0 || rng() < 0.5) {
        return addAsClass(doc, { path: `pkg/Cls${_idc++}.as`, source: `class C${_idc} {}` });
      }
      return updateAsClass(doc, pick(rng, doc.asClasses!).path, `class C { var v = ${_idc++}; }`);
    case 12:
      // asClasses remove
      if ((doc.asClasses?.length ?? 0) > 0) {
        return removeAsClass(doc, pick(rng, doc.asClasses!).path);
      }
      return addAsClass(doc, { path: `pkg/Cls${_idc++}.as`, source: `class C {}` });
    default:
      return doc;
  }
}

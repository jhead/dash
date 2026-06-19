/**
 * Placed v2-component synthesis pass (task 1229, Part 1 — runtime plumbing).
 *
 * Flash 8 ships the v2 component architecture (`mx.controls.*` / `mx.containers.*`):
 * authoring-time UI controls backed by AS2 classes. A `ComponentItem` placed on
 * the stage produces a `SymbolInstance` whose `symbolId` points at the
 * ComponentItem's id (see `engine/libraryplace.ts`). The library-symbol pass only
 * handles `itemType === "symbol"`, so a placed component never received a SWF
 * character id and was SILENTLY DROPPED from the published movie.
 *
 * This pass closes that gap by emitting, for each *placed* ComponentItem:
 *   1. A synthetic DefineSprite (an empty placeholder timeline) registered in
 *      `charIdMap` under the ComponentItem's id, so the stage instance resolves to
 *      a real character id in the frame loop (`charIdMap.get(displayObj.symbolId)`).
 *   2. An ExportAssets entry under the fully-qualified AS2 class name
 *      (e.g. `mx.controls.Button`) — Flash's linkage identifier for the component.
 *   3. A DoInitAction calling `Object.registerClass(className, <ctor>)`, reusing the
 *      same machinery library symbols use, so the placeholder binds to its class.
 *
 * EXPLICITLY OUT OF SCOPE (Part 2): the actual `mx.controls.*` AS2 framework, skins,
 * and behaviour. Without it the component registers but renders as an empty
 * placeholder sprite — the accepted Part-1 outcome.
 */
import type { ComponentItem, ComponentLinkage, DisplayObject, FlashDocument, SymbolInstance } from "@flash/core";
import { BitWriter } from "../bits.js";
import { Tag } from "../tags.js";
import { SwfWriter } from "../writer.js";
import { encodeDoInitAction } from "../doInitAction.js";
import { flattenDisplayObjects } from "./display.js";

/** Inputs the component-synthesis pass needs. */
export interface ComponentPassInput {
  writer: SwfWriter;
  doc: FlashDocument;
  /** Shared symbolId → charId map; the synthetic sprite ids are added here. */
  charIdMap: Map<string, number>;
}

/**
 * Linkage entries collected during component synthesis. The orchestrator appends
 * these to the symbol-pass results so they are emitted by the existing first-frame
 * ExportAssets / DoInitAction machinery (see `compiler/frames.ts`).
 */
export interface ComponentPassResult {
  exportEntries: { charId: number; name: string }[];
  doInitActionBodies: Uint8Array[];
}

/**
 * Fully-qualified AS2 class name for a component, e.g. `mx.controls.Button`.
 * An explicit `linkage.className` overrides the derived form.
 */
export function componentClassName(item: ComponentItem): string {
  if (item.linkage?.className) return item.linkage.className;
  const pkg = item.packageName?.trim();
  const cls = item.componentName?.trim() || item.name;
  return pkg ? `${pkg}.${cls}` : cls;
}

/** ExportAssets linkage identifier for a component (defaults to the class name). */
export function componentLinkageIdentifier(item: ComponentItem): string {
  return item.linkage?.linkageIdentifier || componentClassName(item);
}

/**
 * Encode an EMPTY DefineSprite body (placeholder timeline): SpriteID + a single
 * frame containing only ShowFrame, terminated by End. This is the Part-1
 * placeholder skin — Part 2 replaces it with the real component visual.
 *
 * Returns the raw tag body (the caller wraps it with `writeTag(DefineSprite, …)`).
 */
export function encodeEmptyDefineSprite(spriteId: number): Uint8Array {
  // SpriteID (UI16) + FrameCount (UI16=1) + ShowFrame (tag 1, len 0) + End (tag 0, len 0).
  const bw = new BitWriter();
  bw.writeUI16LE(spriteId);
  bw.writeUI16LE(1); // FrameCount
  bw.writeUI16LE((Tag.ShowFrame << 6) | 0); // ShowFrame record header, body length 0
  bw.writeUI16LE((Tag.End << 6) | 0); // End record header, body length 0
  return bw.getBytes();
}

/**
 * Collect the set of ComponentItem ids that are actually PLACED on any scene or
 * symbol timeline (a SymbolInstance whose symbolId resolves to a ComponentItem).
 * Only placed components are emitted — an unplaced library component costs nothing.
 */
function collectPlacedComponentIds(doc: FlashDocument): Set<string> {
  const componentIds = new Set<string>();
  for (const item of doc.library.items) {
    if (item.itemType === "component") componentIds.add(item.id);
  }
  const placed = new Set<string>();
  if (componentIds.size === 0) return placed;

  const scan = (objs: readonly DisplayObject[]): void => {
    for (const obj of flattenDisplayObjects(objs)) {
      if (obj.type === "instance") {
        const inst = obj as SymbolInstance;
        if (componentIds.has(inst.symbolId)) placed.add(inst.symbolId);
      }
    }
  };

  for (const scene of doc.scenes) {
    for (const layer of scene.timeline.layers) {
      for (const frame of layer.frames) scan(frame.displayObjects);
    }
  }
  // Components nested inside symbol timelines also count.
  for (const item of doc.library.items) {
    if (item.itemType !== "symbol") continue;
    for (const layer of item.timeline.layers) {
      for (const frame of layer.frames) scan(frame.displayObjects);
    }
  }
  return placed;
}

/**
 * Emit a synthetic DefineSprite + linkage for every placed v2 component.
 *
 * Must run AFTER the symbol pass (so library-symbol char ids are already assigned
 * and the synthetic sprite ids never collide) and BEFORE the frame loop (so the
 * placement path can resolve `charIdMap.get(displayObj.symbolId)`).
 */
export function runComponentPass(input: ComponentPassInput): ComponentPassResult {
  const { writer, doc, charIdMap } = input;
  const exportEntries: { charId: number; name: string }[] = [];
  const doInitActionBodies: Uint8Array[] = [];

  const placedIds = collectPlacedComponentIds(doc);
  if (placedIds.size === 0) return { exportEntries, doInitActionBodies };

  // Emit in stable library order for deterministic output.
  for (const item of doc.library.items) {
    if (item.itemType !== "component") continue;
    if (!placedIds.has(item.id)) continue;
    const component = item as ComponentItem;

    const charId = writer.nextCharId();
    charIdMap.set(component.id, charId);

    // 1. Synthetic placeholder sprite (registered under the ComponentItem id so
    //    the stage SymbolInstance resolves to it).
    writer.writeTag(Tag.DefineSprite, encodeEmptyDefineSprite(charId));

    // 2. ExportAssets entry under the fully-qualified AS2 class name.
    const className = componentClassName(component);
    const linkageId = componentLinkageIdentifier(component);
    exportEntries.push({ charId, name: linkageId });

    // 3. DoInitAction binding the placeholder to its AS2 class (reuses the same
    //    Object.registerClass machinery library symbols use).
    doInitActionBodies.push(encodeDoInitAction(charId, className, linkageId));
  }

  return { exportEntries, doInitActionBodies };
}

// Re-export the linkage type for downstream convenience.
export type { ComponentLinkage };

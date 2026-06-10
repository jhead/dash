/**
 * Diagnostic test for task 0903: Magnet.fla compiles to solid black SWF.
 *
 * Loads Magnet.fla via the public @flash/core loadFla API,
 * compiles it, and inspects the SWF output to identify the root cause.
 */
import { describe, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { loadFla } from "@flash/core";
import { compileDocument } from "../compile.js";
import type { FlashDocument } from "@flash/core";

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(`/Users/jhead/dev/flash/packages/core/fixtures/${name}`));
}

// Parse SWF tags from compiled binary
interface SwfTag { type: number; body: Uint8Array; }
function parseTags(bytes: Uint8Array): SwfTag[] {
  const nbits = bytes[8] >> 3;
  const rectBytes = Math.ceil((5 + 4 * nbits) / 8);
  let i = 8 + rectBytes + 4;
  const tags: SwfTag[] = [];
  while (i < bytes.length - 1) {
    const h = bytes[i] | (bytes[i + 1] << 8);
    i += 2;
    const type = (h >> 6) & 0x3ff;
    let len = h & 0x3f;
    if (len === 63) {
      len = bytes[i] | (bytes[i+1] << 8) | (bytes[i+2] << 16) | (bytes[i+3] << 24);
      i += 4;
    }
    tags.push({ type, body: bytes.slice(i, i + len) });
    i += len;
    if (type === 0) break;
  }
  return tags;
}

describe("0903 compile diagnostic: Magnet.fla SWF output", () => {
  let doc: FlashDocument;
  let swf: Uint8Array;
  let tags: SwfTag[];

  beforeAll(() => {
    const flaBytes = fixture("Magnet.fla");
    doc = loadFla(flaBytes);
    swf = compileDocument(doc);
    tags = parseTags(swf);
  });

  it("SWF header and first tags", () => {
    console.log(`\n=== SWF header ===`);
    console.log(`  signature: ${String.fromCharCode(swf[0], swf[1], swf[2])}`);
    console.log(`  version: ${swf[3]}`);
    const fileSize = swf[4] | (swf[5] << 8) | (swf[6] << 16) | (swf[7] << 24);
    console.log(`  fileSize: ${fileSize}, actual: ${swf.length}`);
    console.log(`=== First 10 tags ===`);
    for (let i = 0; i < Math.min(10, tags.length); i++) {
      console.log(`  tag[${i}]: type=${tags[i].type} len=${tags[i].body.length}`);
    }
  });

  it("SetBackgroundColor is not black", () => {
    const bgTag = tags.find(t => t.type === 9);
    console.log(`\n=== backgroundColor prop: "${doc.properties.backgroundColor}" ===`);
    if (bgTag) {
      console.log(`SetBackgroundColor: r=${bgTag.body[0]} g=${bgTag.body[1]} b=${bgTag.body[2]}`);
    } else {
      console.log("WARNING: No SetBackgroundColor tag found!");
    }
  });

  it("SWF tag counts", () => {
    const c = (type: number) => tags.filter(t => t.type === type).length;
    console.log(`\n=== SWF tag counts (${tags.length} total) ===`);
    console.log(`  FileAttributes(69): ${c(69)}`);
    console.log(`  SetBackgroundColor(9): ${c(9)}`);
    console.log(`  DefineShape4(83): ${c(83)}`);
    console.log(`  DefineSprite(39): ${c(39)}`);
    console.log(`  DefineBitsJPEG2(21): ${c(21)}`);
    console.log(`  DefineBitsJPEG3(35): ${c(35)}`);
    console.log(`  DefineBitsLossless2(36): ${c(36)}`);
    console.log(`  PlaceObject2(26): ${c(26)}`);
    console.log(`  PlaceObject3(70): ${c(70)}`);
    console.log(`  ShowFrame(1): ${c(1)}`);
    console.log(`  RemoveObject2(28): ${c(28)}`);
    console.log(`  FrameLabel(43): ${c(43)}`);
    console.log(`  DefineEditText(37): ${c(37)}`);
    console.log(`  DefineButton2(34): ${c(34)}`);
    console.log(`  DoAction(12): ${c(12)}`);
  });

  it("first DoAction body (frame 0 script)", () => {
    const doAction = tags.find(t => t.type === 12);
    if (!doAction) { console.log("\nNo DoAction found!"); return; }
    console.log(`\n=== First DoAction: ${doAction.body.length} bytes ===`);
    console.log(`  First 40 bytes: ${Array.from(doAction.body.slice(0, 40)).map(b => b.toString(16).padStart(2,'0')).join(' ')}`);
    // Check for ActionStop (0x07)
    const hasStop = Array.from(doAction.body).some(b => b === 0x07);
    console.log(`  Contains ActionStop(0x07): ${hasStop}`);
  });

  it("PlaceObject2/3 tags before first ShowFrame", () => {
    let po2 = 0;
    for (const t of tags) {
      if (t.type === 1) break; // first ShowFrame
      if (t.type === 26 || t.type === 70) po2++;
    }
    console.log(`\n=== PlaceObject2/3 before first ShowFrame: ${po2} ===`);
    if (po2 === 0) {
      console.log("PROBLEM: No PlaceObject2/3 before first ShowFrame!");
    }
  });

  it("DefineShape4 bodies: fill counts and first fill colors", () => {
    const shape4Tags = tags.filter(t => t.type === 83);
    console.log(`\n=== ${shape4Tags.length} DefineShape4 tags ===`);
    for (let i = 0; i < Math.min(5, shape4Tags.length); i++) {
      const body = shape4Tags[i].body;
      console.log(`  Shape[${i}]: ${body.length} bytes, first 20: ${Array.from(body.slice(0, 20)).map(b => b.toString(16).padStart(2,'0')).join(' ')}`);
    }
  });

  it("first PlaceObject2 body structure", () => {
    const po2 = tags.find(t => t.type === 26);
    if (!po2) {
      console.log("\nNo PlaceObject2 found!");
      return;
    }
    console.log(`\n=== First PlaceObject2: ${po2.body.length} bytes ===`);
    console.log(`  flags: 0x${po2.body[0].toString(16).padStart(2,'0')}`);
    const depth = po2.body[1] | (po2.body[2] << 8);
    console.log(`  depth: ${depth}`);
    if (po2.body[0] & 0x02) {
      const charId = po2.body[3] | (po2.body[4] << 8);
      console.log(`  charId: ${charId}`);
    }
  });

  it("DefineSprite bodies have content", () => {
    const sprites = tags.filter(t => t.type === 39);
    console.log(`\n=== ${sprites.length} DefineSprite tags ===`);
    let emptySprites = 0;
    let nonemptySprites = 0;
    for (const s of sprites) {
      // DefineSprite body: UI16 spriteId, UI16 frameCount, then inner tags
      const frameCount = s.body[2] | (s.body[3] << 8);
      if (s.body.length <= 6) emptySprites++;
      else {
        nonemptySprites++;
        if (nonemptySprites <= 3) {
          console.log(`  Sprite charId=${s.body[0]|(s.body[1]<<8)}, frameCount=${frameCount}, bodyLen=${s.body.length}`);
        }
      }
    }
    console.log(`  non-empty: ${nonemptySprites}, empty: ${emptySprites}`);
  });

  it("coordinates: shape x,y positions in scene 0 frame 0", () => {
    const scene = doc.scenes[0];
    console.log(`\n=== Frame 0, Layer 0 display objects ===`);
    const layer0 = scene?.timeline.layers[0];
    const frame0 = layer0?.frames.find(f => f.index === 0 && f.isKeyframe);
    if (frame0) {
      for (const obj of frame0.displayObjects) {
        const o = obj as unknown as Record<string, unknown>;
        console.log(`  type=${obj.type} x=${o.x} y=${o.y} scaleX=${o.scaleX} scaleY=${o.scaleY}`);
      }
    } else {
      console.log("  No frame 0 in layer 0!");
    }
  });
});

describe("0903 additional: SceneAndFrameLabelData decode", () => {
  let doc2: FlashDocument;
  let tags2: SwfTag[];

  beforeAll(() => {
    const flaBytes = new Uint8Array(readFileSync(`/Users/jhead/dev/flash/packages/core/fixtures/Magnet.fla`));
    doc2 = loadFla(flaBytes);
    const swf2 = compileDocument(doc2);
    tags2 = parseTags(swf2);
  });

  it("SceneAndFrameLabelData content", () => {
    const sceneTag = tags2.find(t => t.type === 86);
    if (!sceneTag) { console.log("No SceneAndFrameLabelData"); return; }
    console.log(`\n=== SceneAndFrameLabelData: ${sceneTag.body.length} bytes ===`);
    // First few bytes: EncodedU32 SceneCount, then scene records
    const body = sceneTag.body;
    console.log(`  First 40 bytes: ${Array.from(body.slice(0, 40)).map(b => b.toString(16).padStart(2,'0')).join(' ')}`);
    
    // Count scenes in document
    console.log(`  Doc scenes: ${doc2.scenes.length}`);
    doc2.scenes.forEach((s, i) => console.log(`    Scene ${i}: "${s.name}"`));
  });

  it("layer depths in first frame", () => {
    console.log(`\n=== All PO2 depths before first ShowFrame ===`);
    const depths: number[] = [];
    for (const t of tags2) {
      if (t.type === 1) break;
      if (t.type === 26 && t.body.length >= 3) {
        const depth = t.body[1] | (t.body[2] << 8);
        depths.push(depth);
      }
    }
    depths.sort((a, b) => a - b);
    console.log(`  ${depths.length} placements, depths: min=${depths[0]}, max=${depths[depths.length-1]}`);
    if (depths.length <= 15) console.log(`  depths: [${depths.join(',')}]`);
    else console.log(`  first 15: [${depths.slice(0, 15).join(',')}]`);
  });
});

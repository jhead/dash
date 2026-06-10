import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { tryLoadRealFla } from "../ole.js";

describe("Magnet.fla inspection", () => {
  it("menu label keyframe check", () => {
    const bytes = new Uint8Array(readFileSync("/Users/jhead/dev/flash/packages/core/fixtures/Magnet.fla"));
    const doc = tryLoadRealFla(bytes);
    if (!doc) throw new Error("failed to load");

    // Find the "menu" label frame in Scene 5
    const scene5 = doc.scenes[2]; // index 2 = "Scene 5"
    console.log(`Scene 5 name: "${scene5.name}"`);
    for (const layer of scene5.timeline.layers) {
      for (const frame of layer.frames) {
        if (frame.label) {
          console.log(`  layer "${layer.name}" frame ${frame.index}: label="${frame.label}" isKeyframe=${frame.isKeyframe} isEmpty=${frame.isEmpty} labelType=${frame.labelType}`);
        }
        if (frame.script && frame.script.trim()) {
          console.log(`  layer "${layer.name}" frame ${frame.index}: SCRIPT: ${frame.script.substring(0, 200)}`);
        }
      }
    }
  });

  it("ballmask symbol scripts and navigation", () => {
    const bytes = new Uint8Array(readFileSync("/Users/jhead/dev/flash/packages/core/fixtures/Magnet.fla"));
    const doc = tryLoadRealFla(bytes);
    if (!doc) throw new Error("failed to load");

    // Find ballmask instance - look in ALL scene timelines
    console.log("=== Instance names across all scenes ===");
    for (const scene of doc.scenes) {
      for (const layer of scene.timeline.layers) {
        for (const frame of layer.frames) {
          for (const obj of frame.displayObjects) {
            if (obj.type === "instance") {
              const inst = obj as any;
              if (inst.instanceName && inst.instanceName.length > 0) {
                console.log(`  Scene "${scene.name}" layer "${layer.name}" frame ${frame.index}: instance "${inst.instanceName}" symId=${inst.symbolId}`);
              }
            }
          }
        }
      }
    }

    // Find the ballmask symbol and its scripts
    console.log("\n=== All MC symbols (non-button) with frame scripts ===");
    for (const item of doc.library.items) {
      if (item.itemType === "symbol") {
        const sym = item as any;
        if (sym.symbolType !== "button") {
          let hasScripts = false;
          for (const layer of sym.timeline.layers) {
            for (const frame of layer.frames) {
              if (frame.script && frame.script.trim()) {
                hasScripts = true;
                break;
              }
            }
            if (hasScripts) break;
          }
          if (hasScripts) {
            console.log(`  symbol id=${sym.id} name="${item.name}" type=${sym.symbolType}`);
            for (const layer of sym.timeline.layers) {
              for (const frame of layer.frames) {
                if (frame.script && frame.script.trim()) {
                  console.log(`    frame ${frame.index}: ${frame.script.substring(0, 400)}`);
                }
              }
            }
          }
        }
      }
    }
  });

  it("button scripts and scene navigation", () => {
    const bytes = new Uint8Array(readFileSync("/Users/jhead/dev/flash/packages/core/fixtures/Magnet.fla"));
    const doc = tryLoadRealFla(bytes);
    if (!doc) throw new Error("failed to load");

    // All scene names + frame counts
    console.log("=== Scenes ===");
    for (let si = 0; si < doc.scenes.length; si++) {
      const scene = doc.scenes[si];
      let maxFrame = 1;
      for (const layer of scene.timeline.layers) {
        if (layer.frameCount > maxFrame) maxFrame = layer.frameCount;
      }
      console.log(`  [${si}] Scene "${scene.name}": ${maxFrame} frames`);
    }

    // Find button symbols
    console.log("\n=== Button Symbols ===");
    for (const item of doc.library.items) {
      if (item.itemType === "symbol") {
        const sym = item as any;
        if (sym.symbolType === "button") {
          console.log(`  symbol id=${sym.id} name="${sym.name}"`);
          if (sym.buttonActions && sym.buttonActions.length > 0) {
            for (const action of sym.buttonActions) {
              console.log(`    event=${JSON.stringify(action.event)} script: ${action.script}`);
            }
          } else {
            console.log(`    (no buttonActions)`);
          }
        }
      }
    }

    // Find button instances on title screen (Scene AA)
    const sceneAA = doc.scenes[0];
    console.log("\n=== Button instances on Scene AA ===");
    for (const layer of sceneAA.timeline.layers) {
      for (const frame of layer.frames) {
        for (const obj of frame.displayObjects) {
          if (obj.type === "instance") {
            const inst = obj as any;
            const sym = doc.library.items.find(i => i.id === inst.symbolId) as any;
            if (sym && sym.symbolType === "button") {
              console.log(`  layer "${layer.name}" frame ${frame.index}: button symId=${inst.symbolId} sym="${sym.name}" buttonHandlers=${JSON.stringify(inst.buttonHandlers)}`);
            }
          }
        }
      }
    }

    // Frame scripts on Scene AA
    console.log("\n=== Frame scripts on Scene AA ===");
    for (const layer of sceneAA.timeline.layers) {
      for (const frame of layer.frames) {
        if (frame.script && frame.script.trim()) {
          console.log(`  layer "${layer.name}" frame ${frame.index}: ${frame.script.substring(0, 300)}`);
        }
      }
    }
  });
});

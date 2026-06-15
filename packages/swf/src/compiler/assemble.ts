/**
 * Final SWF assembly: compute the header frame count, serialize the writer's
 * tag stream, and optionally zlib-compress the body (CWS).
 */
import type { FlashDocument } from "@flash/core";
import { zlibSync } from "fflate";
import { Tag } from "../tags.js";
import { SwfWriter } from "../writer.js";
import { sceneFrameCount } from "./depth.js";
import type { CompileOptions } from "./options.js";

/**
 * Append the End tag, assemble the binary, and (when `options.compress`) emit a
 * zlib-compressed CWS file instead of an uncompressed FWS.
 *
 * The SWF header frame count is the total frames across ALL scenes; scene 0 is
 * extended to cover the longest embedded video stream (`maxVideoFrames`).
 */
export function assembleSwf(
  writer: SwfWriter,
  doc: FlashDocument,
  maxVideoFrames: number,
  options?: CompileOptions
): Uint8Array {
  const props = doc.properties;

  // 5. End
  writer.writeTag(Tag.End, new Uint8Array(0));

  // FrameCount in the SWF header = total frames across ALL scenes.
  const frameCount =
    doc.scenes.length === 0
      ? 1
      : doc.scenes.reduce((sum, s, i) => {
          const sceneFrames = sceneFrameCount(s.timeline);
          // Scene 0 is extended to cover the longest embedded video stream.
          return sum + (i === 0 ? Math.max(sceneFrames, maxVideoFrames) : sceneFrames);
        }, 0);

  const result = writer.assemble(
    props.frameRate,
    frameCount,
    props.width,
    props.height,
    false
  );

  if (options?.compress) {
    // Compress the SWF body (bytes 8 onward) with zlib deflate and emit CWS header.
    // Bytes 0-7 are the SWF header (signature + version + uncompressed file length).
    const header = result.slice(0, 8);
    const body = result.slice(8);
    const compressed = zlibSync(body);
    const out = new Uint8Array(8 + compressed.length);
    out.set(header);
    out.set(compressed, 8);
    out[0] = 0x43; // 'C' — CWS signature
    return out;
  }

  return result;
}

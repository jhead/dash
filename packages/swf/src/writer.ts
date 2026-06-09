/**
 * High-level SWF tag writer and file assembler.
 */
import { BitWriter } from "./bits.js";
import { writeRect } from "./helpers.js";

// ---------------------------------------------------------------------------
// SwfWriter
// ---------------------------------------------------------------------------

export class SwfWriter {
  private _tags: Uint8Array[] = [];
  private _characterId = 1;

  /** Allocate the next unique character ID (1-based, incrementing). */
  nextCharId(): number {
    return this._characterId++;
  }

  /**
   * Encode one SWF tag record (header + body) and store it.
   *
   * Short header: (tagCode << 6) | length  (if length < 63)
   * Long header:  (tagCode << 6) | 0x3F, then UI32 length
   */
  writeTag(tagCode: number, body: Uint8Array): void {
    const bw = new BitWriter();
    if (body.length < 63) {
      bw.writeUI16LE((tagCode << 6) | body.length);
    } else {
      bw.writeUI16LE((tagCode << 6) | 0x3f);
      bw.writeUI32LE(body.length);
    }
    bw.writeBytes(body);
    this._tags.push(bw.getBytes());
  }

  /**
   * Store a pre-encoded tag record (header already included) directly.
   * Use this when a helper returns a fully-encoded tag byte array.
   */
  writeRaw(tagRecord: Uint8Array): void {
    this._tags.push(tagRecord);
  }

  /**
   * Assemble the complete SWF binary.
   *
   * @param frameRate  Frames per second (integer or float).
   * @param frameCount Number of frames.
   * @param stageW     Stage width in pixels.
   * @param stageH     Stage height in pixels.
   * @param compressed If true, emit CWS (zlib-compressed). Currently only FWS supported.
   */
  assemble(
    frameRate: number,
    frameCount: number,
    stageW: number,
    stageH: number,
    _compressed = false
  ): Uint8Array {
    const header = new BitWriter();

    // Signature: "FWS" (uncompressed)
    header.writeUI8(0x46); // F
    header.writeUI8(0x57); // W
    header.writeUI8(0x53); // S

    // Version 8
    header.writeUI8(8);

    // FileLength placeholder (4 bytes) — filled in below
    header.writeUI32LE(0);

    // FrameSize: RECT in twips (1px = 20 twips)
    writeRect(header, 0, stageW * 20, 0, stageH * 20);

    // FrameRate: fps * 256 as UI16 LE (e.g. 12fps → 0x0C00 → [0x00, 0x0C])
    header.writeUI16LE(Math.round(frameRate * 256));

    // FrameCount: UI16
    header.writeUI16LE(frameCount);

    const headerBytes = header.getBytes();

    // Concatenate all tag bytes
    let tagTotal = 0;
    for (const t of this._tags) tagTotal += t.length;

    const total = headerBytes.length + tagTotal;
    const out = new Uint8Array(total);

    out.set(headerBytes, 0);
    let offset = headerBytes.length;
    for (const t of this._tags) {
      out.set(t, offset);
      offset += t.length;
    }

    // Patch FileLength at bytes 4-7
    const view = new DataView(out.buffer);
    view.setUint32(4, total, true /* little-endian */);

    return out;
  }
}

/**
 * Bit-level writer for SWF binary encoding.
 *
 * SWF uses little-endian integers and bit-packed fields.
 * UB[n] / SB[n] are packed MSB-first within each byte (big-endian bit order).
 */
export class BitWriter {
  private _bytes: number[] = [];
  private _bitBuf = 0;
  private _bitPos = 0; // how many bits are currently pending in _bitBuf

  // -------------------------------------------------------------------------
  // Bit-level I/O (MSB-first packing, SWF style)
  // -------------------------------------------------------------------------

  /** Write the low `n` bits of `value`, MSB first (SWF UB[n]/SB[n] style). */
  writeBits(value: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) {
      const bit = (value >>> i) & 1;
      this._bitBuf = (this._bitBuf << 1) | bit;
      this._bitPos++;
      if (this._bitPos === 8) {
        this._bytes.push(this._bitBuf & 0xff);
        this._bitBuf = 0;
        this._bitPos = 0;
      }
    }
  }

  /** Flush pending bits to a byte boundary (pad with 0 bits on the right). */
  flushBits(): void {
    if (this._bitPos > 0) {
      this._bytes.push((this._bitBuf << (8 - this._bitPos)) & 0xff);
      this._bitBuf = 0;
      this._bitPos = 0;
    }
  }

  // -------------------------------------------------------------------------
  // Byte-aligned integers (little-endian)
  // -------------------------------------------------------------------------

  writeUI8(v: number): void {
    this.flushBits();
    this._bytes.push(v & 0xff);
  }

  writeUI16LE(v: number): void {
    this.flushBits();
    this._bytes.push(v & 0xff, (v >> 8) & 0xff);
  }

  writeSI16LE(v: number): void {
    // treat as two's-complement 16-bit
    const u = v < 0 ? v + 0x10000 : v;
    this.writeUI16LE(u);
  }

  writeUI32LE(v: number): void {
    this.flushBits();
    this._bytes.push(
      v & 0xff,
      (v >>> 8) & 0xff,
      (v >>> 16) & 0xff,
      (v >>> 24) & 0xff
    );
  }

  writeSI32LE(v: number): void {
    // treat as two's-complement 32-bit
    const u = v >>> 0; // coerce to unsigned 32-bit
    this.writeUI32LE(u);
  }

  /** Write a 32-bit IEEE 754 float in little-endian order (SWF FLOAT). */
  writeFloat(v: number): void {
    this.flushBits();
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, v, true /* LE */);
    const bytes = new Uint8Array(buf);
    for (const b of bytes) this._bytes.push(b);
  }

  /**
   * Write a FIXED8 value (SWF 8.8 fixed-point, 2 bytes LE).
   * Encoded as: round(value * 256) stored as a signed 16-bit LE integer.
   * E.g. strength=2.5 → 640 (0x0280) → bytes [0x80, 0x02].
   */
  writeFixed8(v: number): void {
    this.writeSI16LE(Math.round(v * 256));
  }

  /**
   * Write a FIXED16 value (SWF 16.16 fixed-point, 4 bytes LE).
   * Encoded as: round(value * 65536) stored as a signed 32-bit LE integer.
   * Used for blur, angle, and distance fields in filter records.
   * E.g. blurX=4.0 → 4 * 65536 = 262144 (0x00040000) → bytes [0x00, 0x00, 0x04, 0x00].
   */
  writeFixed16(v: number): void {
    this.writeSI32LE(Math.round(v * 65536));
  }

  // -------------------------------------------------------------------------
  // Byte buffers & strings
  // -------------------------------------------------------------------------

  writeBytes(data: Uint8Array): void {
    this.flushBits();
    for (const b of data) {
      this._bytes.push(b);
    }
  }

  /** Write a null-terminated UTF-8 string. */
  writeString(s: string): void {
    this.flushBits();
    const encoded = new TextEncoder().encode(s);
    for (const b of encoded) this._bytes.push(b);
    this._bytes.push(0); // null terminator
  }

  // -------------------------------------------------------------------------
  // Output
  // -------------------------------------------------------------------------

  getBytes(): Uint8Array {
    this.flushBits();
    return new Uint8Array(this._bytes);
  }

  get byteLength(): number {
    return this._bytes.length + (this._bitPos > 0 ? 1 : 0);
  }
}

/**
 * Self-contained baseline JPEG encoder (no runtime dependencies).
 *
 * Why this exists: the Publish Settings "JPEG quality" slider used to be inert —
 * photo (JPEG) library bitmaps were embedded by passing their ORIGINAL dataUri
 * bytes through verbatim (compiler/characters.ts, sprite.ts, buttons.ts), so the
 * encoded JPEG was byte-identical no matter what quality the author picked
 * (task 1287). To make the slider actually control output quality/size, the
 * compile path now RE-ENCODES a photo bitmap's decoded ARGB pixels (already
 * available in {@link CompileOptions.bitmapPixels}) to JPEG at the requested
 * quality. SWF's DefineBitsJPEG2/JPEG3 embeds an ordinary baseline JFIF JPEG,
 * which is exactly what this encoder produces.
 *
 * The implementation is a compact, deterministic baseline (sequential DCT +
 * Huffman) encoder — a TypeScript port of the public-domain JPEGEncoder lineage
 * used by jpeg-js (Andreas Ritter's port of Adobe's reference sample). It is
 * intentionally dependency-free so it runs identically in the browser publish
 * flow and in headless unit tests, and so the SWF output stays reproducible
 * (same pixels + same quality -> same bytes).
 *
 * Input is 32-bit ARGB (the same byte order {@link CompileOptions.bitmapPixels}
 * carries — A,R,G,B per pixel), matching DefineBitsLossless2 BitmapFormat 5.
 */

// prettier-ignore
const ZIGZAG = [
   0, 1, 5, 6,14,15,27,28,
   2, 4, 7,13,16,26,29,42,
   3, 8,12,17,25,30,41,43,
   9,11,18,24,31,40,44,53,
  10,19,23,32,39,45,52,54,
  20,22,33,38,46,51,55,60,
  21,34,37,47,50,56,59,61,
  35,36,48,49,57,58,62,63,
];

// prettier-ignore
const STD_DC_LUMINANCE_NRCODES = [0,0,1,5,1,1,1,1,1,1,0,0,0,0,0,0,0];
// prettier-ignore
const STD_DC_LUMINANCE_VALUES = [0,1,2,3,4,5,6,7,8,9,10,11];
// prettier-ignore
const STD_AC_LUMINANCE_NRCODES = [0,0,2,1,3,3,2,4,3,5,5,4,4,0,0,1,0x7d];
// prettier-ignore
const STD_AC_LUMINANCE_VALUES = [
  0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,
  0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,0x23,0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,
  0x24,0x33,0x62,0x72,0x82,0x09,0x0a,0x16,0x17,0x18,0x19,0x1a,0x25,0x26,0x27,0x28,
  0x29,0x2a,0x34,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,
  0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,
  0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x83,0x84,0x85,0x86,0x87,0x88,0x89,
  0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,
  0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,
  0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe1,0xe2,
  0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf1,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,
  0xf9,0xfa,
];

// prettier-ignore
const STD_DC_CHROMINANCE_NRCODES = [0,0,3,1,1,1,1,1,1,1,1,1,0,0,0,0,0];
// prettier-ignore
const STD_DC_CHROMINANCE_VALUES = [0,1,2,3,4,5,6,7,8,9,10,11];
// prettier-ignore
const STD_AC_CHROMINANCE_NRCODES = [0,0,2,1,2,4,4,3,4,7,5,4,4,0,1,2,0x77];
// prettier-ignore
const STD_AC_CHROMINANCE_VALUES = [
  0x00,0x01,0x02,0x03,0x11,0x04,0x05,0x21,0x31,0x06,0x12,0x41,0x51,0x07,0x61,0x71,
  0x13,0x22,0x32,0x81,0x08,0x14,0x42,0x91,0xa1,0xb1,0xc1,0x09,0x23,0x33,0x52,0xf0,
  0x15,0x62,0x72,0xd1,0x0a,0x16,0x24,0x34,0xe1,0x25,0xf1,0x17,0x18,0x19,0x1a,0x26,
  0x27,0x28,0x29,0x2a,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,
  0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,
  0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x82,0x83,0x84,0x85,0x86,0x87,
  0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,
  0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,
  0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,
  0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,
  0xf9,0xfa,
];

// prettier-ignore
const YQT = [
  16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,
  14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,
  49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99,
];
// prettier-ignore
const UVQT = [
  17,18,24,47,99,99,99,99,18,21,26,66,99,99,99,99,24,26,56,99,99,99,99,99,
  47,66,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,
  99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,
];
// prettier-ignore
const AASF = [
  1.0, 1.387039845, 1.306562965, 1.175875602,
  1.0, 0.785694958, 0.5411961, 0.275899379,
];

/** A Huffman/value bit pattern: [code, numberOfBits]. */
type BitCode = [number, number];

/**
 * Encode 32-bit ARGB pixel data to a baseline JFIF JPEG.
 *
 * @param width   image width in pixels
 * @param height  image height in pixels
 * @param argb    ARGB bytes, 4 per pixel, row-major (length must be width*height*4)
 * @param quality JPEG quality 1–100 (clamped); higher = larger, better quality
 * @returns the complete JPEG byte stream (SOI…EOI), ready to embed in
 *          DefineBitsJPEG2/JPEG3.
 */
export function encodeJpeg(
  width: number,
  height: number,
  argb: Uint8Array,
  quality: number
): Uint8Array {
  let q = Math.round(quality);
  if (!Number.isFinite(q)) q = 80;
  if (q < 1) q = 1;
  if (q > 100) q = 100;

  // --- quantization tables scaled by quality ---
  const sf = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
  const YTable = new Int32Array(64);
  const UVTable = new Int32Array(64);
  for (let i = 0; i < 64; i++) {
    let t = Math.floor((YQT[i] * sf + 50) / 100);
    YTable[ZIGZAG[i]] = t < 1 ? 1 : t > 255 ? 255 : t;
    t = Math.floor((UVQT[i] * sf + 50) / 100);
    UVTable[ZIGZAG[i]] = t < 1 ? 1 : t > 255 ? 255 : t;
  }
  const fdtblY = new Float32Array(64);
  const fdtblUV = new Float32Array(64);
  {
    let k = 0;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        fdtblY[k] = 1.0 / (YTable[ZIGZAG[k]] * AASF[row] * AASF[col] * 8.0);
        fdtblUV[k] = 1.0 / (UVTable[ZIGZAG[k]] * AASF[row] * AASF[col] * 8.0);
        k++;
      }
    }
  }

  // --- Huffman tables ---
  function computeHuffman(nrcodes: number[], values: number[]): BitCode[] {
    let code = 0;
    let k = 0;
    const HT: BitCode[] = [];
    for (let bits = 1; bits <= 16; bits++) {
      for (let j = 1; j <= nrcodes[bits]; j++) {
        HT[values[k]] = [code, bits];
        code++;
        k++;
      }
      code <<= 1;
    }
    return HT;
  }
  const YDC_HT = computeHuffman(STD_DC_LUMINANCE_NRCODES, STD_DC_LUMINANCE_VALUES);
  const UVDC_HT = computeHuffman(STD_DC_CHROMINANCE_NRCODES, STD_DC_CHROMINANCE_VALUES);
  const YAC_HT = computeHuffman(STD_AC_LUMINANCE_NRCODES, STD_AC_LUMINANCE_VALUES);
  const UVAC_HT = computeHuffman(STD_AC_CHROMINANCE_NRCODES, STD_AC_CHROMINANCE_VALUES);

  // --- category / bit-code tables for signed coefficient values ---
  const category = new Int32Array(65535);
  const bitcode: BitCode[] = new Array(65535);
  {
    let nrlower = 1;
    let nrupper = 2;
    for (let cat = 1; cat <= 15; cat++) {
      for (let nr = nrlower; nr < nrupper; nr++) {
        category[32767 + nr] = cat;
        bitcode[32767 + nr] = [nr, cat];
      }
      for (let nrneg = -(nrupper - 1); nrneg <= -nrlower; nrneg++) {
        category[32767 + nrneg] = cat;
        bitcode[32767 + nrneg] = [nrupper - 1 + nrneg, cat];
      }
      nrlower <<= 1;
      nrupper <<= 1;
    }
  }

  // --- bit/byte output ---
  const out: number[] = [];
  let bytenew = 0;
  let bytepos = 7;
  const writeByte = (v: number): void => {
    out.push(v & 0xff);
  };
  const writeWord = (v: number): void => {
    out.push((v >> 8) & 0xff, v & 0xff);
  };
  const writeBits = (bs: BitCode): void => {
    const value = bs[0];
    let posval = bs[1] - 1;
    while (posval >= 0) {
      if (value & (1 << posval)) bytenew |= 1 << bytepos;
      posval--;
      bytepos--;
      if (bytepos < 0) {
        if (bytenew === 0xff) {
          writeByte(0xff);
          writeByte(0);
        } else {
          writeByte(bytenew);
        }
        bytepos = 7;
        bytenew = 0;
      }
    }
  };

  // --- forward DCT + quantization, returns zigzag-ordered coefficients ---
  const outDU = new Int32Array(64);
  function fDCTQuant(data: Float32Array, fdtbl: Float32Array): Int32Array {
    let d0, d1, d2, d3, d4, d5, d6, d7;
    for (let i = 0; i < 8; i++) {
      const o = i * 8;
      d0 = data[o]; d1 = data[o + 1]; d2 = data[o + 2]; d3 = data[o + 3];
      d4 = data[o + 4]; d5 = data[o + 5]; d6 = data[o + 6]; d7 = data[o + 7];
      const t0 = d0 + d7, t7 = d0 - d7;
      const t1 = d1 + d6, t6 = d1 - d6;
      const t2 = d2 + d5, t5 = d2 - d5;
      const t3 = d3 + d4, t4 = d3 - d4;
      let t10 = t0 + t3; const t13 = t0 - t3;
      const t11 = t1 + t2, t12 = t1 - t2;
      data[o] = t10 + t11;
      data[o + 4] = t10 - t11;
      const z1 = (t12 + t13) * 0.707106781;
      data[o + 2] = t13 + z1;
      data[o + 6] = t13 - z1;
      t10 = t4 + t5;
      const t11b = t5 + t6, t12b = t6 + t7;
      const z5 = (t10 - t12b) * 0.382683433;
      const z2 = 0.541196100 * t10 + z5;
      const z4 = 1.306562965 * t12b + z5;
      const z3 = t11b * 0.707106781;
      const z11 = t7 + z3, z13 = t7 - z3;
      data[o + 5] = z13 + z2;
      data[o + 3] = z13 - z2;
      data[o + 1] = z11 + z4;
      data[o + 7] = z11 - z4;
    }
    for (let i = 0; i < 8; i++) {
      d0 = data[i]; d1 = data[i + 8]; d2 = data[i + 16]; d3 = data[i + 24];
      d4 = data[i + 32]; d5 = data[i + 40]; d6 = data[i + 48]; d7 = data[i + 56];
      const t0 = d0 + d7, t7 = d0 - d7;
      const t1 = d1 + d6, t6 = d1 - d6;
      const t2 = d2 + d5, t5 = d2 - d5;
      const t3 = d3 + d4, t4 = d3 - d4;
      let t10 = t0 + t3; const t13 = t0 - t3;
      const t11 = t1 + t2, t12 = t1 - t2;
      data[i] = t10 + t11;
      data[i + 32] = t10 - t11;
      const z1 = (t12 + t13) * 0.707106781;
      data[i + 16] = t13 + z1;
      data[i + 48] = t13 - z1;
      t10 = t4 + t5;
      const t11b = t5 + t6, t12b = t6 + t7;
      const z5 = (t10 - t12b) * 0.382683433;
      const z2 = 0.541196100 * t10 + z5;
      const z4 = 1.306562965 * t12b + z5;
      const z3 = t11b * 0.707106781;
      const z11 = t7 + z3, z13 = t7 - z3;
      data[i + 40] = z13 + z2;
      data[i + 24] = z13 - z2;
      data[i + 8] = z11 + z4;
      data[i + 56] = z11 - z4;
    }
    for (let i = 0; i < 64; i++) {
      const v = data[i] * fdtbl[i];
      outDU[ZIGZAG[i]] = v > 0 ? ((v + 0.5) | 0) : ((v - 0.5) | 0);
    }
    return outDU;
  }

  // --- encode one 8x8 data unit, returns the new DC predictor ---
  function processDU(
    data: Float32Array,
    fdtbl: Float32Array,
    DC: number,
    HTDC: BitCode[],
    HTAC: BitCode[]
  ): number {
    const EOB = HTAC[0x00];
    const M16zeroes = HTAC[0xf0];
    const du = fDCTQuant(data, fdtbl);
    const Diff = du[0] - DC;
    const newDC = du[0];
    if (Diff === 0) {
      writeBits(HTDC[0]);
    } else {
      const pos = 32767 + Diff;
      writeBits(HTDC[category[pos]]);
      writeBits(bitcode[pos]);
    }
    let end0pos = 63;
    while (end0pos > 0 && du[end0pos] === 0) end0pos--;
    if (end0pos === 0) {
      writeBits(EOB);
      return newDC;
    }
    let i = 1;
    while (i <= end0pos) {
      let nrzeroes = 0;
      while (du[i] === 0 && i <= end0pos) {
        nrzeroes++;
        i++;
      }
      if (nrzeroes >= 16) {
        const lng = nrzeroes >> 4;
        for (let n = 1; n <= lng; n++) writeBits(M16zeroes);
        nrzeroes = nrzeroes & 0xf;
      }
      const pos = 32767 + du[i];
      writeBits(HTAC[(nrzeroes << 4) + category[pos]]);
      writeBits(bitcode[pos]);
      i++;
    }
    if (end0pos !== 63) writeBits(EOB);
    return newDC;
  }

  // --- header markers ---
  writeWord(0xffd8); // SOI
  // APP0 / JFIF
  writeWord(0xffe0);
  writeWord(16);
  writeByte(0x4a); writeByte(0x46); writeByte(0x49); writeByte(0x46); writeByte(0); // "JFIF\0"
  writeByte(1); writeByte(1); // version 1.1
  writeByte(0); // density units
  writeWord(1); writeWord(1); // x/y density
  writeByte(0); writeByte(0); // thumbnail w/h
  // DQT
  writeWord(0xffdb);
  writeWord(132);
  writeByte(0);
  for (let i = 0; i < 64; i++) writeByte(YTable[i]);
  writeByte(1);
  for (let i = 0; i < 64; i++) writeByte(UVTable[i]);
  // SOF0
  writeWord(0xffc0);
  writeWord(17);
  writeByte(8);
  writeWord(height);
  writeWord(width);
  writeByte(3);
  writeByte(1); writeByte(0x11); writeByte(0);
  writeByte(2); writeByte(0x11); writeByte(1);
  writeByte(3); writeByte(0x11); writeByte(1);
  // DHT
  {
    let lenYDC = 0, lenYAC = 0, lenUVDC = 0, lenUVAC = 0;
    for (let i = 1; i <= 16; i++) lenYDC += STD_DC_LUMINANCE_NRCODES[i];
    for (let i = 1; i <= 16; i++) lenYAC += STD_AC_LUMINANCE_NRCODES[i];
    for (let i = 1; i <= 16; i++) lenUVDC += STD_DC_CHROMINANCE_NRCODES[i];
    for (let i = 1; i <= 16; i++) lenUVAC += STD_AC_CHROMINANCE_NRCODES[i];
    writeWord(0xffc4);
    writeWord(2 + (1 + 16 + lenYDC) + (1 + 16 + lenYAC) + (1 + 16 + lenUVDC) + (1 + 16 + lenUVAC));
    writeByte(0);
    for (let i = 1; i <= 16; i++) writeByte(STD_DC_LUMINANCE_NRCODES[i]);
    for (let i = 0; i < lenYDC; i++) writeByte(STD_DC_LUMINANCE_VALUES[i]);
    writeByte(0x10);
    for (let i = 1; i <= 16; i++) writeByte(STD_AC_LUMINANCE_NRCODES[i]);
    for (let i = 0; i < lenYAC; i++) writeByte(STD_AC_LUMINANCE_VALUES[i]);
    writeByte(1);
    for (let i = 1; i <= 16; i++) writeByte(STD_DC_CHROMINANCE_NRCODES[i]);
    for (let i = 0; i < lenUVDC; i++) writeByte(STD_DC_CHROMINANCE_VALUES[i]);
    writeByte(0x11);
    for (let i = 1; i <= 16; i++) writeByte(STD_AC_CHROMINANCE_NRCODES[i]);
    for (let i = 0; i < lenUVAC; i++) writeByte(STD_AC_CHROMINANCE_VALUES[i]);
  }
  // SOS
  writeWord(0xffda);
  writeWord(12);
  writeByte(3);
  writeByte(1); writeByte(0);
  writeByte(2); writeByte(0x11);
  writeByte(3); writeByte(0x11);
  writeByte(0); writeByte(0x3f); writeByte(0);

  // --- scan ---
  let DCY = 0, DCU = 0, DCV = 0;
  bytenew = 0;
  bytepos = 7;
  const YDU = new Float32Array(64);
  const UDU = new Float32Array(64);
  const VDU = new Float32Array(64);
  const w = width, h = height;
  for (let y = 0; y < h; y += 8) {
    for (let x = 0; x < w; x += 8) {
      for (let row = 0; row < 8; row++) {
        const yy = y + row < h ? y + row : h - 1;
        for (let col = 0; col < 8; col++) {
          const xx = x + col < w ? x + col : w - 1;
          const p = (yy * w + xx) * 4;
          // ARGB byte order: [A, R, G, B]
          const r = argb[p + 1];
          const g = argb[p + 2];
          const b = argb[p + 3];
          const pos = row * 8 + col;
          YDU[pos] = 0.299 * r + 0.587 * g + 0.114 * b - 128.0;
          UDU[pos] = -0.16874 * r - 0.33126 * g + 0.5 * b;
          VDU[pos] = 0.5 * r - 0.41869 * g - 0.08131 * b;
        }
      }
      DCY = processDU(YDU, fdtblY, DCY, YDC_HT, YAC_HT);
      DCU = processDU(UDU, fdtblUV, DCU, UVDC_HT, UVAC_HT);
      DCV = processDU(VDU, fdtblUV, DCV, UVDC_HT, UVAC_HT);
    }
  }

  // flush remaining bits, then EOI
  if (bytepos >= 0) {
    writeBits([(1 << (bytepos + 1)) - 1, bytepos + 1]);
  }
  writeWord(0xffd9); // EOI

  return Uint8Array.from(out);
}

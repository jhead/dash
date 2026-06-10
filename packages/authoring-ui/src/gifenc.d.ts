/**
 * Minimal type declarations for the `gifenc` package.
 * (No official @types/gifenc exists on npm.)
 */
declare module "gifenc" {
  /**
   * A color palette: array of [R, G, B] tuples.
   */
  export type Palette = [number, number, number][];

  export interface WriteFrameOptions {
    /** Color palette — required on the first frame. */
    palette?: Palette;
    /**
     * Frame delay in milliseconds.
     * gifenc divides by 10 internally to produce GIF centiseconds.
     */
    delay?: number;
    /**
     * Loop count: 0 = loop forever, -1 = no loop extension.
     * Only relevant on the first frame (writes NETSCAPE2.0 extension).
     */
    repeat?: number;
    /** Color depth (bits per pixel). Default: 8 */
    colorDepth?: number;
    /** Whether to use a transparent color. Default: false */
    transparent?: boolean;
    /** Palette index to use for transparent pixels. Default: 0 */
    transparentIndex?: number;
    /** Disposal method. Default: -1 (do not dispose) */
    dispose?: number;
  }

  export interface GIFEncoderInstance {
    /** Write a single frame. */
    writeFrame(
      indexedPixels: Uint8Array,
      width: number,
      height: number,
      options?: WriteFrameOptions
    ): void;
    /** Write the GIF trailer byte. Must be called after all frames. */
    finish(): void;
    /** Return a copy of the encoded bytes. */
    bytes(): Uint8Array;
    /** Return a view into the encoded bytes (no copy). */
    bytesView(): Uint8Array;
    /** The underlying ArrayBuffer. */
    readonly buffer: ArrayBuffer;
  }

  /** Create a new GIF encoder instance. */
  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): GIFEncoderInstance;

  /**
   * Quantize RGBA pixel data down to `maxColors` colors.
   * @param data   RGBA Uint8Array (length = width * height * 4)
   * @param maxColors  Maximum palette size (1–256)
   * @returns  Array of [R, G, B] color tuples
   */
  export function quantize(
    data: Uint8Array | Uint8ClampedArray,
    maxColors: number
  ): Palette;

  /**
   * Map each pixel to the nearest palette index.
   * @param data    RGBA Uint8Array
   * @param palette Palette returned by `quantize`
   * @returns Indexed pixel data (one byte per pixel)
   */
  export function applyPalette(
    data: Uint8Array | Uint8ClampedArray,
    palette: Palette
  ): Uint8Array;
}

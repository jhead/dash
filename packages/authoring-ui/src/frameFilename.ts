/** Zero-padded export filename for a frame index, e.g. frame_0001.png. */
export function frameFilename(frameIndex: number, format: "png" | "jpeg"): string {
  const n = String(frameIndex + 1).padStart(4, "0");
  return `frame_${n}.${format}`;
}

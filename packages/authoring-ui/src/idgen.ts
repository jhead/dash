/**
 * Monotonic id/name generators for new editor objects. Module-level counters so
 * ids stay unique across a session regardless of which Shell handler/hook mints
 * them (extracted from Shell so the handler hooks can share them).
 */
let _instanceCounter = 0;
export function nextInstanceId(): string {
  return `inst-${++_instanceCounter}-${Date.now().toString(36)}`;
}

let _groupCounter = 0;
export function nextGroupName(): string {
  return `Group ${++_groupCounter}`;
}

let _textObjCounter = 0;
export function nextTextId(): string {
  return `text-${++_textObjCounter}-${Date.now().toString(36)}`;
}

let _bitmapObjCounter = 0;
export function nextBitmapId(): string {
  return `bmp-${++_bitmapObjCounter}-${Date.now().toString(36)}`;
}

let _videoObjCounter = 0;
export function nextVideoId(): string {
  return `video-${++_videoObjCounter}-${Date.now().toString(36)}`;
}

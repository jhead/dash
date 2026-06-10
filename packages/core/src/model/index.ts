// Types
export type {
  BitmapItem,
  ButtonAction,
  ComponentItem,
  DocumentProperties,
  EaseCurve,
  FlashDocument,
  FontItem,
  Frame,
  GridSettings,
  Guide,
  Layer,
  LayerType,
  LabelType,
  Library,
  LibraryFolder,
  LibraryItem,
  LibraryItemType,
  RulerUnits,
  Scale9Grid,
  Scene,
  SoundItem,
  SoundLinkage,
  Symbol,
  SymbolLinkage,
  SymbolType,
  Timeline,
  TweenType,
  VideoItem,
} from "./types.js";

// Document
export { createDocument, createDocumentProperties, createGridSettings } from "./document.js";

// Scene
export { createScene } from "./scene.js";

// Timeline / Layer / Frame
export {
  createTimeline,
  createLayer,
  createFrame,
  addLayer,
  deleteLayer,
  duplicateLayer,
  moveLayer,
  setLayerVisible,
  setLayerLocked,
  renameLayer,
  setLayerType,
  layerFrameCount,
  insertFrame,
  insertKeyframe,
  insertBlankKeyframe,
  removeFrame,
  clearKeyframe,
  setFrameLabel,
  setMotionTween,
  setShapeTween,
  clearTween,
  setFrameScript,
  setSoundOnFrame,
  addDisplayObject,
  removeDisplayObject,
  updateDisplayObject,
  convertToKeyframes,
  reverseFrames,
} from "./timeline.js";

// Document mutations
export {
  addScene,
  removeScene,
  renameScene,
  reorderScenes,
  moveScene,
  duplicateScene,
  updateDocumentProperties,
  setDocumentWidth,
  setDocumentHeight,
  setFrameRate,
  setBackgroundColor,
  setRulerUnits,
  updateGridSettings,
  addGuide,
  removeGuide,
  moveGuide,
} from "./document-mutations.js";

// Frame span and keyframe query helpers (pure, no mutations)
export {
  getFrameAtIndex,
  getFrameSpan,
  getAllKeyframes,
  getKeyframeAt,
  getNextKeyframe,
  getPrevKeyframe,
  copyFrames,
  pasteFrames,
} from "./frame-utils.js";

// Timeline query helpers (pure, no mutations)
export type { TweenSpan } from "./timeline-query.js";
export {
  getGoverningKeyframe,
  getDisplayObjectsAtFrame,
  getKeyframeIndices,
  getFrameCount,
  findLayerById,
  findGuideLayerAbove,
  getFramesBetween,
  getTweenedFrame,
  getTweenSpans,
  getTimelineDuration,
  getSceneDuration,
} from "./timeline-query.js";

// Instance / display-object property mutation helpers (Frame-level)
export type { InstanceTransform } from "./instance-mutations.js";
export {
  setInstanceProperty,
  setInstanceTransform,
} from "./instance-mutations.js";

// Display z-order
export {
  moveDisplayObjectUp,
  moveDisplayObjectDown,
  moveDisplayObjectToTop,
  moveDisplayObjectToBottom,
} from "./display-order.js";

// Layer reorder
export {
  moveLayerUp,
  moveLayerDown,
  moveLayerToTop,
  moveLayerToBottom,
  moveLayerBefore,
} from "./layer-reorder.js";

// Layer visibility / outline mode
export {
  setLayerOutlineMode,
  getVisibleLayers,
  setAllLayersVisible,
  setAllLayersLocked,
} from "./layer-visibility.js";

// Library
export {
  createLibrary,
  createLibraryFolder,
  createSymbol,
  createSymbolLinkage,
  createBitmap,
  createSound,
  createVideo,
  createFont,
  createComponent,
  addLibraryItem,
  removeLibraryItem,
  getLibraryItem,
  createSymbolInLibrary,
  renameLibraryItem,
  addLibraryFolder,
  removeLibraryFolder,
  renameLibraryFolder,
  getFoldersInFolder,
  findLibraryItem,
  getLibraryItemsByType,
} from "./library.js";

// Layer pairing helpers
export type { LayerPairingIssue } from "./layer-pairing.js";
export {
  isGuidedLayer,
  isMaskedLayer,
  validateLayerPairing,
  getGuideLayerFor,
  getMaskLayerFor,
  addGuideLayerAbove,
  addMaskLayerAbove,
} from "./layer-pairing.js";

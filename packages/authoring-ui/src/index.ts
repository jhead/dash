export { MenuBar } from "./MenuBar";
export type { MenuBarProps } from "./MenuBar";
export { useFileActions } from "./hooks/useFileActions";
export { EditBar } from "./EditBar";
export type { EditBarProps } from "./EditBar";
export { ToolsPanel } from "./ToolsPanel";
export type { ToolsPanelProps } from "./ToolsPanel";
export type { ToolId, ToolState } from "./tools/types";
export { StageArea } from "./StageArea";
export type { StageAreaProps, ViewMode } from "./StageArea";
export { Timeline } from "./Timeline";
export { PropertiesPanel } from "./PropertiesPanel";
export type { PlacedInstance, DocumentInfo, PropertiesPanelProps } from "./PropertiesPanel";
export { LibraryPanel } from "./LibraryPanel";
export type { LibraryPanelProps } from "./LibraryPanel";
export { ClassesPanel } from "./ClassesPanel";
export type { ClassesPanelProps } from "./ClassesPanel";
export { StatusBar } from "./StatusBar";
export type { StatusBarProps } from "./StatusBar";
export { Shell } from "./Shell";
export { useHistory } from "./hooks/useHistory";
export type { UseHistoryResult } from "./hooks/useHistory";

// Swappable theme system (task 1265): frozen flash8Theme tokens/helpers + the swap API
// (setThemeMode / activeTheme / getThemeColor / subscribeTheme), value-sets
// (flash8Light / flash8Dark), and the optional ThemeProvider / useTheme. DEFAULT = light.
export * from "./theme/index.js";

// Preferences (localStorage-backed): UI scale + Agent Chat key/model (task 1276 P1).
export {
  loadPreferences,
  savePreferences,
  usePreferences,
  DEFAULT_PREFERENCES,
  UI_SCALE_MIN,
  UI_SCALE_MAX,
} from "./preferences.js";
export type { Preferences, UsePreferences } from "./preferences.js";

// Agent Chat foundation (task 1276 P1): client-side OpenRouter client + settings.
export * from "./agentchat/index.js";

// AS2 class virtual-filesystem (task 1300 P2): cross-platform backends
// (OPFS / IndexedDB fallback / Tauri native FS disk mirror) + platform factory,
// re-exporting the pure ClassVfs interface + hydrate/sync from @flash/core.
export * from "./vfs/index.js";

// Optional P2P multiplayer (task 1343 P0): opt-in @flash/collab adapter that
// projects the document store onto a Y.Doc. Default OFF — nothing here runs
// unless `attachCollab` is explicitly called.
export { attachCollab, storeAsDocSource } from "./store/collabAdapter.js";
export type { AttachCollabResult } from "./store/collabAdapter.js";
export { COLLAB_ENABLED_DEFAULT } from "./store/collabFlag.js";

// Optional P2P multiplayer transport (task 1344 P1): the y-webrtc provider +
// shareable `#room=…&k=…` link + opt-in start/join flow + signaling config.
// Still default OFF — a provider/network/awareness is created ONLY when
// `startCollab` / `joinCollab` is explicitly called.
export {
  type CollabLink,
  generateCollabLink,
  parseCollabLink,
  collabLinkToFragment,
  buildShareUrl,
  DEFAULT_SIGNALING_SERVERS,
  parseSignalingServers,
  getSignalingServers,
  setSignalingServers,
  type CollabSession,
  type StartCollabOptions,
  startCollab,
  joinCollab,
} from "./collab/index.js";

// Collab P2 awareness/presence (task 1345): live cursors, selection outlines,
// presence avatars, follow-a-peer, "editing this symbol" library badge. Inert
// solo — these only render/subscribe inside a live session.
export {
  type CollabUser,
  type AwarenessState,
  type PeerPresence,
  type PeerSelection,
  type PeerEditContext,
  type AwarenessController,
  type CollabContextValue,
  PRESENCE_COLORS,
  getLocalUser,
  setLocalUser,
  uiStateToAwareness,
  asPeerPresence,
  symbolEditorsFromPeers,
  attachAwareness,
  readPeers,
  CollabProvider,
  useCollab,
  usePeers,
  RemoteCursorsOverlay,
  PresenceAvatars,
} from "./collab/index.js";

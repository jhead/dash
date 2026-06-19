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
export { StatusBar } from "./StatusBar";
export type { StatusBarProps } from "./StatusBar";
export { Shell } from "./Shell";
export { useHistory } from "./hooks/useHistory";
export type { UseHistoryResult } from "./hooks/useHistory";

// Swappable theme system (task 1265): frozen flash8Theme tokens/helpers + the swap API
// (setThemeMode / activeTheme / getThemeColor / subscribeTheme), value-sets
// (flash8Light / flash8Dark), and the optional ThemeProvider / useTheme. DEFAULT = light.
export * from "./theme/index.js";

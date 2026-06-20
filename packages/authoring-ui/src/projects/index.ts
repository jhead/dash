// Browser-persistent projects (task 1310): IndexedDB-backed project store +
// debounced autosave so F5 restores in-progress work, named Save As slots, and
// an Open Recent list.
//
//   * projectStore        — IndexedDB store (serialized `.fla` bytes + metadata)
//   * recentProjects      — localStorage active-name + recent-list (hygiene)
//   * autosaveController   — framework-free debounced/superseding autosave engine
//   * projectSession      — Save As / Save / Open / restore-on-load orchestration
//   * useProjectActions   — React adapter wiring it all to the document store

export {
  ProjectStore,
  getProjectStore,
  isProjectStoreAvailable,
  ProjectQuotaError,
  PROJECT_SCHEMA_VERSION,
  CURRENT_WORKING_KEY,
} from "./projectStore.js";
export type {
  ProjectMeta,
  ProjectRecord,
  ProjectStoreOptions,
} from "./projectStore.js";

export {
  loadRecentProjects,
  saveRecentProjects,
  touchRecentProject,
  removeRecentProject,
  clearActiveProject,
  RECENT_PROJECTS_CAP,
  RECENT_PROJECTS_SCHEMA_VERSION,
  EMPTY_RECENT_STATE,
} from "./recentProjects.js";
export type { RecentEntry, RecentProjectsState } from "./recentProjects.js";

export { AutosaveController } from "./autosaveController.js";
export type { AutosaveDeps, AutosaveTimers, AutosavePayload } from "./autosaveController.js";

export {
  restoreOnLoad,
  saveNamed,
  openNamed,
  autosaveCurrentWorking,
  sanitizeProjectName,
} from "./projectSession.js";
export type { RestoreResult } from "./projectSession.js";

export { useProjectActions } from "./useProjectActions.js";
export type {
  UseProjectActionsDeps,
  UseProjectActionsResult,
} from "./useProjectActions.js";

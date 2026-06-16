export type {
  CommandContext,
  CommandServices,
  EditorCommand,
  EditorCommandAny,
} from "./types.js";
export { createCommandRegistry } from "./registry.js";
export type { CommandRegistry } from "./registry.js";

import { createCommandRegistry, type CommandRegistry } from "./registry.js";
import { historyCommands } from "./history.js";
import { timelineCommands } from "./timeline.js";
import { editCommands } from "./edit.js";
import { editorCommands } from "./editor.js";
import { viewCommands } from "./view.js";
import { playbackCommands } from "./playback.js";

/**
 * Every migrated command, grouped by domain. More modules are appended here as
 * handlers move off Shell (shape/library/transform/scene/file/…).
 */
export const ALL_COMMANDS = [
  ...historyCommands,
  ...timelineCommands,
  ...editCommands,
  ...editorCommands,
  ...viewCommands,
  ...playbackCommands,
];

/** Build a registry pre-populated with all commands. */
export function createPopulatedRegistry(): CommandRegistry {
  const registry = createCommandRegistry();
  registry.registerAll(ALL_COMMANDS);
  return registry;
}

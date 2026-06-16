import type { CommandContext, EditorCommandAny } from "./types.js";

/**
 * The single source of truth mapping command id → command. All four dispatch
 * surfaces (menu, keyboard, agent, JSFL) resolve operations through one of
 * these instead of re-implementing logic.
 */
export interface CommandRegistry {
  register: (cmd: EditorCommandAny) => void;
  registerAll: (cmds: EditorCommandAny[]) => void;
  get: (id: string) => EditorCommandAny | undefined;
  has: (id: string) => boolean;
  all: () => EditorCommandAny[];
  /** Resolve a command's enabled state (true when it has no predicate). */
  isEnabled: (id: string, ctx: CommandContext) => boolean;
  /**
   * Run a command by id. No-ops (returns undefined) when the command is
   * disabled; throws when the id is unknown so wiring mistakes surface loudly.
   */
  dispatch: (id: string, ctx: CommandContext, args?: unknown) => void | Promise<void>;
}

export function createCommandRegistry(): CommandRegistry {
  const map = new Map<string, EditorCommandAny>();

  const add = (cmd: EditorCommandAny): void => {
    if (map.has(cmd.id)) throw new Error(`Duplicate command id: ${cmd.id}`);
    map.set(cmd.id, cmd);
  };

  return {
    register: add,
    registerAll: (cmds) => cmds.forEach(add),
    get: (id) => map.get(id),
    has: (id) => map.has(id),
    all: () => [...map.values()],
    isEnabled: (id, ctx) => {
      const cmd = map.get(id);
      if (!cmd) return false;
      return cmd.isEnabled ? cmd.isEnabled(ctx) : true;
    },
    dispatch: (id, ctx, args) => {
      const cmd = map.get(id);
      if (!cmd) throw new Error(`Unknown command: ${id}`);
      if (cmd.isEnabled && !cmd.isEnabled(ctx)) return undefined;
      return cmd.run(ctx, args as never);
    },
  };
}

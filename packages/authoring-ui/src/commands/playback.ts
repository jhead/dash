import type { EditorCommand } from "./types.js";

/**
 * Playback owns a RAF loop + refs that are inherently component-local, so these
 * commands delegate to Shell-provided services. They still give menu/keyboard/
 * agent one dispatch surface for play/stop.
 */
export const playbackCommands: EditorCommand[] = [
  {
    id: "playback.play",
    label: "Play",
    category: "control",
    run: (ctx) => ctx.services.startPlayback?.(),
  },
  {
    id: "playback.stop",
    label: "Stop",
    category: "control",
    run: (ctx) => ctx.services.stopPlayback?.(),
  },
  {
    id: "playback.toggle",
    label: "Play/Stop",
    category: "control",
    run: (ctx) => {
      const ui = ctx.ui.getState();
      if (ui.isPlaying) ctx.services.stopPlayback?.();
      else ctx.services.startPlayback?.();
    },
  },
];

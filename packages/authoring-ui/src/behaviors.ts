// ---------------------------------------------------------------------------
// behaviors.ts — built-in AS2 snippet registry for the Behaviors panel
// ---------------------------------------------------------------------------

export interface Behavior {
  id: string;
  category: "Movie Clip" | "Sound" | "Embedded Video" | "Web";
  name: string;
  description: string;
  /** Parameter keys this behavior accepts (used to build the params form). */
  params: ReadonlyArray<{ key: string; label: string; placeholder?: string }>;
  /** Generate the AS2 source string from the supplied param values. */
  generate(params: Record<string, string>): string;
}

export const BEHAVIORS: Behavior[] = [
  // -------------------------------------------------------------------------
  // Movie Clip category
  // -------------------------------------------------------------------------
  {
    id: "goto-and-play",
    category: "Movie Clip",
    name: "Goto and Play at frame or label",
    description: "Sends a Movie Clip to a specified frame and plays from that point.",
    params: [
      { key: "target", label: "Target", placeholder: "_root" },
      { key: "frame", label: "Frame or label", placeholder: "1" },
    ],
    generate: ({ target, frame }) =>
      `${target || "_root"}.gotoAndPlay(${isNaN(Number(frame)) || frame === "" ? `"${frame || "1"}"` : frame});`,
  },
  {
    id: "goto-and-stop",
    category: "Movie Clip",
    name: "Goto and Stop at frame or label",
    description: "Sends a Movie Clip to a specified frame and stops.",
    params: [
      { key: "target", label: "Target", placeholder: "_root" },
      { key: "frame", label: "Frame or label", placeholder: "1" },
    ],
    generate: ({ target, frame }) =>
      `${target || "_root"}.gotoAndStop(${isNaN(Number(frame)) || frame === "" ? `"${frame || "1"}"` : frame});`,
  },
  {
    id: "play",
    category: "Movie Clip",
    name: "Play",
    description: "Plays a Movie Clip.",
    params: [{ key: "target", label: "Target", placeholder: "_root" }],
    generate: ({ target }) => `${target || "_root"}.play();`,
  },
  {
    id: "stop",
    category: "Movie Clip",
    name: "Stop",
    description: "Stops a Movie Clip.",
    params: [{ key: "target", label: "Target", placeholder: "_root" }],
    generate: ({ target }) => `${target || "_root"}.stop();`,
  },
  {
    id: "load-graphic",
    category: "Movie Clip",
    name: "Load Graphic",
    description: "Loads an external SWF or image into a target clip.",
    params: [
      { key: "url", label: "URL", placeholder: "image.jpg" },
      { key: "target", label: "Target", placeholder: "_level1" },
    ],
    generate: ({ url, target }) =>
      `loadMovie("${url || ""}", "${target || "_level1"}");`,
  },
  {
    id: "unload-movie",
    category: "Movie Clip",
    name: "Unload Movie",
    description: "Unloads a previously loaded movie from a target level or clip.",
    params: [{ key: "target", label: "Target", placeholder: "_level1" }],
    generate: ({ target }) => `unloadMovie("${target || "_level1"}");`,
  },

  // -------------------------------------------------------------------------
  // Sound category
  // -------------------------------------------------------------------------
  {
    id: "stop-all-sounds",
    category: "Sound",
    name: "Stop All Sounds",
    description: "Stops all currently playing sounds.",
    params: [],
    generate: () => "stopAllSounds();",
  },

  // -------------------------------------------------------------------------
  // Embedded Video category
  // -------------------------------------------------------------------------
  {
    id: "video-play",
    category: "Embedded Video",
    name: "Play Video",
    description: "Plays the embedded video in a specified Video instance.",
    params: [{ key: "target", label: "Video instance name", placeholder: "myVideo" }],
    generate: ({ target }) => `${target || "myVideo"}.play();`,
  },
  {
    id: "video-pause",
    category: "Embedded Video",
    name: "Pause Video",
    description: "Pauses the embedded video in a specified Video instance.",
    params: [{ key: "target", label: "Video instance name", placeholder: "myVideo" }],
    generate: ({ target }) => `${target || "myVideo"}.pause();`,
  },
  {
    id: "video-stop",
    category: "Embedded Video",
    name: "Stop Video",
    description: "Stops and closes the embedded video in a specified Video instance.",
    params: [{ key: "target", label: "Video instance name", placeholder: "myVideo" }],
    generate: ({ target }) => `${target || "myVideo"}.close();`,
  },
  {
    id: "video-seek",
    category: "Embedded Video",
    name: "Seek to Time",
    description: "Seeks the embedded video to a specified time (in seconds).",
    params: [
      { key: "target", label: "Video instance name", placeholder: "myVideo" },
      { key: "time", label: "Time (seconds)", placeholder: "0" },
    ],
    generate: ({ target, time }) => `${target || "myVideo"}.seek(${time || 0});`,
  },
  {
    id: "video-fast-forward",
    category: "Embedded Video",
    name: "Fast Forward",
    description: "Fast-forwards the embedded video by 5 seconds.",
    params: [{ key: "target", label: "Video instance name", placeholder: "myVideo" }],
    generate: ({ target }) => {
      const t = target || "myVideo";
      return `var _nc = ${t};\n_nc.seek(_nc.time + 5);`;
    },
  },
  {
    id: "video-rewind",
    category: "Embedded Video",
    name: "Rewind",
    description: "Rewinds the embedded video by 5 seconds.",
    params: [{ key: "target", label: "Video instance name", placeholder: "myVideo" }],
    generate: ({ target }) => {
      const t = target || "myVideo";
      return `var _nc = ${t};\n_nc.seek(Math.max(0, _nc.time - 5));`;
    },
  },
  {
    id: "video-show",
    category: "Embedded Video",
    name: "Show/Hide Video",
    description: "Shows or hides the Movie Clip containing the Video instance.",
    params: [
      { key: "target", label: "MC containing Video instance", placeholder: "myVideoMC" },
      { key: "visible", label: "Visible (true/false)", placeholder: "true" },
    ],
    generate: ({ target, visible }) =>
      `${target || "myVideoMC"}._visible = ${visible || "true"};`,
  },

  // -------------------------------------------------------------------------
  // Web category
  // -------------------------------------------------------------------------
  {
    id: "web-link",
    category: "Web",
    name: "Go to Web Page",
    description: "Opens a URL in a browser window.",
    params: [
      { key: "url", label: "URL", placeholder: "http://www.example.com" },
      { key: "window", label: "Window", placeholder: "_blank" },
    ],
    generate: ({ url, window: win }) =>
      `getURL("${url || "http://www.example.com"}", "${win || "_blank"}");`,
  },
];

/** All distinct categories present in the registry, in display order. */
export const BEHAVIOR_CATEGORIES: Array<Behavior["category"]> = [
  "Movie Clip",
  "Sound",
  "Embedded Video",
  "Web",
];

/** Return behaviors grouped by category. */
export function getBehaviorsByCategory(): Map<string, Behavior[]>;
/** Return behaviors for a specific category. */
export function getBehaviorsByCategory(category: string): Behavior[];
export function getBehaviorsByCategory(category?: string): Map<string, Behavior[]> | Behavior[] {
  if (category !== undefined) {
    return BEHAVIORS.filter((b) => b.category === category);
  }
  const map = new Map<string, Behavior[]>();
  for (const b of BEHAVIORS) {
    const arr = map.get(b.category) ?? [];
    arr.push(b);
    map.set(b.category, arr);
  }
  return map;
}

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
export function getBehaviorsByCategory(): Map<string, Behavior[]> {
  const map = new Map<string, Behavior[]>();
  for (const b of BEHAVIORS) {
    const arr = map.get(b.category) ?? [];
    arr.push(b);
    map.set(b.category, arr);
  }
  return map;
}

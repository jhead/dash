import React, { useMemo, useState } from "react";
import type {
  FlashDocument,
  LibraryItem,
  DisplayObject,
  Frame,
  Layer,
  Scene,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Explorer node types
// ---------------------------------------------------------------------------

export type ExplorerNode =
  | { type: "scene"; sceneId: string; label: string; children: ExplorerNode[] }
  | { type: "layer"; id: string; label: string; children: ExplorerNode[] }
  | { type: "frame"; frameIndex: number; label: string; children: ExplorerNode[] }
  | { type: "script"; code: string; frameIndex: number; label: string }
  | { type: "symbol-instance"; instanceName?: string; symbolId: string; label: string }
  | { type: "text"; content: string; label: string }
  | { type: "shape"; objId: string; label: string }
  | { type: "bitmap-instance"; libraryItemId: string; label: string }
  | { type: "video-instance"; videoItemId: string; label: string }
  | { type: "library-section"; label: string; children: ExplorerNode[] }
  | { type: "library-item"; item: LibraryItem; label: string; children: ExplorerNode[] };

// ---------------------------------------------------------------------------
// Filter categories
// ---------------------------------------------------------------------------

export interface ExplorerFilter {
  showText: boolean;
  showScripts: boolean;
  showMovieClips: boolean;
  showGraphics: boolean;
  showSounds: boolean;
  showBitmaps: boolean;
}

// ---------------------------------------------------------------------------
// Tree builder — pure function, exported for testing
// ---------------------------------------------------------------------------

function buildDisplayObjectNodes(objs: readonly DisplayObject[]): ExplorerNode[] {
  const nodes: ExplorerNode[] = [];
  for (const obj of objs) {
    switch (obj.type) {
      case "instance": {
        const label = obj.instanceName
          ? `Instance: ${obj.instanceName}`
          : `Symbol Instance`;
        nodes.push({
          type: "symbol-instance",
          instanceName: obj.instanceName,
          symbolId: obj.symbolId,
          label,
        });
        break;
      }
      case "text": {
        const preview = obj.text.length > 20 ? obj.text.slice(0, 20) + "..." : obj.text;
        nodes.push({
          type: "text",
          content: obj.text,
          label: preview || "(empty text)",
        });
        break;
      }
      case "shape":
      case "drawing-object": {
        nodes.push({
          type: "shape",
          objId: obj.id,
          label: obj.type === "drawing-object" ? "Drawing Object" : "Shape",
        });
        break;
      }
      case "bitmap": {
        nodes.push({
          type: "bitmap-instance",
          libraryItemId: obj.libraryItemId,
          label: "Bitmap",
        });
        break;
      }
      case "video": {
        nodes.push({
          type: "video-instance",
          videoItemId: obj.videoItemId,
          label: "Video",
        });
        break;
      }
      case "group": {
        // Flatten group children inline
        const childNodes = buildDisplayObjectNodes(obj.children);
        for (const child of childNodes) {
          nodes.push(child);
        }
        break;
      }
    }
  }
  return nodes;
}

function buildFrameNodes(frame: Frame): ExplorerNode[] {
  const children: ExplorerNode[] = [];

  // Frame script
  if (frame.script && frame.script.trim().length > 0) {
    const preview = frame.script.trim().split("\n")[0] ?? "";
    children.push({
      type: "script",
      code: frame.script,
      frameIndex: frame.index,
      label: `Script: ${preview.slice(0, 40)}${preview.length > 40 ? "..." : ""}`,
    });
  }

  // Display objects
  const objNodes = buildDisplayObjectNodes(frame.displayObjects);
  for (const node of objNodes) {
    children.push(node);
  }

  return children;
}

function buildLayerNodes(layer: Layer): ExplorerNode {
  const children: ExplorerNode[] = [];

  // Only include keyframes
  const keyframes = layer.frames.filter((f) => f.isKeyframe && !f.isEmpty);
  for (const frame of keyframes) {
    const frameChildren = buildFrameNodes(frame);
    if (frameChildren.length > 0) {
      children.push({
        type: "frame",
        frameIndex: frame.index,
        label: frame.label
          ? `Frame ${frame.index + 1}: ${frame.label}`
          : `Frame ${frame.index + 1}`,
        children: frameChildren,
      });
    }
  }

  return {
    type: "layer",
    id: layer.id,
    label: layer.name,
    children,
  };
}

function buildSceneNode(scene: Scene): ExplorerNode {
  const children: ExplorerNode[] = [];

  for (const layer of scene.timeline.layers) {
    const layerNode = buildLayerNodes(layer);
    children.push(layerNode);
  }

  return {
    type: "scene",
    sceneId: scene.id,
    label: scene.name,
    children,
  };
}

function buildLibraryNode(item: LibraryItem): ExplorerNode {
  if (item.itemType === "symbol") {
    // Recurse into symbol's timeline
    const children: ExplorerNode[] = [];
    for (const layer of item.timeline.layers) {
      const layerNode = buildLayerNodes(layer);
      children.push(layerNode);
    }
    return {
      type: "library-item",
      item,
      label: `${item.name} (${item.symbolType})`,
      children,
    };
  }

  return {
    type: "library-item",
    item,
    label: item.name,
    children: [],
  };
}

export function buildExplorerTree(doc: FlashDocument): ExplorerNode[] {
  const nodes: ExplorerNode[] = [];

  // Scene nodes
  for (const scene of doc.scenes) {
    nodes.push(buildSceneNode(scene));
  }

  // Library section
  const libraryChildren: ExplorerNode[] = [];
  for (const item of doc.library.items) {
    libraryChildren.push(buildLibraryNode(item));
  }

  if (libraryChildren.length > 0) {
    nodes.push({
      type: "library-section",
      label: "Library",
      children: libraryChildren,
    });
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Filter application — walk the tree and keep only nodes matching the filter
// ---------------------------------------------------------------------------

function nodeMatchesFilter(node: ExplorerNode, filter: ExplorerFilter): boolean {
  switch (node.type) {
    case "text":
      return filter.showText;
    case "script":
      return filter.showScripts;
    case "symbol-instance":
      // We'd need library lookup to know if it's a MC or graphic — show both
      return filter.showMovieClips || filter.showGraphics;
    case "shape":
      return filter.showGraphics;
    case "bitmap-instance":
      return filter.showBitmaps;
    case "video-instance":
      return filter.showBitmaps; // bitmaps/videos share the same filter
    case "library-item": {
      const { item } = node;
      if (item.itemType === "bitmap") return filter.showBitmaps;
      if (item.itemType === "video") return filter.showBitmaps;
      if (item.itemType === "sound") return filter.showSounds;
      if (item.itemType === "symbol") {
        if (item.symbolType === "movieclip") return filter.showMovieClips;
        if (item.symbolType === "graphic") return filter.showGraphics;
        if (item.symbolType === "button") return filter.showMovieClips || filter.showGraphics;
      }
      return true;
    }
    default:
      // Container nodes: always include (pruned below if empty)
      return true;
  }
}

function filterNode(node: ExplorerNode, filter: ExplorerFilter, search: string): ExplorerNode | null {
  const q = search.toLowerCase();
  const labelMatch = q.length === 0 || node.label.toLowerCase().includes(q);

  // Leaf nodes
  if (
    node.type === "text" ||
    node.type === "script" ||
    node.type === "symbol-instance" ||
    node.type === "shape" ||
    node.type === "bitmap-instance" ||
    node.type === "video-instance"
  ) {
    if (!nodeMatchesFilter(node, filter)) return null;
    if (!labelMatch) return null;
    return node;
  }

  // Container nodes — recurse
  if (
    node.type === "scene" ||
    node.type === "layer" ||
    node.type === "frame" ||
    node.type === "library-section" ||
    node.type === "library-item"
  ) {
    const filteredChildren = node.children
      .map((child) => filterNode(child, filter, search))
      .filter((c): c is ExplorerNode => c !== null);

    // Frames and layers are pruned when they have no content after filtering —
    // they exist only to carry child nodes. Scenes and library-sections are top-level
    // structural containers that survive even when empty.
    const isContentContainer = node.type === "frame" || node.type === "layer";
    if (filteredChildren.length === 0) {
      if (isContentContainer) return null;
      // For scenes/library-sections: keep if label matches a search term, drop otherwise
      if (!labelMatch) return null;
    }

    return { ...node, children: filteredChildren } as ExplorerNode;
  }

  return null;
}

export function filterExplorerTree(
  nodes: ExplorerNode[],
  filter: ExplorerFilter,
  search: string
): ExplorerNode[] {
  return nodes
    .map((node) => filterNode(node, filter, search))
    .filter((n): n is ExplorerNode => n !== null);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: "60px",
  left: "60px",
  width: "340px",
  height: "480px",
  background: "#1e1e1e",
  border: "1px solid #444",
  boxShadow: "0 4px 24px rgba(0,0,0,0.7)",
  display: "flex",
  flexDirection: "column",
  zIndex: 2000,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: "12px",
  color: "#d4d4d4",
  borderRadius: "4px",
  overflow: "hidden",
};

// ---------------------------------------------------------------------------
// Tree node renderer
// ---------------------------------------------------------------------------

const NODE_ICONS: Partial<Record<ExplorerNode["type"], string>> = {
  scene: "▪",
  layer: "▫",
  frame: "◇",
  script: "{}",
  "symbol-instance": "◎",
  text: "T",
  shape: "△",
  "bitmap-instance": "▣",
  "video-instance": "▶",
  "library-section": "⊞",
  "library-item": "◉",
};

interface TreeNodeProps {
  node: ExplorerNode;
  depth: number;
  onSelect?: (node: ExplorerNode) => void;
}

function TreeNode({ node, depth, onSelect }: TreeNodeProps): React.ReactElement {
  const [expanded, setExpanded] = useState(depth < 2);

  const hasChildren =
    "children" in node && (node as { children: ExplorerNode[] }).children.length > 0;
  const children = hasChildren
    ? (node as { children: ExplorerNode[] }).children
    : [];

  const icon = NODE_ICONS[node.type] ?? "•";

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          paddingLeft: `${4 + depth * 14}px`,
          paddingRight: "4px",
          height: "20px",
          cursor: "default",
          userSelect: "none",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = "#2a3a4a";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = "transparent";
        }}
        onClick={() => {
          if (hasChildren) setExpanded((v) => !v);
          onSelect?.(node);
        }}
      >
        {/* Disclosure triangle */}
        <span
          style={{
            width: "12px",
            fontSize: "10px",
            color: "#888",
            flexShrink: 0,
            lineHeight: "1",
          }}
        >
          {hasChildren ? (expanded ? "▾" : "▸") : ""}
        </span>

        {/* Icon */}
        <span
          style={{
            width: "16px",
            fontSize: "10px",
            color: "#888",
            flexShrink: 0,
            textAlign: "center",
          }}
        >
          {icon}
        </span>

        {/* Label */}
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "11px",
            color: "#d4d4d4",
          }}
        >
          {node.label}
        </span>
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div>
          {children.map((child, i) => (
            <TreeNode key={i} node={child} depth={depth + 1} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter toolbar
// ---------------------------------------------------------------------------

interface FilterButtonProps {
  label: string;
  title: string;
  active: boolean;
  onToggle: () => void;
}

function FilterButton({ label, title, active, onToggle }: FilterButtonProps): React.ReactElement {
  return (
    <button
      title={title}
      onClick={onToggle}
      style={{
        background: active ? "#0078d7" : "transparent",
        border: `1px solid ${active ? "#005ba1" : "#555"}`,
        borderRadius: "3px",
        color: active ? "#fff" : "#bbb",
        cursor: "pointer",
        fontSize: "10px",
        fontWeight: "bold",
        padding: "2px 5px",
        lineHeight: "1.2",
        minWidth: "22px",
        textAlign: "center",
      }}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// MovieExplorerPanel
// ---------------------------------------------------------------------------

export interface MovieExplorerPanelProps {
  doc: FlashDocument;
  onSelectItem?: (item: ExplorerNode) => void;
  onClose?: () => void;
}

export function MovieExplorerPanel({
  doc,
  onSelectItem,
  onClose,
}: MovieExplorerPanelProps): React.ReactElement {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ExplorerFilter>({
    showText: true,
    showScripts: true,
    showMovieClips: true,
    showGraphics: true,
    showSounds: true,
    showBitmaps: true,
  });

  const rawTree = useMemo(() => buildExplorerTree(doc), [doc]);

  const filteredTree = useMemo(
    () => filterExplorerTree(rawTree, filter, search),
    [rawTree, filter, search]
  );

  const toggleFilter = (key: keyof ExplorerFilter) => {
    setFilter((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toolBtnStyle: React.CSSProperties = {
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: "3px",
    color: "#ccc",
    cursor: "pointer",
    fontSize: "14px",
    padding: "1px 6px",
    lineHeight: "1.2",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <div style={panelStyle}>
      {/* Title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: "24px",
          background: "#2d2d2d",
          borderBottom: "1px solid #444",
          padding: "0 8px",
          flexShrink: 0,
          userSelect: "none",
          borderRadius: "4px 4px 0 0",
        }}
      >
        <span style={{ fontSize: "11px", color: "#ccc" }}>Movie Explorer</span>
        <button
          style={{ ...toolBtnStyle, fontSize: "12px" }}
          onClick={onClose}
          title="Close"
        >
          &#x2715;
        </button>
      </div>

      {/* Filter toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: "28px",
          background: "#252526",
          borderBottom: "1px solid #333",
          padding: "0 6px",
          gap: "3px",
          flexShrink: 0,
        }}
      >
        <FilterButton
          label="T"
          title="Show Text Fields"
          active={filter.showText}
          onToggle={() => toggleFilter("showText")}
        />
        <FilterButton
          label="{}"
          title="Show ActionScript"
          active={filter.showScripts}
          onToggle={() => toggleFilter("showScripts")}
        />
        <FilterButton
          label="MC"
          title="Show Movie Clips"
          active={filter.showMovieClips}
          onToggle={() => toggleFilter("showMovieClips")}
        />
        <FilterButton
          label="G"
          title="Show Graphics / Shapes"
          active={filter.showGraphics}
          onToggle={() => toggleFilter("showGraphics")}
        />
        <FilterButton
          label="S"
          title="Show Sounds"
          active={filter.showSounds}
          onToggle={() => toggleFilter("showSounds")}
        />
        <FilterButton
          label="B"
          title="Show Bitmaps / Video"
          active={filter.showBitmaps}
          onToggle={() => toggleFilter("showBitmaps")}
        />

        {/* Search box */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          style={{
            flex: 1,
            marginLeft: "4px",
            background: "#1e1e1e",
            border: "1px solid #444",
            borderRadius: "3px",
            color: "#d4d4d4",
            fontSize: "11px",
            padding: "2px 6px",
            outline: "none",
          }}
        />
      </div>

      {/* Tree */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          background: "#1e1e1e",
        }}
      >
        {filteredTree.length === 0 ? (
          <div
            style={{
              padding: "12px 10px",
              color: "#666",
              fontSize: "11px",
              fontStyle: "italic",
            }}
          >
            {search.length > 0 ? "No matches found." : "Document is empty."}
          </div>
        ) : (
          filteredTree.map((node, i) => (
            <TreeNode key={i} node={node} depth={0} onSelect={onSelectItem} />
          ))
        )}
      </div>

      {/* Status bar */}
      <div
        style={{
          height: "22px",
          background: "#007acc",
          display: "flex",
          alignItems: "center",
          padding: "0 8px",
          fontSize: "11px",
          color: "#fff",
          flexShrink: 0,
          borderRadius: "0 0 4px 4px",
        }}
      >
        {filteredTree.length} top-level item{filteredTree.length !== 1 ? "s" : ""}
        {search.length > 0 ? ` matching "${search}"` : ""}
      </div>
    </div>
  );
}

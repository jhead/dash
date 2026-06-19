/**
 * ComponentsPanel — Flash 8-style Components panel (Window > Components).
 *
 * Lists the built-in Version 2 (v2) UI components. Users drag a component onto
 * the stage — or double-click it — to instantiate it (a library ComponentItem
 * plus a SymbolInstance display object carrying default parameters). The
 * instance's parameters are then edited in the Component Inspector's Parameters
 * tab. See docs/13-components.md.
 *
 * Scope (task 1222): the v2 UI component catalog + drag/double-click to
 * instantiate. Bindings/Schema tabs and Data Integration components are out of
 * scope (separate tasks).
 */

import React, { useMemo, useState } from "react";
import { BUILTIN_COMPONENTS, type ComponentDef } from "@flash/core";

/** dataTransfer MIME type carrying a built-in component's class name on drag. */
export const COMPONENT_DRAG_MIME = "application/flash-component";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ComponentsPanelProps {
  /**
   * Instantiate a built-in component on the stage (double-click or drop with no
   * coordinates). `componentName` is the component's class/display name.
   */
  onInstantiate: (componentName: string) => void;
  onClose: () => void;
  /** Override the component catalog (testing). Defaults to BUILTIN_COMPONENTS. */
  components?: readonly ComponentDef[];
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: "80px",
  right: "10px",
  width: "220px",
  background: "#2a2a2a",
  border: "1px solid #555",
  boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
  display: "flex",
  flexDirection: "column",
  zIndex: 1800,
  fontFamily: "Arial, sans-serif",
  fontSize: "11px",
  color: "#d0d0d0",
  borderRadius: "3px",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "4px 8px",
  background: "#333",
  borderBottom: "1px solid #555",
  flexShrink: 0,
  height: "22px",
};

const listStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  minHeight: "80px",
  maxHeight: "360px",
};

const categoryStyle: React.CSSProperties = {
  padding: "3px 8px",
  background: "#3a3a3a",
  fontWeight: "bold",
  color: "#bbb",
  borderTop: "1px solid #444",
  borderBottom: "1px solid #222",
};

const rowStyle = (selected: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 8px 3px 18px",
  cursor: "grab",
  background: selected ? "#1c5a99" : "transparent",
  color: selected ? "#fff" : "#d0d0d0",
  userSelect: "none",
});

const iconStyle: React.CSSProperties = {
  width: 12,
  height: 12,
  flexShrink: 0,
  background: "#888",
  border: "1px solid #555",
  borderRadius: 2,
};

// ---------------------------------------------------------------------------
// ComponentsPanel
// ---------------------------------------------------------------------------

export function ComponentsPanel({
  onInstantiate,
  onClose,
  components = BUILTIN_COMPONENTS,
}: ComponentsPanelProps) {
  const [selected, setSelected] = useState<string | null>(null);

  // Group components by category, preserving catalog order.
  const groups = useMemo(() => {
    const byCat = new Map<string, ComponentDef[]>();
    for (const c of components) {
      const arr = byCat.get(c.category) ?? [];
      arr.push(c);
      byCat.set(c.category, arr);
    }
    return [...byCat.entries()];
  }, [components]);

  return (
    <div style={panelStyle} data-testid="components-panel">
      <div style={headerStyle}>
        <span style={{ fontWeight: "bold" }}>Components</span>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "transparent",
            border: "none",
            color: "#aaa",
            cursor: "pointer",
            fontSize: "13px",
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      <div style={listStyle}>
        {groups.map(([category, defs]) => (
          <div key={category}>
            <div style={categoryStyle}>{category}</div>
            {defs.map((def) => (
              <div
                key={def.name}
                style={rowStyle(selected === def.name)}
                title={`${def.packageName}.${def.className}`}
                draggable
                data-testid={`component-row-${def.name}`}
                onClick={() => setSelected(def.name)}
                onDoubleClick={() => onInstantiate(def.name)}
                onDragStart={(e) => {
                  e.dataTransfer.setData(COMPONENT_DRAG_MIME, def.name);
                  e.dataTransfer.effectAllowed = "copy";
                  setSelected(def.name);
                }}
              >
                <span style={iconStyle} />
                <span>{def.name}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

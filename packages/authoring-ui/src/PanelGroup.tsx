/**
 * PanelGroup — Flash 8-style collapsible panel group with a title bar.
 *
 * Each group has a clickable title bar that toggles expand/collapse of its
 * content. Groups are stacked vertically in the right panel area.
 */

import React, { useState } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PanelGroupProps {
  title: string;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// PanelGroup
// ---------------------------------------------------------------------------

export function PanelGroup({
  title,
  defaultCollapsed = false,
  children,
}: PanelGroupProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div style={{ borderBottom: "1px solid #333", flexShrink: 0 }}>
      <div
        style={{
          background: "#3a3a3a",
          padding: "3px 8px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          userSelect: "none",
          fontSize: 11,
          color: "#ddd",
        }}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span style={{ fontSize: 9 }}>{collapsed ? "▶" : "▼"}</span>
        {title}
      </div>
      {!collapsed && (
        <div style={{ padding: "4px 0" }}>
          {children}
        </div>
      )}
    </div>
  );
}

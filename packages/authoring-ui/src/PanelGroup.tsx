/**
 * PanelGroup — Flash 8-style collapsible panel group with a title bar.
 *
 * Each group has a clickable title bar that toggles expand/collapse of its
 * content. Groups are stacked vertically in the right panel area.
 */

import React, { useState } from "react";
import { chrome, titleBarStyle } from "./theme/flash8Theme.js";

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
    <div
      style={{
        borderBottom: `${chrome.borderThin}px solid ${chrome.separator}`,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          // Flash 8 panel header: light-gray gradient + gripper dots, Tahoma 11px,
          // near-black text (titleBarStyle supplies chromeFont + the header gradient).
          ...titleBarStyle(),
          cursor: "pointer",
          gap: 6,
          userSelect: "none",
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

// Shared inline-SVG UI glyphs — crisp 16×16 monochrome icons that replace the
// former colour emoji in the authoring chrome. Per docs/30-flash8-ui-spec.md the
// glyph colour is halo.iconColor (#2B333C); icons inherit `currentColor` so a
// caller can override (e.g. disabled = chrome.textDisabled). Same idiom as the
// AlignPanel/ToolsPanel converted icons.
//
// USER directive: colour emoji must NEVER appear in the UI. Use these instead.

import * as React from "react";
import { halo } from "./theme/flash8Theme.js";

const ICON_SIZE = 14;

function Glyph({
  size = ICON_SIZE,
  children,
}: {
  size?: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", color: "currentColor" }}
    >
      {children}
    </svg>
  );
}

// Eye — show/hide. Almond outline + pupil.
export function EyeIcon({ size }: { size?: number } = {}): React.ReactElement {
  return (
    <Glyph size={size}>
      <path
        d="M8 3.5C4.4 3.5 1.7 6 0.8 8c0.9 2 3.6 4.5 7.2 4.5S14.3 10 15.2 8C14.3 6 11.6 3.5 8 3.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="8" cy="8" r="2.1" />
    </Glyph>
  );
}

// Padlock — closed (locked) state: filled body + shackle arc.
export function LockClosedIcon({ size }: { size?: number } = {}): React.ReactElement {
  return (
    <Glyph size={size}>
      <path
        d="M5 7V5.3a3 3 0 0 1 6 0V7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
    </Glyph>
  );
}

// Padlock — open (unlocked) state: same body, shackle swung open to the side.
export function LockOpenIcon({ size }: { size?: number } = {}): React.ReactElement {
  return (
    <Glyph size={size}>
      <path
        d="M5 7V5.3a3 3 0 0 1 5.6-1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
    </Glyph>
  );
}

// Folder — closed manila folder tab.
export function FolderIcon({ size }: { size?: number } = {}): React.ReactElement {
  return (
    <Glyph size={size}>
      <path d="M1.5 4h4l1.3 1.5H14.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
    </Glyph>
  );
}

// Trash — delete. Bin body + lid + handle, with vertical slats.
export function TrashIcon({ size }: { size?: number } = {}): React.ReactElement {
  return (
    <Glyph size={size}>
      <rect x="6" y="1.8" width="4" height="1.4" rx="0.4" />
      <rect x="2.5" y="3.2" width="11" height="1.6" rx="0.4" />
      <path
        d="M3.7 5.2h8.6l-0.7 8.1a1 1 0 0 1-1 0.9H5.4a1 1 0 0 1-1-0.9L3.7 5.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <rect x="6" y="6.6" width="1.1" height="5.6" rx="0.4" />
      <rect x="8.9" y="6.6" width="1.1" height="5.6" rx="0.4" />
    </Glyph>
  );
}

// Convenience: the icon colour token, for callers that don't already inherit it.
export const GLYPH_ICON_COLOR = halo.iconColor;

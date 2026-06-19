import React, { useEffect, useRef } from "react";
import { chrome, halo, chromeFont } from "./theme/flash8Theme.js";

export interface OutputPanelProps {
  /** Lines of AS2 trace() output to display. */
  messages: string[];
  /** Clear all messages. */
  onClear: () => void;
}

/**
 * Output panel — displays AS2 trace() output captured during Test Movie
 * playback.  Rendered inline as a bottom-dock tab (similar to ActionsPanel
 * in embedded mode).
 *
 * Flash 8 light theme: light-gray chrome toolbar over a WHITE message pane.
 * Message text reads dark (near-black) on the white pane; the placeholder is
 * the dimmed disabled-text gray. (Tokens from `theme/flash8Theme.ts`; mirrors
 * `Shell.tsx`.)
 */
export function OutputPanel({ messages, onClear }: OutputPanelProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom whenever new messages arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: chrome.panelBg,
        color: chrome.textDefault,
        ...chromeFont(),
        fontFamily: "'Consolas', 'Courier New', monospace",
        fontSize: 12,
      }}
    >
      {/* Toolbar — recessed light-gray strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          padding: "2px 6px",
          background: chrome.insetFieldStrip,
          borderBottom: `${chrome.borderThin}px solid ${chrome.separator}`,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onClear}
          title="Clear output"
          style={{
            background: "transparent",
            border: "none",
            color: chrome.textDefault,
            fontSize: 11,
            cursor: "pointer",
            padding: "2px 6px",
            borderRadius: 2,
            ...chromeFont(),
          }}
        >
          Clear
        </button>
      </div>

      {/* Message area — WHITE content pane, dark text */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "4px 8px",
          background: halo.panelContentBg,
          color: chrome.textDefault,
          fontFamily: "'Consolas', 'Courier New', monospace",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          lineHeight: 1.5,
        }}
        data-testid="output-panel-messages"
      >
        {messages.length === 0 ? (
          <span style={{ color: chrome.textDisabled }}>
            (Output from trace() statements will appear here during Test Movie.)
          </span>
        ) : (
          messages.map((line, i) => (
            <div key={i}>{line}</div>
          ))
        )}
      </div>
    </div>
  );
}

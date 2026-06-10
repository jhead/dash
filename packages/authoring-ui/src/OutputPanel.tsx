import React, { useEffect, useRef } from "react";

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
        background: "#1e1e1e",
        color: "#d4d4d4",
        fontFamily: "monospace",
        fontSize: 12,
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          padding: "2px 6px",
          background: "#252526",
          borderBottom: "1px solid #1a1a1a",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onClear}
          title="Clear output"
          style={{
            background: "transparent",
            border: "none",
            color: "#aaa",
            fontSize: 11,
            cursor: "pointer",
            padding: "2px 6px",
            borderRadius: 2,
          }}
        >
          Clear
        </button>
      </div>

      {/* Message area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "4px 8px",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          lineHeight: 1.5,
        }}
        data-testid="output-panel-messages"
      >
        {messages.length === 0 ? (
          <span style={{ color: "#555" }}>
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

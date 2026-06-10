import React, { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HistoryPanelProps {
  /**
   * Past document snapshots (oldest first).
   * These correspond to steps 1..N that have been applied.
   */
  past: readonly unknown[];
  /**
   * Future document snapshots (next redo first).
   * These are steps that can be re-applied.
   */
  future: readonly unknown[];
  /**
   * Called when the user clicks a step.
   * `index` is the 0-based position in the full list
   * [initialState, past[0], past[1], ..., present, future[0], future[1], ...].
   * Index 0 = "Initial State" (before any edits).
   * Index past.length = current state (clicking does nothing).
   */
  onJumpTo: (index: number) => void;
  /** Clear all history steps, keeping only the current document. */
  onClear?: () => void;
  /** Close the panel. */
  onClose?: () => void;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "220px",
  maxHeight: "400px",
  background: "#2d2d2d",
  border: "1px solid #1a1a1a",
  boxShadow: "2px 4px 12px rgba(0,0,0,0.5)",
  fontFamily: "system-ui, sans-serif",
  fontSize: "12px",
  color: "#e0e0e0",
  position: "absolute",
  zIndex: 2000,
};

const titleBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  height: "22px",
  padding: "0 8px",
  background: "#3c3c3c",
  borderBottom: "1px solid #1a1a1a",
  flexShrink: 0,
  userSelect: "none",
};

const closeBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#aaa",
  cursor: "pointer",
  fontSize: "13px",
  lineHeight: 1,
  padding: "0 2px",
};

const listStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  minHeight: 0,
};

const stepRowBaseStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "3px 10px",
  cursor: "pointer",
  userSelect: "none",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const dividerStyle: React.CSSProperties = {
  height: "2px",
  background: "#1a6ea8",
  margin: "1px 0",
  flexShrink: 0,
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  padding: "4px 8px",
  borderTop: "1px solid #1a1a1a",
  flexShrink: 0,
};

const clearBtnStyle: React.CSSProperties = {
  background: "#3a3a3a",
  border: "1px solid #555",
  color: "#ccc",
  cursor: "pointer",
  fontSize: "11px",
  padding: "2px 8px",
  borderRadius: "2px",
};

// ---------------------------------------------------------------------------
// HistoryPanel component
// ---------------------------------------------------------------------------

/**
 * Floating panel showing the undo/redo step list.
 *
 * Layout:
 *   - "Initial State" as step 0
 *   - Past steps 1..N (applied, shown above the current-state divider)
 *   - A blue horizontal divider marking the current position
 *   - Future steps (grayed out, available for redo)
 *
 * Clicking any step calls `onJumpTo(index)` where index is:
 *   0          = Initial State  (undo all the way)
 *   1..past.length = a past step
 *   past.length+1  = current (no-op in practice)
 */
export function HistoryPanel({
  past,
  future,
  onJumpTo,
  onClear,
  onClose,
}: HistoryPanelProps): React.ReactElement {
  // Auto-scroll to keep the current-state divider visible
  const dividerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dividerRef.current?.scrollIntoView({ block: "nearest" });
  }, [past.length]);

  // currentIndex = index of the "present" in the full list
  const currentIndex = past.length;

  return (
    <div style={containerStyle} data-testid="history-panel">
      {/* Title bar */}
      <div style={titleBarStyle}>
        <span style={{ fontWeight: "bold", fontSize: "11px" }}>History</span>
        {onClose && (
          <button style={closeBtnStyle} onClick={onClose} title="Close History panel">
            x
          </button>
        )}
      </div>

      {/* Step list */}
      <div style={listStyle}>
        {/* Step 0: Initial State */}
        <div
          style={{
            ...stepRowBaseStyle,
            background: currentIndex === 0 ? "#1a6ea8" : "#3a3a3a",
            color: currentIndex === 0 ? "#fff" : "#ccc",
            fontStyle: "italic",
          }}
          onClick={() => onJumpTo(0)}
          data-testid="history-step-0"
          title="Initial State"
        >
          Initial State
        </div>

        {/* Past steps: index 1..past.length */}
        {Array.from(past).map((_, i) => {
          const stepIndex = i + 1;
          const isCurrent = stepIndex === currentIndex;
          return (
            <div
              key={stepIndex}
              style={{
                ...stepRowBaseStyle,
                background: isCurrent ? "#1a6ea8" : i % 2 === 0 ? "#333" : "#2d2d2d",
                color: isCurrent ? "#fff" : "#e0e0e0",
              }}
              onClick={() => onJumpTo(stepIndex)}
              data-testid={`history-step-${stepIndex}`}
              title={`Step ${stepIndex}`}
            >
              Step {stepIndex}
            </div>
          );
        })}

        {/* Current state divider */}
        <div ref={dividerRef} style={dividerStyle} data-testid="history-current-divider" />

        {/* Future steps (grayed out) */}
        {Array.from(future).map((_, i) => {
          const stepIndex = currentIndex + 1 + i;
          return (
            <div
              key={stepIndex}
              style={{
                ...stepRowBaseStyle,
                background: i % 2 === 0 ? "#333" : "#2d2d2d",
                color: "#777",
              }}
              onClick={() => onJumpTo(stepIndex)}
              data-testid={`history-step-${stepIndex}`}
              title={`Step ${stepIndex} (redo)`}
            >
              Step {stepIndex}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {onClear && (
        <div style={footerStyle}>
          <button
            style={clearBtnStyle}
            onClick={onClear}
            title="Clear all history steps"
            data-testid="history-clear-btn"
          >
            Clear History
          </button>
        </div>
      )}
    </div>
  );
}

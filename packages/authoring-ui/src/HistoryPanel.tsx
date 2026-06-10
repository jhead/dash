import React, { useEffect, useRef, useState } from "react";

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
  /**
   * Called when the user clicks "Save as Command..." with a name and the
   * selected step indices (1-based past-step indices). If no steps are
   * selected the caller should save all past steps.
   * @param name - user-supplied command name
   * @param stepIndices - 1-based indices of selected past steps (may be empty = "all past")
   */
  onSaveAsCommand?: (name: string, stepIndices: number[]) => void;
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
  justifyContent: "space-between",
  alignItems: "center",
  padding: "4px 8px",
  borderTop: "1px solid #1a1a1a",
  flexShrink: 0,
  gap: "4px",
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

const saveCommandBtnStyle: React.CSSProperties = {
  background: "#1a6ea8",
  border: "1px solid #0d5a8a",
  color: "#fff",
  cursor: "pointer",
  fontSize: "11px",
  padding: "2px 8px",
  borderRadius: "2px",
  whiteSpace: "nowrap",
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
  onSaveAsCommand,
}: HistoryPanelProps): React.ReactElement {
  // Auto-scroll to keep the current-state divider visible
  const dividerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dividerRef.current?.scrollIntoView({ block: "nearest" });
  }, [past.length]);

  // currentIndex = index of the "present" in the full list
  const currentIndex = past.length;

  // Multi-select: set of 1-based past step indices that are selected
  const [selectedSteps, setSelectedSteps] = useState<Set<number>>(new Set());

  const toggleStep = (stepIndex: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepIndex)) {
        next.delete(stepIndex);
      } else {
        next.add(stepIndex);
      }
      return next;
    });
  };

  const handleSaveAsCommand = () => {
    if (!onSaveAsCommand) return;
    const name = window.prompt("Enter command name:");
    if (!name || !name.trim()) return;
    const indices = Array.from(selectedSteps).sort((a, b) => a - b);
    onSaveAsCommand(name.trim(), indices);
    setSelectedSteps(new Set());
  };

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
          const isSelected = selectedSteps.has(stepIndex);
          return (
            <div
              key={stepIndex}
              style={{
                ...stepRowBaseStyle,
                background: isSelected
                  ? "#0d5a8a"
                  : isCurrent
                  ? "#1a6ea8"
                  : i % 2 === 0
                  ? "#333"
                  : "#2d2d2d",
                color: isCurrent || isSelected ? "#fff" : "#e0e0e0",
                outline: isSelected ? "1px solid #4da6ff" : "none",
              }}
              onClick={(e) => {
                if (onSaveAsCommand && e.shiftKey) {
                  toggleStep(stepIndex, e);
                } else {
                  onJumpTo(stepIndex);
                }
              }}
              data-testid={`history-step-${stepIndex}`}
              title={`Step ${stepIndex}${onSaveAsCommand ? " (Shift-click to select for Save as Command)" : ""}`}
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
      {(onClear || onSaveAsCommand) && (
        <div style={footerStyle}>
          {onSaveAsCommand && (
            <button
              style={saveCommandBtnStyle}
              onClick={handleSaveAsCommand}
              title={
                selectedSteps.size > 0
                  ? `Save ${selectedSteps.size} selected step(s) as a command`
                  : "Save all past steps as a command"
              }
              data-testid="history-save-command-btn"
            >
              Save as Command…
            </button>
          )}
          {onClear && (
            <button
              style={clearBtnStyle}
              onClick={onClear}
              title="Clear all history steps"
              data-testid="history-clear-btn"
            >
              Clear History
            </button>
          )}
        </div>
      )}
    </div>
  );
}

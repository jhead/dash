import React from "react";
import { useUiStore } from "../store/index.js";

/**
 * The "Manage Saved Commands" modal (Commands menu). Open-state + the saved
 * command list live in uiStore; run/delete actions come in as props. Renders
 * nothing when closed. Requires a <StoreProvider> ancestor.
 */
export interface ManageCommandsDialogProps {
  onRun: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ManageCommandsDialog({ onRun, onDelete }: ManageCommandsDialogProps): React.ReactElement | null {
  const manageCommandsOpen = useUiStore((s) => s.manageCommandsOpen);
  const setManageCommandsOpen = useUiStore((s) => s.setManageCommandsOpen);
  const savedCommands = useUiStore((s) => s.savedCommands);

  if (!manageCommandsOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={() => setManageCommandsOpen(false)}
    >
      <div
        style={{
          background: "#2d2d2d",
          border: "1px solid #1a1a1a",
          boxShadow: "2px 4px 12px rgba(0,0,0,0.5)",
          fontFamily: "system-ui, sans-serif",
          fontSize: "12px",
          color: "#e0e0e0",
          minWidth: "280px",
          maxWidth: "400px",
          maxHeight: "480px",
          display: "flex",
          flexDirection: "column",
          borderRadius: "2px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: "28px",
            padding: "0 12px",
            background: "#3c3c3c",
            borderBottom: "1px solid #1a1a1a",
            flexShrink: 0,
            userSelect: "none",
          }}
        >
          <span style={{ fontWeight: "bold", fontSize: "12px" }}>Manage Saved Commands</span>
          <button
            style={{
              background: "transparent",
              border: "none",
              color: "#aaa",
              cursor: "pointer",
              fontSize: "14px",
              lineHeight: 1,
              padding: "0 2px",
            }}
            onClick={() => setManageCommandsOpen(false)}
            title="Close"
          >
            x
          </button>
        </div>
        {/* Command list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0", minHeight: 0 }}>
          {savedCommands.length === 0 ? (
            <div
              style={{
                padding: "16px",
                color: "#777",
                textAlign: "center",
                fontStyle: "italic",
              }}
              data-testid="manage-commands-empty"
            >
              No saved commands yet.
              <br />
              Use the History panel to save steps.
            </div>
          ) : (
            savedCommands.map((cmd) => (
              <div
                key={cmd.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "4px 12px",
                }}
                data-testid={`manage-command-${cmd.id}`}
              >
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {cmd.name}
                </span>
                <div style={{ display: "flex", gap: "4px", flexShrink: 0, marginLeft: "8px" }}>
                  <button
                    style={{
                      background: "#1a6ea8",
                      border: "1px solid #0d5a8a",
                      color: "#fff",
                      cursor: "pointer",
                      fontSize: "11px",
                      padding: "1px 6px",
                      borderRadius: "2px",
                    }}
                    onClick={() => {
                      setManageCommandsOpen(false);
                      onRun(cmd.id);
                    }}
                    title={`Run "${cmd.name}"`}
                    data-testid={`run-command-${cmd.id}`}
                  >
                    Run
                  </button>
                  <button
                    style={{
                      background: "#5a2020",
                      border: "1px solid #8a0d0d",
                      color: "#fff",
                      cursor: "pointer",
                      fontSize: "11px",
                      padding: "1px 6px",
                      borderRadius: "2px",
                    }}
                    onClick={() => onDelete(cmd.id)}
                    title={`Delete "${cmd.name}"`}
                    data-testid={`delete-command-${cmd.id}`}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        {/* Footer */}
        <div
          style={{
            padding: "8px 12px",
            borderTop: "1px solid #1a1a1a",
            display: "flex",
            justifyContent: "flex-end",
            flexShrink: 0,
          }}
        >
          <button
            style={{
              background: "#3a3a3a",
              border: "1px solid #555",
              color: "#ccc",
              cursor: "pointer",
              fontSize: "11px",
              padding: "3px 12px",
              borderRadius: "2px",
            }}
            onClick={() => setManageCommandsOpen(false)}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

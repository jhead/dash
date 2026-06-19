import React, { useState } from "react";
import { useUiStore } from "../store/index.js";
import {
  chrome,
  halo,
  chromeFont,
  buttonStyle,
  type ButtonState,
} from "../theme/flash8Theme.js";

/** A Halo-skinned button that tracks its own hover/press state. */
function DialogButton({
  children,
  onClick,
  title,
  testId,
  primary = false,
  danger = false,
  style,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  testId?: string;
  primary?: boolean;
  danger?: boolean;
  style?: React.CSSProperties;
}): React.ReactElement {
  const [state, setState] = useState<ButtonState>("up");
  return (
    <button
      data-testid={testId}
      title={title}
      onClick={onClick}
      onMouseEnter={() => setState("over")}
      onMouseLeave={() => setState("up")}
      onMouseDown={() => setState("down")}
      onMouseUp={() => setState("over")}
      style={{
        ...buttonStyle(state),
        ...(primary ? { color: chrome.textDefault, fontWeight: "bold" } : {}),
        ...(danger ? { color: halo.error } : {}),
        ...style,
      }}
    >
      {children}
    </button>
  );
}

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
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={() => setManageCommandsOpen(false)}
    >
      <div
        style={{
          background: chrome.panelBg,
          border: `1px solid ${chrome.separator}`,
          boxShadow: "2px 4px 12px rgba(0,0,0,0.4)",
          ...chromeFont(),
          minWidth: "280px",
          maxWidth: "400px",
          maxHeight: "480px",
          display: "flex",
          flexDirection: "column",
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
            background: chrome.panelBg,
            borderBottom: `1px solid ${chrome.separator}`,
            flexShrink: 0,
            userSelect: "none",
          }}
        >
          <span style={{ fontWeight: "bold", fontSize: "12px" }}>Manage Saved Commands</span>
          <button
            style={{
              background: "transparent",
              border: "none",
              color: chrome.textDefault,
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
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "8px 0",
            minHeight: 0,
            background: halo.panelContentBg,
          }}
        >
          {savedCommands.length === 0 ? (
            <div
              style={{
                padding: "16px",
                color: chrome.textDisabled,
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
                  <DialogButton
                    primary
                    style={{ padding: "1px 6px" }}
                    onClick={() => {
                      setManageCommandsOpen(false);
                      onRun(cmd.id);
                    }}
                    title={`Run "${cmd.name}"`}
                    testId={`run-command-${cmd.id}`}
                  >
                    Run
                  </DialogButton>
                  <DialogButton
                    danger
                    style={{ padding: "1px 6px" }}
                    onClick={() => onDelete(cmd.id)}
                    title={`Delete "${cmd.name}"`}
                    testId={`delete-command-${cmd.id}`}
                  >
                    Delete
                  </DialogButton>
                </div>
              </div>
            ))
          )}
        </div>
        {/* Footer */}
        <div
          style={{
            padding: "8px 12px",
            borderTop: `1px solid ${chrome.separator}`,
            display: "flex",
            justifyContent: "flex-end",
            flexShrink: 0,
            background: chrome.panelBg,
          }}
        >
          <DialogButton
            style={{ padding: "3px 12px" }}
            onClick={() => setManageCommandsOpen(false)}
          >
            Close
          </DialogButton>
        </div>
      </div>
    </div>
  );
}

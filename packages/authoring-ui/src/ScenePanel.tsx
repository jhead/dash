/**
 * ScenePanel — Flash 8-style Scene panel (Window > Scene, Ctrl+Shift+S).
 *
 * Lists all scenes in the document, allows navigation, add, remove, rename,
 * and drag-to-reorder.
 */

import React, { useState, useRef, useCallback } from "react";
import { chrome, halo, chromeFont } from "./theme/flash8Theme.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ScenePanelProps {
  scenes: readonly { id: string; name: string }[];
  activeSceneIndex: number;
  onSelectScene: (index: number) => void;
  onAddScene: () => void;
  onRemoveScene: (index: number) => void;
  onRenameScene: (index: number, name: string) => void;
  onReorderScene: (fromIndex: number, toIndex: number) => void;
  onDuplicateScene?: (index: number) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: "80px",
  right: "10px",
  width: "200px",
  background: chrome.panelBg,
  border: `${chrome.borderThin}px solid ${chrome.separator}`,
  boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
  display: "flex",
  flexDirection: "column",
  zIndex: 1800,
  ...chromeFont(),
  color: chrome.textDefault,
  borderRadius: "3px",
  overflow: "hidden",
};

// Header uses the Halo panel-header gradient + divider.
const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "4px 8px",
  background: `linear-gradient(${halo.panelHeaderGrad[0]}, ${halo.panelHeaderGrad[1]})`,
  borderBottom: `${chrome.borderThin}px solid ${halo.headerDivider}`,
  flexShrink: 0,
  height: "22px",
};

// White content list area.
const listStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  minHeight: "60px",
  maxHeight: "240px",
  background: halo.panelContentBg,
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "row",
  borderTop: `${chrome.borderThin}px solid ${chrome.separator}`,
  flexShrink: 0,
  background: chrome.panelBg,
};

const footerBtnStyle = (disabled?: boolean): React.CSSProperties => ({
  flex: 1,
  background: "transparent",
  border: "none",
  borderRight: `${chrome.borderThin}px solid ${chrome.separator}`,
  color: disabled ? chrome.textDisabled : halo.buttonColor,
  cursor: disabled ? "default" : "pointer",
  fontSize: "16px",
  padding: "3px 0",
  lineHeight: "1",
});

// ---------------------------------------------------------------------------
// ScenePanel
// ---------------------------------------------------------------------------

export function ScenePanel({
  scenes,
  activeSceneIndex,
  onSelectScene,
  onAddScene,
  onRemoveScene,
  onRenameScene,
  onReorderScene,
  onDuplicateScene,
  onClose,
}: ScenePanelProps): React.ReactElement {
  // Index of the scene currently being renamed (-1 means none)
  const [editingIndex, setEditingIndex] = useState<number>(-1);
  const [editingName, setEditingName] = useState<string>("");

  // Drag-and-drop
  const dragIndexRef = useRef<number>(-1);

  // ---------------------------------------------------------------------------
  // Rename helpers
  // ---------------------------------------------------------------------------

  const startRename = useCallback((index: number, currentName: string) => {
    setEditingIndex(index);
    setEditingName(currentName);
  }, []);

  const commitRename = useCallback(() => {
    if (editingIndex >= 0) {
      const trimmed = editingName.trim();
      if (trimmed.length > 0) {
        onRenameScene(editingIndex, trimmed);
      }
    }
    setEditingIndex(-1);
    setEditingName("");
  }, [editingIndex, editingName, onRenameScene]);

  const cancelRename = useCallback(() => {
    setEditingIndex(-1);
    setEditingName("");
  }, []);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitRename();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelRename();
      }
    },
    [commitRename, cancelRename]
  );

  // ---------------------------------------------------------------------------
  // Drag-and-drop handlers
  // ---------------------------------------------------------------------------

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      dragIndexRef.current = index;
      e.dataTransfer.effectAllowed = "move";
    },
    []
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, toIndex: number) => {
      e.preventDefault();
      const fromIndex = dragIndexRef.current;
      if (fromIndex >= 0 && fromIndex !== toIndex) {
        onReorderScene(fromIndex, toIndex);
      }
      dragIndexRef.current = -1;
    },
    [onReorderScene]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const canRemove = scenes.length > 1;

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ ...chromeFont(), fontWeight: "bold", color: chrome.textDefault }}>Scene</span>
        <button
          style={{
            background: "transparent",
            border: "none",
            color: halo.buttonColor,
            cursor: "pointer",
            fontSize: "13px",
            padding: "0 2px",
            lineHeight: "1",
          }}
          title="Close"
          onClick={onClose}
        >
          &#x2715;
        </button>
      </div>

      {/* Scene list */}
      <div style={listStyle}>
        {scenes.map((scene, index) => {
          const isActive = index === activeSceneIndex;
          const isEditing = editingIndex === index;

          return (
            <div
              key={scene.id}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
              style={{
                ...chromeFont(),
                display: "flex",
                alignItems: "center",
                padding: "3px 6px",
                background: isActive ? halo.selectionColor : "transparent",
                color: isActive ? halo.textSelected : chrome.textDefault,
                cursor: "default",
                userSelect: "none",
              }}
              onClick={() => {
                if (!isEditing) {
                  onSelectScene(index);
                }
              }}
              onDoubleClick={() => {
                startRename(index, scene.name);
              }}
            >
              {/* Drag handle */}
              <span
                style={{
                  marginRight: "6px",
                  color: isActive ? halo.textSelected : halo.disabledIcon,
                  fontSize: "10px",
                  cursor: "grab",
                  flexShrink: 0,
                }}
                title="Drag to reorder"
              >
                &#x2630;
              </span>

              {/* Name or inline edit */}
              {isEditing ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={commitRename}
                  style={{
                    ...chromeFont(),
                    flex: 1,
                    background: halo.inputBg,
                    color: halo.text,
                    borderStyle: "solid",
                    borderWidth: 1,
                    borderTopColor: halo.inputBorderDark,
                    borderLeftColor: halo.inputBorderDark,
                    borderRightColor: halo.inputBorderLight,
                    borderBottomColor: halo.inputBorderLight,
                    padding: "1px 3px",
                    outline: "none",
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: "11px",
                  }}
                >
                  {scene.name}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer toolbar */}
      <div style={footerStyle}>
        <button
          style={{ ...footerBtnStyle(false), borderRight: `${chrome.borderThin}px solid ${chrome.separator}` }}
          title="Add Scene"
          onClick={onAddScene}
        >
          +
        </button>
        <button
          style={{ ...footerBtnStyle(false), borderRight: `${chrome.borderThin}px solid ${chrome.separator}` }}
          title="Duplicate Scene"
          onClick={() => {
            if (onDuplicateScene) {
              onDuplicateScene(activeSceneIndex);
            }
          }}
        >
          &#x2398;
        </button>
        <button
          style={{ ...footerBtnStyle(!canRemove), borderRight: "none" }}
          title={canRemove ? "Remove Scene" : "Cannot remove the only scene"}
          disabled={!canRemove}
          onClick={() => {
            if (canRemove) {
              onRemoveScene(activeSceneIndex);
            }
          }}
        >
          &#x2212;
        </button>
      </div>
    </div>
  );
}

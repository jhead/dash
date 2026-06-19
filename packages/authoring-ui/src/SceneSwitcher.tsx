/**
 * SceneSwitcher — inline scene switcher panel, shown near the Timeline.
 *
 * Displays the list of scenes with navigation, add, delete, duplicate, rename,
 * and up/down reorder buttons. Uses the Flash 8 light theme (see theme/flash8Theme).
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  addScene,
  removeScene,
  renameScene,
  reorderScenes,
  duplicateScene,
} from "@flash/core";
import type { FlashDocument } from "@flash/core";
import { chrome, halo, chromeFont } from "./theme/flash8Theme.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SceneSwitcherProps {
  doc: FlashDocument;
  currentSceneIdx: number;
  onDocChange: (doc: FlashDocument) => void;
  onSceneChange: (idx: number) => void;
}

// ---------------------------------------------------------------------------
// SceneSwitcher
// ---------------------------------------------------------------------------

export function SceneSwitcher({
  doc,
  currentSceneIdx,
  onDocChange,
  onSceneChange,
}: SceneSwitcherProps): React.ReactElement {
  const scenes = doc.scenes;

  // Inline rename state
  const [editingIndex, setEditingIndex] = useState<number>(-1);
  const [editingName, setEditingName] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when rename starts
  useEffect(() => {
    if (editingIndex >= 0 && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingIndex]);

  // ---------------------------------------------------------------------------
  // Rename helpers
  // ---------------------------------------------------------------------------

  const startRename = useCallback((index: number) => {
    setEditingIndex(index);
    setEditingName(scenes[index]?.name ?? "");
  }, [scenes]);

  const commitRename = useCallback(() => {
    if (editingIndex >= 0) {
      const trimmed = editingName.trim();
      if (trimmed.length > 0) {
        const scene = scenes[editingIndex];
        if (scene) {
          onDocChange(renameScene(doc, scene.id, trimmed));
        }
      }
    }
    setEditingIndex(-1);
    setEditingName("");
  }, [editingIndex, editingName, scenes, doc, onDocChange]);

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
  // Action handlers
  // ---------------------------------------------------------------------------

  const handleAddScene = useCallback(() => {
    const newDoc = addScene(doc);
    onDocChange(newDoc);
    // Select the new scene (appended at end)
    onSceneChange(newDoc.scenes.length - 1);
  }, [doc, onDocChange, onSceneChange]);

  const handleDeleteScene = useCallback(
    (index: number) => {
      if (scenes.length <= 1) return;
      const scene = scenes[index];
      if (!scene) return;
      const newDoc = removeScene(doc, scene.id);
      onDocChange(newDoc);
      // Adjust selection if needed
      const newIdx = Math.min(currentSceneIdx, newDoc.scenes.length - 1);
      onSceneChange(newIdx);
    },
    [scenes, doc, onDocChange, currentSceneIdx, onSceneChange]
  );

  const handleDuplicateScene = useCallback(
    (index: number) => {
      const scene = scenes[index];
      if (!scene) return;
      const newDoc = duplicateScene(doc, scene.id);
      onDocChange(newDoc);
      // Select the duplicate (inserted after the source)
      onSceneChange(index + 1);
    },
    [scenes, doc, onDocChange, onSceneChange]
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index <= 0) return;
      const newDoc = reorderScenes(doc, index, index - 1);
      onDocChange(newDoc);
      if (currentSceneIdx === index) {
        onSceneChange(index - 1);
      } else if (currentSceneIdx === index - 1) {
        onSceneChange(index);
      }
    },
    [doc, onDocChange, currentSceneIdx, onSceneChange]
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index >= scenes.length - 1) return;
      const newDoc = reorderScenes(doc, index, index + 1);
      onDocChange(newDoc);
      if (currentSceneIdx === index) {
        onSceneChange(index + 1);
      } else if (currentSceneIdx === index + 1) {
        onSceneChange(index);
      }
    },
    [doc, onDocChange, currentSceneIdx, onSceneChange, scenes.length]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const canDelete = scenes.length > 1;

  return (
    <div
      style={{
        background: chrome.panelBg,
        borderTop: `${chrome.borderThin}px solid ${chrome.separator}`,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        maxHeight: "160px",
        ...chromeFont(),
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "2px 8px",
          background: chrome.insetFieldStrip,
          borderBottom: `${chrome.borderThin}px solid ${chrome.separator}`,
          flexShrink: 0,
          height: "20px",
          userSelect: "none",
        }}
      >
        <span style={{ ...chromeFont(), fontWeight: "bold", color: chrome.textDefault }}>
          Scenes
        </span>
        {/* Toolbar: add, duplicate, delete */}
        <div style={{ display: "flex", gap: 2 }}>
          <button
            title="Add Scene"
            onClick={handleAddScene}
            style={toolbarBtnStyle(false)}
          >
            +
          </button>
          <button
            title="Duplicate Scene"
            onClick={() => handleDuplicateScene(currentSceneIdx)}
            style={toolbarBtnStyle(false)}
          >
            &#x2399;
          </button>
          <button
            title={canDelete ? "Delete Scene" : "Cannot delete the only scene"}
            onClick={() => handleDeleteScene(currentSceneIdx)}
            disabled={!canDelete}
            style={toolbarBtnStyle(!canDelete)}
          >
            &#x2212;
          </button>
        </div>
      </div>

      {/* Scene list */}
      <div
        style={{
          overflowY: "auto",
          flex: 1,
        }}
      >
        {scenes.map((scene, index) => {
          const isActive = index === currentSceneIdx;
          const isEditing = editingIndex === index;

          return (
            <div
              key={scene.id}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "2px 4px",
                background: isActive ? halo.selectionColor : "transparent",
                color: isActive ? halo.textSelected : chrome.textDefault,
                cursor: "default",
                userSelect: "none",
                gap: 2,
              }}
              onClick={() => {
                if (!isEditing) {
                  onSceneChange(index);
                }
              }}
              onDoubleClick={() => {
                onSceneChange(index);
                startRename(index);
              }}
            >
              {/* Up/down arrows */}
              <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
                <button
                  title="Move scene up"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveUp(index);
                  }}
                  disabled={index === 0}
                  style={arrowBtnStyle(index === 0)}
                >
                  &#x25B4;
                </button>
                <button
                  title="Move scene down"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveDown(index);
                  }}
                  disabled={index === scenes.length - 1}
                  style={arrowBtnStyle(index === scenes.length - 1)}
                >
                  &#x25BE;
                </button>
              </div>

              {/* Scene name or inline edit */}
              {isEditing ? (
                <input
                  ref={inputRef}
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    flex: 1,
                    background: halo.inputBg,
                    color: halo.text,
                    border: `1px solid ${halo.inputBorder}`,
                    borderRadius: "2px",
                    fontSize: "11px",
                    padding: "1px 3px",
                    outline: "none",
                  }}
                />
              ) : (
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: "11px",
                    padding: "1px 2px",
                  }}
                  title={`${scene.name} (double-click to rename)`}
                >
                  {scene.name}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function toolbarBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${chrome.separator}`,
    borderRadius: 2,
    color: disabled ? chrome.textDisabled : chrome.textDefault,
    cursor: disabled ? "default" : "pointer",
    fontSize: "13px",
    lineHeight: "1",
    padding: "0 4px",
    height: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function arrowBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: "transparent",
    border: "none",
    color: disabled ? chrome.textDisabled : chrome.textDefault,
    cursor: disabled ? "default" : "pointer",
    fontSize: "8px",
    lineHeight: "1",
    padding: "0 2px",
    height: 9,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

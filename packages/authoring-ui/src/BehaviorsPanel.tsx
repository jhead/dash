import React, { useCallback, useRef, useState } from "react";
import { BEHAVIORS, getBehaviorsByCategory } from "./behaviors.js";
import type { Behavior } from "./behaviors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single behavior row attached to the current frame/instance. */
export interface AttachedBehavior {
  id: string;        // unique row id (timestamp-based)
  behaviorId: string; // refers to BEHAVIORS[*].id
  params: Record<string, string>;
  /** e.g. "On Release" — display label only, not compiled */
  event: string;
}

export interface BehaviorsPanelProps {
  /** Current frame script text (read-only; used to seed the editor). */
  script: string;
  /** Called when the panel wants to append AS2 to the frame script. */
  onScriptChange: (script: string) => void;
  /** Called when the panel's close button is pressed. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Parameter form dialog — shown after the user picks a behavior from +
// ---------------------------------------------------------------------------

interface ParamFormProps {
  behavior: Behavior;
  onConfirm: (params: Record<string, string>) => void;
  onCancel: () => void;
}

function ParamForm({ behavior, onConfirm, onCancel }: ParamFormProps): React.ReactElement {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of behavior.params) {
      init[p.key] = "";
    }
    return init;
  });

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleOk = () => onConfirm(values);

  const inputStyle: React.CSSProperties = {
    background: "#1e1e1e",
    border: "1px solid #555",
    borderRadius: "3px",
    color: "#d4d4d4",
    fontSize: "12px",
    padding: "3px 6px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          background: "#2d2d2d",
          border: "1px solid #555",
          borderRadius: "4px",
          minWidth: "300px",
          maxWidth: "400px",
          padding: "0",
          boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Title bar */}
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid #444",
            fontSize: "12px",
            fontWeight: "bold",
            color: "#e0e0e0",
            background: "#333",
          }}
        >
          {behavior.name}
        </div>

        {/* Description */}
        <div
          style={{
            padding: "8px 12px",
            fontSize: "11px",
            color: "#aaa",
            borderBottom: behavior.params.length > 0 ? "1px solid #3a3a3a" : undefined,
          }}
        >
          {behavior.description}
        </div>

        {/* Parameter fields */}
        {behavior.params.length > 0 && (
          <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>
            {behavior.params.map((p) => (
              <div key={p.key}>
                <label
                  style={{ display: "block", fontSize: "11px", color: "#ccc", marginBottom: "3px" }}
                >
                  {p.label}
                </label>
                <input
                  type="text"
                  value={values[p.key] ?? ""}
                  placeholder={p.placeholder ?? ""}
                  onChange={(e) => handleChange(p.key, e.target.value)}
                  style={inputStyle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleOk();
                    if (e.key === "Escape") onCancel();
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "6px",
            padding: "8px 12px",
            borderTop: "1px solid #444",
          }}
        >
          <button
            onClick={onCancel}
            style={{
              background: "transparent",
              border: "1px solid #555",
              borderRadius: "3px",
              color: "#ccc",
              cursor: "pointer",
              fontSize: "12px",
              padding: "4px 12px",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleOk}
            style={{
              background: "#0078d7",
              border: "1px solid #005ba1",
              borderRadius: "3px",
              color: "#fff",
              cursor: "pointer",
              fontSize: "12px",
              padding: "4px 12px",
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Behavior dropdown — grouped by category
// ---------------------------------------------------------------------------

interface AddDropdownProps {
  onSelect: (behavior: Behavior) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

function AddDropdown({ onSelect, onClose, anchorRef }: AddDropdownProps): React.ReactElement {
  const grouped = getBehaviorsByCategory();

  // Position below the anchor button
  const rect = anchorRef.current?.getBoundingClientRect();
  const top = rect ? rect.bottom + 2 : 80;
  const left = rect ? rect.left : 10;

  return (
    <>
      {/* Click-away overlay */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 3998 }}
        onMouseDown={onClose}
      />
      <div
        style={{
          position: "fixed",
          top,
          left,
          minWidth: "220px",
          background: "#2d2d2d",
          border: "1px solid #555",
          borderRadius: "3px",
          boxShadow: "2px 4px 12px rgba(0,0,0,0.6)",
          zIndex: 3999,
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: "12px",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {Array.from(grouped.entries()).map(([category, behaviors]) => (
          <div key={category}>
            {/* Category header */}
            <div
              style={{
                padding: "4px 10px 2px",
                fontSize: "10px",
                color: "#888",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                userSelect: "none",
                borderTop: "1px solid #3a3a3a",
              }}
            >
              {category}
            </div>
            {behaviors.map((b) => (
              <BehaviorMenuItem key={b.id} behavior={b} onSelect={onSelect} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function BehaviorMenuItem({
  behavior,
  onSelect,
}: {
  behavior: Behavior;
  onSelect: (b: Behavior) => void;
}): React.ReactElement {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        padding: "4px 10px 4px 20px",
        color: "#d4d4d4",
        cursor: "default",
        background: hovered ? "#0078d7" : "transparent",
        userSelect: "none",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect(behavior);
      }}
    >
      {behavior.name}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BehaviorsPanel
// ---------------------------------------------------------------------------

let _rowCounter = 0;
function nextRowId() {
  return `bhv-${++_rowCounter}-${Date.now().toString(36)}`;
}

export function BehaviorsPanel({
  script,
  onScriptChange,
  onClose,
}: BehaviorsPanelProps): React.ReactElement {
  const [rows, setRows] = useState<AttachedBehavior[]>([]);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [pendingBehavior, setPendingBehavior] = useState<Behavior | null>(null);

  const addBtnRef = useRef<HTMLButtonElement>(null);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleAddClick = useCallback(() => {
    setShowAddDropdown((v) => !v);
  }, []);

  const handleSelectBehavior = useCallback((behavior: Behavior) => {
    setShowAddDropdown(false);
    // If no params required, add immediately; otherwise open form
    if (behavior.params.length === 0) {
      const code = behavior.generate({});
      const newRow: AttachedBehavior = {
        id: nextRowId(),
        behaviorId: behavior.id,
        params: {},
        event: "On Release",
      };
      setRows((prev) => [...prev, newRow]);
      onScriptChange(
        script
          ? `${script}\n// [Behavior: ${behavior.id}]\n${code}`
          : `// [Behavior: ${behavior.id}]\n${code}`
      );
    } else {
      setPendingBehavior(behavior);
    }
  }, [script, onScriptChange]);

  const handleParamConfirm = useCallback(
    (params: Record<string, string>) => {
      if (!pendingBehavior) return;
      const code = pendingBehavior.generate(params);
      const newRow: AttachedBehavior = {
        id: nextRowId(),
        behaviorId: pendingBehavior.id,
        params,
        event: "On Release",
      };
      setRows((prev) => [...prev, newRow]);
      onScriptChange(
        script
          ? `${script}\n// [Behavior: ${pendingBehavior.id}]\n${code}`
          : `// [Behavior: ${pendingBehavior.id}]\n${code}`
      );
      setPendingBehavior(null);
    },
    [pendingBehavior, script, onScriptChange]
  );

  const handleParamCancel = useCallback(() => {
    setPendingBehavior(null);
  }, []);

  const handleRemove = useCallback(() => {
    if (!selectedRowId) return;
    setRows((prev) => prev.filter((r) => r.id !== selectedRowId));
    setSelectedRowId(null);
    // Note: we don't surgically remove from the script because the script
    // may have been manually edited; just remove the row tracking entry.
  }, [selectedRowId]);

  // -------------------------------------------------------------------------
  // Styles
  // -------------------------------------------------------------------------

  const panelStyle: React.CSSProperties = {
    position: "fixed",
    bottom: "40px",
    right: "260px",
    width: "300px",
    height: "280px",
    background: "#1e1e1e",
    border: "1px solid #444",
    boxShadow: "0 4px 24px rgba(0,0,0,0.7)",
    display: "flex",
    flexDirection: "column",
    zIndex: 2000,
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: "12px",
    color: "#d4d4d4",
    borderRadius: "4px",
    overflow: "visible",
  };

  const toolBtnStyle: React.CSSProperties = {
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: "3px",
    color: "#ccc",
    cursor: "pointer",
    fontSize: "14px",
    padding: "1px 6px",
    lineHeight: "1.2",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <>
      <div style={panelStyle}>
        {/* Title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: "24px",
            background: "#2d2d2d",
            borderBottom: "1px solid #444",
            padding: "0 8px",
            flexShrink: 0,
            userSelect: "none",
            borderRadius: "4px 4px 0 0",
          }}
        >
          <span style={{ fontSize: "11px", color: "#ccc" }}>Behaviors</span>
          <button
            style={{ ...toolBtnStyle, fontSize: "12px" }}
            onClick={onClose}
            title="Close"
          >
            &#x2715;
          </button>
        </div>

        {/* Toolbar: + and - buttons */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: "26px",
            background: "#252526",
            borderBottom: "1px solid #333",
            padding: "0 4px",
            gap: "2px",
            flexShrink: 0,
          }}
        >
          <button
            ref={addBtnRef}
            style={toolBtnStyle}
            title="Add Behavior"
            onClick={handleAddClick}
          >
            +
          </button>
          <button
            style={{
              ...toolBtnStyle,
              opacity: selectedRowId ? 1 : 0.4,
              cursor: selectedRowId ? "pointer" : "default",
            }}
            title="Remove selected behavior"
            onClick={handleRemove}
            disabled={!selectedRowId}
          >
            &minus;
          </button>
        </div>

        {/* Column headers */}
        <div
          style={{
            display: "flex",
            height: "20px",
            background: "#252526",
            borderBottom: "1px solid #2a2a2a",
            flexShrink: 0,
            userSelect: "none",
          }}
        >
          <div
            style={{
              flex: "0 0 100px",
              padding: "2px 8px",
              fontSize: "10px",
              color: "#888",
              borderRight: "1px solid #333",
            }}
          >
            Event
          </div>
          <div style={{ flex: 1, padding: "2px 8px", fontSize: "10px", color: "#888" }}>
            Action
          </div>
        </div>

        {/* Behavior rows */}
        <div style={{ flex: 1, overflowY: "auto", background: "#1e1e1e" }}>
          {rows.length === 0 ? (
            <div
              style={{
                padding: "12px 10px",
                color: "#666",
                fontSize: "11px",
                fontStyle: "italic",
              }}
            >
              No behaviors attached. Click + to add.
            </div>
          ) : (
            rows.map((row) => {
              const def = BEHAVIORS.find((b) => b.id === row.behaviorId);
              const isSelected = selectedRowId === row.id;
              return (
                <div
                  key={row.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    background: isSelected ? "#094771" : "transparent",
                    borderBottom: "1px solid #2a2a2a",
                    cursor: "default",
                    userSelect: "none",
                  }}
                  onClick={() => setSelectedRowId(isSelected ? null : row.id)}
                >
                  <div
                    style={{
                      flex: "0 0 100px",
                      padding: "4px 8px",
                      borderRight: "1px solid #2a2a2a",
                      fontSize: "11px",
                      color: isSelected ? "#fff" : "#ccc",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.event}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      padding: "4px 8px",
                      fontSize: "11px",
                      color: isSelected ? "#fff" : "#aaa",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {def?.name ?? row.behaviorId}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Status bar */}
        <div
          style={{
            height: "22px",
            background: "#007acc",
            display: "flex",
            alignItems: "center",
            padding: "0 8px",
            fontSize: "11px",
            color: "#fff",
            flexShrink: 0,
            borderRadius: "0 0 4px 4px",
          }}
        >
          {selectedRowId
            ? `Selected: ${BEHAVIORS.find((b) => b.id === rows.find((r) => r.id === selectedRowId)?.behaviorId)?.name ?? ""}`
            : "Select a behavior in the panel above to view its settings"}
        </div>
      </div>

      {/* Add Behavior dropdown */}
      {showAddDropdown && (
        <AddDropdown
          onSelect={handleSelectBehavior}
          onClose={() => setShowAddDropdown(false)}
          anchorRef={addBtnRef}
        />
      )}

      {/* Param form dialog */}
      {pendingBehavior && (
        <ParamForm
          behavior={pendingBehavior}
          onConfirm={handleParamConfirm}
          onCancel={handleParamCancel}
        />
      )}
    </>
  );
}

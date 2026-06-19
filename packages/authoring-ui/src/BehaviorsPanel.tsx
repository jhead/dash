import React, { useCallback, useEffect, useRef, useState } from "react";
import { BEHAVIORS, getBehaviorsByCategory } from "./behaviors.js";
import type { Behavior } from "./behaviors.js";
import type { AttachedBehavior, Frame } from "@flash/core";
import { chrome, halo, chromeFont } from "./theme/flash8Theme.js";

// Re-export so callers that imported AttachedBehavior from here continue to work.
export type { AttachedBehavior };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BehaviorsPanelProps {
  /** Current frame script text (read-only; used to seed the editor). */
  script: string;
  /** Called when the panel wants to append AS2 to the frame script. */
  onScriptChange: (script: string) => void;
  /** Called when the panel's close button is pressed. */
  onClose: () => void;
  /**
   * The currently selected keyframe. When provided, the panel seeds its rows
   * from `selectedFrame.behaviors` and persists changes back via
   * `onBehaviorsChange`.
   */
  selectedFrame?: Frame | null;
  /**
   * Called whenever the behaviors list changes (add/remove). The caller is
   * responsible for persisting the new list to the document model.
   */
  onBehaviorsChange?: (behaviors: ReadonlyArray<AttachedBehavior>) => void;
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
    ...chromeFont(),
    background: halo.inputBg,
    color: halo.text,
    borderStyle: "solid",
    borderWidth: 1,
    borderTopColor: halo.inputBorderDark,
    borderLeftColor: halo.inputBorderDark,
    borderRightColor: halo.inputBorderLight,
    borderBottomColor: halo.inputBorderLight,
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
          ...chromeFont(),
          background: chrome.panelBg,
          border: `${chrome.borderThin}px solid ${chrome.separator}`,
          borderRadius: "4px",
          minWidth: "300px",
          maxWidth: "400px",
          padding: "0",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Title bar */}
        <div
          style={{
            ...chromeFont(),
            padding: "8px 12px",
            borderBottom: `${chrome.borderThin}px solid ${halo.headerDivider}`,
            fontWeight: "bold",
            color: chrome.textDefault,
            background: `linear-gradient(${halo.panelHeaderGrad[0]}, ${halo.panelHeaderGrad[1]})`,
          }}
        >
          {behavior.name}
        </div>

        {/* Description */}
        <div
          style={{
            ...chromeFont(),
            padding: "8px 12px",
            color: chrome.textDefault,
            background: halo.panelContentBg,
            borderBottom: behavior.params.length > 0 ? `${chrome.borderThin}px solid ${chrome.separator}` : undefined,
          }}
        >
          {behavior.description}
        </div>

        {/* Parameter fields */}
        {behavior.params.length > 0 && (
          <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "8px", background: halo.panelContentBg }}>
            {behavior.params.map((p) => (
              <div key={p.key}>
                <label
                  style={{ ...chromeFont(), display: "block", color: chrome.textDefault, marginBottom: "3px" }}
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
            borderTop: `${chrome.borderThin}px solid ${chrome.separator}`,
            background: chrome.panelBg,
          }}
        >
          <button
            onClick={onCancel}
            style={{
              ...chromeFont(),
              background: `linear-gradient(${chrome.bevelLight}, ${chrome.insetFieldStrip})`,
              border: `1px solid ${halo.borderColor}`,
              borderRadius: halo.cornerRadius,
              color: halo.buttonColor,
              cursor: "pointer",
              padding: "4px 12px",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleOk}
            style={{
              ...chromeFont(),
              background: "linear-gradient(#D8F0FF, #99D7FF)",
              border: `1px solid ${halo.haloBlue}`,
              borderRadius: halo.cornerRadius,
              color: halo.textSelected,
              cursor: "pointer",
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
          ...chromeFont(),
          position: "fixed",
          top,
          left,
          minWidth: "220px",
          background: halo.panelContentBg,
          border: `${chrome.borderThin}px solid ${chrome.separator}`,
          borderRadius: "3px",
          boxShadow: "2px 4px 12px rgba(0,0,0,0.3)",
          zIndex: 3999,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {Array.from(grouped.entries()).map(([category, behaviors]) => (
          <div key={category}>
            {/* Category header */}
            <div
              style={{
                ...chromeFont(),
                padding: "4px 10px 2px",
                fontSize: 10,
                color: chrome.textDisabled,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                userSelect: "none",
                borderTop: `${chrome.borderThin}px solid ${chrome.separator}`,
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
        ...chromeFont(),
        padding: "4px 10px 4px 20px",
        color: chrome.textDefault,
        cursor: "default",
        background: hovered ? halo.rollOverColor : "transparent",
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
  selectedFrame,
  onBehaviorsChange,
}: BehaviorsPanelProps): React.ReactElement {
  const [rows, setRows] = useState<AttachedBehavior[]>(
    () => (selectedFrame?.behaviors ? [...selectedFrame.behaviors] : [])
  );
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [pendingBehavior, setPendingBehavior] = useState<Behavior | null>(null);

  const addBtnRef = useRef<HTMLButtonElement>(null);

  // Sync rows when the selected frame changes (e.g. user navigates to a
  // different keyframe that already has behaviors persisted to the model).
  useEffect(() => {
    setRows(selectedFrame?.behaviors ? [...selectedFrame.behaviors] : []);
    setSelectedRowId(null);
  }, [selectedFrame]);

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
      setRows((prev) => {
        const next = [...prev, newRow];
        onBehaviorsChange?.(next);
        return next;
      });
      onScriptChange(
        script
          ? `${script}\n// [Behavior: ${behavior.id}]\n${code}`
          : `// [Behavior: ${behavior.id}]\n${code}`
      );
    } else {
      setPendingBehavior(behavior);
    }
  }, [script, onScriptChange, onBehaviorsChange]);

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
      setRows((prev) => {
        const next = [...prev, newRow];
        onBehaviorsChange?.(next);
        return next;
      });
      onScriptChange(
        script
          ? `${script}\n// [Behavior: ${pendingBehavior.id}]\n${code}`
          : `// [Behavior: ${pendingBehavior.id}]\n${code}`
      );
      setPendingBehavior(null);
    },
    [pendingBehavior, script, onScriptChange, onBehaviorsChange]
  );

  const handleParamCancel = useCallback(() => {
    setPendingBehavior(null);
  }, []);

  const handleRemove = useCallback(() => {
    if (!selectedRowId) return;
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== selectedRowId);
      onBehaviorsChange?.(next);
      return next;
    });
    setSelectedRowId(null);
    // Note: we don't surgically remove from the script because the script
    // may have been manually edited; just remove the row tracking entry.
  }, [selectedRowId, onBehaviorsChange]);

  // -------------------------------------------------------------------------
  // Styles
  // -------------------------------------------------------------------------

  const panelStyle: React.CSSProperties = {
    ...chromeFont(),
    position: "fixed",
    bottom: "40px",
    right: "260px",
    width: "300px",
    height: "280px",
    background: chrome.panelBg,
    border: `${chrome.borderThin}px solid ${chrome.separator}`,
    boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
    display: "flex",
    flexDirection: "column",
    zIndex: 2000,
    color: chrome.textDefault,
    borderRadius: "4px",
    overflow: "visible",
  };

  const toolBtnStyle: React.CSSProperties = {
    ...chromeFont(),
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: "3px",
    color: halo.buttonColor,
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
            background: `linear-gradient(${halo.panelHeaderGrad[0]}, ${halo.panelHeaderGrad[1]})`,
            borderBottom: `${chrome.borderThin}px solid ${halo.headerDivider}`,
            padding: "0 8px",
            flexShrink: 0,
            userSelect: "none",
            borderRadius: "4px 4px 0 0",
          }}
        >
          <span style={{ ...chromeFont(), fontWeight: "bold", color: chrome.textDefault }}>Behaviors</span>
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
            background: chrome.panelBg,
            borderBottom: `${chrome.borderThin}px solid ${chrome.separator}`,
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
            background: `linear-gradient(${halo.panelHeaderGrad[0]}, ${halo.panelHeaderGrad[1]})`,
            borderBottom: `${chrome.borderThin}px solid ${chrome.separator}`,
            flexShrink: 0,
            userSelect: "none",
          }}
        >
          <div
            style={{
              ...chromeFont(),
              flex: "0 0 100px",
              padding: "2px 8px",
              color: chrome.textDefault,
              borderRight: `${chrome.borderThin}px solid ${chrome.separator}`,
            }}
          >
            Event
          </div>
          <div style={{ ...chromeFont(), flex: 1, padding: "2px 8px", color: chrome.textDefault }}>
            Action
          </div>
        </div>

        {/* Behavior rows */}
        <div style={{ flex: 1, overflowY: "auto", background: halo.panelContentBg }}>
          {rows.length === 0 ? (
            <div
              style={{
                ...chromeFont(),
                padding: "12px 10px",
                color: chrome.textDisabled,
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
                    background: isSelected ? halo.selectionColor : "transparent",
                    borderBottom: `${chrome.borderThin}px solid ${halo.separator}`,
                    cursor: "default",
                    userSelect: "none",
                  }}
                  onClick={() => setSelectedRowId(isSelected ? null : row.id)}
                >
                  <div
                    style={{
                      ...chromeFont(),
                      flex: "0 0 100px",
                      padding: "4px 8px",
                      borderRight: `${chrome.borderThin}px solid ${halo.separator}`,
                      color: isSelected ? halo.textSelected : chrome.textDefault,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.event}
                  </div>
                  <div
                    style={{
                      ...chromeFont(),
                      flex: 1,
                      padding: "4px 8px",
                      color: isSelected ? halo.textSelected : chrome.textDefault,
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
            ...chromeFont(),
            height: "22px",
            background: `linear-gradient(${halo.footerGrad[0]}, ${halo.footerGrad[1]})`,
            borderTop: `${chrome.borderThin}px solid ${halo.headerDivider}`,
            display: "flex",
            alignItems: "center",
            padding: "0 8px",
            color: chrome.textDefault,
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

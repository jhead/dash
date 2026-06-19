/**
 * AccessibilityPanel — Flash 8-style Window > Accessibility panel.
 *
 * Document section: "Make movie accessible" + "Make child objects accessible"
 * + "Use custom tab order" checkboxes.
 *
 * Object section (shown when a SymbolInstance or TextDisplayObject is selected):
 * "Make object accessible", Name, Description, Shortcut, Tab index fields.
 *
 * Changes are propagated via onDocChange / onObjectChange callbacks so the
 * parent (Shell) can pushDoc to history.
 */

import React, { useCallback } from "react";
import type { DocumentAccessibility, FlashDocument } from "@flash/core";
import type { ObjectAccessibility } from "@flash/core";
import { chrome, halo, chromeFont, titleBarStyle } from "./theme/flash8Theme.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AccessibilityPanelProps {
  /** Current document (for document-level accessibility settings). */
  doc: FlashDocument;
  /**
   * The id of the currently selected display object (SymbolInstance or
   * TextDisplayObject), or null when nothing (or an unsupported object type)
   * is selected.
   */
  selectedObjectId: string | null;
  /**
   * The accessibility props of the selected object, or null when nothing is
   * selected or the object has no accessibility data yet.
   */
  selectedObjectAccessibility: ObjectAccessibility | null;
  /** Called when the document-level accessibility settings change. */
  onDocChange: (a: DocumentAccessibility) => void;
  /**
   * Called when the object-level accessibility properties change.
   * Only invoked when selectedObjectId is not null.
   */
  onObjectChange: (id: string, a: ObjectAccessibility) => void;
  /** Called when the panel's close button is pressed. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const PANEL: React.CSSProperties = {
  position: "fixed",
  top: "60px",
  left: "220px",
  zIndex: 2000,
  background: chrome.panelBg,
  border: `${chrome.borderThin}px solid ${chrome.separator}`,
  minWidth: "260px",
  maxWidth: "320px",
  boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
  display: "flex",
  flexDirection: "column",
  ...chromeFont(),
  userSelect: "none",
};

const TITLE_BAR: React.CSSProperties = {
  ...titleBarStyle(),
  justifyContent: "space-between",
};

const SECTION_HEADER: React.CSSProperties = {
  padding: "4px 8px",
  background: chrome.insetFieldStrip,
  borderTop: `${chrome.borderThin}px solid ${chrome.separator}`,
  borderBottom: `${chrome.borderThin}px solid ${chrome.separator}`,
  fontWeight: "bold",
  ...chromeFont(),
  color: chrome.textDefault,
};

const BODY: React.CSSProperties = {
  padding: "8px",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  background: halo.panelContentBg,
};

const CLOSE_BTN: React.CSSProperties = {
  background: "none",
  border: "none",
  color: chrome.textDefault,
  cursor: "pointer",
  fontSize: "14px",
  lineHeight: 1,
  padding: "0 2px",
};

const CHECKBOX_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  cursor: "pointer",
  ...chromeFont(),
};

const FIELD_ROW: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
};

const LABEL: React.CSSProperties = {
  ...chromeFont(),
  color: chrome.textDefault,
};

const INPUT: React.CSSProperties = {
  background: halo.inputBg,
  borderStyle: "solid",
  borderWidth: 1,
  borderTopColor: halo.inputBorderDark,
  borderLeftColor: halo.inputBorderDark,
  borderRightColor: halo.inputBorderLight,
  borderBottomColor: halo.inputBorderLight,
  color: halo.text,
  fontSize: "11px",
  fontFamily: chrome.fontFamily,
  padding: "2px 5px",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

// ---------------------------------------------------------------------------
// Default accessibility values
// ---------------------------------------------------------------------------

const DEFAULT_DOC_ACCESS: DocumentAccessibility = {
  enabled: false,
  makeChildrenAccessible: true,
  useCustomTabOrder: false,
};

const DEFAULT_OBJ_ACCESS: ObjectAccessibility = {
  enabled: true,
  name: "",
  description: "",
  shortcut: "",
  tabIndex: undefined,
  forceSimple: false,
};

// ---------------------------------------------------------------------------
// AccessibilityPanel
// ---------------------------------------------------------------------------

export function AccessibilityPanel({
  doc,
  selectedObjectId,
  selectedObjectAccessibility,
  onDocChange,
  onObjectChange,
  onClose,
}: AccessibilityPanelProps): React.ReactElement {
  const docAcc = doc.accessibility ?? DEFAULT_DOC_ACCESS;
  const objAcc = selectedObjectAccessibility ?? DEFAULT_OBJ_ACCESS;

  // ---- Document-level handlers ----

  const handleDocEnabled = useCallback(() => {
    onDocChange({ ...docAcc, enabled: !docAcc.enabled });
  }, [docAcc, onDocChange]);

  const handleDocChildren = useCallback(() => {
    onDocChange({ ...docAcc, makeChildrenAccessible: !docAcc.makeChildrenAccessible });
  }, [docAcc, onDocChange]);

  const handleDocTabOrder = useCallback(() => {
    onDocChange({ ...docAcc, useCustomTabOrder: !docAcc.useCustomTabOrder });
  }, [docAcc, onDocChange]);

  // ---- Object-level handlers ----

  const handleObjEnabled = useCallback(() => {
    if (!selectedObjectId) return;
    onObjectChange(selectedObjectId, { ...objAcc, enabled: !objAcc.enabled });
  }, [selectedObjectId, objAcc, onObjectChange]);

  const handleObjName = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedObjectId) return;
    onObjectChange(selectedObjectId, { ...objAcc, name: e.target.value });
  }, [selectedObjectId, objAcc, onObjectChange]);

  const handleObjDescription = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedObjectId) return;
    onObjectChange(selectedObjectId, { ...objAcc, description: e.target.value });
  }, [selectedObjectId, objAcc, onObjectChange]);

  const handleObjShortcut = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedObjectId) return;
    onObjectChange(selectedObjectId, { ...objAcc, shortcut: e.target.value });
  }, [selectedObjectId, objAcc, onObjectChange]);

  const handleObjTabIndex = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedObjectId) return;
    const v = e.target.value.trim();
    const n = v === "" ? undefined : parseInt(v, 10);
    onObjectChange(selectedObjectId, { ...objAcc, tabIndex: isNaN(n as number) ? undefined : n });
  }, [selectedObjectId, objAcc, onObjectChange]);

  const handleObjForceSimple = useCallback(() => {
    if (!selectedObjectId) return;
    onObjectChange(selectedObjectId, { ...objAcc, forceSimple: !objAcc.forceSimple });
  }, [selectedObjectId, objAcc, onObjectChange]);

  // ---- Render ----

  return (
    <div style={PANEL} data-testid="accessibility-panel">
      {/* Title bar */}
      <div style={TITLE_BAR}>
        <span style={{ fontWeight: "bold", fontSize: "11px" }}>Accessibility</span>
        <button style={CLOSE_BTN} onClick={onClose} title="Close">x</button>
      </div>

      {/* Document section */}
      <div style={SECTION_HEADER}>Movie</div>
      <div style={BODY}>
        <label style={CHECKBOX_ROW}>
          <input
            type="checkbox"
            checked={docAcc.enabled}
            onChange={handleDocEnabled}
            data-testid="acc-doc-enabled"
          />
          Make movie accessible
        </label>
        <label
          style={{
            ...CHECKBOX_ROW,
            opacity: docAcc.enabled ? 1 : 0.4,
            pointerEvents: docAcc.enabled ? "auto" : "none",
          }}
        >
          <input
            type="checkbox"
            checked={docAcc.makeChildrenAccessible}
            onChange={handleDocChildren}
            disabled={!docAcc.enabled}
            data-testid="acc-doc-children"
          />
          Make child objects accessible
        </label>
        <label
          style={{
            ...CHECKBOX_ROW,
            opacity: docAcc.enabled ? 1 : 0.4,
            pointerEvents: docAcc.enabled ? "auto" : "none",
          }}
        >
          <input
            type="checkbox"
            checked={docAcc.useCustomTabOrder}
            onChange={handleDocTabOrder}
            disabled={!docAcc.enabled}
            data-testid="acc-doc-tab-order"
          />
          Use custom tab order
        </label>
      </div>

      {/* Object section — only shown when an object is selected */}
      {selectedObjectId !== null && (
        <>
          <div style={SECTION_HEADER}>Object</div>
          <div style={BODY}>
            <label style={CHECKBOX_ROW}>
              <input
                type="checkbox"
                checked={objAcc.enabled}
                onChange={handleObjEnabled}
                data-testid="acc-obj-enabled"
              />
              Make object accessible
            </label>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                opacity: objAcc.enabled ? 1 : 0.4,
                pointerEvents: objAcc.enabled ? "auto" : "none",
              }}
            >
              <div style={FIELD_ROW}>
                <span style={LABEL}>Name</span>
                <input
                  type="text"
                  style={INPUT}
                  value={objAcc.name ?? ""}
                  onChange={handleObjName}
                  placeholder="MSAA name"
                  disabled={!objAcc.enabled}
                  data-testid="acc-obj-name"
                />
              </div>

              <div style={FIELD_ROW}>
                <span style={LABEL}>Description</span>
                <input
                  type="text"
                  style={INPUT}
                  value={objAcc.description ?? ""}
                  onChange={handleObjDescription}
                  placeholder="MSAA description"
                  disabled={!objAcc.enabled}
                  data-testid="acc-obj-description"
                />
              </div>

              <div style={FIELD_ROW}>
                <span style={LABEL}>Shortcut</span>
                <input
                  type="text"
                  style={INPUT}
                  value={objAcc.shortcut ?? ""}
                  onChange={handleObjShortcut}
                  placeholder="Keyboard shortcut hint"
                  disabled={!objAcc.enabled}
                  data-testid="acc-obj-shortcut"
                />
              </div>

              <div style={FIELD_ROW}>
                <span style={LABEL}>Tab index</span>
                <input
                  type="number"
                  style={INPUT}
                  value={objAcc.tabIndex ?? ""}
                  onChange={handleObjTabIndex}
                  placeholder="Auto"
                  min={0}
                  disabled={!objAcc.enabled}
                  data-testid="acc-obj-tab-index"
                />
              </div>

              <label style={CHECKBOX_ROW}>
                <input
                  type="checkbox"
                  checked={objAcc.forceSimple ?? false}
                  onChange={handleObjForceSimple}
                  disabled={!objAcc.enabled}
                  data-testid="acc-obj-force-simple"
                />
                Force simple
              </label>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * ComponentInspectorPanel — Flash 8-style Component Inspector (Parameters tab).
 *
 * Edits the inspectable parameters of a selected v2 component instance. The
 * parameter values are persisted on the SymbolInstance model
 * (`componentParameters`, a name → string map) via `onChange`. The control type
 * per parameter (string / number / boolean / list / array) comes from the
 * built-in component definition. See docs/13-components.md.
 *
 * Scope (task 1222): the Parameters tab only. The Bindings and Schema tabs are
 * intentionally rendered as disabled stubs (Data Integration is out of scope and
 * tracked separately).
 */

import React, { useState } from "react";
import {
  getComponentDef,
  defaultComponentParameters,
  type ComponentDef,
  type ComponentParamDef,
} from "@flash/core";
import { chrome, halo, chromeFont } from "./theme/flash8Theme.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ComponentInspectorPanelProps {
  /** The component's class/display name (resolves the parameter definitions). */
  componentName: string;
  /** Current parameter values (name → string). Missing values fall back to defaults. */
  values: Record<string, string>;
  /** Commit a single parameter change; the parent merges it into the instance model. */
  onChange: (values: Record<string, string>) => void;
  /** Override the component definition lookup (testing). */
  def?: ComponentDef;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  tabBar: {
    display: "flex",
    borderBottom: `${chrome.borderThin}px solid ${chrome.separator}`,
    background: chrome.panelBg,
  },
  tab: {
    padding: "4px 10px",
    ...chromeFont(),
    cursor: "pointer",
    color: chrome.textDisabled,
    borderRight: `${chrome.borderThin}px solid ${chrome.separator}`,
  },
  tabActive: {
    padding: "4px 10px",
    ...chromeFont(),
    cursor: "default",
    color: chrome.textDefault,
    background: halo.panelContentBg,
    borderRight: `${chrome.borderThin}px solid ${chrome.separator}`,
    borderBottom: `2px solid ${halo.haloBlue}`,
  },
  table: {
    display: "grid",
    gridTemplateColumns: "minmax(80px, 40%) 1fr",
    gap: 0,
    ...chromeFont(),
    background: halo.panelContentBg,
  },
  labelCell: {
    padding: "3px 6px",
    color: chrome.textDefault,
    borderBottom: `${chrome.borderThin}px solid ${halo.separator}`,
    display: "flex",
    alignItems: "center",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    ...chromeFont(),
  },
  valueCell: {
    padding: "2px 6px",
    borderBottom: `${chrome.borderThin}px solid ${halo.separator}`,
    display: "flex",
    alignItems: "center",
  },
  input: {
    width: "100%",
    background: halo.inputBg,
    borderStyle: "solid",
    borderWidth: 1,
    borderTopColor: halo.inputBorderDark,
    borderLeftColor: halo.inputBorderDark,
    borderRightColor: halo.inputBorderLight,
    borderBottomColor: halo.inputBorderLight,
    color: halo.text,
    fontSize: 11,
    fontFamily: chrome.fontFamily,
    padding: "1px 4px",
    boxSizing: "border-box",
  },
  empty: {
    padding: "8px",
    ...chromeFont(),
    color: chrome.textDisabled,
  },
};

// ---------------------------------------------------------------------------
// Per-parameter editors
// ---------------------------------------------------------------------------

function ParamEditor({
  param,
  value,
  onCommit,
}: {
  param: ComponentParamDef;
  value: string;
  onCommit: (v: string) => void;
}) {
  // Drafted text inputs commit on blur / Enter so each keystroke is not a
  // separate undo entry (matches InstancePanel's NumInput convention).
  const [draft, setDraft] = useState(value);
  // Keep draft in sync when the underlying value changes externally.
  React.useEffect(() => setDraft(value), [value]);

  if (param.type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={value === "true"}
        data-testid={`param-${param.name}`}
        onChange={(e) => onCommit(e.target.checked ? "true" : "false")}
      />
    );
  }

  if (param.type === "list") {
    return (
      <select
        style={styles.input}
        value={value}
        data-testid={`param-${param.name}`}
        onChange={(e) => onCommit(e.target.value)}
      >
        {(param.options ?? []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  // string | number | array → text field (number uses numeric input mode)
  return (
    <input
      type={param.type === "number" ? "number" : "text"}
      style={styles.input}
      value={draft}
      data-testid={`param-${param.name}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// ComponentInspectorPanel
// ---------------------------------------------------------------------------

export function ComponentInspectorPanel({
  componentName,
  values,
  onChange,
  def,
}: ComponentInspectorPanelProps) {
  const [tab, setTab] = useState<"parameters" | "bindings" | "schema">("parameters");
  const resolved = def ?? getComponentDef(componentName);

  const commit = (name: string, v: string) => {
    // Merge over the full default set so a previously-unset parameter persists
    // a complete map on the model.
    const base = resolved ? defaultComponentParameters(resolved) : {};
    onChange({ ...base, ...values, [name]: v });
  };

  return (
    <div data-testid="component-inspector">
      <div style={styles.tabBar}>
        <div
          style={tab === "parameters" ? styles.tabActive : styles.tab}
          onClick={() => setTab("parameters")}
        >
          Parameters
        </div>
        {/* Bindings / Schema are Data Integration features — out of scope. */}
        <div style={{ ...styles.tab, cursor: "not-allowed", opacity: 0.5 }} title="Not implemented">
          Bindings
        </div>
        <div style={{ ...styles.tab, cursor: "not-allowed", opacity: 0.5 }} title="Not implemented">
          Schema
        </div>
      </div>

      {tab === "parameters" &&
        (resolved ? (
          <div style={styles.table}>
            {resolved.parameters.map((param) => {
              const v = values[param.name] ?? param.defaultValue;
              return (
                <React.Fragment key={param.name}>
                  <div style={styles.labelCell} title={param.name}>
                    {param.name}
                  </div>
                  <div style={styles.valueCell}>
                    <ParamEditor
                      param={param}
                      value={v}
                      onCommit={(nv) => commit(param.name, nv)}
                    />
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        ) : (
          <div style={styles.empty}>No parameters for "{componentName}".</div>
        ))}
    </div>
  );
}

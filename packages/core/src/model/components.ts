/**
 * Built-in Version 2 (v2) component catalog.
 *
 * Flash 8 ships the v2 component architecture: pre-built, parameterized
 * MovieClip symbols backed by AS2 classes (see docs/13-components.md). This
 * module describes the *authoring-time* metadata for the built-in UI components
 * the Components panel offers: their display name, AS2 package/class, and the
 * inspectable **parameters** that appear in the Component Inspector's
 * Parameters tab.
 *
 * Scope (task 1222): the v2 *UI* component set + their parameters. Data
 * components (DataSet/XMLConnector/...), the Bindings/Schema tabs, and live
 * binding semantics are intentionally out of scope and live in separate tasks.
 */

/** The kind of editor a component parameter exposes in the inspector. */
export type ComponentParamType = "string" | "number" | "boolean" | "list" | "array";

/** One inspectable parameter of a built-in component. */
export interface ComponentParamDef {
  /** AS2 instance variable name (e.g. "label", "selected"). */
  readonly name: string;
  /** Editor control to render in the Component Inspector. */
  readonly type: ComponentParamType;
  /** Default value, serialized as a string (the on-model storage form). */
  readonly defaultValue: string;
  /** For `type: "list"`, the set of allowed values. */
  readonly options?: readonly string[];
}

/** Definition of a single built-in v2 component. */
export interface ComponentDef {
  /** Display name shown in the Components panel and used as the library item name. */
  readonly name: string;
  /** AS2 class name (e.g. "Button"). */
  readonly className: string;
  /** AS2 package (e.g. "mx.controls"). */
  readonly packageName: string;
  /** Components panel group/category. */
  readonly category: string;
  /** Default placement size in pixels. */
  readonly defaultWidth: number;
  readonly defaultHeight: number;
  /** Inspectable parameters (Component Inspector Parameters tab). */
  readonly parameters: readonly ComponentParamDef[];
}

const MX_CONTROLS = "mx.controls";
const MX_CONTAINERS = "mx.containers";

/**
 * The built-in v2 UI components. Parameter sets mirror the inspectable
 * properties Flash 8 exposes in the Component Inspector for each control.
 */
export const BUILTIN_COMPONENTS: readonly ComponentDef[] = [
  {
    name: "Button",
    className: "Button",
    packageName: MX_CONTROLS,
    category: "UI Components",
    defaultWidth: 100,
    defaultHeight: 22,
    parameters: [
      { name: "label", type: "string", defaultValue: "Button" },
      { name: "labelPlacement", type: "list", defaultValue: "right", options: ["left", "right", "top", "bottom"] },
      { name: "selected", type: "boolean", defaultValue: "false" },
      { name: "toggle", type: "boolean", defaultValue: "false" },
      { name: "enabled", type: "boolean", defaultValue: "true" },
      { name: "visible", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    name: "CheckBox",
    className: "CheckBox",
    packageName: MX_CONTROLS,
    category: "UI Components",
    defaultWidth: 100,
    defaultHeight: 22,
    parameters: [
      { name: "label", type: "string", defaultValue: "CheckBox" },
      { name: "labelPlacement", type: "list", defaultValue: "right", options: ["left", "right", "top", "bottom"] },
      { name: "selected", type: "boolean", defaultValue: "false" },
      { name: "enabled", type: "boolean", defaultValue: "true" },
      { name: "visible", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    name: "RadioButton",
    className: "RadioButton",
    packageName: MX_CONTROLS,
    category: "UI Components",
    defaultWidth: 100,
    defaultHeight: 22,
    parameters: [
      { name: "label", type: "string", defaultValue: "Radio Button" },
      { name: "labelPlacement", type: "list", defaultValue: "right", options: ["left", "right", "top", "bottom"] },
      { name: "data", type: "string", defaultValue: "" },
      { name: "groupName", type: "string", defaultValue: "radioGroup" },
      { name: "selected", type: "boolean", defaultValue: "false" },
      { name: "enabled", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    name: "Label",
    className: "Label",
    packageName: MX_CONTROLS,
    category: "UI Components",
    defaultWidth: 100,
    defaultHeight: 22,
    parameters: [
      { name: "text", type: "string", defaultValue: "Label" },
      { name: "html", type: "boolean", defaultValue: "false" },
      { name: "autoSize", type: "list", defaultValue: "none", options: ["none", "left", "center", "right"] },
      { name: "visible", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    name: "TextInput",
    className: "TextInput",
    packageName: MX_CONTROLS,
    category: "UI Components",
    defaultWidth: 100,
    defaultHeight: 22,
    parameters: [
      { name: "text", type: "string", defaultValue: "" },
      { name: "editable", type: "boolean", defaultValue: "true" },
      { name: "password", type: "boolean", defaultValue: "false" },
      { name: "maxChars", type: "number", defaultValue: "0" },
      { name: "restrict", type: "string", defaultValue: "" },
      { name: "enabled", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    name: "TextArea",
    className: "TextArea",
    packageName: MX_CONTROLS,
    category: "UI Components",
    defaultWidth: 100,
    defaultHeight: 100,
    parameters: [
      { name: "text", type: "string", defaultValue: "" },
      { name: "editable", type: "boolean", defaultValue: "true" },
      { name: "html", type: "boolean", defaultValue: "false" },
      { name: "wordWrap", type: "boolean", defaultValue: "true" },
      { name: "maxChars", type: "number", defaultValue: "0" },
      { name: "enabled", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    name: "ComboBox",
    className: "ComboBox",
    packageName: MX_CONTROLS,
    category: "UI Components",
    defaultWidth: 100,
    defaultHeight: 22,
    parameters: [
      { name: "data", type: "array", defaultValue: "" },
      { name: "labels", type: "array", defaultValue: "" },
      { name: "editable", type: "boolean", defaultValue: "false" },
      { name: "rowCount", type: "number", defaultValue: "5" },
      { name: "enabled", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    name: "List",
    className: "List",
    packageName: MX_CONTROLS,
    category: "UI Components",
    defaultWidth: 100,
    defaultHeight: 100,
    parameters: [
      { name: "data", type: "array", defaultValue: "" },
      { name: "labels", type: "array", defaultValue: "" },
      { name: "multipleSelection", type: "boolean", defaultValue: "false" },
      { name: "rowHeight", type: "number", defaultValue: "20" },
      { name: "enabled", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    name: "DataGrid",
    className: "DataGrid",
    packageName: MX_CONTROLS,
    category: "UI Components",
    defaultWidth: 200,
    defaultHeight: 100,
    parameters: [
      { name: "multipleSelection", type: "boolean", defaultValue: "false" },
      { name: "editable", type: "boolean", defaultValue: "false" },
      { name: "rowHeight", type: "number", defaultValue: "20" },
      { name: "enabled", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    name: "NumericStepper",
    className: "NumericStepper",
    packageName: MX_CONTROLS,
    category: "UI Components",
    defaultWidth: 60,
    defaultHeight: 22,
    parameters: [
      { name: "value", type: "number", defaultValue: "0" },
      { name: "minimum", type: "number", defaultValue: "0" },
      { name: "maximum", type: "number", defaultValue: "10" },
      { name: "stepSize", type: "number", defaultValue: "1" },
      { name: "enabled", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    name: "ScrollPane",
    className: "ScrollPane",
    packageName: MX_CONTAINERS,
    category: "UI Components",
    defaultWidth: 180,
    defaultHeight: 180,
    parameters: [
      { name: "contentPath", type: "string", defaultValue: "" },
      { name: "hLineScrollSize", type: "number", defaultValue: "5" },
      { name: "vLineScrollSize", type: "number", defaultValue: "5" },
      { name: "scrollDrag", type: "boolean", defaultValue: "false" },
      { name: "enabled", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    name: "ProgressBar",
    className: "ProgressBar",
    packageName: MX_CONTROLS,
    category: "UI Components",
    defaultWidth: 150,
    defaultHeight: 16,
    parameters: [
      { name: "mode", type: "list", defaultValue: "event", options: ["event", "polled", "manual"] },
      { name: "source", type: "string", defaultValue: "" },
      { name: "direction", type: "list", defaultValue: "right", options: ["left", "right"] },
      { name: "label", type: "string", defaultValue: "LOADING %3%%" },
      { name: "labelPlacement", type: "list", defaultValue: "bottom", options: ["left", "right", "top", "bottom", "center"] },
    ],
  },
  {
    name: "Loader",
    className: "Loader",
    packageName: MX_CONTROLS,
    category: "UI Components",
    defaultWidth: 100,
    defaultHeight: 100,
    parameters: [
      { name: "contentPath", type: "string", defaultValue: "" },
      { name: "autoLoad", type: "boolean", defaultValue: "true" },
      { name: "scaleContent", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    name: "Window",
    className: "Window",
    packageName: MX_CONTAINERS,
    category: "UI Components",
    defaultWidth: 200,
    defaultHeight: 150,
    parameters: [
      { name: "title", type: "string", defaultValue: "" },
      { name: "closeButton", type: "boolean", defaultValue: "false" },
      { name: "contentPath", type: "string", defaultValue: "" },
    ],
  },
  {
    name: "Accordion",
    className: "Accordion",
    packageName: MX_CONTAINERS,
    category: "UI Components",
    defaultWidth: 200,
    defaultHeight: 200,
    parameters: [
      { name: "enabled", type: "boolean", defaultValue: "true" },
      { name: "visible", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    name: "MenuBar",
    className: "MenuBar",
    packageName: MX_CONTROLS,
    category: "UI Components",
    defaultWidth: 200,
    defaultHeight: 22,
    parameters: [
      { name: "enabled", type: "boolean", defaultValue: "true" },
      { name: "visible", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    name: "Tree",
    className: "Tree",
    packageName: MX_CONTROLS,
    category: "UI Components",
    defaultWidth: 150,
    defaultHeight: 150,
    parameters: [
      { name: "multipleSelection", type: "boolean", defaultValue: "false" },
      { name: "rowHeight", type: "number", defaultValue: "20" },
      { name: "enabled", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    name: "DateChooser",
    className: "DateChooser",
    packageName: MX_CONTROLS,
    category: "UI Components",
    defaultWidth: 180,
    defaultHeight: 150,
    parameters: [
      { name: "dayNames", type: "array", defaultValue: "S,M,T,W,T,F,S" },
      { name: "firstDayOfWeek", type: "number", defaultValue: "0" },
      { name: "showToday", type: "boolean", defaultValue: "true" },
      { name: "enabled", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    name: "DateField",
    className: "DateField",
    packageName: MX_CONTROLS,
    category: "UI Components",
    defaultWidth: 100,
    defaultHeight: 22,
    parameters: [
      { name: "dayNames", type: "array", defaultValue: "S,M,T,W,T,F,S" },
      { name: "firstDayOfWeek", type: "number", defaultValue: "0" },
      { name: "showToday", type: "boolean", defaultValue: "true" },
      { name: "enabled", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    name: "UIScrollBar",
    className: "UIScrollBar",
    packageName: MX_CONTROLS,
    category: "UI Components",
    defaultWidth: 16,
    defaultHeight: 100,
    parameters: [
      { name: "horizontal", type: "boolean", defaultValue: "false" },
      { name: "scrollTargetName", type: "string", defaultValue: "" },
    ],
  },
];

/** Look up a built-in component definition by its display/class name. */
export function getComponentDef(name: string): ComponentDef | undefined {
  return BUILTIN_COMPONENTS.find(
    (c) => c.name === name || c.className === name
  );
}

/**
 * Build the default parameter map for a component (parameter name → string
 * value). This is the initial `componentParameters` an instance carries when
 * first placed on stage.
 */
export function defaultComponentParameters(def: ComponentDef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of def.parameters) {
    out[p.name] = p.defaultValue;
  }
  return out;
}

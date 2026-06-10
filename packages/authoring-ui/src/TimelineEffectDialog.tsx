import React, { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TimelineEffectType =
  | "transform"
  | "transition"
  | "blur"
  | "drop-shadow"
  | "expand"
  | "explode"
  | "copy-to-grid"
  | "distributed-duplicate";

export interface TransformEffectParams {
  effect: "transform";
  duration: number;        // frames, default 30
  scaleX: number;          // end scale X (1 = 100%), default 1
  scaleY: number;          // end scale Y (1 = 100%), default 1
  rotation: number;        // end rotation in degrees, default 0
  alpha: number;           // end alpha 0-100, default 100
  ease: number;            // -100..100, default 0
}

export interface TransitionEffectParams {
  effect: "transition";
  duration: number;        // frames, default 30
  direction: "in" | "out";
  type: "fade" | "wipe";
  ease: number;            // -100..100, default 0
}

export interface BlurEffectParams {
  effect: "blur";
  duration: number;
  blurX: number;
  blurY: number;
  ease: number;
}

export interface DropShadowEffectParams {
  effect: "drop-shadow";
  duration: number;
  angle: number;
  distance: number;
  blur: number;
  alpha: number;
  ease: number;
}

export interface ExpandEffectParams {
  effect: "expand";
  duration: number;
  direction: "expand" | "contract";
  shiftX: number;
  shiftY: number;
}

export interface ExplodeEffectParams {
  effect: "explode";
  duration: number;
  arcSize: number;
  finalAlpha: number;
  ease: number;
}

export interface CopyToGridEffectParams {
  effect: "copy-to-grid";
  rows: number;
  columns: number;
  rowSpacing: number;
  columnSpacing: number;
}

export interface DistributedDuplicateEffectParams {
  effect: "distributed-duplicate";
  count: number;
  offsetX: number;
  offsetY: number;
  scaleTo: number;
  alphaTo: number;
  rotateTo: number;
}

export type EffectParams =
  | TransformEffectParams
  | TransitionEffectParams
  | BlurEffectParams
  | DropShadowEffectParams
  | ExpandEffectParams
  | ExplodeEffectParams
  | CopyToGridEffectParams
  | DistributedDuplicateEffectParams;

export interface TimelineEffectDialogProps {
  open: boolean;
  initialEffect?: TimelineEffectType;
  onApply: (params: EffectParams) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Styles (matches the rest of the Flash 8 UI palette)
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  dialog: {
    position: "fixed",
    background: "#3c3c3c",
    border: "1px solid #666",
    boxShadow: "4px 4px 12px rgba(0,0,0,0.6)",
    minWidth: "340px",
    zIndex: 1000,
    fontFamily: "Tahoma, Arial, sans-serif",
    fontSize: "11px",
    color: "#e0e0e0",
    userSelect: "none",
  },
  titleBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "#2a2a2a",
    borderBottom: "1px solid #555",
    padding: "4px 6px",
    cursor: "default",
  },
  titleText: {
    fontSize: "11px",
    fontWeight: "bold",
    color: "#e0e0e0",
  },
  closeBtn: {
    background: "#666",
    border: "1px solid #888",
    color: "#e0e0e0",
    width: "14px",
    height: "14px",
    fontSize: "10px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    lineHeight: 1,
  },
  body: {
    padding: "10px 12px",
  },
  tabRow: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: "2px",
    marginBottom: "10px",
  },
  tab: {
    background: "#555",
    border: "1px solid #777",
    color: "#ccc",
    fontSize: "11px",
    padding: "3px 10px",
    cursor: "pointer",
  },
  tabActive: {
    background: "#1a6ea8",
    border: "1px solid #2288cc",
    color: "#fff",
    fontSize: "11px",
    padding: "3px 10px",
    cursor: "pointer",
  },
  row: {
    display: "flex",
    alignItems: "center",
    marginBottom: "7px",
  },
  label: {
    width: "120px",
    flexShrink: 0,
    fontSize: "11px",
    color: "#ccc",
  },
  input: {
    width: "80px",
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
  },
  select: {
    width: "120px",
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
  },
  unit: {
    marginLeft: "4px",
    color: "#999",
    fontSize: "10px",
  },
  divider: {
    height: "1px",
    background: "#555",
    margin: "8px 0",
  },
  btnRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: "6px",
    marginTop: "10px",
  },
  btn: {
    background: "#555",
    border: "1px solid #777",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "3px 14px",
    cursor: "pointer",
    minWidth: "58px",
  },
  btnPrimary: {
    background: "#1a6ea8",
    border: "1px solid #2288cc",
    color: "#fff",
    fontSize: "11px",
    padding: "3px 14px",
    cursor: "pointer",
    minWidth: "58px",
  },
};

// ---------------------------------------------------------------------------
// Number input helper (clamps input to [min, max])
// ---------------------------------------------------------------------------

interface NumberInputProps {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  style?: React.CSSProperties;
}

function NumberInput({ value, onChange, min, max, step = 1, style }: NumberInputProps): React.ReactElement {
  const [raw, setRaw] = useState(String(value));

  // Sync raw string when value changes externally
  useEffect(() => {
    setRaw(String(value));
  }, [value]);

  const commit = useCallback((str: string) => {
    const n = parseFloat(str);
    if (!isNaN(n)) {
      onChange(Math.max(min, Math.min(max, n)));
    }
    // revert raw to committed value
    setRaw(String(Math.max(min, Math.min(max, isNaN(parseFloat(str)) ? value : parseFloat(str)))));
  }, [value, onChange, min, max]);

  return (
    <input
      type="number"
      value={raw}
      step={step}
      min={min}
      max={max}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
      style={{ ...styles.input, ...style }}
    />
  );
}

// ---------------------------------------------------------------------------
// Transform tab panel
// ---------------------------------------------------------------------------

interface TransformTabProps {
  params: Omit<TransformEffectParams, "effect">;
  onChange: (p: Partial<Omit<TransformEffectParams, "effect">>) => void;
}

function TransformTab({ params, onChange }: TransformTabProps): React.ReactElement {
  return (
    <>
      <div style={styles.row}>
        <span style={styles.label}>Duration:</span>
        <NumberInput value={params.duration} onChange={(v) => onChange({ duration: v })} min={1} max={9999} step={1} />
        <span style={styles.unit}>frames</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Scale X:</span>
        <NumberInput value={Math.round(params.scaleX * 100)} onChange={(v) => onChange({ scaleX: v / 100 })} min={1} max={2000} step={1} />
        <span style={styles.unit}>%</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Scale Y:</span>
        <NumberInput value={Math.round(params.scaleY * 100)} onChange={(v) => onChange({ scaleY: v / 100 })} min={1} max={2000} step={1} />
        <span style={styles.unit}>%</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Rotation:</span>
        <NumberInput value={params.rotation} onChange={(v) => onChange({ rotation: v })} min={-3600} max={3600} step={1} />
        <span style={styles.unit}>deg</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Alpha (end):</span>
        <NumberInput value={params.alpha} onChange={(v) => onChange({ alpha: v })} min={0} max={100} step={1} />
        <span style={styles.unit}>%</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Ease:</span>
        <NumberInput value={params.ease} onChange={(v) => onChange({ ease: v })} min={-100} max={100} step={1} />
        <span style={styles.unit}>(-100..100)</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Transition tab panel
// ---------------------------------------------------------------------------

interface TransitionTabProps {
  params: Omit<TransitionEffectParams, "effect">;
  onChange: (p: Partial<Omit<TransitionEffectParams, "effect">>) => void;
}

function TransitionTab({ params, onChange }: TransitionTabProps): React.ReactElement {
  return (
    <>
      <div style={styles.row}>
        <span style={styles.label}>Duration:</span>
        <NumberInput value={params.duration} onChange={(v) => onChange({ duration: v })} min={1} max={9999} step={1} />
        <span style={styles.unit}>frames</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Direction:</span>
        <select
          value={params.direction}
          onChange={(e) => onChange({ direction: e.target.value as "in" | "out" })}
          style={styles.select}
        >
          <option value="in">In (fade in)</option>
          <option value="out">Out (fade out)</option>
        </select>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Type:</span>
        <select
          value={params.type}
          onChange={(e) => onChange({ type: e.target.value as "fade" | "wipe" })}
          style={styles.select}
        >
          <option value="fade">Fade</option>
          <option value="wipe">Wipe</option>
        </select>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Ease:</span>
        <NumberInput value={params.ease} onChange={(v) => onChange({ ease: v })} min={-100} max={100} step={1} />
        <span style={styles.unit}>(-100..100)</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Blur tab panel
// ---------------------------------------------------------------------------

interface BlurTabProps {
  params: Omit<BlurEffectParams, "effect">;
  onChange: (p: Partial<Omit<BlurEffectParams, "effect">>) => void;
}

function BlurTab({ params, onChange }: BlurTabProps): React.ReactElement {
  return (
    <>
      <div style={styles.row}>
        <span style={styles.label}>Duration:</span>
        <NumberInput value={params.duration} onChange={(v) => onChange({ duration: v })} min={1} max={9999} step={1} />
        <span style={styles.unit}>frames</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Blur X:</span>
        <NumberInput value={params.blurX} onChange={(v) => onChange({ blurX: v })} min={0} max={255} step={1} />
        <span style={styles.unit}>px</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Blur Y:</span>
        <NumberInput value={params.blurY} onChange={(v) => onChange({ blurY: v })} min={0} max={255} step={1} />
        <span style={styles.unit}>px</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Ease:</span>
        <NumberInput value={params.ease} onChange={(v) => onChange({ ease: v })} min={-100} max={100} step={1} />
        <span style={styles.unit}>(-100..100)</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Drop Shadow tab panel
// ---------------------------------------------------------------------------

interface DropShadowTabProps {
  params: Omit<DropShadowEffectParams, "effect">;
  onChange: (p: Partial<Omit<DropShadowEffectParams, "effect">>) => void;
}

function DropShadowTab({ params, onChange }: DropShadowTabProps): React.ReactElement {
  return (
    <>
      <div style={styles.row}>
        <span style={styles.label}>Duration:</span>
        <NumberInput value={params.duration} onChange={(v) => onChange({ duration: v })} min={1} max={9999} step={1} />
        <span style={styles.unit}>frames</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Angle:</span>
        <NumberInput value={params.angle} onChange={(v) => onChange({ angle: v })} min={0} max={360} step={1} />
        <span style={styles.unit}>deg</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Distance:</span>
        <NumberInput value={params.distance} onChange={(v) => onChange({ distance: v })} min={0} max={255} step={1} />
        <span style={styles.unit}>px</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Blur:</span>
        <NumberInput value={params.blur} onChange={(v) => onChange({ blur: v })} min={0} max={255} step={1} />
        <span style={styles.unit}>px</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Alpha (end):</span>
        <NumberInput value={params.alpha} onChange={(v) => onChange({ alpha: v })} min={0} max={100} step={1} />
        <span style={styles.unit}>%</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Ease:</span>
        <NumberInput value={params.ease} onChange={(v) => onChange({ ease: v })} min={-100} max={100} step={1} />
        <span style={styles.unit}>(-100..100)</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Expand tab panel
// ---------------------------------------------------------------------------

interface ExpandTabProps {
  params: Omit<ExpandEffectParams, "effect">;
  onChange: (p: Partial<Omit<ExpandEffectParams, "effect">>) => void;
}

function ExpandTab({ params, onChange }: ExpandTabProps): React.ReactElement {
  return (
    <>
      <div style={styles.row}>
        <span style={styles.label}>Duration:</span>
        <NumberInput value={params.duration} onChange={(v) => onChange({ duration: v })} min={1} max={9999} step={1} />
        <span style={styles.unit}>frames</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Direction:</span>
        <select
          value={params.direction}
          onChange={(e) => onChange({ direction: e.target.value as "expand" | "contract" })}
          style={styles.select}
        >
          <option value="expand">Expand</option>
          <option value="contract">Contract</option>
        </select>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Shift Horizontal:</span>
        <NumberInput value={params.shiftX} onChange={(v) => onChange({ shiftX: v })} min={-9999} max={9999} step={1} />
        <span style={styles.unit}>px</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Shift Vertical:</span>
        <NumberInput value={params.shiftY} onChange={(v) => onChange({ shiftY: v })} min={-9999} max={9999} step={1} />
        <span style={styles.unit}>px</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Explode tab panel
// ---------------------------------------------------------------------------

interface ExplodeTabProps {
  params: Omit<ExplodeEffectParams, "effect">;
  onChange: (p: Partial<Omit<ExplodeEffectParams, "effect">>) => void;
}

function ExplodeTab({ params, onChange }: ExplodeTabProps): React.ReactElement {
  return (
    <>
      <div style={styles.row}>
        <span style={styles.label}>Duration:</span>
        <NumberInput value={params.duration} onChange={(v) => onChange({ duration: v })} min={1} max={9999} step={1} />
        <span style={styles.unit}>frames</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Arc Size:</span>
        <NumberInput value={params.arcSize} onChange={(v) => onChange({ arcSize: v })} min={0} max={360} step={1} />
        <span style={styles.unit}>deg</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Final Alpha:</span>
        <NumberInput value={params.finalAlpha} onChange={(v) => onChange({ finalAlpha: v })} min={0} max={100} step={1} />
        <span style={styles.unit}>%</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Ease:</span>
        <NumberInput value={params.ease} onChange={(v) => onChange({ ease: v })} min={-100} max={100} step={1} />
        <span style={styles.unit}>(-100..100)</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Copy to Grid tab panel
// ---------------------------------------------------------------------------

interface CopyToGridTabProps {
  params: Omit<CopyToGridEffectParams, "effect">;
  onChange: (p: Partial<Omit<CopyToGridEffectParams, "effect">>) => void;
}

function CopyToGridTab({ params, onChange }: CopyToGridTabProps): React.ReactElement {
  return (
    <>
      <div style={styles.row}>
        <span style={styles.label}>Rows:</span>
        <NumberInput value={params.rows} onChange={(v) => onChange({ rows: v })} min={1} max={100} step={1} />
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Columns:</span>
        <NumberInput value={params.columns} onChange={(v) => onChange({ columns: v })} min={1} max={100} step={1} />
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Row Spacing:</span>
        <NumberInput value={params.rowSpacing} onChange={(v) => onChange({ rowSpacing: v })} min={0} max={9999} step={1} />
        <span style={styles.unit}>px</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Column Spacing:</span>
        <NumberInput value={params.columnSpacing} onChange={(v) => onChange({ columnSpacing: v })} min={0} max={9999} step={1} />
        <span style={styles.unit}>px</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Distributed Duplicate tab panel
// ---------------------------------------------------------------------------

interface DistributedDuplicateTabProps {
  params: Omit<DistributedDuplicateEffectParams, "effect">;
  onChange: (p: Partial<Omit<DistributedDuplicateEffectParams, "effect">>) => void;
}

function DistributedDuplicateTab({ params, onChange }: DistributedDuplicateTabProps): React.ReactElement {
  return (
    <>
      <div style={styles.row}>
        <span style={styles.label}>Count:</span>
        <NumberInput value={params.count} onChange={(v) => onChange({ count: v })} min={1} max={1000} step={1} />
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Offset X:</span>
        <NumberInput value={params.offsetX} onChange={(v) => onChange({ offsetX: v })} min={-9999} max={9999} step={1} />
        <span style={styles.unit}>px</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Offset Y:</span>
        <NumberInput value={params.offsetY} onChange={(v) => onChange({ offsetY: v })} min={-9999} max={9999} step={1} />
        <span style={styles.unit}>px</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Scale to:</span>
        <NumberInput value={params.scaleTo} onChange={(v) => onChange({ scaleTo: v })} min={1} max={2000} step={1} />
        <span style={styles.unit}>%</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Alpha to:</span>
        <NumberInput value={params.alphaTo} onChange={(v) => onChange({ alphaTo: v })} min={0} max={100} step={1} />
        <span style={styles.unit}>%</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Rotate by:</span>
        <NumberInput value={params.rotateTo} onChange={(v) => onChange({ rotateTo: v })} min={-3600} max={3600} step={1} />
        <span style={styles.unit}>deg</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// TimelineEffectDialog
// ---------------------------------------------------------------------------

const ALL_TABS: { key: TimelineEffectType; label: string }[] = [
  { key: "transform", label: "Transform" },
  { key: "transition", label: "Transition" },
  { key: "blur", label: "Blur" },
  { key: "drop-shadow", label: "Drop Shadow" },
  { key: "expand", label: "Expand" },
  { key: "explode", label: "Explode" },
  { key: "copy-to-grid", label: "Copy to Grid" },
  { key: "distributed-duplicate", label: "Distrib. Dup." },
];

export function TimelineEffectDialog({
  open,
  initialEffect = "transform",
  onApply,
  onClose,
}: TimelineEffectDialogProps): React.ReactElement | null {
  const [activeTab, setActiveTab] = useState<TimelineEffectType>(initialEffect);

  const [transformParams, setTransformParams] = useState<Omit<TransformEffectParams, "effect">>({
    duration: 30,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    alpha: 100,
    ease: 0,
  });

  const [transitionParams, setTransitionParams] = useState<Omit<TransitionEffectParams, "effect">>({
    duration: 30,
    direction: "in",
    type: "fade",
    ease: 0,
  });

  const [blurParams, setBlurParams] = useState<Omit<BlurEffectParams, "effect">>({
    duration: 30,
    blurX: 20,
    blurY: 20,
    ease: 0,
  });

  const [dropShadowParams, setDropShadowParams] = useState<Omit<DropShadowEffectParams, "effect">>({
    duration: 30,
    angle: 45,
    distance: 5,
    blur: 5,
    alpha: 100,
    ease: 0,
  });

  const [expandParams, setExpandParams] = useState<Omit<ExpandEffectParams, "effect">>({
    duration: 30,
    direction: "expand",
    shiftX: 0,
    shiftY: 0,
  });

  const [explodeParams, setExplodeParams] = useState<Omit<ExplodeEffectParams, "effect">>({
    duration: 30,
    arcSize: 120,
    finalAlpha: 0,
    ease: 0,
  });

  const [copyToGridParams, setCopyToGridParams] = useState<Omit<CopyToGridEffectParams, "effect">>({
    rows: 3,
    columns: 3,
    rowSpacing: 10,
    columnSpacing: 10,
  });

  const [distributedDuplicateParams, setDistributedDuplicateParams] = useState<Omit<DistributedDuplicateEffectParams, "effect">>({
    count: 5,
    offsetX: 20,
    offsetY: 0,
    scaleTo: 100,
    alphaTo: 100,
    rotateTo: 0,
  });

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setActiveTab(initialEffect);
      setTransformParams({ duration: 30, scaleX: 1, scaleY: 1, rotation: 0, alpha: 100, ease: 0 });
      setTransitionParams({ duration: 30, direction: "in", type: "fade", ease: 0 });
      setBlurParams({ duration: 30, blurX: 20, blurY: 20, ease: 0 });
      setDropShadowParams({ duration: 30, angle: 45, distance: 5, blur: 5, alpha: 100, ease: 0 });
      setExpandParams({ duration: 30, direction: "expand", shiftX: 0, shiftY: 0 });
      setExplodeParams({ duration: 30, arcSize: 120, finalAlpha: 0, ease: 0 });
      setCopyToGridParams({ rows: 3, columns: 3, rowSpacing: 10, columnSpacing: 10 });
      setDistributedDuplicateParams({ count: 5, offsetX: 20, offsetY: 0, scaleTo: 100, alphaTo: 100, rotateTo: 0 });
    }
  }, [open, initialEffect]);

  // Keyboard: Escape = Cancel, Enter = Apply
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleApply();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTab, transformParams, transitionParams, blurParams, dropShadowParams, expandParams, explodeParams, copyToGridParams, distributedDuplicateParams]);

  const handleApply = useCallback(() => {
    switch (activeTab) {
      case "transform":
        onApply({ effect: "transform", ...transformParams });
        break;
      case "transition":
        onApply({ effect: "transition", ...transitionParams });
        break;
      case "blur":
        onApply({ effect: "blur", ...blurParams });
        break;
      case "drop-shadow":
        onApply({ effect: "drop-shadow", ...dropShadowParams });
        break;
      case "expand":
        onApply({ effect: "expand", ...expandParams });
        break;
      case "explode":
        onApply({ effect: "explode", ...explodeParams });
        break;
      case "copy-to-grid":
        onApply({ effect: "copy-to-grid", ...copyToGridParams });
        break;
      case "distributed-duplicate":
        onApply({ effect: "distributed-duplicate", ...distributedDuplicateParams });
        break;
    }
  }, [activeTab, transformParams, transitionParams, blurParams, dropShadowParams, expandParams, explodeParams, copyToGridParams, distributedDuplicateParams, onApply]);

  // Ref for drag-to-reposition
  const dialogRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!dialogRef.current) return;
    const rect = dialogRef.current.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: dragRef.current.origX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (ev.clientY - dragRef.current.startY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  if (!open) return null;

  const dialogStyle: React.CSSProperties = {
    ...styles.dialog,
    ...(pos ? { left: pos.x, top: pos.y } : {}),
  };

  function renderActiveTab(): React.ReactElement {
    switch (activeTab) {
      case "transform":
        return (
          <TransformTab
            params={transformParams}
            onChange={(p) => setTransformParams((prev) => ({ ...prev, ...p }))}
          />
        );
      case "transition":
        return (
          <TransitionTab
            params={transitionParams}
            onChange={(p) => setTransitionParams((prev) => ({ ...prev, ...p }))}
          />
        );
      case "blur":
        return (
          <BlurTab
            params={blurParams}
            onChange={(p) => setBlurParams((prev) => ({ ...prev, ...p }))}
          />
        );
      case "drop-shadow":
        return (
          <DropShadowTab
            params={dropShadowParams}
            onChange={(p) => setDropShadowParams((prev) => ({ ...prev, ...p }))}
          />
        );
      case "expand":
        return (
          <ExpandTab
            params={expandParams}
            onChange={(p) => setExpandParams((prev) => ({ ...prev, ...p }))}
          />
        );
      case "explode":
        return (
          <ExplodeTab
            params={explodeParams}
            onChange={(p) => setExplodeParams((prev) => ({ ...prev, ...p }))}
          />
        );
      case "copy-to-grid":
        return (
          <CopyToGridTab
            params={copyToGridParams}
            onChange={(p) => setCopyToGridParams((prev) => ({ ...prev, ...p }))}
          />
        );
      case "distributed-duplicate":
        return (
          <DistributedDuplicateTab
            params={distributedDuplicateParams}
            onChange={(p) => setDistributedDuplicateParams((prev) => ({ ...prev, ...p }))}
          />
        );
    }
  }

  return (
    <div
      style={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} style={dialogStyle} onMouseDown={(e) => e.stopPropagation()}>
        {/* Title bar */}
        <div style={styles.titleBar} onMouseDown={onTitleMouseDown}>
          <span style={styles.titleText}>Timeline Effects</span>
          <button style={styles.closeBtn} onClick={onClose} title="Close">
            x
          </button>
        </div>

        {/* Body */}
        <div style={styles.body}>
          {/* Effect tabs */}
          <div style={styles.tabRow}>
            {ALL_TABS.map(({ key, label }) => (
              <button
                key={key}
                style={activeTab === key ? styles.tabActive : styles.tab}
                onClick={() => setActiveTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={styles.divider} />

          {/* Active tab content */}
          {renderActiveTab()}

          <div style={styles.divider} />

          {/* Buttons */}
          <div style={styles.btnRow}>
            <button style={styles.btn} onClick={onClose}>
              Cancel
            </button>
            <button style={styles.btnPrimary} onClick={handleApply}>
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

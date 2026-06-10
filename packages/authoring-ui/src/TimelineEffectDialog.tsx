import React, { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TimelineEffectType = "transform" | "transition";

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

export type EffectParams = TransformEffectParams | TransitionEffectParams;

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
    gap: "2px",
    marginBottom: "10px",
  },
  tab: {
    background: "#555",
    border: "1px solid #777",
    color: "#ccc",
    fontSize: "11px",
    padding: "3px 12px",
    cursor: "pointer",
  },
  tabActive: {
    background: "#1a6ea8",
    border: "1px solid #2288cc",
    color: "#fff",
    fontSize: "11px",
    padding: "3px 12px",
    cursor: "pointer",
  },
  row: {
    display: "flex",
    alignItems: "center",
    marginBottom: "7px",
  },
  label: {
    width: "90px",
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
// TimelineEffectDialog
// ---------------------------------------------------------------------------

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

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setActiveTab(initialEffect);
      setTransformParams({ duration: 30, scaleX: 1, scaleY: 1, rotation: 0, alpha: 100, ease: 0 });
      setTransitionParams({ duration: 30, direction: "in", type: "fade", ease: 0 });
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
  }, [open, activeTab, transformParams, transitionParams]);

  const handleApply = useCallback(() => {
    if (activeTab === "transform") {
      onApply({ effect: "transform", ...transformParams });
    } else {
      onApply({ effect: "transition", ...transitionParams });
    }
  }, [activeTab, transformParams, transitionParams, onApply]);

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
            <button
              style={activeTab === "transform" ? styles.tabActive : styles.tab}
              onClick={() => setActiveTab("transform")}
            >
              Transform
            </button>
            <button
              style={activeTab === "transition" ? styles.tabActive : styles.tab}
              onClick={() => setActiveTab("transition")}
            >
              Transition
            </button>
          </div>

          <div style={styles.divider} />

          {/* Active tab content */}
          {activeTab === "transform" ? (
            <TransformTab
              params={transformParams}
              onChange={(p) => setTransformParams((prev) => ({ ...prev, ...p }))}
            />
          ) : (
            <TransitionTab
              params={transitionParams}
              onChange={(p) => setTransitionParams((prev) => ({ ...prev, ...p }))}
            />
          )}

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

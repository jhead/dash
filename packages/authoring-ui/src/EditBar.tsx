import React, { useRef } from "react";
import type { TextAlign } from "@flash/core";

export interface TextFormat {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  color: string;
}

export interface EditBarProps {
  documentName?: string;
  sceneName?: string;
  symbolName?: string;
  /** Called when user clicks the scene breadcrumb while editing a symbol (exits edit-in-place). */
  onExitSymbol?: () => void;
  // Text formatting controls
  showTextControls?: boolean;
  textFont?: string;
  textSize?: number;
  textBold?: boolean;
  textItalic?: boolean;
  textAlign?: TextAlign;
  textColor?: string;
  onTextFormatChange?: (format: Partial<TextFormat>) => void;
}

const FONT_FAMILIES = ["Arial", "Times New Roman", "Courier New", "Verdana", "Georgia"];

const styles: Record<string, React.CSSProperties> = {
  editBar: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    height: "22px",
    background: "#4a4a4a",
    borderBottom: "1px solid #1a1a1a",
    padding: "0 6px",
    flexShrink: 0,
    userSelect: "none",
    gap: "4px",
    overflow: "hidden",
  },
  breadcrumb: {
    fontSize: "11px",
    color: "#c0c0c0",
  },
  separator: {
    fontSize: "11px",
    color: "#888",
  },
  active: {
    fontSize: "11px",
    color: "#e0e0e0",
  },
  divider: {
    width: "1px",
    height: "14px",
    background: "#666",
    margin: "0 4px",
    flexShrink: 0,
  },
  textControlLabel: {
    fontSize: "10px",
    color: "#aaa",
    flexShrink: 0,
  },
};

export function EditBar({
  documentName = "Untitled-1",
  sceneName = "Scene 1",
  symbolName,
  onExitSymbol,
  showTextControls = false,
  textFont = "Arial",
  textSize = 12,
  textBold = false,
  textItalic = false,
  textAlign = "left",
  textColor = "#000000",
  onTextFormatChange,
}: EditBarProps): React.ReactElement {
  const colorInputRef = useRef<HTMLInputElement>(null);

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: "1px 5px",
    fontSize: "11px",
    fontWeight: active ? "bold" : "normal",
    background: active ? "#1a6ea8" : "#555",
    color: active ? "#fff" : "#ccc",
    border: "1px solid #333",
    borderRadius: "2px",
    cursor: "pointer",
    flexShrink: 0,
    lineHeight: "14px",
  });

  const alignBtnStyle = (alignVal: TextAlign): React.CSSProperties => btnStyle(textAlign === alignVal);

  return (
    <div style={styles.editBar}>
      <span style={styles.breadcrumb}>{documentName}</span>
      <span style={styles.separator}>{"›"}</span>
      {symbolName ? (
        <>
          <span
            style={{ ...styles.breadcrumb, cursor: onExitSymbol ? "pointer" : undefined, textDecoration: onExitSymbol ? "underline" : undefined }}
            onClick={onExitSymbol}
            title={onExitSymbol ? "Exit Edit-in-Place" : undefined}
          >
            {sceneName}
          </span>
          <span style={styles.separator}>{"›"}</span>
          <span style={styles.active}>{symbolName}</span>
        </>
      ) : (
        <span style={styles.active}>{sceneName}</span>
      )}

      {showTextControls && (
        <>
          <div style={styles.divider} />
          {/* Font family */}
          <select
            value={textFont}
            onChange={(e) => onTextFormatChange?.({ fontFamily: e.target.value })}
            style={{
              fontSize: "10px",
              background: "#555",
              color: "#e0e0e0",
              border: "1px solid #333",
              borderRadius: "2px",
              padding: "1px 2px",
              cursor: "pointer",
              maxWidth: "120px",
            }}
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          {/* Font size */}
          <input
            type="number"
            min={6}
            max={200}
            value={textSize}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!isNaN(val) && val > 0) onTextFormatChange?.({ fontSize: val });
            }}
            style={{
              width: "40px",
              fontSize: "10px",
              background: "#555",
              color: "#e0e0e0",
              border: "1px solid #333",
              borderRadius: "2px",
              padding: "1px 2px",
              textAlign: "right",
            }}
          />
          <span style={styles.textControlLabel}>pt</span>
          <div style={styles.divider} />
          {/* Bold */}
          <button
            style={{ ...btnStyle(textBold), fontWeight: "bold" }}
            onClick={() => onTextFormatChange?.({ bold: !textBold })}
            title="Bold"
          >
            B
          </button>
          {/* Italic */}
          <button
            style={{ ...btnStyle(textItalic), fontStyle: "italic" }}
            onClick={() => onTextFormatChange?.({ italic: !textItalic })}
            title="Italic"
          >
            I
          </button>
          <div style={styles.divider} />
          {/* Alignment buttons */}
          <button style={alignBtnStyle("left")} onClick={() => onTextFormatChange?.({ align: "left" })} title="Align Left">L</button>
          <button style={alignBtnStyle("center")} onClick={() => onTextFormatChange?.({ align: "center" })} title="Align Center">C</button>
          <button style={alignBtnStyle("right")} onClick={() => onTextFormatChange?.({ align: "right" })} title="Align Right">R</button>
          <button style={alignBtnStyle("justify")} onClick={() => onTextFormatChange?.({ align: "justify" })} title="Justify">J</button>
          <div style={styles.divider} />
          {/* Color swatch */}
          <div
            title="Text color"
            onClick={() => colorInputRef.current?.click()}
            style={{
              width: "18px",
              height: "14px",
              background: textColor,
              border: "1px solid #888",
              borderRadius: "2px",
              cursor: "pointer",
              flexShrink: 0,
            }}
          />
          <input
            ref={colorInputRef}
            type="color"
            value={textColor}
            onChange={(e) => onTextFormatChange?.({ color: e.target.value })}
            style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0 }}
          />
        </>
      )}
    </div>
  );
}

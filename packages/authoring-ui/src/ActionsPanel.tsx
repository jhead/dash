import React, { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// AS2 keyword list for lightweight syntax highlighting
// ---------------------------------------------------------------------------

const AS2_KEYWORDS = [
  "var", "function", "if", "else", "for", "while", "do", "return",
  "break", "continue", "new", "delete", "typeof", "instanceof", "in",
  "this", "super", "extends", "implements", "class", "interface",
  "import", "package", "true", "false", "null", "undefined",
  "trace", "gotoAndPlay", "gotoAndStop", "play", "stop",
  "nextFrame", "prevFrame",
];

// Build a regex that matches keywords as whole words
const KEYWORD_RE = new RegExp(
  `\\b(${AS2_KEYWORDS.join("|")})\\b`,
  "g"
);

// ---------------------------------------------------------------------------
// Simple highlight: returns an array of React nodes with keyword spans
// ---------------------------------------------------------------------------

function highlightLine(line: string, key: number): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  KEYWORD_RE.lastIndex = 0;
  while ((match = KEYWORD_RE.exec(line)) !== null) {
    if (match.index > last) {
      parts.push(line.slice(last, match.index));
    }
    parts.push(
      <span key={`kw-${match.index}`} style={{ color: "#569cd6", fontWeight: "bold" }}>
        {match[0]}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < line.length) {
    parts.push(line.slice(last));
  }
  return <span key={key}>{parts.length === 0 ? " " : parts}</span>;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ActionsPanelProps {
  script: string;
  frameIndex: number;
  layerName: string;
  onScriptChange: (script: string) => void;
  isVisible: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActionsPanel({
  script,
  frameIndex,
  layerName,
  onScriptChange,
  isVisible,
  onClose,
}: ActionsPanelProps): React.ReactElement | null {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);

  // Sync textarea scroll → line number div + overlay
  const handleScroll = useCallback(() => {
    const ta = textareaRef.current;
    const ln = lineNumRef.current;
    const ov = overlayRef.current;
    if (ta && ln) ln.scrollTop = ta.scrollTop;
    if (ta && ov) ov.scrollTop = ta.scrollTop;
  }, []);

  // Update cursor position indicator
  const updateCursor = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const before = ta.value.slice(0, ta.selectionStart);
    const lines = before.split("\n");
    setCursorLine(lines.length);
    setCursorCol((lines[lines.length - 1]?.length ?? 0) + 1);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onScriptChange(e.target.value);
      updateCursor();
    },
    [onScriptChange, updateCursor]
  );

  // Tab key → insert 2 spaces
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = e.currentTarget;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const newVal =
          ta.value.slice(0, start) + "  " + ta.value.slice(end);
        onScriptChange(newVal);
        // Restore cursor position after state update
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = start + 2;
            textareaRef.current.selectionEnd = start + 2;
          }
        });
      }
    },
    [onScriptChange]
  );

  // Focus textarea when panel opens
  useEffect(() => {
    if (isVisible) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [isVisible]);

  if (!isVisible) return null;

  const lines = script.split("\n");
  const lineCount = lines.length;

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  const panelStyle: React.CSSProperties = {
    position: "fixed",
    bottom: "40px",
    left: "50%",
    transform: "translateX(-50%)",
    width: "680px",
    height: "320px",
    background: "#1e1e1e",
    border: "1px solid #444",
    boxShadow: "0 4px 24px rgba(0,0,0,0.7)",
    display: "flex",
    flexDirection: "column",
    zIndex: 2000,
    fontFamily: "'Consolas', 'Courier New', monospace",
    fontSize: "13px",
    color: "#d4d4d4",
    borderRadius: "4px",
    overflow: "hidden",
  };

  const titleBarStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "24px",
    background: "#2d2d2d",
    borderBottom: "1px solid #444",
    padding: "0 8px",
    flexShrink: 0,
    fontSize: "11px",
    color: "#ccc",
    userSelect: "none",
  };

  const toolbarStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    height: "26px",
    background: "#252526",
    borderBottom: "1px solid #333",
    padding: "0 4px",
    gap: "2px",
    flexShrink: 0,
  };

  const toolBtnStyle: React.CSSProperties = {
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: "3px",
    color: "#ccc",
    cursor: "pointer",
    fontSize: "12px",
    padding: "2px 6px",
    lineHeight: "1",
  };

  const editorAreaStyle: React.CSSProperties = {
    display: "flex",
    flex: 1,
    overflow: "hidden",
    position: "relative",
  };

  const lineNumStyle: React.CSSProperties = {
    width: "40px",
    flexShrink: 0,
    background: "#1e1e1e",
    borderRight: "1px solid #333",
    overflowY: "hidden",
    paddingTop: "4px",
    textAlign: "right",
    paddingRight: "6px",
    color: "#555",
    fontSize: "13px",
    lineHeight: "1.5",
    userSelect: "none",
  };

  const textareaStyle: React.CSSProperties = {
    flex: 1,
    background: "transparent",
    color: "transparent",
    caretColor: "#d4d4d4",
    border: "none",
    outline: "none",
    resize: "none",
    padding: "4px 8px",
    fontFamily: "'Consolas', 'Courier New', monospace",
    fontSize: "13px",
    lineHeight: "1.5",
    whiteSpace: "pre",
    overflowX: "auto",
    overflowY: "auto",
    position: "absolute",
    top: 0,
    left: "40px",
    right: 0,
    bottom: 0,
    zIndex: 2,
  };

  const overlayStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: "40px",
    right: 0,
    bottom: 0,
    padding: "4px 8px",
    fontFamily: "'Consolas', 'Courier New', monospace",
    fontSize: "13px",
    lineHeight: "1.5",
    whiteSpace: "pre",
    overflowX: "auto",
    overflowY: "auto",
    pointerEvents: "none",
    zIndex: 1,
    color: "#d4d4d4",
  };

  const statusBarStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    height: "22px",
    background: "#007acc",
    padding: "0 8px",
    flexShrink: 0,
    fontSize: "11px",
    color: "#fff",
    gap: "12px",
  };

  return (
    <div style={panelStyle}>
      {/* Title bar */}
      <div style={titleBarStyle}>
        <span>
          Actions - Frame {frameIndex + 1}
          {layerName ? ` (${layerName})` : ""}
        </span>
        <button
          style={{
            background: "transparent",
            border: "none",
            color: "#ccc",
            cursor: "pointer",
            fontSize: "14px",
            lineHeight: "1",
            padding: "0 2px",
          }}
          onClick={onClose}
          title="Close (F9)"
        >
          &#x2715;
        </button>
      </div>

      {/* Toolbar */}
      <div style={toolbarStyle}>
        <button style={toolBtnStyle} title="Add Statement">+</button>
        <button style={toolBtnStyle} title="Find">&#128269;</button>
        <button style={toolBtnStyle} title="Help">?</button>
        <div
          style={{
            width: "1px",
            height: "16px",
            background: "#555",
            margin: "0 4px",
          }}
        />
        <span style={{ fontSize: "11px", color: "#888" }}>
          Script Assist
        </span>
      </div>

      {/* Editor area */}
      <div style={editorAreaStyle}>
        {/* Line numbers */}
        <div ref={lineNumRef} style={lineNumStyle}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} style={{ lineHeight: "1.5" }}>
              {i + 1}
            </div>
          ))}
        </div>

        {/* Highlight overlay */}
        <div ref={overlayRef} style={overlayStyle}>
          {lines.map((line, i) => (
            <React.Fragment key={i}>
              {i > 0 && "\n"}
              {highlightLine(line, i)}
            </React.Fragment>
          ))}
        </div>

        {/* Actual textarea (transparent text, but caret visible) */}
        <textarea
          ref={textareaRef}
          style={textareaStyle}
          value={script}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          onClick={updateCursor}
          onKeyUp={updateCursor}
        />
      </div>

      {/* Status bar */}
      <div style={statusBarStyle}>
        <span>ActionScript 2.0</span>
        <span>Ln {cursorLine}, Col {cursorCol}</span>
        <span style={{ marginLeft: "auto", fontSize: "10px", opacity: 0.8 }}>
          F9 to close
        </span>
      </div>
    </div>
  );
}

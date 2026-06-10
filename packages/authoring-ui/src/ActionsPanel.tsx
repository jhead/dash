import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ButtonAction, ClipAction, Symbol, SymbolInstance } from "@flash/core";
import { parse as parseAS2 } from "@flash/core";

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
  return <span key={key}>{parts.length === 0 ? " " : parts}</span>;
}

// ---------------------------------------------------------------------------
// Frame script snippets
// ---------------------------------------------------------------------------

const FRAME_SNIPPETS: Array<{ label: string; code: string }> = [
  { label: "stop()",                    code: "stop();\n" },
  { label: "play()",                    code: "play();\n" },
  { label: "nextFrame()",               code: "nextFrame();\n" },
  { label: "prevFrame()",               code: "prevFrame();\n" },
  { label: "gotoAndStop('label')",      code: "gotoAndStop('label');\n" },
  { label: "gotoAndPlay('label')",      code: "gotoAndPlay('label');\n" },
  { label: "gotoAndStop(1)",            code: "gotoAndStop(1);\n" },
  { label: "gotoAndPlay(1)",            code: "gotoAndPlay(1);\n" },
  { label: "trace('message')",          code: "trace('message');\n" },
  { label: "stopAllSounds()",           code: "stopAllSounds();\n" },
];

// ---------------------------------------------------------------------------
// Clip event types (ordered as in Flash 8 Actions panel)
// ---------------------------------------------------------------------------

const CLIP_EVENT_TYPES: Array<{ event: ClipAction["event"]; label: string }> = [
  { event: "load",       label: "load" },
  { event: "enterFrame", label: "enterFrame" },
  { event: "unload",     label: "unload" },
  { event: "mouseMove",  label: "mouseMove" },
  { event: "mouseDown",  label: "mouseDown" },
  { event: "mouseUp",    label: "mouseUp" },
  { event: "keyDown",    label: "keyDown" },
  { event: "keyUp",      label: "keyUp" },
  { event: "data",       label: "data" },
];

// ---------------------------------------------------------------------------
// Button event types (ordered as in Flash 8 Actions panel)
// ---------------------------------------------------------------------------

const BUTTON_EVENT_TYPES: Array<{ event: ButtonAction["event"]; label: string }> = [
  { event: "press",          label: "press" },
  { event: "release",        label: "release" },
  { event: "releaseOutside", label: "releaseOutside" },
  { event: "rollOver",       label: "rollOver" },
  { event: "rollOut",        label: "rollOut" },
  { event: "dragOver",       label: "dragOver" },
  { event: "dragOut",        label: "dragOut" },
];

// ---------------------------------------------------------------------------
// ScriptEditor — reusable inline editor used by both frame and clip modes
// ---------------------------------------------------------------------------

interface ScriptEditorProps {
  script: string;
  onScriptChange: (script: string) => void;
  onCursorChange?: (line: number, col: number) => void;
}

// ---------------------------------------------------------------------------
// parseLineFromError — extract line number from AS2 parser error message
// e.g. "Parse error at line 3: unexpected token..."
// ---------------------------------------------------------------------------

function parseLineFromError(msg: string): number | null {
  const m = /Parse error at line (\d+)/.exec(msg);
  return m ? parseInt(m[1], 10) : null;
}

function ScriptEditor({
  script,
  onScriptChange,
  onCursorChange,
}: ScriptEditorProps): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Debounced AS2 syntax check
  const [syntaxError, setSyntaxError] = useState<{ message: string; line: number | null } | null>(null);
  const [isValid, setIsValid] = useState<boolean | null>(null);

  useEffect(() => {
    if (script.trim() === "") {
      setSyntaxError(null);
      setIsValid(null);
      return;
    }
    const timeout = setTimeout(() => {
      try {
        parseAS2(script);
        setSyntaxError(null);
        setIsValid(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setSyntaxError({ message: msg, line: parseLineFromError(msg) });
        setIsValid(false);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [script]);

  const handleScroll = useCallback(() => {
    const ta = textareaRef.current;
    const ln = lineNumRef.current;
    const ov = overlayRef.current;
    if (ta && ln) ln.scrollTop = ta.scrollTop;
    if (ta && ov) ov.scrollTop = ta.scrollTop;
  }, []);

  const updateCursor = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const before = ta.value.slice(0, ta.selectionStart);
    const lines = before.split("\n");
    onCursorChange?.(lines.length, (lines[lines.length - 1]?.length ?? 0) + 1);
  }, [onCursorChange]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onScriptChange(e.target.value);
      updateCursor();
    },
    [onScriptChange, updateCursor]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = e.currentTarget;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const newVal = ta.value.slice(0, start) + "  " + ta.value.slice(end);
        onScriptChange(newVal);
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

  const lines = script.split("\n");
  const lineCount = lines.length;

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

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>
        <div ref={lineNumRef} style={lineNumStyle}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div
              key={i}
              style={{
                lineHeight: "1.5",
                background: syntaxError?.line === i + 1 ? "rgba(255,80,80,0.18)" : undefined,
                color: syntaxError?.line === i + 1 ? "#f97171" : undefined,
              }}
            >
              {i + 1}
            </div>
          ))}
        </div>
        <div ref={overlayRef} style={overlayStyle}>
          {lines.map((line, i) => (
            <React.Fragment key={i}>
              {i > 0 && "\n"}
              {highlightLine(line, i)}
            </React.Fragment>
          ))}
        </div>
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
      {/* Error / valid indicator bar */}
      {syntaxError && (
        <div
          data-testid="as2-error-bar"
          style={{
            flexShrink: 0,
            background: "#3a1010",
            borderTop: "1px solid #7a2222",
            padding: "3px 8px",
            fontSize: "12px",
            color: "#f97171",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            userSelect: "text",
          }}
        >
          <span style={{ fontWeight: "bold", flexShrink: 0 }}>
            {syntaxError.line != null ? `Line ${syntaxError.line}:` : "Syntax error:"}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {syntaxError.message.replace(/^Parse error at line \d+:\s*/, "")}
          </span>
        </div>
      )}
      {isValid === true && script.trim() !== "" && (
        <div
          data-testid="as2-valid-bar"
          style={{
            flexShrink: 0,
            background: "#0d2a1a",
            borderTop: "1px solid #1e6840",
            padding: "3px 8px",
            fontSize: "12px",
            color: "#4ec9b0",
            userSelect: "none",
          }}
        >
          No errors found
        </div>
      )}
    </div>
  );
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
  /** When set to a movieclip SymbolInstance, enables "Actions - Movie Clip" mode. */
  selectedInstance?: SymbolInstance | null;
  /** Called when clipActions on the selected movieclip instance should be updated. */
  onClipActionsChange?: (clipActions: readonly ClipAction[]) => void;
  /** When set to a button Symbol, enables "Actions - Button" mode. */
  selectedButtonSymbol?: Symbol | null;
  /** Called when buttonActions on the selected button symbol should be updated. */
  onButtonActionsChange?: (actions: readonly ButtonAction[]) => void;
  /**
   * Embedded mode: render inline (filling its container) as part of the bottom
   * docked panel instead of as a floating, fixed-position window. The title bar
   * and close button are omitted since the host tab bar provides those.
   */
  embedded?: boolean;
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
  selectedInstance,
  onClipActionsChange,
  selectedButtonSymbol,
  onButtonActionsChange,
  embedded = false,
}: ActionsPanelProps): React.ReactElement | null {
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  // Which onClipEvent handler is currently selected in Movie Clip mode
  const [selectedClipEvent, setSelectedClipEvent] = useState<ClipAction["event"]>("enterFrame");
  // Which on(event) handler is currently selected in Button mode
  const [selectedButtonEvent, setSelectedButtonEvent] = useState<ButtonAction["event"]>("press");

  // Determine if we're in Movie Clip mode
  // (only when a movieclip instance is selected AND clipActions callbacks are wired)
  const isMovieClipMode = !!(selectedInstance && onClipActionsChange);

  // Determine if we're in Button mode
  // (only when a button symbol is selected AND buttonActions callbacks are wired)
  const isButtonMode = !!(selectedButtonSymbol && onButtonActionsChange);

  // Focus first textarea when panel opens
  const firstTextareaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isVisible) {
      requestAnimationFrame(() => {
        const ta = firstTextareaRef.current?.querySelector("textarea");
        ta?.focus();
      });
    }
  }, [isVisible]);

  if (!isVisible && !embedded) return null;

  // ---------------------------------------------------------------------------
  // Clip actions helpers
  // ---------------------------------------------------------------------------

  const clipActions = selectedInstance?.clipActions ?? [];

  const getClipActionScript = (event: ClipAction["event"]): string => {
    return clipActions.find((a) => a.event === event)?.script ?? "";
  };

  const handleClipActionScriptChange = (event: ClipAction["event"], newScript: string): void => {
    if (!onClipActionsChange) return;
    const filtered = clipActions.filter((a) => a.event !== event);
    if (newScript.trim().length > 0) {
      // Preserve order: insert at the canonical position
      const idx = CLIP_EVENT_TYPES.findIndex((t) => t.event === event);
      const before = filtered.filter((a) => CLIP_EVENT_TYPES.findIndex((t) => t.event === a.event) < idx);
      const after = filtered.filter((a) => CLIP_EVENT_TYPES.findIndex((t) => t.event === a.event) >= idx);
      onClipActionsChange([...before, { event, script: newScript }, ...after]);
    } else {
      // Remove empty handler
      onClipActionsChange(filtered);
    }
  };

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  const panelStyle: React.CSSProperties = embedded
    ? {
        position: "relative",
        width: "100%",
        height: "100%",
        background: "#1e1e1e",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Consolas', 'Courier New', monospace",
        fontSize: "13px",
        color: "#d4d4d4",
        overflow: "hidden",
      }
    : {
        position: "fixed",
        bottom: "40px",
        left: "50%",
        transform: "translateX(-50%)",
        width: (isMovieClipMode || isButtonMode) ? "760px" : "680px",
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

  // ---------------------------------------------------------------------------
  // Button actions helpers
  // ---------------------------------------------------------------------------

  const buttonActions = selectedButtonSymbol?.buttonActions ?? [];

  const getButtonActionScript = (event: ButtonAction["event"]): string => {
    return buttonActions.find((a) => a.event === event)?.script ?? "";
  };

  const handleButtonActionScriptChange = (event: ButtonAction["event"], newScript: string): void => {
    if (!onButtonActionsChange) return;
    const filtered = buttonActions.filter((a) => a.event !== event);
    if (newScript.trim().length > 0) {
      // Preserve order: insert at the canonical position
      const idx = BUTTON_EVENT_TYPES.findIndex((t) => t.event === event);
      const before = filtered.filter((a) => BUTTON_EVENT_TYPES.findIndex((t) => t.event === a.event) < idx);
      const after = filtered.filter((a) => BUTTON_EVENT_TYPES.findIndex((t) => t.event === a.event) >= idx);
      onButtonActionsChange([...before, { event, script: newScript }, ...after]);
    } else {
      // Remove empty handler
      onButtonActionsChange(filtered);
    }
  };

  // ---------------------------------------------------------------------------
  // Movie Clip mode: event list sidebar + editor for the selected event
  // ---------------------------------------------------------------------------

  if (isMovieClipMode) {
    const instanceLabel = selectedInstance.instanceName
      ? ` (${selectedInstance.instanceName})`
      : "";
    const currentScript = getClipActionScript(selectedClipEvent);

    return (
      <div style={panelStyle}>
        {/* Title bar */}
        {!embedded && (
          <div style={titleBarStyle}>
            <span>Actions - Movie Clip{instanceLabel}</span>
            <button
              style={{ background: "transparent", border: "none", color: "#ccc", cursor: "pointer", fontSize: "14px", lineHeight: "1", padding: "0 2px" }}
              onClick={onClose}
              title="Close (F9)"
            >
              &#x2715;
            </button>
          </div>
        )}

        {/* Toolbar */}
        <div style={toolbarStyle}>
          <button style={toolBtnStyle} title="Add Statement">+</button>
          <button style={toolBtnStyle} title="Find">&#128269;</button>
          <button style={toolBtnStyle} title="Help">?</button>
          <div style={{ width: "1px", height: "16px", background: "#555", margin: "0 4px" }} />
          <span style={{ fontSize: "11px", color: "#888" }}>onClipEvent</span>
        </div>

        {/* Two-column layout: event list + editor */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Event list sidebar */}
          <div style={{
            width: "140px",
            flexShrink: 0,
            background: "#252526",
            borderRight: "1px solid #333",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}>
            <div style={{ padding: "4px 8px", fontSize: "10px", color: "#888", borderBottom: "1px solid #333", userSelect: "none" }}>
              onClipEvent
            </div>
            {CLIP_EVENT_TYPES.map(({ event, label }) => {
              const hasScript = getClipActionScript(event).trim().length > 0;
              const isSelected = selectedClipEvent === event;
              return (
                <button
                  key={event}
                  onClick={() => setSelectedClipEvent(event)}
                  style={{
                    background: isSelected ? "#094771" : "transparent",
                    border: "none",
                    borderBottom: "1px solid #2a2a2a",
                    color: isSelected ? "#fff" : hasScript ? "#d4d4d4" : "#777",
                    cursor: "pointer",
                    fontSize: "12px",
                    padding: "5px 8px",
                    textAlign: "left",
                    fontFamily: "'Consolas', 'Courier New', monospace",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  {hasScript && (
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#4ec9b0", flexShrink: 0, display: "inline-block" }} />
                  )}
                  {!hasScript && <span style={{ width: "6px", flexShrink: 0, display: "inline-block" }} />}
                  {label}
                </button>
              );
            })}
          </div>

          {/* Script editor for selected event */}
          <div ref={firstTextareaRef} style={{ display: "flex", flex: 1, overflow: "hidden" }}>
            <ScriptEditor
              script={currentScript}
              onScriptChange={(s) => handleClipActionScriptChange(selectedClipEvent, s)}
              onCursorChange={(l, c) => { setCursorLine(l); setCursorCol(c); }}
            />
          </div>
        </div>

        {/* Status bar */}
        <div style={statusBarStyle}>
          <span>ActionScript 2.0</span>
          <span>onClipEvent({selectedClipEvent})</span>
          <span>Ln {cursorLine}, Col {cursorCol}</span>
          <span style={{ marginLeft: "auto", fontSize: "10px", opacity: 0.8 }}>F9 to close</span>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Button mode: on(event) sidebar + editor for the selected event
  // ---------------------------------------------------------------------------

  if (isButtonMode) {
    const symbolLabel = selectedButtonSymbol.name ? ` (${selectedButtonSymbol.name})` : "";
    const currentButtonScript = getButtonActionScript(selectedButtonEvent);

    return (
      <div style={panelStyle}>
        {/* Title bar */}
        {!embedded && (
          <div style={titleBarStyle}>
            <span>Actions - Button{symbolLabel}</span>
            <button
              style={{ background: "transparent", border: "none", color: "#ccc", cursor: "pointer", fontSize: "14px", lineHeight: "1", padding: "0 2px" }}
              onClick={onClose}
              title="Close (F9)"
            >
              &#x2715;
            </button>
          </div>
        )}

        {/* Toolbar */}
        <div style={toolbarStyle}>
          <button style={toolBtnStyle} title="Add Statement">+</button>
          <button style={toolBtnStyle} title="Find">&#128269;</button>
          <button style={toolBtnStyle} title="Help">?</button>
          <div style={{ width: "1px", height: "16px", background: "#555", margin: "0 4px" }} />
          <span style={{ fontSize: "11px", color: "#888" }}>on</span>
        </div>

        {/* Two-column layout: event list + editor */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Event list sidebar */}
          <div style={{
            width: "140px",
            flexShrink: 0,
            background: "#252526",
            borderRight: "1px solid #333",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}>
            <div style={{ padding: "4px 8px", fontSize: "10px", color: "#888", borderBottom: "1px solid #333", userSelect: "none" }}>
              on
            </div>
            {BUTTON_EVENT_TYPES.map(({ event, label }) => {
              const hasScript = getButtonActionScript(event).trim().length > 0;
              const isSelected = selectedButtonEvent === event;
              return (
                <button
                  key={event}
                  onClick={() => setSelectedButtonEvent(event)}
                  style={{
                    background: isSelected ? "#094771" : "transparent",
                    border: "none",
                    borderBottom: "1px solid #2a2a2a",
                    color: isSelected ? "#fff" : hasScript ? "#d4d4d4" : "#777",
                    cursor: "pointer",
                    fontSize: "12px",
                    padding: "5px 8px",
                    textAlign: "left",
                    fontFamily: "'Consolas', 'Courier New', monospace",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  {hasScript && (
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#4ec9b0", flexShrink: 0, display: "inline-block" }} />
                  )}
                  {!hasScript && <span style={{ width: "6px", flexShrink: 0, display: "inline-block" }} />}
                  {label}
                </button>
              );
            })}
          </div>

          {/* Script editor for selected event */}
          <div ref={firstTextareaRef} style={{ display: "flex", flex: 1, overflow: "hidden" }}>
            <ScriptEditor
              script={currentButtonScript}
              onScriptChange={(s) => handleButtonActionScriptChange(selectedButtonEvent, s)}
              onCursorChange={(l, c) => { setCursorLine(l); setCursorCol(c); }}
            />
          </div>
        </div>

        {/* Status bar */}
        <div style={statusBarStyle}>
          <span>ActionScript 2.0</span>
          <span>on({selectedButtonEvent})</span>
          <span>Ln {cursorLine}, Col {cursorCol}</span>
          <span style={{ marginLeft: "auto", fontSize: "10px", opacity: 0.8 }}>F9 to close</span>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Frame script mode (original behavior)
  // ---------------------------------------------------------------------------

  return (
    <div style={panelStyle}>
      {/* Title bar */}
      {!embedded && (
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
      )}

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
        <div style={{ width: "1px", height: "16px", background: "#555", margin: "0 4px" }} />
        <select
          title="Insert snippet"
          style={{
            background: "#2d2d2d",
            border: "1px solid #555",
            borderRadius: "3px",
            color: "#ccc",
            cursor: "pointer",
            fontSize: "11px",
            padding: "1px 4px",
            lineHeight: "1",
          }}
          value=""
          onChange={(e) => {
            const snippet = FRAME_SNIPPETS.find((s) => s.label === e.target.value);
            if (snippet) onScriptChange(script + snippet.code);
          }}
        >
          <option value="" disabled>Insert snippet...</option>
          {FRAME_SNIPPETS.map((s) => (
            <option key={s.label} value={s.label}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Editor area */}
      <div ref={firstTextareaRef} style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <ScriptEditor
          script={script}
          onScriptChange={onScriptChange}
          onCursorChange={(l, c) => { setCursorLine(l); setCursorCol(c); }}
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

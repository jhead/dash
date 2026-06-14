import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ButtonAction, ButtonHandler, ClipAction, Symbol, SymbolInstance } from "@flash/core";
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
// Token colours
// ---------------------------------------------------------------------------

const COLOR_KEYWORD = "#569cd6";
const COLOR_STRING  = "#CE9178";
const COLOR_COMMENT = "#6A9955";
const COLOR_NUMBER  = "#B5CEA8";

// ---------------------------------------------------------------------------
// Token type
// ---------------------------------------------------------------------------

interface Token {
  start: number;
  end: number;   // exclusive
  color: string;
  bold?: boolean;
}

// ---------------------------------------------------------------------------
// tokenizeLine — returns sorted, non-overlapping tokens for one line of source.
//
// inBlockComment: whether this line starts inside a /* ... */ block comment.
// Returns { tokens, endsInBlockComment } so the caller can thread state.
// ---------------------------------------------------------------------------

export function tokenizeLine(
  line: string,
  inBlockComment: boolean
): { tokens: Token[]; endsInBlockComment: boolean } {
  const tokens: Token[] = [];
  let i = 0;

  // Helper: push a token (skips zero-length)
  const push = (start: number, end: number, color: string, bold = false) => {
    if (end > start) tokens.push({ start, end, color, bold });
  };

  // If we start inside a block comment, scan for */
  if (inBlockComment) {
    const close = line.indexOf("*/");
    if (close === -1) {
      // Entire line is inside block comment
      push(0, line.length, COLOR_COMMENT);
      return { tokens, endsInBlockComment: true };
    }
    // Color up to and including */
    push(0, close + 2, COLOR_COMMENT);
    i = close + 2;
    inBlockComment = false;
  }

  while (i < line.length) {
    // Block comment open /*
    if (line[i] === "/" && line[i + 1] === "*") {
      const close = line.indexOf("*/", i + 2);
      if (close === -1) {
        // Runs to end of line
        push(i, line.length, COLOR_COMMENT);
        i = line.length;
        inBlockComment = true;
      } else {
        push(i, close + 2, COLOR_COMMENT);
        i = close + 2;
      }
      continue;
    }

    // Line comment //
    if (line[i] === "/" && line[i + 1] === "/") {
      push(i, line.length, COLOR_COMMENT);
      i = line.length;
      continue;
    }

    // String literals (single or double quote, handling \-escapes)
    if (line[i] === '"' || line[i] === "'") {
      const quote = line[i];
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === "\\") {
          j += 2; // skip escape sequence
        } else if (line[j] === quote) {
          j += 1;
          break;
        } else {
          j += 1;
        }
      }
      push(i, j, COLOR_STRING);
      i = j;
      continue;
    }

    // Numeric literals: \b\d+(\.\d+)?\b (hex 0x... too)
    // Only when starting a word boundary position
    const prevChar = i > 0 ? line[i - 1] : null;
    const isWordBoundary = prevChar === null || /\W/.test(prevChar);
    if (isWordBoundary && /\d/.test(line[i])) {
      // Consume 0x hex, or decimal with optional fractional part
      let j = i;
      if (line[j] === "0" && (line[j + 1] === "x" || line[j + 1] === "X")) {
        j += 2;
        while (j < line.length && /[0-9a-fA-F]/.test(line[j])) j++;
      } else {
        while (j < line.length && /\d/.test(line[j])) j++;
        if (line[j] === "." && /\d/.test(line[j + 1] ?? "")) {
          j++; // consume dot
          while (j < line.length && /\d/.test(line[j])) j++;
        }
      }
      // Ensure it ends at a word boundary
      const nextChar = line[j] ?? null;
      if (nextChar === null || /\W/.test(nextChar)) {
        push(i, j, COLOR_NUMBER);
        i = j;
        continue;
      }
    }

    // Keywords — scan at word boundary
    if (isWordBoundary && /[a-zA-Z_$]/.test(line[i])) {
      KEYWORD_RE.lastIndex = i;
      const m = KEYWORD_RE.exec(line);
      if (m && m.index === i) {
        push(i, i + m[0].length, COLOR_KEYWORD, true);
        i += m[0].length;
        continue;
      }
    }

    i++;
  }

  return { tokens, endsInBlockComment: inBlockComment };
}

// ---------------------------------------------------------------------------
// renderTokens — turn a token list into an array of React nodes
// ---------------------------------------------------------------------------

function renderTokens(line: string, tokens: Token[]): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const tok of tokens) {
    if (tok.start > last) {
      parts.push(line.slice(last, tok.start));
    }
    parts.push(
      <span
        key={`tok-${tok.start}`}
        style={{ color: tok.color, ...(tok.bold ? { fontWeight: "bold" } : {}) }}
      >
        {line.slice(tok.start, tok.end)}
      </span>
    );
    last = tok.end;
  }
  if (last < line.length) {
    parts.push(line.slice(last));
  }
  return parts;
}

// ---------------------------------------------------------------------------
// highlightLines — stateful multi-line highlight (handles block comments)
// Returns one React node per line.
// ---------------------------------------------------------------------------

export function highlightLines(lines: string[]): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const { tokens, endsInBlockComment } = tokenizeLine(lines[i], inBlockComment);
    inBlockComment = endsInBlockComment;
    const parts = renderTokens(lines[i], tokens);
    nodes.push(
      <span key={i}>{parts.length === 0 ? " " : parts}</span>
    );
  }
  return nodes;
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

/** Convert a ButtonAction event to a display string (handles keyPress objects). */
function buttonEventKey(event: ButtonAction["event"]): string {
  if (typeof event === "string") return event;
  return `keyPress:${event.keyPress}`;
}

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
// Button INSTANCE handler helpers (on() handlers attached to a stage instance).
//
// These mirror the symbol-level button-action helpers but operate on a button
// instance's `buttonHandlers` array. The event vocabulary is the same set Flash 8
// surfaces in the "Actions - Button" panel for a selected instance.
// ---------------------------------------------------------------------------

const BUTTON_HANDLER_EVENT_TYPES: Array<{ event: ButtonHandler["event"]; label: string }> = [
  { event: "press",          label: "press" },
  { event: "release",        label: "release" },
  { event: "releaseOutside", label: "releaseOutside" },
  { event: "rollOver",       label: "rollOver" },
  { event: "rollOut",        label: "rollOut" },
  { event: "dragOver",       label: "dragOver" },
  { event: "dragOut",        label: "dragOut" },
];

/** Stable string key for a ButtonHandler event (handles keyPress objects). */
export function buttonHandlerEventKey(event: ButtonHandler["event"]): string {
  if (typeof event === "string") return event;
  return `keyPress:${event.keyPress}`;
}

/** Look up the on()-handler script for a given event in a button instance's handler list. */
export function getButtonHandlerScript(
  handlers: readonly ButtonHandler[],
  event: ButtonHandler["event"]
): string {
  const key = buttonHandlerEventKey(event);
  return handlers.find((h) => buttonHandlerEventKey(h.event) === key)?.script ?? "";
}

/**
 * Produce an updated buttonHandlers list with the given event's script replaced.
 * An empty/whitespace-only script removes the handler. Order is preserved using the
 * canonical event ordering (matching the symbol-level helper's behavior).
 */
export function updateButtonHandlerScript(
  handlers: readonly ButtonHandler[],
  event: ButtonHandler["event"],
  newScript: string
): ButtonHandler[] {
  const key = buttonHandlerEventKey(event);
  const filtered = handlers.filter((h) => buttonHandlerEventKey(h.event) !== key);
  if (newScript.trim().length === 0) {
    return filtered;
  }
  const orderOf = (e: ButtonHandler["event"]): number => {
    const idx = BUTTON_HANDLER_EVENT_TYPES.findIndex((t) => t.event === e);
    // keyPress / unknown events sort after the standard list, preserving relative order.
    return idx === -1 ? BUTTON_HANDLER_EVENT_TYPES.length : idx;
  };
  const idx = orderOf(event);
  const before = filtered.filter((h) => orderOf(h.event) < idx);
  const after = filtered.filter((h) => orderOf(h.event) >= idx);
  return [...before, { event, script: newScript }, ...after];
}

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
  const matchOverlayRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  // Debounced AS2 syntax check
  const [syntaxError, setSyntaxError] = useState<{ message: string; line: number | null } | null>(null);
  const [isValid, setIsValid] = useState<boolean | null>(null);

  // Find/replace state
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [findMode, setFindMode] = useState<'find' | 'replace'>('find');
  const [matchIndex, setMatchIndex] = useState(0);

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

  // Auto-focus find input when bar opens
  useEffect(() => {
    if (findOpen) {
      requestAnimationFrame(() => findInputRef.current?.focus());
    }
  }, [findOpen]);

  // Compute all match positions in the script text
  const getAllMatches = useCallback((): Array<{ start: number; end: number }> => {
    if (!findText) return [];
    const results: Array<{ start: number; end: number }> = [];
    let from = 0;
    while (true) {
      const idx = script.indexOf(findText, from);
      if (idx === -1) break;
      results.push({ start: idx, end: idx + findText.length });
      from = idx + findText.length;
      if (findText.length === 0) break; // guard infinite loop on empty string
    }
    return results;
  }, [script, findText]);

  const matches = getAllMatches();
  const matchCount = matches.length;
  const currentMatchIndex = matchCount === 0 ? 0 : ((matchIndex % matchCount) + matchCount) % matchCount;

  const findNext = useCallback(() => {
    setMatchIndex((prev) => prev + 1);
  }, []);

  const findPrev = useCallback(() => {
    setMatchIndex((prev) => prev - 1);
  }, []);

  const replaceOne = useCallback(() => {
    if (!findText || matchCount === 0) return;
    const m = matches[currentMatchIndex];
    const newScript = script.slice(0, m.start) + replaceText + script.slice(m.end);
    onScriptChange(newScript);
  }, [findText, matchCount, matches, currentMatchIndex, replaceText, script, onScriptChange]);

  const replaceAll = useCallback(() => {
    if (!findText) return;
    onScriptChange(script.split(findText).join(replaceText));
  }, [findText, replaceText, script, onScriptChange]);

  const openFind = useCallback((mode: 'find' | 'replace') => {
    setFindMode(mode);
    setMatchIndex(0);
    setFindOpen(true);
  }, []);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    // Return focus to the textarea
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const handleScroll = useCallback(() => {
    const ta = textareaRef.current;
    const ln = lineNumRef.current;
    const ov = overlayRef.current;
    const mo = matchOverlayRef.current;
    if (ta && ln) ln.scrollTop = ta.scrollTop;
    if (ta && ov) { ov.scrollTop = ta.scrollTop; ov.scrollLeft = ta.scrollLeft; }
    if (ta && mo) { mo.scrollTop = ta.scrollTop; mo.scrollLeft = ta.scrollLeft; }
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
      // Find / Replace shortcuts
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        openFind('find');
        return;
      }
      if (e.ctrlKey && e.key === 'h') {
        e.preventDefault();
        openFind('replace');
        return;
      }
      if (e.key === 'Escape' && findOpen) {
        e.preventDefault();
        closeFind();
        return;
      }
      if (e.key === 'Tab') {
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
    [onScriptChange, findOpen, openFind, closeFind]
  );

  // Keydown handler for the find bar inputs
  const handleFindKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeFind();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          findPrev();
        } else {
          findNext();
        }
      }
    },
    [closeFind, findNext, findPrev]
  );

  const lines = script.split("\n");
  const lineCount = lines.length;

  // Compute highlight spans as a flat array of {start, end, isCurrent} sorted by start
  const buildHighlightOverlay = useCallback((): React.ReactNode => {
    if (!findText || matches.length === 0) return null;

    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (let mi = 0; mi < matches.length; mi++) {
      const m = matches[mi];
      if (m.start > cursor) {
        // Normal text before this match
        parts.push(<span key={`pre-${mi}`}>{script.slice(cursor, m.start)}</span>);
      }
      const isCurrent = mi === currentMatchIndex;
      parts.push(
        <span
          key={`match-${mi}`}
          style={{
            background: isCurrent ? "rgba(255,150,0,0.6)" : "rgba(255,200,0,0.3)",
            borderRadius: "2px",
          }}
        >
          {script.slice(m.start, m.end)}
        </span>
      );
      cursor = m.end;
    }
    if (cursor < script.length) {
      parts.push(<span key="post">{script.slice(cursor)}</span>);
    }
    return <>{parts}</>;
  }, [findText, matches, currentMatchIndex, script]);

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

  const findBarInputStyle: React.CSSProperties = {
    background: "#1e1e1e",
    color: "#d4d4d4",
    border: "1px solid #555",
    borderRadius: "3px",
    padding: "1px 4px",
    fontSize: "12px",
    fontFamily: "'Consolas', 'Courier New', monospace",
    outline: "none",
    flex: 1,
    minWidth: 0,
  };

  const findBarBtnStyle: React.CSSProperties = {
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: "3px",
    color: "#ccc",
    cursor: "pointer",
    fontSize: "12px",
    padding: "1px 5px",
    lineHeight: "1",
    flexShrink: 0,
    whiteSpace: "nowrap",
  };

  // Computed once: the highlight overlay content (whiteSpace:pre, covers entire script)
  const highlightOverlayContent = buildHighlightOverlay();
  const highlightOverlayStyle: React.CSSProperties = {
    ...overlayStyle,
    color: "transparent",
    zIndex: 0,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Find/replace bar */}
      {findOpen && (
        <div
          data-testid="find-bar"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            padding: "3px 4px",
            borderBottom: "1px solid #444",
            background: "#2d2d2d",
            flexShrink: 0,
          }}
        >
          {/* Find row */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input
              data-testid="find-input"
              ref={findInputRef}
              value={findText}
              onChange={(e) => { setFindText(e.target.value); setMatchIndex(0); }}
              onKeyDown={handleFindKeyDown}
              placeholder="Find..."
              style={findBarInputStyle}
            />
            <button style={findBarBtnStyle} onClick={findPrev} title="Previous match (Shift+Enter)">&#x25B2;</button>
            <button style={findBarBtnStyle} onClick={findNext} title="Next match (Enter)">&#x25BC;</button>
            <span style={{ color: "#888", fontSize: 11, flexShrink: 0, minWidth: 60 }}>
              {matchCount === 0 ? (findText ? "No matches" : "") : `${currentMatchIndex + 1}/${matchCount}`}
            </span>
            {findMode === 'find' && (
              <button
                style={{ ...findBarBtnStyle, color: "#888" }}
                onClick={() => { setFindMode('replace'); }}
                title="Switch to Replace (Ctrl+H)"
              >
                &#x21C4; Replace
              </button>
            )}
            <button
              style={{ ...findBarBtnStyle, marginLeft: "auto" }}
              onClick={closeFind}
              title="Close (Escape)"
            >
              &#x2715;
            </button>
          </div>
          {/* Replace row */}
          {findMode === 'replace' && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                data-testid="replace-input"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                onKeyDown={handleFindKeyDown}
                placeholder="Replace..."
                style={findBarInputStyle}
              />
              <button style={findBarBtnStyle} onClick={replaceOne} title="Replace current match">Replace</button>
              <button style={findBarBtnStyle} onClick={replaceAll} title="Replace all matches">Replace All</button>
            </div>
          )}
        </div>
      )}

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
        {/* Highlight overlay — behind syntax overlay, shows match backgrounds */}
        {highlightOverlayContent && (
          <div ref={matchOverlayRef} style={highlightOverlayStyle} aria-hidden>
            {highlightOverlayContent}
          </div>
        )}
        {/* Syntax highlight overlay */}
        <div ref={overlayRef} style={overlayStyle}>
          {highlightLines(lines).map((node, i) => (
            <React.Fragment key={i}>
              {i > 0 && "\n"}
              {node}
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
   * When set to a button SymbolInstance placed on the stage, enables
   * "Actions - Button" mode for the instance's on() handlers (`buttonHandlers`).
   * Takes precedence over `selectedButtonSymbol` — selecting a button instance on
   * the stage edits that instance's handlers (the on(release){...} blocks), which is
   * what Flash 8 shows. This is the path that surfaces imported FLA button handlers.
   */
  selectedButtonInstance?: SymbolInstance | null;
  /** Called when buttonHandlers on the selected button instance should be updated. */
  onButtonHandlersChange?: (handlers: readonly ButtonHandler[]) => void;
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
  selectedButtonInstance,
  onButtonHandlersChange,
  embedded = false,
}: ActionsPanelProps): React.ReactElement | null {
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  // Which onClipEvent handler is currently selected in Movie Clip mode
  const [selectedClipEvent, setSelectedClipEvent] = useState<ClipAction["event"]>("enterFrame");
  // Which on(event) handler is currently selected in Button mode
  const [selectedButtonEvent, setSelectedButtonEvent] = useState<ButtonAction["event"]>("press");
  // Which on(event) handler is currently selected in Button-instance mode
  const [selectedButtonHandlerEvent, setSelectedButtonHandlerEvent] =
    useState<ButtonHandler["event"]>("press");

  // Determine if we're in Movie Clip mode
  // (only when a movieclip instance is selected AND clipActions callbacks are wired)
  const isMovieClipMode = !!(selectedInstance && onClipActionsChange);

  // Determine if we're in Button-instance mode
  // (a button instance is selected on the stage AND the buttonHandlers callback is wired).
  // This takes precedence over the symbol-level Button mode below.
  const isButtonInstanceMode = !!(selectedButtonInstance && onButtonHandlersChange);

  // Determine if we're in Button (symbol) mode
  // (only when a button symbol is selected AND buttonActions callbacks are wired)
  const isButtonMode = !isButtonInstanceMode && !!(selectedButtonSymbol && onButtonActionsChange);

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
        width: (isMovieClipMode || isButtonMode || isButtonInstanceMode) ? "760px" : "680px",
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
  // Button INSTANCE handler helpers (on() handlers on a stage instance)
  // ---------------------------------------------------------------------------

  const buttonHandlers = selectedButtonInstance?.buttonHandlers ?? [];

  const handleButtonHandlerScriptChange = (
    event: ButtonHandler["event"],
    newScript: string
  ): void => {
    if (!onButtonHandlersChange) return;
    onButtonHandlersChange(updateButtonHandlerScript(buttonHandlers, event, newScript));
  };

  // ---------------------------------------------------------------------------
  // Button-instance mode: on() sidebar + editor for the selected event
  // ---------------------------------------------------------------------------

  if (isButtonInstanceMode) {
    const instanceLabel = selectedButtonInstance.instanceName
      ? ` (${selectedButtonInstance.instanceName})`
      : "";
    const currentHandlerScript = getButtonHandlerScript(buttonHandlers, selectedButtonHandlerEvent);

    return (
      <div style={panelStyle}>
        {/* Title bar */}
        {!embedded && (
          <div style={titleBarStyle}>
            <span>Actions - Button{instanceLabel}</span>
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
            {BUTTON_HANDLER_EVENT_TYPES.map(({ event, label }) => {
              const hasScript = getButtonHandlerScript(buttonHandlers, event).trim().length > 0;
              const isSelected =
                buttonHandlerEventKey(selectedButtonHandlerEvent) === buttonHandlerEventKey(event);
              return (
                <button
                  key={buttonHandlerEventKey(event)}
                  data-testid={`button-handler-event-${buttonHandlerEventKey(event)}`}
                  onClick={() => setSelectedButtonHandlerEvent(event)}
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
              script={currentHandlerScript}
              onScriptChange={(s) => handleButtonHandlerScriptChange(selectedButtonHandlerEvent, s)}
              onCursorChange={(l, c) => { setCursorLine(l); setCursorCol(c); }}
            />
          </div>
        </div>

        {/* Status bar */}
        <div style={statusBarStyle}>
          <span>ActionScript 2.0</span>
          <span>on({buttonHandlerEventKey(selectedButtonHandlerEvent)})</span>
          <span>Ln {cursorLine}, Col {cursorCol}</span>
          <span style={{ marginLeft: "auto", fontSize: "10px", opacity: 0.8 }}>F9 to close</span>
        </div>
      </div>
    );
  }

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
                  key={buttonEventKey(event)}
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
          <span>on({buttonEventKey(selectedButtonEvent)})</span>
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

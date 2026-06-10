/**
 * FindReplaceDialog — document-wide search and replace.
 *
 * Supports four search modes:
 *   - Text     — finds/replaces text content in TextDisplayObject instances
 *   - Font     — finds/replaces font-family names across all text fields
 *   - Color    — finds/replaces solid fill/stroke/text colors
 *   - Symbol   — finds/replaces symbol references (SymbolInstance.symbolId)
 *
 * The dialog is non-modal (fixed overlay) and can remain open while the user
 * edits other parts of the document.  All search/replace operations are pure
 * and go through the caller's `pushDoc` so they are undo-able.
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import type {
  FlashDocument,
  Library,
  Symbol as FlashSymbol,
} from "@flash/core";
import {
  findInDocument,
  replaceInDocument,
  replaceAllInDocument,
} from "@flash/core";
import type {
  FindReplaceCriteria,
  FindReplaceReplacement,
  FindReplaceType,
  MatchLocation,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2000,
    pointerEvents: "none",
  },
  dialog: {
    position: "fixed",
    top: "80px",
    right: "20px",
    width: "340px",
    background: "#3c3c3c",
    border: "1px solid #666",
    boxShadow: "4px 4px 12px rgba(0,0,0,0.6)",
    fontFamily: "Tahoma, Arial, sans-serif",
    fontSize: "11px",
    color: "#e0e0e0",
    zIndex: 2001,
    pointerEvents: "all",
    userSelect: "none",
  },
  titleBar: {
    background: "#555",
    padding: "5px 8px",
    fontSize: "11px",
    fontWeight: "bold",
    cursor: "move",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "#e0e0e0",
    cursor: "pointer",
    fontSize: "13px",
    padding: "0 2px",
    lineHeight: 1,
  },
  body: {
    padding: "8px",
  },
  typeRow: {
    display: "flex",
    gap: "4px",
    marginBottom: "8px",
  },
  typeTab: {
    flex: 1,
    padding: "3px 4px",
    background: "#2a2a2a",
    border: "1px solid #555",
    color: "#b0b0b0",
    cursor: "pointer",
    fontSize: "10px",
    textAlign: "center" as const,
    borderRadius: "2px",
  },
  typeTabActive: {
    background: "#0078d7",
    color: "#ffffff",
    border: "1px solid #0066c0",
  },
  row: {
    display: "flex",
    alignItems: "center",
    marginBottom: "5px",
    gap: "4px",
  },
  label: {
    width: "52px",
    flexShrink: 0,
    color: "#c0c0c0",
    fontSize: "11px",
  },
  input: {
    flex: 1,
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
  },
  colorInput: {
    width: "60px",
    height: "22px",
    padding: "0 2px",
    background: "#1e1e1e",
    border: "1px solid #555",
    cursor: "pointer",
  },
  select: {
    flex: 1,
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
  },
  checkRow: {
    display: "flex",
    gap: "12px",
    marginBottom: "6px",
    alignItems: "center",
  },
  checkLabel: {
    display: "flex",
    alignItems: "center",
    gap: "3px",
    cursor: "pointer",
    fontSize: "11px",
    color: "#c0c0c0",
  },
  scopeRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginBottom: "8px",
    fontSize: "11px",
    color: "#c0c0c0",
  },
  buttonRow: {
    display: "flex",
    gap: "4px",
    marginBottom: "8px",
    flexWrap: "wrap" as const,
  },
  btn: {
    padding: "3px 8px",
    background: "#555",
    border: "1px solid #666",
    color: "#e0e0e0",
    cursor: "pointer",
    fontSize: "11px",
    borderRadius: "2px",
    whiteSpace: "nowrap" as const,
  },
  btnPrimary: {
    background: "#0078d7",
    border: "1px solid #0066c0",
    color: "#fff",
  },
  resultsHeader: {
    color: "#999",
    fontSize: "10px",
    marginBottom: "3px",
    borderTop: "1px solid #444",
    paddingTop: "5px",
  },
  resultsList: {
    maxHeight: "140px",
    overflowY: "auto" as const,
    background: "#1e1e1e",
    border: "1px solid #444",
    padding: "2px",
  },
  resultItem: {
    padding: "2px 4px",
    fontSize: "10px",
    cursor: "pointer",
    color: "#c0c0c0",
    borderRadius: "2px",
  },
  resultItemActive: {
    background: "#0078d7",
    color: "#fff",
  },
  statusBar: {
    fontSize: "10px",
    color: "#888",
    padding: "0 8px 6px",
    minHeight: "14px",
  },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FindReplaceDialogProps {
  /** The current document to search. */
  doc: FlashDocument;
  /** Current active scene index. */
  activeSceneIndex: number;
  /** Push a mutated doc into history (for undo support). */
  pushDoc: (doc: FlashDocument) => void;
  /** Called when the user closes the dialog. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Symbol picker helper
// ---------------------------------------------------------------------------

function getSymbolItems(library: Library): Array<{ id: string; name: string }> {
  return library.items
    .filter((i): i is FlashSymbol => i.itemType === "symbol")
    .map((i) => ({ id: i.id, name: i.name }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FindReplaceDialog({
  doc,
  activeSceneIndex,
  pushDoc,
  onClose,
}: FindReplaceDialogProps): React.ReactElement {
  // -------------------------------------------------------------------------
  // Search type
  // -------------------------------------------------------------------------
  const [searchType, setSearchType] = useState<FindReplaceType>("text");

  // -------------------------------------------------------------------------
  // Text / Font / Color / Symbol search state
  // -------------------------------------------------------------------------
  const [textSearch, setTextSearch] = useState("");
  const [textReplace, setTextReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);

  const [fontSearch, setFontSearch] = useState("");
  const [fontReplace, setFontReplace] = useState("");

  const [colorSearch, setColorSearch] = useState("#ff0000");
  const [colorReplace, setColorReplace] = useState("#0000ff");

  const symbolItems = getSymbolItems(doc.library);
  const [symbolSearch, setSymbolSearch] = useState(symbolItems[0]?.id ?? "");
  const [symbolReplace, setSymbolReplace] = useState(symbolItems[0]?.id ?? "");

  // -------------------------------------------------------------------------
  // Scope
  // -------------------------------------------------------------------------
  const [scope, setScope] = useState<"all" | "current">("all");

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------
  const [matches, setMatches] = useState<MatchLocation[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(-1);
  const [status, setStatus] = useState<string>("");

  // -------------------------------------------------------------------------
  // Draggable dialog
  // -------------------------------------------------------------------------
  const dialogRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; origLeft: number; origTop: number } | null>(null);
  const [dialogPos, setDialogPos] = useState<{ left: number; top: number } | null>(null);

  const handleTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!dialogRef.current) return;
    const rect = dialogRef.current.getBoundingClientRect();
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top,
    };
    e.preventDefault();
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragState.current) return;
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      setDialogPos({
        left: dragState.current.origLeft + dx,
        top: dragState.current.origTop + dy,
      });
    };
    const onUp = () => {
      dragState.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Build criteria / replacement from current state
  // -------------------------------------------------------------------------
  const buildCriteria = useCallback((): FindReplaceCriteria => {
    return {
      type: searchType,
      searchText: textSearch,
      searchFont: fontSearch,
      searchColor: colorSearch,
      searchSymbolId: symbolSearch,
      caseSensitive,
      wholeWord,
      scope,
      scopeSceneIndex: activeSceneIndex,
    };
  }, [
    searchType,
    textSearch,
    fontSearch,
    colorSearch,
    symbolSearch,
    caseSensitive,
    wholeWord,
    scope,
    activeSceneIndex,
  ]);

  const buildReplacement = useCallback((): FindReplaceReplacement => {
    return {
      replaceText: textReplace,
      replaceFont: fontReplace,
      replaceColor: colorReplace,
      replaceSymbolId: symbolReplace,
    };
  }, [textReplace, fontReplace, colorReplace, symbolReplace]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------
  const handleFindAll = useCallback(() => {
    const criteria = buildCriteria();
    const found = findInDocument(doc, criteria);
    setMatches(found);
    setCurrentMatchIndex(found.length > 0 ? 0 : -1);
    if (found.length === 0) {
      setStatus("No matches found.");
    } else {
      setStatus(`${found.length} match${found.length === 1 ? "" : "es"} found.`);
    }
  }, [doc, buildCriteria]);

  const handleFindNext = useCallback(() => {
    const criteria = buildCriteria();
    const found = findInDocument(doc, criteria);
    setMatches(found);
    if (found.length === 0) {
      setCurrentMatchIndex(-1);
      setStatus("No matches found.");
      return;
    }
    const nextIdx =
      currentMatchIndex < 0 ? 0 : (currentMatchIndex + 1) % found.length;
    setCurrentMatchIndex(nextIdx);
    setStatus(`Match ${nextIdx + 1} of ${found.length}.`);
  }, [doc, buildCriteria, currentMatchIndex]);

  const handleReplace = useCallback(() => {
    if (currentMatchIndex < 0 || currentMatchIndex >= matches.length) {
      // Nothing selected — find first and select
      handleFindNext();
      return;
    }
    const match = matches[currentMatchIndex]!;
    const criteria = buildCriteria();
    const replacement = buildReplacement();
    const newDoc = replaceInDocument(doc, match, replacement, criteria);
    pushDoc(newDoc);
    // Re-run find on the new doc
    const newMatches = findInDocument(newDoc, criteria);
    setMatches(newMatches);
    const newIdx =
      newMatches.length > 0 ? Math.min(currentMatchIndex, newMatches.length - 1) : -1;
    setCurrentMatchIndex(newIdx);
    setStatus(
      newMatches.length > 0
        ? `Replaced. ${newMatches.length} remaining.`
        : "Replaced. No more matches."
    );
  }, [
    matches,
    currentMatchIndex,
    buildCriteria,
    buildReplacement,
    doc,
    pushDoc,
    handleFindNext,
  ]);

  const handleReplaceAll = useCallback(() => {
    const criteria = buildCriteria();
    const replacement = buildReplacement();
    const found = findInDocument(doc, criteria);
    if (found.length === 0) {
      setStatus("No matches found.");
      return;
    }
    const newDoc = replaceAllInDocument(doc, criteria, replacement);
    pushDoc(newDoc);
    setMatches([]);
    setCurrentMatchIndex(-1);
    setStatus(`Replaced ${found.length} match${found.length === 1 ? "" : "es"}.`);
  }, [doc, buildCriteria, buildReplacement, pushDoc]);

  const handleResultClick = useCallback((idx: number) => {
    setCurrentMatchIndex(idx);
    setStatus(`Match ${idx + 1} of ${matches.length}.`);
  }, [matches.length]);

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------
  const typeLabels: Array<{ id: FindReplaceType; label: string }> = [
    { id: "text", label: "Text" },
    { id: "font", label: "Font" },
    { id: "color", label: "Color" },
    { id: "symbol", label: "Symbol" },
  ];

  const dialogStyle: React.CSSProperties = {
    ...S.dialog,
    ...(dialogPos
      ? { left: dialogPos.left, top: dialogPos.top, right: "auto" }
      : {}),
  };

  return (
    <div style={S.overlay}>
      <div ref={dialogRef} style={dialogStyle}>
        {/* Title bar */}
        <div style={S.titleBar} onMouseDown={handleTitleMouseDown}>
          <span>Find and Replace</span>
          <button style={S.closeBtn} onClick={onClose} title="Close">
            x
          </button>
        </div>

        <div style={S.body}>
          {/* Type tabs */}
          <div style={S.typeRow}>
            {typeLabels.map(({ id, label }) => (
              <div
                key={id}
                style={{
                  ...S.typeTab,
                  ...(searchType === id ? S.typeTabActive : {}),
                }}
                onClick={() => {
                  setSearchType(id);
                  setMatches([]);
                  setCurrentMatchIndex(-1);
                  setStatus("");
                }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Search field */}
          {searchType === "text" && (
            <>
              <div style={S.row}>
                <span style={S.label}>Find:</span>
                <input
                  style={S.input}
                  value={textSearch}
                  onChange={(e) => setTextSearch(e.target.value)}
                  placeholder="Search text..."
                  onKeyDown={(e) => { if (e.key === "Enter") handleFindNext(); }}
                  autoFocus
                />
              </div>
              <div style={S.row}>
                <span style={S.label}>Replace:</span>
                <input
                  style={S.input}
                  value={textReplace}
                  onChange={(e) => setTextReplace(e.target.value)}
                  placeholder="Replacement text..."
                  onKeyDown={(e) => { if (e.key === "Enter") handleReplace(); }}
                />
              </div>
              <div style={S.checkRow}>
                <label style={S.checkLabel}>
                  <input
                    type="checkbox"
                    checked={caseSensitive}
                    onChange={(e) => setCaseSensitive(e.target.checked)}
                  />
                  Case sensitive
                </label>
                <label style={S.checkLabel}>
                  <input
                    type="checkbox"
                    checked={wholeWord}
                    onChange={(e) => setWholeWord(e.target.checked)}
                  />
                  Whole word
                </label>
              </div>
            </>
          )}

          {searchType === "font" && (
            <>
              <div style={S.row}>
                <span style={S.label}>Find font:</span>
                <input
                  style={S.input}
                  value={fontSearch}
                  onChange={(e) => setFontSearch(e.target.value)}
                  placeholder="e.g. Arial"
                  autoFocus
                />
              </div>
              <div style={S.row}>
                <span style={S.label}>Replace:</span>
                <input
                  style={S.input}
                  value={fontReplace}
                  onChange={(e) => setFontReplace(e.target.value)}
                  placeholder="e.g. Helvetica"
                />
              </div>
            </>
          )}

          {searchType === "color" && (
            <>
              <div style={S.row}>
                <span style={S.label}>Find color:</span>
                <input
                  type="color"
                  style={S.colorInput}
                  value={colorSearch}
                  onChange={(e) => setColorSearch(e.target.value)}
                />
                <span style={{ color: "#888", fontSize: "10px", marginLeft: "4px" }}>
                  {colorSearch}
                </span>
              </div>
              <div style={S.row}>
                <span style={S.label}>Replace:</span>
                <input
                  type="color"
                  style={S.colorInput}
                  value={colorReplace}
                  onChange={(e) => setColorReplace(e.target.value)}
                />
                <span style={{ color: "#888", fontSize: "10px", marginLeft: "4px" }}>
                  {colorReplace}
                </span>
              </div>
            </>
          )}

          {searchType === "symbol" && (
            <>
              <div style={S.row}>
                <span style={S.label}>Find:</span>
                <select
                  style={S.select}
                  value={symbolSearch}
                  onChange={(e) => setSymbolSearch(e.target.value)}
                >
                  {symbolItems.length === 0 && (
                    <option value="">(no symbols in library)</option>
                  )}
                  {symbolItems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={S.row}>
                <span style={S.label}>Replace:</span>
                <select
                  style={S.select}
                  value={symbolReplace}
                  onChange={(e) => setSymbolReplace(e.target.value)}
                >
                  {symbolItems.length === 0 && (
                    <option value="">(no symbols in library)</option>
                  )}
                  {symbolItems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Scope */}
          <div style={S.scopeRow}>
            <span>Scope:</span>
            <label style={S.checkLabel}>
              <input
                type="radio"
                name="scope"
                value="all"
                checked={scope === "all"}
                onChange={() => setScope("all")}
              />
              All Scenes
            </label>
            <label style={S.checkLabel}>
              <input
                type="radio"
                name="scope"
                value="current"
                checked={scope === "current"}
                onChange={() => setScope("current")}
              />
              Current Scene
            </label>
          </div>

          {/* Action buttons */}
          <div style={S.buttonRow}>
            <button style={S.btn} onClick={handleFindNext}>
              Find Next
            </button>
            <button style={S.btn} onClick={handleFindAll}>
              Find All
            </button>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={handleReplace}>
              Replace
            </button>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={handleReplaceAll}>
              Replace All
            </button>
          </div>

          {/* Results list */}
          {matches.length > 0 && (
            <>
              <div style={S.resultsHeader}>
                {matches.length} match{matches.length === 1 ? "" : "es"}:
              </div>
              <div style={S.resultsList}>
                {matches.map((m, i) => (
                  <div
                    key={`${m.sceneIndex}-${m.layerIndex}-${m.frameIndex}-${m.objectId}`}
                    style={{
                      ...S.resultItem,
                      ...(i === currentMatchIndex ? S.resultItemActive : {}),
                    }}
                    onClick={() => handleResultClick(i)}
                    title={m.description}
                  >
                    {m.description}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Status bar */}
        <div style={S.statusBar}>{status}</div>
      </div>
    </div>
  );
}

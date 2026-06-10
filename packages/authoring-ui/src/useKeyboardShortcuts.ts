import { useEffect, useRef } from 'react';

export interface KeyboardShortcutHandlers {
  onUndo?: () => void;
  onRedo?: () => void;
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  onPasteInPlace?: () => void;
  onDelete?: () => void;
  onSelectAll?: () => void;
  onDeselect?: () => void;
  onGroup?: () => void;
  onUngroup?: () => void;
  onBreakApart?: () => void;
  onBringToFront?: () => void;
  onSendToBack?: () => void;
  onInsertFrame?: () => void;
  onInsertKeyframe?: () => void;
  onInsertBlankKeyframe?: () => void;
  onPlay?: () => void;   // Enter
  onStop?: () => void;   // Escape (when not in text edit)
  // Text menu shortcuts
  onTextBold?: () => void;           // Ctrl+Shift+B
  onTextItalic?: () => void;         // Ctrl+Shift+I
  onTextUnderline?: () => void;      // Ctrl+Shift+U
  onTextAlignLeft?: () => void;      // Ctrl+Shift+L
  onTextAlignCenter?: () => void;    // Ctrl+Shift+E
  onTextAlignRight?: () => void;     // Ctrl+Shift+R
  onTextAlignJustify?: () => void;   // Ctrl+Shift+J
  onTextTrackingIncrease?: () => void; // Alt+Right
  onTextTrackingDecrease?: () => void; // Alt+Left
  onTextTrackingReset?: () => void;    // Ctrl+Alt+Right
  /** Arrow-key nudge — move selected object by (dx, dy) pixels. Shift = 8px, plain = 1px. */
  onNudge?: (dx: number, dy: number) => void; // ArrowLeft/Right/Up/Down (no Alt/Ctrl)
  /** Add shape hint to current shape-tween keyframe (Ctrl+Shift+H). */
  onAddShapeHint?: () => void;
  /** Open Find and Replace dialog (Ctrl+H). */
  onFindReplace?: () => void;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers; // always up to date

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const h = handlersRef.current;

      // Don't fire when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      const alt = e.altKey;

      if (ctrl && !shift && e.key === 'z') { e.preventDefault(); h.onUndo?.(); }
      else if (ctrl && shift && e.key === 'z') { e.preventDefault(); h.onRedo?.(); }
      else if (ctrl && !shift && e.key === 'y') { e.preventDefault(); h.onRedo?.(); }
      else if (ctrl && !shift && e.key === 'c') { e.preventDefault(); h.onCopy?.(); }
      else if (ctrl && !shift && e.key === 'x') { e.preventDefault(); h.onCut?.(); }
      else if (ctrl && !shift && e.key === 'v') { e.preventDefault(); h.onPaste?.(); }
      else if (ctrl && shift && e.key === 'v') { e.preventDefault(); h.onPasteInPlace?.(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); h.onDelete?.(); }
      else if (ctrl && !shift && e.key === 'a') { e.preventDefault(); h.onSelectAll?.(); }
      else if (e.key === 'Escape') { h.onDeselect?.(); }
      else if (ctrl && !shift && e.key === 'g') { e.preventDefault(); h.onGroup?.(); }
      else if (ctrl && shift && e.key === 'g') { e.preventDefault(); h.onUngroup?.(); }
      else if (ctrl && !shift && e.key === 'b') { e.preventDefault(); h.onBreakApart?.(); }
      else if (e.key === 'F5') { e.preventDefault(); h.onInsertFrame?.(); }
      else if (e.key === 'F6') { e.preventDefault(); h.onInsertKeyframe?.(); }
      else if (e.key === 'F7') { e.preventDefault(); h.onInsertBlankKeyframe?.(); }
      else if (e.key === 'Enter') { h.onPlay?.(); }
      // Text menu shortcuts
      else if (ctrl && shift && e.key === 'b') { e.preventDefault(); h.onTextBold?.(); }
      else if (ctrl && shift && e.key === 'i') { e.preventDefault(); h.onTextItalic?.(); }
      else if (ctrl && shift && e.key === 'u') { e.preventDefault(); h.onTextUnderline?.(); }
      else if (ctrl && shift && e.key === 'l') { e.preventDefault(); h.onTextAlignLeft?.(); }
      else if (ctrl && shift && e.key === 'e') { e.preventDefault(); h.onTextAlignCenter?.(); }
      else if (ctrl && shift && e.key === 'r') { e.preventDefault(); h.onTextAlignRight?.(); }
      else if (ctrl && shift && e.key === 'j') { e.preventDefault(); h.onTextAlignJustify?.(); }
      else if (ctrl && shift && e.key === 'h') { e.preventDefault(); h.onAddShapeHint?.(); }
      else if (ctrl && !shift && e.key === 'h') { e.preventDefault(); h.onFindReplace?.(); }
      else if (!ctrl && alt && e.key === 'ArrowRight') { e.preventDefault(); h.onTextTrackingIncrease?.(); }
      else if (!ctrl && alt && e.key === 'ArrowLeft') { e.preventDefault(); h.onTextTrackingDecrease?.(); }
      else if (ctrl && alt && e.key === 'ArrowRight') { e.preventDefault(); h.onTextTrackingReset?.(); }
      // Arrow-key nudge (plain or Shift; skip when Alt is held — those are text-tracking shortcuts)
      else if (!ctrl && !alt && e.key === 'ArrowLeft')  { e.preventDefault(); h.onNudge?.(shift ? -8 : -1, 0); }
      else if (!ctrl && !alt && e.key === 'ArrowRight') { e.preventDefault(); h.onNudge?.(shift ? 8 : 1, 0); }
      else if (!ctrl && !alt && e.key === 'ArrowUp')    { e.preventDefault(); h.onNudge?.(0, shift ? -8 : -1); }
      else if (!ctrl && !alt && e.key === 'ArrowDown')  { e.preventDefault(); h.onNudge?.(0, shift ? 8 : 1); }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // empty deps — listener registered once
}

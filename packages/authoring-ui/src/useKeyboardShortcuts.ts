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
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // empty deps — listener registered once
}

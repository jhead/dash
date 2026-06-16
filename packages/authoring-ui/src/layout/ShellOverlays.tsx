import React from "react";
import type { FlashDocument, DocumentProperties, DisplayObject, SymbolInstance } from "@flash/core";
import { useUiStore, useDocumentStore } from "../store/index.js";
import { PlayerWindow } from "@flash/player";
import { HistoryPanel } from "../HistoryPanel";
import { BandwidthProfilerPanel } from "../BandwidthProfilerPanel";
import { AccessibilityPanel } from "../AccessibilityPanel";
import { ExportGifDialog } from "../ExportGifDialog";

/**
 * Floating overlays driven purely by uiStore flags: the Test Movie player (+ its
 * error toast), History panel, Bandwidth Profiler, Accessibility panel, and the
 * Export GIF dialog. State comes from the stores; data + action handlers come in
 * as props. Requires a <StoreProvider> ancestor.
 */
export interface ShellOverlaysProps {
  doc: FlashDocument;
  docProperties: DocumentProperties;
  selectedDisplayObject: DisplayObject | null;
  onPlayerClose: React.ComponentProps<typeof PlayerWindow>["onClose"];
  onPlayerError: React.ComponentProps<typeof PlayerWindow>["onError"];
  onTrace: React.ComponentProps<typeof PlayerWindow>["onTrace"];
  onJumpToHistory: React.ComponentProps<typeof HistoryPanel>["onJumpTo"];
  onSaveAsCommand: React.ComponentProps<typeof HistoryPanel>["onSaveAsCommand"];
  onDocAccessibilityChange: React.ComponentProps<typeof AccessibilityPanel>["onDocChange"];
  onObjectAccessibilityChange: React.ComponentProps<typeof AccessibilityPanel>["onObjectChange"];
  onExportGifConfirm: React.ComponentProps<typeof ExportGifDialog>["onConfirm"];
}

export function ShellOverlays(props: ShellOverlaysProps): React.ReactElement {
  const {
    doc,
    docProperties,
    selectedDisplayObject,
    onPlayerClose,
    onPlayerError,
    onTrace,
    onJumpToHistory,
    onSaveAsCommand,
    onDocAccessibilityChange,
    onObjectAccessibilityChange,
    onExportGifConfirm,
  } = props;

  const playerError = useUiStore((s) => s.playerError);
  const setPlayerError = useUiStore((s) => s.setPlayerError);
  const swfBytes = useUiStore((s) => s.swfBytes);
  const playerOpen = useUiStore((s) => s.playerOpen);
  const historyPanelVisible = useUiStore((s) => s.historyPanelVisible);
  const setHistoryPanelVisible = useUiStore((s) => s.setHistoryPanelVisible);
  const bandwidthProfilerVisible = useUiStore((s) => s.bandwidthProfilerVisible);
  const setBandwidthProfilerVisible = useUiStore((s) => s.setBandwidthProfilerVisible);
  const bandwidthProfilerReport = useUiStore((s) => s.bandwidthProfilerReport);
  const accessibilityPanelVisible = useUiStore((s) => s.accessibilityPanelVisible);
  const setAccessibilityPanelVisible = useUiStore((s) => s.setAccessibilityPanelVisible);
  const exportGifOpen = useUiStore((s) => s.exportGifOpen);
  const setExportGifOpen = useUiStore((s) => s.setExportGifOpen);

  // History snapshots come straight from the document store.
  const historyPast = useDocumentStore((s) => s.history.past);
  const historyFuture = useDocumentStore((s) => s.history.future);
  const clearHistory = useDocumentStore((s) => s.clearHistory);

  return (
    <>
      {playerError && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#b22222",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: 4,
            fontSize: 13,
            fontFamily: "system-ui, sans-serif",
            zIndex: 10000,
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            maxWidth: 480,
            textAlign: "center",
            cursor: "pointer",
          }}
          onClick={() => setPlayerError(null)}
          title="Click to dismiss"
        >
          <strong>Test Movie failed:</strong> {playerError}
        </div>
      )}

      <PlayerWindow
        swfBytes={swfBytes}
        stageWidth={docProperties.width}
        stageHeight={docProperties.height}
        isOpen={playerOpen}
        onClose={onPlayerClose}
        onError={onPlayerError}
        onTrace={onTrace}
      />

      {historyPanelVisible && (
        <div style={{ position: "fixed", top: "60px", right: "260px", zIndex: 2000 }}>
          <HistoryPanel
            past={historyPast}
            future={historyFuture}
            onJumpTo={onJumpToHistory}
            onClear={clearHistory}
            onClose={() => setHistoryPanelVisible(false)}
            onSaveAsCommand={onSaveAsCommand}
          />
        </div>
      )}

      {bandwidthProfilerVisible && bandwidthProfilerReport && (
        <BandwidthProfilerPanel
          report={bandwidthProfilerReport}
          frameRate={doc.properties.frameRate}
          onClose={() => setBandwidthProfilerVisible(false)}
        />
      )}

      {accessibilityPanelVisible && (
        <AccessibilityPanel
          doc={doc}
          selectedObjectId={
            selectedDisplayObject?.type === "instance" || selectedDisplayObject?.type === "text"
              ? selectedDisplayObject.id
              : null
          }
          selectedObjectAccessibility={
            selectedDisplayObject?.type === "instance"
              ? (selectedDisplayObject as SymbolInstance).accessibility ?? null
              : null
          }
          onDocChange={onDocAccessibilityChange}
          onObjectChange={onObjectAccessibilityChange}
          onClose={() => setAccessibilityPanelVisible(false)}
        />
      )}

      <ExportGifDialog
        open={exportGifOpen}
        frameRate={docProperties.frameRate}
        onConfirm={onExportGifConfirm}
        onClose={() => setExportGifOpen(false)}
      />
    </>
  );
}

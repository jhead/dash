import React from "react";
import type {
  FlashDocument,
  DocumentProperties,
  GridSettings,
  Library,
  DisplayObject,
  SymbolInstance,
  SymbolType,
  BitmapItem,
  TraceBitmapOptions,
} from "@flash/core";
import { useUiStore } from "../store/index.js";
import { DocumentPropertiesDialog } from "../DocumentPropertiesDialog";
import { EditGridDialog } from "../EditGridDialog";
import { PreferencesDialog } from "../PreferencesDialog";
import { FindReplaceDialog } from "../FindReplaceDialog";
import { ConvertToSymbolDialog, type RegistrationPoint } from "../ConvertToSymbolDialog";
import { TimelineEffectDialog, type EffectParams } from "../TimelineEffectDialog";
import { SwapSymbolDialog } from "../SwapSymbolDialog";
import { PublishSettingsDialog } from "../PublishSettingsDialog";
import { BitmapPropertiesDialog } from "../BitmapPropertiesDialog";
import { SwapBitmapDialog } from "../SwapBitmapDialog";
import { TraceBitmapDialog } from "../TraceBitmapDialog";
import type { Preferences } from "../preferences";

/**
 * The application's modal dialogs. Open/closed flags and dialog-local state live
 * in uiStore (read here via useUiStore); this section takes only the document
 * data and confirm/apply handlers it can't derive. Requires a <StoreProvider>
 * ancestor (Shell provides one).
 */
export interface ShellDialogsProps {
  doc: FlashDocument;
  docProperties: DocumentProperties;
  library: Library;
  selectedDisplayObject: DisplayObject | null;
  preferences: Preferences;
  pushDoc: (next: FlashDocument) => void;
  updatePreferences: (patch: Partial<Preferences>) => void;
  resetPreferences: () => void;
  onDocPropsConfirm: (props: DocumentProperties) => void;
  onEditGridConfirm: (grid: GridSettings) => void;
  onConvertToSymbolConfirm: (name: string, type: SymbolType, reg?: RegistrationPoint) => void;
  onApplyTimelineEffect: (params: EffectParams) => void;
  onSwapSymbolConfirm: (symbolId: string) => void;
  onBitmapPropsSave: (changes: Partial<BitmapItem>) => void;
  onSwapBitmapConfirm: (bitmapId: string) => void;
  onTraceBitmapConfirm: (options: TraceBitmapOptions) => void;
}

export function ShellDialogs(props: ShellDialogsProps): React.ReactElement {
  const {
    doc,
    docProperties,
    library,
    selectedDisplayObject,
    preferences,
    pushDoc,
    updatePreferences,
    resetPreferences,
    onDocPropsConfirm,
    onEditGridConfirm,
    onConvertToSymbolConfirm,
    onApplyTimelineEffect,
    onSwapSymbolConfirm,
    onBitmapPropsSave,
    onSwapBitmapConfirm,
    onTraceBitmapConfirm,
  } = props;

  // Open flags + dialog-local state + their setters live in uiStore.
  const activeSceneIndex = useUiStore((s) => s.activeSceneIndex);
  const docPropsOpen = useUiStore((s) => s.docPropsOpen);
  const setDocPropsOpen = useUiStore((s) => s.setDocPropsOpen);
  const editGridOpen = useUiStore((s) => s.editGridOpen);
  const setEditGridOpen = useUiStore((s) => s.setEditGridOpen);
  const preferencesOpen = useUiStore((s) => s.preferencesOpen);
  const setPreferencesOpen = useUiStore((s) => s.setPreferencesOpen);
  const findReplaceVisible = useUiStore((s) => s.findReplaceVisible);
  const setFindReplaceVisible = useUiStore((s) => s.setFindReplaceVisible);
  const convertToSymbolOpen = useUiStore((s) => s.convertToSymbolOpen);
  const setConvertToSymbolOpen = useUiStore((s) => s.setConvertToSymbolOpen);
  const timelineEffectOpen = useUiStore((s) => s.timelineEffectOpen);
  const setTimelineEffectOpen = useUiStore((s) => s.setTimelineEffectOpen);
  const timelineEffectInitial = useUiStore((s) => s.timelineEffectInitial);
  const swapSymbolOpen = useUiStore((s) => s.swapSymbolOpen);
  const setSwapSymbolOpen = useUiStore((s) => s.setSwapSymbolOpen);
  const publishSettingsOpen = useUiStore((s) => s.publishSettingsOpen);
  const setPublishSettingsOpen = useUiStore((s) => s.setPublishSettingsOpen);
  const publishSettings = useUiStore((s) => s.publishSettings);
  const setPublishSettings = useUiStore((s) => s.setPublishSettings);
  const bitmapPropsItem = useUiStore((s) => s.bitmapPropsItem);
  const setBitmapPropsItem = useUiStore((s) => s.setBitmapPropsItem);
  const swapBitmapDialogOpen = useUiStore((s) => s.swapBitmapDialogOpen);
  const setSwapBitmapDialogOpen = useUiStore((s) => s.setSwapBitmapDialogOpen);
  const setSwapBitmapTargetId = useUiStore((s) => s.setSwapBitmapTargetId);
  const traceBitmapOpen = useUiStore((s) => s.traceBitmapOpen);
  const setTraceBitmapOpen = useUiStore((s) => s.setTraceBitmapOpen);

  return (
    <>
      <DocumentPropertiesDialog
        properties={docProperties}
        isOpen={docPropsOpen}
        onConfirm={onDocPropsConfirm}
        onCancel={() => setDocPropsOpen(false)}
      />

      <EditGridDialog
        grid={docProperties.grid}
        isOpen={editGridOpen}
        onConfirm={onEditGridConfirm}
        onCancel={() => setEditGridOpen(false)}
      />

      <PreferencesDialog
        isOpen={preferencesOpen}
        preferences={preferences}
        onChange={updatePreferences}
        onReset={resetPreferences}
        onClose={() => setPreferencesOpen(false)}
      />

      {findReplaceVisible && (
        <FindReplaceDialog
          doc={doc}
          activeSceneIndex={activeSceneIndex}
          pushDoc={pushDoc}
          onClose={() => setFindReplaceVisible(false)}
        />
      )}

      <ConvertToSymbolDialog
        open={convertToSymbolOpen}
        onConfirm={onConvertToSymbolConfirm}
        onClose={() => setConvertToSymbolOpen(false)}
      />

      <TimelineEffectDialog
        open={timelineEffectOpen}
        initialEffect={timelineEffectInitial}
        onApply={onApplyTimelineEffect}
        onClose={() => setTimelineEffectOpen(false)}
      />

      {swapSymbolOpen && selectedDisplayObject?.type === "instance" && (
        <SwapSymbolDialog
          open={swapSymbolOpen}
          library={doc.library}
          currentSymbolId={(selectedDisplayObject as SymbolInstance).symbolId}
          onConfirm={onSwapSymbolConfirm}
          onClose={() => setSwapSymbolOpen(false)}
        />
      )}

      <PublishSettingsDialog
        open={publishSettingsOpen}
        doc={doc}
        pushDoc={pushDoc}
        settings={publishSettings}
        onSave={setPublishSettings}
        onClose={() => setPublishSettingsOpen(false)}
      />

      {bitmapPropsItem && (
        <BitmapPropertiesDialog
          item={bitmapPropsItem}
          onSave={onBitmapPropsSave}
          onClose={() => setBitmapPropsItem(null)}
        />
      )}

      <SwapBitmapDialog
        open={swapBitmapDialogOpen}
        bitmapItems={library.items.filter((i): i is BitmapItem => i.itemType === "bitmap")}
        onConfirm={onSwapBitmapConfirm}
        onClose={() => {
          setSwapBitmapDialogOpen(false);
          setSwapBitmapTargetId(null);
        }}
      />

      <TraceBitmapDialog
        open={traceBitmapOpen}
        onConfirm={onTraceBitmapConfirm}
        onClose={() => setTraceBitmapOpen(false)}
      />
    </>
  );
}

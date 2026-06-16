import React from "react";
import type {
  FlashDocument,
  DocumentProperties,
  DisplayObject,
  Frame,
  FlashFilter,
  BitmapItem,
} from "@flash/core";
import { hexToColor } from "@flash/core";
import { useUiStore } from "../store/index.js";
import { ColorPanel } from "../ColorPanel";
import { FiltersPanel } from "../FiltersPanel";
import { AlignPanel } from "../AlignPanel";
import { ColorMixerPanel } from "../ColorMixerPanel";
import { SwatchesPanel } from "../SwatchesPanel";
import { BehaviorsPanel } from "../BehaviorsPanel";
import { MovieExplorerPanel } from "../MovieExplorerPanel";
import { ScenePanel } from "../ScenePanel";

/**
 * The floating Window-menu panels. Visibility flags + color/swatch/tool state
 * live in uiStore (read here); document-derived values and action handlers come
 * in as props. Handler prop types are derived from each panel's own props so
 * they stay compatible by construction. Requires a <StoreProvider> ancestor.
 */
export interface ShellPanelsProps {
  doc: FlashDocument;
  docProperties: DocumentProperties;
  selectedShapeFilters: FlashFilter[];
  activeKeyframeObjects: readonly DisplayObject[];
  currentScript: string;
  currentKeyframe: Frame | null;
  bitmapLibraryItems: BitmapItem[];
  onFillChange: React.ComponentProps<typeof ColorPanel>["onFillChange"];
  onStrokeChange: React.ComponentProps<typeof ColorPanel>["onStrokeChange"];
  onFiltersChange: React.ComponentProps<typeof FiltersPanel>["onFiltersChange"];
  onAlign: React.ComponentProps<typeof AlignPanel>["onAlign"];
  onMatchSize: React.ComponentProps<typeof AlignPanel>["onMatchSize"];
  onMixerFillColorChange: React.ComponentProps<typeof ColorMixerPanel>["onFillColorChange"];
  onMixerStrokeColorChange: React.ComponentProps<typeof ColorMixerPanel>["onStrokeColorChange"];
  onSelectSwatch: React.ComponentProps<typeof SwatchesPanel>["onSelectSwatch"];
  onAddSwatch: React.ComponentProps<typeof SwatchesPanel>["onAddSwatch"];
  onRemoveSwatch: React.ComponentProps<typeof SwatchesPanel>["onRemoveSwatch"];
  onSwatchesLoad: React.ComponentProps<typeof SwatchesPanel>["onSwatchesLoad"];
  onScriptChange: React.ComponentProps<typeof BehaviorsPanel>["onScriptChange"];
  onBehaviorsChange: React.ComponentProps<typeof BehaviorsPanel>["onBehaviorsChange"];
  onSelectScene: React.ComponentProps<typeof ScenePanel>["onSelectScene"];
  onAddScene: React.ComponentProps<typeof ScenePanel>["onAddScene"];
  onRemoveScene: React.ComponentProps<typeof ScenePanel>["onRemoveScene"];
  onRenameScene: React.ComponentProps<typeof ScenePanel>["onRenameScene"];
  onReorderScene: React.ComponentProps<typeof ScenePanel>["onReorderScene"];
  onDuplicateScene: React.ComponentProps<typeof ScenePanel>["onDuplicateScene"];
}

export function ShellPanels(props: ShellPanelsProps): React.ReactElement {
  const {
    doc,
    docProperties,
    selectedShapeFilters,
    activeKeyframeObjects,
    currentScript,
    currentKeyframe,
    bitmapLibraryItems,
    onFillChange,
    onStrokeChange,
    onFiltersChange,
    onAlign,
    onMatchSize,
    onMixerFillColorChange,
    onMixerStrokeColorChange,
    onSelectSwatch,
    onAddSwatch,
    onRemoveSwatch,
    onSwatchesLoad,
    onScriptChange,
    onBehaviorsChange,
    onSelectScene,
    onAddScene,
    onRemoveScene,
    onRenameScene,
    onReorderScene,
    onDuplicateScene,
  } = props;

  const toolState = useUiStore((s) => s.toolState);
  const selectedShapeIds = useUiStore((s) => s.selectedShapeIds);
  const swatches = useUiStore((s) => s.swatches);
  const mixerFillAlpha = useUiStore((s) => s.mixerFillAlpha);
  const mixerStrokeAlpha = useUiStore((s) => s.mixerStrokeAlpha);
  const activeSceneIndex = useUiStore((s) => s.activeSceneIndex);
  const setSelectedLibraryItemId = useUiStore((s) => s.setSelectedLibraryItemId);

  const colorPanelVisible = useUiStore((s) => s.colorPanelVisible);
  const setColorPanelVisible = useUiStore((s) => s.setColorPanelVisible);
  const filtersPanelVisible = useUiStore((s) => s.filtersPanelVisible);
  const setFiltersPanelVisible = useUiStore((s) => s.setFiltersPanelVisible);
  const alignPanelVisible = useUiStore((s) => s.alignPanelVisible);
  const setAlignPanelVisible = useUiStore((s) => s.setAlignPanelVisible);
  const colorMixerVisible = useUiStore((s) => s.colorMixerVisible);
  const setColorMixerVisible = useUiStore((s) => s.setColorMixerVisible);
  const swatchesPanelVisible = useUiStore((s) => s.swatchesPanelVisible);
  const setSwatchesPanelVisible = useUiStore((s) => s.setSwatchesPanelVisible);
  const behaviorsPanelVisible = useUiStore((s) => s.behaviorsPanelVisible);
  const setBehaviorsPanelVisible = useUiStore((s) => s.setBehaviorsPanelVisible);
  const movieExplorerVisible = useUiStore((s) => s.movieExplorerVisible);
  const setMovieExplorerVisible = useUiStore((s) => s.setMovieExplorerVisible);
  const scenePanelVisible = useUiStore((s) => s.scenePanelVisible);
  const setScenePanelVisible = useUiStore((s) => s.setScenePanelVisible);

  return (
    <>
      <ColorPanel
        fill={toolState.fill}
        stroke={
          toolState.strokeColor
            ? {
                type: "solid",
                color: hexToColor(
                  toolState.strokeColor,
                  Math.round((toolState.strokeAlpha / 100) * 255)
                ),
                width: toolState.strokeWidth,
                caps: "round",
                joints: "round",
                miterLimit: 3,
              }
            : null
        }
        onFillChange={onFillChange}
        onStrokeChange={onStrokeChange}
        isVisible={colorPanelVisible}
        onClose={() => setColorPanelVisible(false)}
      />

      <FiltersPanel
        filters={selectedShapeFilters}
        onFiltersChange={onFiltersChange}
        isVisible={filtersPanelVisible}
        onClose={() => setFiltersPanelVisible(false)}
      />

      <AlignPanel
        visible={alignPanelVisible}
        displayObjects={activeKeyframeObjects}
        selectedIds={selectedShapeIds}
        stageWidth={docProperties.width}
        stageHeight={docProperties.height}
        onAlign={onAlign}
        onMatchSize={onMatchSize}
        onClose={() => setAlignPanelVisible(false)}
      />

      {colorMixerVisible && (
        <ColorMixerPanel
          fillColor={toolState.fillColor ?? "#000000"}
          strokeColor={toolState.strokeColor}
          fillAlpha={mixerFillAlpha}
          strokeAlpha={mixerStrokeAlpha}
          fill={toolState.fill}
          onFillColorChange={onMixerFillColorChange}
          onStrokeColorChange={onMixerStrokeColorChange}
          onFillChange={onFillChange}
          bitmapItems={bitmapLibraryItems}
          onClose={() => setColorMixerVisible(false)}
        />
      )}

      {swatchesPanelVisible && (
        <SwatchesPanel
          swatches={swatches}
          onSelectSwatch={onSelectSwatch}
          onAddSwatch={onAddSwatch}
          onRemoveSwatch={onRemoveSwatch}
          onSwatchesLoad={onSwatchesLoad}
          onClose={() => setSwatchesPanelVisible(false)}
        />
      )}

      {behaviorsPanelVisible && (
        <BehaviorsPanel
          script={currentScript}
          onScriptChange={onScriptChange}
          onClose={() => setBehaviorsPanelVisible(false)}
          selectedFrame={currentKeyframe}
          onBehaviorsChange={onBehaviorsChange}
        />
      )}

      {movieExplorerVisible && (
        <MovieExplorerPanel
          doc={doc}
          onSelectItem={(item) => {
            if (item.type === "library-item") {
              setSelectedLibraryItemId(item.item.id);
            }
          }}
          onClose={() => setMovieExplorerVisible(false)}
        />
      )}

      {scenePanelVisible && (
        <ScenePanel
          scenes={doc.scenes}
          activeSceneIndex={Math.min(activeSceneIndex, doc.scenes.length - 1)}
          onSelectScene={onSelectScene}
          onAddScene={onAddScene}
          onRemoveScene={onRemoveScene}
          onRenameScene={onRenameScene}
          onReorderScene={onReorderScene}
          onDuplicateScene={onDuplicateScene}
          onClose={() => setScenePanelVisible(false)}
        />
      )}
    </>
  );
}

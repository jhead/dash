import React, { useCallback } from "react";
import type { Frame, SoundEffect, SoundItem, SoundLinkage } from "@flash/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SoundPanelProps {
  /** The selected keyframe (null if no keyframe selected). */
  frame: Frame | null;
  /** Index of the frame within its layer (needed for onSoundChange). */
  frameIndex: number;
  /** Index of the layer the frame belongs to. */
  layerIndex: number;
  /** Available sounds in library. */
  sounds: SoundItem[];
  /** Called when the sound linkage for the keyframe changes. */
  onSoundChange: (frameIdx: number, layerIdx: number, sound: SoundLinkage | null) => void;
  /** Called to preview a sound by dataUri. */
  onPreviewSound?: (dataUri: string) => void;
  /** Called when the user clicks "Edit..." to open the envelope editor. */
  onEditEnvelope?: (frameIdx: number, layerIdx: number) => void;
}

type SyncMode = SoundLinkage["syncMode"];
type EffectMode = SoundEffect;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  background: "#2d2d2d",
  borderTop: "1px solid #1a1a1a",
  padding: "6px 8px",
  gap: 4,
  flexShrink: 0,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#aaa",
  width: 44,
  flexShrink: 0,
};

const selectStyle: React.CSSProperties = {
  fontSize: 10,
  background: "#1a1a1a",
  color: "#e0e0e0",
  border: "1px solid #555",
  padding: "1px 2px",
  borderRadius: 2,
  outline: "none",
  flex: 1,
  minWidth: 0,
};

const numberInputStyle: React.CSSProperties = {
  width: 48,
  fontSize: 10,
  background: "#1a1a1a",
  color: "#ffffff",
  border: "1px solid #555",
  padding: "1px 4px",
  borderRadius: 2,
  outline: "none",
};

const btnStyle: React.CSSProperties = {
  fontSize: 10,
  background: "#444",
  color: "#ccc",
  border: "1px solid #555",
  padding: "1px 5px",
  borderRadius: 2,
  cursor: "pointer",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#c0c0c0",
  fontWeight: "bold",
  marginBottom: 2,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SoundPanel({
  frame,
  frameIndex,
  layerIndex,
  sounds,
  onSoundChange,
  onPreviewSound,
  onEditEnvelope,
}: SoundPanelProps): React.ReactElement {
  const sound = frame?.sound ?? null;
  const selectedSoundId = sound?.libraryItemId ?? "";
  const syncMode: SyncMode = sound?.syncMode ?? "event";
  const repeatCount: number = sound?.repeatCount ?? 1;
  const effectMode: EffectMode = sound?.effect ?? "none";

  const selectedSoundItem = sounds.find((s) => s.id === selectedSoundId) ?? null;

  const handleSoundSelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value;
      if (!id) {
        onSoundChange(frameIndex, layerIndex, null);
      } else {
        onSoundChange(frameIndex, layerIndex, {
          libraryItemId: id,
          syncMode: sound?.syncMode ?? "event",
          repeatCount: sound?.repeatCount ?? 1,
          effect: sound?.effect ?? "none",
        });
      }
    },
    [frameIndex, layerIndex, sound, onSoundChange]
  );

  const handleEffectChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!sound) return;
      onSoundChange(frameIndex, layerIndex, {
        ...sound,
        effect: e.target.value as EffectMode,
      });
    },
    [frameIndex, layerIndex, sound, onSoundChange]
  );

  const handleSyncChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!sound) return;
      onSoundChange(frameIndex, layerIndex, {
        ...sound,
        syncMode: e.target.value as SyncMode,
      });
    },
    [frameIndex, layerIndex, sound, onSoundChange]
  );

  const handleRepeatChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!sound) return;
      const val = Math.max(0, parseInt(e.target.value, 10) || 0);
      onSoundChange(frameIndex, layerIndex, {
        ...sound,
        repeatCount: val,
      });
    },
    [frameIndex, layerIndex, sound, onSoundChange]
  );

  const handlePreview = useCallback(() => {
    if (selectedSoundItem?.dataUri) {
      onPreviewSound?.(selectedSoundItem.dataUri);
    }
  }, [selectedSoundItem, onPreviewSound]);

  if (!frame) return <></>;

  return (
    <div style={panelStyle}>
      <div style={sectionTitleStyle}>Sound</div>

      {/* Sound selector */}
      <div style={rowStyle}>
        <span style={labelStyle}>Sound:</span>
        <select style={selectStyle} value={selectedSoundId} onChange={handleSoundSelect}>
          <option value="">None</option>
          {sounds.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {selectedSoundItem && (
          <button style={btnStyle} title="Preview sound" onClick={handlePreview}>
            &#x25B6;
          </button>
        )}
      </div>

      {/* Effect (shown only when a sound is selected) */}
      {sound && (
        <div style={rowStyle}>
          <span style={labelStyle}>Effect:</span>
          <select style={selectStyle} value={effectMode} onChange={handleEffectChange}>
            <option value="none">None</option>
            <option value="left">Left Channel</option>
            <option value="right">Right Channel</option>
            <option value="fadeLeftToRight">Fade Left to Right</option>
            <option value="fadeRightToLeft">Fade Right to Left</option>
            <option value="fadeIn">Fade In</option>
            <option value="fadeOut">Fade Out</option>
          </select>
          <button
            style={btnStyle}
            title="Edit sound envelope"
            onClick={() => onEditEnvelope?.(frameIndex, layerIndex)}
            disabled={!onEditEnvelope}
          >
            Edit...
          </button>
        </div>
      )}

      {/* Sync mode */}
      {sound && (
        <div style={rowStyle}>
          <span style={labelStyle}>Sync:</span>
          <select style={selectStyle} value={syncMode} onChange={handleSyncChange}>
            <option value="event">Event</option>
            <option value="start">Start</option>
            <option value="stop">Stop</option>
            <option value="stream">Stream</option>
          </select>
        </div>
      )}

      {/* Repeat count */}
      {sound && (
        <div style={rowStyle}>
          <span style={labelStyle}>Repeat:</span>
          <input
            type="number"
            min={0}
            value={repeatCount}
            onChange={handleRepeatChange}
            style={numberInputStyle}
            title="Repeat count (0 = loop)"
          />
          <span style={{ fontSize: 9, color: "#666" }}>0=loop</span>
        </div>
      )}
    </div>
  );
}

import React, { useCallback, useEffect, useState } from "react";
import { withProperties } from "@flash/core";
import type { FlashDocument, PublishProfile, PublishProfileSettings } from "@flash/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** HTML wrapper publish settings — corresponds to the HTML tab. */
export interface HtmlPublishOptions {
  /** Whether to emit the HTML file alongside the SWF. Default true. */
  publishHtml: boolean;
  /** Playback quality. Default "high". */
  quality: "low" | "medium" | "high" | "best";
  /** Window mode. Default "window". */
  wmode: "window" | "opaque" | "transparent";
  /** Scale mode. Default "showall". */
  scale: "showall" | "noborder" | "exactfit" | "noscale";
  /** Whether the movie loops. Default true. */
  loop: boolean;
  /** Whether the Flash context-menu is visible. Default true. */
  menu: boolean;
}

/** Kept for backward compatibility with Shell.tsx publish-output state. */
export interface PublishSettings {
  filename: string;
  jpegQuality: number;
  audioStreamFormat: "mp3" | "adpcm";
  audioEventFormat: "mp3" | "adpcm";
  /** SWF output options */
  compress: boolean;
  protect: boolean;
  debuggingPermitted: boolean;
  debugPassword: string;
  /** HTML wrapper settings */
  html: HtmlPublishOptions;
}

export interface PublishSettingsDialogProps {
  /** The current document (for reading and updating doc properties). */
  doc: FlashDocument;
  /** Called when the dialog should close (Cancel or after OK). */
  onClose: () => void;
  /** Called with the updated document when the user clicks OK. */
  pushDoc: (doc: FlashDocument) => void;
  // Legacy props kept so existing Shell.tsx wiring compiles without changes
  open?: boolean;
  settings?: PublishSettings;
  onSave?: (settings: PublishSettings) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default HTML publish options. */
export const DEFAULT_HTML_OPTIONS: HtmlPublishOptions = {
  publishHtml: true,
  quality: "high",
  wmode: "window",
  scale: "showall",
  loop: true,
  menu: true,
};

/** Default publish profile settings. */
export const DEFAULT_PROFILE_SETTINGS: PublishProfileSettings = {
  filename: "movie.swf",
  jpegQuality: 80,
  audioStreamFormat: "mp3",
  audioEventFormat: "mp3",
  compress: false,
  protect: false,
  debuggingPermitted: false,
  debugPassword: "",
  html: DEFAULT_HTML_OPTIONS,
};

/** The built-in default profile (always present as a fallback). */
export const DEFAULT_PROFILE: PublishProfile = {
  id: "default",
  name: "Default",
  settings: DEFAULT_PROFILE_SETTINGS,
};

/** Generate a simple unique ID for new profiles. */
function newProfileId(): string {
  return `profile-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/** Convert a PublishSettings (Shell legacy) → PublishProfileSettings. */
function settingsToProfile(s: PublishSettings): PublishProfileSettings {
  return {
    filename: s.filename,
    jpegQuality: s.jpegQuality,
    audioStreamFormat: s.audioStreamFormat,
    audioEventFormat: s.audioEventFormat,
    compress: s.compress,
    protect: s.protect,
    debuggingPermitted: s.debuggingPermitted,
    debugPassword: s.debugPassword,
    html: { ...s.html },
  };
}

/** Convert a PublishProfileSettings → PublishSettings (Shell legacy). */
function profileToSettings(p: PublishProfileSettings): PublishSettings {
  return {
    filename: p.filename,
    jpegQuality: p.jpegQuality,
    audioStreamFormat: p.audioStreamFormat,
    audioEventFormat: p.audioEventFormat,
    compress: p.compress,
    protect: p.protect,
    debuggingPermitted: p.debuggingPermitted,
    debugPassword: p.debugPassword,
    html: { ...p.html },
  };
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

/** Checkbox row with a label on the right side (after the checkbox). */
const checkboxRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  marginBottom: "6px",
  gap: "6px",
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
  },
  dialog: {
    background: "#3c3c3c",
    border: "1px solid #666",
    boxShadow: "4px 4px 12px rgba(0,0,0,0.6)",
    minWidth: "380px",
    fontFamily: "Tahoma, Arial, sans-serif",
    fontSize: "11px",
    color: "#e0e0e0",
    userSelect: "none",
  },
  titleBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "#2a2a2a",
    borderBottom: "1px solid #555",
    padding: "4px 6px",
    cursor: "default",
  },
  titleText: {
    fontSize: "11px",
    fontWeight: "bold",
    color: "#e0e0e0",
  },
  closeBtn: {
    background: "#666",
    border: "1px solid #888",
    color: "#e0e0e0",
    width: "14px",
    height: "14px",
    fontSize: "10px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    lineHeight: 1,
  },
  profileBar: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "6px 10px",
    borderBottom: "1px solid #555",
    background: "#343434",
  },
  profileLabel: {
    fontSize: "11px",
    color: "#aaa",
    flexShrink: 0,
  },
  profileSelect: {
    flex: 1,
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
  },
  profileBtn: {
    background: "#555",
    border: "1px solid #777",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 7px",
    cursor: "pointer",
    minWidth: "22px",
    flexShrink: 0,
  },
  tabBar: {
    display: "flex",
    borderBottom: "1px solid #555",
    background: "#2e2e2e",
  },
  tab: {
    padding: "5px 14px",
    fontSize: "11px",
    cursor: "pointer",
    borderRight: "1px solid #555",
    color: "#aaa",
    userSelect: "none" as const,
  },
  tabActive: {
    padding: "5px 14px",
    fontSize: "11px",
    cursor: "pointer",
    borderRight: "1px solid #555",
    color: "#e0e0e0",
    background: "#3c3c3c",
    borderBottom: "1px solid #3c3c3c",
    marginBottom: "-1px",
    userSelect: "none" as const,
  },
  body: {
    padding: "10px 12px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    marginBottom: "8px",
  },
  label: {
    width: "120px",
    flexShrink: 0,
    fontSize: "11px",
    color: "#ccc",
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
  select: {
    flex: 1,
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
  },
  readOnlyValue: {
    flex: 1,
    fontSize: "11px",
    color: "#aaa",
    padding: "2px 4px",
  },
  divider: {
    height: "1px",
    background: "#555",
    margin: "8px 0",
  },
  sectionTitle: {
    fontSize: "10px",
    color: "#999",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: "6px",
    marginTop: "4px",
  },
  btnRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: "6px",
    marginTop: "10px",
  },
  btn: {
    background: "#555",
    border: "1px solid #777",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "3px 14px",
    cursor: "pointer",
    minWidth: "58px",
  },
  btnPrimary: {
    background: "#1a6ea8",
    border: "1px solid #2288cc",
    color: "#fff",
    fontSize: "11px",
    padding: "3px 14px",
    cursor: "pointer",
    minWidth: "58px",
  },
};

// ---------------------------------------------------------------------------
// PublishSettingsDialog
// ---------------------------------------------------------------------------

export function PublishSettingsDialog({
  doc,
  onClose,
  pushDoc,
  open,
  settings,
  onSave,
}: PublishSettingsDialogProps): React.ReactElement | null {
  // When used in legacy mode (open prop), respect the open flag
  const isOpen = open !== undefined ? open : true;

  const props = doc.properties;

  // Active tab: "swf" | "html"
  const [activeTab, setActiveTab] = useState<"swf" | "html">("swf");

  // ---------------------------------------------------------------------------
  // Profile state
  // ---------------------------------------------------------------------------

  /** Normalize doc.publishProfiles — always has at least the Default profile. */
  const getDocProfiles = useCallback((): PublishProfile[] => {
    const docProfiles = doc.publishProfiles;
    if (!docProfiles || docProfiles.length === 0) {
      return [DEFAULT_PROFILE];
    }
    return [...docProfiles];
  }, [doc.publishProfiles]);

  const [profiles, setProfiles] = useState<PublishProfile[]>(getDocProfiles);

  /** The active profile id — prefer doc's stored id, else first profile. */
  const getInitialActiveId = useCallback((): string => {
    const ps = getDocProfiles();
    const storedId = doc.activePublishProfileId;
    if (storedId && ps.some((p) => p.id === storedId)) return storedId;
    return ps[0].id;
  }, [doc.activePublishProfileId, getDocProfiles]);

  const [activeProfileId, setActiveProfileId] = useState<string>(getInitialActiveId);

  /** The settings for the active profile (or legacy settings prop). */
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  const activeSettings: PublishProfileSettings = activeProfile.settings;

  // ---------------------------------------------------------------------------
  // Per-field state (seeded from active profile)
  // ---------------------------------------------------------------------------

  const [width, setWidth] = useState(props.width);
  const [height, setHeight] = useState(props.height);
  const [backgroundColor, setBackgroundColor] = useState(props.backgroundColor);
  const [frameRate, setFrameRate] = useState(props.frameRate);

  const [compress, setCompress] = useState(activeSettings.compress);
  const [protect, setProtect] = useState(activeSettings.protect);
  const [debuggingPermitted, setDebuggingPermitted] = useState(activeSettings.debuggingPermitted);
  const [debugPassword, setDebugPassword] = useState(activeSettings.debugPassword);
  const [jpegQuality, setJpegQuality] = useState(activeSettings.jpegQuality);

  const [publishHtml, setPublishHtml] = useState(activeSettings.html.publishHtml);
  const [htmlQuality, setHtmlQuality] = useState<HtmlPublishOptions["quality"]>(activeSettings.html.quality);
  const [htmlWmode, setHtmlWmode] = useState<HtmlPublishOptions["wmode"]>(activeSettings.html.wmode);
  const [htmlScale, setHtmlScale] = useState<HtmlPublishOptions["scale"]>(activeSettings.html.scale);
  const [htmlLoop, setHtmlLoop] = useState(activeSettings.html.loop);
  const [htmlMenu, setHtmlMenu] = useState(activeSettings.html.menu);

  // ---------------------------------------------------------------------------
  // Helpers: read current fields as PublishProfileSettings
  // ---------------------------------------------------------------------------

  const currentFieldsAsSettings = useCallback((): PublishProfileSettings => {
    return {
      filename: activeSettings.filename,
      jpegQuality,
      audioStreamFormat: activeSettings.audioStreamFormat,
      audioEventFormat: activeSettings.audioEventFormat,
      compress,
      protect,
      debuggingPermitted,
      debugPassword,
      html: {
        publishHtml,
        quality: htmlQuality,
        wmode: htmlWmode,
        scale: htmlScale,
        loop: htmlLoop,
        menu: htmlMenu,
      },
    };
  }, [activeSettings.filename, activeSettings.audioStreamFormat, activeSettings.audioEventFormat,
      jpegQuality, compress, protect, debuggingPermitted, debugPassword,
      publishHtml, htmlQuality, htmlWmode, htmlScale, htmlLoop, htmlMenu]);

  // ---------------------------------------------------------------------------
  // Load fields from a profile's settings
  // ---------------------------------------------------------------------------

  const loadFieldsFromSettings = useCallback((s: PublishProfileSettings) => {
    setCompress(s.compress);
    setProtect(s.protect);
    setDebuggingPermitted(s.debuggingPermitted);
    setDebugPassword(s.debugPassword);
    setJpegQuality(s.jpegQuality);
    setPublishHtml(s.html.publishHtml);
    setHtmlQuality(s.html.quality);
    setHtmlWmode(s.html.wmode);
    setHtmlScale(s.html.scale);
    setHtmlLoop(s.html.loop);
    setHtmlMenu(s.html.menu);
  }, []);

  // Sync local state when dialog re-opens
  useEffect(() => {
    if (isOpen) {
      setWidth(doc.properties.width);
      setHeight(doc.properties.height);
      setBackgroundColor(doc.properties.backgroundColor);
      setFrameRate(doc.properties.frameRate);

      const freshProfiles = getDocProfiles();
      setProfiles(freshProfiles);
      const freshActiveId = getInitialActiveId();
      setActiveProfileId(freshActiveId);
      const freshProfile = freshProfiles.find((p) => p.id === freshActiveId) ?? freshProfiles[0];

      // Prefer legacy settings prop for backward compat (Shell.tsx drives it)
      if (settings) {
        loadFieldsFromSettings(settingsToProfile(settings));
      } else {
        loadFieldsFromSettings(freshProfile.settings);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, doc.properties]);

  // ---------------------------------------------------------------------------
  // Profile switcher
  // ---------------------------------------------------------------------------

  const handleProfileChange = useCallback((id: string) => {
    // Save current field values back to the current profile first
    setProfiles((prev) => prev.map((p) =>
      p.id === activeProfileId ? { ...p, settings: currentFieldsAsSettings() } : p
    ));
    // Switch to the new profile and load its settings
    setActiveProfileId(id);
    const target = profiles.find((p) => p.id === id);
    if (target) {
      loadFieldsFromSettings(target.settings);
    }
  }, [activeProfileId, profiles, currentFieldsAsSettings, loadFieldsFromSettings]);

  // ---------------------------------------------------------------------------
  // Profile CRUD
  // ---------------------------------------------------------------------------

  const handleAddProfile = useCallback(() => {
    const name = window.prompt("Profile name:", "New Profile");
    if (!name || !name.trim()) return;
    const newProfile: PublishProfile = {
      id: newProfileId(),
      name: name.trim(),
      settings: currentFieldsAsSettings(),
    };
    setProfiles((prev) => [...prev, newProfile]);
    setActiveProfileId(newProfile.id);
  }, [currentFieldsAsSettings]);

  const handleDuplicateProfile = useCallback(() => {
    const source = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
    const name = window.prompt("Profile name:", `${source.name} copy`);
    if (!name || !name.trim()) return;
    const dup: PublishProfile = {
      id: newProfileId(),
      name: name.trim(),
      settings: currentFieldsAsSettings(),
    };
    setProfiles((prev) => [...prev, dup]);
    setActiveProfileId(dup.id);
  }, [profiles, activeProfileId, currentFieldsAsSettings]);

  const handleDeleteProfile = useCallback(() => {
    if (profiles.length <= 1) return; // never delete the last profile
    const confirmed = window.confirm(`Delete profile "${activeProfile.name}"?`);
    if (!confirmed) return;
    const remaining = profiles.filter((p) => p.id !== activeProfileId);
    setProfiles(remaining);
    const newActiveId = remaining[0].id;
    setActiveProfileId(newActiveId);
    loadFieldsFromSettings(remaining[0].settings);
  }, [profiles, activeProfileId, activeProfile.name, loadFieldsFromSettings]);

  // ---------------------------------------------------------------------------
  // Import / Export
  // ---------------------------------------------------------------------------

  const handleExportProfile = useCallback(() => {
    const profileToExport: PublishProfile = {
      ...activeProfile,
      settings: currentFieldsAsSettings(),
    };
    const json = JSON.stringify(profileToExport, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeProfile.name.replace(/[^a-z0-9_-]/gi, "_")}.fcp`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeProfile, currentFieldsAsSettings]);

  const handleImportProfile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".fcp,.json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string) as PublishProfile;
          if (!parsed.id || !parsed.name || !parsed.settings) {
            window.alert("Invalid publish profile file.");
            return;
          }
          // Give it a fresh id to avoid collisions
          const imported: PublishProfile = { ...parsed, id: newProfileId() };
          setProfiles((prev) => [...prev, imported]);
          setActiveProfileId(imported.id);
          loadFieldsFromSettings(imported.settings);
        } catch {
          window.alert("Failed to parse publish profile file.");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [loadFieldsFromSettings]);

  // ---------------------------------------------------------------------------
  // OK handler
  // ---------------------------------------------------------------------------

  const handleOk = useCallback(() => {
    const currentSettings = currentFieldsAsSettings();

    // Update profiles — save current fields to the active profile
    const updatedProfiles = profiles.map((p) =>
      p.id === activeProfileId ? { ...p, settings: currentSettings } : p
    );

    const updatedDoc = withProperties(doc, {
      width: Math.max(1, Math.round(Number(width) || props.width)),
      height: Math.max(1, Math.round(Number(height) || props.height)),
      backgroundColor: backgroundColor || props.backgroundColor,
      frameRate: Math.max(0.01, Number(frameRate) || props.frameRate),
    });

    // Persist profiles + activeProfileId into the doc
    const docWithProfiles: FlashDocument = {
      ...updatedDoc,
      publishProfiles: updatedProfiles,
      activePublishProfileId: activeProfileId,
    };

    pushDoc(docWithProfiles);

    // Persist SWF output options back to Shell via onSave (legacy compat)
    if (onSave) {
      onSave(profileToSettings(currentSettings));
    }
    onClose();
  }, [
    doc, width, height, backgroundColor, frameRate, props,
    pushDoc, onClose, onSave,
    profiles, activeProfileId, currentFieldsAsSettings,
  ]);

  // Keyboard: Enter = OK, Escape = Cancel
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== "TEXTAREA") {
          e.preventDefault();
          handleOk();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, handleOk, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={styles.dialog} onMouseDown={(e) => e.stopPropagation()}>
        {/* Title bar */}
        <div style={styles.titleBar}>
          <span style={styles.titleText}>Publish Settings</span>
          <button style={styles.closeBtn} onClick={onClose} title="Close">
            x
          </button>
        </div>

        {/* Profile management bar */}
        <div style={styles.profileBar}>
          <span style={styles.profileLabel}>Profile:</span>
          <select
            value={activeProfileId}
            onChange={(e) => handleProfileChange(e.target.value)}
            style={styles.profileSelect}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            style={styles.profileBtn}
            onClick={handleAddProfile}
            title="New profile (copies current settings)"
          >
            +
          </button>
          <button
            style={styles.profileBtn}
            onClick={handleDuplicateProfile}
            title="Duplicate profile"
          >
            Dup
          </button>
          <button
            style={{ ...styles.profileBtn, opacity: profiles.length <= 1 ? 0.4 : 1 }}
            onClick={handleDeleteProfile}
            disabled={profiles.length <= 1}
            title="Delete selected profile"
          >
            Del
          </button>
          <button
            style={styles.profileBtn}
            onClick={handleImportProfile}
            title="Import profile from .fcp / .json file"
          >
            Import...
          </button>
          <button
            style={styles.profileBtn}
            onClick={handleExportProfile}
            title="Export profile to .fcp file"
          >
            Export...
          </button>
        </div>

        {/* Tab bar */}
        <div style={styles.tabBar}>
          <div
            style={activeTab === "swf" ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab("swf")}
          >
            Flash (.swf)
          </div>
          <div
            style={activeTab === "html" ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab("html")}
          >
            HTML (.html)
          </div>
        </div>

        {/* Body */}
        <div style={styles.body}>
          {activeTab === "swf" && (
            <>
              {/* Version info (read-only) */}
              <div style={styles.sectionTitle}>Target Version</div>
              <div style={styles.row}>
                <span style={styles.label}>SWF Version:</span>
                <span style={styles.readOnlyValue}>SWF v8 (Flash Player 8)</span>
              </div>

              <div style={styles.divider} />

              {/* Document dimensions */}
              <div style={styles.sectionTitle}>Document Properties</div>

              <div style={styles.row}>
                <span style={styles.label}>Width (px):</span>
                <input
                  type="number"
                  min={1}
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  style={styles.input}
                  autoFocus
                />
              </div>

              <div style={styles.row}>
                <span style={styles.label}>Height (px):</span>
                <input
                  type="number"
                  min={1}
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                  style={styles.input}
                />
              </div>

              <div style={styles.row}>
                <span style={styles.label}>Background Color:</span>
                <div style={{ display: "flex", alignItems: "center", flex: 1, gap: 4 }}>
                  <input
                    type="color"
                    value={backgroundColor}
                    onChange={(e) => setBackgroundColor(e.target.value)}
                    style={{ width: 32, height: 22, padding: 0, border: "1px solid #555", cursor: "pointer", background: "none" }}
                  />
                  <input
                    type="text"
                    value={backgroundColor}
                    onChange={(e) => setBackgroundColor(e.target.value)}
                    style={{ ...styles.input, flex: 1 }}
                    spellCheck={false}
                    maxLength={7}
                  />
                </div>
              </div>

              <div style={styles.row}>
                <span style={styles.label}>Frame Rate (fps):</span>
                <input
                  type="number"
                  min={0.01}
                  max={120}
                  step={1}
                  value={frameRate}
                  onChange={(e) => setFrameRate(Number(e.target.value))}
                  style={styles.input}
                />
              </div>

              <div style={styles.divider} />

              {/* SWF Output Options */}
              <div style={styles.sectionTitle}>Flash (.swf) Output</div>

              <div style={styles.row}>
                <span style={styles.label}>JPEG quality:</span>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={jpegQuality}
                    onChange={(e) => setJpegQuality(Number(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: "11px", color: "#ccc", minWidth: "28px", textAlign: "right" }}>
                    {jpegQuality}
                  </span>
                </div>
              </div>

              <div style={checkboxRowStyle}>
                <input
                  id="ps-compress"
                  type="checkbox"
                  checked={compress}
                  onChange={(e) => setCompress(e.target.checked)}
                  style={{ cursor: "pointer" }}
                />
                <label htmlFor="ps-compress" style={{ fontSize: "11px", color: "#ccc", cursor: "pointer" }}>
                  Compress movie
                </label>
              </div>

              <div style={checkboxRowStyle}>
                <input
                  id="ps-protect"
                  type="checkbox"
                  checked={protect}
                  onChange={(e) => setProtect(e.target.checked)}
                  style={{ cursor: "pointer" }}
                />
                <label htmlFor="ps-protect" style={{ fontSize: "11px", color: "#ccc", cursor: "pointer" }}>
                  Protect from import
                </label>
              </div>

              <div style={checkboxRowStyle}>
                <input
                  id="ps-debugging"
                  type="checkbox"
                  checked={debuggingPermitted}
                  onChange={(e) => setDebuggingPermitted(e.target.checked)}
                  style={{ cursor: "pointer" }}
                />
                <label htmlFor="ps-debugging" style={{ fontSize: "11px", color: "#ccc", cursor: "pointer" }}>
                  Debugging permitted
                </label>
              </div>

              {debuggingPermitted && (
                <div style={styles.row}>
                  <span style={styles.label}>Password:</span>
                  <input
                    type="password"
                    value={debugPassword}
                    onChange={(e) => setDebugPassword(e.target.value)}
                    style={styles.input}
                    placeholder="(optional)"
                    autoComplete="off"
                  />
                </div>
              )}
            </>
          )}

          {activeTab === "html" && (
            <>
              <div style={styles.sectionTitle}>HTML Wrapper Output</div>

              <div style={checkboxRowStyle}>
                <input
                  id="ps-publish-html"
                  type="checkbox"
                  checked={publishHtml}
                  onChange={(e) => setPublishHtml(e.target.checked)}
                  style={{ cursor: "pointer" }}
                />
                <label htmlFor="ps-publish-html" style={{ fontSize: "11px", color: "#ccc", cursor: "pointer" }}>
                  Publish HTML file
                </label>
              </div>

              <div style={styles.divider} />

              <div style={styles.sectionTitle}>Playback</div>

              <div style={checkboxRowStyle}>
                <input
                  id="ps-html-loop"
                  type="checkbox"
                  checked={htmlLoop}
                  onChange={(e) => setHtmlLoop(e.target.checked)}
                  style={{ cursor: "pointer" }}
                  disabled={!publishHtml}
                />
                <label htmlFor="ps-html-loop" style={{ fontSize: "11px", color: publishHtml ? "#ccc" : "#666", cursor: "pointer" }}>
                  Loop
                </label>
              </div>

              <div style={checkboxRowStyle}>
                <input
                  id="ps-html-menu"
                  type="checkbox"
                  checked={htmlMenu}
                  onChange={(e) => setHtmlMenu(e.target.checked)}
                  style={{ cursor: "pointer" }}
                  disabled={!publishHtml}
                />
                <label htmlFor="ps-html-menu" style={{ fontSize: "11px", color: publishHtml ? "#ccc" : "#666", cursor: "pointer" }}>
                  Display menu
                </label>
              </div>

              <div style={styles.divider} />

              <div style={styles.sectionTitle}>Display</div>

              <div style={styles.row}>
                <span style={styles.label}>Quality:</span>
                <select
                  value={htmlQuality}
                  onChange={(e) => setHtmlQuality(e.target.value as HtmlPublishOptions["quality"])}
                  style={styles.select}
                  disabled={!publishHtml}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="best">Best</option>
                </select>
              </div>

              <div style={styles.row}>
                <span style={styles.label}>Window Mode:</span>
                <select
                  value={htmlWmode}
                  onChange={(e) => setHtmlWmode(e.target.value as HtmlPublishOptions["wmode"])}
                  style={styles.select}
                  disabled={!publishHtml}
                >
                  <option value="window">Window</option>
                  <option value="opaque">Opaque Windowless</option>
                  <option value="transparent">Transparent Windowless</option>
                </select>
              </div>

              <div style={styles.row}>
                <span style={styles.label}>Scale:</span>
                <select
                  value={htmlScale}
                  onChange={(e) => setHtmlScale(e.target.value as HtmlPublishOptions["scale"])}
                  style={styles.select}
                  disabled={!publishHtml}
                >
                  <option value="showall">Default (Show all)</option>
                  <option value="noborder">No border</option>
                  <option value="exactfit">Exact fit</option>
                  <option value="noscale">No scale</option>
                </select>
              </div>
            </>
          )}

          {/* Buttons (always visible) */}
          <div style={styles.btnRow}>
            <button style={styles.btn} onClick={onClose}>
              Cancel
            </button>
            <button style={styles.btnPrimary} onClick={handleOk}>
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

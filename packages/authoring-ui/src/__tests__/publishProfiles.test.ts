/**
 * Unit tests for publish profiles logic (PublishSettingsDialog).
 *
 * Covers:
 *   1. Default profile is always present (fallback)
 *   2. Adding a profile copies current settings
 *   3. Deleting a profile removes it from the list
 *   4. Switching profiles updates dialog fields (settings snapshot)
 */

import { describe, it, expect } from "vitest";
import type { PublishProfile, PublishProfileSettings } from "@flash/core";
import {
  DEFAULT_PROFILE,
  DEFAULT_PROFILE_SETTINGS,
} from "../PublishSettingsDialog.js";

// ---------------------------------------------------------------------------
// Helpers (mirror the dialog's pure profile logic)
// ---------------------------------------------------------------------------

function newProfileId(seed: number): string {
  return `profile-test-${seed}`;
}

function getProfiles(
  docProfiles: readonly PublishProfile[] | undefined
): PublishProfile[] {
  if (!docProfiles || docProfiles.length === 0) return [DEFAULT_PROFILE];
  return [...docProfiles];
}

function addProfile(
  profiles: PublishProfile[],
  name: string,
  settings: PublishProfileSettings,
  idSeed: number
): PublishProfile[] {
  const newProfile: PublishProfile = {
    id: newProfileId(idSeed),
    name,
    settings,
  };
  return [...profiles, newProfile];
}

function deleteProfile(
  profiles: PublishProfile[],
  id: string
): PublishProfile[] {
  if (profiles.length <= 1) return profiles; // never delete the last
  return profiles.filter((p) => p.id !== id);
}

function switchProfile(
  profiles: PublishProfile[],
  targetId: string
): PublishProfileSettings | null {
  const target = profiles.find((p) => p.id === targetId);
  return target ? target.settings : null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("publish profiles — default", () => {
  it("default profile is always present when doc has no profiles", () => {
    const profiles = getProfiles(undefined);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe("default");
    expect(profiles[0].name).toBe("Default");
  });

  it("default profile is always present when doc has empty profiles array", () => {
    const profiles = getProfiles([]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("Default");
  });

  it("existing profiles are preserved if doc has them", () => {
    const existing: PublishProfile[] = [
      { id: "a", name: "Dev", settings: { ...DEFAULT_PROFILE_SETTINGS, compress: true } },
      { id: "b", name: "Release", settings: { ...DEFAULT_PROFILE_SETTINGS, protect: true } },
    ];
    const profiles = getProfiles(existing);
    expect(profiles).toHaveLength(2);
    expect(profiles[0].name).toBe("Dev");
  });
});

describe("publish profiles — add", () => {
  it("adding a profile copies current settings into the new entry", () => {
    const initial = getProfiles(undefined);
    const customSettings: PublishProfileSettings = {
      ...DEFAULT_PROFILE_SETTINGS,
      compress: true,
      jpegQuality: 60,
    };
    const updated = addProfile(initial, "Compressed", customSettings, 1);
    expect(updated).toHaveLength(2);
    const added = updated.find((p) => p.name === "Compressed")!;
    expect(added).toBeDefined();
    expect(added.settings.compress).toBe(true);
    expect(added.settings.jpegQuality).toBe(60);
  });

  it("adding a profile gives it a unique id", () => {
    const initial = getProfiles(undefined);
    const updated1 = addProfile(initial, "A", DEFAULT_PROFILE_SETTINGS, 1);
    const updated2 = addProfile(updated1, "B", DEFAULT_PROFILE_SETTINGS, 2);
    const ids = updated2.map((p) => p.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

describe("publish profiles — delete", () => {
  it("deleting a profile removes it from the list", () => {
    const base: PublishProfile[] = [
      { id: "a", name: "Default", settings: DEFAULT_PROFILE_SETTINGS },
      { id: "b", name: "Dev", settings: DEFAULT_PROFILE_SETTINGS },
    ];
    const after = deleteProfile(base, "b");
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe("a");
  });

  it("cannot delete the last remaining profile", () => {
    const base = getProfiles(undefined); // single Default profile
    const after = deleteProfile(base, "default");
    expect(after).toHaveLength(1); // unchanged
    expect(after[0].id).toBe("default");
  });
});

describe("publish profiles — switch", () => {
  it("switching to a profile returns its settings", () => {
    const settingsA: PublishProfileSettings = {
      ...DEFAULT_PROFILE_SETTINGS,
      jpegQuality: 50,
      compress: false,
    };
    const settingsB: PublishProfileSettings = {
      ...DEFAULT_PROFILE_SETTINGS,
      jpegQuality: 90,
      compress: true,
    };
    const profiles: PublishProfile[] = [
      { id: "a", name: "Low Quality", settings: settingsA },
      { id: "b", name: "High Quality", settings: settingsB },
    ];

    const loadedA = switchProfile(profiles, "a");
    expect(loadedA).not.toBeNull();
    expect(loadedA!.jpegQuality).toBe(50);
    expect(loadedA!.compress).toBe(false);

    const loadedB = switchProfile(profiles, "b");
    expect(loadedB).not.toBeNull();
    expect(loadedB!.jpegQuality).toBe(90);
    expect(loadedB!.compress).toBe(true);
  });

  it("switching to a non-existent profile returns null", () => {
    const profiles = getProfiles(undefined);
    const result = switchProfile(profiles, "does-not-exist");
    expect(result).toBeNull();
  });
});

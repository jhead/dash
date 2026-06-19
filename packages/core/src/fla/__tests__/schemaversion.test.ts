import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDocument } from "../../model/document.js";
import { serializeDocument } from "../serialize.js";
import { deserializeDocument } from "../deserialize.js";

describe("FLA schema version", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serializeDocument produces JSON containing the current schemaVersion", () => {
    const doc = createDocument();
    const json = serializeDocument(doc);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed["schemaVersion"]).toBe(2);
  });

  it("deserializeDocument round-trips a serialized document successfully", () => {
    const doc = createDocument();
    const json = serializeDocument(doc);
    const restored = deserializeDocument(json);
    expect(restored.id).toBe(doc.id);
    expect(restored.scenes).toHaveLength(doc.scenes.length);
    expect(restored.properties.width).toBe(doc.properties.width);
    expect(restored.properties.height).toBe(doc.properties.height);
    expect(restored.properties.frameRate).toBe(doc.properties.frameRate);
  });

  it("deserializes a JSON string without schemaVersion (backward compat) without throwing", () => {
    const doc = createDocument();
    const json = serializeDocument(doc);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    delete parsed["schemaVersion"];
    const legacyJson = JSON.stringify(parsed);

    expect(() => deserializeDocument(legacyJson)).not.toThrow();
  });

  it("logs a warning when schemaVersion is missing (legacy document)", () => {
    const doc = createDocument();
    const json = serializeDocument(doc);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    delete parsed["schemaVersion"];
    const legacyJson = JSON.stringify(parsed);

    deserializeDocument(legacyJson);

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("version 0")
    );
  });

  it("deserializes a JSON string with schemaVersion 999 (forward compat) without throwing", () => {
    const doc = createDocument();
    const json = serializeDocument(doc);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed["schemaVersion"] = 999;
    const futureJson = JSON.stringify(parsed);

    expect(() => deserializeDocument(futureJson)).not.toThrow();
  });

  it("logs a warning when schemaVersion is newer than supported", () => {
    const doc = createDocument();
    const json = serializeDocument(doc);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed["schemaVersion"] = 999;
    const futureJson = JSON.stringify(parsed);

    deserializeDocument(futureJson);

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("999")
    );
  });

  it("deserialized doc from a future schema version has the same structure as the input", () => {
    const doc = createDocument();
    const json = serializeDocument(doc);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed["schemaVersion"] = 999;
    const futureJson = JSON.stringify(parsed);

    const restored = deserializeDocument(futureJson);

    expect(restored.id).toBe(doc.id);
    expect(restored.scenes).toHaveLength(doc.scenes.length);
    expect(restored.properties.width).toBe(doc.properties.width);
    expect(restored.properties.height).toBe(doc.properties.height);
    expect(restored.library.items).toHaveLength(doc.library.items.length);
  });
});

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  sha256Hex,
  hashDataUri,
  dataUriToBytes,
  bytesToDataUri,
  bytesToBase64,
  base64ToBytes,
  assetHashRef,
  parseAssetHashRef,
  isAssetHashRef,
  mimeFromDataUri,
} from "../asset-hash.js";

function nodeSha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("asset-hash sha256Hex", () => {
  it("matches the FIPS empty-string vector", () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the 'abc' vector", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("agrees with node:crypto across random sizes (incl. block boundaries)", () => {
    for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 1000, 100000]) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) & 0xff;
      expect(sha256Hex(bytes)).toBe(nodeSha(bytes));
    }
  });
});

describe("asset-hash base64 round-trip", () => {
  it("round-trips bytes through base64", () => {
    for (const n of [0, 1, 2, 3, 4, 17, 256]) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 13) & 0xff;
      const b64 = bytesToBase64(bytes);
      expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(bytes));
    }
  });

  it("decodes a standard base64 string the same as Buffer", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const b64 = bytesToBase64(bytes);
    expect(b64).toBe(Buffer.from(bytes).toString("base64"));
    expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(bytes));
  });

  it("treats '=' as padding everywhere — never as a data byte (mid-string '=')", () => {
    // Trailing padding decodes correctly.
    expect(Array.from(base64ToBytes("QQ=="))).toEqual([0x41]); // 'A'
    // A stray '=' mid-string carries no bits and must be ignored, not decoded as
    // a zero byte (the old B64_LOOKUP['=']=0 bug produced an extra byte).
    expect(Array.from(base64ToBytes("Q=Q="))).toEqual(
      Array.from(base64ToBytes("QQ")),
    );
    // Whitespace is also ignored.
    expect(Array.from(base64ToBytes("QQ\n=="))).toEqual([0x41]);
  });
});

describe("asset-hash dataUri helpers", () => {
  it("hashes a data URI's decoded bytes (same as hashing raw bytes)", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const uri = bytesToDataUri(bytes, "image/png");
    expect(mimeFromDataUri(uri)).toBe("image/png");
    expect(Array.from(dataUriToBytes(uri))).toEqual(Array.from(bytes));
    expect(hashDataUri(uri)).toBe(sha256Hex(bytes));
  });

  it("two URIs with the same bytes share a hash; different bytes differ", () => {
    const a = bytesToDataUri(new Uint8Array([1, 2, 3]), "image/png");
    const b = bytesToDataUri(new Uint8Array([1, 2, 3]), "image/jpeg");
    const c = bytesToDataUri(new Uint8Array([9, 9, 9]), "image/png");
    expect(hashDataUri(a)).toBe(hashDataUri(b)); // content-addressed by bytes only
    expect(hashDataUri(a)).not.toBe(hashDataUri(c));
  });
});

describe("asset-hash reference scheme", () => {
  it("builds and parses an asset-hash ref", () => {
    const ref = assetHashRef("deadbeef");
    expect(ref).toBe("asset-hash:deadbeef");
    expect(isAssetHashRef(ref)).toBe(true);
    expect(parseAssetHashRef(ref)).toBe("deadbeef");
  });

  it("ignores non-refs", () => {
    expect(isAssetHashRef("data:image/png;base64,AAAA")).toBe(false);
    expect(parseAssetHashRef("data:image/png;base64,AAAA")).toBeNull();
  });
});

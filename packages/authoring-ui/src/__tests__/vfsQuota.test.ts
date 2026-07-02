import { describe, it, expect } from "vitest";
import {
  ClassVfsQuotaError,
  isQuotaError,
  withQuotaMapping,
} from "../vfs/quota.js";

// ---------------------------------------------------------------------------
// Task 1404 — quota detection + mapping for the ClassVfs write path.
// ---------------------------------------------------------------------------

describe("isQuotaError", () => {
  it("detects a DOMException QuotaExceededError", () => {
    expect(isQuotaError(new DOMException("full", "QuotaExceededError"))).toBe(
      true
    );
  });

  it("detects the Firefox NS_ERROR_DOM_QUOTA_REACHED name", () => {
    expect(
      isQuotaError(new DOMException("full", "NS_ERROR_DOM_QUOTA_REACHED"))
    ).toBe(true);
  });

  it("detects a plain Error whose message mentions quota", () => {
    expect(isQuotaError(new Error("The quota has been exceeded."))).toBe(true);
  });

  it("treats a ClassVfsQuotaError as a quota error", () => {
    expect(isQuotaError(new ClassVfsQuotaError("x"))).toBe(true);
  });

  it("is false for an unrelated error / non-error", () => {
    expect(isQuotaError(new DOMException("nope", "NotFoundError"))).toBe(false);
    expect(isQuotaError(new Error("disk fell over"))).toBe(false);
    expect(isQuotaError("string")).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});

describe("withQuotaMapping", () => {
  it("returns the body result on success", async () => {
    await expect(withQuotaMapping("Foo.as", async () => 42)).resolves.toBe(42);
  });

  it("maps a QuotaExceededError to a ClassVfsQuotaError carrying path + cause", async () => {
    const cause = new DOMException("full", "QuotaExceededError");
    const p = withQuotaMapping("com/example/Foo.as", async () => {
      throw cause;
    });
    await expect(p).rejects.toBeInstanceOf(ClassVfsQuotaError);
    await p.catch((err: ClassVfsQuotaError) => {
      expect(err.path).toBe("com/example/Foo.as");
      expect(err.cause).toBe(cause);
      expect(err.message).toContain("com/example/Foo.as");
    });
  });

  it("propagates a non-quota error unchanged", async () => {
    const cause = new Error("permission denied");
    await expect(
      withQuotaMapping("Foo.as", async () => {
        throw cause;
      })
    ).rejects.toBe(cause);
  });
});

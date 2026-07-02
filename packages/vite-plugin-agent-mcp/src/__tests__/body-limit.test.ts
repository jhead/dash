/**
 * Unit tests for the request-body size cap (task 1393).
 *
 * parseBody previously accumulated an unbounded string; a hostile local peer
 * could stream an arbitrarily large body and exhaust dev-server memory. It now
 * aborts once the byte total crosses MAX_BODY_BYTES (→ HTTP 413) and destroys
 * the socket. These tests drive parseBody with a fake IncomingMessage.
 */

import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { parseBody, MAX_BODY_BYTES, RequestBodyTooLargeError } from "../index.js";

/** A minimal fake IncomingMessage: an EventEmitter with a method + destroy(). */
function fakeReq(method: string): {
  req: IncomingMessage;
  emitData: (buf: Buffer) => void;
  end: () => void;
  destroyed: () => boolean;
} {
  const ee = new EventEmitter() as EventEmitter & { method: string; destroy: () => void };
  ee.method = method;
  let destroyed = false;
  ee.destroy = () => {
    destroyed = true;
  };
  return {
    req: ee as unknown as IncomingMessage,
    emitData: (buf: Buffer) => ee.emit("data", buf),
    end: () => ee.emit("end"),
    destroyed: () => destroyed,
  };
}

describe("parseBody size cap", () => {
  it("returns undefined for non-POST requests", async () => {
    const { req } = fakeReq("GET");
    await expect(parseBody(req)).resolves.toBeUndefined();
  });

  it("parses a small valid JSON body", async () => {
    const { req, emitData, end } = fakeReq("POST");
    const promise = parseBody(req);
    emitData(Buffer.from(JSON.stringify({ hello: "world" })));
    end();
    await expect(promise).resolves.toEqual({ hello: "world" });
  });

  it("rejects with RequestBodyTooLargeError once the cap is crossed", async () => {
    const limit = 1024;
    const { req, emitData, destroyed } = fakeReq("POST");
    const promise = parseBody(req, limit);
    // First chunk under the cap, second chunk crosses it.
    emitData(Buffer.alloc(600, 0x61));
    emitData(Buffer.alloc(600, 0x61));
    await expect(promise).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(destroyed()).toBe(true);
  });

  it("ignores data after abort (no late resolve/reject)", async () => {
    const limit = 100;
    const { req, emitData, end } = fakeReq("POST");
    const promise = parseBody(req, limit);
    emitData(Buffer.alloc(200, 0x61));
    // Late events after the abort must not flip the rejection.
    emitData(Buffer.alloc(50, 0x61));
    end();
    await expect(promise).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("rejects invalid JSON under the cap", async () => {
    const { req, emitData, end } = fakeReq("POST");
    const promise = parseBody(req);
    emitData(Buffer.from("{not json"));
    end();
    await expect(promise).rejects.toThrow(/Invalid JSON/);
  });

  it("exposes a positive default cap", () => {
    expect(MAX_BODY_BYTES).toBeGreaterThan(0);
  });
});

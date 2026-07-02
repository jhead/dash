/**
 * Pure y-webrtc signaling relay logic (transport-agnostic).
 *
 * This module is the heart of the signaling server: a pub/sub relay that is a
 * faithful re-implementation of the upstream y-webrtc one-file Node signaling
 * server (`y-webrtc/bin/server.js`). It is deliberately kept FREE of any
 * Cloudflare / Durable Object / WebSocket types so it can be unit-tested in
 * plain Node (vitest) with NO Cloudflare credentials and NO miniflare runtime.
 *
 * Protocol (exact, from y-webrtc's `src/y-webrtc.js` SignalingConn):
 *   client → server  {type:'subscribe',   topics:string[]}
 *   client → server  {type:'unsubscribe', topics:string[]}
 *   client → server  {type:'publish',     topic:string, ...payload}
 *   client → server  {type:'ping'}                  → server replies {type:'pong'}
 *
 * On 'publish' the server forwards the WHOLE message to EVERY connection
 * subscribed to that topic — INCLUDING the publisher itself, exactly as the
 * upstream server does (it iterates `topics.get(topic)` with no self-exclusion).
 * (y-webrtc tolerates receiving its own announce/signal; the SDP/ICE messages it
 * cares about are addressed to a specific peer id inside the encrypted payload.)
 * The upstream server also stamps `message.clients = receivers.size` before
 * fanning out, so each subscriber learns the current topic size; we preserve
 * that field.
 *
 * The relay is connection-id agnostic: the transport (the Durable Object) holds
 * the actual WebSocket objects and supplies a stable string id per connection;
 * the relay tracks only `topic → Set<connId>` and `connId → Set<topic>`, and
 * returns a list of *delivery instructions* the transport carries out. This keeps
 * the relay a pure data structure with no I/O, which is what makes it cheaply and
 * exhaustively testable.
 */

/** A message the client may send. We only inspect `type` (+ `topics`/`topic`). */
export interface SignalingMessage {
  type?: string;
  topics?: unknown;
  topic?: unknown;
  /** publish payloads carry arbitrary extra fields (SDP/ICE/announce). */
  [key: string]: unknown;
}

/** An instruction telling the transport to send `message` to connection `to`. */
export interface SendInstruction {
  to: string;
  message: SignalingMessage;
}

/**
 * Abuse-bound limits (task 1355). This worker is the DEFAULT, self-deployed
 * signaling endpoint the deployer pays for, so — unlike a conventional public
 * y-webrtc relay — it ships with HARD caps to keep an open relay from turning
 * into a free pub/sub bus or a DoS / Cloudflare-billing amplifier. They are the
 * single source of truth for the guard logic: the Durable Object enforces the
 * connection-count + message-size ones (it owns the sockets); the relay enforces
 * the topic / subscriber / publish-rate ones (it owns the pub/sub state).
 *
 * None of these change the y-webrtc protocol — they only refuse work a legit
 * stock client never does. A real collab room is a handful of peers subscribing
 * to ONE room topic and publishing small JSON SDP/ICE frames, so the caps are
 * orders of magnitude above normal use and only bite a flood.
 */
export const LIMITS = {
  /** Max simultaneous WebSocket connections across the whole (single) DO. */
  MAX_CONNECTIONS_GLOBAL: 2000,
  /** Max simultaneous connections from one client IP (cf-connecting-ip). */
  MAX_CONNECTIONS_PER_IP: 50,
  /** Max distinct topics a single connection may be subscribed to at once. */
  MAX_TOPICS_PER_CONNECTION: 50,
  /** Max subscribers a single topic (room) may hold. A real room is tiny. */
  MAX_SUBSCRIBERS_PER_TOPIC: 100,
  /** Max accepted WebSocket message size in bytes; larger frames are dropped. */
  MAX_MESSAGE_BYTES: 64 * 1024,
  /**
   * Per-connection publish rate limit (token bucket). A normal handshake bursts
   * a few announce/signal frames then goes quiet, so a generous burst plus a
   * modest steady refill never bites a legit client but caps a publish flood.
   */
  PUBLISH_BURST: 60,
  PUBLISH_REFILL_PER_SEC: 20,
} as const;

/**
 * The persistable state of a {@link TokenBucket}: enough to reconstruct it
 * across a Durable Object hibernation wake (where the in-memory relay is lost
 * but per-socket attachments survive). Serialized into each socket's attachment.
 */
export interface TokenBucketState {
  /** Current token count (fractional; refilled lazily on `take`). */
  tokens: number;
  /** The monotonic timestamp (ms) of the last `take`, for elapsed-refill math. */
  last: number;
}

/**
 * A monotonic-clock token bucket for per-connection publish rate limiting. Kept
 * pure with an injected `now` (ms) so it is unit-testable with a fake clock.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  /** Try to consume one token. Returns false (rate-limited) when empty. */
  take(now: number): boolean {
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.refillPerSec,
    );
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Snapshot the mutable state for persistence across hibernation. */
  snapshot(): TokenBucketState {
    return { tokens: this.tokens, last: this.last };
  }

  /** Overwrite this bucket's state from a persisted snapshot. */
  restore(state: TokenBucketState): void {
    this.tokens = state.tokens;
    this.last = state.last;
  }
}

/**
 * The y-webrtc pub/sub relay state machine.
 *
 * Usage from the transport:
 *   const relay = new SignalingRelay();
 *   relay.addConnection(id);                       // on websocket accept
 *   const out = relay.handleMessage(id, parsed);   // on each message
 *   for (const { to, message } of out) socketFor(to).send(JSON.stringify(message));
 *   relay.removeConnection(id);                    // on websocket close/error
 */
export class SignalingRelay {
  /** topic name → set of subscribed connection ids. */
  private readonly topics = new Map<string, Set<string>>();
  /** connection id → set of topic names it is subscribed to (for cleanup). */
  private readonly subscriptions = new Map<string, Set<string>>();
  /** connection id → publish token bucket (lazily created on first publish). */
  private readonly buckets = new Map<string, TokenBucket>();

  /** Register a freshly-accepted connection. Idempotent. */
  addConnection(connId: string): void {
    if (!this.subscriptions.has(connId)) {
      this.subscriptions.set(connId, new Set());
    }
  }

  /**
   * Handle one decoded client message and return the messages to deliver.
   * Mirrors the upstream `conn.on('message')` switch — with the abuse guards
   * folded in (over-cap subscribes/publishes and rate-limited publishes are
   * silently dropped, never an error to the client, so a stock y-webrtc client
   * is unaffected). `now` is the current monotonic time in ms (for the publish
   * rate limiter); it defaults to `Date.now()` so existing callers/tests need no
   * change.
   */
  handleMessage(
    connId: string,
    message: SignalingMessage,
    now: number = Date.now(),
  ): SendInstruction[] {
    if (!message || typeof message.type !== "string") return [];
    // A message from a connection we never saw: treat as an implicit connect so
    // the relay is robust to transport ordering (hibernation can deliver a
    // message before the explicit addConnection in pathological races).
    this.addConnection(connId);

    switch (message.type) {
      case "subscribe":
        this.subscribe(connId, message.topics);
        return [];
      case "unsubscribe":
        this.unsubscribe(connId, message.topics);
        return [];
      case "publish":
        // Per-connection publish rate limit (token bucket). A flood past the
        // sustained rate is dropped on the floor.
        if (!this.takePublishToken(connId, now)) return [];
        return this.publish(message);
      case "ping":
        return [{ to: connId, message: { type: "pong" } }];
      default:
        return [];
    }
  }

  /**
   * Snapshot a connection's publish token bucket for persistence, or `null` if
   * it has not published yet (no bucket allocated). The transport persists this
   * into the socket's attachment so the rate-limit accounting survives a DO
   * hibernation wake (which discards the in-memory relay).
   */
  bucketState(connId: string): TokenBucketState | null {
    return this.buckets.get(connId)?.snapshot() ?? null;
  }

  /**
   * Restore a connection's publish bucket from a persisted snapshot (used by the
   * transport during rehydrate). Idempotent per connection: the last restore
   * wins. Elapsed time since `state.last` is credited as refill on the next
   * `take`, so a bucket drained just before hibernation stays (near) drained on a
   * near-immediate wake, closing the reset-on-wake abuse hole.
   */
  restoreBucket(connId: string, state: TokenBucketState): void {
    const bucket = new TokenBucket(
      LIMITS.PUBLISH_BURST,
      LIMITS.PUBLISH_REFILL_PER_SEC,
      state.last,
    );
    bucket.restore(state);
    this.buckets.set(connId, bucket);
  }

  /** Consume a publish token for `connId`, creating its bucket on first use. */
  private takePublishToken(connId: string, now: number): boolean {
    let bucket = this.buckets.get(connId);
    if (!bucket) {
      bucket = new TokenBucket(
        LIMITS.PUBLISH_BURST,
        LIMITS.PUBLISH_REFILL_PER_SEC,
        now,
      );
      this.buckets.set(connId, bucket);
    }
    return bucket.take(now);
  }

  /**
   * Subscribe a connection to every valid (string) topic in `topics`, enforcing
   * the per-connection topic cap and the per-topic subscriber cap. A subscribe
   * that would exceed either cap is silently ignored for the offending topic.
   */
  private subscribe(connId: string, topics: unknown): void {
    if (!Array.isArray(topics)) return;
    const subs = this.subscriptions.get(connId);
    if (!subs) return;
    for (const topicName of topics) {
      if (typeof topicName !== "string") continue;
      // Already subscribed — idempotent, no cap check needed.
      if (subs.has(topicName)) continue;
      // Cap the number of distinct topics one connection may hold.
      if (subs.size >= LIMITS.MAX_TOPICS_PER_CONNECTION) continue;
      let topic = this.topics.get(topicName);
      // Cap the number of subscribers a single topic (room) may hold.
      if (topic && topic.size >= LIMITS.MAX_SUBSCRIBERS_PER_TOPIC) continue;
      if (!topic) {
        topic = new Set();
        this.topics.set(topicName, topic);
      }
      topic.add(connId);
      subs.add(topicName);
    }
  }

  /** Unsubscribe a connection from the given topics. */
  private unsubscribe(connId: string, topics: unknown): void {
    if (!Array.isArray(topics)) return;
    const subs = this.subscriptions.get(connId);
    for (const topicName of topics) {
      if (typeof topicName !== "string") continue;
      const topic = this.topics.get(topicName);
      if (topic) {
        topic.delete(connId);
        if (topic.size === 0) this.topics.delete(topicName);
      }
      subs?.delete(topicName);
    }
  }

  /** Fan a publish out to every subscriber of its topic (incl. the publisher). */
  private publish(message: SignalingMessage): SendInstruction[] {
    const topicName = message.topic;
    if (typeof topicName !== "string") return [];
    const receivers = this.topics.get(topicName);
    if (!receivers || receivers.size === 0) return [];
    // Match upstream: stamp the current subscriber count onto the forwarded msg.
    const outMessage: SignalingMessage = {
      ...message,
      clients: receivers.size,
    };
    const out: SendInstruction[] = [];
    for (const connId of receivers) {
      out.push({ to: connId, message: outMessage });
    }
    return out;
  }

  /** Remove a connection and drop it from every topic it was subscribed to. */
  removeConnection(connId: string): void {
    const subs = this.subscriptions.get(connId);
    if (subs) {
      for (const topicName of subs) {
        const topic = this.topics.get(topicName);
        if (topic) {
          topic.delete(connId);
          if (topic.size === 0) this.topics.delete(topicName);
        }
      }
    }
    this.subscriptions.delete(connId);
    this.buckets.delete(connId);
  }

  // ---- introspection helpers (used by tests / diagnostics) ----

  /** Number of connections currently subscribed to `topicName`. */
  topicSize(topicName: string): number {
    return this.topics.get(topicName)?.size ?? 0;
  }

  /** Total number of distinct live topics. */
  topicCount(): number {
    return this.topics.size;
  }

  /** Total number of registered connections. */
  connectionCount(): number {
    return this.subscriptions.size;
  }

  /** Whether `connId` is currently registered. */
  hasConnection(connId: string): boolean {
    return this.subscriptions.has(connId);
  }
}

/**
 * Parse a comma/whitespace-separated allowlist string (from a wrangler var) into
 * a normalized list of allowed origins. Each entry is lower-cased and trailing
 * slashes are stripped so `https://app.example.com/` ≡ `https://app.example.com`.
 * The special entry `*` (anywhere in the list) means "allow any origin".
 */
export function parseAllowedOrigins(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase().replace(/\/+$/, ""))
    .filter((s) => s.length > 0);
}

/**
 * Decide whether a WebSocket Upgrade request's `Origin` is allowed.
 *
 * Policy (deliberately permissive by default so deploying the worker never
 * silently breaks a stock y-webrtc client):
 *   - empty allowlist (or one containing `*`) → ALLOW everything (the open
 *     y-webrtc default; the hard rate/size caps are the real abuse bound).
 *   - non-empty allowlist → ALLOW only if the request Origin matches an entry.
 *
 * A MISSING Origin header (non-browser clients: native y-webrtc, curl) is
 * allowed even with a non-empty list, because Origin is a *soft, spoofable*
 * browser-only control — its job is to deter casual third-party WEB pages from
 * embedding our relay, not to authenticate (the caps + E2E encryption do the
 * hard work). Set `allowMissingOrigin=false` to also refuse Origin-less upgrades.
 */
export function isOriginAllowed(
  origin: string | null | undefined,
  allowed: string[],
  allowMissingOrigin = true,
): boolean {
  // Empty list or wildcard → fully open.
  if (allowed.length === 0 || allowed.includes("*")) return true;
  if (origin == null || origin === "") return allowMissingOrigin;
  const normalized = origin.trim().toLowerCase().replace(/\/+$/, "");
  return allowed.includes(normalized);
}

/**
 * Byte length of an incoming WebSocket frame, for the max-message-size guard.
 * A string is measured as UTF-8 bytes (what a JSON frame actually weighs on the
 * wire), binary frames by their byte length.
 */
export function frameByteLength(data: string | ArrayBuffer | Uint8Array): number {
  if (typeof data === "string") return new TextEncoder().encode(data).length;
  if (data instanceof Uint8Array) return data.byteLength;
  return data.byteLength;
}

/**
 * Parse an incoming WebSocket frame (string or bytes) into a SignalingMessage.
 * Returns `null` on any non-JSON / non-object payload so the caller can ignore
 * it (mirrors the upstream server, which only acts on `message.type`).
 */
export function parseSignalingFrame(
  data: string | ArrayBuffer | Uint8Array,
): SignalingMessage | null {
  let text: string;
  if (typeof data === "string") {
    text = data;
  } else if (data instanceof Uint8Array) {
    text = new TextDecoder().decode(data);
  } else {
    text = new TextDecoder().decode(new Uint8Array(data));
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed as SignalingMessage;
    return null;
  } catch {
    return null;
  }
}

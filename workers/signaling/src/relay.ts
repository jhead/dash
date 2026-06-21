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

  /** Register a freshly-accepted connection. Idempotent. */
  addConnection(connId: string): void {
    if (!this.subscriptions.has(connId)) {
      this.subscriptions.set(connId, new Set());
    }
  }

  /**
   * Handle one decoded client message and return the messages to deliver.
   * Mirrors the upstream `conn.on('message')` switch exactly.
   */
  handleMessage(connId: string, message: SignalingMessage): SendInstruction[] {
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
        return this.publish(message);
      case "ping":
        return [{ to: connId, message: { type: "pong" } }];
      default:
        return [];
    }
  }

  /** Subscribe a connection to every valid (string) topic in `topics`. */
  private subscribe(connId: string, topics: unknown): void {
    if (!Array.isArray(topics)) return;
    const subs = this.subscriptions.get(connId);
    if (!subs) return;
    for (const topicName of topics) {
      if (typeof topicName !== "string") continue;
      let topic = this.topics.get(topicName);
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

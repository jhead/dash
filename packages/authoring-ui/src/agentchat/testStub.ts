// ---------------------------------------------------------------------------
// Agent Chat e2e test stub (Phase 4).
//
// This module exists SOLELY for the end-to-end oracle that proves the chat can
// drive authoring with NO real API key / network. It builds a `runTurn` that
// runs the REAL agent loop (`runAgentTurn` → AI SDK v6 `streamText`) but against
// a STUBBED language model (`MockLanguageModelV3` from `ai/test`) whose stream
// emits a single tool call. Because the panel still passes the REAL
// `buildAgentTools()` tool set, the stubbed model's tool call is auto-executed
// by `streamText`, flowing through `dispatchAgentCommand` into the live document.
//
// The Shell installs the result on `window.__agentChatTestStub` only in test
// mode (DEV / VITE_FLASH_TEST=1); the e2e spec then wires it onto
// `window.__agentChatTestHook` (read by AgentChatPanel). None of this is reached
// in a production build (the Shell guards the import behind the test-env flag).
//
// The key property under test: model tool-call → buildAgentTools execute →
// dispatchAgentCommand → document mutation. Using the real `streamText` loop
// (rather than hand-driving the reducer) keeps the oracle faithful to the
// production code path — only the model is swapped.
// ---------------------------------------------------------------------------

import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { runAgentTurn, type RunAgentOptions, type RunAgentResult } from "./agentLoop.js";

/** A single tool call the stubbed model should emit. */
export interface StubToolCall {
  toolName: string;
  /** The arguments object (serialized to JSON for the provider stream). */
  args: Record<string, unknown>;
  /** Optional assistant text to stream before the tool call. */
  text?: string;
}

/**
 * Build a `runTurn` (matching the panel's injectable `runTurn` prop) that runs
 * the real agent loop against a mock model emitting the given tool call(s). The
 * panel-supplied `tools` (the real {@link buildAgentTools} set) are used, so the
 * tool actually executes and mutates the document.
 */
export function makeStubRunTurn(
  toolCalls: StubToolCall[]
): (options: RunAgentOptions) => Promise<RunAgentResult> {
  return (options: RunAgentOptions): Promise<RunAgentResult> => {
    // A realistic single-action turn is TWO model steps:
    //   step 0: emit the scripted tool call(s) → AI SDK auto-executes them →
    //           appends the tool result(s) to the message history → loops.
    //   step 1: with the tool result(s) in context, emit a final plain-text
    //           answer and finishReason:'stop' (NO tool-call) so the
    //           `stopWhen: stepCountIs` loop terminates after exactly one tool
    //           round. This is what a real model does — call the tool once,
    //           then summarize. The old stub re-emitted the tool call on EVERY
    //           doStream invocation, so the loop ran to the stepCount cap and
    //           dispatched the tool N times (N rectangles). The call index in
    //           this closure is what makes the turn terminate after one round.
    let stepIndex = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        const isFirstStep = stepIndex === 0;
        stepIndex += 1;
        const callId = `stub-${Math.random().toString(36).slice(2)}`;
        const parts: unknown[] = [{ type: "stream-start", warnings: [] }];

        if (isFirstStep) {
          // First step: the scripted assistant text + tool call(s).
          for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            const id = `${callId}-${i}`;
            if (tc.text) {
              parts.push({ type: "text-start", id });
              parts.push({ type: "text-delta", id, delta: tc.text });
              parts.push({ type: "text-end", id });
            }
            parts.push({
              type: "tool-call",
              toolCallId: id,
              toolName: tc.toolName,
              input: JSON.stringify(tc.args),
            });
          }
          parts.push({
            type: "finish",
            finishReason: "tool-calls",
            // V3 provider usage shape (LanguageModelV3Usage): token counts are
            // nested under `.total` so the AI SDK's `asLanguageModelUsage`
            // aggregates them into `result.totalUsage` (task 1337). A flat
            // `{inputTokens:1}` would read as `undefined` and the per-thread
            // usage footer would never populate.
            usage: {
              inputTokens: { total: 1 },
              outputTokens: { total: 1 },
              totalTokens: 2,
            },
          });
        } else {
          // Subsequent step(s): after the tool result is in context, emit a
          // final plain-text answer and STOP — no further tool calls. This
          // terminates the multi-step loop after exactly one tool round.
          const id = `${callId}-final`;
          parts.push({ type: "text-start", id });
          parts.push({ type: "text-delta", id, delta: "Done." });
          parts.push({ type: "text-end", id });
          parts.push({
            type: "finish",
            finishReason: "stop",
            // V3 provider usage shape (LanguageModelV3Usage): token counts are
            // nested under `.total` so the AI SDK's `asLanguageModelUsage`
            // aggregates them into `result.totalUsage` (task 1337). A flat
            // `{inputTokens:1}` would read as `undefined` and the per-thread
            // usage footer would never populate.
            usage: {
              inputTokens: { total: 1 },
              outputTokens: { total: 1 },
              totalTokens: 2,
            },
          });
        }

        return {
          // simulateReadableStream yields the parts as a ReadableStream the AI
          // SDK consumes exactly like a real provider stream. Zero delays keep
          // the e2e deterministic and fast.
          stream: simulateReadableStream({
            chunks: parts as never,
            initialDelayInMs: 0,
            chunkDelayInMs: 0,
          }),
        };
      },
    });

    // Run the REAL loop with the mock model + the panel's REAL tools.
    return runAgentTurn({ ...options, model });
  };
}

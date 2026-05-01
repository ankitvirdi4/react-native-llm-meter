import type { Meter } from "../meter.js";
import { wrapPath } from "./_proxy.js";
import { wrapAsyncIterable } from "./_stream.js";

export interface AnthropicLike {
  messages: {
    create: (
      params: AnthropicCreateParams,
    ) => Promise<AnthropicResponse | AnthropicStream>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface AnthropicCreateParams {
  model: string;
  stream?: boolean;
  [key: string]: unknown;
}

export interface AnthropicResponse {
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  [key: string]: unknown;
}

export interface AnthropicStreamChunk {
  type?: string;
  message?: {
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  usage?: { input_tokens?: number; output_tokens?: number };
  [key: string]: unknown;
}

export type AnthropicStream = AsyncIterable<AnthropicStreamChunk> & object;

export function isAnthropicClient(client: unknown): client is AnthropicLike {
  if (!client || typeof client !== "object") return false;
  const messages = (client as { messages?: unknown }).messages;
  if (!messages || typeof messages !== "object") return false;
  return typeof (messages as { create?: unknown }).create === "function";
}

export function wrapAnthropic<T extends AnthropicLike>(client: T, meter: Meter): T {
  const meteredCreate = async (
    params: AnthropicCreateParams,
  ): Promise<AnthropicResponse | AnthropicStream> => {
    const start = Date.now();
    const originalCreate = client.messages.create.bind(client.messages);

    if (params?.stream) {
      const stream = (await originalCreate(params)) as AnthropicStream;
      let model = params.model;
      let inputTokens = 0;
      let outputTokens = 0;
      let ttftMs: number | undefined;

      return wrapAsyncIterable<AnthropicStreamChunk>(stream, {
        onChunk: (chunk) => {
          if (chunk.type === "message_start" && chunk.message) {
            if (chunk.message.model) model = chunk.message.model;
            if (chunk.message.usage?.input_tokens !== undefined) {
              inputTokens = chunk.message.usage.input_tokens;
            }
          }
          if (chunk.type === "content_block_delta" && ttftMs === undefined) {
            ttftMs = Date.now() - start;
          }
          if (chunk.type === "message_delta" && chunk.usage?.output_tokens !== undefined) {
            outputTokens = chunk.usage.output_tokens;
          }
        },
        onComplete: () => {
          meter.record({
            provider: "anthropic",
            model,
            inputTokens,
            outputTokens,
            latencyMs: Date.now() - start,
            ttftMs,
          });
        },
        onError: () => {
          meter.record({
            provider: "anthropic",
            model,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: Date.now() - start,
            ttftMs,
          });
        },
      });
    }

    try {
      const response = (await originalCreate(params)) as AnthropicResponse;
      meter.record({
        provider: "anthropic",
        model: response.model ?? params.model,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        latencyMs: Date.now() - start,
      });
      return response;
    } catch (err) {
      meter.record({
        provider: "anthropic",
        model: params?.model ?? "unknown",
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - start,
      });
      throw err;
    }
  };

  return wrapPath(client, ["messages"], { create: meteredCreate });
}

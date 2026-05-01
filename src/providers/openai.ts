import type { Meter } from "../meter.js";
import { wrapPath } from "./_proxy.js";
import { wrapAsyncIterable } from "./_stream.js";

export interface OpenAILike {
  chat: {
    completions: {
      create: (
        params: OpenAICreateParams,
      ) => Promise<OpenAIResponse | OpenAIStream>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface OpenAICreateParams {
  model: string;
  stream?: boolean;
  [key: string]: unknown;
}

export interface OpenAIResponse {
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  [key: string]: unknown;
}

export interface OpenAIStreamChunk {
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  [key: string]: unknown;
}

export type OpenAIStream = AsyncIterable<OpenAIStreamChunk> & object;

export function isOpenAIClient(client: unknown): client is OpenAILike {
  if (!client || typeof client !== "object") return false;
  const chat = (client as { chat?: unknown }).chat;
  if (!chat || typeof chat !== "object") return false;
  const completions = (chat as { completions?: unknown }).completions;
  if (!completions || typeof completions !== "object") return false;
  return typeof (completions as { create?: unknown }).create === "function";
}

export function wrapOpenAI<T extends OpenAILike>(client: T, meter: Meter): T {
  const meteredCreate = async (
    params: OpenAICreateParams,
  ): Promise<OpenAIResponse | OpenAIStream> => {
    const start = Date.now();
    const originalCreate = client.chat.completions.create.bind(
      client.chat.completions,
    );

    if (params?.stream) {
      const stream = (await originalCreate(params)) as OpenAIStream;
      let model = params.model;
      let inputTokens = 0;
      let outputTokens = 0;

      return wrapAsyncIterable<OpenAIStreamChunk>(stream, {
        onChunk: (chunk) => {
          if (chunk.model) model = chunk.model;
          if (chunk.usage) {
            if (chunk.usage.prompt_tokens !== undefined) {
              inputTokens = chunk.usage.prompt_tokens;
            }
            if (chunk.usage.completion_tokens !== undefined) {
              outputTokens = chunk.usage.completion_tokens;
            }
          }
        },
        onComplete: () => {
          meter.record({
            provider: "openai",
            model,
            inputTokens,
            outputTokens,
            latencyMs: Date.now() - start,
          });
        },
        onError: () => {
          meter.record({
            provider: "openai",
            model,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: Date.now() - start,
          });
        },
      });
    }

    try {
      const response = (await originalCreate(params)) as OpenAIResponse;
      meter.record({
        provider: "openai",
        model: response.model ?? params.model,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        latencyMs: Date.now() - start,
      });
      return response;
    } catch (err) {
      meter.record({
        provider: "openai",
        model: params?.model ?? "unknown",
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - start,
      });
      throw err;
    }
  };

  return wrapPath(client, ["chat", "completions"], { create: meteredCreate });
}

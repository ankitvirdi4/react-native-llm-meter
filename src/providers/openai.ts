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
  stream_options?: { include_usage?: boolean; [key: string]: unknown };
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
  choices?: Array<{
    delta?: { content?: string; role?: string };
    [key: string]: unknown;
  }>;
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
  let usageWarningFired = false;

  const meteredCreate = async (
    params: OpenAICreateParams,
  ): Promise<OpenAIResponse | OpenAIStream> => {
    const start = Date.now();
    const originalCreate = client.chat.completions.create.bind(
      client.chat.completions,
    );

    if (params?.stream) {
      // OpenAI streams omit usage by default. Auto enable include_usage so
      // events record real token counts. Pass through if the user already
      // set the option (true or false), they get to keep their choice.
      if (params.stream_options?.include_usage === undefined) {
        params = {
          ...params,
          stream_options: { ...params.stream_options, include_usage: true },
        };
        if (!usageWarningFired) {
          usageWarningFired = true;
          if (typeof console !== "undefined" && typeof console.warn === "function") {
            console.warn(
              "[react-native-llm-meter] Auto enabled stream_options.include_usage on " +
                "OpenAI streaming so token counts are captured. Set the option " +
                "explicitly to silence this notice.",
            );
          }
        }
      }
      const stream = (await originalCreate(params)) as OpenAIStream;
      let model = params.model;
      let inputTokens = 0;
      let outputTokens = 0;
      let ttftMs: number | undefined;

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
          if (ttftMs === undefined) {
            const content = chunk.choices?.[0]?.delta?.content;
            if (typeof content === "string" && content.length > 0) {
              ttftMs = Date.now() - start;
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
            ttftMs,
          });
        },
        onError: () => {
          meter.record({
            provider: "openai",
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

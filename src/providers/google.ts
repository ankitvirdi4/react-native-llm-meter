import type { Meter } from "../meter.js";
import { wrapPath } from "./_proxy.js";
import { wrapAsyncIterable } from "./_stream.js";

export interface GoogleLike {
  models: {
    generateContent: (params: GoogleGenerateParams) => Promise<GoogleResponse>;
    generateContentStream?: (
      params: GoogleGenerateParams,
    ) => Promise<GoogleStream>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface GoogleGenerateParams {
  model: string;
  [key: string]: unknown;
}

export interface GoogleResponse {
  modelVersion?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  [key: string]: unknown;
}

export interface GoogleStreamChunk {
  modelVersion?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export type GoogleStream = AsyncIterable<GoogleStreamChunk> & object;

export function isGoogleClient(client: unknown): client is GoogleLike {
  if (!client || typeof client !== "object") return false;
  const models = (client as { models?: unknown }).models;
  if (!models || typeof models !== "object") return false;
  return typeof (models as { generateContent?: unknown }).generateContent === "function";
}

// Legacy @google/generative-ai shape
export interface GoogleLegacyModel {
  generateContent: (params: unknown) => Promise<GoogleLegacyResult>;
  generateContentStream?: (params: unknown) => Promise<GoogleLegacyStreamResult>;
  [key: string]: unknown;
}

export interface GoogleLegacyClient {
  getGenerativeModel: (params: { model: string; [key: string]: unknown }) => GoogleLegacyModel;
  [key: string]: unknown;
}

export interface GoogleLegacyResult {
  response?: {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface GoogleLegacyStreamResult {
  stream: AsyncIterable<{
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    [key: string]: unknown;
  }> & object;
  response?: Promise<GoogleLegacyResult["response"]>;
}

export function isGoogleLegacyClient(client: unknown): client is GoogleLegacyClient {
  if (!client || typeof client !== "object") return false;
  return (
    typeof (client as { getGenerativeModel?: unknown }).getGenerativeModel ===
    "function"
  );
}

export function wrapGoogleLegacy<T extends GoogleLegacyClient>(
  client: T,
  meter: Meter,
): T {
  const originalGetModel = client.getGenerativeModel.bind(client);

  const wrappedGetModel: GoogleLegacyClient["getGenerativeModel"] = (params) => {
    const modelName = params.model;
    const model = originalGetModel(params);
    const originalGenerateContent = model.generateContent.bind(model);
    const originalGenerateContentStream = model.generateContentStream?.bind(model);

    const meteredGenerate = async (genParams: unknown): Promise<GoogleLegacyResult> => {
      const start = Date.now();
      try {
        const result = await originalGenerateContent(genParams);
        const usage = result.response?.usageMetadata;
        meter.record({
          provider: "google",
          model: modelName,
          inputTokens: usage?.promptTokenCount ?? 0,
          outputTokens: usage?.candidatesTokenCount ?? 0,
          latencyMs: Date.now() - start,
        });
        return result;
      } catch (err) {
        meter.record({
          provider: "google",
          model: modelName,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: Date.now() - start,
        });
        throw err;
      }
    };

    const meteredStream = originalGenerateContentStream
      ? async (genParams: unknown): Promise<GoogleLegacyStreamResult> => {
          const start = Date.now();
          const result = await originalGenerateContentStream(genParams);
          let inputTokens = 0;
          let outputTokens = 0;
          let ttftMs: number | undefined;

          const wrappedStream = wrapAsyncIterable(result.stream, {
            onChunk: (chunk) => {
              if (chunk.usageMetadata?.promptTokenCount !== undefined) {
                inputTokens = chunk.usageMetadata.promptTokenCount;
              }
              if (chunk.usageMetadata?.candidatesTokenCount !== undefined) {
                outputTokens = chunk.usageMetadata.candidatesTokenCount;
              }
              if (ttftMs === undefined) {
                const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
                if (typeof text === "string" && text.length > 0) {
                  ttftMs = Date.now() - start;
                }
              }
            },
            onComplete: () => {
              meter.record({
                provider: "google",
                model: modelName,
                inputTokens,
                outputTokens,
                latencyMs: Date.now() - start,
                ttftMs,
              });
            },
            onError: () => {
              meter.record({
                provider: "google",
                model: modelName,
                inputTokens: 0,
                outputTokens: 0,
                latencyMs: Date.now() - start,
                ttftMs,
              });
            },
          });

          return { ...result, stream: wrappedStream };
        }
      : undefined;

    return new Proxy(model, {
      get(target, prop, receiver) {
        if (prop === "generateContent") return meteredGenerate;
        if (prop === "generateContentStream" && meteredStream) return meteredStream;
        return Reflect.get(target, prop, receiver);
      },
    });
  };

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "getGenerativeModel") return wrappedGetModel;
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}

export function wrapGoogle<T extends GoogleLike>(client: T, meter: Meter): T {
  const meteredGenerate = async (
    params: GoogleGenerateParams,
  ): Promise<GoogleResponse> => {
    const start = Date.now();
    const original = client.models.generateContent.bind(client.models);
    try {
      const response = await original(params);
      meter.record({
        provider: "google",
        model: response.modelVersion ?? params.model,
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        latencyMs: Date.now() - start,
      });
      return response;
    } catch (err) {
      meter.record({
        provider: "google",
        model: params?.model ?? "unknown",
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - start,
      });
      throw err;
    }
  };

  const meteredStream = async (
    params: GoogleGenerateParams,
  ): Promise<GoogleStream> => {
    const start = Date.now();
    const original = client.models.generateContentStream;
    if (!original) {
      throw new Error("generateContentStream not available on this Google client");
    }
    const bound = original.bind(client.models);
    const stream = await bound(params);
    let model = params.model;
    let inputTokens = 0;
    let outputTokens = 0;
    let ttftMs: number | undefined;

    return wrapAsyncIterable<GoogleStreamChunk>(stream, {
      onChunk: (chunk) => {
        if (chunk.modelVersion) model = chunk.modelVersion;
        if (chunk.usageMetadata) {
          if (chunk.usageMetadata.promptTokenCount !== undefined) {
            inputTokens = chunk.usageMetadata.promptTokenCount;
          }
          if (chunk.usageMetadata.candidatesTokenCount !== undefined) {
            outputTokens = chunk.usageMetadata.candidatesTokenCount;
          }
        }
        if (ttftMs === undefined) {
          const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
          if (typeof text === "string" && text.length > 0) {
            ttftMs = Date.now() - start;
          }
        }
      },
      onComplete: () => {
        meter.record({
          provider: "google",
          model,
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - start,
          ttftMs,
        });
      },
      onError: () => {
        meter.record({
          provider: "google",
          model,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: Date.now() - start,
          ttftMs,
        });
      },
    });
  };

  return wrapPath(client, ["models"], {
    generateContent: meteredGenerate,
    generateContentStream: meteredStream,
  });
}

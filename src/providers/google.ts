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
  [key: string]: unknown;
}

export type GoogleStream = AsyncIterable<GoogleStreamChunk> & object;

export function isGoogleClient(client: unknown): client is GoogleLike {
  if (!client || typeof client !== "object") return false;
  const models = (client as { models?: unknown }).models;
  if (!models || typeof models !== "object") return false;
  return typeof (models as { generateContent?: unknown }).generateContent === "function";
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
      },
      onComplete: () => {
        meter.record({
          provider: "google",
          model,
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - start,
        });
      },
      onError: () => {
        meter.record({
          provider: "google",
          model,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: Date.now() - start,
        });
      },
    });
  };

  return wrapPath(client, ["models"], {
    generateContent: meteredGenerate,
    generateContentStream: meteredStream,
  });
}

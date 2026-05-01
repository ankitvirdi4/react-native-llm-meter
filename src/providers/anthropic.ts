import type { Meter } from "../meter.js";

export interface AnthropicLike {
  messages: {
    create: (params: AnthropicCreateParams) => Promise<AnthropicResponse>;
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

export function isAnthropicClient(client: unknown): client is AnthropicLike {
  if (!client || typeof client !== "object") return false;
  const messages = (client as { messages?: unknown }).messages;
  if (!messages || typeof messages !== "object") return false;
  return typeof (messages as { create?: unknown }).create === "function";
}

export function wrapAnthropic<T extends AnthropicLike>(client: T, meter: Meter): T {
  const meteredCreate = async (
    params: AnthropicCreateParams,
  ): Promise<AnthropicResponse> => {
    const start = Date.now();
    const originalCreate = client.messages.create.bind(client.messages);

    // Streaming pass through. Phase 4 will handle stream usage extraction.
    if (params?.stream) {
      return originalCreate(params);
    }

    try {
      const response = await originalCreate(params);
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

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "messages") {
        return new Proxy(target.messages, {
          get(msgTarget, msgProp, msgReceiver) {
            if (msgProp === "create") return meteredCreate;
            return Reflect.get(msgTarget, msgProp, msgReceiver);
          },
        });
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}

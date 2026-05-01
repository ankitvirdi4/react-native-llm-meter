import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});
import { Meter } from "../meter.js";
import {
  isAnthropicClient,
  wrapAnthropic,
  type AnthropicLike,
} from "./anthropic.js";

function makeFakeClient(overrides: Partial<{ response: unknown; reject: unknown }> = {}) {
  const create = vi.fn(async () => {
    if ("reject" in overrides) throw overrides.reject;
    return (
      overrides.response ?? {
        id: "msg_test",
        model: "claude-sonnet-4-6",
        usage: { input_tokens: 1000, output_tokens: 500 },
        content: [{ type: "text", text: "hi" }],
      }
    );
  });
  const countTokens = vi.fn(async () => ({ input_tokens: 42 }));
  return {
    baseURL: "https://api.anthropic.com",
    messages: { create, countTokens },
    create,
    countTokens,
  };
}

describe("isAnthropicClient", () => {
  it("returns true for shape with messages.create", () => {
    expect(isAnthropicClient({ messages: { create: () => {} } })).toBe(true);
  });

  it("returns false for null and primitives", () => {
    expect(isAnthropicClient(null)).toBe(false);
    expect(isAnthropicClient(undefined)).toBe(false);
    expect(isAnthropicClient(42)).toBe(false);
    expect(isAnthropicClient("string")).toBe(false);
  });

  it("returns false when messages is missing", () => {
    expect(isAnthropicClient({})).toBe(false);
  });

  it("returns false when messages.create is not a function", () => {
    expect(isAnthropicClient({ messages: {} })).toBe(false);
    expect(isAnthropicClient({ messages: { create: "nope" } })).toBe(false);
  });
});

describe("wrapAnthropic", () => {
  it("records an event on success with token counts and computed cost", async () => {
    const meter = new Meter();
    const fake = makeFakeClient();
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    const response = await wrapped.messages.create({ model: "claude-sonnet-4-6" });

    expect(response).toEqual(
      expect.objectContaining({ model: "claude-sonnet-4-6" }),
    );

    await meter.flush();
    const events = await meter.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        inputTokens: 1000,
        outputTokens: 500,
      }),
    );
    // Sonnet pricing: 1000 * 3 + 500 * 15 = 10500 / 1M = 0.0105
    expect(events[0].costUsd).toBeCloseTo(0.0105, 6);
    expect(events[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(events[0].timestamp).toBeGreaterThan(0);
    expect(events[0].requestId.length).toBeGreaterThan(0);
  });

  it("records a zero token event and rethrows on error", async () => {
    const meter = new Meter();
    const apiError = new Error("Anthropic API down");
    const fake = makeFakeClient({ reject: apiError });
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    await expect(
      wrapped.messages.create({ model: "claude-haiku-4-5" }),
    ).rejects.toBe(apiError);

    await meter.flush();
    const events = await meter.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-haiku-4-5",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      }),
    );
  });

  it("captures cache read and creation tokens from response usage", async () => {
    const meter = new Meter();
    const fake = makeFakeClient({
      response: {
        model: "claude-sonnet-4-6",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 500,
        },
      },
    });
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    await wrapped.messages.create({ model: "claude-sonnet-4-6" });
    await meter.flush();

    const event = (await meter.getEvents())[0];
    expect(event.cacheReadInputTokens).toBe(1000);
    expect(event.cacheCreationInputTokens).toBe(500);
    // 100*3 + 50*15 + 1000*0.3 + 500*3.75 = 300 + 750 + 300 + 1875 = 3225 / 1M
    expect(event.costUsd).toBeCloseTo(0.003225, 9);
  });

  it("captures cache tokens during streaming via message_start usage", async () => {
    const meter = new Meter();
    async function* withCache() {
      yield {
        type: "message_start",
        message: {
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: 50,
            cache_read_input_tokens: 200,
            cache_creation_input_tokens: 0,
          },
        },
      };
      yield { type: "content_block_delta", delta: { text: "hi" } };
      yield { type: "message_delta", usage: { output_tokens: 10 } };
      yield { type: "message_stop" };
    }
    const fake = { messages: { create: vi.fn(async () => withCache()) } };
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    const stream = await wrapped.messages.create({
      model: "claude-sonnet-4-6",
      stream: true,
    });
    for await (const _ of stream as AsyncIterable<unknown>) {
      // drain
    }
    await meter.flush();

    const event = (await meter.getEvents())[0];
    expect(event.cacheReadInputTokens).toBe(200);
    expect(event.cacheCreationInputTokens).toBe(0);
  });

  it("falls back to params.model when response.model is missing", async () => {
    const meter = new Meter();
    const fake = makeFakeClient({
      response: { usage: { input_tokens: 10, output_tokens: 5 } },
    });
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    await wrapped.messages.create({ model: "claude-opus-4-7" });

    await meter.flush();
    expect((await meter.getEvents())[0].model).toBe("claude-opus-4-7");
  });

  it("falls back to 'unknown' when error path has no model in params", async () => {
    const meter = new Meter();
    const fake = makeFakeClient({ reject: new Error("boom") });
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    await expect(
      // deliberate missing model
      wrapped.messages.create({} as { model: string }),
    ).rejects.toThrow("boom");

    await meter.flush();
    expect((await meter.getEvents())[0].model).toBe("unknown");
  });

  it("treats missing usage as zero tokens", async () => {
    const meter = new Meter();
    const fake = makeFakeClient({
      response: { model: "claude-sonnet-4-6" },
    });
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    await wrapped.messages.create({ model: "claude-sonnet-4-6" });

    await meter.flush();
    const event = (await meter.getEvents())[0];
    expect(event.inputTokens).toBe(0);
    expect(event.outputTokens).toBe(0);
    expect(event.costUsd).toBe(0);
  });

  it("passes streaming calls through without recording", async () => {
    const meter = new Meter();
    const fake = makeFakeClient();
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    await wrapped.messages.create({
      model: "claude-sonnet-4-6",
      stream: true,
    });

    await meter.flush();
    expect(await meter.getEvents()).toHaveLength(0);
    expect(fake.create).toHaveBeenCalledTimes(1);
  });

  it("preserves other top level client properties", () => {
    const meter = new Meter();
    const fake = makeFakeClient();
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    expect((wrapped as unknown as { baseURL: string }).baseURL).toBe(
      "https://api.anthropic.com",
    );
  });

  it("preserves other methods on the messages namespace", async () => {
    const meter = new Meter();
    const fake = makeFakeClient();
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    const messages = wrapped.messages as unknown as {
      countTokens: () => Promise<{ input_tokens: number }>;
    };
    const result = await messages.countTokens();
    expect(result).toEqual({ input_tokens: 42 });
    await meter.flush();
    expect(await meter.getEvents()).toHaveLength(0);
  });
});

describe("wrapAnthropic streaming", () => {
  async function* fakeStream() {
    yield {
      type: "message_start",
      message: {
        model: "claude-sonnet-4-6",
        usage: { input_tokens: 100, output_tokens: 0 },
      },
    };
    yield { type: "content_block_delta", delta: { text: "hi" } };
    yield { type: "message_delta", usage: { output_tokens: 25 } };
    yield { type: "message_stop" };
  }

  it("records an event after the stream completes", async () => {
    const meter = new Meter();
    const fake = {
      messages: {
        create: vi.fn(async () => fakeStream()),
      },
    };
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    const stream = await wrapped.messages.create({
      model: "claude-sonnet-4-6",
      stream: true,
    });

    const chunks: unknown[] = [];
    for await (const chunk of stream as AsyncIterable<unknown>) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(4);
    await meter.flush();
    const events = await meter.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        inputTokens: 100,
        outputTokens: 25,
      }),
    );
  });

  it("records zero token event when the stream throws midway", async () => {
    const meter = new Meter();
    async function* throwingStream() {
      yield { type: "message_start", message: { model: "claude-sonnet-4-6" } };
      throw new Error("network died");
    }
    const fake = {
      messages: {
        create: vi.fn(async () => throwingStream()),
      },
    };
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    const stream = await wrapped.messages.create({
      model: "claude-sonnet-4-6",
      stream: true,
    });

    await expect(async () => {
      for await (const _ of stream as AsyncIterable<unknown>) {
        // consume
      }
    }).rejects.toThrow("network died");

    await meter.flush();
    const events = await meter.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].inputTokens).toBe(0);
    expect(events[0].outputTokens).toBe(0);
  });

  it("captures ttftMs on the first content_block_delta chunk", async () => {
    const meter = new Meter();
    async function* fakeStreamWithContent() {
      yield {
        type: "message_start",
        message: {
          model: "claude-sonnet-4-6",
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      };
      yield { type: "content_block_start" };
      yield { type: "content_block_delta", delta: { text: "hi" } };
      yield { type: "content_block_delta", delta: { text: " there" } };
      yield { type: "message_delta", usage: { output_tokens: 5 } };
      yield { type: "message_stop" };
    }
    const fake = {
      messages: { create: vi.fn(async () => fakeStreamWithContent()) },
    };
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    const stream = await wrapped.messages.create({
      model: "claude-sonnet-4-6",
      stream: true,
    });
    for await (const _ of stream as AsyncIterable<unknown>) {
      // drain
    }

    await meter.flush();
    const event = (await meter.getEvents())[0];
    expect(event.ttftMs).toBeGreaterThanOrEqual(0);
    expect(event.ttftMs).toBeLessThanOrEqual(event.latencyMs);
  });

  it("leaves ttftMs undefined when no content chunks arrive", async () => {
    const meter = new Meter();
    async function* metadataOnly() {
      yield { type: "message_start", message: { model: "claude-haiku-4-5" } };
      yield { type: "message_stop" };
    }
    const fake = {
      messages: { create: vi.fn(async () => metadataOnly()) },
    };
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    const stream = await wrapped.messages.create({
      model: "claude-haiku-4-5",
      stream: true,
    });
    for await (const _ of stream as AsyncIterable<unknown>) {
      // drain
    }

    await meter.flush();
    expect((await meter.getEvents())[0].ttftMs).toBeUndefined();
  });

  it("ignores chunks without usage data", async () => {
    const meter = new Meter();
    async function* dataless() {
      yield { type: "ping" };
      yield { type: "message_stop" };
    }
    const fake = {
      messages: {
        create: vi.fn(async () => dataless()),
      },
    };
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    const stream = await wrapped.messages.create({
      model: "claude-haiku-4-5",
      stream: true,
    });
    for await (const _ of stream as AsyncIterable<unknown>) {
      // consume
    }

    await meter.flush();
    const event = (await meter.getEvents())[0];
    expect(event.model).toBe("claude-haiku-4-5");
    expect(event.inputTokens).toBe(0);
    expect(event.outputTokens).toBe(0);
  });
});

describe("Meter.wrap", () => {
  it("dispatches to wrapAnthropic for Anthropic-shaped clients", async () => {
    const meter = new Meter();
    const fake = makeFakeClient();
    const wrapped = meter.wrap(fake as unknown as AnthropicLike);

    await wrapped.messages.create({ model: "claude-sonnet-4-6" });
    await meter.flush();
    expect(await meter.getEvents()).toHaveLength(1);
  });

  it("throws for unknown clients with a clear message", () => {
    const meter = new Meter();
    expect(() => meter.wrap({ foo: "bar" })).toThrow(/Unsupported client/);
  });
});

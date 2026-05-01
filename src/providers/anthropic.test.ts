import { describe, expect, it, vi } from "vitest";
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

    const events = meter.getEvents();
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
    expect(events[0].requestId).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });

  it("records a zero token event and rethrows on error", async () => {
    const meter = new Meter();
    const apiError = new Error("Anthropic API down");
    const fake = makeFakeClient({ reject: apiError });
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    await expect(
      wrapped.messages.create({ model: "claude-haiku-4-5" }),
    ).rejects.toBe(apiError);

    const events = meter.getEvents();
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

  it("falls back to params.model when response.model is missing", async () => {
    const meter = new Meter();
    const fake = makeFakeClient({
      response: { usage: { input_tokens: 10, output_tokens: 5 } },
    });
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    await wrapped.messages.create({ model: "claude-opus-4-7" });

    expect(meter.getEvents()[0].model).toBe("claude-opus-4-7");
  });

  it("falls back to 'unknown' when error path has no model in params", async () => {
    const meter = new Meter();
    const fake = makeFakeClient({ reject: new Error("boom") });
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    await expect(
      // deliberate missing model
      wrapped.messages.create({} as { model: string }),
    ).rejects.toThrow("boom");

    expect(meter.getEvents()[0].model).toBe("unknown");
  });

  it("treats missing usage as zero tokens", async () => {
    const meter = new Meter();
    const fake = makeFakeClient({
      response: { model: "claude-sonnet-4-6" },
    });
    const wrapped = wrapAnthropic(fake as unknown as AnthropicLike, meter);

    await wrapped.messages.create({ model: "claude-sonnet-4-6" });

    const event = meter.getEvents()[0];
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

    expect(meter.getEvents()).toHaveLength(0);
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
    expect(meter.getEvents()).toHaveLength(0);
  });
});

describe("Meter.wrap", () => {
  it("dispatches to wrapAnthropic for Anthropic-shaped clients", async () => {
    const meter = new Meter();
    const fake = makeFakeClient();
    const wrapped = meter.wrap(fake as unknown as AnthropicLike);

    await wrapped.messages.create({ model: "claude-sonnet-4-6" });
    expect(meter.getEvents()).toHaveLength(1);
  });

  it("throws for unknown clients with a clear message", () => {
    const meter = new Meter();
    expect(() => meter.wrap({ foo: "bar" })).toThrow(/Unsupported client/);
  });
});

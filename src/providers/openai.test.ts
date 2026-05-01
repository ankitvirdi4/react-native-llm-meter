import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});
import { Meter } from "../meter.js";
import {
  isOpenAIClient,
  wrapOpenAI,
  type OpenAILike,
} from "./openai.js";

function makeFakeClient(
  overrides: Partial<{ response: unknown; reject: unknown }> = {},
) {
  const create = vi.fn(async () => {
    if ("reject" in overrides) throw overrides.reject;
    return (
      overrides.response ?? {
        id: "chatcmpl-test",
        model: "gpt-4o-2024-08-06",
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
        choices: [{ message: { role: "assistant", content: "hi" } }],
      }
    );
  });
  return {
    apiKey: "sk-test",
    chat: { completions: { create } },
    create,
  };
}

describe("isOpenAIClient", () => {
  it("returns true for shape with chat.completions.create", () => {
    expect(
      isOpenAIClient({ chat: { completions: { create: () => {} } } }),
    ).toBe(true);
  });

  it("returns false for primitives, missing chat, or non-function create", () => {
    expect(isOpenAIClient(null)).toBe(false);
    expect(isOpenAIClient({})).toBe(false);
    expect(isOpenAIClient({ chat: {} })).toBe(false);
    expect(isOpenAIClient({ chat: { completions: {} } })).toBe(false);
    expect(isOpenAIClient({ chat: { completions: { create: 42 } } })).toBe(false);
  });
});

describe("wrapOpenAI", () => {
  it("records an event on success with token counts and computed cost", async () => {
    const meter = new Meter();
    const fake = makeFakeClient();
    const wrapped = wrapOpenAI(fake as unknown as OpenAILike, meter);

    const response = await wrapped.chat.completions.create({ model: "gpt-4o" });
    expect((response as { id: string }).id).toBe("chatcmpl-test");

    await meter.flush();
    const events = await meter.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-4o-2024-08-06",
        inputTokens: 1000,
        outputTokens: 500,
      }),
    );
    // gpt-4o-2024-08-06 is not in pricing table, expect 0
    // Use the params model for pricing lookup? No, we use response.model.
    // So cost = 0 here since the dated variant is not in our table.
    expect(events[0].costUsd).toBe(0);
  });

  it("falls back to params.model when response.model is missing", async () => {
    const meter = new Meter();
    const fake = makeFakeClient({
      response: { usage: { prompt_tokens: 10, completion_tokens: 5 } },
    });
    const wrapped = wrapOpenAI(fake as unknown as OpenAILike, meter);

    await wrapped.chat.completions.create({ model: "gpt-4o-mini" });
    await meter.flush();

    const event = (await meter.getEvents())[0];
    expect(event.model).toBe("gpt-4o-mini");
    // gpt-4o-mini priced at 0.15/0.60 per 1M
    expect(event.costUsd).toBeCloseTo((10 * 0.15 + 5 * 0.6) / 1_000_000, 9);
  });

  it("records zero token event and rethrows on error", async () => {
    const meter = new Meter();
    const apiError = new Error("OpenAI 500");
    const fake = makeFakeClient({ reject: apiError });
    const wrapped = wrapOpenAI(fake as unknown as OpenAILike, meter);

    await expect(
      wrapped.chat.completions.create({ model: "gpt-4o" }),
    ).rejects.toBe(apiError);

    await meter.flush();
    const event = (await meter.getEvents())[0];
    expect(event.inputTokens).toBe(0);
    expect(event.outputTokens).toBe(0);
    expect(event.costUsd).toBe(0);
  });

  it("falls back to 'unknown' on error path with no params.model", async () => {
    const meter = new Meter();
    const fake = makeFakeClient({ reject: new Error("boom") });
    const wrapped = wrapOpenAI(fake as unknown as OpenAILike, meter);

    await expect(
      wrapped.chat.completions.create({} as { model: string }),
    ).rejects.toThrow("boom");

    await meter.flush();
    expect((await meter.getEvents())[0].model).toBe("unknown");
  });

  it("treats missing usage as zero tokens", async () => {
    const meter = new Meter();
    const fake = makeFakeClient({ response: { model: "gpt-4o" } });
    const wrapped = wrapOpenAI(fake as unknown as OpenAILike, meter);

    await wrapped.chat.completions.create({ model: "gpt-4o" });
    await meter.flush();

    const event = (await meter.getEvents())[0];
    expect(event.inputTokens).toBe(0);
    expect(event.outputTokens).toBe(0);
  });

  it("preserves apiKey and other top level props", () => {
    const meter = new Meter();
    const fake = makeFakeClient();
    const wrapped = wrapOpenAI(fake as unknown as OpenAILike, meter);

    expect((wrapped as unknown as { apiKey: string }).apiKey).toBe("sk-test");
  });
});

describe("wrapOpenAI streaming", () => {
  async function* fakeStream() {
    yield { model: "gpt-4o-2024-08-06", choices: [{ delta: { content: "hi" } }] };
    yield { choices: [{ delta: { content: " there" } }] };
    yield { usage: { prompt_tokens: 200, completion_tokens: 50 } };
  }

  it("records event after streaming completes with usage from final chunk", async () => {
    const meter = new Meter();
    const fake = {
      chat: {
        completions: { create: vi.fn(async () => fakeStream()) },
      },
    };
    const wrapped = wrapOpenAI(fake as unknown as OpenAILike, meter);

    const stream = await wrapped.chat.completions.create({
      model: "gpt-4o",
      stream: true,
    });

    const chunks: unknown[] = [];
    for await (const chunk of stream as AsyncIterable<unknown>) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(3);

    await meter.flush();
    const event = (await meter.getEvents())[0];
    expect(event.provider).toBe("openai");
    expect(event.model).toBe("gpt-4o-2024-08-06");
    expect(event.inputTokens).toBe(200);
    expect(event.outputTokens).toBe(50);
  });

  it("captures ttftMs on the first delta with non empty content", async () => {
    const meter = new Meter();
    async function* withRoleFirst() {
      yield { choices: [{ delta: { role: "assistant" } }] }; // metadata only
      yield { choices: [{ delta: { content: "" } }] }; // empty content, no TTFT yet
      yield {
        model: "gpt-4o-2024-08-06",
        choices: [{ delta: { content: "hi" } }], // first real content
      };
      yield { choices: [{ delta: { content: " there" } }] };
      yield { usage: { prompt_tokens: 100, completion_tokens: 30 } };
    }
    const fake = {
      chat: { completions: { create: vi.fn(async () => withRoleFirst()) } },
    };
    const wrapped = wrapOpenAI(fake as unknown as OpenAILike, meter);

    const stream = await wrapped.chat.completions.create({
      model: "gpt-4o",
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

  it("leaves ttftMs undefined when stream has no content chunks", async () => {
    const meter = new Meter();
    async function* metadataOnly() {
      yield { choices: [{ delta: { role: "assistant" } }] };
      yield { usage: { prompt_tokens: 5, completion_tokens: 0 } };
    }
    const fake = {
      chat: { completions: { create: vi.fn(async () => metadataOnly()) } },
    };
    const wrapped = wrapOpenAI(fake as unknown as OpenAILike, meter);

    const stream = await wrapped.chat.completions.create({
      model: "gpt-4o",
      stream: true,
    });
    for await (const _ of stream as AsyncIterable<unknown>) {
      // drain
    }

    await meter.flush();
    expect((await meter.getEvents())[0].ttftMs).toBeUndefined();
  });

  it("records zeros when stream throws", async () => {
    const meter = new Meter();
    async function* throwing() {
      yield { model: "gpt-4o" };
      throw new Error("disconnected");
    }
    const fake = {
      chat: {
        completions: { create: vi.fn(async () => throwing()) },
      },
    };
    const wrapped = wrapOpenAI(fake as unknown as OpenAILike, meter);

    const stream = await wrapped.chat.completions.create({
      model: "gpt-4o",
      stream: true,
    });

    await expect(async () => {
      for await (const _ of stream as AsyncIterable<unknown>) {
        // drain
      }
    }).rejects.toThrow("disconnected");

    await meter.flush();
    const event = (await meter.getEvents())[0];
    expect(event.inputTokens).toBe(0);
    expect(event.outputTokens).toBe(0);
  });

  it("records zero tokens if no usage chunk arrives (include_usage not set)", async () => {
    const meter = new Meter();
    async function* noUsage() {
      yield { model: "gpt-4o" };
      yield { choices: [{ delta: { content: "hi" } }] };
    }
    const fake = {
      chat: {
        completions: { create: vi.fn(async () => noUsage()) },
      },
    };
    const wrapped = wrapOpenAI(fake as unknown as OpenAILike, meter);

    const stream = await wrapped.chat.completions.create({
      model: "gpt-4o",
      stream: true,
    });
    for await (const _ of stream as AsyncIterable<unknown>) {
      // drain
    }

    await meter.flush();
    const event = (await meter.getEvents())[0];
    expect(event.inputTokens).toBe(0);
    expect(event.outputTokens).toBe(0);
  });
});

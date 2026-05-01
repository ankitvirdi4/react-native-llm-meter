import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});
import { Meter } from "../meter.js";
import {
  isGoogleClient,
  wrapGoogle,
  type GoogleLike,
} from "./google.js";

function makeFakeClient(
  overrides: Partial<{
    response: unknown;
    reject: unknown;
    streamFn?: () => AsyncIterable<unknown>;
    omitStreamMethod?: boolean;
  }> = {},
) {
  const generateContent = vi.fn(async () => {
    if ("reject" in overrides) throw overrides.reject;
    return (
      overrides.response ?? {
        modelVersion: "gemini-2.0-flash",
        usageMetadata: {
          promptTokenCount: 1000,
          candidatesTokenCount: 200,
        },
        candidates: [{ content: { parts: [{ text: "hi" }] } }],
      }
    );
  });
  const generateContentStream = overrides.omitStreamMethod
    ? undefined
    : vi.fn(async () => (overrides.streamFn ?? defaultStream)());
  const models: Record<string, unknown> = { generateContent };
  if (generateContentStream) models.generateContentStream = generateContentStream;
  return { project: "demo", models };
}

async function* defaultStream() {
  yield {
    modelVersion: "gemini-2.0-flash",
    candidates: [{ content: { parts: [{ text: "hi" }] } }],
  };
  yield {
    usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 100 },
  };
}

describe("isGoogleClient", () => {
  it("returns true for shape with models.generateContent", () => {
    expect(isGoogleClient({ models: { generateContent: () => {} } })).toBe(true);
  });

  it("returns false for primitives, missing models, or non-function generateContent", () => {
    expect(isGoogleClient(null)).toBe(false);
    expect(isGoogleClient({})).toBe(false);
    expect(isGoogleClient({ models: null })).toBe(false);
    expect(isGoogleClient({ models: {} })).toBe(false);
    expect(isGoogleClient({ models: { generateContent: "no" } })).toBe(false);
  });
});

describe("wrapGoogle", () => {
  it("records an event on success with token counts and computed cost", async () => {
    const meter = new Meter();
    const fake = makeFakeClient();
    const wrapped = wrapGoogle(fake as unknown as GoogleLike, meter);

    const response = await wrapped.models.generateContent({
      model: "gemini-2.0-flash",
    });
    expect((response as { modelVersion: string }).modelVersion).toBe(
      "gemini-2.0-flash",
    );

    await meter.flush();
    const event = (await meter.getEvents())[0];
    expect(event.provider).toBe("google");
    expect(event.model).toBe("gemini-2.0-flash");
    expect(event.inputTokens).toBe(1000);
    expect(event.outputTokens).toBe(200);
    // gemini-2.0-flash priced at 0.10/0.40 per 1M
    expect(event.costUsd).toBeCloseTo((1000 * 0.1 + 200 * 0.4) / 1_000_000, 9);
  });

  it("falls back to params.model when response.modelVersion is missing", async () => {
    const meter = new Meter();
    const fake = makeFakeClient({
      response: {
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
      },
    });
    const wrapped = wrapGoogle(fake as unknown as GoogleLike, meter);

    await wrapped.models.generateContent({ model: "gemini-1.5-pro" });
    await meter.flush();
    expect((await meter.getEvents())[0].model).toBe("gemini-1.5-pro");
  });

  it("records zero token event and rethrows on error", async () => {
    const meter = new Meter();
    const apiError = new Error("Google quota");
    const fake = makeFakeClient({ reject: apiError });
    const wrapped = wrapGoogle(fake as unknown as GoogleLike, meter);

    await expect(
      wrapped.models.generateContent({ model: "gemini-2.0-flash" }),
    ).rejects.toBe(apiError);

    await meter.flush();
    const event = (await meter.getEvents())[0];
    expect(event.inputTokens).toBe(0);
    expect(event.outputTokens).toBe(0);
  });

  it("falls back to 'unknown' on error path with no params.model", async () => {
    const meter = new Meter();
    const fake = makeFakeClient({ reject: new Error("boom") });
    const wrapped = wrapGoogle(fake as unknown as GoogleLike, meter);

    await expect(
      wrapped.models.generateContent({} as { model: string }),
    ).rejects.toThrow("boom");

    await meter.flush();
    expect((await meter.getEvents())[0].model).toBe("unknown");
  });

  it("treats missing usageMetadata as zero tokens", async () => {
    const meter = new Meter();
    const fake = makeFakeClient({
      response: { modelVersion: "gemini-2.0-flash" },
    });
    const wrapped = wrapGoogle(fake as unknown as GoogleLike, meter);

    await wrapped.models.generateContent({ model: "gemini-2.0-flash" });
    await meter.flush();

    const event = (await meter.getEvents())[0];
    expect(event.inputTokens).toBe(0);
    expect(event.outputTokens).toBe(0);
  });

  it("preserves project and other top level props", () => {
    const meter = new Meter();
    const fake = makeFakeClient();
    const wrapped = wrapGoogle(fake as unknown as GoogleLike, meter);

    expect((wrapped as unknown as { project: string }).project).toBe("demo");
  });
});

describe("wrapGoogle streaming", () => {
  it("records event after streaming completes", async () => {
    const meter = new Meter();
    const fake = makeFakeClient();
    const wrapped = wrapGoogle(fake as unknown as GoogleLike, meter);

    const stream = await wrapped.models.generateContentStream!({
      model: "gemini-2.0-flash",
    });
    const chunks: unknown[] = [];
    for await (const chunk of stream as AsyncIterable<unknown>) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(2);

    await meter.flush();
    const event = (await meter.getEvents())[0];
    expect(event.provider).toBe("google");
    expect(event.model).toBe("gemini-2.0-flash");
    expect(event.inputTokens).toBe(50);
    expect(event.outputTokens).toBe(100);
  });

  it("captures ttftMs on the first chunk with non empty text", async () => {
    const meter = new Meter();
    async function* withMetadataFirst() {
      yield { modelVersion: "gemini-2.0-flash" }; // no content
      yield {
        candidates: [{ content: { parts: [{ text: "" }] } }],
      }; // empty text, no TTFT yet
      yield {
        candidates: [{ content: { parts: [{ text: "hi" }] } }],
      }; // first real text
      yield {
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10 },
      };
    }
    const fake = makeFakeClient({ streamFn: withMetadataFirst });
    const wrapped = wrapGoogle(fake as unknown as GoogleLike, meter);

    const stream = await wrapped.models.generateContentStream!({
      model: "gemini-2.0-flash",
    });
    for await (const _ of stream as AsyncIterable<unknown>) {
      // drain
    }

    await meter.flush();
    const event = (await meter.getEvents())[0];
    expect(event.ttftMs).toBeGreaterThanOrEqual(0);
    expect(event.ttftMs).toBeLessThanOrEqual(event.latencyMs);
  });

  it("leaves ttftMs undefined when stream has no text chunks", async () => {
    const meter = new Meter();
    async function* usageOnly() {
      yield { modelVersion: "gemini-2.0-flash" };
      yield {
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0 },
      };
    }
    const fake = makeFakeClient({ streamFn: usageOnly });
    const wrapped = wrapGoogle(fake as unknown as GoogleLike, meter);

    const stream = await wrapped.models.generateContentStream!({
      model: "gemini-2.0-flash",
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
      yield { modelVersion: "gemini-2.0-flash" };
      throw new Error("network error");
    }
    const fake = makeFakeClient({ streamFn: throwing });
    const wrapped = wrapGoogle(fake as unknown as GoogleLike, meter);

    const stream = await wrapped.models.generateContentStream!({
      model: "gemini-2.0-flash",
    });
    await expect(async () => {
      for await (const _ of stream as AsyncIterable<unknown>) {
        // drain
      }
    }).rejects.toThrow("network error");

    await meter.flush();
    const event = (await meter.getEvents())[0];
    expect(event.inputTokens).toBe(0);
    expect(event.outputTokens).toBe(0);
  });

  it("throws when generateContentStream is unavailable on the client", async () => {
    const meter = new Meter();
    const fake = makeFakeClient({ omitStreamMethod: true });
    const wrapped = wrapGoogle(fake as unknown as GoogleLike, meter);

    // Only the metered wrapper exists; original client did not have the method,
    // so calling our wrapped path should error clearly.
    await expect(
      (wrapped.models as { generateContentStream: (p: unknown) => Promise<unknown> })
        .generateContentStream({ model: "gemini-2.0-flash" }),
    ).rejects.toThrow(/generateContentStream not available/);
  });
});

describe("isGoogleLegacyClient", () => {
  it("returns true for clients with getGenerativeModel", async () => {
    const { isGoogleLegacyClient } = await import("./google.js");
    expect(isGoogleLegacyClient({ getGenerativeModel: () => ({}) })).toBe(true);
  });
  it("returns false otherwise", async () => {
    const { isGoogleLegacyClient } = await import("./google.js");
    expect(isGoogleLegacyClient(null)).toBe(false);
    expect(isGoogleLegacyClient({})).toBe(false);
    expect(isGoogleLegacyClient({ getGenerativeModel: 42 })).toBe(false);
  });
});

describe("wrapGoogleLegacy", () => {
  it("records a non streaming generateContent call", async () => {
    const { wrapGoogleLegacy } = await import("./google.js");
    const meter = new Meter();
    const generateContent = vi.fn(async () => ({
      response: {
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
        },
      },
    }));
    const fakeClient = {
      getGenerativeModel: vi.fn((_p: { model: string }) => ({
        generateContent,
      })),
    };
    const wrapped = wrapGoogleLegacy(fakeClient as never, meter);
    const model = wrapped.getGenerativeModel({ model: "gemini-2.0-flash" });
    await model.generateContent("hello");
    await meter.flush();

    const event = (await meter.getEvents())[0];
    expect(event.provider).toBe("google");
    expect(event.model).toBe("gemini-2.0-flash");
    expect(event.inputTokens).toBe(100);
    expect(event.outputTokens).toBe(50);
  });

  it("records error path with zero tokens", async () => {
    const { wrapGoogleLegacy } = await import("./google.js");
    const meter = new Meter();
    const generateContent = vi.fn(async () => {
      throw new Error("legacy boom");
    });
    const fakeClient = {
      getGenerativeModel: vi.fn(() => ({ generateContent })),
    };
    const wrapped = wrapGoogleLegacy(fakeClient as never, meter);
    const model = wrapped.getGenerativeModel({ model: "gemini-1.5-flash" });
    await expect(model.generateContent("hi")).rejects.toThrow("legacy boom");
    await meter.flush();

    const event = (await meter.getEvents())[0];
    expect(event.inputTokens).toBe(0);
    expect(event.outputTokens).toBe(0);
  });

  it("records streaming via generateContentStream with TTFT", async () => {
    const { wrapGoogleLegacy } = await import("./google.js");
    const meter = new Meter();
    async function* chunks() {
      yield { candidates: [{ content: { parts: [{ text: "hi" }] } }] };
      yield {
        usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 10 },
      };
    }
    const generateContentStream = vi.fn(async () => ({
      stream: chunks(),
      response: Promise.resolve({}),
    }));
    const fakeClient = {
      getGenerativeModel: vi.fn(() => ({
        generateContent: vi.fn(),
        generateContentStream,
      })),
    };
    const wrapped = wrapGoogleLegacy(fakeClient as never, meter);
    const model = wrapped.getGenerativeModel({ model: "gemini-1.5-pro" });
    const result = await model.generateContentStream!("hi");
    for await (const _ of result.stream) {
      // drain
    }
    await meter.flush();

    const event = (await meter.getEvents())[0];
    expect(event.model).toBe("gemini-1.5-pro");
    expect(event.inputTokens).toBe(30);
    expect(event.outputTokens).toBe(10);
    expect(event.ttftMs).toBeGreaterThanOrEqual(0);
  });
});

describe("wrapGoogleLegacy stream error path", () => {
  it("records zero token event when the legacy stream throws", async () => {
    const { wrapGoogleLegacy } = await import("./google.js");
    const meter = new Meter();
    async function* throwing() {
      yield { candidates: [{ content: { parts: [{ text: "hi" }] } }] };
      throw new Error("legacy stream broke");
    }
    const generateContentStream = vi.fn(async () => ({
      stream: throwing(),
      response: Promise.resolve({}),
    }));
    const fakeClient = {
      getGenerativeModel: vi.fn(() => ({
        generateContent: vi.fn(),
        generateContentStream,
      })),
    };
    const wrapped = wrapGoogleLegacy(fakeClient as never, meter);
    const model = wrapped.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContentStream!("hi");

    await expect(async () => {
      for await (const _ of result.stream) {
        // drain
      }
    }).rejects.toThrow("legacy stream broke");

    await meter.flush();
    const event = (await meter.getEvents())[0];
    expect(event.inputTokens).toBe(0);
    expect(event.outputTokens).toBe(0);
  });

  it("returns a model without generateContentStream when the source omits it", async () => {
    const { wrapGoogleLegacy } = await import("./google.js");
    const meter = new Meter();
    const fakeClient = {
      getGenerativeModel: vi.fn(() => ({
        generateContent: vi.fn(async () => ({ response: {} })),
      })),
    };
    const wrapped = wrapGoogleLegacy(fakeClient as never, meter);
    const model = wrapped.getGenerativeModel({ model: "gemini-1.5-flash" });
    expect(model.generateContentStream).toBeUndefined();
  });

  it("preserves other model methods through the proxy", async () => {
    const { wrapGoogleLegacy } = await import("./google.js");
    const meter = new Meter();
    const countTokens = vi.fn(async () => ({ totalTokens: 7 }));
    const fakeClient = {
      getGenerativeModel: vi.fn(() => ({
        generateContent: vi.fn(),
        countTokens,
      })),
    };
    const wrapped = wrapGoogleLegacy(fakeClient as never, meter);
    const model = wrapped.getGenerativeModel({ model: "gemini-1.5-flash" });
    expect(
      await (model as unknown as { countTokens: () => Promise<{ totalTokens: number }> }).countTokens(),
    ).toEqual({ totalTokens: 7 });
  });
});

describe("Meter.wrap dispatching", () => {
  it("dispatches to wrapGoogle for Google-shaped clients", async () => {
    const meter = new Meter();
    const fake = makeFakeClient();
    const wrapped = meter.wrap(fake as unknown as GoogleLike);

    await wrapped.models.generateContent({ model: "gemini-2.0-flash" });
    await meter.flush();
    expect(await meter.getEvents()).toHaveLength(1);
  });
});

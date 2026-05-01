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

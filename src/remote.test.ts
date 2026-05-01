import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Meter } from "./meter.js";
import {
  attachRemoteSink,
  HttpRemoteSink,
  NoopRemoteSink,
  type RemoteSink,
} from "./remote.js";
import type { MeterEvent } from "./types.js";

function recordSomething(meter: Meter): void {
  meter.record({
    provider: "anthropic",
    model: "claude-haiku-4-5",
    inputTokens: 1,
    outputTokens: 1,
    latencyMs: 1,
  });
}

describe("NoopRemoteSink", () => {
  it("send resolves without effect", async () => {
    const sink = new NoopRemoteSink();
    await expect(sink.send([])).resolves.toBeUndefined();
  });
});

describe("HttpRemoteSink", () => {
  it("posts events as JSON to the configured URL", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true } as Response));
    const sink = new HttpRemoteSink({
      url: "https://example.test/api",
      fetch: fetchMock,
      headers: { "X-Auth": "secret" },
    });

    const event: MeterEvent = {
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      costUsd: 0,
      timestamp: 1000,
      requestId: "r1",
    };

    await sink.send([event]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/api");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Auth"]).toBe("secret");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      events: [event],
    });
  });

  it("throws on non-ok HTTP responses", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: false, status: 503 } as Response),
    );
    const sink = new HttpRemoteSink({
      url: "https://example.test/api",
      fetch: fetchMock,
    });

    await expect(sink.send([])).rejects.toThrow(/HTTP 503/);
  });

  it("aborts the request when timeoutMs elapses", async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    ) as unknown as typeof fetch;

    const sink = new HttpRemoteSink({
      url: "https://example.test/api",
      fetch: fetchMock,
      timeoutMs: 50,
    });

    await expect(sink.send([])).rejects.toThrow();
  });

  it("throws if no fetch implementation is available", () => {
    const original = globalThis.fetch;
    // @ts-expect-error temporarily clear global fetch
    globalThis.fetch = undefined;
    try {
      expect(() => new HttpRemoteSink({ url: "x" })).toThrow(/fetch/);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("attachRemoteSink", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeRecordingSink() {
    const sent: MeterEvent[][] = [];
    const sink: RemoteSink = {
      async send(events) {
        sent.push(events);
      },
    };
    return { sink, sent };
  }

  it("flushes when buffer reaches batchSize", async () => {
    const { sink, sent } = makeRecordingSink();
    const meter = new Meter();
    const detach = attachRemoteSink(meter, { sink, batchSize: 3 });

    for (let i = 0; i < 3; i++) recordSomething(meter);
    await meter.flush();
    await vi.runAllTimersAsync();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(3);

    detach();
  });

  it("flushes after batchIntervalMs when buffer is below batchSize", async () => {
    const { sink, sent } = makeRecordingSink();
    const meter = new Meter();
    const detach = attachRemoteSink(meter, {
      sink,
      batchSize: 100,
      batchIntervalMs: 5000,
    });

    recordSomething(meter);
    recordSomething(meter);
    await meter.flush();

    expect(sent).toEqual([]);

    await vi.advanceTimersByTimeAsync(5000);
    await Promise.resolve();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(2);

    detach();
  });

  it("retries with backoff and gives up after maxRetries, calls onError", async () => {
    const sendMock = vi.fn(async () => {
      throw new Error("fail");
    });
    const sink: RemoteSink = { send: sendMock };
    const errors: { err: unknown; events: MeterEvent[] }[] = [];
    const meter = new Meter();
    const detach = attachRemoteSink(meter, {
      sink,
      batchSize: 1,
      maxRetries: 2,
      backoffBaseMs: 10,
      onError: (err, events) => errors.push({ err, events }),
    });

    recordSomething(meter);
    await meter.flush();

    // Drain the retry chain (backoff timers + microtasks)
    await vi.runAllTimersAsync();

    // 1 initial + 2 retries = 3 calls total
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(errors).toHaveLength(1);
    expect((errors[0].err as Error).message).toBe("fail");

    detach();
  });

  it("does not throw into user code when sink fails and no onError given", async () => {
    const sink: RemoteSink = {
      async send() {
        throw new Error("oops");
      },
    };
    const meter = new Meter();
    const detach = attachRemoteSink(meter, {
      sink,
      batchSize: 1,
      maxRetries: 0,
    });

    recordSomething(meter);
    await meter.flush();
    await vi.runAllTimersAsync();
    // No assertion needed; the test passes if nothing throws.

    detach();
  });

  it("detach stops further sends", async () => {
    const { sink, sent } = makeRecordingSink();
    const meter = new Meter();
    const detach = attachRemoteSink(meter, {
      sink,
      batchSize: 1,
    });

    detach();
    recordSomething(meter);
    await meter.flush();
    await vi.runAllTimersAsync();

    expect(sent).toEqual([]);
  });

  it("swallows onError handler errors", async () => {
    const sink: RemoteSink = {
      async send() {
        throw new Error("primary");
      },
    };
    const meter = new Meter();
    const detach = attachRemoteSink(meter, {
      sink,
      batchSize: 1,
      maxRetries: 0,
      onError: () => {
        throw new Error("handler boom");
      },
    });

    recordSomething(meter);
    await meter.flush();
    await vi.runAllTimersAsync();
    // No throw escapes.

    detach();
  });
});

describe("Meter.attachRemoteSink", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delegates to attachRemoteSink and sends batched events", async () => {
    const sent: MeterEvent[][] = [];
    const meter = new Meter();
    const detach = meter.attachRemoteSink({
      sink: { async send(events) { sent.push(events); } },
      batchSize: 1,
    });

    recordSomething(meter);
    await meter.flush();
    await vi.runAllTimersAsync();

    expect(sent).toHaveLength(1);
    detach();
  });
});

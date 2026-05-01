import type { Meter } from "./meter.js";
import type { MeterEvent } from "./types.js";

export interface RemoteSink {
  send(events: MeterEvent[]): Promise<void>;
}

export class NoopRemoteSink implements RemoteSink {
  async send(): Promise<void> {
    // intentionally does nothing
  }
}

export interface HttpRemoteSinkOptions {
  url: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

export class HttpRemoteSink implements RemoteSink {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly fetchFn: typeof fetch;

  constructor(opts: HttpRemoteSinkOptions) {
    this.url = opts.url;
    this.headers = opts.headers ?? {};
    const f = opts.fetch ?? globalThis.fetch;
    if (!f) {
      throw new Error("HttpRemoteSink requires a fetch implementation");
    }
    this.fetchFn = f;
  }

  async send(events: MeterEvent[]): Promise<void> {
    const response = await this.fetchFn(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers },
      body: JSON.stringify({ events }),
    });
    if (!response.ok) {
      throw new Error(
        `HttpRemoteSink: HTTP ${response.status} from ${this.url}`,
      );
    }
  }
}

export interface AttachRemoteSinkOptions {
  sink: RemoteSink;
  batchSize?: number;
  batchIntervalMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  onError?: (err: unknown, events: MeterEvent[]) => void;
}

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_BATCH_INTERVAL_MS = 5000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_BASE_MS = 500;

export function attachRemoteSink(
  meter: Meter,
  opts: AttachRemoteSinkOptions,
): () => void {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const batchIntervalMs = opts.batchIntervalMs ?? DEFAULT_BATCH_INTERVAL_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const backoffBaseMs = opts.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;

  let buffer: MeterEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let detached = false;

  const sendWithRetry = async (batch: MeterEvent[]): Promise<void> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (detached) return;
      try {
        await opts.sink.send(batch);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt === maxRetries) break;
        const delay = backoffBaseMs * Math.pow(2, attempt);
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
    if (opts.onError) {
      try {
        opts.onError(lastErr, batch);
      } catch {
        // user callback errors swallowed
      }
    }
  };

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    void sendWithRetry(batch);
  };

  const scheduleFlush = (): void => {
    if (timer || detached) return;
    timer = setTimeout(flush, batchIntervalMs);
  };

  const unsubscribe = meter.subscribe((event) => {
    if (detached) return;
    buffer.push(event);
    if (buffer.length >= batchSize) {
      flush();
    } else {
      scheduleFlush();
    }
  });

  return () => {
    detached = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    unsubscribe();
  };
}

import { describe, expect, it } from "vitest";
import { wrapAsyncIterable } from "./_stream.js";

describe("wrapAsyncIterable", () => {
  it("works when the source iterator omits return and throw", async () => {
    const minimal = {
      [Symbol.asyncIterator]() {
        let called = false;
        return {
          async next() {
            if (called) return { done: true, value: undefined } as const;
            called = true;
            return { done: false, value: "x" } as const;
          },
        };
      },
    } as AsyncIterable<string> & object;

    const chunks: string[] = [];
    const events: string[] = [];

    const wrapped = wrapAsyncIterable(minimal, {
      onChunk: (c) => chunks.push(c),
      onComplete: () => events.push("done"),
      onError: () => events.push("err"),
    });

    for await (const chunk of wrapped) {
      // consume
      void chunk;
    }

    expect(chunks).toEqual(["x"]);
    expect(events).toEqual(["done"]);
  });

  it("preserves source iterator return when present so consumers can early break", async () => {
    let returnCalled = false;
    const source = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return { done: false, value: 1 } as const;
          },
          async return(): Promise<IteratorResult<number>> {
            returnCalled = true;
            return { done: true, value: undefined };
          },
        };
      },
    } as AsyncIterable<number> & object;

    const wrapped = wrapAsyncIterable(source, {
      onChunk: () => {},
      onComplete: () => {},
      onError: () => {},
    });

    const iter = wrapped[Symbol.asyncIterator]();
    await iter.next();
    await iter.return?.();
    expect(returnCalled).toBe(true);
  });
});

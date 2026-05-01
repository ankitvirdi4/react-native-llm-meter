export interface StreamHandlers<TChunk> {
  onChunk: (chunk: TChunk) => void;
  onComplete: () => void;
  onError: (err: unknown) => void;
}

export function wrapAsyncIterable<TChunk>(
  source: AsyncIterable<TChunk> & object,
  handlers: StreamHandlers<TChunk>,
): AsyncIterable<TChunk> & object {
  return new Proxy(source, {
    get(target, prop, receiver) {
      if (prop === Symbol.asyncIterator) {
        return () => {
          const inner = (target as AsyncIterable<TChunk>)[Symbol.asyncIterator]();
          return {
            async next(): Promise<IteratorResult<TChunk>> {
              try {
                const result = await inner.next();
                if (!result.done) {
                  handlers.onChunk(result.value);
                } else {
                  handlers.onComplete();
                }
                return result;
              } catch (err) {
                handlers.onError(err);
                throw err;
              }
            },
            return: inner.return ? inner.return.bind(inner) : undefined,
            throw: inner.throw ? inner.throw.bind(inner) : undefined,
          } as AsyncIterator<TChunk>;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

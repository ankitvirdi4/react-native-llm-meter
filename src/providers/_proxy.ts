type Replacements = Record<string | symbol, unknown>;

export function wrapPath<T extends object>(
  client: T,
  path: string[],
  replacements: Replacements,
): T {
  function wrap(target: object, segment: number): object {
    if (segment === path.length) {
      return new Proxy(target, {
        get(t, prop, receiver) {
          if (typeof prop !== "symbol" && prop in replacements) {
            return replacements[prop];
          }
          return Reflect.get(t, prop, receiver);
        },
      });
    }
    const childKey = path[segment];
    const childTarget = (target as Record<string, unknown>)[childKey];
    if (typeof childTarget !== "object" || childTarget === null) {
      throw new Error(
        `wrapPath: expected object at "${path.slice(0, segment + 1).join(".")}", got ${typeof childTarget}`,
      );
    }
    const wrappedChild = wrap(childTarget, segment + 1);
    return new Proxy(target, {
      get(t, prop, receiver) {
        if (prop === childKey) return wrappedChild;
        return Reflect.get(t, prop, receiver);
      },
    });
  }
  return wrap(client, 0) as T;
}

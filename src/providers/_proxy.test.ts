import { describe, expect, it } from "vitest";
import { wrapPath } from "./_proxy.js";

describe("wrapPath", () => {
  it("throws when an intermediate segment is not an object", () => {
    const malformed = { a: 42 };
    expect(() =>
      wrapPath(malformed, ["a", "b"], { foo: () => {} }),
    ).toThrow(/expected object/);
  });

  it("throws when the path is missing a needed segment", () => {
    expect(() =>
      wrapPath({}, ["missing"], { foo: () => {} }),
    ).toThrow(/expected object/);
  });
});

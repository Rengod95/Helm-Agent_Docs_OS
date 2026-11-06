import { describe, expect, test } from "bun:test";
import { schemeOf } from "../../../src/views/plugin/plugin-view.tsx";

describe("plugin frame scheme", () => {
  test("an explicit app theme wins over the system setting", () => {
    expect(schemeOf("dark", false)).toBe("dark");
    expect(schemeOf("light", true)).toBe("light");
  });
  test("without an explicit theme the system setting decides", () => {
    expect(schemeOf(null, true)).toBe("dark");
    expect(schemeOf(null, false)).toBe("light");
    expect(schemeOf("auto", true)).toBe("dark");
  });
});

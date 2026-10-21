import { expect, test } from "bun:test";
import * as entry from "../src/index.ts";

test("cap-mcp entry loads", () => {
  expect(typeof entry).toBe("object");
});

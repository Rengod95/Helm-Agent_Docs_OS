import { expect, test } from "bun:test";
import * as entry from "../src/index.ts";

test("core-persistence entry loads", () => {
  expect(typeof entry).toBe("object");
});

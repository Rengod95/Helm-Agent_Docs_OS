import { expect, test } from "bun:test";
import * as entry from "../src/index.ts";

test("contracts entry loads", () => {
  expect(typeof entry).toBe("object");
});

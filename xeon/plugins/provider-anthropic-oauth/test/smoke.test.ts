import { expect, test } from "bun:test";
import * as entry from "../src/index.ts";

test("provider-anthropic-oauth entry loads", () => {
  expect(typeof entry).toBe("object");
});

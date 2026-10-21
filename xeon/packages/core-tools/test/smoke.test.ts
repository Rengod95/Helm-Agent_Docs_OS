import { expect, test } from "bun:test";
import * as entry from "../src/index.ts";

test("core-tools entry loads", () => {
  expect(typeof entry).toBe("object");
});

import { expect, test } from "bun:test";
import * as entry from "../src/index.ts";

test("ext-host entry loads", () => {
  expect(typeof entry).toBe("object");
});

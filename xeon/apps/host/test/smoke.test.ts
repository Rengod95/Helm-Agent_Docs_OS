import { expect, test } from "bun:test";
import * as entry from "../src/index.ts";

test("host entry loads", () => {
  expect(typeof entry).toBe("object");
});

import { expect, test } from "bun:test";
import * as entry from "../src/index.ts";

test("platform-os entry loads", () => {
  expect(typeof entry).toBe("object");
});

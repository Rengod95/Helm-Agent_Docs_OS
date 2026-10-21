import { expect, test } from "bun:test";
import * as entry from "../src/index.ts";

test("platform-secrets entry loads", () => {
  expect(typeof entry).toBe("object");
});

import { expect, test } from "bun:test";
import * as entry from "../src/index.ts";
import * as testing from "../src/testing/index.ts";

test("platform-sandbox entry loads and exposes the assembly API", () => {
  expect(typeof entry.createSandboxService).toBe("function");
  expect(typeof entry.readSandboxSettings).toBe("function");
  expect(entry.SANDBOX_SETTING_DEFS.length).toBe(9);
  expect(typeof testing.fakeSandbox).toBe("function");
});

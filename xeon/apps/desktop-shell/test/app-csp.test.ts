import { expect, test } from "bun:test";
import { APP_CSP } from "../src/main/app-csp.ts";

test("the app document may show data and blob images but still blocks everything else outside itself", () => {
  expect(APP_CSP).toBe(
    "default-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src fresnel-view:",
  );
});

import { describe, expect, test } from "bun:test";
import { DEV_ONLY_ENV, shellEnvOf } from "../src/main/lib/packaged-env.ts";
import { inspectModule } from "../src/main/inspect.ts";
import { createFakeContext } from "./fake-context.ts";

const DEV_ENV: NodeJS.ProcessEnv = {
  PATH: "/usr/bin",
  HOME: "/Users/x",
  FRESNEL_DESKTOP_INSPECT: "1",
  FRESNEL_DESKTOP_INSPECT_SOCKET: "/tmp/x.sock",
  FRESNEL_DESKTOP_ENGINE_BIN: "/tmp/engine",
  FRESNEL_DESKTOP_ENGINE_ARGS: "--x",
  FRESNEL_UI_DIR: "/tmp/ui",
};

describe("shellEnvOf", () => {
  test("a packaged app drops every dev-only variable and keeps the rest", () => {
    expect(shellEnvOf(DEV_ENV, true)).toEqual({ PATH: "/usr/bin", HOME: "/Users/x" });
  });

  test("an unpackaged run keeps the environment as is", () => {
    expect(shellEnvOf(DEV_ENV, false)).toEqual(DEV_ENV);
  });

  test("the dev-only list names the inspect switch and its socket override", () => {
    expect(DEV_ONLY_ENV).toContain("FRESNEL_DESKTOP_INSPECT");
    expect(DEV_ONLY_ENV).toContain("FRESNEL_DESKTOP_INSPECT_SOCKET");
  });

  test("the inspect module sees no switch in a packaged environment, so it registers nothing to quit", () => {
    const fake = createFakeContext();
    inspectModule.register({ ...fake.ctx, env: shellEnvOf(DEV_ENV, true) });
    expect(fake.cleanups.length).toBe(0);
  });
});

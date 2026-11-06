import { describe, expect, test } from "bun:test";
import { dataRootsOf, USER_DATA_ENV } from "../src/main/lib/data-roots.ts";

const base = {
  platform: "darwin",
  appData: "/Users/x/Library/Application Support",
  home: "/Users/x",
  identifier: "dev.fresnel.desktop",
} as const;

describe("dataRootsOf", () => {
  test("without the variable the OS locations are used", () => {
    expect(dataRootsOf({ ...base, env: {} })).toEqual({
      configDir: "/Users/x/Library/Application Support/dev.fresnel.desktop",
      userData: "/Users/x/Library/Application Support/dev.fresnel.desktop.electron",
      logs: "/Users/x/Library/Logs/dev.fresnel.desktop",
    });
  });

  test("on other platforms logs sit inside userData", () => {
    const roots = dataRootsOf({ ...base, platform: "linux", appData: "/h/.config", env: {} });
    expect(roots.logs).toBe("/h/.config/dev.fresnel.desktop.electron/logs");
  });

  test("an absolute value gathers all three folders under it", () => {
    expect(dataRootsOf({ ...base, env: { [USER_DATA_ENV]: "/tmp/t/" } })).toEqual({
      configDir: "/tmp/t/config",
      userData: "/tmp/t/electron",
      logs: "/tmp/t/logs",
    });
  });

  test("an empty or relative value is ignored", () => {
    const fallback = dataRootsOf({ ...base, env: {} });
    expect(dataRootsOf({ ...base, env: { [USER_DATA_ENV]: "" } })).toEqual(fallback);
    expect(dataRootsOf({ ...base, env: { [USER_DATA_ENV]: "rel/dir" } })).toEqual(fallback);
  });
});

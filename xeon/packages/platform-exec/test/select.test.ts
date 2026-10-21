import { expect, test } from "bun:test";
import { selectExecPlatform } from "../src/select.ts";

test("select returns an error value for unsupported OS", () => {
  for (const platform of ["freebsd", "android", "aix"]) {
    expect(selectExecPlatform({ platform, env: {}, procVersion: undefined })).toEqual({
      ok: false,
      error: { kind: "unsupported_platform", platform },
    });
  }
});

test("select picks the provider by OS name", () => {
  const darwin = selectExecPlatform({ platform: "darwin", env: {}, procVersion: undefined });
  const win32 = selectExecPlatform({ platform: "win32", env: {}, procVersion: undefined });
  expect(darwin.ok && darwin.value.platform).toEqual({ kind: "darwin" });
  expect(win32.ok && win32.value.platform).toEqual({ kind: "win32" });
});

test("select marks linux as WSL by WSL_DISTRO_NAME or by /proc/version", () => {
  const byEnv = selectExecPlatform({
    platform: "linux",
    env: { WSL_DISTRO_NAME: "Ubuntu" },
    procVersion: undefined,
  });
  const byProc = selectExecPlatform({
    platform: "linux",
    env: {},
    procVersion: "Linux version 6.1.0-microsoft-standard-WSL2",
  });
  const plain = selectExecPlatform({
    platform: "linux",
    env: { WSL_DISTRO_NAME: "" },
    procVersion: "Linux version 6.1.0-generic",
  });
  expect(byEnv.ok && byEnv.value.platform).toEqual({ kind: "linux", wsl: true });
  expect(byProc.ok && byProc.value.platform).toEqual({ kind: "linux", wsl: true });
  expect(plain.ok && plain.value.platform).toEqual({ kind: "linux", wsl: false });
});

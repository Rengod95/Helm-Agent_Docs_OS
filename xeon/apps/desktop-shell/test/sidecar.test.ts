import { describe, expect, test } from "bun:test";
import {
  devOverrideOf,
  resolveSidecar,
  overridePrefix,
  sidecarCandidates,
  SIDECAR_ARGS,
  SIDECAR_NAME,
} from "../src/main/lib/sidecar.ts";
import { engineEnv } from "../src/main/lib/env-path.ts";

const RESOURCES = "/work/apps/desktop-shell";
const DEV_DIR = "/work/apps/desktop/src-tauri/binaries";
const only =
  (...files: string[]) =>
  (file: string): boolean =>
    files.includes(file);
/** 자식 PATH 하나를 엔진 환경으로 보강해서 PATH만 읽는다 */
const pathOf = (path: string | undefined, home: string | null): string | undefined =>
  engineEnv(path === undefined ? {} : { PATH: path }, home)["PATH"];

describe("sidecar candidates", () => {
  test("the bundled name and the dev folder follow the target triple", () => {
    expect(SIDECAR_NAME).toBe("fresnel");
    expect(sidecarCandidates({ platform: "darwin", arch: "arm64", resources: RESOURCES })).toEqual({
      bundled: `${RESOURCES}/fresnel-aarch64-apple-darwin`,
      dev: `${DEV_DIR}/fresnel-aarch64-apple-darwin`,
    });
  });

  test("each supported platform and arch maps to its triple", () => {
    const cases: [NodeJS.Platform, string, string][] = [
      ["darwin", "x64", "x86_64-apple-darwin"],
      ["linux", "x64", "x86_64-unknown-linux-gnu"],
      ["linux", "arm64", "aarch64-unknown-linux-gnu"],
    ];
    for (const [platform, arch, triple] of cases) {
      expect(sidecarCandidates({ platform, arch, resources: RESOURCES })?.bundled).toBe(
        `${RESOURCES}/fresnel-${triple}`,
      );
    }
  });

  test("Windows adds .exe", () => {
    expect(sidecarCandidates({ platform: "win32", arch: "x64", resources: RESOURCES })).toEqual({
      bundled: `${RESOURCES}/fresnel-x86_64-pc-windows-msvc.exe`,
      dev: `${DEV_DIR}/fresnel-x86_64-pc-windows-msvc.exe`,
    });
  });

  test("an unsupported platform or arch has no sidecar", () => {
    expect(
      sidecarCandidates({ platform: "freebsd", arch: "x64", resources: RESOURCES }),
    ).toBeNull();
    expect(
      sidecarCandidates({ platform: "win32", arch: "arm64", resources: RESOURCES }),
    ).toBeNull();
  });
});

describe("sidecar lookup", () => {
  const bundled = `${RESOURCES}/fresnel-aarch64-apple-darwin`;
  const dev = `${DEV_DIR}/fresnel-aarch64-apple-darwin`;

  test("the packaged sidecar wins when it is in Resources", () => {
    expect(
      resolveSidecar({
        platform: "darwin",
        arch: "arm64",
        resources: RESOURCES,
        exists: only(bundled, dev),
      }),
    ).toEqual({ bundled: true, file: bundled });
  });

  test("a development run falls back to the src-tauri binaries folder", () => {
    expect(
      resolveSidecar({
        platform: "darwin",
        arch: "arm64",
        resources: RESOURCES,
        exists: only(dev),
      }),
    ).toEqual({ bundled: false, file: dev });
  });

  test("no file means no sidecar", () => {
    expect(
      resolveSidecar({ platform: "darwin", arch: "arm64", resources: RESOURCES, exists: only() }),
    ).toEqual({ bundled: false, file: null });
    expect(
      resolveSidecar({
        platform: "freebsd",
        arch: "x64",
        resources: RESOURCES,
        exists: () => true,
      }),
    ).toEqual({ bundled: false, file: null });
  });
});

describe("development override (engine.rs parse_dev_override, secret_entry.rs override_prefix)", () => {
  test("needs a non-empty binary and takes no args by default", () => {
    expect(devOverrideOf({ FRESNEL_DESKTOP_ENGINE_ARGS: "host --stdio" })).toBeNull();
    expect(devOverrideOf({ FRESNEL_DESKTOP_ENGINE_BIN: "" })).toBeNull();
    expect(devOverrideOf({ FRESNEL_DESKTOP_ENGINE_BIN: "fake" })).toEqual({
      bin: "fake",
      args: [],
    });
  });

  test("the args are split on whitespace", () => {
    expect(
      devOverrideOf({
        FRESNEL_DESKTOP_ENGINE_BIN: "/dev/fake-engine",
        FRESNEL_DESKTOP_ENGINE_ARGS: "--inspect  host --stdio",
      }),
    ).toEqual({ bin: "/dev/fake-engine", args: ["--inspect", "host", "--stdio"] });
  });

  test("the prefix before host --stdio is kept, anything else is not an override", () => {
    expect(overridePrefix(["apps/cli/src/main.ts", "host", "--stdio"])).toEqual([
      "apps/cli/src/main.ts",
    ]);
    expect(overridePrefix(["host", "--stdio"])).toEqual([]);
    expect(overridePrefix(["apps/cli/src/main.ts"])).toBeNull();
    expect(overridePrefix([])).toBeNull();
    expect(SIDECAR_ARGS).toEqual(["host", "--stdio"]);
  });
});

describe("child environment (env_path.rs, E7)", () => {
  const ADDED =
    "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/Users/u/.local/bin:/Users/u/.nix-profile/bin";
  test("a Finder PATH gets the tool dirs appended in order", () => {
    expect(pathOf("/usr/bin:/bin:/usr/sbin:/sbin", "/Users/u")).toBe(
      `/usr/bin:/bin:/usr/sbin:/sbin:${ADDED}`,
    );
  });

  test("a dir already on the PATH is not repeated and keeps its place", () => {
    expect(pathOf("/usr/local/bin:/usr/bin:/opt/homebrew/bin", "/Users/u")).toBe(
      "/usr/local/bin:/usr/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/Users/u/.local/bin:/Users/u/.nix-profile/bin",
    );
  });

  test("user dirs stay first and a home dir already listed is kept where it is", () => {
    expect(pathOf("/Users/u/.local/bin:/Users/u/bin:/usr/bin", "/Users/u")).toBe(
      "/Users/u/.local/bin:/Users/u/bin:/usr/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/Users/u/.nix-profile/bin",
    );
  });

  test("without a home only the fixed dirs are added", () => {
    expect(pathOf("/usr/bin:/bin", null)).toBe(
      "/usr/bin:/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin",
    );
  });

  test("a missing or empty PATH yields only the added dirs, and empty entries are dropped", () => {
    expect(pathOf(undefined, "/Users/u")).toBe(ADDED);
    expect(pathOf("", "/Users/u")).toBe(ADDED);
    expect(pathOf("/usr/bin::", null)).toBe(
      "/usr/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin",
    );
  });

  test("a home that cannot be joined leaves the PATH unchanged", () => {
    expect(pathOf("/usr/bin", "/Users/a:b")).toBe("/usr/bin");
  });

  test("BUN_OPTIONS is removed and only it; a PATH is added last when there is none", () => {
    const env = engineEnv(
      { PATH: "/usr/bin:/bin", BUN_OPTIONS: "--inspect", BUN_OPTIONS_X: "keep", HOME: "/Users/u" },
      "/Users/u",
    );
    expect(Object.keys(env)).toEqual(["PATH", "BUN_OPTIONS_X", "HOME"]);
    expect(env["PATH"]).toBe(`/usr/bin:/bin:${ADDED}`);
    expect(engineEnv({ HOME: "/Users/u" }, "/Users/u")).toEqual({ HOME: "/Users/u", PATH: ADDED });
  });
});

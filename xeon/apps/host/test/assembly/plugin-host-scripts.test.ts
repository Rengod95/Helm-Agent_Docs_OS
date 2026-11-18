import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@fresnel/contracts";
import { systemScheduler } from "@fresnel/platform-os";
import {
  allowedEnvOf,
  createPluginHostAssembly,
  runnerOnPath,
} from "../../src/assembly/plugin-host.ts";

// L4.host-service.spec §4.22. 격리 조립이 스크립트 실행기에 넘기는 두 값: 실행기 절대 경로(`runner`)와 허용 환경 값(`allowedEnv`).
// 값 비교 시험이다. 실행기는 부모 환경의 PATH에서 찾고, 허용 환경 값은 자식 env 허용 목록에서 시크릿 거부 패턴을 뺀 것이다.

const root = mkdtempSync(join(tmpdir(), "plugin-host-scripts-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const LOGGER: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => LOGGER,
};

/** 실행 비트가 있는 `node`만 든 폴더. `python3`은 없다 */
function binDir(name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "node");
  writeFileSync(file, "#!/bin/sh\n");
  chmodSync(file, 0o755);
  return dir;
}

test("the script environment passes only the child allowlist names and drops the secret-shaped ones", () => {
  const env = allowedEnvOf({
    PATH: "/usr/bin:/bin",
    HOME: "/home/kit",
    LANG: "C.UTF-8",
    ANTHROPIC_API_KEY: "must-not-pass",
    MY_TOKEN: "must-not-pass",
    FRESNEL_HOME: "must-not-pass",
    MARKER: "not-in-the-allowlist",
    TMPDIR: "/tmp",
  });
  expect(env).toEqual({
    PATH: "/usr/bin:/bin",
    HOME: "/home/kit",
    LANG: "C.UTF-8",
    TMPDIR: "/tmp",
  });
});

test("the runner is the absolute path found on the parent PATH, and a runner not on it is undefined", () => {
  const dir = binDir("node-only");
  const runner = runnerOnPath({ PATH: dir });
  expect(runner("node")).toBe(join(dir, "node"));
  expect(runner("python3")).toBeUndefined();
  expect(runner("sh")).toBeUndefined();
  // PATH가 없으면 찾을 곳이 없다
  expect(runnerOnPath({})("node")).toBeUndefined();
});

test("the assembly hands the loader the runner it resolves and the allowed environment of its parent", () => {
  const parentEnv = { PATH: binDir("assembly-path"), HOME: "/home/kit", MY_KEY: "secret" };
  const assembly = createPluginHostAssembly({
    scheduler: systemScheduler(),
    logger: LOGGER,
    maskSecrets: (line) => line,
    autoDisabler: { disableNow: () => {} },
    processPort: undefined,
    stateDir: join(root, "assembly-state"),
    settingValue: () => undefined,
    now: () => 0,
    parentEnv,
  });

  // 시험이 실행기를 넣지 않으면 부모 환경의 PATH에서 찾는다
  expect(assembly.isolation.runner?.("node")).toBe(join(parentEnv.PATH, "node"));
  expect(assembly.isolation.runner?.("bash")).toBeUndefined();
  expect(assembly.isolation.allowedEnv).toEqual({ PATH: parentEnv.PATH, HOME: "/home/kit" });
});

test("an injected runner resolution replaces the PATH lookup, and a name it does not know is undefined", () => {
  const assembly = createPluginHostAssembly({
    scheduler: systemScheduler(),
    logger: LOGGER,
    maskSecrets: (line) => line,
    autoDisabler: { disableNow: () => {} },
    processPort: undefined,
    stateDir: join(root, "injected-state"),
    settingValue: () => undefined,
    now: () => 0,
    parentEnv: {},
    resolveRunner: (name) => (name === "sh" ? "/bin/sh" : undefined),
  });
  expect(assembly.isolation.runner?.("sh")).toBe("/bin/sh");
  expect(assembly.isolation.runner?.("python3")).toBeUndefined();
  expect(assembly.isolation.allowedEnv).toEqual({});
});

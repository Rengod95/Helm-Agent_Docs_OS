import { describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Bug } from "@xeon/contracts";
import { tempDir, withIsolatedEnv } from "../src/testing/index.ts";
import { exists } from "./support/json.ts";

const ISOLATED = [
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
  "TMPDIR",
  "XEON_HOME",
] as const;
const SECRETS: Readonly<Record<string, string>> = {
  OPENAI_API_KEY: "sk-test",
  FOO_API_KEY: "k",
  ANTHROPIC_AUTH_TOKEN: "t",
  ANTHROPIC_BASE_URL: "u",
  OPENAI_ORG: "o",
  SOPS_AGE_KEY_FILE: "/f",
  SOPS_AGE_KEY: "AGE-SECRET-KEY-1",
  SSH_AUTH_SOCK: "/s",
};

describe("withIsolatedEnv", () => {
  test("변수 격리와 복원", async () => {
    const before = new Map<string, string | undefined>();
    for (const name of [...ISOLATED, ...Object.keys(SECRETS), "KEEP_ME"]) {
      before.set(name, process.env[name]);
    }
    for (const [name, value] of Object.entries(SECRETS)) process.env[name] = value;
    process.env["KEEP_ME"] = "kept";
    try {
      const during = await withIsolatedEnv(async (env) => {
        await Promise.resolve();
        const seen = ISOLATED.map((name) => process.env[name]);
        return {
          env,
          seen,
          secretsLeft: Object.keys(SECRETS).filter((name) => process.env[name] !== undefined),
          keep: process.env["KEEP_ME"],
        };
      });
      const root = dirname(during.env.home);
      for (const value of during.seen) expect(value?.startsWith(`${root}/`)).toBe(true);
      expect(during.env.vars["HOME"]).toBe(during.env.home);
      expect(Object.keys(during.env.vars).toSorted()).toEqual(ISOLATED.toSorted());
      expect(during.secretsLeft).toEqual([]);
      expect(during.keep).toBe("kept");
      // 끝난 뒤 원래 값
      for (const [name, value] of Object.entries(SECRETS)) expect(process.env[name]).toBe(value);
      expect(process.env["HOME"]).toBe(before.get("HOME"));
    } finally {
      for (const [name, value] of before) {
        if (value === undefined) Reflect.deleteProperty(process.env, name);
        else process.env[name] = value;
      }
    }
  });

  test("예외가 나도 원래 값으로 되돌리고 임시 디렉터리를 지운다", async () => {
    const originalHome = process.env["HOME"];
    let tempHome = "";
    const failure = await withIsolatedEnv(async (env) => {
      await Promise.resolve();
      tempHome = env.home;
      throw new Bug("boom");
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(failure).toBeInstanceOf(Bug);
    expect(process.env["HOME"]).toBe(originalHome);
    expect(tempHome).not.toBe("");
    expect(await exists(tempHome)).toBe(false);
  });

  test("임시 디렉터리들이 실제로 만들어져 있다", async () => {
    await withIsolatedEnv(async (env) => {
      const stats = await Promise.all(Object.values(env.vars).map((path) => stat(path)));
      expect(stats.every((st) => st.isDirectory())).toBe(true);
    });
  });

  test("원래 없던 변수는 끝난 뒤에도 없다", async () => {
    const saved = process.env["XEON_HOME"];
    Reflect.deleteProperty(process.env, "XEON_HOME");
    try {
      await withIsolatedEnv(() => Promise.resolve());
      expect(process.env["XEON_HOME"]).toBeUndefined();
    } finally {
      if (saved !== undefined) process.env["XEON_HOME"] = saved;
    }
  });
});

describe("tempDir", () => {
  test("두 번 지우기: remove()를 두 번 불러도 오류가 없다", async () => {
    const dir = await tempDir();
    expect((await stat(dir.path)).isDirectory()).toBe(true);
    await dir.remove();
    await dir.remove();
    expect(await exists(dir.path)).toBe(false);
  });

  test("접두와 join과 asyncDispose", async () => {
    const dir = await tempDir("xeon-prefix-");
    expect(dir.path).toContain("xeon-prefix-");
    expect(dir.join("a", "b")).toBe(`${dir.path}/a/b`);
    await dir[Symbol.asyncDispose]();
    expect(await exists(dir.path)).toBe(false);
  });

  test("서로 다른 디렉터리를 만든다", async () => {
    const a = await tempDir();
    const b = await tempDir();
    expect(a.path).not.toBe(b.path);
    await a.remove();
    await b.remove();
  });
});

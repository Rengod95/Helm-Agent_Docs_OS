import { describe, expect, test } from "bun:test";
import type { Logger, LogFields } from "@fresnel/contracts";
import {
  LOGIN_ENV_SCRIPT,
  createUserEnvResolver,
  parseLoginEnv,
  type LoginShellRunner,
} from "../../src/assembly/user-env.ts";

// 가져온 훅이 돌 사용자 환경 얻기(AGE-58 [제안]): 로그인 셸 한 번, 실패하면 엔진 환경, 캐시, 값은 기록하지 않는다.

interface Entry {
  readonly level: string;
  readonly event: string;
  readonly fields: LogFields | undefined;
}

function recorder(): { readonly logger: Logger; readonly entries: Entry[] } {
  const entries: Entry[] = [];
  const logger: Logger = {
    debug: (event, fields) => entries.push({ level: "debug", event, fields }),
    info: (event, fields) => entries.push({ level: "info", event, fields }),
    warn: (event, fields) => entries.push({ level: "warn", event, fields }),
    error: (event, fields) => entries.push({ level: "error", event, fields }),
    child: () => logger,
  };
  return { logger, entries };
}

const MARKED = (body: string): string =>
  `noise\n__FRESNEL_ENV_START__${body}__FRESNEL_ENV_END__tail`;

describe("parseLoginEnv", () => {
  test("reads NUL separated entries between the markers and ignores the noise around them", () => {
    expect(parseLoginEnv(MARKED("PATH=/a:/b\0HOME=/h\0MULTI=x\ny\0"))).toEqual({
      PATH: "/a:/b",
      HOME: "/h",
      MULTI: "x\ny",
    });
  });

  test("drops bad names and entries without a value separator", () => {
    expect(parseLoginEnv(MARKED("1BAD=x\0no-eq\0A-B=1\0GOOD=\0"))).toEqual({ GOOD: "" });
  });

  test("returns undefined without both markers or without any entry", () => {
    expect(parseLoginEnv("PATH=/a\0")).toBeUndefined();
    expect(parseLoginEnv(MARKED(""))).toBeUndefined();
  });
});

describe("createUserEnvResolver", () => {
  const parent = { SHELL: "/bin/zsh", PATH: "/usr/bin:/bin", ONLY_ENGINE: "e", UNSET: undefined };

  test("the login shell environment wins and engine-only variables stay; the shell, script, cwd and timeout are exact", async () => {
    const seen: Parameters<LoginShellRunner>[0][] = [];
    const { logger, entries } = recorder();
    const resolve = createUserEnvResolver({
      parentEnv: parent,
      home: "/Users/u",
      now: () => 0,
      logger,
      run: async (input) => {
        seen.push(input);
        return { ok: true, stdout: MARKED("PATH=/mise/shims:/usr/bin\0SECRET_NOTE=do-not-log\0") };
      },
    });
    expect(await resolve()).toEqual({
      SHELL: "/bin/zsh",
      PATH: "/mise/shims:/usr/bin",
      ONLY_ENGINE: "e",
      SECRET_NOTE: "do-not-log",
    });
    expect(seen).toEqual([
      {
        shell: "/bin/zsh",
        script: LOGIN_ENV_SCRIPT,
        env: { SHELL: "/bin/zsh", PATH: "/usr/bin:/bin", ONLY_ENGINE: "e" },
        cwd: "/Users/u",
        timeoutMs: 5000,
      },
    ]);
    expect(entries).toEqual([
      {
        level: "info",
        event: "script_env.resolved",
        fields: { source: "login_shell", vars: 4, pathEntries: 2 },
      },
    ]);
    expect(JSON.stringify(entries)).not.toContain("do-not-log");
  });

  test("a failed login shell falls back to the engine environment and logs only the reason", async () => {
    const { logger, entries } = recorder();
    const resolve = createUserEnvResolver({
      parentEnv: parent,
      home: "/h",
      now: () => 0,
      logger,
      run: async () => ({ ok: false, reason: "timeout" }),
    });
    expect(await resolve()).toEqual({ SHELL: "/bin/zsh", PATH: "/usr/bin:/bin", ONLY_ENGINE: "e" });
    expect(entries).toEqual([
      {
        level: "warn",
        event: "script_env.login_shell_failed",
        fields: { reason: "timeout", vars: 3, pathEntries: 2 },
      },
    ]);
  });

  test("unparsable output also falls back; no SHELL means no login shell at all", async () => {
    const { logger } = recorder();
    const unparsable = createUserEnvResolver({
      parentEnv: parent,
      home: "/h",
      now: () => 0,
      logger,
      run: async () => ({ ok: true, stdout: "garbage" }),
    });
    expect((await unparsable())["PATH"]).toBe("/usr/bin:/bin");
    let called = false;
    const noShell = createUserEnvResolver({
      parentEnv: { PATH: "/p" },
      home: "/h",
      now: () => 0,
      logger,
      run: async () => {
        called = true;
        return { ok: false, reason: "spawn_failed" };
      },
    });
    expect(await noShell()).toEqual({ PATH: "/p" });
    expect(called).toBe(false);
  });

  test("the result is cached for the ttl and concurrent calls share one login shell", async () => {
    let calls = 0;
    let at = 0;
    const { logger } = recorder();
    const resolve = createUserEnvResolver({
      parentEnv: parent,
      home: "/h",
      now: () => at,
      ttlMs: 1000,
      logger,
      run: async () => {
        calls += 1;
        return { ok: true, stdout: MARKED(`PATH=/p${calls}\0`) };
      },
    });
    const [a, b] = await Promise.all([resolve(), resolve()]);
    expect([a["PATH"], b["PATH"], calls]).toEqual(["/p1", "/p1", 1]);
    at = 999;
    expect((await resolve())["PATH"]).toBe("/p1");
    at = 1000;
    expect((await resolve())["PATH"]).toBe("/p2");
    expect(calls).toBe(2);
  });

  test("a caller cannot change the cached environment", async () => {
    const { logger } = recorder();
    const resolve = createUserEnvResolver({
      parentEnv: parent,
      home: "/h",
      now: () => 0,
      logger,
      run: async () => ({ ok: true, stdout: MARKED("PATH=/p\0") }),
    });
    const first = await resolve();
    first["PATH"] = "/changed";
    expect((await resolve())["PATH"]).toBe("/p");
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { err, ok, type Result } from "@fresnel/contracts";
import { appLogOf, LOG_FILE_NAME } from "../src/main/lib/applog.ts";
import { nodeScheduler } from "../src/main/lib/scheduler.ts";
import {
  createSecretEntry,
  ENTRY_TIMEOUT_MS,
  entryArgs,
  type EntryChild,
  type EntryCommand,
  type EntryLauncher,
  type EntryPlanInputs,
  type LaunchFailure,
  MAX_VALUE_BYTES,
  parseRequest,
  pipedEntryLauncher,
  planEntryCommand,
  registerSecretEntry,
  secretEntryModule,
} from "../src/main/secret-entry.ts";
import { fakeCtx, type FakeCtx } from "./support/fake-ctx.ts";

const FAKE_VALUE = "fake-key-not-a-real-secret-0001";
const CHILD_PID = 4242;
const ENCODER = new TextEncoder();
const SIDECAR_FILE = "/work/apps/desktop-shell/fresnel-aarch64-apple-darwin";
const HOME = "/Users/tester";

/** `<동작> <이름>\n<값>` 본문. 값은 UTF-8 바이트로 바꾼다 */
function makeBody(head: string, value: string): Uint8Array {
  return ENCODER.encode(`${head}\n${value}`);
}

function isZeroed(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0);
}

/** 존재하는 파일 목록만 있다고 답하는 검사 함수 */
const onlyFiles =
  (...files: string[]) =>
  (file: string): boolean =>
    files.includes(file);

type Script =
  | {
      readonly kind: "exit";
      readonly code: number | null;
      readonly stderr?: readonly string[];
      /** 값 쓰기가 실패한다(자식이 stdin을 닫고 끝난 경우) */
      readonly writeFails?: boolean;
    }
  | { readonly kind: "hang" }
  | { readonly kind: "fail"; readonly detail: string };

interface Recorded {
  readonly commands: EntryCommand[];
  /** 자식 stdin에 실제로 닿은 바이트. 쓰기가 끝나는 시점에 복사한다 */
  readonly writes: Uint8Array[];
  readonly killed: number[];
}

/** 차례로 쓰는 가짜 launcher. 대기열이 비면 끝나지 않는 자식이다 */
function fakeLauncher(scripts: readonly Script[]): { launcher: EntryLauncher; recorded: Recorded } {
  const recorded: Recorded = { commands: [], writes: [], killed: [] };
  const queue = [...scripts];
  const launcher: EntryLauncher = {
    async launch(command): Promise<Result<EntryChild, LaunchFailure>> {
      recorded.commands.push(command);
      const script: Script = queue.shift() ?? { kind: "hang" };
      if (script.kind === "fail") return err({ detail: script.detail });
      return ok(fakeChild(script, recorded));
    },
  };
  return { launcher, recorded };
}

function fakeChild(script: Exclude<Script, { kind: "fail" }>, recorded: Recorded): EntryChild {
  let stderrListener: ((chunk: Uint8Array) => void) | null = null;
  // 끝나는 자식은 표준 오류 조각을 보낸 뒤 코드로 끝난다. 끝나지 않는 자식은 대기를 끝내지 않는다
  const exited = new Promise<number | null>((resolve) => {
    if (script.kind !== "exit") return;
    setTimeout(() => {
      for (const text of script.stderr ?? []) stderrListener?.(ENCODER.encode(text));
      resolve(script.code);
    }, 0);
  });
  const writeFails = script.kind === "exit" && script.writeFails === true;
  return {
    pid: CHILD_PID,
    writeOnceAndClose: (bytes) =>
      new Promise<boolean>((resolve) => {
        // 자식이 읽는 시점(다음 틱)에 복사한다. 호출자가 그 전에 덮었다면 여기서 0이 보인다
        setTimeout(() => {
          if (writeFails) {
            resolve(false);
            return;
          }
          recorded.writes.push(Uint8Array.from(bytes));
          resolve(true);
        }, 0);
      }),
    onStderr: (listener) => {
      stderrListener = listener;
    },
    exited,
    killGroup: () => {
      recorded.killed.push(CHILD_PID);
    },
  };
}

/** 본문 검사를 통과한 요청에 쓰는 계획. 실제 경로를 보지 않는다 */
const planOk = (args: readonly string[]): Result<EntryCommand, LaunchFailure> =>
  ok({ file: SIDECAR_FILE, args: [...args], cwd: HOME, env: { PATH: "/usr/bin" } });

function entryWith(
  fake: FakeCtx,
  launcher: EntryLauncher,
  timeoutMs = 2_000,
): ReturnType<typeof createSecretEntry> {
  return createSecretEntry({
    plan: planOk,
    launcher,
    log: appLogOf(fake.ctx),
    scheduler: nodeScheduler(),
    timeoutMs,
  });
}

/** 명령 등록부를 거쳐 renderer가 받는 모양(`{ok, value}` 또는 `{ok: false, error}`)을 돌려준다 */
function commandOf(fake: FakeCtx, entry: ReturnType<typeof createSecretEntry>) {
  registerSecretEntry(fake.ctx, entry);
  return (body: unknown) => fake.call("secret_register", { body, headers: {} });
}

function logText(fake: FakeCtx): string {
  return readFileSync(path.join(fake.dir, "logs", LOG_FILE_NAME), "utf8");
}

/** JSON 값의 필드 하나를 읽는다(없으면 undefined). 자기 속성만 본다 */
function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

describe("request parsing (secret_entry.rs parse_request)", () => {
  test("splits the head into action and name and keeps the value bytes as they are", () => {
    const body = makeBody("add anthropic-api-key", "line-one\nline-two");
    const parsed = parseRequest(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.action).toBe("add");
    expect(parsed.value.name).toBe("anthropic-api-key");
    expect(new TextDecoder().decode(parsed.value.value)).toBe("line-one\nline-two");
  });

  test("every bad request shape is rejected with its exact error object", () => {
    const badHeads = [
      "remove anthropic-api-key",
      "add",
      "add -rf",
      "add --yes",
      "add Anthropic",
      "add a",
      "add ../x",
      "add name with space",
      "add anthropic-api-key ",
      `add ${"a".repeat(65)}`,
    ];
    for (const head of badHeads) {
      expect(parseRequest(makeBody(head, FAKE_VALUE))).toEqual(err({ kind: "bad-request" }));
    }
    expect(parseRequest(ENCODER.encode("add anthropic-api-key"))).toEqual(
      err({ kind: "bad-request" }),
    );
    expect(parseRequest(makeBody(`add ${"a".repeat(80)}`, FAKE_VALUE))).toEqual(
      err({ kind: "bad-request" }),
    );
    expect(parseRequest(makeBody("add anthropic-api-key", ""))).toEqual(err({ kind: "empty" }));
    const tooLong = "x".repeat(MAX_VALUE_BYTES + 1);
    expect(parseRequest(makeBody("add anthropic-api-key", tooLong))).toEqual(
      err({ kind: "too-large" }),
    );
  });

  test("a value at the limit is accepted, and a BOM before the action is not", () => {
    const atLimit = "x".repeat(MAX_VALUE_BYTES);
    expect(parseRequest(makeBody("add anthropic-api-key", atLimit)).ok).toBe(true);
    expect(parseRequest(makeBody("﻿add anthropic-api-key", FAKE_VALUE))).toEqual(
      err({ kind: "bad-request" }),
    );
  });

  test("a head that is not valid UTF-8 is a bad request", () => {
    const bytes = new Uint8Array([0x61, 0x64, 0x64, 0x20, 0xff, 0x0a, 0x78]);
    expect(parseRequest(bytes)).toEqual(err({ kind: "bad-request" }));
  });

  test("the args are the secret subcommand, the action and the name, and never the value", () => {
    expect(entryArgs({ action: "add", name: "anthropic-api-key" })).toEqual([
      "secret",
      "add",
      "anthropic-api-key",
    ]);
    expect(entryArgs({ action: "set", name: "openai-api-key" })).toEqual([
      "secret",
      "set",
      "openai-api-key",
    ]);
  });

  test("the module keeps the Rust limits: 30 seconds and 8 KiB", () => {
    expect(ENTRY_TIMEOUT_MS).toBe(30_000);
    expect(MAX_VALUE_BYTES).toBe(8 * 1024);
  });
});

describe("registration (secret_entry.rs SecretEntry::register)", () => {
  test("the value goes to stdin once and never into argv, env or the app log", async () => {
    const fake = fakeCtx();
    const { launcher, recorded } = fakeLauncher([{ kind: "exit", code: 0 }]);
    const body = makeBody("add anthropic-api-key", FAKE_VALUE);
    const reply = await commandOf(fake, entryWith(fake, launcher))(body);
    expect(reply).toEqual({ ok: true, value: null });

    expect(recorded.commands).toHaveLength(1);
    const command = recorded.commands[0];
    expect(command?.args).toEqual(["secret", "add", "anthropic-api-key"]);
    expect(recorded.writes).toEqual([ENCODER.encode(FAKE_VALUE)]);
    expect(recorded.commands.map((c) => c.args.join(" ")).join("\n")).not.toContain(FAKE_VALUE);
    expect(JSON.stringify(command?.env)).not.toContain(FAKE_VALUE);
    expect(logText(fake)).not.toContain(FAKE_VALUE);
    expect(logText(fake)).toMatch(/ secret entry add anthropic-api-key: ok\n$/u);
    expect(isZeroed(body)).toBe(true);
  });

  test("set passes the action through and the value may contain newlines", async () => {
    const fake = fakeCtx();
    const { launcher, recorded } = fakeLauncher([{ kind: "exit", code: 0 }]);
    const reply = await commandOf(
      fake,
      entryWith(fake, launcher),
    )(makeBody("set openai-api-key", "line-one\nline-two"));
    expect(reply).toEqual({ ok: true, value: null });
    expect(recorded.commands[0]?.args[1]).toBe("set");
    expect(recorded.writes).toEqual([ENCODER.encode("line-one\nline-two")]);
  });

  test("a failing child is rejected with its exit code and stderr detail", async () => {
    const fake = fakeCtx();
    const { launcher } = fakeLauncher([
      {
        kind: "exit",
        code: 1,
        stderr: ["시크릿 제공자(sops)를 쓸 수 없다 ", "(not_registered)\n"],
      },
    ]);
    const reply = await commandOf(
      fake,
      entryWith(fake, launcher),
    )(makeBody("add anthropic-api-key", FAKE_VALUE));
    expect(reply).toEqual({
      ok: false,
      error: {
        kind: "rejected",
        exitCode: 1,
        detail: "시크릿 제공자(sops)를 쓸 수 없다 (not_registered)",
      },
    });
    expect(logText(fake)).toMatch(/ secret entry add anthropic-api-key: rejected \(exit 1\)\n$/u);
  });

  test("child output that contains the value is dropped entirely", async () => {
    const fake = fakeCtx();
    const { launcher } = fakeLauncher([
      { kind: "exit", code: 1, stderr: [`값 ${FAKE_VALUE} 을 저장하지 못했다\n`] },
    ]);
    const reply = await commandOf(
      fake,
      entryWith(fake, launcher),
    )(makeBody("add anthropic-api-key", FAKE_VALUE));
    expect(reply).toEqual({ ok: false, error: { kind: "rejected", exitCode: 1, detail: "" } });
    expect(JSON.stringify(reply)).not.toContain(FAKE_VALUE);
  });

  test("a child that exits 0 but did not take the value is still rejected", async () => {
    const fake = fakeCtx();
    const { launcher } = fakeLauncher([{ kind: "exit", code: 0, writeFails: true }]);
    const reply = await commandOf(
      fake,
      entryWith(fake, launcher),
    )(makeBody("add anthropic-api-key", FAKE_VALUE));
    expect(reply).toEqual({ ok: false, error: { kind: "rejected", exitCode: 0, detail: "" } });
  });

  test("a signal end (no exit code) is rejected with exitCode null", async () => {
    const fake = fakeCtx();
    const { launcher } = fakeLauncher([{ kind: "exit", code: null, stderr: ["killed"] }]);
    const reply = await commandOf(
      fake,
      entryWith(fake, launcher),
    )(makeBody("add anthropic-api-key", FAKE_VALUE));
    expect(reply).toEqual({
      ok: false,
      error: { kind: "rejected", exitCode: null, detail: "killed" },
    });
  });

  test("a launch failure is unavailable and nothing is written", async () => {
    const fake = fakeCtx();
    const { launcher, recorded } = fakeLauncher([
      { kind: "fail", detail: "sidecar is not available" },
    ]);
    const reply = await commandOf(
      fake,
      entryWith(fake, launcher),
    )(makeBody("add anthropic-api-key", FAKE_VALUE));
    expect(reply).toEqual({
      ok: false,
      error: { kind: "unavailable", detail: "sidecar is not available" },
    });
    expect(recorded.writes).toEqual([]);
    expect(logText(fake)).toMatch(/ secret entry add anthropic-api-key: unavailable\n$/u);
  });

  test("a child that never ends is killed by its group after the deadline", async () => {
    const fake = fakeCtx();
    const { launcher, recorded } = fakeLauncher([{ kind: "hang" }]);
    const reply = await commandOf(
      fake,
      entryWith(fake, launcher, 20),
    )(makeBody("add anthropic-api-key", FAKE_VALUE));
    expect(reply).toEqual({ ok: false, error: { kind: "timeout" } });
    expect(recorded.killed).toEqual([CHILD_PID]);
    expect(logText(fake)).toMatch(/ secret entry add anthropic-api-key: timeout\n$/u);
  });

  test("only one registration runs at a time, and the gate reopens after it ends", async () => {
    const fake = fakeCtx();
    const { launcher, recorded } = fakeLauncher([{ kind: "hang" }, { kind: "exit", code: 0 }]);
    const call = commandOf(fake, entryWith(fake, launcher, 20));
    const first = call(makeBody("add anthropic-api-key", FAKE_VALUE));
    const secondBody = makeBody("add openai-api-key", FAKE_VALUE);
    const second = await call(secondBody);
    expect(second).toEqual({ ok: false, error: { kind: "busy" } });
    expect(isZeroed(secondBody)).toBe(true);
    expect(await first).toEqual({ ok: false, error: { kind: "timeout" } });
    expect(recorded.commands).toHaveLength(1);
    expect(await call(makeBody("add openai-api-key", FAKE_VALUE))).toEqual({
      ok: true,
      value: null,
    });
    expect(recorded.commands).toHaveLength(2);
  });

  test("a bad request never starts a process", async () => {
    const fake = fakeCtx();
    const { launcher, recorded } = fakeLauncher([]);
    const call = commandOf(fake, entryWith(fake, launcher));
    expect(await call(makeBody("remove anthropic-api-key", FAKE_VALUE))).toEqual({
      ok: false,
      error: { kind: "bad-request" },
    });
    expect(await call(makeBody("add anthropic-api-key", ""))).toEqual({
      ok: false,
      error: { kind: "empty" },
    });
    expect(await call(makeBody("add anthropic-api-key", "x".repeat(MAX_VALUE_BYTES + 1)))).toEqual({
      ok: false,
      error: { kind: "too-large" },
    });
    expect(await call("add anthropic-api-key\nvalue")).toEqual({
      ok: false,
      error: { kind: "bad-request" },
    });
    expect(await call(null)).toEqual({ ok: false, error: { kind: "bad-request" } });
    expect(recorded.commands).toEqual([]);
  });

  test("the body buffer is zeroed after success, rejection and bad request alike", async () => {
    const fake = fakeCtx();
    const { launcher } = fakeLauncher([
      { kind: "exit", code: 0 },
      { kind: "exit", code: 2, stderr: ["nope"] },
    ]);
    const call = commandOf(fake, entryWith(fake, launcher));
    const okBody = makeBody("add anthropic-api-key", FAKE_VALUE);
    const rejectedBody = makeBody("set anthropic-api-key", FAKE_VALUE);
    const badBody = makeBody("nope", FAKE_VALUE);
    await call(okBody);
    await call(rejectedBody);
    await call(badBody);
    expect(isZeroed(okBody)).toBe(true);
    expect(isZeroed(rejectedBody)).toBe(true);
    expect(isZeroed(badBody)).toBe(true);
  });

  test("the module's command rejects a body that is not raw bytes", async () => {
    const fake = fakeCtx();
    secretEntryModule.register(fake.ctx);
    expect(await fake.call("secret_register", { body: FAKE_VALUE, headers: {} })).toEqual({
      ok: false,
      error: { kind: "bad-request" },
    });
    expect(await fake.call("secret_register", null)).toEqual({
      ok: false,
      error: { kind: "bad-request" },
    });
  });

  test("the module answers unavailable when no sidecar is installed, and the log names only the result", async () => {
    const fake = fakeCtx();
    secretEntryModule.register(fake.ctx);
    const body = makeBody("add anthropic-api-key", FAKE_VALUE);
    const reply = await fake.call("secret_register", { body, headers: {} });
    expect(reply.ok).toBe(false);
    expect(logText(fake)).toMatch(/ secret entry add anthropic-api-key: unavailable\n$/u);
    expect(logText(fake)).not.toContain(FAKE_VALUE);
    expect(isZeroed(body)).toBe(true);
  });

  test("every rejection serializes to the shape the page parses", async () => {
    const fake = fakeCtx();
    const { launcher } = fakeLauncher([
      { kind: "exit", code: 1, stderr: ["x"] },
      { kind: "fail", detail: "d" },
    ]);
    const call = commandOf(fake, entryWith(fake, launcher));
    const rejected = await call(makeBody("add anthropic-api-key", FAKE_VALUE));
    const unavailable = await call(makeBody("add anthropic-api-key", FAKE_VALUE));
    const tooLarge = await call(makeBody("add anthropic-api-key", "x".repeat(MAX_VALUE_BYTES + 1)));
    expect(JSON.stringify(rejected)).toBe(
      '{"ok":false,"error":{"kind":"rejected","exitCode":1,"detail":"x"}}',
    );
    expect(JSON.stringify(unavailable)).toBe(
      '{"ok":false,"error":{"kind":"unavailable","detail":"d"}}',
    );
    expect(JSON.stringify(tooLarge)).toBe('{"ok":false,"error":{"kind":"too-large"}}');
  });
});

describe("planning the sidecar command (secret_entry.rs TauriEntryLauncher::launch)", () => {
  const base: EntryPlanInputs = {
    env: { PATH: "/usr/bin", HOME: HOME, BUN_OPTIONS: "--inspect" },
    platform: "darwin",
    arch: "arm64",
    resources: "/work/apps/desktop-shell",
    home: HOME,
  };
  const entryArgsList = ["secret", "add", "anthropic-api-key"] as const;

  test("the bundled sidecar runs with the entry args only and the engine env", () => {
    const planned = planEntryCommand(
      { ...base, exists: onlyFiles("/work/apps/desktop-shell/fresnel-aarch64-apple-darwin") },
      entryArgsList,
    );
    expect(planned).toEqual(
      ok({
        file: "/work/apps/desktop-shell/fresnel-aarch64-apple-darwin",
        args: ["secret", "add", "anthropic-api-key"],
        cwd: HOME,
        env: {
          PATH: `/usr/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:${HOME}/.local/bin:${HOME}/.nix-profile/bin`,
          HOME: HOME,
        },
      }),
    );
  });

  test("a development override with a host --stdio prefix replaces the sidecar when no bundled sidecar exists", () => {
    const planned = planEntryCommand(
      {
        ...base,
        env: {
          ...base.env,
          FRESNEL_DESKTOP_ENGINE_BIN: "/dev/fake-engine",
          FRESNEL_DESKTOP_ENGINE_ARGS: "apps/cli/src/main.ts host --stdio",
        },
        exists: () => false,
      },
      entryArgsList,
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.file).toBe("/dev/fake-engine");
    expect(planned.value.args).toEqual([
      "apps/cli/src/main.ts",
      "secret",
      "add",
      "anthropic-api-key",
    ]);
  });

  test("an override without the host --stdio tail is ignored and the sidecar is used", () => {
    const planned = planEntryCommand(
      {
        ...base,
        env: { ...base.env, FRESNEL_DESKTOP_ENGINE_BIN: "/dev/fake-engine" },
        exists: onlyFiles("/work/apps/desktop-shell/fresnel-aarch64-apple-darwin"),
      },
      entryArgsList,
    );
    expect(planned.ok && planned.value.file).toBe(
      "/work/apps/desktop-shell/fresnel-aarch64-apple-darwin",
    );
  });

  test("a packaged app with its bundled sidecar ignores the override", () => {
    const planned = planEntryCommand(
      {
        ...base,
        env: {
          ...base.env,
          FRESNEL_DESKTOP_ENGINE_BIN: "/dev/fake-engine",
          FRESNEL_DESKTOP_ENGINE_ARGS: "host --stdio",
        },
        exists: () => true,
      },
      entryArgsList,
    );
    expect(planned.ok && planned.value.file).toBe(
      "/work/apps/desktop-shell/fresnel-aarch64-apple-darwin",
    );
  });

  test("no sidecar and no override is unavailable", () => {
    expect(planEntryCommand({ ...base, exists: () => false }, entryArgsList)).toEqual(
      err({ detail: "sidecar `fresnel` is not available" }),
    );
  });

  test("a home that is not absolute is unavailable", () => {
    expect(
      planEntryCommand({ ...base, home: "relative/home", exists: () => true }, entryArgsList),
    ).toEqual(err({ detail: "home directory is not absolute" }));
  });
});

/**
 * 실제 자식 대역. 결과 파일에 받은 인자, 환경, stdin을 쓰고 지정한 코드로 끝난다.
 * 셸은 개발 덮어쓰기 `<이 파일> <결과 파일> <코드> host --stdio`로 이것을 `secret <동작> <이름>` 인자와 함께 띄운다.
 */
const PROBE_SOURCE = [
  'import { writeFileSync } from "node:fs";',
  'const [outFile = "", exitText = "0", ...argv] = process.argv.slice(2);',
  "const stdin = await Bun.stdin.text();",
  "writeFileSync(outFile, JSON.stringify({ argv, env: process.env, stdin }));",
  "const code = Number(exitText);",
  'if (code !== 0) process.stderr.write("probe: rejected by the test\\n");',
  "process.exitCode = code;",
  "",
].join("\n");

/** 자식 대역 파일을 시험 폴더에 쓴다(저장소 밖이라 검사 대상이 아니다) */
function probeFileIn(dir: string): string {
  const file = path.join(dir, "stdin-probe.ts");
  writeFileSync(file, PROBE_SOURCE);
  return file;
}

/** 자식 대역을 개발 덮어쓰기로 고른다. 번들 사이드카는 없는 것으로 본다 */
function probeInputs(dir: string, outFile: string, exitCode: number): EntryPlanInputs {
  const probe = probeFileIn(dir);
  return {
    env: {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      BUN_OPTIONS: "--smol",
      FRESNEL_DESKTOP_ENGINE_BIN: process.execPath,
      FRESNEL_DESKTOP_ENGINE_ARGS: `${probe} ${outFile} ${exitCode} host --stdio`,
    },
    platform: process.platform,
    arch: process.arch,
    resources: dir,
    home: dir,
    exists: () => false,
  };
}

describe("real child process (spawnPiped)", () => {
  test("the child gets the value on stdin only, and exit 0 resolves", async () => {
    const fake = fakeCtx();
    const outFile = path.join(fake.dir, "probe.json");
    const log = appLogOf(fake.ctx);
    const entry = createSecretEntry({
      plan: (args) => planEntryCommand(probeInputs(fake.dir, outFile, 0), args),
      launcher: pipedEntryLauncher(log),
      log,
      scheduler: nodeScheduler(),
      timeoutMs: 20_000,
    });
    const body = makeBody("add anthropic-api-key", FAKE_VALUE);
    expect(await entry.register(body)).toBeNull();

    const report: unknown = JSON.parse(readFileSync(outFile, "utf8"));
    expect(fieldOf(report, "stdin")).toBe(FAKE_VALUE);
    expect(fieldOf(report, "argv")).toEqual(["secret", "add", "anthropic-api-key"]);
    const env = fieldOf(report, "env");
    expect(JSON.stringify(env)).not.toContain(FAKE_VALUE);
    expect(fieldOf(env, "BUN_OPTIONS")).toBeUndefined();
    expect(logText(fake)).not.toContain(FAKE_VALUE);
    expect(logText(fake)).toMatch(/ secret entry add anthropic-api-key: ok\n$/u);
    expect(isZeroed(body)).toBe(true);
  });

  test("a child that exits non-zero is rejected with its code and stderr detail", async () => {
    const fake = fakeCtx();
    const outFile = path.join(fake.dir, "probe.json");
    const log = appLogOf(fake.ctx);
    const entry = createSecretEntry({
      plan: (args) => planEntryCommand(probeInputs(fake.dir, outFile, 3), args),
      launcher: pipedEntryLauncher(log),
      log,
      scheduler: nodeScheduler(),
      timeoutMs: 20_000,
    });
    const result = await entry.register(makeBody("add anthropic-api-key", FAKE_VALUE)).then(
      () => "resolved",
      (cause: unknown) => cause,
    );
    expect(result).toEqual(
      expect.objectContaining({
        payload: { kind: "rejected", exitCode: 3, detail: "probe: rejected by the test" },
      }),
    );
    expect(logText(fake)).toMatch(/ secret entry add anthropic-api-key: rejected \(exit 3\)\n$/u);
  });
});

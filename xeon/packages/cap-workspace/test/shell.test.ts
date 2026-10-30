import { describe, expect, test } from "bun:test";
import { WorkspaceShell, type CallOptions } from "@xeon/contracts/capabilities";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { DEFAULT_WORKSPACE_SETTINGS, type WorkspaceSettings } from "../src/settings.ts";
import { createShellApi } from "../src/shell/run.ts";
import { rejection } from "./support/assertions.ts";
import { callTool } from "./support/adapter.ts";
import { depsFor, fakeSandbox } from "./support/fakes.ts";
import { memoryEnv } from "./support/memory-env.ts";

function shellSettings(shell: Partial<WorkspaceSettings["shell"]>): () => WorkspaceSettings {
  return () => ({
    ...DEFAULT_WORKSPACE_SETTINGS,
    shell: { ...DEFAULT_WORKSPACE_SETTINGS.shell, ...shell },
  });
}

/** 호출 문맥만 있는 옵션. interactive가 false면 무인 호출(예약, 루프)이다 */
function callAs(interactive: boolean): CallOptions {
  return { context: { caller: { kind: "model", agent: "main" }, interactive } };
}

function setup(options: Parameters<typeof depsFor>[1] = {}) {
  const env = memoryEnv({ cwd: "/work" });
  env.mkdir("/work");
  const sandbox = options.sandbox === null ? null : (options.sandbox ?? fakeSandbox());
  const shell = createShellApi(depsFor(env, { ...options, sandbox }));
  return { env, shell, sandbox };
}

describe("bash", () => {
  test("bash returns output and exit code", async () => {
    const { env, shell, sandbox } = setup();
    env.reply({ chunks: [{ text: "hello\n" }], exitCode: 0 });
    const out = await shell.run({ command: "echo hello" });
    expect(out).toEqual({
      exitCode: 0,
      output: "hello\n",
      truncated: false,
      durationMs: 5,
      sandboxed: true,
    });
    const call = env.calls[0];
    expect(call?.command).toBe("echo hello");
    expect(call?.options).toMatchObject({
      cwd: "/work",
      inheritEnv: true,
      spill: { afterBytes: 51200, afterLines: 2000 },
      window: { maxBytes: 51200, maxLines: 2000 },
    });
    expect(call?.options?.timeout).toBeUndefined();
    // 샌드박스 정책의 쓰기 root는 작업 root와 임시 디렉터리다
    expect(sandbox?.policies[0]?.writeRoots).toEqual(["/work", "/tmp/xeon"]);
  });

  test("bash nonzero exit is tool error", async () => {
    const { env, shell } = setup();
    env.reply({ chunks: [{ text: "boom\nlast line\n" }], exitCode: 3 });
    const result = await callTool(WorkspaceShell, shell, "bash", { command: "false" });
    expect(result.isError).toBe(true);
    expect(result.text).toBe("[exit_nonzero] exit code 3\nboom\nlast line\n");
    expect(result.details).toMatchObject({
      code: "exit_nonzero",
      detail: { exitCode: 3, output: "boom\nlast line\n", sandboxed: true },
    });
  });

  test("service run without failOnNonZero", async () => {
    const { env, shell } = setup();
    env.reply({ chunks: [{ text: "nope\n" }], exitCode: 2 });
    const out = await shell.run({ command: "false" });
    expect(out.exitCode).toBe(2);
    expect(out.output).toBe("nope\n");
  });

  test("bash tool maps timeout seconds and renders output", async () => {
    const { env, shell } = setup();
    env.reply({ chunks: [{ text: "done\n" }], exitCode: 0 });
    const result = await callTool(WorkspaceShell, shell, "bash", {
      command: "echo done",
      timeout: 7,
    });
    expect(result.isError).toBe(false);
    expect(result.text).toBe("done\n");
    expect(env.calls[0]?.options?.timeout).toBe(7);
  });

  test("sandbox denial maps to denied", async () => {
    const sandbox = fakeSandbox();
    sandbox.deny = true;
    const { env, shell } = setup({ sandbox });
    const error = await rejection(shell.run({ command: "rm -rf x" }));
    expect(error.data.code).toBe("denied");
    expect(error.data.detail).toEqual({ by: "sandbox", reason: "sandbox_unavailable" });
    expect(env.calls).toHaveLength(0);
    const result = await callTool(WorkspaceShell, shell, "bash", { command: "rm -rf x" });
    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({ code: "denied" });
  });

  test("bash is rejected, not run unwrapped, when the sandbox service is missing", async () => {
    const { env, shell } = setup({ sandbox: null });
    const error = await rejection(shell.run({ command: "echo hi" }));
    expect(error.data.code).toBe("unavailable");
    expect(error.data.detail).toEqual({ by: "sandbox", reason: "sandbox_service_missing" });
    expect(env.calls).toHaveLength(0);
  });

  test("sandbox off runs unwrapped", async () => {
    // 샌드박스를 끈 상태: wrapShell이 아래 Shell을 그대로 돌려준다. 결과의 sandbox 보고가 격리 여부를 말한다
    const passthrough = fakeSandbox();
    passthrough.wrapShell = (inner) => inner;
    const off = setup({ sandbox: passthrough });
    off.env.reply({
      exitCode: 0,
      sandbox: {
        sandboxed: false,
        level: "none",
        unsandboxedBy: "disabled",
        violations: [],
        violationsTruncated: false,
      },
    });
    const ran = await off.shell.run({ command: "true" });
    expect(ran.sandboxed).toBe(false);
    // 밖에서 돈 이유가 출력에 실려 L1이 감사 이벤트를 남길 수 있다
    expect(ran.unsandboxedBy).toBe("disabled");
    // 보고가 없으면 격리했다고 주장하지 않는다
    const silent = setup({ sandbox: passthrough });
    const quiet = await silent.shell.run({ command: "true" });
    expect(quiet.sandboxed).toBe(false);
    expect(quiet.unsandboxedBy).toBeUndefined();
  });

  test("bash timeout keeps output", async () => {
    const { env, shell } = setup();
    env.reply({
      chunks: [{ text: "partial\n" }],
      error: { code: "timeout", spillPath: "/tmp/xeon/spill-1" },
    });
    const error = await rejection(shell.run({ command: "sleep 99", timeoutSec: 2 }));
    expect(error.data.code).toBe("timeout");
    expect(error.data.retryable).toBe(true);
    expect(error.data.detail).toMatchObject({
      output: "partial\n",
      truncated: false,
      fullOutputPath: "/tmp/xeon/spill-1",
      sandboxed: false,
    });
    expect(env.calls[0]?.options?.timeout).toBe(2);
  });

  test("the default timeout setting applies unless the call gives one", async () => {
    const { env, shell } = setup({ settings: shellSettings({ defaultTimeoutSec: 30 }) });
    await shell.run({ command: "true" });
    await shell.run({ command: "true", timeoutSec: 5 });
    expect(env.calls.map((call) => call.options?.timeout)).toEqual([30, 5]);
  });

  test("an interactive call without a timeout has no cap", async () => {
    const { env, shell } = setup({ unattendedTimeoutMs: () => 120_000 });
    await shell.run({ command: "true" }, callAs(true));
    expect(env.calls[0]?.options?.timeout).toBeUndefined();
  });

  test("an unattended call without a timeout runs under the cap", async () => {
    const { env, shell } = setup({ unattendedTimeoutMs: () => 120_000 });
    await shell.run({ command: "true" }, callAs(false));
    expect(env.calls[0]?.options?.timeout).toBe(120);
  });

  test("an unattended call keeps a shorter requested timeout", async () => {
    const { env, shell } = setup({ unattendedTimeoutMs: () => 120_000 });
    await shell.run({ command: "true", timeoutSec: 5 }, callAs(false));
    expect(env.calls[0]?.options?.timeout).toBe(5);
  });

  test("an unattended call with a longer requested timeout is clamped to the cap", async () => {
    const { env, shell } = setup({ unattendedTimeoutMs: () => 120_000 });
    await shell.run({ command: "true", timeoutSec: 300 }, callAs(false));
    expect(env.calls[0]?.options?.timeout).toBe(120);
  });

  test("without the cap dep an unattended call is not capped", async () => {
    const { env, shell } = setup();
    await shell.run({ command: "true" }, callAs(false));
    await shell.run({ command: "true", timeoutSec: 300 }, callAs(false));
    expect(env.calls.map((call) => call.options?.timeout)).toEqual([undefined, 300]);
  });

  test("the timeout message reports the effective cap in seconds", async () => {
    const { env, shell } = setup({ unattendedTimeoutMs: () => 2_000 });
    env.reply({ error: { code: "timeout" } });
    const error = await rejection(shell.run({ command: "sleep 99" }, callAs(false)));
    expect(error.data.code).toBe("timeout");
    expect(error.data.message).toBe("Command timed out after 2 seconds");
    expect(env.calls[0]?.options?.timeout).toBe(2);
  });

  test("bash abort", async () => {
    const { env, shell } = setup();
    const controller = new AbortController();
    controller.abort();
    const early = await rejection(shell.run({ command: "true" }, { signal: controller.signal }));
    expect(early.data.code).toBe("aborted");
    expect(env.calls).toHaveLength(0);
    env.reply({ error: { code: "aborted" } });
    const late = await rejection(
      shell.run({ command: "sleep 9" }, { signal: new AbortController().signal }),
    );
    expect(late.data.code).toBe("aborted");
  });

  test("tail truncation and spill path", async () => {
    const { env, shell } = setup({ settings: shellSettings({ maxLines: 3 }) });
    env.reply({
      chunks: [{ text: "l1\nl2\nl3\n" }, { text: "l4\nl5\n" }],
      exitCode: 0,
      spillPath: "/tmp/xeon/spill-2",
    });
    const out = await shell.run({ command: "seq 5" });
    expect(out.output).toBe("l3\nl4\nl5\n");
    expect(out.truncated).toBe(true);
    expect(out.fullOutputPath).toBe("/tmp/xeon/spill-2");
    expect(env.calls[0]?.options?.spill).toEqual({ afterBytes: 51200, afterLines: 3 });
    // 모델 쪽 렌더링: 앞부분 생략 안내와 전체 출력 경로
    env.reply({
      chunks: [{ text: "l1\nl2\nl3\nl4\n" }],
      exitCode: 0,
      spillPath: "/tmp/xeon/spill-3",
    });
    const result = await callTool(WorkspaceShell, shell, "bash", { command: "seq 4" });
    expect(result.isError).toBe(false);
    expect(result.text).toBe("[앞부분 생략, 전체 출력: /tmp/xeon/spill-3]\nl2\nl3\nl4\n");
  });

  test("output the environment omitted is counted as dropped", async () => {
    const { env, shell } = setup({ settings: shellSettings({ maxLines: 3 }) });
    env.reply({
      chunks: [
        {
          text: "tail 1\ntail 2\ntail 3\n",
          skipped: { bytes: 4096, newlines: 100, endsWithNewline: true },
        },
      ],
      exitCode: 0,
    });
    const out = await shell.run({ command: "yes | head -100000" });
    expect(out.truncated).toBe(true);
    expect(out.output).toBe("tail 1\ntail 2\ntail 3\n");
  });

  test("cwd must be a directory inside the root", async () => {
    const { env, shell } = setup();
    env.mkdir("/work/sub");
    env.put("/work/file.txt", "");
    await shell.run({ command: "pwd", cwd: "sub" });
    expect(env.calls[0]?.options?.cwd).toBe("/work/sub");
    expect((await rejection(shell.run({ command: "pwd", cwd: ".." }))).data.code).toBe("denied");
    expect((await rejection(shell.run({ command: "pwd", cwd: "file.txt" }))).data.code).toBe(
      "invalid_input",
    );
    expect((await rejection(shell.run({ command: "pwd", cwd: "missing" }))).data.code).toBe(
      "not_found",
    );
  });

  test("secret references go to exec as references only", async () => {
    const { env, shell } = setup();
    const threadId = fixedIdFactory().next("thr");
    await shell.run(
      { command: "/usr/bin/gh api user", secretEnv: { GH_TOKEN: "secret://gh-token" } },
      {
        context: {
          threadId,
          toolCallId: "call_1",
          caller: { kind: "model", agent: "main" },
        },
      },
    );
    expect(env.calls[0]?.options?.secretEnv).toEqual({
      refs: { GH_TOKEN: "secret://gh-token" },
      ctx: {
        purpose: "bash:gh",
        actor: "agent",
        threadId,
        toolCallId: "call_1",
        projectId: null,
        approval: null,
      },
    });
    expect(
      (await rejection(shell.run({ command: "x", secretEnv: { A: "plain-value" } }))).data.code,
    ).toBe("invalid_input");
    // 값이 없는 호출에는 secretEnv가 실리지 않는다
    await shell.run({ command: "true", secretEnv: {} });
    expect(env.calls[1]?.options?.secretEnv).toBeUndefined();
  });

  test("the approval evidence in CallContext reaches the secret request (F request 13)", async () => {
    const { env, shell } = setup();
    const evidence = {
      approvalId: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      scope: "per-use",
      grantedAt: 10,
      expiresAt: null,
    } as const;
    await shell.run(
      { command: "/usr/bin/gh api user", secretEnv: { GH_TOKEN: "secret://gh-token" } },
      {
        context: {
          threadId: fixedIdFactory().next("thr"),
          toolCallId: "call_2",
          caller: { kind: "model", agent: "main" },
          approval: evidence,
        },
      },
    );
    expect(env.calls[0]?.options?.secretEnv?.ctx.approval).toEqual(evidence);
  });

  test("execution failures map to capability codes", async () => {
    const { env, shell } = setup();
    env.reply(
      { error: { code: "env_denied" } },
      { error: { code: "secret_unavailable" } },
      { error: { code: "spawn_error" } },
      { error: { code: "shell_unavailable" } },
      { error: { code: "sandbox_failed" } },
    );
    const codes: string[] = [];
    const details: unknown[] = [];
    for (let index = 0; index < 5; index++) {
      // oxlint-disable-next-line no-await-in-loop -- 응답 표를 차례로 소비한다 (eng.typescript.guide TY-22)
      const error = await rejection(shell.run({ command: "x" }));
      codes.push(error.data.code);
      details.push(error.data.detail);
    }
    expect(codes).toEqual(["denied", "denied", "internal", "unavailable", "internal"]);
    expect(details[0]).toEqual({ by: "exec", reason: "env_denied" });
    expect(details[1]).toEqual({ by: "secrets", reason: "secret_unavailable" });
    expect(details[4]).toEqual({ by: "sandbox", reason: "sandbox_failed" });
  });
});

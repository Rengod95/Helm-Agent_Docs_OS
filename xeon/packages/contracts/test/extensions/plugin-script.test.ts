import { describe, expect, test } from "bun:test";
import { err, ok } from "../../src/base/index.ts";
import {
  SCRIPT_LIMITS,
  type PluginScriptPort,
  type ScriptRunFailure,
  type ScriptRunRequest,
  type ScriptRunResult,
} from "../../src/extensions/index.ts";

// 설계 B(F.extensions.spec §3.1.4): 실행 상한, 실행 포트의 결과 모양, 거절 종류. 값으로 비교한다.

describe("script run limits (설계 B [제안])", () => {
  test("256 KiB of stdin, 64 KiB of each output, 10 s by default and 60 s at most", () => {
    expect(SCRIPT_LIMITS).toEqual({
      stdinBytes: 262144,
      outputBytes: 65536,
      timeoutDefaultMs: 10000,
      timeoutMaxMs: 60000,
    });
  });
});

/**
 * 포트 모양을 시험하는 대역. 선언에 없는 이름과 돌려 보기 요청은 거절하고, 나머지는 값을 돌려준다.
 * 실제 구현(엔진)은 X 층에 있다
 */
const stub: PluginScriptPort = {
  run: async (request: ScriptRunRequest) => {
    if (request.replay) return err({ kind: "replay_mode_denied" });
    if (request.name !== "lint") return err({ kind: "script_not_declared" });
    const value: ScriptRunResult = {
      exitCode: 0,
      signal: null,
      stdout: `lint ${request.stdin}`,
      stdoutTruncated: false,
      stderr: "",
      stderrTruncated: false,
      timedOut: false,
    };
    return ok(value);
  },
};

describe("PluginScriptPort returns a Result (설계 B [제안])", () => {
  test("a run that starts returns the value with every field kept", async () => {
    const result = await stub.run({
      registration: "acme-notes",
      name: "lint",
      stdin: "diff",
      replay: false,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        exitCode: 0,
        signal: null,
        stdout: "lint diff",
        stdoutTruncated: false,
        stderr: "",
        stderrTruncated: false,
        timedOut: false,
      },
    });
  });

  test("a refusal returns the failure kind and no value", async () => {
    expect(
      await stub.run({ registration: "acme-notes", name: "rm", stdin: "", replay: false }),
    ).toEqual({ ok: false, error: { kind: "script_not_declared" } });
    expect(
      await stub.run({ registration: "acme-notes", name: "lint", stdin: "", replay: true }),
    ).toEqual({ ok: false, error: { kind: "replay_mode_denied" } });
  });

  test("the spawn failures carry the reason of the isolation port", () => {
    const spawnFailed: ScriptRunFailure = { kind: "spawn_failed", code: "ENOENT", message: "bun" };
    const sandbox: ScriptRunFailure = { kind: "sandbox_unavailable", reason: "no seatbelt" };
    expect([spawnFailed, sandbox]).toEqual([
      { kind: "spawn_failed", code: "ENOENT", message: "bun" },
      { kind: "sandbox_unavailable", reason: "no seatbelt" },
    ]);
  });
});

describe("script run failure kinds (설계 B [제안])", () => {
  test("the failure kinds are exactly the eight of the design (the seven plus the denied card)", () => {
    // Record로 쓰면 빠지거나 더한 종류가 컴파일 오류가 된다
    const seen: Record<ScriptRunFailure["kind"], true> = {
      script_not_declared: true,
      script_outside_tree: true,
      script_missing: true,
      script_not_approved: true,
      replay_mode_denied: true,
      script_denied: true,
      spawn_failed: true,
      sandbox_unavailable: true,
    };
    expect(Object.keys(seen).toSorted()).toEqual([
      "replay_mode_denied",
      "sandbox_unavailable",
      "script_denied",
      "script_missing",
      "script_not_approved",
      "script_not_declared",
      "script_outside_tree",
      "spawn_failed",
    ]);
  });
});

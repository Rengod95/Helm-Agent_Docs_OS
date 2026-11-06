import { describe, expect, test } from "bun:test";
import { requestOsReauth, type OsReauthInvoke } from "../../src/views/os-reauth.ts";

/** 명령의 답을 흉내 낸다. 부른 명령 이름과 사유를 기록해 `os_reauth` 한 번만 불렸는지 본다 */
function replying(reply: () => Promise<unknown>): {
  readonly invoke: OsReauthInvoke;
  readonly calls: { command: string; reason: string }[];
} {
  const calls: { command: string; reason: string }[] = [];
  const invoke: OsReauthInvoke = (command, args) => {
    calls.push({ command, reason: args.reason });
    return reply();
  };
  return { invoke, calls };
}

/** 셸은 오류를 `{ kind }` 객체로 거절한다. 그 값을 그대로 던진다 */
function rejectingWith(reason: unknown): ReturnType<typeof replying> {
  return replying(async () => {
    throw reason;
  });
}

describe("requestOsReauth", () => {
  test("a verified reply becomes an os-auth grant with its time, after one os_reauth call", async () => {
    const fake = replying(async () => ({ verifiedAtMs: 1_792_800_000_123 }));
    expect(await requestOsReauth(fake.invoke, "Show secret value")).toEqual({
      ok: true,
      value: { method: "os-auth", verifiedAt: 1_792_800_000_123 },
    });
    expect(fake.calls).toEqual([{ command: "os_reauth", reason: "Show secret value" }]);
  });

  test("each error kind from the shell comes back as that kind", async () => {
    const results = await Promise.all([
      requestOsReauth(rejectingWith({ kind: "cancelled" }).invoke, "x"),
      requestOsReauth(rejectingWith({ kind: "denied" }).invoke, "x"),
      requestOsReauth(rejectingWith({ kind: "unavailable" }).invoke, "x"),
      requestOsReauth(rejectingWith({ kind: "failed" }).invoke, "x"),
    ]);
    expect(results).toEqual([
      { ok: false, error: { kind: "cancelled" } },
      { ok: false, error: { kind: "denied" } },
      { ok: false, error: { kind: "unavailable" } },
      { ok: false, error: { kind: "failed" } },
    ]);
  });

  test("a reply that is not a verified time gives failed", async () => {
    const replies: readonly unknown[] = [
      null,
      "ok",
      {},
      { verifiedAtMs: "1792800000123" },
      { verifiedAtMs: -1 },
      { verifiedAtMs: 1.5 },
    ];
    const results = await Promise.all(
      replies.map((reply) => requestOsReauth(replying(async () => reply).invoke, "x")),
    );
    expect(results).toEqual(replies.map(() => ({ ok: false, error: { kind: "failed" } })));
  });

  test("a rejected invoke without a known kind gives failed", async () => {
    expect(
      await requestOsReauth(rejectingWith(new Error("command not found")).invoke, "x"),
    ).toEqual({
      ok: false,
      error: { kind: "failed" },
    });
    expect(await requestOsReauth(rejectingWith("dialog_unavailable").invoke, "x")).toEqual({
      ok: false,
      error: { kind: "failed" },
    });
    expect(await requestOsReauth(rejectingWith({ kind: "mystery" }).invoke, "x")).toEqual({
      ok: false,
      error: { kind: "failed" },
    });
  });
});

import { describe, expect, test } from "bun:test";
import { nodeProcessRunner } from "../src/vault.ts";

// Node용 실행기: 종료 코드, stdout, stdin 전달, 없는 실행 파일, 취소를 값으로 확인한다. 진짜 보안 저장소는 건드리지 않는다.

const ENV = { PATH: "/usr/bin:/bin" };

function request(
  argv: readonly string[],
  extra: { stdin?: Uint8Array; signal?: AbortSignal } = {},
) {
  return {
    argv,
    env: ENV,
    timeoutMs: 10_000,
    signal: extra.signal ?? new AbortController().signal,
    ...(extra.stdin === undefined ? {} : { stdin: extra.stdin }),
  };
}

describe("nodeProcessRunner", () => {
  test("stdout and the exit code come back; stdin reaches the child", async () => {
    const out = await nodeProcessRunner(
      request(["/bin/sh", "-c", "cat; exit 3"], { stdin: new TextEncoder().encode("hello") }),
    );
    if (!out.ok) throw new Error(out.error.kind);
    expect(out.value.exitCode).toBe(3);
    expect(new TextDecoder().decode(out.value.stdout)).toBe("hello");
  });

  test("stderr is collected as text", async () => {
    const out = await nodeProcessRunner(request(["/bin/sh", "-c", "echo oops >&2"]));
    if (!out.ok) throw new Error(out.error.kind);
    expect(out.value).toMatchObject({ exitCode: 0, stderr: "oops\n" });
  });

  test("a missing executable is spawn_failed with its code", async () => {
    expect(await nodeProcessRunner(request(["/nonexistent/tool"]))).toEqual({
      ok: false,
      error: { kind: "spawn_failed", code: "ENOENT" },
    });
  });

  test("an aborted signal is cancelled before and during the run", async () => {
    const before = new AbortController();
    before.abort();
    expect(
      await nodeProcessRunner(request(["/bin/sh", "-c", "true"], { signal: before.signal })),
    ).toEqual({
      ok: false,
      error: { kind: "cancelled" },
    });
    const during = new AbortController();
    const pending = nodeProcessRunner(
      request(["/bin/sh", "-c", "sleep 5"], { signal: during.signal }),
    );
    during.abort();
    expect(await pending).toEqual({ ok: false, error: { kind: "cancelled" } });
  });
});

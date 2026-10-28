import { describe, expect, test } from "bun:test";
import { err } from "@xeon/contracts";
import { createRunCommand, createRunCommandSync } from "../src/proc.ts";

const posix = process.platform === "win32" ? test.skip : test;

describe("createRunCommand (실제 자식 프로세스)", () => {
  const run = createRunCommand();

  posix("stdout과 종료 코드를 돌려준다", async () => {
    const out = await run(["echo", "hello"], { signal: new AbortController().signal });
    expect(out).toEqual({ ok: true, value: { exitCode: 0, stdout: "hello\n" } });
    const failing = await run(["false"], { signal: new AbortController().signal });
    expect(failing.ok && failing.value.exitCode).toBe(1);
  });

  posix("stderr는 captureStderr를 줄 때만 돌려주고, 끝쪽 8 KiB만 남긴다", async () => {
    const signal = new AbortController().signal;
    const quiet = await run(["sh", "-c", "printf boom >&2; exit 0"], { signal });
    expect(quiet).toEqual({ ok: true, value: { exitCode: 0, stdout: "" } });
    const captured = await run(["sh", "-c", "printf boom >&2; exit 3"], {
      signal,
      captureStderr: true,
    });
    expect(captured).toEqual({ ok: true, value: { exitCode: 3, stdout: "", stderr: "boom" } });
    const flood = await run(
      ["sh", "-c", "head -c 20000 /dev/zero | tr '\\0' x >&2; printf END >&2"],
      { signal, captureStderr: true },
    );
    expect(flood.ok && flood.value.stderr).toBe(`${"x".repeat(8 * 1024 - 3)}END`);
  });

  posix("없는 실행 파일은 spawn_failed(ENOENT)", async () => {
    const out = await run(["/no/such/binary-xeon"], { signal: new AbortController().signal });
    expect(out).toEqual(err({ kind: "spawn_failed", code: "ENOENT" }));
  });

  posix("시간 초과는 timeout", async () => {
    const out = await run(["sleep", "5"], { signal: new AbortController().signal, timeoutMs: 100 });
    expect(out).toEqual(err({ kind: "timeout" }));
  });

  posix("이미 중단된 신호는 실행 없이 cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await run(["echo", "x"], { signal: controller.signal })).toEqual(
      err({ kind: "cancelled" }),
    );
  });

  posix("실행 중 중단하면 cancelled", async () => {
    const controller = new AbortController();
    const pending = run(["sleep", "5"], { signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual(err({ kind: "cancelled" }));
  });

  posix("부모의 비밀 환경 변수를 자식에게 넘기지 않는다", async () => {
    process.env["XEON_TEST_SECRET_VALUE"] = "do-not-leak";
    try {
      const out = await run(["env"], { signal: new AbortController().signal });
      expect(out.ok && out.value.stdout).not.toContain("do-not-leak");
      expect(out.ok && out.value.stdout).toContain("LC_ALL=C");
    } finally {
      Reflect.deleteProperty(process.env, "XEON_TEST_SECRET_VALUE");
    }
  });
});

describe("createRunCommandSync", () => {
  const runSync = createRunCommandSync();

  posix("동기 실행: stdout과 종료 코드", () => {
    expect(runSync(["echo", "sync"])).toEqual({
      ok: true,
      value: { exitCode: 0, stdout: "sync\n" },
    });
  });

  posix("없는 실행 파일은 spawn_failed", () => {
    const out = runSync(["/no/such/binary-xeon"]);
    expect(!out.ok && out.error.kind).toBe("spawn_failed");
  });
});

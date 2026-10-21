import { describe, expect, test } from "bun:test";
import type { ShellOutputInfo } from "@xeon/contracts/services";
import { fakeExec, memoryFs } from "../src/testing/index.ts";

const context = { abortSignal: undefined };

describe("fakeExec", () => {
  test("fakeExec replies from the table and records calls", async () => {
    const exec = fakeExec({
      "git status --porcelain": { exitCode: 0, stdout: " M a.ts\n", stderr: "warn\n" },
      false: { exitCode: 1 },
      boom: { error: "timeout" },
    });
    const chunks: [string, ShellOutputInfo["stream"]][] = [];
    const ok = await exec.exec(
      ["git", "status", "--porcelain"],
      {
        onOutput: (text, _scope, info) => chunks.push([text, info.stream]),
      },
      context,
    );
    expect(ok).toEqual({ ok: true, value: { exitCode: 0 } });
    expect(chunks).toEqual([
      [" M a.ts\n", "stdout"],
      ["warn\n", "stderr"],
    ]);

    expect(await exec.exec("false", undefined, context)).toEqual({
      ok: true,
      value: { exitCode: 1 },
    });
    const timeout = await exec.exec("boom", undefined, context);
    expect(!timeout.ok && timeout.error.code).toBe("timeout");

    const unknown = await exec.exec("nope", undefined, context);
    expect(!unknown.ok && unknown.error.code).toBe("spawn_error");

    expect(exec.calls.map((call) => call.command)).toEqual([
      ["git", "status", "--porcelain"],
      "false",
      "boom",
      "nope",
    ]);
  });

  test("fakeExec keeps only secret reference names in calls", async () => {
    const exec = fakeExec({ "gh api user": { exitCode: 0 } });
    await exec.exec(
      "gh api user",
      {
        secretEnv: {
          refs: { GH_TOKEN: "secret://gh" },
          ctx: {
            purpose: "bash:gh",
            actor: "agent",
            threadId: null,
            toolCallId: null,
            projectId: null,
            approval: null,
          },
        },
        onOutput: () => {},
      },
      context,
    );
    expect(exec.calls[0]?.options?.secretEnv?.refs).toEqual({ GH_TOKEN: "secret://gh" });
    expect(exec.calls[0]?.options).not.toHaveProperty("onOutput");
  });

  test("fakeExec unknown commands can exit 127 instead", async () => {
    const exec = fakeExec({}, { unknown: "exit127" });
    expect(await exec.exec("nope", undefined, context)).toEqual({
      ok: true,
      value: { exitCode: 127 },
    });
  });

  test("fakeExec honours an aborted scope", async () => {
    const exec = fakeExec({ x: { exitCode: 0 } });
    const controller = new AbortController();
    controller.abort();
    const result = await exec.exec("x", undefined, { abortSignal: controller.signal });
    expect(!result.ok && result.error.code).toBe("aborted");
  });

  test("fakeExec files are not_supported without fs and delegate with one", async () => {
    const bare = fakeExec({});
    const missing = await bare.readTextFile("a.txt", context);
    expect(!missing.ok && missing.error.code).toBe("not_supported");

    const fs = memoryFs({ files: { "/work/a.txt": "hello" }, cwd: "/work" });
    const exec = fakeExec({}, { fs });
    expect(await exec.readTextFile("a.txt", context)).toEqual({ ok: true, value: "hello" });
    expect(exec.cwd).toBe("/work");
  });

  test("fakeExec withCwd derives an env that shares the call log", async () => {
    const exec = fakeExec({ pwd: { exitCode: 0 } });
    const derived = exec.withCwd("/elsewhere");
    expect(derived.cwd).toBe("/elsewhere");
    await derived.exec("pwd", undefined, context);
    expect(exec.calls).toHaveLength(1);
    expect(exec.cwd).toBe("/");
    await derived.cleanup(context);
  });

  test("fakeExec does not run background commands", async () => {
    const result = await fakeExec({}).startBackground("sleep 1", undefined, context);
    expect(result.ok).toBe(false);
  });
});

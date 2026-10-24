import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type {
  BackgroundExecHandle,
  CancelScope,
  ExecService,
  SecretEnvRequest,
} from "@xeon/contracts/services";
import { createExecService, type ExecServiceOptions } from "../src/service.ts";
import { fakeSecrets, type FakeSecrets } from "./support/fake-secrets.ts";
import { hostPlatform } from "./support/platform.ts";
import { groupProcessCount, isAlive, pollUntil } from "./support/process.ts";

// L0.exec.plan EX-20, L0.exec.spec §3.9·§9 12: 기다리지 않는 실행. 실제 자식 프로세스로 확인한다.

const platform = hostPlatform();
const none: CancelScope = { abortSignal: undefined };
const dirs: string[] = [];
const handles: BackgroundExecHandle[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xeon-exec-bg-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.stop("force")));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function create(
  root: string,
  deps: { parentEnv?: Record<string, string | undefined>; secrets?: FakeSecrets } = {},
  overrides: Partial<ExecServiceOptions> = {},
): ExecService {
  return createExecService(
    {
      cwd: root,
      shellPath: "/bin/bash",
      defaultTimeoutMs: 0,
      outputSpillBytes: 0,
      envExtra: [],
      ...overrides,
    },
    {
      platform,
      secrets: deps.secrets,
      parentEnv: deps.parentEnv ?? { PATH: process.env.PATH, HOME: process.env.HOME },
    },
  );
}

async function start(
  service: ExecService,
  command: string | readonly string[],
  options?: Parameters<ExecService["startBackground"]>[1],
  context: CancelScope = none,
): Promise<BackgroundExecHandle> {
  const started = await service.startBackground(command, options, context);
  if (!started.ok) throw started.error;
  handles.push(started.value);
  return started.value;
}

const secretCtx: SecretEnvRequest["ctx"] = {
  purpose: "bash:gh",
  actor: "agent",
  threadId: null,
  toolCallId: "call-1",
  projectId: null,
  approval: null,
};

describe("startBackground", () => {
  test("returns before the command ends, with a pid and an exit that settles later", async () => {
    const service = create(tempDir());
    const output: string[] = [];
    const handle = await start(service, "echo started; sleep 0.2; echo done", {
      onOutput: (text, _context, info) => {
        output.push(`${info.stream}:${text}`);
      },
    });
    expect(handle.pid).toBeGreaterThan(0);
    expect(isAlive(handle.pid)).toBe(true);
    const exit = await handle.exited;
    expect(exit).toEqual({ code: 0, signal: null });
    expect(output.join("")).toContain("stdout:started");
    expect(output.join("")).toContain("done");
  });

  test("a non-zero exit code is reported through exited, not as an error", async () => {
    const handle = await start(create(tempDir()), "exit 3");
    expect(await handle.exited).toEqual({ code: 3, signal: null });
  });

  test("an argv array runs the program directly without a shell", async () => {
    const output: string[] = [];
    const handle = await start(create(tempDir()), ["printf", "%s", "$HOME `x` ;"], {
      onOutput: (text) => {
        output.push(text);
      },
    });
    await handle.exited;
    expect(output.join("")).toBe("$HOME `x` ;");
  });

  test("cwd option is resolved against the service cwd", async () => {
    const root = tempDir();
    const output: string[] = [];
    const handle = await start(create(root), "pwd -P", {
      cwd: ".",
      onOutput: (text) => {
        output.push(text);
      },
    });
    await handle.exited;
    expect(output.join("").trim()).toBe(root);
  });

  test("stop(graceful) ends a normal process and exited reports the signal", async () => {
    const handle = await start(create(tempDir()), "sleep 30");
    await handle.stop("graceful");
    const exit = await handle.exited;
    expect(exit.signal).toBe("SIGTERM");
  });

  test("a process group that ignores SIGTERM survives graceful and is gone after force", async () => {
    const handle = await start(create(tempDir()), [
      "sh",
      "-c",
      "trap '' TERM; sleep 30 & sleep 30; wait",
    ]);
    expect(handle.pid).toBeGreaterThan(0);
    // 자식 sleep이 뜰 때까지 기다린다
    expect(await pollUntil(() => groupProcessCount(handle.pid) >= 3, 100)).toBe(true);
    await handle.stop("graceful");
    expect(await pollUntil(() => groupProcessCount(handle.pid) === 0, 10)).toBe(false);
    await handle.stop("force");
    expect(await pollUntil(() => groupProcessCount(handle.pid) === 0, 50)).toBe(true);
    expect((await handle.exited).signal).toBe("SIGKILL");
  });

  test("stopping a process that already ended does nothing", async () => {
    const handle = await start(create(tempDir()), "true");
    await handle.exited;
    await handle.stop("graceful");
    await handle.stop("force");
    expect(await handle.exited).toEqual({ code: 0, signal: null });
  });

  test("an aborted signal force-stops the process", async () => {
    const controller = new AbortController();
    const handle = await start(create(tempDir()), "sleep 30", undefined, {
      abortSignal: controller.signal,
    });
    controller.abort();
    expect((await handle.exited).signal).toBe("SIGKILL");
  });

  test("an already aborted signal does not start anything", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await create(tempDir()).startBackground("sleep 30", undefined, {
      abortSignal: controller.signal,
    });
    expect(!result.ok && result.error.code).toBe("aborted");
  });

  test("the service cleanup ends the background processes it still owns", async () => {
    const service = create(tempDir());
    const first = await start(service, "sleep 30");
    const second = await start(service, ["sleep", "30"]);
    await service.cleanup(none);
    const exits = await Promise.all([first.exited, second.exited]);
    expect(exits.map((exit) => exit.signal)).toEqual(["SIGKILL", "SIGKILL"]);
    expect(isAlive(first.pid) || isAlive(second.pid)).toBe(false);
  });

  test("a throwing output callback stops forwarding but not the process", async () => {
    let calls = 0;
    const handle = await start(create(tempDir()), "echo one; sleep 0.1; echo two", {
      onOutput: () => {
        calls += 1;
        throw new Error("callback broke");
      },
    });
    expect(await handle.exited).toEqual({ code: 0, signal: null });
    expect(calls).toBe(1);
  });
});

describe("startBackground failures", () => {
  test("a missing program is spawn_error", async () => {
    const result = await create(tempDir()).startBackground(
      ["/nonexistent/program"],
      undefined,
      none,
    );
    expect(!result.ok && result.error.code).toBe("spawn_error");
  });

  test("an empty argv is spawn_error", async () => {
    const result = await create(tempDir()).startBackground([], undefined, none);
    expect(!result.ok && result.error.code).toBe("spawn_error");
  });

  test("a missing working directory is spawn_error", async () => {
    const result = await create(tempDir()).startBackground(
      "true",
      { cwd: "/nonexistent/dir" },
      none,
    );
    expect(!result.ok && result.error.code).toBe("spawn_error");
  });

  test("a denied env name is env_denied and nothing starts", async () => {
    const result = await create(tempDir()).startBackground(
      "true",
      { env: { MY_TOKEN: "x" } },
      none,
    );
    expect(!result.ok && result.error.code).toBe("env_denied");
  });

  test("no shell is a shell_unavailable error", async () => {
    const result = await create(tempDir(), {}, { shellPath: "/nonexistent/bash" }).startBackground(
      "true",
      undefined,
      none,
    );
    expect(!result.ok && result.error.code).toBe("shell_unavailable");
  });
});

describe("startBackground env", () => {
  const parentEnv = { PATH: process.env.PATH, HOME: "/home/u", GITHUB_TOKEN: "x", FOO: "1" };

  test("the child env is the allow list, never the parent env", async () => {
    const output: string[] = [];
    const handle = await start(create(tempDir(), { parentEnv }), "env", {
      onOutput: (text) => {
        output.push(text);
      },
    });
    await handle.exited;
    const names = output
      .join("")
      .split("\n")
      .map((line) => line.split("=")[0]);
    expect(names).toContain("PATH");
    expect(names).toContain("HOME");
    expect(names).not.toContain("GITHUB_TOKEN");
    expect(names).not.toContain("FOO");
  });

  test("secretEnv reaches the child and the lease is closed right after spawn", async () => {
    const secrets = fakeSecrets({ gh: "ghp_background_secret_value" });
    const output: string[] = [];
    const handle = await start(create(tempDir(), { secrets }), "printenv GH_TOKEN; sleep 0.3", {
      secretEnv: { refs: { GH_TOKEN: "secret://gh" }, ctx: secretCtx },
      onOutput: (text) => {
        output.push(text);
      },
    });
    // 프로세스는 아직 살아 있지만 lease는 이미 폐기됐다
    expect(isAlive(handle.pid)).toBe(true);
    expect(secrets.acquired()).toBe(1);
    expect(secrets.disposed()).toBe(1);
    await handle.exited;
    expect(output.join("")).toContain("ghp_background_secret_value");
  });

  test("an unavailable secret never starts the process", async () => {
    const secrets = fakeSecrets({}, { missing: ["gh"] });
    const result = await create(tempDir(), { secrets }).startBackground(
      "true",
      { secretEnv: { refs: { GH_TOKEN: "secret://gh" }, ctx: secretCtx } },
      none,
    );
    expect(!result.ok && result.error.code).toBe("secret_unavailable");
    expect(!result.ok && result.error.message).not.toContain("ghp_");
  });
});

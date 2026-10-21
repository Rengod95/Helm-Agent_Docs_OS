import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { ok, type Logger, type LogFields } from "@xeon/contracts";
import type {
  CancelScope,
  ExecService,
  SecretEnvRequest,
  Shell,
  ShellExecOptions,
  ShellExecResult,
} from "@xeon/contracts/services";
import { createExecService, type ExecServiceOptions } from "../src/service.ts";
import { fakeSecrets, type FakeSecrets } from "./support/fake-secrets.ts";
import { hostPlatform } from "./support/platform.ts";
import { isAlive, pollUntil } from "./support/process.ts";

const platform = hostPlatform();
const none: CancelScope = { abortSignal: undefined };
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xeon-exec-service-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function create(
  root: string,
  overrides: Partial<ExecServiceOptions> = {},
  deps: {
    parentEnv?: Record<string, string | undefined>;
    secrets?: FakeSecrets;
    logger?: Logger;
  } = {},
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
      ...(deps.logger === undefined ? {} : { logger: deps.logger }),
    },
  );
}

async function run(
  env: Pick<Shell, "exec">,
  command: string | readonly string[],
  options: ShellExecOptions = {},
): Promise<{ result: Awaited<ReturnType<Shell["exec"]>>; output: string }> {
  let output = "";
  const result = await env.exec(
    command,
    {
      ...options,
      onOutput: (text) => {
        output += text;
      },
    },
    none,
  );
  return { result, output };
}

function envNames(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.split("=")[0] ?? "")
    .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
}

const secretCtx: SecretEnvRequest["ctx"] = {
  purpose: "bash:gh",
  actor: "agent",
  threadId: null,
  toolCallId: "call-1",
  projectId: null,
  approval: null,
};

const SECRET_VALUE = "ghp_integration_secret_value_77";

describe("child env", () => {
  const parentEnv = {
    PATH: process.env.PATH,
    HOME: "/home/u",
    GITHUB_TOKEN: "x",
    SOPS_AGE_KEY: "y",
    OP_SESSION_z: "w",
    FOO: "1",
  };

  test("child env never equals parent env", async () => {
    const root = tempDir();
    const service = create(root, {}, { parentEnv });
    const { result, output } = await run(service, "env");
    expect(result.ok).toBe(true);
    const names = envNames(output);
    const allowed = new Set([
      "PATH",
      "HOME",
      "TERM",
      "NO_COLOR",
      "CI",
      "LANG",
      "PWD",
      "SHLVL",
      "_",
      "OLDPWD",
    ]);
    for (const name of names) expect(allowed.has(name)).toBe(true);
    expect(names).toContain("TERM");
    for (const denied of ["GITHUB_TOKEN", "SOPS_AGE_KEY", "OP_SESSION_z", "FOO"]) {
      expect(names).not.toContain(denied);
    }
  });

  test("allowlist extra opens only the listed name", async () => {
    const root = tempDir();
    const service = create(root, { envExtra: ["FOO"] }, { parentEnv });
    const { output } = await run(service, "env");
    const names = envNames(output);
    expect(names).toContain("FOO");
    for (const denied of ["GITHUB_TOKEN", "SOPS_AGE_KEY", "OP_SESSION_z"]) {
      expect(names).not.toContain(denied);
    }
  });

  test("child env drops secret provider variables", async () => {
    const root = tempDir();
    const providerVars: Record<string, string> = {
      SOPS_AGE_KEY_CMD: "cat key",
      SOPS_AGE_KEY_FILE: "/k",
      SOPS_AGE_KEY: "AGE-SECRET-KEY-1",
      AGE_X: "1",
      OP_SERVICE_ACCOUNT_TOKEN: "t",
      BWS_ACCESS_TOKEN: "t",
      BW_SESSION: "t",
      XEON_SECRET_X: "t",
    };
    const service = create(
      root,
      { envExtra: Object.keys(providerVars) },
      { parentEnv: { ...parentEnv, ...providerVars } },
    );
    const { output } = await run(service, "env");
    const names = envNames(output);
    for (const name of Object.keys(providerVars)) expect(names).not.toContain(name);
    expect(output).not.toContain("AGE-SECRET-KEY-1");
  });

  test("env request with a denied name fails before spawn", async () => {
    const root = tempDir();
    const marker = join(root, "spawned");
    const service = create(root, {}, { parentEnv });
    const result = await service.exec(
      `touch '${marker}'`,
      { env: { AWS_SECRET_ACCESS_KEY: "v" } },
      none,
    );
    expect(!result.ok && result.error.code).toBe("env_denied");
    expect(!result.ok && result.error.message).toContain("AWS_SECRET_ACCESS_KEY");
    expect(existsSync(marker)).toBe(false);
  });

  test("requested env reaches the child and inheritEnv false drops the parent names", async () => {
    const root = tempDir();
    const service = create(root, {}, { parentEnv });
    const requested = await run(service, "printf '%s' \"$MY_FLAG\"", { env: { MY_FLAG: "on" } });
    expect(requested.output).toBe("on");
    const bare = await run(service, "env", { inheritEnv: false, env: { ONLY: "1" } });
    const names = envNames(bare.output);
    expect(names).toContain("ONLY");
    expect(names).not.toContain("HOME");
  });
});

describe("defaults", () => {
  test("default spill applies when caller gives none", async () => {
    const root = tempDir();
    const service = create(root, { outputSpillBytes: 10 });
    const spilled = getValue(await service.exec("printf 12345678901234567890", undefined, none));
    expect(spilled.spillPath).toBeDefined();
    if (spilled.spillPath !== undefined) {
      expect(readFileSync(spilled.spillPath, "utf8")).toBe("12345678901234567890");
      rmSync(join(spilled.spillPath, ".."), { recursive: true, force: true });
    }
    const explicit = getValue(
      await service.exec(
        "printf 12345678901234567890",
        { spill: { afterBytes: 1000, afterLines: 1000 } },
        none,
      ),
    );
    expect(explicit.spillPath).toBeUndefined();

    const off = create(root, { outputSpillBytes: 0 });
    expect(
      getValue(await off.exec("printf 12345678901234567890", undefined, none)).spillPath,
    ).toBeUndefined();
  });

  test("default timeout applies only when the caller gives none", async () => {
    const root = tempDir();
    const service = create(root, { defaultTimeoutMs: 200 });
    const timedOut = await service.exec("sleep 5", undefined, none);
    expect(!timedOut.ok && timedOut.error.code).toBe("timeout");
    const explicit = await service.exec("sleep 0.3; echo done", { timeout: 5 }, none);
    expect(explicit.ok).toBe(true);
  });

  test("an already aborted scope never spawns", async () => {
    const root = tempDir();
    const marker = join(root, "spawned");
    const controller = new AbortController();
    controller.abort();
    const result = await create(root).exec(`touch '${marker}'`, undefined, {
      abortSignal: controller.signal,
    });
    expect(!result.ok && result.error.code).toBe("aborted");
    expect(existsSync(marker)).toBe(false);
  });
});

function getValue<T>(result: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!result.ok) throw result.error;
  return result.value;
}

describe("files", () => {
  test("service forwards file operations and withCwd shares the namespace", async () => {
    const root = tempDir();
    const service = create(root);
    expect((await service.writeFile("a/b.txt", "hi", none)).ok).toBe(true);
    expect(await service.readTextFile("a/b.txt", none)).toEqual({ ok: true, value: "hi" });
    const derived = service.withCwd(join(root, "a"));
    expect(derived.id).toBe(service.id);
    expect(await derived.readTextFile("b.txt", none)).toEqual({ ok: true, value: "hi" });
    const { output } = await run(derived, "pwd -P");
    expect(output.trim()).toBe(join(root, "a"));
    service.cwd = join(root, "a");
    expect(await service.readTextFile("b.txt", none)).toEqual({ ok: true, value: "hi" });
  });

  test("startBackground is not implemented before M2", async () => {
    const result = await create(tempDir()).startBackground("sleep 1", undefined, none);
    expect(!result.ok && result.error.code).toBe("unknown");
  });
});

describe("withCwd", () => {
  test("withCwd cleanup kills only its own commands", async () => {
    const root = tempDir();
    const service = create(root);
    const derived = service.withCwd(root);
    const ownPid = join(root, "own.pid");
    const derivedPid = join(root, "derived.pid");
    const controller = new AbortController();

    const own = service.exec(`echo $$ > '${ownPid}'; exec sleep 30`, undefined, {
      abortSignal: controller.signal,
    });
    const other = derived.exec(`echo $$ > '${derivedPid}'; exec sleep 30`, undefined, none);
    expect(await pollUntil(() => existsSync(ownPid) && existsSync(derivedPid), 200)).toBe(true);
    const ownId = Number.parseInt(readFileSync(ownPid, "utf8").trim(), 10);
    const derivedId = Number.parseInt(readFileSync(derivedPid, "utf8").trim(), 10);

    await derived.cleanup(none);
    expect((await other).ok).toBe(true);
    expect(await pollUntil(() => !isAlive(derivedId), 100)).toBe(true);
    expect(isAlive(ownId)).toBe(true);

    controller.abort();
    const aborted = await own;
    expect(!aborted.ok && aborted.error.code).toBe("aborted");
    expect(await pollUntil(() => !isAlive(ownId), 100)).toBe(true);
  });
});

function request(refs: SecretEnvRequest["refs"]): SecretEnvRequest {
  return { refs, ctx: secretCtx };
}

describe("secretEnv", () => {
  test("the child receives the secret and results hide it", async () => {
    const root = tempDir();
    const secrets = fakeSecrets({ gh: SECRET_VALUE });
    const lines: { event: string; fields: LogFields | undefined }[] = [];
    const logger: Logger = {
      debug: (event, fields) => void lines.push({ event, fields }),
      info: (event, fields) => void lines.push({ event, fields }),
      warn: (event, fields) => void lines.push({ event, fields }),
      error: (event, fields) => void lines.push({ event, fields }),
      child: () => logger,
    };
    const service = create(root, { outputSpillBytes: 1 }, { secrets, logger });
    const { result, output } = await run(service, "printenv GH_TOKEN > /dev/null", {
      secretEnv: request({ GH_TOKEN: "secret://gh" }),
    });
    expect(result.ok && result.value.exitCode).toBe(0);
    expect(output).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(result)).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(lines)).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(lines)).toContain("secret://gh");
    expect(secrets.calls[0]?.ctx.target).toEqual({
      kind: "command",
      argv0: "printenv",
      commandLine: "printenv GH_TOKEN > /dev/null",
    });
    expect(secrets.acquired()).toBe(1);
    expect(secrets.disposed()).toBe(1);
  });

  test("secretEnv names skip the deny list but plain requests do not", async () => {
    const root = tempDir();
    const secrets = fakeSecrets({ gh: SECRET_VALUE });
    const service = create(root, {}, { secrets });
    const { output } = await run(service, "printf '%s' \"${GH_TOKEN:+set}\"", {
      secretEnv: request({ GH_TOKEN: "secret://gh" }),
    });
    expect(output).toBe("set");
    const denied = await service.exec("true", { env: { GH_TOKEN: "x" } }, none);
    expect(!denied.ok && denied.error.code).toBe("env_denied");
  });

  test("secretEnv lease is disposed after use", async () => {
    const root = tempDir();
    const secrets = fakeSecrets({ gh: SECRET_VALUE });
    const service = create(root, {}, { secrets });
    const withSecret = { secretEnv: request({ GH_TOKEN: "secret://gh" }) };

    await run(service, "true", withSecret);
    await run(service, "exit 3", withSecret);
    const timedOut = await service.exec("sleep 5", { ...withSecret, timeout: 0.2 }, none);
    expect(!timedOut.ok && timedOut.error.code).toBe("timeout");
    const controller = new AbortController();
    const cancelled = service.exec("sleep 5", withSecret, { abortSignal: controller.signal });
    expect(await pollUntil(() => secrets.acquired() === 4, 100)).toBe(true);
    controller.abort();
    const aborted = await cancelled;
    expect(!aborted.ok && aborted.error.code).toBe("aborted");

    expect(secrets.acquired()).toBe(4);
    expect(secrets.disposed()).toBe(secrets.acquired());
  });

  test("secretEnv failure keeps the child from spawning", async () => {
    const root = tempDir();
    const marker = join(root, "spawned");
    const secrets = fakeSecrets({ gh: SECRET_VALUE, b: "other_value_12345" }, { missing: ["b"] });
    const service = create(root, {}, { secrets });
    const result = await service.exec(
      `touch '${marker}'`,
      { secretEnv: request({ A: "secret://gh", B: "secret://b" }) },
      none,
    );
    expect(!result.ok && result.error.code).toBe("secret_unavailable");
    expect(!result.ok && result.error.message).not.toContain(SECRET_VALUE);
    expect(existsSync(marker)).toBe(false);
    expect(secrets.disposed()).toBe(secrets.acquired());
  });

  test("missing secrets service rejects secretEnv", async () => {
    const root = tempDir();
    const marker = join(root, "spawned");
    const service = create(root);
    const result = await service.exec(
      `touch '${marker}'`,
      { secretEnv: request({ A: "secret://gh" }) },
      none,
    );
    expect(!result.ok && result.error.code).toBe("secret_unavailable");
    expect(existsSync(marker)).toBe(false);
  });

  test("secret value never appears in results or spill files", async () => {
    const root = tempDir();
    const secrets = fakeSecrets({ gh: SECRET_VALUE });
    const service = create(root, { outputSpillBytes: 1 }, { secrets });
    const before = new Set(readdirSync(tmpdir()));
    const { result, output } = await run(service, "printenv GH_TOKEN", {
      secretEnv: request({ GH_TOKEN: "secret://gh" }),
      spill: { afterBytes: 1, afterLines: 1 },
    });
    // secretEnv가 있으면 기본 spill도, 호출자가 준 spill도 꺼져 값이 디스크에 남지 않는다(L0.exec.plan R-9)
    expect(result.ok && result.value.spillPath).toBeUndefined();
    expect(output).toContain(SECRET_VALUE);
    expect(JSON.stringify(result)).not.toContain(SECRET_VALUE);
    for (const name of readdirSync(tmpdir()).filter((entry) => !before.has(entry))) {
      if (!name.startsWith("tmp-")) continue;
      for (const file of readdirSync(join(tmpdir(), name))) {
        expect(file.startsWith("pi-output-")).toBe(false);
      }
    }
  });
});

/** 샌드박스 데코레이터를 흉내 낸다: 문자열을 argv로 바꾸고 env를 더하고 결과에 sandbox 필드를 붙인다 */
function decorate(shell: Shell, seen: ShellExecOptions[]): Shell {
  return {
    async exec(command, options, context) {
      seen.push(options ?? {});
      const argv = typeof command === "string" ? ["/bin/bash", "-c", command] : command;
      const result = await shell.exec(
        argv,
        { ...options, env: { ...options?.env, DECORATED: "1" } },
        context,
      );
      if (!result.ok) return result;
      const decorated: ShellExecResult = {
        ...result.value,
        sandbox: { sandboxed: true, level: "srt", violations: [], violationsTruncated: false },
      };
      return ok(decorated);
    },
    cleanup: (context) => shell.cleanup(context),
  };
}

describe("decorated shell", () => {
  test("decorated shell forwards options", async () => {
    const root = tempDir();
    const secrets = fakeSecrets({ gh: SECRET_VALUE });
    const service = create(root, {}, { secrets });
    const seen: ShellExecOptions[] = [];
    const shell = decorate(service, seen);
    const chunks: string[] = [];

    const secretRun = await shell.exec(
      'test -n "$GH_TOKEN" && printf \'%s\' "$DECORATED"',
      {
        secretEnv: { refs: { GH_TOKEN: "secret://gh" }, ctx: secretCtx },
        window: { maxBytes: 100, maxLines: 10, minIntervalMs: 0, bytesPerSecond: 1_000_000 },
        onOutput: (text) => void chunks.push(text),
      },
      none,
    );
    expect(secretRun.ok && secretRun.value.exitCode).toBe(0);
    expect(secretRun.ok && secretRun.value.sandbox?.level).toBe("srt");
    expect(chunks.join("")).toBe("1");
    expect(seen[0]?.window?.maxBytes).toBe(100);
    expect(secrets.acquired()).toBe(1);
    expect(secrets.disposed()).toBe(1);

    const spilled = await shell.exec(
      "printf 12345678901234567890",
      { spill: { afterBytes: 10, afterLines: 10 } },
      none,
    );
    expect(spilled.ok && spilled.value.spillPath).toBeDefined();
    expect(spilled.ok && spilled.value.sandbox?.sandboxed).toBe(true);
    if (spilled.ok && spilled.value.spillPath !== undefined) {
      rmSync(join(spilled.value.spillPath, ".."), { recursive: true, force: true });
    }

    const argv = await shell.exec(["/bin/echo", "a b"], undefined, none);
    expect(argv.ok && argv.value.exitCode).toBe(0);
  });
});

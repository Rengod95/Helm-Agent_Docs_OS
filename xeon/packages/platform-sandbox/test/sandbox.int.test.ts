import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { repeatAsync } from "@xeon/contracts";
import {
  ENVIRONMENT_EXIT_CODE,
  missingMessage,
  readSandboxEnvironment,
  runCollected,
  shouldFailOnMissing,
  startRealSandbox,
  VAULT_SECRET,
  type RealSandbox,
} from "./support/real-sandbox.ts";

// M1 종료 조건 "샌드박스 bash가 작업 폴더 밖 쓰기를 거부한다"를 실제 srt와 OS 격리(bubblewrap, Seatbelt)로 확인한다
// (L0.sandbox.plan SB-18, 마감 G4-01). 각 거부 시험은 같은 명령을 감싸지 않은 Shell로 돌려 "격리가 없으면 성공한다"는 대조를 함께 둔다.
//
// 필수 바이너리(Linux: bwrap, socat, rg / macOS: rg)가 없을 때:
//   - XEON_REQUIRE_SANDBOX=1 이거나 CI이면 종료 코드 2(환경 문제)로 끝난다. 조용히 건너뛰지 않는다.
//   - 그 밖의 기기에서는 건너뛰고 stderr에 이유를 한 줄 남긴다.

const environment = readSandboxEnvironment();
const strict = shouldFailOnMissing(Bun.env);

if (environment.supported && environment.missing.length > 0 && strict) {
  process.stderr.write(`${missingMessage(environment)}\n`);
  process.exit(ENVIRONMENT_EXIT_CODE);
}
if (environment.supported && environment.missing.length > 0) {
  process.stderr.write(`SKIPPED ${missingMessage(environment)}\n`);
}
if (!environment.supported) {
  process.stderr.write(`SKIPPED sandbox.int: ${environment.unsupportedReason ?? "unsupported"}\n`);
}

const runnable = environment.supported && environment.missing.length === 0;
const suite = runnable ? describe : describe.skip;

suite("real sandbox (srt)", () => {
  let box: RealSandbox;
  let outside: string;
  let policyFor: () => ReturnType<RealSandbox["service"]["defaultPolicy"]>;

  beforeAll(async () => {
    box = await startRealSandbox();
    outside = join(box.dirs.root, "outside");
    mkdirSync(outside, { recursive: true });
    policyFor = () =>
      box.service.defaultPolicy({ workspaceRoots: [box.dirs.workspace], tempDir: box.dirs.tmp });
  });

  afterAll(async () => {
    await box.service.dispose();
    rmSync(box.dirs.root, { recursive: true, force: true });
  });

  test("the sandbox is available and uses srt", () => {
    const status = box.service.status();
    expect(status.available).toBe(true);
    expect(status.level).toBe("srt");
    expect(status.reason).toBeUndefined();
  });

  test("a write inside the workspace succeeds", async () => {
    const shell = box.service.wrapShell(box.shell, policyFor());
    const target = join(box.dirs.workspace, "inside.txt");
    const ran = await runCollected(shell, `echo hello > ${target}`, { cwd: box.dirs.workspace });
    expect(ran.exitCode).toBe(0);
    expect(readFileSync(target, "utf8")).toBe("hello\n");
    expect(ran.raw.ok && ran.raw.value.sandbox?.sandboxed).toBe(true);
  });

  test("a write outside the write roots is refused by the OS, while the same command unsandboxed succeeds", async () => {
    const target = join(outside, "denied.txt");
    const command = `echo escaped > ${target}`;

    // 대조: 감싸지 않으면 성공한다. 이 대조가 실패하면 아래 거부는 샌드박스 때문이라고 말할 수 없다
    const plain = await runCollected(box.shell, command);
    expect(plain.exitCode).toBe(0);
    expect(readFileSync(target, "utf8")).toBe("escaped\n");
    rmSync(target);

    const wrapped = await runCollected(box.service.wrapShell(box.shell, policyFor()), command, {
      cwd: box.dirs.workspace,
    });
    expect(wrapped.exitCode).not.toBe(0);
    expect(existsSync(target)).toBe(false);
    expect(wrapped.raw.ok && wrapped.raw.value.sandbox?.sandboxed).toBe(true);
  });

  test("a write to a protected path inside the writable workspace (.git/hooks) is refused", async () => {
    const hooks = join(box.dirs.workspace, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    const target = join(hooks, "pre-commit");
    const command = `echo '#!/bin/sh' > ${target}`;
    const plain = await runCollected(box.shell, command);
    expect(plain.exitCode).toBe(0);
    rmSync(target);

    const wrapped = await runCollected(box.service.wrapShell(box.shell, policyFor()), command, {
      cwd: box.dirs.workspace,
    });
    expect(wrapped.exitCode).not.toBe(0);
    expect(existsSync(target)).toBe(false);
  });

  test("a protected data file cannot be read, while the same command unsandboxed reads it", async () => {
    const canaryDir = join(box.dirs.data, "selftest");
    mkdirSync(canaryDir, { recursive: true });
    const canary = join(canaryDir, "canary");
    const secret = "canary-value-for-sandbox-test";
    writeFileSync(canary, secret);

    const plain = await runCollected(box.shell, `cat ${canary}`);
    expect(plain.output).toBe(secret);

    const wrapped = await runCollected(
      box.service.wrapShell(box.shell, policyFor()),
      `cat ${canary}`,
      { cwd: box.dirs.workspace },
    );
    expect(wrapped.exitCode).not.toBe(0);
    expect(wrapped.output).not.toContain(secret);
  });

  test("empty caller deny lists keep the protection, and protectedPaths.extra denies reads", async () => {
    const hooks = join(box.dirs.workspace, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    const hook = join(hooks, "post-commit");
    const vaultFile = join(box.vault, "secret.txt");
    const bare = { ...policyFor(), readDeny: [], writeDeny: [] };
    const shell = box.service.wrapShell(box.shell, bare);

    const write = await runCollected(shell, `echo x > ${hook}`, { cwd: box.dirs.workspace });
    expect(write.exitCode).not.toBe(0);
    expect(existsSync(hook)).toBe(false);

    const plain = await runCollected(box.shell, `cat ${vaultFile}`);
    expect(plain.output).toBe(VAULT_SECRET);
    const read = await runCollected(shell, `cat ${vaultFile}`, { cwd: box.dirs.workspace });
    expect(read.exitCode).not.toBe(0);
    expect(read.output).not.toContain(VAULT_SECRET);
  });

  test("a network connection is refused, while the same command unsandboxed connects", async () => {
    const connections: string[] = [];
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          connections.push("open");
          socket.end();
        },
        data() {},
      },
    });
    try {
      const command = `exec 3<>/dev/tcp/127.0.0.1/${String(listener.port)}`;
      const plain = await runCollected(box.shell, command);
      expect(plain.exitCode).toBe(0);
      await waitForConnections(connections, 1);
      expect(connections).toEqual(["open"]);

      const wrapped = await runCollected(box.service.wrapShell(box.shell, policyFor()), command, {
        cwd: box.dirs.workspace,
      });
      expect(wrapped.exitCode).not.toBe(0);
      // 거부된 연결은 서버에 닿지 않았다
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(connections).toEqual(["open"]);
    } finally {
      listener.stop(true);
    }
  });

  test("the built-in self test passes all six items against the real sandbox", async () => {
    const report = await box.service.selfTest(box.shell, { abortSignal: undefined });
    expect(report.items.filter((item) => !item.passed)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(box.service.status().lastSelfTest?.passed).toBe(true);
  });
});

async function waitForConnections(seen: readonly string[], count: number): Promise<void> {
  let tries = 0;
  await repeatAsync<void>(async () => {
    tries += 1;
    if (seen.length >= count || tries > 100) return { value: undefined };
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    return undefined;
  });
}

import { expect, test } from "bun:test";
import { ok, type LogFields, type Logger } from "@xeon/contracts";
import {
  ExecPortKey,
  OsPortKey,
  SandboxServiceName,
  SecretServiceName,
  type ExecService,
  type OsService,
  type SecretService,
  type SelfTestItemId,
  type SelfTestReport,
} from "@xeon/contracts/services";
import type { PlatformContext } from "@xeon/ext-host";
import type {
  SandboxServiceHandle,
  SandboxSettings,
  SelfTestRunError,
  SelfTestSchedule,
} from "@xeon/platform-sandbox";
import { sandboxPlatform } from "../../src/assembly/platform.ts";
import { partial } from "../fixtures/unsafe.ts";

// 샌드박스 자가 시험은 만들어 두기만 하고 부르는 곳이 없었다(M2 마감 G1-12). 조립 루트가 서비스를 올릴 때 한 번 시작하고,
// 서비스를 닫을 때 멈춘다.

interface LogLine {
  readonly level: "info" | "warn" | "error";
  readonly event: string;
  readonly fields: LogFields | undefined;
}

function recordingLogger(lines: LogLine[]): Logger {
  const logger: Logger = {
    debug: () => undefined,
    info: (event, fields) => {
      lines.push({ level: "info", event, fields });
    },
    warn: (event, fields) => {
      lines.push({ level: "warn", event, fields });
    },
    error: (event, fields) => {
      lines.push({ level: "error", event, fields });
    },
    child: () => logger,
  };
  return logger;
}

const EXEC: ExecService = partial<ExecService>({});
const SECRETS: SecretService = partial<SecretService>({});

function reportOf(failed: readonly SelfTestItemId[]): SelfTestReport {
  return {
    at: 1,
    durationMs: 7,
    passed: failed.length === 0,
    items: failed.map((id) => ({ id, passed: false })),
  };
}

interface Registered {
  readonly lines: LogLine[];
  readonly provided: Map<string, unknown>;
  readonly disposers: (() => void | Promise<void>)[];
  readonly started: unknown[];
  readonly disposed: { count: number };
  readonly handle: SandboxServiceHandle;
  /** 첫 시험 결과를 받아 로그를 남기는 약속이 끝나기를 기다린다 */
  settled(): Promise<void>;
}

async function register(
  first: { ok: true; value: SelfTestReport } | { ok: false; error: SelfTestRunError },
): Promise<Registered> {
  const lines: LogLine[] = [];
  const provided = new Map<string, unknown>();
  const disposers: (() => void | Promise<void>)[] = [];
  const started: unknown[] = [];
  const disposed = { count: 0 };
  const ports = new Map<string, unknown>([
    [OsPortKey.name, partial<OsService>({ logger: () => recordingLogger(lines) })],
    [SecretServiceName, SECRETS],
    [ExecPortKey.name, EXEC],
  ]);
  const ctx = partial<PlatformContext>({
    providePort: partial<PlatformContext["providePort"]>(
      (key: { readonly name: string }, impl: unknown) => {
        provided.set(key.name, impl);
      },
    ),
    port: partial<PlatformContext["port"]>((key: { readonly name: string }) => ports.get(key.name)),
    onDispose: (fn) => {
      disposers.push(fn);
    },
  });
  const schedule: SelfTestSchedule = { first: Promise.resolve(first), stop: () => undefined };
  const handle = partial<SandboxServiceHandle>({
    startSelfTests: (shell) => {
      started.push(shell);
      return schedule;
    },
    dispose: () => {
      disposed.count += 1;
      return Promise.resolve();
    },
  });
  const module = sandboxPlatform(
    () => partial<SandboxSettings>({}),
    new AbortController().signal,
    () => Promise.resolve(handle),
  );
  await module.setup(ctx);
  return {
    lines,
    provided,
    disposers,
    started,
    disposed,
    handle,
    settled: async () => {
      await schedule.first;
      // 결과를 로그로 옮기는 then 한 단계가 끝나도록 한 번 더 양보한다
      await Promise.resolve();
    },
  };
}

test("the sandbox self test is started once with the exec service when the service is registered", async () => {
  const registered = await register(ok(reportOf([])));
  expect(registered.started).toHaveLength(1);
  expect(registered.started[0]).toBe(EXEC);
  expect(registered.provided.get(SandboxServiceName)).toBe(registered.handle);
});

test("closing the engine disposes the sandbox service once, which stops the self test loop", async () => {
  const registered = await register(ok(reportOf([])));
  expect(registered.disposers).toHaveLength(1);
  await registered.disposers[0]?.();
  expect(registered.disposed.count).toBe(1);
});

test("a failing self test is logged as a warning that names the failed items and no output", async () => {
  const registered = await register(ok(reportOf(["xeon_data_write_denied", "network_denied"])));
  await registered.settled();
  expect(registered.lines.filter((line) => line.event === "sandbox.self_test")).toEqual([
    {
      level: "warn",
      event: "sandbox.self_test",
      fields: {
        passed: false,
        failed: ["xeon_data_write_denied", "network_denied"],
        durationMs: 7,
      },
    },
  ]);
});

test("a passing self test is an info line, and a crashed self test leaves no verdict line", async () => {
  const passing = await register(ok(reportOf([])));
  await passing.settled();
  expect(passing.lines.filter((line) => line.event === "sandbox.self_test")).toEqual([
    { level: "info", event: "sandbox.self_test", fields: { passed: true, durationMs: 7 } },
  ]);
  const crashed = await register({ ok: false, error: { kind: "crashed" } });
  await crashed.settled();
  expect(crashed.lines.filter((line) => line.event === "sandbox.self_test")).toEqual([]);
});

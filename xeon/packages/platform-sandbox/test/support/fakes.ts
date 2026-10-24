import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type Logger, type LogFields, type Result } from "@xeon/contracts";
import {
  ExecutionError,
  type BinaryError,
  type BinaryName,
  type CancelScope,
  type OsDirs,
  type OsService,
  type ResolvedBinary,
  type SecretEnvRequest,
  type SelfTestItemId,
  type Shell,
  type ShellExecOptions,
  type ShellExecResult,
} from "@xeon/contracts/services";
import type { PlatformInput } from "../../src/select.ts";
import type { SandboxSettings } from "../../src/settings.ts";
import type {
  SrtConfig,
  SrtDependencyReport,
  SrtPort,
  SrtWrapInput,
  SrtWrapOutput,
} from "../../src/srt.ts";
import { manualClock, seededRandom } from "./clock.ts";

export const NO_CANCEL: CancelScope = { abortSignal: undefined };

// ── 임시 디렉터리 ────────────────────────────────────────────────────────

export interface TestDirs extends OsDirs {
  readonly root: string;
  readonly workspace: string;
}

/** 실제 임시 디렉터리 아래에 home, data, config, tmp, workspace를 만든다. 경로는 모두 realpath다 */
export function makeTestDirs(): TestDirs {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "xeon-sandbox-test-")));
  const dirs = {
    root,
    home: join(root, "home"),
    data: join(root, "data"),
    config: join(root, "config"),
    cache: join(root, "cache"),
    state: join(root, "state"),
    runtime: join(root, "run"),
    resource: join(root, "resource"),
    tmp: join(root, "tmp"),
    workspace: join(root, "workspace"),
  };
  for (const [key, dir] of Object.entries(dirs)) {
    if (key !== "root") mkdirSync(dir, { recursive: true });
  }
  return dirs;
}

// ── 로거 ─────────────────────────────────────────────────────────────────

interface LogEntry {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly fields: LogFields;
}

export interface MemoryLogger extends Logger {
  readonly entries: readonly LogEntry[];
}

export function memoryLogger(): MemoryLogger {
  const entries: LogEntry[] = [];
  const make = (base: LogFields): MemoryLogger => {
    const write =
      (level: LogEntry["level"]) =>
      (event: string, fields?: LogFields): void => {
        entries.push({ level, event, fields: { ...base, ...fields } });
      };
    return {
      entries,
      debug: write("debug"),
      info: write("info"),
      warn: write("warn"),
      error: write("error"),
      child: (fields) => make({ ...base, ...fields }),
    };
  };
  return make({});
}

// ── os ───────────────────────────────────────────────────────────────────

export type FakeOs = Pick<OsService, "dirs" | "time" | "logger" | "resolveBinary"> & {
  readonly log: MemoryLogger;
};

/** missing에 든 이름은 not_found로, 나머지는 /usr/bin/<이름>으로 찾는다 */
export function fakeOs(dirs: OsDirs, missing: readonly BinaryName[] = []): FakeOs {
  const log = memoryLogger();
  const clock = manualClock();
  return {
    log,
    dirs,
    time: {
      clock,
      scheduler: { setTimeout: () => 0, clearTimeout: () => undefined },
      random: seededRandom(7),
    },
    logger: (component) => log.child({ component }),
    resolveBinary: (name): Promise<Result<ResolvedBinary, BinaryError>> =>
      Promise.resolve(
        missing.includes(name)
          ? err({ kind: "not_found", name, searched: [], hint: "" })
          : ok({ name, path: `/usr/bin/${name}`, version: "9.9.9", source: "system" }),
      ),
  };
}

export function linuxPlatform(overrides: Partial<PlatformInput> = {}): PlatformInput {
  return {
    platform: "linux",
    arch: "x64",
    env: {},
    procVersion: "Linux version 6.1.0 (gcc)",
    ...overrides,
  };
}

export function darwinPlatform(): PlatformInput {
  return { platform: "darwin", arch: "arm64", env: {}, procVersion: undefined };
}

export function settingsOf(overrides: Partial<SandboxSettings> = {}): SandboxSettings {
  return {
    enabled: true,
    onUnavailable: "disable_execute",
    protectedPathsExtra: [],
    writeRootsExtra: [],
    escapeRetry: false,
    selfTestIntervalMin: 60,
    ...overrides,
  };
}

// ── srt 포트 ─────────────────────────────────────────────────────────────

export interface FakeSrtOptions {
  readonly supported?: boolean;
  readonly dependencyErrors?: readonly string[];
  readonly initializeError?: Error;
  readonly wrapError?: Error;
  /** getViolationLines가 돌려줄 줄 */
  readonly violationLines?: readonly string[];
  /** wrap이 돌려줄 env */
  readonly wrapEnv?: Readonly<Record<string, string | undefined>>;
  /** true이면 wrap이 ["bash", "-c", <원래 명령>]을 돌려준다. 아니면 앞에 WRAPPED:를 붙인다 */
  readonly passthrough?: boolean;
  readonly validateIssues?: readonly string[];
  readonly globWarnings?: readonly string[];
}

export interface FakeSrt extends SrtPort {
  readonly initializeCalls: { config: SrtConfig; enableLogMonitor: boolean }[];
  readonly wrapCalls: SrtWrapInput[];
  readonly validated: unknown[];
  cleanupCalls: number;
  resetCalls: number;
}

export function fakeSrt(options: FakeSrtOptions = {}): FakeSrt {
  const fake: FakeSrt = {
    initializeCalls: [],
    wrapCalls: [],
    validated: [],
    cleanupCalls: 0,
    resetCalls: 0,
    isSupportedPlatform: () => options.supported ?? true,
    checkDependencies: (): SrtDependencyReport => ({
      errors: options.dependencyErrors ?? [],
      warnings: [],
    }),
    initialize: (config, enableLogMonitor) => {
      fake.initializeCalls.push({ config, enableLogMonitor });
      return options.initializeError === undefined
        ? Promise.resolve()
        : Promise.reject(options.initializeError);
    },
    wrapWithSandboxArgv: (input): Promise<SrtWrapOutput> => {
      fake.wrapCalls.push(input);
      if (options.wrapError !== undefined) return Promise.reject(options.wrapError);
      const argv =
        options.passthrough === true
          ? ["bash", "-c", input.command]
          : ["bash", "-c", `WRAPPED:${input.command}`];
      return Promise.resolve({ argv, env: options.wrapEnv ?? {} });
    },
    getViolationLines: () => options.violationLines ?? [],
    cleanupAfterCommand: () => {
      fake.cleanupCalls += 1;
    },
    reset: () => {
      fake.resetCalls += 1;
      return Promise.resolve();
    },
    validateConfig: (config) => {
      fake.validated.push(config);
      return options.validateIssues ?? [];
    },
    getLinuxGlobPatternWarnings: () => options.globWarnings ?? [],
  };
  return fake;
}

// ── Shell ────────────────────────────────────────────────────────────────

interface ExecCall {
  readonly command: string | readonly string[];
  readonly options: ShellExecOptions | undefined;
  readonly context: CancelScope;
}

export interface RecordingShell extends Shell {
  readonly calls: ExecCall[];
  cleanupCalls: number;
}

export type ShellHandler = (
  command: string | readonly string[],
  options: ShellExecOptions | undefined,
) => Result<ShellExecResult, ExecutionError>;

/** 호출을 기록하고 handler(기본: 종료 코드 0)의 결과를 돌려주는 Shell */
export function recordingShell(handler?: ShellHandler): RecordingShell {
  const shell: RecordingShell = {
    calls: [],
    cleanupCalls: 0,
    exec: (command, options, context) => {
      shell.calls.push({ command, options, context });
      return Promise.resolve(
        handler === undefined ? ok({ exitCode: 0 }) : handler(command, options),
      );
    },
    cleanup: () => {
      shell.cleanupCalls += 1;
      return Promise.resolve();
    },
  };
  return shell;
}

export function execFailure(code: ExecutionError["code"]): Result<ShellExecResult, ExecutionError> {
  return err(new ExecutionError(code, code));
}

function touch(path: string): void {
  writeFileSync(path, "");
}

/**
 * 자가 시험 6항목이 기대대로 거부·허용되는 것처럼 동작하는 Shell. fail에 든 항목은 기대와 다르게 동작한다.
 * 명령 텍스트(argv를 공백으로 이은 것)로 시도를 알아본다. 감싸기를 거친 ["bash", "-c", "<명령>"]도 같은 텍스트가 된다.
 */
export function selfTestShell(fail: ReadonlySet<SelfTestItemId> = new Set()): RecordingShell {
  return recordingShell((command, options) => {
    const text = typeof command === "string" ? command : command.join(" ");
    const output = (text: string): void => {
      options?.onOutput?.(text, { abortSignal: undefined }, { stream: "stdout" });
    };
    const cat = /\bcat (\S*canary)\b/.exec(text);
    if (cat?.[1] !== undefined) {
      if (fail.has("protected_read_denied")) {
        output(readFileSync(cat[1], "utf8"));
        return ok({ exitCode: 0 });
      }
      return ok({ exitCode: 1 });
    }
    if (text.includes("/dev/tcp/")) return ok({ exitCode: fail.has("network_denied") ? 0 : 1 });
    if (/(^|\s)env$/.test(text)) {
      output(
        fail.has("env_allowlist")
          ? "PATH=/usr/bin\nANTHROPIC_API_KEY=value-that-must-not-be-reported\n"
          : "PATH=/usr/bin\nHOME=/home/x\n",
      );
      return ok({ exitCode: 0 });
    }
    const touched = /\btouch (\S+)/.exec(text);
    if (touched?.[1] !== undefined) {
      const path = touched[1];
      if (path.includes("/selftest/")) {
        if (fail.has("xeon_data_write_denied")) {
          touch(path);
          return ok({ exitCode: 0 });
        }
        return ok({ exitCode: 1 });
      }
      if (path.includes("/.git/hooks/")) {
        if (fail.has("git_hooks_write_denied")) {
          touch(path);
          return ok({ exitCode: 0 });
        }
        return ok({ exitCode: 1 });
      }
      if (fail.has("workspace_write_allowed")) return ok({ exitCode: 1 });
      touch(path);
      return ok({ exitCode: 0 });
    }
    return ok({ exitCode: 2 });
  });
}

/** env 모드 비밀 참조 하나를 담은 요청(값은 없다) */
export function secretEnvRequest(purpose: string): SecretEnvRequest {
  return {
    refs: { GH_TOKEN: "secret://gh-token" },
    ctx: {
      purpose,
      actor: "agent",
      threadId: null,
      toolCallId: null,
      projectId: null,
      approval: null,
    },
  };
}

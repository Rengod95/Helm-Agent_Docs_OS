import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "@xeon/contracts";
import {
  ExecutionError,
  type BinaryError,
  type BinaryName,
  type CancelScope,
  type OsService,
  type ResolvedBinary,
  type Shell,
  type ShellExecOptions,
  type ShellExecResult,
} from "@xeon/contracts/services";
import { createSandboxService, type SandboxServiceHandle } from "../../src/service.ts";
import { detectPlatformInput, selectSandboxProvider } from "../../src/select.ts";
import { readSandboxSettings } from "../../src/settings.ts";
import { createSrtPort } from "../../src/srt.ts";
import { seededRandom } from "./clock.ts";
import { makeTestDirs, memoryLogger, type TestDirs } from "./fakes.ts";

// 실제 srt(bubblewrap 또는 Seatbelt)와 실제 자식 프로세스로 샌드박스를 시험하는 도구. 가짜 srt를 쓰는 단위 시험과 달리
// "샌드박스 밖 쓰기가 거부된다"는 M1 종료 조건을 OS가 직접 확인하게 한다 (G4-01).

export const VAULT_SECRET = "vault-value-for-sandbox-test";

export interface SandboxEnvironment {
  /** 이 OS에서 샌드박스를 쓸 수 있는 구성이면 참 */
  readonly supported: boolean;
  /** `supported`가 거짓일 때 이유 */
  readonly unsupportedReason: string | undefined;
  /** PATH에서 찾지 못한 필수 바이너리 */
  readonly missing: readonly string[];
  /** 설치 안내 문구 */
  readonly hints: readonly string[];
}

/** 필수 바이너리가 PATH에 있는지 본다. 설치 여부만 보고 실행해 보지는 않는다 */
export function readSandboxEnvironment(): SandboxEnvironment {
  const provider = selectSandboxProvider(detectPlatformInput());
  if (provider.unsupported !== undefined || provider.kind === "none") {
    return {
      supported: false,
      unsupportedReason: provider.unsupported ?? "no sandbox provider on this OS",
      missing: [],
      hints: [],
    };
  }
  const required = provider.requiredBinaries();
  const absent = required.filter((bin) => Bun.which(bin.name) === null);
  return {
    supported: true,
    unsupportedReason: undefined,
    missing: absent.map((bin) => bin.name),
    hints: absent.map((bin) => bin.installHint),
  };
}

/** 격리 환경 시험이 실패하는 대신 "환경 문제"로 끝나야 하는 경우에 쓰는 종료 코드(AGENTS.md 종료코드 2) */
export const ENVIRONMENT_EXIT_CODE = 2;

/**
 * 필수 바이너리가 없을 때의 동작을 정한다. `XEON_REQUIRE_SANDBOX=1` 또는 CI에서는 시험을 건너뛰지 않고
 * 종료 코드 2로 끝낸다(조용히 건너뛰면 M1 종료 조건의 근거가 사라진다). 그 밖의 기기에서는 건너뛰고 이유를 한 줄 알린다.
 */
export function shouldFailOnMissing(env: Readonly<Record<string, string | undefined>>): boolean {
  return env["XEON_REQUIRE_SANDBOX"] === "1" || env["CI"] === "true";
}

export function missingMessage(environment: SandboxEnvironment): string {
  return `ENV sandbox.int: missing ${environment.missing.join(", ")}. ${environment.hints.join("; ")}`;
}

/** 부모 env 중 이 시험에 필요한 것만 자식에 준다 */
function childEnv(extra: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const env: Record<string, string> = {
    PATH: Bun.env["PATH"] ?? "/usr/bin:/bin",
    HOME: Bun.env["HOME"] ?? "/tmp",
  };
  return { ...env, ...extra };
}

/**
 * 감싸기 없이 argv나 `bash -c`로 실행하는 실제 Shell. `platform-exec`를 import하지 않으려고(DR-02) 시험용으로 최소만 만든다.
 * 표준 출력과 오류를 `onOutput`으로 전달하고 종료 코드를 돌려준다.
 */
function realShell(): Shell {
  return {
    exec(command, options, context): Promise<Result<ShellExecResult, ExecutionError>> {
      const argv = typeof command === "string" ? ["bash", "-c", command] : command;
      const [program, ...args] = argv;
      if (program === undefined) {
        return Promise.resolve(err(new ExecutionError("spawn_error", "empty command")));
      }
      return new Promise((resolve) => {
        const child = spawn(program, args, {
          cwd: options?.cwd,
          env: childEnv(options?.env),
          stdio: ["ignore", "pipe", "pipe"],
          signal: context.abortSignal,
        });
        const forward = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
          options?.onOutput?.(chunk.toString("utf8"), context, { stream });
        };
        child.stdout.on("data", forward("stdout"));
        child.stderr.on("data", forward("stderr"));
        child.once("error", () => {
          resolve(err(new ExecutionError("spawn_error", "spawn failed")));
        });
        child.once("close", (code) => {
          resolve(ok({ exitCode: code ?? 1 }));
        });
      });
    },
    cleanup: () => Promise.resolve(),
  };
}

/** PATH를 찾는 resolveBinary. 버전은 시험이 보지 않으므로 고정 문자열이다 */
function resolveOnPath(name: BinaryName): Promise<Result<ResolvedBinary, BinaryError>> {
  const found = Bun.which(name);
  return Promise.resolve(
    found === null
      ? err({ kind: "not_found", name, searched: [], hint: "" })
      : ok({ name, path: found, version: "99.0.0", source: "system" }),
  );
}

export interface RealSandbox {
  readonly dirs: TestDirs;
  /** `l0.sandbox.protectedPaths.extra`로 보호한 디렉터리. 안에 `secret.txt`가 있다 */
  readonly vault: string;
  readonly service: SandboxServiceHandle;
  readonly shell: Shell;
}

/** 실제 srt로 서비스를 만든다. 임시 디렉터리 아래 home, data, workspace를 쓴다 */
export async function startRealSandbox(): Promise<RealSandbox> {
  const dirs = makeTestDirs();
  const vault = join(dirs.root, "vault");
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(vault, "secret.txt"), VAULT_SECRET);
  const settings = { ...readSandboxSettings(() => undefined), protectedPathsExtra: [vault] };
  const log = memoryLogger();
  const os: Pick<OsService, "dirs" | "time" | "logger" | "resolveBinary"> = {
    dirs,
    time: {
      clock: { now: () => Date.now() },
      scheduler: { setTimeout: () => 0, clearTimeout: () => undefined },
      random: seededRandom(11),
    },
    logger: (component) => log.child({ component }),
    resolveBinary: (name) => resolveOnPath(name),
  };
  const service = await createSandboxService(
    {
      os,
      settings: () => settings,
      srt: createSrtPort(),
      platform: detectPlatformInput(),
    },
    new AbortController().signal,
  );
  return { dirs, vault, service, shell: realShell() };
}

const NO_CANCEL: CancelScope = { abortSignal: undefined };

/** 출력을 모아 `{ exitCode, output }`으로 돌려준다 */
export async function runCollected(
  shell: Shell,
  command: string | readonly string[],
  options: ShellExecOptions = {},
): Promise<{
  readonly exitCode: number | undefined;
  readonly output: string;
  readonly raw: Result<ShellExecResult, ExecutionError>;
}> {
  let output = "";
  const raw = await shell.exec(
    command,
    {
      ...options,
      onOutput: (text) => {
        output += text;
      },
    },
    NO_CANCEL,
  );
  return { exitCode: raw.ok ? raw.value.exitCode : undefined, output, raw };
}

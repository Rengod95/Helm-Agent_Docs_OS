// 엔진 프로세스를 띄우고 끝내는 수단(engine.rs의 Launcher와 TauriLauncher, L4.desktop.spec 4.1 E1~E3, E6, E7).
// 운영은 `pipedLauncher`가 `@fresnel/platform-process/piped`의 spawnPiped로 띄운다. 시험은 `Launcher`를 가짜로 바꾼다.
// 프로세스 그룹 종료는 PipedChild.signalTree가 한다(Rust의 killpg와 taskkill /T에 해당한다).
import path from "node:path";
import type { Writable } from "node:stream";
import {
  assertNever,
  detach,
  err,
  ok,
  rethrow,
  repeatAsync,
  type LogFields,
  type Logger,
  type Result,
  type Scheduler,
} from "@fresnel/contracts";
import {
  detectProcessPlatform,
  spawnPiped,
  type PipedChild,
  type PipedExit,
} from "@fresnel/platform-process/piped";
import type { AppLog } from "../lib/applog.ts";
import { engineEnv } from "../lib/env-path.ts";
import {
  devOverrideOf,
  overridePrefix,
  resolveSidecar,
  SIDECAR_NAME,
  SIDECAR_ARGS,
  type SidecarInputs,
} from "../lib/sidecar.ts";
import type { StdinSink } from "./relay.ts";
import type { EngineTarget } from "./state.ts";
import {
  concatBytes,
  engineFlags,
  ONCE_OUTPUT_MAX_BYTES,
  ONCE_TIMEOUT_MS,
  signalNumberOf,
  type SafeMode,
} from "./policy.ts";
import { withTimeout, type Timed } from "./wait.ts";

/** spawnPiped가 끝난 뒤 표준 출력이 닫히기를 기다리는 시간(ms) */
const DRAIN_MS = 1_000;

/** 엔진 이벤트 하나. 감독자의 펌프와 `db restore`의 수집이 같은 모양을 쓴다 */
export type EngineEvent =
  | { readonly kind: "stdout"; readonly bytes: Uint8Array }
  | { readonly kind: "stderr"; readonly bytes: Uint8Array }
  | { readonly kind: "terminated"; readonly code: number | null; readonly signal: number | null }
  | { readonly kind: "error"; readonly message: string };

/** 이벤트를 하나씩 기다려 받는다. 끝나면 null이다. 조각을 받는 동안 다음 조각을 읽지 않아 역압이 자식까지 간다 */
export interface EngineEvents {
  next(): Promise<EngineEvent | null>;
}

/** 띄운 엔진 하나. 감독자가 세대마다 하나씩 쥔다 */
export interface Launched {
  readonly pid: number;
  readonly events: EngineEvents;
  /** 엔진 stdin. 쓰기는 쓰기 루프가 하고, `close`는 EOF다 */
  readonly stdin: StdinSink;
  /** 프로세스 그룹 전체에 강제 종료를 보낸다. 이미 끝났어도 아무 일도 없다 */
  killGroup(): void;
}

/** 띄우지 못한 이유. 사람이 읽는 짧은 문구이며 값이나 토큰은 들어가지 않는다 */
export interface LaunchFailure {
  readonly message: string;
}

/** `db restore` 한 번의 결과. 출력은 앞쪽 상한까지만 남고, 내용은 해석하지 않는다 */
export interface OnceOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** 엔진 프로세스를 띄우고 한 번 돌리는 수단. 운영은 `pipedLauncher`, 시험은 가짜다 */
export interface Launcher {
  /** 엔진을 띄운다. 로컬 대상에만 안전 모드 플래그가 붙는다(`engineFlags`) */
  launch(target: EngineTarget, safeMode: SafeMode): Promise<Result<Launched, LaunchFailure>>;
  /** 호스트 인자 없이 같은 프로그램을 `args`로 한 번 돌리고 끝나기를 기다린다. 입력은 없다 */
  runOnce(args: readonly string[]): Promise<Result<OnceOutput, LaunchFailure>>;
}

// ---------------------------------------------------------------------------------------------
// 명령 계획 (개발 덮어쓰기와 번들 사이드카)

/** 띄울 명령. 작업 폴더는 홈 디렉터리다(E6), 환경은 `engineEnv`를 거친 값이다(E7) */
export interface PlannedCommand {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/** 엔진을 띄우는 것인지(호스트 인자와 플래그), 한 번 돌리는 것인지(인자 그대로) */
export type PlanMode =
  | { readonly kind: "engine"; readonly flags: readonly string[] }
  | { readonly kind: "once"; readonly args: readonly string[] };

export interface PlanInputs extends SidecarInputs {
  readonly env: NodeJS.ProcessEnv;
  /** 사용자 홈 디렉터리(E6). 절대 경로여야 한다 */
  readonly home: string;
}

/**
 * 띄울 명령을 고른다. 개발 덮어쓰기(`FRESNEL_DESKTOP_ENGINE_BIN`)는 번들 사이드카가 없을 때만 쓴다.
 * 엔진을 띄울 때는 덮어쓰기 인자 뒤에 플래그만 붙이고, 한 번 돌릴 때는 `... host --stdio` 모양일 때만 앞부분을 쓴다.
 */
export function planCommand(
  inputs: PlanInputs,
  mode: PlanMode,
): Result<PlannedCommand, LaunchFailure> {
  if (!path.isAbsolute(inputs.home)) return err({ message: "home directory is not absolute" });
  const env = engineEnv(inputs.env, inputs.home, inputs.platform);
  const lookup = resolveSidecar(inputs);
  const override = devOverrideOf(inputs.env);
  if (override !== null && !lookup.bundled) {
    if (mode.kind === "engine") {
      return ok({
        file: override.bin,
        args: [...override.args, ...mode.flags],
        cwd: inputs.home,
        env,
      });
    }
    const prefix = overridePrefix(override.args);
    if (prefix !== null) {
      return ok({ file: override.bin, args: [...prefix, ...mode.args], cwd: inputs.home, env });
    }
  }
  if (lookup.file === null) {
    return err({ message: `sidecar \`${SIDECAR_NAME}\` is not available` });
  }
  const args = mode.kind === "engine" ? [...SIDECAR_ARGS, ...mode.flags] : [...mode.args];
  return ok({ file: lookup.file, args, cwd: inputs.home, env });
}

// ---------------------------------------------------------------------------------------------
// 운영 구현 (spawnPiped)

export interface PipedLauncherDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  /** ctx.paths.resources. 패키지 앱이면 Resources, 개발 중이면 셸 패키지 폴더 */
  readonly resources: string;
  /** 사용자 홈 디렉터리(E6) */
  readonly home: string;
  readonly log: AppLog;
  readonly scheduler: Scheduler;
}

/** spawnPiped로 엔진을 띄우는 launcher. 같은 자식 프로세스 기동 경로가 `launch`와 `runOnce`에 쓰인다 */
export function pipedLauncher(deps: PipedLauncherDeps): Launcher {
  const logger = loggerOf(deps.log);
  const inputs: PlanInputs = {
    env: deps.env,
    platform: deps.platform,
    arch: deps.arch,
    resources: deps.resources,
    home: deps.home,
  };
  return {
    async launch(target, safeMode) {
      const planned = planCommand(inputs, { kind: "engine", flags: engineFlags(target, safeMode) });
      if (!planned.ok) return err(planned.error);
      const spawned = await spawnPlanned(planned.value, logger, deps.scheduler);
      if (!spawned.ok) return err(spawned.error);
      return ok(launchedOf(spawned.value));
    },
    async runOnce(args) {
      const planned = planCommand(inputs, { kind: "once", args: [...args] });
      if (!planned.ok) return err(planned.error);
      const spawned = await spawnPlanned(planned.value, logger, deps.scheduler);
      if (!spawned.ok) return err(spawned.error);
      const piped = spawned.value;
      // 입력은 없다. stdin을 바로 닫는다
      piped.stdin.end();
      const outcome: Timed<Result<OnceOutput, LaunchFailure>> = await withTimeout(
        collectOnce(eventsOf(piped)),
        ONCE_TIMEOUT_MS,
        deps.scheduler,
      );
      if (outcome.timedOut) {
        piped.signalTree("force");
        return err({
          message: `the command did not finish in ${String(ONCE_TIMEOUT_MS / 1000)} s and was killed`,
        });
      }
      return outcome.value;
    },
  };
}

async function spawnPlanned(
  command: PlannedCommand,
  logger: Logger,
  scheduler: Scheduler,
): Promise<Result<PipedChild, LaunchFailure>> {
  const platform = detectProcessPlatform(logger);
  if (!platform.ok) return err({ message: "unsupported platform" });
  const spawned = await spawnPiped(
    {
      command: command.file,
      args: [...command.args],
      cwd: command.cwd,
      env: command.env,
      label: SIDECAR_NAME,
    },
    { platform: platform.value, scheduler, logger, drainMs: DRAIN_MS },
  );
  if (!spawned.ok) return err({ message: `spawn failed: ${spawned.error.code}` });
  return ok(spawned.value);
}

function launchedOf(piped: PipedChild): Launched {
  return {
    pid: piped.pid,
    events: eventsOf(piped),
    stdin: stdinOf(piped.stdin),
    killGroup: () => {
      piped.signalTree("force");
    },
  };
}

/**
 * 자식의 stdout, stderr, 종료를 이벤트 순서대로 한 줄로 세운다. 조각은 한 번에 하나만 쥐고, 소비가 끝나야 다음을 읽는다.
 * 종료 이벤트는 표준 출력이 닫힌 뒤에 온다(spawnPiped의 `exited`). 그러므로 끝난 뒤 남은 조각은 종료 앞에 있다.
 */
function eventsOf(piped: PipedChild): EngineEvents {
  const queue: EngineEvent[] = [];
  let finished = false;
  let wake: (() => void) | null = null;
  const push = (event: EngineEvent): void => {
    queue.push(event);
    const awake = wake;
    wake = null;
    awake?.();
  };
  piped.stdout.on("data", (chunk: unknown) => {
    if (chunk instanceof Uint8Array) push({ kind: "stdout", bytes: chunk });
    piped.stdout.pause();
  });
  piped.stderr.on("data", (chunk: unknown) => {
    if (chunk instanceof Uint8Array) push({ kind: "stderr", bytes: chunk });
    piped.stderr.pause();
  });
  piped.stdout.on("error", (cause: Error) => {
    push({ kind: "error", message: cause.message });
  });
  piped.stderr.on("error", (cause: Error) => {
    push({ kind: "error", message: cause.message });
  });
  const finishWith = (exit: PipedExit): void => {
    finished = true;
    push({ kind: "terminated", code: exit.code, signal: signalNumberOf(exit.signal) });
  };
  detach(piped.exited.then(finishWith), rethrow);
  return {
    next() {
      return repeatAsync<EngineEvent | null>(async () => {
        const head = queue.shift();
        if (head !== undefined) return { value: head };
        if (finished) return { value: null };
        piped.stdout.resume();
        piped.stderr.resume();
        await new Promise<void>((resolve) => {
          wake = () => {
            resolve();
          };
        });
        return undefined;
      });
    },
  };
}

function stdinOf(stdin: Writable): StdinSink {
  return {
    write: (bytes) =>
      new Promise<void>((resolve, reject) => {
        stdin.write(bytes, (cause) => {
          if (cause) {
            reject(cause);
            return;
          }
          resolve();
        });
      }),
    close: () => {
      stdin.end();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// `db restore`의 출력 모으기 (engine.rs collect_once)

/**
 * 이벤트를 끝까지 모은다. stdout과 stderr는 각각 앞쪽 `ONCE_OUTPUT_MAX_BYTES`까지만 남기고 나머지는 버리되 끝까지 읽는다.
 * 종료 코드가 없으면(신호로 끝남) -1이다. 종료 이벤트 없이 끝나면 오류다.
 */
export function collectOnce(events: EngineEvents): Promise<Result<OnceOutput, LaunchFailure>> {
  const stdout = cappedBytes(ONCE_OUTPUT_MAX_BYTES);
  const stderr = cappedBytes(ONCE_OUTPUT_MAX_BYTES);
  return repeatAsync<Result<OnceOutput, LaunchFailure>>(async () => {
    const event = await events.next();
    if (event === null) {
      return { value: err({ message: "the command ended without an exit event" }) };
    }
    switch (event.kind) {
      case "stdout":
        stdout.push(event.bytes);
        return undefined;
      case "stderr":
        stderr.push(event.bytes);
        return undefined;
      case "terminated":
        return {
          value: ok({
            exitCode: event.code ?? -1,
            stdout: stdout.text(),
            stderr: stderr.text(),
          }),
        };
      case "error":
        return undefined;
      default:
        return assertNever(event, "engine event");
    }
  });
}

interface CappedBytes {
  push(chunk: Uint8Array): void;
  text(): string;
}

/** 상한까지만 덧붙인다. 넘는 바이트는 버린다 */
function cappedBytes(limit: number): CappedBytes {
  const pieces: Uint8Array[] = [];
  let size = 0;
  const decoder = new TextDecoder();
  return {
    push(chunk) {
      const room = limit - size;
      if (room <= 0) return;
      const part = chunk.subarray(0, Math.min(chunk.length, room));
      pieces.push(part.slice());
      size += part.length;
    },
    text() {
      return decoder.decode(concatBytes(pieces));
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 로거 연결

/** spawnPiped의 로거. 경고와 오류만 앱 로그에 쓴다. 필드는 이벤트 이름과 오류 코드뿐이다 */
function loggerOf(log: AppLog): Logger {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (event, fields) => {
      log.line(eventLine(event, fields));
    },
    error: (event, fields) => {
      log.line(eventLine(event, fields));
    },
    child: () => logger,
  };
  return logger;
}

function eventLine(event: string, fields: LogFields | undefined): string {
  return `${event} ${JSON.stringify(fields ?? {})}`;
}

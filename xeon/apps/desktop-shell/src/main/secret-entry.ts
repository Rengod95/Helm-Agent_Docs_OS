// 키 등록 명령 `secret_register`(secret_entry.rs, L4.desktop.spec §4.14.1).
// 본문은 원시 바이트 `<동작> <이름>\n<값>`이다. 번들 사이드카를 `secret <동작> <이름>` 인자로 한 번 띄우고,
// 값은 자식 stdin에 한 번 쓰고 닫는다. 값은 인자, 환경 변수, 앱 로그, 거부 값에 들어가지 않는다.
// 앱 로그에는 이름과 결과 종류만 쓴다.
import { Buffer } from "node:buffer";
import os from "node:os";
import path from "node:path";
import {
  assertNever,
  attempt,
  err,
  ok,
  type LogFields,
  type Logger,
  type Result,
  type Scheduler,
  type TimerHandle,
} from "@fresnel/contracts";
import {
  detectProcessPlatform,
  spawnPiped,
  type PipedChild,
} from "@fresnel/platform-process/piped";
import { ShellError } from "./commands.ts";
import type { ShellContext, ShellModule } from "./context.ts";
import { appLogOf, type AppLog } from "./lib/applog.ts";
import { engineEnv } from "./lib/env-path.ts";
import { nodeScheduler } from "./lib/scheduler.ts";
import {
  devOverrideOf,
  resolveSidecar,
  overridePrefix,
  SIDECAR_NAME,
  type SidecarInputs,
} from "./lib/sidecar.ts";

/** 자식이 끝나기를 기다리는 시한. sops와 age를 부르므로 넉넉하다 */
export const ENTRY_TIMEOUT_MS = 30_000;
/** 값의 상한. 파이프 버퍼보다 작아서 자식이 stdin을 읽지 않고 끝나도 쓰기가 막히지 않는다 */
/** 8 KiB */
export const MAX_VALUE_BYTES = 8192;
/** 머리(`<동작> <이름>`)를 찾는 범위. 이름은 최대 64자라 머리는 80바이트 안에 든다 */
const MAX_HEAD_BYTES = 80;
/** 사용자에게 보이는 자식 stderr 요약의 상한(문자 수) */
const DETAIL_MAX_CHARS = 600;
/** 자식 stderr를 모으는 상한(바이트) */
const STDERR_MAX_BYTES = 8 * 1024;
/** 자식이 끝난 뒤 표준 출력이 닫히기를 기다리는 시간(spawnPiped의 drainMs) */
const DRAIN_MS = 1_000;
const NEWLINE = 0x0a;
const NAME_PATTERN = /^[a-z][a-z0-9-]{1,63}$/u;
/** 머리는 엄격하게 읽는다. BOM을 지우지 않아서 BOM이 붙은 동작은 거절된다(Rust from_utf8과 같다) */
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
/** 자식 stderr를 요약할 때만 쓴다. 잘못된 바이트는 대체 문자로 바꾼다 */
const LOOSE_UTF8 = new TextDecoder("utf-8");
const CONTROL_CHARS = /\p{Cc}/gu;

export type EntryAction = "add" | "set";

/** 거부 값. 모양은 ipc.ts의 `SecretRegisterErrorSchema`와 같다 */
export type SecretEntryError =
  | { readonly kind: "bad-request" }
  | { readonly kind: "empty" }
  | { readonly kind: "too-large" }
  | { readonly kind: "busy" }
  | { readonly kind: "timeout" }
  | { readonly kind: "unavailable"; readonly detail: string }
  | { readonly kind: "rejected"; readonly exitCode: number | null; readonly detail: string };

/** 실행 단계에서 나올 수 있는 거부(본문 검사 거부는 실행 전에 끝난다) */
type RunFailure = Extract<
  SecretEntryError,
  { readonly kind: "unavailable" | "rejected" | "timeout" }
>;

export interface ParsedEntry {
  readonly action: EntryAction;
  readonly name: string;
  /** 요청 본문의 값 조각. 복사하지 않고 본문을 가리킨다 */
  readonly value: Uint8Array;
}

/** 요청 본문을 검사한다. 값은 본문 버퍼를 가리키므로 그 버퍼를 덮으면 함께 0이 된다 */
export function parseRequest(body: Uint8Array): Result<ParsedEntry, SecretEntryError> {
  const headEnd = body.subarray(0, MAX_HEAD_BYTES + 1).indexOf(NEWLINE);
  if (headEnd < 0) return err({ kind: "bad-request" });
  const decoded = attempt(() => STRICT_UTF8.decode(body.subarray(0, headEnd)));
  if (!decoded.ok) return err({ kind: "bad-request" });
  const head = decoded.value;
  const space = head.indexOf(" ");
  if (space < 0) return err({ kind: "bad-request" });
  const action = actionOf(head.slice(0, space));
  const name = head.slice(space + 1);
  if (action === null || !NAME_PATTERN.test(name)) return err({ kind: "bad-request" });
  const value = body.subarray(headEnd + 1);
  if (value.length === 0) return err({ kind: "empty" });
  if (value.length > MAX_VALUE_BYTES) return err({ kind: "too-large" });
  return ok({ action, name, value });
}

function actionOf(text: string): EntryAction | null {
  if (text === "add" || text === "set") return text;
  return null;
}

/** 자식에게 줄 인자. 값은 들어가지 않는다 */
export function entryArgs(request: {
  readonly action: EntryAction;
  readonly name: string;
}): string[] {
  return ["secret", request.action, request.name];
}

/** 자식을 띄우는 방법. 실행 파일, 인자, 작업 폴더, 환경이다 */
export interface EntryCommand {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/** 띄우지 못한 이유(사람이 읽는 짧은 문구, 값은 들어가지 않는다) */
export interface LaunchFailure {
  readonly detail: string;
}

export interface EntryPlanInputs extends SidecarInputs {
  readonly env: NodeJS.ProcessEnv;
  /** 사용자 홈 디렉터리(E6). 자식의 작업 폴더이고 PATH 보강에 쓴다 */
  readonly home: string;
}

/**
 * `secret` 인자로 띄울 명령을 고른다. 개발 덮어쓰기는 번들 사이드카가 없을 때만 쓰고(패키지 앱에서는 무시한다),
 * 그 인자가 `... host --stdio` 모양일 때만 쓴다. 그 밖에는 번들 사이드카(또는 개발 폴더의 사이드카)를 쓴다.
 */
export function planEntryCommand(
  inputs: EntryPlanInputs,
  args: readonly string[],
): Result<EntryCommand, LaunchFailure> {
  if (!path.isAbsolute(inputs.home)) return err({ detail: "home directory is not absolute" });
  const env = engineEnv(inputs.env, inputs.home);
  const lookup = resolveSidecar(inputs);
  const override = devOverrideOf(inputs.env);
  if (override !== null && !lookup.bundled) {
    const prefix = overridePrefix(override.args);
    if (prefix !== null) {
      return ok({ file: override.bin, args: [...prefix, ...args], cwd: inputs.home, env });
    }
  }
  if (lookup.file === null) {
    return err({ detail: `sidecar \`${SIDECAR_NAME}\` is not available` });
  }
  return ok({ file: lookup.file, args: [...args], cwd: inputs.home, env });
}

/** 띄운 자식 하나. 시험은 가짜로 만들고, 운영은 `pipedEntryLauncher`가 spawnPiped로 만든다 */
export interface EntryChild {
  readonly pid: number;
  /** 값을 한 번 쓰고 닫는다(EOF). 쓰기가 끝나면 true, 실패하면 false로 이행한다. 거부하지 않는다 */
  writeOnceAndClose(bytes: Uint8Array): Promise<boolean>;
  /** 표준 오류 조각을 받는다. 표준 출력은 어댑터가 읽어서 버린다 */
  onStderr(listener: (chunk: Uint8Array) => void): void;
  /** 자식이 끝나고 표준 출력이 닫히면 이행한다. 신호로 끝났으면 코드는 null */
  readonly exited: Promise<number | null>;
  /** 프로세스 그룹째 끝낸다 */
  killGroup(): void;
}

export interface EntryLauncher {
  launch(command: EntryCommand): Promise<Result<EntryChild, LaunchFailure>>;
}

export interface SecretEntryDeps {
  /** 인자로 띄울 명령을 고른다(`planEntryCommand`) */
  readonly plan: (args: readonly string[]) => Result<EntryCommand, LaunchFailure>;
  readonly launcher: EntryLauncher;
  readonly log: AppLog;
  readonly scheduler: Scheduler;
  /** 자식이 끝나기를 기다리는 시한(ms). 운영은 `ENTRY_TIMEOUT_MS` */
  readonly timeoutMs: number;
}

export interface SecretEntry {
  /** 원시 본문을 받아 등록한다. 거절은 ShellError로 던진다. 본문 버퍼는 돌아오기 전에 0으로 덮는다 */
  register(body: Uint8Array): Promise<null>;
}

/** 한 번에 하나만 등록한다. 진행 중에 또 오면 `busy`다 */
export function createSecretEntry(deps: SecretEntryDeps): SecretEntry {
  let busy = false;
  return {
    async register(body) {
      try {
        const parsed = parseRequest(body);
        if (!parsed.ok) throw new ShellError(parsed.error);
        if (busy) throw new ShellError({ kind: "busy" });
        const { action, name } = parsed.value;
        busy = true;
        try {
          const result = await runEntry(deps, parsed.value);
          // 이름과 결과 종류만 쓴다. 값과 자식의 출력은 쓰지 않는다
          deps.log.line(`secret entry ${action} ${name}: ${outcomeText(result)}`);
          if (!result.ok) throw new ShellError(result.error);
          return null;
        } finally {
          busy = false;
        }
      } finally {
        // 값이 든 본문은 호출이 끝나면 0으로 덮는다. 자식 stdin으로 나가는 쓰기는 runEntry가 끝나야 끝난다
        body.fill(0);
      }
    },
  };
}

/** 명령 `secret_register`를 등록한다. 인자는 `{ body: Uint8Array, headers }` 모양이다 */
export function registerSecretEntry(ctx: ShellContext, entry: SecretEntry): void {
  ctx.handle("secret_register", (_caller, args) => entry.register(bodyOf(args)));
}

function bodyOf(args: unknown): Uint8Array {
  if (typeof args === "object" && args !== null && "body" in args) {
    const body: unknown = args.body;
    if (body instanceof Uint8Array) return body;
  }
  throw new ShellError({ kind: "bad-request" });
}

type Exit =
  | { readonly timedOut: false; readonly code: number | null }
  | { readonly timedOut: true };

async function runEntry(
  deps: SecretEntryDeps,
  request: ParsedEntry,
): Promise<Result<null, RunFailure>> {
  const planned = deps.plan(entryArgs(request));
  if (!planned.ok) return err({ kind: "unavailable", detail: planned.error.detail });
  const launched = await deps.launcher.launch(planned.value);
  if (!launched.ok) return err({ kind: "unavailable", detail: launched.error.detail });
  const child = launched.value;
  // 한 번 쓰고 닫는다(EOF). 쓰기가 끝나기 전에 본문을 덮지 않도록 아래에서 기다린다
  const written = child.writeOnceAndClose(request.value);
  const stderrOf = captureStderr(child);
  const exit = await waitForExit(child.exited, deps.scheduler, deps.timeoutMs);
  if (exit.timedOut) {
    // 시한 안에 끝나지 않았다. 그룹째 끝낸다(자식이 부른 sops와 age 포함)
    child.killGroup();
    await written;
    return err({ kind: "timeout" });
  }
  const wroteAll = await written;
  if (exit.code === 0 && wroteAll) return ok(null);
  return err({
    kind: "rejected",
    exitCode: exit.code,
    detail: summarize(stderrOf(), request.value),
  });
}

/** 자식 stderr를 앞쪽 상한까지 모은다. 돌려주는 함수는 끝난 뒤에 부른다 */
function captureStderr(child: EntryChild): () => Uint8Array {
  const kept: Uint8Array[] = [];
  let total = 0;
  child.onStderr((chunk) => {
    const room = STDERR_MAX_BYTES - total;
    if (room <= 0) return;
    const part = chunk.subarray(0, Math.min(chunk.length, room));
    kept.push(part);
    total += part.length;
  });
  return () => concatBytes(kept);
}

async function waitForExit(
  exited: Promise<number | null>,
  scheduler: Scheduler,
  timeoutMs: number,
): Promise<Exit> {
  let timer: TimerHandle = 0;
  const timedOut = new Promise<Exit>((resolve) => {
    timer = scheduler.setTimeout(() => {
      resolve({ timedOut: true });
    }, timeoutMs);
  });
  try {
    return await Promise.race([exited.then((code): Exit => ({ timedOut: false, code })), timedOut]);
  } finally {
    scheduler.clearTimeout(timer);
  }
}

/**
 * 자식 stderr의 앞부분을 사용자에게 보일 한 덩어리로 만든다. 값 바이트가 그대로 들어 있으면 전부 비운다.
 * 제어 문자는 공백으로 바꾸고(줄바꿈은 둔다) 600자에서 자른다.
 */
function summarize(stderr: Uint8Array, value: Uint8Array): string {
  if (value.length > 0 && containsBytes(stderr, value)) return "";
  const cleaned = LOOSE_UTF8.decode(stderr).replaceAll(CONTROL_CHARS, (char) =>
    char === "\n" ? char : " ",
  );
  return Array.from(cleaned).slice(0, DETAIL_MAX_CHARS).join("").trim();
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  return Buffer.from(haystack.buffer, haystack.byteOffset, haystack.byteLength).includes(needle);
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function outcomeText(result: Result<null, RunFailure>): string {
  if (result.ok) return "ok";
  const failure = result.error;
  switch (failure.kind) {
    case "unavailable":
      return "unavailable";
    case "timeout":
      return "timeout";
    case "rejected":
      return `rejected (exit ${failure.exitCode === null ? "none" : String(failure.exitCode)})`;
    default:
      return assertNever(failure, "secret entry outcome");
  }
}

/** spawnPiped 기반 운영 launcher. 표준 출력은 읽어서 버리고, 표준 오류는 `onStderr`로 넘긴다 */
export function pipedEntryLauncher(log: AppLog): EntryLauncher {
  const logger = entryLogger(log);
  const scheduler = nodeScheduler();
  return {
    async launch(command) {
      const platform = detectProcessPlatform(logger);
      if (!platform.ok) return err({ detail: "unsupported platform" });
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
      if (!spawned.ok) return err({ detail: `spawn failed: ${spawned.error.code}` });
      return ok(entryChildOf(spawned.value));
    },
  };
}

function entryChildOf(piped: PipedChild): EntryChild {
  // 표준 출력은 쓰지 않는다. 읽지 않으면 자식이 막힌다
  piped.stdout.resume();
  return {
    pid: piped.pid,
    writeOnceAndClose: (bytes) =>
      new Promise<boolean>((resolve) => {
        // 끝 콜백은 실패할 때 오류 값을 받는다. 값이 없거나 null이면 성공이다
        piped.stdin.end(bytes, (...args: unknown[]) => {
          resolve(args.every((arg) => arg === undefined || arg === null));
        });
      }),
    onStderr: (listener) => {
      piped.stderr.on("data", listener);
    },
    exited: piped.exited.then((exit) => exit.code),
    killGroup: () => {
      piped.signalTree("force");
    },
  };
}

/** spawnPiped의 로거. 경고와 오류만 앱 로그에 쓴다. 필드는 이벤트 이름과 errno 같은 값뿐이다 */
function entryLogger(log: AppLog): Logger {
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

/** 앱 모듈. 운영 launcher와 기본 시한을 엮는다 */
export const secretEntryModule: ShellModule = {
  name: "secret-entry",
  register(ctx: ShellContext): void {
    const log = appLogOf(ctx);
    const entry = createSecretEntry({
      plan: (args) =>
        planEntryCommand(
          {
            env: ctx.env,
            platform: ctx.platform,
            arch: process.arch,
            resources: ctx.paths.resources,
            home: os.homedir(),
          },
          args,
        ),
      launcher: pipedEntryLauncher(log),
      log,
      scheduler: nodeScheduler(),
      timeoutMs: ENTRY_TIMEOUT_MS,
    });
    registerSecretEntry(ctx, entry);
  },
};

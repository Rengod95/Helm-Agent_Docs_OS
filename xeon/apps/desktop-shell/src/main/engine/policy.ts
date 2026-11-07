// 엔진 정책(engine.rs의 순수 부분). 대상 검사, 안전 모드와 호스트 인자, 설정 값, 재기동 횟수 정책, stderr 줄 나누기,
// 종료 요청 한 줄을 모은다. 프로세스와 시계를 만지지 않아 시험이 바로 돌린다(L4.desktop.spec 3.3, 4.1, 4.3, 4.4).
import os from "node:os";
import {
  RESTART_LIMIT_RANGE,
  SHUTDOWN_GRACE_MS_RANGE,
  type IntRange,
} from "../desktop-settings.ts";
import { SIDECAR_ARGS } from "../lib/sidecar.ts";
import type { CommandError, EngineExit, EngineTarget } from "./state.ts";

/** stderr 한 줄의 상한(바이트). 넘는 부분은 버린다(E10) */
export const STDERR_LINE_MAX_BYTES: number = 8 * 1024;
/** 원격 주소의 길이 상한(바이트) */
export const REMOTE_ADDRESS_MAX_BYTES: number = 512;
/** 자동 재기동 횟수를 세는 창 */
const RESTART_WINDOW_MS: number = 10 * 60 * 1000;
/** 그룹 종료를 보낸 뒤 프로세스 종료를 확인하는 시간 */
export const KILL_SETTLE_MS: number = 2_000;
/** `db restore` 한 번을 기다리는 시간. 넘으면 그룹을 죽이고 오류다 */
export const ONCE_TIMEOUT_MS: number = 120_000;
/** `db restore`가 모으는 stdout과 stderr 각각의 상한. 넘는 바이트는 버리되 끝까지 읽는다 */
export const ONCE_OUTPUT_MAX_BYTES: number = 256 * 1024;
/** 복원 때 엔진이 끝나기를 기다리는 시한은 종료 시한에 이만큼을 더한 값이다 */
export const RESTORE_SLACK_MS: number = 5_000;
/** `l4.desktop.engine.shutdownGraceMs`의 기본값 */
export const DEFAULT_SHUTDOWN_GRACE_MS: number = 7_000;
/** `l4.desktop.engine.restartLimit`의 기본값 */
export const DEFAULT_RESTART_LIMIT: number = 3;
/** 종료 기록에 싣는 stderr 첫 줄의 상한(글자 수). 원인 문장을 고르는 것은 UI다 */
const ENGINE_DETAIL_MAX_CHARS: number = 200;
/** 종료코드 3은 환경 문제(원격 소켓 없음, 접속 거부, SSH 호스트 키 실패)라 되풀이해도 같다. 자동 재기동하지 않는다 */
export const ENV_EXIT_CODE: number = 3;

const ENCODER: TextEncoder = new TextEncoder();
const DECODER: TextDecoder = new TextDecoder();
const NEWLINE = 0x0a;
/** 공백이나 제어 문자. 원격 주소에 들어 있으면 안 된다 */
const SPACE_OR_CONTROL: RegExp = /[\s\p{Cc}]/u;
/** 제어 문자 하나. 종료 기록의 원인 문장에서 뺀다 */
const CONTROL_CHAR: RegExp = /\p{Cc}/gu;

// ---------------------------------------------------------------------------------------------
// 대상 (W-08)

/** 대상이 같은가. 원격은 주소까지 같아야 같다 */
export function sameTarget(a: EngineTarget, b: EngineTarget): boolean {
  if (a.kind === "local" || b.kind === "local") return a.kind === b.kind;
  return a.address === b.address;
}

/**
 * 대상을 검사한다. 원격 주소는 공백을 뺀 값이 비어 있지 않고, UTF-8로 512바이트 이하이며, 공백이나 제어 문자가 없어야 한다.
 * 통과하면 null이다. 주소는 오류 값에도 로그에도 싣지 않는다(E11).
 */
export function validateTarget(target: EngineTarget): CommandError | null {
  if (target.kind === "local") return null;
  const address = target.address;
  const valid =
    address.trim() !== "" &&
    ENCODER.encode(address).byteLength <= REMOTE_ADDRESS_MAX_BYTES &&
    !SPACE_OR_CONTROL.test(address);
  return valid ? null : "bad-request";
}

/**
 * IPC 값(`{kind: "local"}` 또는 `{kind: "remote", address}`)을 대상으로 바꾼다. 모양이 틀리면 null이다.
 * 서버 쪽 읽기는 `kind`와 `address`만 보고, 다른 속성은 무시한다.
 */
export function parseTarget(value: unknown): EngineTarget | null {
  const kind = fieldOf(value, "kind");
  if (kind === "local") return { kind: "local" };
  if (kind !== "remote") return null;
  const address = fieldOf(value, "address");
  return typeof address === "string" ? { kind: "remote", address } : null;
}

/** 대상에 따라 호스트 인자 뒤에 붙는 것. 로컬은 없고, 원격은 `--remote <주소>`다 */
function targetArgs(target: EngineTarget): string[] {
  if (target.kind === "local") return [];
  return ["--remote", target.address];
}

// ---------------------------------------------------------------------------------------------
// 안전 모드와 인자

/**
 * 안전 모드를 어떻게 띄울지. `default`는 플래그를 붙이지 않아 호스트가 설정 `x.operations.safeMode.default`를 따른다.
 * `on`은 `--safe-mode`, `off`는 `--no-safe-mode`다. 사용자가 고른 `false`도 선택이라서 `default`가 아니라 `off`다.
 */
export type SafeMode = "default" | "on" | "off";

/** 사용자가 고른 값(불리언)을 안전 모드로 바꾼다 */
export function safeModeChosen(on: boolean): SafeMode {
  return on ? "on" : "off";
}

/**
 * 호스트 인자 뒤에 붙는 것: 안전 모드(로컬 대상에만), 그다음 대상 인자다.
 * 원격 대상에는 안전 모드 플래그가 붙지 않는다(`--safe-mode`를 켜는 요청은 감독자가 거절한다).
 */
export function engineFlags(target: EngineTarget, safeMode: SafeMode): string[] {
  const flags: string[] = [];
  if (target.kind === "local") {
    if (safeMode === "on") flags.push("--safe-mode");
    if (safeMode === "off") flags.push("--no-safe-mode");
  }
  return [...flags, ...targetArgs(target)];
}

/** 사이드카를 띄우는 전체 인자: `host --stdio`, 그다음 `engineFlags`다 */
export function sidecarArgs(target: EngineTarget, safeMode: SafeMode): string[] {
  return [...SIDECAR_ARGS, ...engineFlags(target, safeMode)];
}

// ---------------------------------------------------------------------------------------------
// 설정

/** 셸이 읽는 `l4.desktop.engine.*` 값(§3.6). 데스크톱 설정 저장소가 검사한 값을 그대로 받는다 */
export interface EngineConfig {
  /** 종료 요청 뒤 엔진이 끝나기를 기다리는 시간(밀리초) */
  readonly shutdownGraceMs: number;
  /** 10분 창 안의 자동 재기동 횟수 상한. 0이면 자동 재기동을 끈다 */
  readonly restartLimit: number;
}

/** 설정 값을 엔진 값으로 바꾼다. 없거나 범위 밖이면 그 값만 기본값을 쓴다(F.wire-settings.spec 4.8과 같다) */
export function engineConfigFrom(
  shutdownGraceMs: number | null,
  restartLimit: number | null,
): EngineConfig {
  return {
    shutdownGraceMs: inRange(shutdownGraceMs, SHUTDOWN_GRACE_MS_RANGE)
      ? shutdownGraceMs
      : DEFAULT_SHUTDOWN_GRACE_MS,
    restartLimit: inRange(restartLimit, RESTART_LIMIT_RANGE) ? restartLimit : DEFAULT_RESTART_LIMIT,
  };
}

function inRange(value: number | null, range: IntRange): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= range.min && value <= range.max
  );
}

// ---------------------------------------------------------------------------------------------
// 재기동 정책 (§4.4)

/** 엔진이 끝났을 때 내리는 결정. `restart`는 몇 번째 재기동이고 얼마 뒤에 띄울지, `giveUp`은 `failed`다 */
export type RestartDecision =
  | { readonly kind: "restart"; readonly attempt: number; readonly delayMs: number }
  | { readonly kind: "giveUp"; readonly attempts: number };

export interface RestartPolicy {
  /** 엔진이 끝났을 때 부른다. 지금 시각(밀리초)을 받는다 */
  onExit(nowMs: number): RestartDecision;
  /** 횟수를 0으로 되돌린다(수동 재기동, 대상 바꾸기, 안정적으로 뜬 뒤) */
  reset(): void;
}

/**
 * 10분 창 안의 재기동 횟수를 센다. 1번째는 즉시, 이후 1초, 2초, 4초, 8초 상한이다.
 * 창 밖으로 나간 재기동은 세지 않는다. 한도 `limit`에 이르면 `giveUp`이다.
 */
export function createRestartPolicy(limit: number): RestartPolicy {
  let recent: readonly number[] = [];
  return {
    onExit(nowMs) {
      recent = recent.filter((at) => nowMs - at <= RESTART_WINDOW_MS);
      const done = recent.length;
      if (done >= limit) return { kind: "giveUp", attempts: done };
      recent = [...recent, nowMs];
      const attempt = done + 1;
      return { kind: "restart", attempt, delayMs: backoffMs(attempt) };
    },
    reset() {
      recent = [];
    },
  };
}

/** n번째 재기동 전 기다림(밀리초). 1번째는 0, 8초에서 멈춘다 */
export function backoffMs(attempt: number): number {
  if (attempt <= 1) return 0;
  if (attempt === 2) return 1_000;
  if (attempt === 3) return 2_000;
  if (attempt === 4) return 4_000;
  return 8_000;
}

// ---------------------------------------------------------------------------------------------
// 종료와 기록

/** 종료 요청 한 줄. id는 `shell:shutdown:<n>` 꼴이고 WebView의 연결은 자기가 보낸 id가 아닌 응답을 무시한다 */
export function shutdownRequestFrame(generation: number): Uint8Array {
  const line = JSON.stringify({
    jsonrpc: "2.0",
    id: `shell:shutdown:${String(generation)}`,
    method: "host.shutdown",
    params: { reason: "client_exit" },
  });
  return ENCODER.encode(`${line}\n`);
}

/** 엔진이 끝난 기록. `at`은 RFC 3339 UTC(밀리초까지)다. `detail`을 안 주면 필드를 두지 않는다 */
export function exitOf(
  code: number | null,
  signal: number | null,
  nowMs: number,
  detail?: string | null,
): EngineExit {
  const at = new Date(nowMs).toISOString();
  return detail === undefined ? { code, signal, at } : { code, signal, at, detail };
}

/**
 * stderr 한 줄을 종료 기록의 원인 문장으로 바꾼다. 제어 문자를 빼고 앞뒤 공백을 떼며, 글자 수 상한에서 자른다.
 * 비어 있으면 null이다(그러면 호출자는 다음 줄을 본다).
 */
export function engineDetailOf(line: string): string | null {
  const text = line.replace(CONTROL_CHAR, "").trim();
  if (text === "") return null;
  return Array.from(text).slice(0, ENGINE_DETAIL_MAX_CHARS).join("");
}

/** 신호 이름(`SIGKILL`)을 번호로 바꾼다. 모르는 이름이면 null이다 */
export function signalNumberOf(name: string | null): number | null {
  if (name === null) return null;
  const table: Readonly<Record<string, unknown>> = { ...os.constants.signals };
  const value = table[name];
  return typeof value === "number" ? value : null;
}

/** 엔진 stderr를 줄로 나눈다. 줄은 8 KiB에서 자르고 나머지는 버린다(E10). CR은 줄 끝에서 뗀다 */
export interface StderrSplitter {
  /** 조각을 넣고, 이번에 끝난 줄들을 돌려준다. 줄 끝이 없는 꼬리는 쥐고 있는다 */
  push(chunk: Uint8Array): string[];
  /** 끝났다. 줄 끝이 없는 꼬리가 있으면 그 줄을 돌려준다 */
  finish(): string | null;
}

export function createStderrSplitter(): StderrSplitter {
  let pieces: Uint8Array[] = [];
  let size = 0;
  let truncated = false;

  function append(bytes: Uint8Array): void {
    const room = STDERR_LINE_MAX_BYTES - size;
    if (bytes.length > room) truncated = true;
    const part = bytes.subarray(0, Math.min(bytes.length, room));
    if (part.length === 0) return;
    pieces.push(part.slice());
    size += part.length;
  }

  function takeLine(): string {
    const text = DECODER.decode(concatBytes(pieces));
    pieces = [];
    size = 0;
    truncated = false;
    return text.replace(/\r+$/u, "");
  }

  return {
    push(chunk) {
      const lines: string[] = [];
      let rest = chunk;
      for (;;) {
        const at = rest.indexOf(NEWLINE);
        if (at === -1) break;
        append(rest.subarray(0, at));
        lines.push(takeLine());
        rest = rest.subarray(at + 1);
      }
      append(rest);
      return lines;
    },
    finish() {
      if (size === 0 && !truncated) return null;
      return takeLine();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 공용 도구

/** 객체의 자기 속성 값. 없으면 undefined. IPC 값과 JSON 값을 읽을 때 쓴다 */
function fieldOf(value: unknown, name: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.getOwnPropertyDescriptor(value, name)?.value;
}

/** 조각들을 한 배열로 잇는다 */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

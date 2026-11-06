// 원격 점검 Phase 1(Rust `inspect/`의 포팅, L4.desktop.spec §4.15). 디버그 전용이다.
// 줄 단위 JSON-RPC 2.0을 Unix 도메인 소켓 하나로 받는다. 읽기 전용이다.
// - `state.dump`: 앱, 엔진, 릴레이 세대, 메인 창, 로그 폴더. 대화 내용과 시크릿 값은 어느 응답에도 싣지 않는다.
// - `viewport.snapshot`: 메인 창의 보이는 영역을 PNG 파일로 저장하고 경로와 메타데이터만 돌려준다.
// 켜는 조건: 환경 변수 `FRESNEL_DESKTOP_INSPECT=1`과 Unix 플랫폼. 릴리스 번들에도 이 파일의 코드는 들어 있지만
// 그 변수가 `1`이 아니면 파일도 소켓도 만들지 않는다. 그래서 릴리스 실행 스크립트와 패키징은 이 변수를 설정하면 안 된다
// (ShellContext에는 패키지 여부가 없어 환경 변수 하나로만 가른다. spec §4.15 릴리스 확인).
// 소켓 폴더는 앱이 만든 경우에만 0700으로 두고, 이미 있는 폴더의 권한은 바꾸지 않는다. 소켓 파일은 0600이다.
import { chmodSync, lstatSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import {
  attempt,
  attemptAsync,
  detach,
  err,
  ok,
  parseJson,
  rethrow,
  type Result,
} from "@fresnel/contracts";
import shellPackage from "../../package.json" with { type: "json" };
import type { ShellContext, ShellModule } from "./context.ts";
import { relayOf } from "./engine.ts";
import type { Relay } from "./engine/relay.ts";
import type { EngineState } from "./engine/state.ts";
import { appLogOf, type AppLog } from "./lib/applog.ts";
import { errnoCode, isRecord, ownField } from "./lib/narrow.ts";

/** 켜는 환경 변수. `1`일 때만 소켓을 연다 */
export const INSPECT_ENV: string = "FRESNEL_DESKTOP_INSPECT";
/** 소켓 경로를 바꾸는 환경 변수(Rust와 같은 이름) */
export const INSPECT_SOCKET_ENV: string = "FRESNEL_DESKTOP_INSPECT_SOCKET";
/** 기본 소켓 파일 이름(로그 폴더 안) */
export const SOCKET_FILE_NAME: string = "inspect.sock";
/** 동시에 받는 접속 수. 점검 도구 하나와 사람 하나면 충분하다 */
export const MAX_CONNECTIONS: number = 4;
/** 요청 줄 하나의 길이 상한(바이트, 줄 끝 포함). 메서드 이름 말고는 받을 내용이 없다 */
export const MAX_LINE_BYTES: number = 16 * 1024;
/** 소켓 경로 상한(바이트). macOS 한도(NUL 포함 104바이트)보다 여유 있게 잡는다 */
const MAX_SOCKET_PATH_BYTES: number = 100;
/** 스냅샷 완료를 기다리는 시간(밀리초) */
export const SNAPSHOT_WAIT_MS: number = 10_000;

export const PARSE_ERROR: number = -32700;
export const INVALID_REQUEST: number = -32600;
export const METHOD_NOT_FOUND: number = -32601;
/** 메서드가 실행되지 못했다(스냅샷 실패 등). JSON-RPC 서버 오류 구간이다 */
export const FAILED: number = -32000;

const MAIN_LABEL: string = "main";
const APP_NAME: string = "fresnel-desktop";
const SNAPSHOT_FOLDER: string = "snapshots";
const NEWLINE: number = 0x0a;
const PNG_SIGNATURE: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 창 하나의 점검 값. 라벨은 Rust의 `MAIN_LABEL`과 같이 "main"이다 */
export interface WindowDump {
  readonly label: string;
  readonly visible: boolean;
  readonly focused: boolean;
  readonly minimized: boolean;
  /** 내용 영역 크기(픽셀). 읽지 못하면 null */
  readonly innerSize: { readonly width: number; readonly height: number } | null;
}

/** `state.dump`의 결과. 키는 이 모양이 전부다(시험이 키 집합을 고정한다) */
export interface StateDump {
  readonly app: {
    readonly name: string;
    readonly version: string;
    readonly pid: number;
    readonly uptimeMs: number;
    readonly debug: true;
  };
  readonly engine: EngineState;
  readonly relay: { readonly epoch: number };
  readonly window: WindowDump | null;
  readonly paths: { readonly logDir: string };
}

/** `viewport.snapshot`의 결과. 이미지 바이트는 싣지 않는다 */
export interface SnapshotMeta {
  readonly path: string;
  readonly bytes: number;
  readonly mime: "image/png";
  readonly width: number;
  readonly height: number;
}

/** 스냅샷이 실패한 이유. 메시지는 JSON-RPC 오류 메시지로 그대로 나간다 */
export interface SnapshotFailure {
  readonly kind: "no_window" | "timeout" | "capture_failed" | "encode_failed" | "write_failed";
  readonly message: string;
}

/** 응답을 만드는 데 필요한 앱 쪽 정보(Rust `Probe` 트레이트). 시험은 가짜 구현을 쓴다 */
export interface Probe {
  stateDump(): StateDump;
  viewportSnapshot(): Promise<Result<SnapshotMeta, SnapshotFailure>>;
}

/** 소켓을 열지 못한 이유. 메시지는 앱 로그에 남는다 */
export type InspectError =
  | { readonly kind: "path_too_long" }
  | { readonly kind: "not_a_directory"; readonly dir: string }
  | { readonly kind: "folder_refused"; readonly dir: string }
  | { readonly kind: "socket_path_taken"; readonly path: string }
  | { readonly kind: "io"; readonly cause: unknown };

/** 창이 제공해야 하는 면. Electron `BrowserWindow`가 이것을 만족하고, 시험은 가짜 창을 넣는다 */
export interface InspectWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isFocused(): boolean;
  isMinimized(): boolean;
  getContentSize(): number[];
  readonly webContents: { capturePage(): Promise<CapturedImage> };
}

/** `capturePage`가 돌려주는 이미지의 면. `NativeImage`가 이것을 만족한다 */
export interface CapturedImage {
  toPNG(): Uint8Array;
}

/** `createAppProbe`에 넘기는 값. 전역 상태를 읽지 않게 모두 밖에서 받는다 */
export interface ProbeSource {
  readonly relay: Pick<Relay, "state" | "currentEpoch">;
  readonly windows: () => readonly InspectWindow[];
  readonly logDir: string;
  readonly version: string;
  /** 가동 시간은 단조 시계(밀리초)의 차이로 잰다 */
  readonly monotonicMs: () => number;
  readonly startedAt: number;
  /** 스냅샷 파일 이름에 넣는 벽시계(밀리초) */
  readonly wallMs: () => number;
  readonly waitMs: number;
}

/** 열린 점검 소켓. `close`가 접속을 끊고 소켓 파일을 지운다 */
export interface InspectHandle {
  readonly socketFile: string;
  close(): Promise<void>;
}

/** 요청 하나의 오류. JSON-RPC `error` 객체가 된다 */
interface RpcError {
  readonly code: number;
  readonly message: string;
}

/** 줄 나누기 한 번의 결과. `lines`는 완성된 줄(줄 끝 제외)이다 */
export interface LineSplit {
  readonly lines: readonly string[];
  /** 한도를 넘는 줄이 있었다. 그 줄 앞의 완성된 줄은 `lines`에 있다. 이 뒤의 입력은 받지 않는다 */
  readonly tooLong: boolean;
}

export interface LineSplitter {
  push(chunk: Uint8Array): LineSplit;
  /** 연결이 끝났다. 줄 끝 없이 남은 마지막 조각을 줄로 돌려준다(Rust가 EOF에서 처리하는 것과 같다) */
  end(): LineSplit;
}

// ---------------------------------------------------------------------------------------------
// JSON-RPC 처리(Rust `handle_line`). 소켓을 모른다. 시험은 가짜 Probe로 이것만 돌린다.

function resultResponse(id: unknown, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function errorResponse(id: unknown, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

/** 요청 줄 하나를 처리해 응답 줄을 돌려준다. 알림(id 없음)에는 응답이 없다(`null`) */
export async function handleLine(probe: Probe, line: string): Promise<string | null> {
  const parsed = parseJson(line);
  if (!parsed.ok) return errorResponse(null, PARSE_ERROR, "parse error");
  const request = parsed.value;
  if (!isRecord(request)) return errorResponse(null, INVALID_REQUEST, "invalid request");
  // id가 없으면 알림이다. `null`인 id는 응답이 있다(Rust의 `Some(Null)`과 같다)
  const id = ownField(request, "id");
  const method = ownField(request, "method");
  if (ownField(request, "jsonrpc") !== "2.0" || typeof method !== "string") {
    return errorResponse(id ?? null, INVALID_REQUEST, "invalid request");
  }
  const outcome = await dispatch(probe, method);
  // 알림에는 응답하지 않는다. 메서드는 실행했다
  if (id === undefined) return null;
  return outcome.ok
    ? resultResponse(id, outcome.value)
    : errorResponse(id, outcome.error.code, outcome.error.message);
}

/** 메서드 이름으로 실행한다. 읽기 전용이라 엔진을 건드리는 메서드는 없다 */
async function dispatch(probe: Probe, method: string): Promise<Result<unknown, RpcError>> {
  // 메서드 이름은 열린 문자열이라 switch의 default로 닫을 수 없다. 모르는 이름은 모두 -32601이다
  if (method === "state.dump") return ok(probe.stateDump());
  if (method === "viewport.snapshot") {
    const taken = await probe.viewportSnapshot();
    return taken.ok ? ok(taken.value) : err({ code: FAILED, message: taken.error.message });
  }
  return err({ code: METHOD_NOT_FOUND, message: "method not found" });
}

// ---------------------------------------------------------------------------------------------
// 줄 나누기(Rust `serve_connection`의 줄 상한). 줄 끝 없이 쌓이는 입력이 메모리를 채우지 않게 한다.

/**
 * 조각을 넣으면 완성된 줄을 돌려준다. 줄 길이는 줄 끝을 포함해 `limit` 이하여야 한다(Rust의 `take(MAX + 1)`과 같다).
 * 줄 끝 없이 `limit`을 넘게 쌓이면 그 자리에서 `tooLong`이다. 한 번 `tooLong`이면 이후 입력은 버린다.
 */
export function createLineSplitter(limit: number): LineSplitter {
  const decoder = new TextDecoder();
  let pending: Buffer = Buffer.alloc(0);
  let refused = false;
  const nothing: LineSplit = { lines: [], tooLong: false };
  return {
    push(chunk) {
      if (refused) return nothing;
      const buffer = Buffer.concat([pending, chunk]);
      const lines: string[] = [];
      let start = 0;
      let newline = buffer.indexOf(NEWLINE, start);
      while (newline !== -1) {
        if (newline - start + 1 > limit) {
          refused = true;
          return { lines, tooLong: true };
        }
        lines.push(decoder.decode(buffer.subarray(start, newline)));
        start = newline + 1;
        newline = buffer.indexOf(NEWLINE, start);
      }
      if (buffer.length - start > limit) {
        refused = true;
        return { lines, tooLong: true };
      }
      pending = Buffer.from(buffer.subarray(start));
      return { lines, tooLong: false };
    },
    end() {
      if (refused || pending.length === 0) return nothing;
      const last = decoder.decode(pending);
      pending = Buffer.alloc(0);
      return { lines: [last], tooLong: false };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 앱 쪽 Probe(Rust `probe.rs`, `snapshot_macos.rs`)

function windowDump(win: InspectWindow | undefined): WindowDump | null {
  if (win === undefined || win.isDestroyed()) return null;
  const [width, height] = win.getContentSize();
  return {
    label: MAIN_LABEL,
    visible: win.isVisible(),
    focused: win.isFocused(),
    minimized: win.isMinimized(),
    innerSize: width === undefined || height === undefined ? null : { width, height },
  };
}

/** 앱 상태를 읽어 Probe를 만든다. 대화 내용과 시크릿은 이 함수가 읽지 않는다 */
export function createAppProbe(source: ProbeSource): Probe {
  return {
    stateDump(): StateDump {
      return {
        app: {
          name: APP_NAME,
          version: source.version,
          pid: process.pid,
          uptimeMs: Math.max(0, Math.round(source.monotonicMs() - source.startedAt)),
          debug: true,
        },
        engine: source.relay.state(),
        relay: { epoch: source.relay.currentEpoch() },
        window: windowDump(source.windows()[0]),
        paths: { logDir: source.logDir },
      };
    },
    viewportSnapshot(): Promise<Result<SnapshotMeta, SnapshotFailure>> {
      return takeViewportSnapshot(source.windows()[0], {
        logDir: source.logDir,
        wallMs: source.wallMs,
        waitMs: source.waitMs,
      });
    },
  };
}

export interface SnapshotOptions {
  readonly logDir: string;
  readonly wallMs: () => number;
  readonly waitMs: number;
}

/**
 * 창의 보이는 영역을 `<logDir>/snapshots/viewport-<ms>.png`에 저장하고 메타데이터를 돌려준다.
 * 파일은 0600이다. 화면에는 대화 내용이 보이므로 같은 사용자만 읽게 한다(Rust는 기본 권한이었다).
 */
export async function takeViewportSnapshot(
  win: InspectWindow | undefined,
  options: SnapshotOptions,
): Promise<Result<SnapshotMeta, SnapshotFailure>> {
  if (win === undefined || win.isDestroyed()) {
    return fail("no_window", "the main window does not exist");
  }
  const captured = await captureWithin(win, options.waitMs);
  if (!captured.ok) return captured;
  const image = captured.value;
  const encoded = attempt(() => image.toPNG());
  if (!encoded.ok) return fail("encode_failed", "the snapshot could not be encoded as PNG");
  const png = encoded.value;
  const size = pngSize(png);
  if (size === null) return fail("encode_failed", "the snapshot could not be encoded as PNG");
  const folder = path.join(options.logDir, SNAPSHOT_FOLDER);
  const file = path.join(folder, `viewport-${options.wallMs()}.png`);
  const written = attempt(() => {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    writeFileSync(file, png, { mode: 0o600 });
  });
  if (!written.ok) return fail("write_failed", "the snapshot could not be written");
  return ok({
    path: file,
    bytes: png.byteLength,
    mime: "image/png",
    width: size.width,
    height: size.height,
  });
}

/** 캡처를 기다리되 `waitMs`가 지나면 실패로 돌려준다. 기다리는 타이머는 끝나면 지운다 */
async function captureWithin(
  win: InspectWindow,
  waitMs: number,
): Promise<Result<CapturedImage, SnapshotFailure>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<Result<never, SnapshotFailure>>((resolve) => {
    timer = setTimeout(() => {
      resolve(fail("timeout", "the snapshot timed out"));
    }, waitMs);
  });
  const captured = attemptAsync(() => win.webContents.capturePage()).then(
    (outcome): Result<CapturedImage, SnapshotFailure> =>
      outcome.ok ? ok(outcome.value) : fail("capture_failed", "the snapshot failed"),
  );
  try {
    return await Promise.race([captured, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** PNG 머리글에서 픽셀 크기를 읽는다. PNG가 아니면 null이다(시그니처와 IHDR만 본다) */
export function pngSize(
  bytes: Uint8Array,
): { readonly width: number; readonly height: number } | null {
  if (bytes.byteLength < 24) return null;
  const head = Buffer.from(bytes.subarray(0, 24));
  if (!head.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (head.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

function fail(kind: SnapshotFailure["kind"], message: string): Result<never, SnapshotFailure> {
  return err({ kind, message });
}

// ---------------------------------------------------------------------------------------------
// 소켓 경로와 폴더 권한(Rust `server.rs`의 `socket_path`, `prepare_socket_dir`, `bind`)

/** 소켓 파일 경로. 환경 변수 값이 비어 있지 않으면 그 경로를 쓴다 */
export function socketPath(logDir: string, override: string | undefined): string {
  if (override === undefined || override === "") return path.join(logDir, SOCKET_FILE_NAME);
  return override;
}

/** 소켓이 놓일 폴더의 사실. `fs.Stats`가 이것을 만족한다 */
export interface FolderFacts {
  isDirectory(): boolean;
  readonly uid: number;
  readonly mode: number;
}

/**
 * 이미 있는 폴더를 받을지 본다. 디렉터리이고, 이 사용자 소유이고, 다른 사용자가 쓸 수 없어야 한다.
 * 그룹 쓰기는 막지 않는다(사용자별 그룹과 umask 002 환경의 로그 폴더는 0775다). 아니면 거절하고 권한을 바꾸지 않는다.
 */
export function checkSocketFolder(
  dir: string,
  folder: FolderFacts,
  myUid: number | undefined,
): Result<void, InspectError> {
  if (!folder.isDirectory()) return failure({ kind: "not_a_directory", dir });
  if (myUid === undefined || folder.uid !== myUid || (folder.mode & 0o002) !== 0) {
    return failure({ kind: "folder_refused", dir });
  }
  return ok(undefined);
}

function currentUid(): number | undefined {
  return process.getuid?.();
}

/** 없으면 만든다(마지막 폴더만 0700, 위쪽은 기본 권한). 있으면 `checkSocketFolder`로 본다 */
function prepareSocketFolder(dir: string): Result<void, InspectError> {
  const found = attempt(() => statSync(dir, { throwIfNoEntry: false }));
  if (!found.ok) return failure({ kind: "io", cause: found.error.cause });
  if (found.value !== undefined) return checkSocketFolder(dir, found.value, currentUid());
  const parent = attempt(() => {
    mkdirSync(path.dirname(dir), { recursive: true });
  });
  if (!parent.ok) return failure({ kind: "io", cause: parent.error.cause });
  const made = attempt(() => {
    mkdirSync(dir, { mode: 0o700 });
  });
  if (made.ok) return ok(undefined);
  if (errnoCode(made.error.cause) !== "EEXIST") {
    return failure({ kind: "io", cause: made.error.cause });
  }
  // 그 사이에 다른 프로세스가 만들었다. 우리가 만든 폴더가 아니므로 같은 검사를 거친다
  const again = attempt(() => statSync(dir));
  if (!again.ok) return failure({ kind: "io", cause: again.error.cause });
  return checkSocketFolder(dir, again.value, currentUid());
}

/** 이전 실행이 남긴 소켓 파일은 지운다. 다른 종류의 파일은 절대 지우지 않는다 */
function replaceStaleSocket(file: string): Result<void, InspectError> {
  const found = attempt(() => lstatSync(file, { throwIfNoEntry: false }));
  if (!found.ok) return failure({ kind: "io", cause: found.error.cause });
  if (found.value === undefined) return ok(undefined);
  if (!found.value.isSocket()) return failure({ kind: "socket_path_taken", path: file });
  const removed = attempt(() => {
    unlinkSync(file);
  });
  if (!removed.ok) return failure({ kind: "io", cause: removed.error.cause });
  return ok(undefined);
}

function failure(error: InspectError): Result<never, InspectError> {
  return err(error);
}

function listenOn(server: Server, file: string): Promise<Result<void, InspectError>> {
  return new Promise<Result<void, InspectError>>((resolve) => {
    const onError = (cause: unknown): void => {
      resolve(failure({ kind: "io", cause }));
    };
    server.once("error", onError);
    server.listen(file, () => {
      server.off("error", onError);
      resolve(ok(undefined));
    });
  });
}

/**
 * 소켓 파일을 열어 듣는 서버를 만든다(아직 접속을 받지는 않는다). 폴더를 준비하고, 낡은 소켓을 지우고,
 * 파일 권한을 0600으로 바꾼다. 실패는 `InspectError` 값이다.
 */
export async function bindSocket(file: string): Promise<Result<Server, InspectError>> {
  if (Buffer.byteLength(file) > MAX_SOCKET_PATH_BYTES) return failure({ kind: "path_too_long" });
  const folder = prepareSocketFolder(path.dirname(file));
  if (!folder.ok) return folder;
  const stale = replaceStaleSocket(file);
  if (!stale.ok) return stale;
  // allowHalfOpen: 클라이언트가 쓰기를 닫아도 남은 줄의 응답은 보낸다(Rust는 EOF 뒤에도 응답을 쓴다)
  const server = createServer({ allowHalfOpen: true });
  const listening = await listenOn(server, file);
  if (!listening.ok) return listening;
  const mode = attempt(() => {
    chmodSync(file, 0o600);
  });
  if (!mode.ok) {
    server.close();
    return failure({ kind: "io", cause: mode.error.cause });
  }
  return ok(server);
}

// ---------------------------------------------------------------------------------------------
// 접속 처리(Rust `serve_connection`, `accept_loop`)

interface SerialQueue {
  /** 작업을 앞 작업이 끝난 뒤에 한다. 실패는 `onFailure`로 넘긴다 */
  run(task: () => void | Promise<void>): void;
}

/** 접속 하나의 요청을 받은 순서대로 하나씩 처리한다. 응답 순서가 요청 순서와 같아야 한다 */
function createSerialQueue(onFailure: (cause: unknown) => void): SerialQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    run(task) {
      tail = tail.then(task).catch(onFailure);
    },
  };
}

/** 접속 하나를 읽고 쓴다. 줄 상한을 넘으면 오류 응답을 한 번 보내고 끊는다 */
function serveSocket(socket: Socket, probe: Probe, log: AppLog): void {
  const splitter = createLineSplitter(MAX_LINE_BYTES);
  const queue = createSerialQueue((cause) => {
    log.line(`debug inspect request failed: ${describeCause(cause)}`);
  });
  let refusing = false;

  const reply = (text: string): void => {
    if (!socket.destroyed) socket.write(`${text}\n`);
  };
  const answer = async (line: string): Promise<void> => {
    const request = line.trim();
    if (request === "") return;
    const replied = await attemptAsync(() => handleLine(probe, request));
    if (!replied.ok) {
      log.line(`debug inspect request failed: ${describeCause(replied.error.cause)}`);
      reply(errorResponse(null, FAILED, "request failed"));
      return;
    }
    if (replied.value !== null) reply(replied.value);
  };
  const enqueueLines = (lines: readonly string[]): void => {
    for (const line of lines) queue.run(() => answer(line));
  };

  socket.on("data", (chunk: Buffer) => {
    if (refusing) return;
    const split = splitter.push(chunk);
    enqueueLines(split.lines);
    if (!split.tooLong) return;
    refusing = true;
    queue.run(() => {
      socket.end(`${errorResponse(null, INVALID_REQUEST, "line too long")}\n`, () => {
        socket.destroy();
      });
    });
  });
  socket.on("end", () => {
    enqueueLines(splitter.end().lines);
    queue.run(() => {
      socket.end();
    });
  });
  socket.on("error", (cause) => {
    refusing = true;
    log.line(`debug inspect connection failed: ${describeCause(cause)}`);
  });
}

/** 접속을 받는다. 상한을 넘은 접속은 받자마자 닫는다. `close`는 남은 접속을 끊고 서버를 닫는다 */
function serveConnections(server: Server, probe: Probe, log: AppLog): { close(): Promise<void> } {
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    if (sockets.size >= MAX_CONNECTIONS) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    serveSocket(socket, probe, log);
  });
  server.on("error", (cause) => {
    log.line(`debug inspect server error: ${describeCause(cause)}`);
  });
  return {
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close((cause) => {
          if (cause !== undefined) log.line(`debug inspect close failed: ${describeCause(cause)}`);
          resolve();
        });
      }),
  };
}

/** 소켓을 열고 접속을 받기 시작한다. 열지 못하면 이유를 돌려주고, 아무것도 남기지 않는다 */
export async function startInspectServer(
  socketFile: string,
  probe: Probe,
  log: AppLog,
): Promise<Result<InspectHandle, InspectError>> {
  const bound = await bindSocket(socketFile);
  if (!bound.ok) return bound;
  const serving = serveConnections(bound.value, probe, log);
  log.line(`debug inspect listening on ${socketFile}`);
  return ok({
    socketFile,
    close: async () => {
      await serving.close();
      removeSocketFile(socketFile, log);
    },
  });
}

/** 종료할 때 소켓 파일을 지운다. 소켓이 아니면 건드리지 않는다 */
function removeSocketFile(file: string, log: AppLog): void {
  const found = attempt(() => lstatSync(file, { throwIfNoEntry: false }));
  if (!found.ok) {
    log.line(`debug inspect cleanup failed: ${describeCause(found.error.cause)}`);
    return;
  }
  if (found.value === undefined || !found.value.isSocket()) return;
  const removed = attempt(() => {
    unlinkSync(file);
  });
  if (!removed.ok) log.line(`debug inspect cleanup failed: ${describeCause(removed.error.cause)}`);
}

export function describeInspectError(error: InspectError): string {
  if (error.kind === "path_too_long") return "socket path is too long for a unix socket";
  if (error.kind === "not_a_directory") return `the socket folder ${error.dir} is not a directory`;
  if (error.kind === "folder_refused") {
    return `refusing the socket folder ${error.dir}: it is not owned by this user or is writable by others (it is left unchanged)`;
  }
  if (error.kind === "socket_path_taken") {
    return "the socket path is taken by a file that is not a socket";
  }
  return describeCause(error.cause);
}

function describeCause(cause: unknown): string {
  const code = errnoCode(cause);
  if (code !== null) return code;
  return cause instanceof Error ? cause.message : "unknown error";
}

// ---------------------------------------------------------------------------------------------
// 모듈

/**
 * 점검 소켓을 연다. 환경 변수 `FRESNEL_DESKTOP_INSPECT`가 `1`이고 Unix 플랫폼일 때만 한다.
 * 앱이 끝나면 접속을 끊고 소켓 파일을 지운다.
 */
export const inspectModule: ShellModule = {
  name: "inspect",
  register(ctx: ShellContext) {
    if (ctx.env[INSPECT_ENV] !== "1") return;
    const log = appLogOf(ctx);
    if (ctx.platform === "win32") {
      log.line("debug inspect did not start: unix sockets only");
      return;
    }
    const probe = createAppProbe({
      relay: relayOf(ctx),
      windows: () => ctx.windows(),
      logDir: ctx.paths.logs,
      version: shellPackage.version,
      monotonicMs: () => performance.now(),
      startedAt: performance.now(),
      wallMs: () => Date.now(),
      waitMs: SNAPSHOT_WAIT_MS,
    });
    const file = socketPath(ctx.paths.logs, ctx.env[INSPECT_SOCKET_ENV]);
    const starting = startInspectServer(file, probe, log).then((started) => {
      if (started.ok) return started.value;
      log.line(`debug inspect did not start: ${describeInspectError(started.error)}`);
      return null;
    });
    detach(starting, rethrow);
    ctx.onQuit(async () => {
      const handle = await starting;
      if (handle !== null) await handle.close();
    });
  },
};

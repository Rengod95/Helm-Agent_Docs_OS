import type { Result } from "../base/index.ts";
import type { SecretRef } from "../capabilities/index.ts";
import type { PortKey } from "../extensions/index.ts";
import type { SandboxRunReport } from "./sandbox-report.ts";
import type { UseCtx } from "./secrets.ts";

// L0.exec.spec §3.1. 구현은 platform-exec(pi durable env 포크)이다. 모양은 포크 원본 env/index.ts의 선언을 옮겼다.
// node:* 타입을 쓰지 않는다. 출력 절단 함수(truncateHead 등)는 platform-exec가 구현하고 L1·L2는 xeon.exec로 부른다(review.decisions-2 D-08).

export const ExecServiceName = "xeon.exec" as const;

/** `xeon.exec` 전체 모양(ExecService)의 포트 키. 제공 platform-exec, 소비 core-tools·cap-workspace */
export const ExecPortKey: PortKey<ExecService> = { name: ExecServiceName };

/** 취소 신호만 전달한다. DI 기능은 없다(adr.0003 §3.1). 원본 모양대로 AbortSignal | undefined를 받는다 */
export interface CancelScope {
  readonly abortSignal: AbortSignal | undefined;
}

export type FileKind = "file" | "directory" | "symlink";

export type FileErrorCode =
  | "aborted"
  | "not_found"
  | "permission_denied"
  | "not_directory"
  | "is_directory"
  | "invalid"
  | "not_supported"
  | "unknown";

export type ExecutionErrorCode =
  | "aborted"
  | "timeout"
  | "shell_unavailable"
  | "spawn_error"
  | "callback_error"
  | "unknown"
  // Xeon 추가 [제안]: 원본에 없다. 데코레이터와 연결 코드만 만든다.
  /** 허용 목록 규칙이 막는 이름을 요청함 */
  | "env_denied"
  /** secretEnv의 lease를 얻지 못함 */
  | "secret_unavailable"
  /** 격리가 필요한데 쓸 수 없음 */
  | "sandbox_unavailable"
  /** 샌드박스 래핑 자체가 실패함 */
  | "sandbox_failed";

/** 파일 시스템 오류. 원본과 같은 클래스를 포크와 L2 도구 본문이 함께 쓴다(instanceof 판정) */
export class FileError extends Error {
  override readonly name: string = "FileError";
  readonly code: FileErrorCode;
  declare readonly path?: string;

  constructor(code: FileErrorCode, message: string, path?: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}

export class ExecutionError extends Error {
  override readonly name: string = "ExecutionError";
  readonly code: ExecutionErrorCode;
  /** 시간 초과·취소된 명령의 spill 파일. 출력이 spill 임계를 넘은 뒤 끝난 경우만 */
  declare spillPath?: string;

  constructor(code: ExecutionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.code = code;
  }
}

/**
 * 자식 프로세스 env 거부 목록의 유일한 정본(L0.exec.spec §3.5 deny 행). 끝의 *만 와일드카드다.
 * exec env 빌더, sandbox 자가 시험, secrets의 sops 호출 env가 같은 목록을 쓴다.
 */
export const SENSITIVE_ENV_PATTERNS: readonly string[] = [
  "*_TOKEN",
  "*_KEY",
  "*_SECRET",
  "*_PASSWORD",
  "*_API_KEY",
  "SOPS_*",
  "SOPS_AGE_*",
  "AGE_*",
  "OP_*",
  "BWS_*",
  "BW_SESSION",
  "AWS_*",
  "ANTHROPIC_*",
  "OPENAI_*",
  "GEMINI_*",
  "OPENROUTER_*",
  "XEON_*",
  "SSH_AUTH_SOCK",
  "DBUS_SESSION_BUS_ADDRESS",
  "XDG_RUNTIME_DIR",
  "WSL_INTEROP",
  "WSL_DISTRO_NAME",
  "NODE_OPTIONS",
  "BUN_OPTIONS",
];

export interface FileInfo {
  name: string;
  path: string;
  kind: FileKind;
  size: number;
  mtimeMs: number;
}

export interface TextLine {
  text: string;
  terminated: boolean;
}

export interface TextLineReader {
  readLine(context: CancelScope): Promise<Result<TextLine | undefined, FileError>>;
  close(context: CancelScope): Promise<void>;
}

export interface LineScan {
  newlines: number;
  start: number;
  end: number;
  firstLineEnd: number;
  lastLineStart: number;
  selectedBytes: number;
  firstLineBytes: number;
}

export interface BinaryReader {
  info(context: CancelScope): Promise<Result<FileInfo, FileError>>;
  read(
    offset: number,
    length: number,
    context: CancelScope,
  ): Promise<Result<Uint8Array, FileError>>;
  scanLines(
    options: { startLine: number; endLine?: number },
    context: CancelScope,
  ): Promise<Result<LineScan, FileError>>;
  close(context: CancelScope): Promise<void>;
}

export interface DirReader {
  next(
    maxEntries: number,
    context: CancelScope,
  ): Promise<Result<{ entries: FileInfo[]; done: boolean }, FileError>>;
  close(context: CancelScope): Promise<void>;
}

export interface WatchTarget {
  path: string;
  recursive?: boolean;
  exclude?: { hidden?: boolean; names?: readonly string[] };
}

export type WatchChange = { paths: string[] } | { overflow: true } | { error: FileError };

export interface FileWatcher {
  readonly mode: "native" | "polling";
  close(context: CancelScope): Promise<void>;
}

export interface FileSystem {
  readonly id: string;
  cwd: string;
  absolutePath(path: string, context: CancelScope): Promise<Result<string, FileError>>;
  joinPath(parts: string[], context: CancelScope): Promise<Result<string, FileError>>;
  readTextFile(path: string, context: CancelScope): Promise<Result<string, FileError>>;
  openTextLineReader(
    path: string,
    context: CancelScope,
  ): Promise<Result<TextLineReader, FileError>>;
  readTextLines(
    path: string,
    options: { maxLines?: number } | undefined,
    context: CancelScope,
  ): Promise<Result<string[], FileError>>;
  readBinaryFile(path: string, context: CancelScope): Promise<Result<Uint8Array, FileError>>;
  openBinaryReader(
    path: string,
    options: { noFollow?: boolean } | undefined,
    context: CancelScope,
  ): Promise<Result<BinaryReader, FileError>>;
  writeFile(
    path: string,
    content: string | Uint8Array,
    context: CancelScope,
  ): Promise<Result<void, FileError>>;
  appendFile(
    path: string,
    content: string | Uint8Array,
    context: CancelScope,
  ): Promise<Result<void, FileError>>;
  truncateFile(path: string, size: number, context: CancelScope): Promise<Result<void, FileError>>;
  flushFile(path: string, context: CancelScope): Promise<Result<void, FileError>>;
  renameFile(
    sourcePath: string,
    destinationPath: string,
    context: CancelScope,
  ): Promise<Result<void, FileError>>;
  fileInfo(path: string, context: CancelScope): Promise<Result<FileInfo, FileError>>;
  listDir(path: string, context: CancelScope): Promise<Result<FileInfo[], FileError>>;
  openDirReader(path: string, context: CancelScope): Promise<Result<DirReader, FileError>>;
  watch(
    targets: readonly WatchTarget[],
    onChange: (change: WatchChange) => void,
    context: CancelScope,
  ): Promise<Result<FileWatcher, FileError>>;
  canonicalPath(path: string, context: CancelScope): Promise<Result<string, FileError>>;
  exists(path: string, context: CancelScope): Promise<Result<boolean, FileError>>;
  createDir(
    path: string,
    options: { recursive?: boolean } | undefined,
    context: CancelScope,
  ): Promise<Result<void, FileError>>;
  remove(
    path: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
    context: CancelScope,
  ): Promise<Result<void, FileError>>;
  createTempDir(
    prefix: string | undefined,
    context: CancelScope,
  ): Promise<Result<string, FileError>>;
  createTempFile(
    options: { prefix?: string; suffix?: string } | undefined,
    context: CancelScope,
  ): Promise<Result<string, FileError>>;
  cleanup(context: CancelScope): Promise<void>;
}

export interface ShellSpillOptions {
  afterBytes: number;
  afterLines: number;
}

export interface ShellOutputWindow {
  maxBytes: number;
  maxLines: number;
  minIntervalMs: number;
  bytesPerSecond: number;
}

export interface ShellOutputSkip {
  bytes: number;
  newlines: number;
  endsWithNewline: boolean;
}

export interface ShellOutputInfo {
  stream: "stdout" | "stderr";
  skipped?: ShellOutputSkip;
}

/** secrets의 env 모드 lease(L0.secrets.spec §3.6 withEnv)에 넘길 맥락을 함께 싣는다 [제안, M1] */
export interface SecretEnvRequest {
  /** env 이름 → 비밀 참조 */
  readonly refs: Readonly<Record<string, SecretRef>>;
  /** mode는 "env", target은 연결 코드가 명령줄에서 채운다. purpose, toolCallId, approval(ApprovalEvidence)은 호출자(L1 tools)가 채운다 */
  readonly ctx: Omit<UseCtx, "mode" | "target">;
}

export interface ShellExecOptions {
  cwd?: string;
  /** 자식 env에 더할 이름과 값. 허용 목록 규칙을 통과해야 한다 */
  env?: Record<string, string>;
  /** Xeon 연결 코드에서는 "허용 목록 기본 env를 물려받는가"로 뜻이 바뀐다 */
  inheritEnv?: boolean;
  /** 초 단위. 원본과 같다 */
  timeout?: number;
  onOutput?: (text: string, context: CancelScope, info: ShellOutputInfo) => void;
  spill?: ShellSpillOptions;
  window?: ShellOutputWindow;
  /** [제안] Xeon 추가, M1. env 이름 → 비밀 참조와 사용 맥락. 값은 spawn 직전에만 env에 들어간다 */
  secretEnv?: SecretEnvRequest;
}

export interface ShellExecResult {
  exitCode: number;
  spillPath?: string;
  /** [제안] Xeon 추가. 데코레이터가 붙인 실행 정보. 값(비밀, 파일 내용)은 싣지 않는다 */
  sandbox?: SandboxRunReport;
}

export interface Shell {
  exec(
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: CancelScope,
  ): Promise<Result<ShellExecResult, ExecutionError>>;
  cleanup(context: CancelScope): Promise<void>;
}

export interface ExecutionEnv extends FileSystem, Shell {}

/** 기다리지 않는 실행의 핸들. 모양이 L0.process.spec §3.1 BackgroundStopper와 같아 등록자가 그대로 넘긴다 */
export interface BackgroundExecHandle {
  readonly pid: number;
  /** graceful: 프로세스 그룹에 SIGTERM(win32는 taskkill /T). force: killProcessTree. 이미 끝났으면 바로 이행 */
  stop(mode: "graceful" | "force"): Promise<void>;
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
}

/** xeon.exec 서비스. 서비스 값 자체가 ExecutionEnv이고, 작업 디렉터리가 다른 파생 env를 만든다 */
export interface ExecService extends ExecutionEnv {
  /** 같은 구현과 설정을 쓰고 cwd만 다른 env. 파생 env의 cleanup은 그 env가 시작한 명령만 끝낸다 */
  withCwd(cwd: string): ExecutionEnv;
  /** [제안] 종료를 기다리지 않는 실행. spawn이 끝나면 이행한다. timeout은 받지 않는다 */
  startBackground(
    command: string | readonly string[],
    options: Omit<ShellExecOptions, "timeout" | "spill"> | undefined,
    context: CancelScope,
  ): Promise<Result<BackgroundExecHandle, ExecutionError>>;
}

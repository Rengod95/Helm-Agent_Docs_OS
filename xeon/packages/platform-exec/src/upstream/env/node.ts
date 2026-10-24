import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, createWriteStream, type Dir, type Stats, type WriteStream } from "node:fs";
import {
  access,
  appendFile,
  type FileHandle,
  lstat,
  mkdir,
  mkdtemp,
  opendir,
  open as openFile,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, constants as osConstants, tmpdir } from "node:os";
// XEON-PATCH: P15
import { basename, isAbsolute, join, resolve as resolveAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
// XEON-PATCH: P14
// XEON-PATCH: P16
import { attempt, attemptAsync, eachAsync, repeatAsync, type Logger } from "@xeon/contracts";
// XEON-PATCH: P1
import type { CancelScope as Context } from "@xeon/contracts/services";
// XEON-PATCH: P3
import type { ExecPlatformProvider, ShellConfig } from "../../provider.ts";
import { StreamDecoder } from "./decode.ts";
import {
  type BinaryReader,
  type DirReader,
  type ExecutionEnv,
  ExecutionError,
  err,
  FileError,
  type FileInfo,
  type FileKind,
  type FileWatcher,
  type LineScan,
  ok,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type ShellOutputInfo,
  type TextLine,
  type TextLineReader,
  closeBestEffort,
  toError,
  type WatchChange,
  type WatchTarget,
} from "./index.ts";
import { LineScanner } from "./line-scan.ts";
import { NodeFileWatcher, type NodeWatchOptions } from "./node-watch.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;
const EXIT_STDIO_GRACE_MS = 100;
const SPILL_HIGH_WATER_MARK = 1024 * 1024;
/** Largest single read of a `BinaryReader`, so a huge `length` allocates only as much as the file yields. */
const BINARY_READ_CHUNK = 1024 * 1024;

type SpillChunk = string | Uint8Array;

function resolveTimeoutMs(timeout: number | undefined): Result<number | undefined, ExecutionError> {
  if (timeout === undefined) return ok(undefined);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    return err(
      new ExecutionError("timeout", "Invalid timeout: must be a finite number of seconds"),
    );
  }

  const timeoutMs = timeout * 1000;
  if (timeoutMs > MAX_TIMEOUT_MS) {
    return err(
      new ExecutionError("timeout", `Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`),
    );
  }
  return ok(timeoutMs);
}

// XEON-PATCH: P3
// XEON-PATCH: P17
export function resolvePath(cwd: string, path: string, platform: ExecPlatformProvider): string {
  let normalized = path;
  if (normalized === "~") {
    normalized = homedir();
    // XEON-PATCH: P3
  } else if (
    normalized.startsWith("~/") ||
    (platform.backslashTilde && normalized.startsWith("~\\"))
  ) {
    normalized = join(homedir(), normalized.slice(2));
  } else if (normalized.startsWith("file://")) {
    // XEON-PATCH: P14
    const filePath = attempt(() => fileURLToPath(normalized));
    // Keep malformed URLs as ordinary paths so filesystem methods preserve their non-throwing contract.
    if (filePath.ok) normalized = filePath.value;
  }
  return isAbsolute(normalized) ? resolveAbsolute(normalized) : resolveAbsolute(cwd, normalized);
}

function fileKindFromStats(stats: {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): FileKind | undefined {
  if (stats.isFile()) return "file";
  if (stats.isDirectory()) return "directory";
  if (stats.isSymbolicLink()) return "symlink";
  return undefined;
}

function fileInfoFromStats(
  path: string,
  stats: {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    size: number;
    mtimeMs: number;
  },
): Result<FileInfo, FileError> {
  const kind = fileKindFromStats(stats);
  if (!kind) return err(new FileError("invalid", "Unsupported file type", path));
  return ok({
    name: basename(path),
    path,
    kind,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function toFileError(error: unknown, fallbackPath?: string): FileError {
  if (error instanceof FileError) return error;
  const cause = toError(error);
  const nodeError = isNodeError(error) ? error : undefined;
  const path = typeof nodeError?.path === "string" ? nodeError.path : fallbackPath;
  if (nodeError) {
    const message = nodeError.message;
    // XEON-PATCH: P15
    switch (nodeError.code ?? "") {
      case "ABORT_ERR":
        return new FileError("aborted", message, path, cause);
      case "ENOENT":
        return new FileError("not_found", message, path, cause);
      case "EACCES":
      case "EPERM":
        return new FileError("permission_denied", message, path, cause);
      case "ENOTDIR":
        return new FileError("not_directory", message, path, cause);
      case "EISDIR":
        return new FileError("is_directory", message, path, cause);
      case "EINVAL":
        return new FileError("invalid", message, path, cause);
      // xeon-disable-next-line xeon/switch-default-never -- errno 코드는 열린 외부 문자열이다. 모르는 코드는 unknown FileError로 묶는다 (eng.typescript.guide TY-14)
      default:
        // 그 밖의 errno는 아래 "unknown"으로 묶는다(열린 외부 값, eng.typescript.guide TY-14)
        break;
    }
  }
  return new FileError("unknown", cause.message, path, cause);
}

// XEON-PATCH: P15
function abortResult(
  signal: AbortSignal | undefined,
  path?: string,
): Result<never, FileError> | undefined {
  return signal?.aborted ? err(new FileError("aborted", "aborted", path)) : undefined;
}

async function pathExists(path: string): Promise<boolean> {
  // XEON-PATCH: P14
  return (await attemptAsync(() => access(path, constants.F_OK))).ok;
}

async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  // XEON-PATCH: P3
  platform: ExecPlatformProvider,
): Promise<{ stdout: string; status: number | null }> {
  return await new Promise((resolve) => {
    let stdout = "";
    // XEON-PATCH: P14
    const spawned = attempt(() =>
      spawn(command, args, {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      }),
    );
    if (!spawned.ok) {
      resolve({ stdout: "", status: null });
      return;
    }
    const child: ReturnType<typeof spawn> = spawned.value;
    const timeout = setTimeout(() => {
      // XEON-PATCH: P3
      if (child.pid) platform.killProcessTree(child.pid);
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve({ stdout: "", status: null });
    });
    child.on("close", (status) => {
      clearTimeout(timeout);
      resolve({ stdout, status });
    });
  });
}

// XEON-PATCH: P3
async function findBashOnPath(platform: ExecPlatformProvider): Promise<string | null> {
  // XEON-PATCH: P3
  const [lookupCommand, ...lookupArgs] = platform.bashLookup;
  // XEON-PATCH: P3
  const result = await runCommand(lookupCommand, lookupArgs, 5000, platform);
  if (result.status !== 0 || !result.stdout) return null;
  const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
  return firstMatch && (await pathExists(firstMatch)) ? firstMatch : null;
}

// XEON-PATCH: P3
// XEON-PATCH: P17
export async function getShellConfig(
  customShellPath: string | undefined,
  platform: ExecPlatformProvider,
): Promise<Result<ShellConfig, ExecutionError>> {
  if (customShellPath) {
    if (await pathExists(customShellPath)) {
      // XEON-PATCH: P3
      return ok(platform.bashConfig(customShellPath));
    }
    return err(
      new ExecutionError("shell_unavailable", `Custom shell path not found: ${customShellPath}`),
    );
  }
  // XEON-PATCH: P3
  const candidates = platform.shellCandidates();
  // XEON-PATCH: P15
  const found = await eachAsync(candidates, async (candidate) =>
    (await pathExists(candidate)) ? { value: candidate } : undefined,
  );
  if (found !== undefined) {
    // XEON-PATCH: P3
    return ok(platform.bashConfig(found.value));
  }
  // XEON-PATCH: P3
  const bashOnPath = await findBashOnPath(platform);
  if (bashOnPath) {
    // XEON-PATCH: P3
    return ok(platform.bashConfig(bashOnPath));
  }
  // XEON-PATCH: P3
  if (platform.fallbackShell !== undefined) return ok(platform.fallbackShell);
  return err(
    new ExecutionError(
      "shell_unavailable",
      `No bash shell found. Options:\n` +
        `  1. Install Git for Windows: https://git-scm.com/download/win\n` +
        `  2. Add your bash to PATH (Cygwin, MSYS2, etc.)\n` +
        "  3. Configure an explicit shellPath\n\n" +
        `Searched Git Bash in:\n${candidates.map((path) => `  ${path}`).join("\n")}`,
    ),
  );
}

function getShellEnv(
  baseEnv?: NodeJS.ProcessEnv,
  extraEnv?: Record<string, string>,
  inheritEnv = true,
): NodeJS.ProcessEnv {
  if (!inheritEnv) return { ...extraEnv };
  return {
    ...process.env,
    ...baseEnv,
    ...extraEnv,
  };
}

// XEON-PATCH: P15
function signalNumber(signal: NodeJS.Signals): number | undefined {
  return osConstants.signals[signal];
}

// XEON-PATCH: P15
function waitForStreamFinish(stream: WriteStream): Promise<void> {
  return new Promise<void>((resolve) => {
    stream.once("error", () => resolve());
    stream.once("finish", resolve);
    stream.end();
  });
}

function waitForChildProcess(
  child: ChildProcess,
  spillIsDraining: () => boolean,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  // XEON-PATCH: P15
  return new Promise((resolve, reject) => {
    let settled = false;
    let exited = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let postExitTimer: ReturnType<typeof setTimeout> | undefined;
    let stdoutEnded = child.stdout === null;
    let stderrEnded = child.stderr === null;

    const cleanup = (): void => {
      if (postExitTimer) clearTimeout(postExitTimer);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.removeListener("close", onClose);
      child.stdout?.removeListener("end", onStdoutEnd);
      child.stderr?.removeListener("end", onStderrEnd);
      child.stdout?.removeListener("data", onData);
      child.stderr?.removeListener("data", onData);
    };
    const finalize = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({ code: exitCode, signal: exitSignal });
    };
    const maybeFinalizeAfterExit = (): void => {
      if (exited && stdoutEnded && stderrEnded) finalize();
    };
    const armIdleTimer = (): void => {
      if (postExitTimer) clearTimeout(postExitTimer);
      postExitTimer = setTimeout(() => {
        if (spillIsDraining()) armIdleTimer();
        else finalize();
      }, EXIT_STDIO_GRACE_MS);
    };
    const onData = (): void => {
      if (exited && !settled) armIdleTimer();
    };
    const onStdoutEnd = (): void => {
      stdoutEnded = true;
      maybeFinalizeAfterExit();
    };
    const onStderrEnd = (): void => {
      stderrEnded = true;
      maybeFinalizeAfterExit();
    };
    const onError = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
      maybeFinalizeAfterExit();
      if (!settled) armIdleTimer();
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      exitCode = code;
      exitSignal = signal;
      finalize();
    };

    child.stdout?.once("end", onStdoutEnd);
    child.stderr?.once("end", onStderrEnd);
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
    child.once("close", onClose);
  });
}

/** Strict LF reader; Node readline does not report whether its final line was newline-terminated. */
class NodeTextLineReader implements TextLineReader {
  private readonly file: Awaited<ReturnType<typeof openFile>>;
  private readonly path: string;
  private readonly decoder = new StreamDecoder();
  private readonly chunk = new Uint8Array(64 * 1024);
  private byteOffset = 0;
  private buffered = "";
  private ended = false;
  private closed = false;
  // XEON-PATCH: P16
  private readonly logger: Logger | undefined;

  // XEON-PATCH: P16
  constructor(file: Awaited<ReturnType<typeof openFile>>, path: string, logger?: Logger) {
    this.file = file;
    this.path = path;
    this.logger = logger;
  }

  async readLine(context: Context): Promise<Result<TextLine | undefined, FileError>> {
    const aborted = abortResult(context.abortSignal, this.path);
    if (aborted) return aborted;
    if (this.closed) return err(new FileError("invalid", "Text line reader is closed", this.path));

    try {
      // XEON-PATCH: P15
      return await repeatAsync<Result<TextLine | undefined, FileError>>(async () => {
        const newline = this.buffered.indexOf("\n");
        if (newline !== -1) {
          const text = this.buffered.slice(0, newline);
          this.buffered = this.buffered.slice(newline + 1);
          return { value: ok({ text, terminated: true }) };
        }
        if (this.ended) {
          if (this.buffered.length === 0) return { value: ok(undefined) };
          const text = this.buffered;
          this.buffered = "";
          return { value: ok({ text, terminated: false }) };
        }

        // Explicit positions allow an aborted read to be retried without skipping bytes.
        const { bytesRead } = await this.file.read(
          this.chunk,
          0,
          this.chunk.length,
          this.byteOffset,
        );
        const afterReadAbort = abortResult(context.abortSignal, this.path);
        if (afterReadAbort) return { value: afterReadAbort };
        this.byteOffset += bytesRead;
        if (bytesRead === 0) {
          this.buffered += this.decoder.decode();
          this.ended = true;
        } else {
          this.buffered += this.decoder.decode(this.chunk.subarray(0, bytesRead));
        }
        return undefined;
      });
    } catch (error) {
      return err(toFileError(error, this.path));
    }
  }

  async close(_context: Context): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.buffered = "";
    // Closing is best-effort, including after cancellation or an earlier I/O failure.
    await closeBestEffort(this.file, this.logger);
  }
}

function closedResult<TValue>(what: string, path: string): Result<TValue, FileError> {
  return err(new FileError("invalid", `${what} is closed`, path));
}

class NodeBinaryReader implements BinaryReader {
  private readonly file: FileHandle;
  private readonly path: string;
  private closed = false;
  // XEON-PATCH: P16
  private readonly logger: Logger | undefined;

  // XEON-PATCH: P16
  constructor(file: FileHandle, path: string, logger?: Logger) {
    this.file = file;
    this.path = path;
    this.logger = logger;
  }

  async info(context: Context): Promise<Result<FileInfo, FileError>> {
    const aborted = abortResult(context.abortSignal, this.path);
    if (aborted) return aborted;
    if (this.closed) return closedResult("Binary reader", this.path);
    try {
      return fileInfoFromStats(this.path, await this.file.stat());
    } catch (error) {
      return err(toFileError(error, this.path));
    }
  }

  async read(
    offset: number,
    length: number,
    context: Context,
  ): Promise<Result<Uint8Array, FileError>> {
    const aborted = abortResult(context.abortSignal, this.path);
    if (aborted) return aborted;
    if (this.closed) return closedResult("Binary reader", this.path);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length < 0
    ) {
      return err(
        new FileError("invalid", "Offset and length must be non-negative safe integers", this.path),
      );
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      // XEON-PATCH: P15
      const interrupted = await repeatAsync<Result<never, FileError> | undefined>(async () => {
        if (total >= length) return { value: undefined };
        const chunk = new Uint8Array(Math.min(length - total, BINARY_READ_CHUNK));
        const { bytesRead } = await this.file.read(chunk, 0, chunk.length, offset + total);
        const afterReadAbort = abortResult(context.abortSignal, this.path);
        if (afterReadAbort) return { value: afterReadAbort };
        if (bytesRead === 0) return { value: undefined };
        chunks.push(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
        total += bytesRead;
        return undefined;
      });
      if (interrupted) return interrupted;
    } catch (error) {
      return err(toFileError(error, this.path));
    }
    // XEON-PATCH: P15
    const [onlyChunk] = chunks;
    if (onlyChunk !== undefined && chunks.length === 1) return ok(onlyChunk);
    const bytes = new Uint8Array(total);
    let position = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, position);
      position += chunk.length;
    }
    return ok(bytes);
  }

  async scanLines(
    options: { startLine: number; endLine?: number },
    context: Context,
  ): Promise<Result<LineScan, FileError>> {
    const aborted = abortResult(context.abortSignal, this.path);
    if (aborted) return aborted;
    if (this.closed) return closedResult("Binary reader", this.path);
    // XEON-PATCH: P14
    const created = attempt(() => new LineScanner(options.startLine, options.endLine));
    if (!created.ok) return err(new FileError("invalid", "Invalid line range", this.path));
    const scanner = created.value;
    const chunk = new Uint8Array(64 * 1024);
    let position = 0;
    try {
      // XEON-PATCH: P15
      return await repeatAsync<Result<LineScan, FileError>>(async () => {
        const { bytesRead } = await this.file.read(chunk, 0, chunk.length, position);
        const afterReadAbort = abortResult(context.abortSignal, this.path);
        if (afterReadAbort) return { value: afterReadAbort };
        if (bytesRead === 0) return { value: ok(scanner.finish()) };
        scanner.push(chunk.subarray(0, bytesRead));
        position += bytesRead;
        return undefined;
      });
    } catch (error) {
      return err(toFileError(error, this.path));
    }
  }

  async close(_context: Context): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await closeBestEffort(this.file, this.logger);
  }
}

class NodeDirReader implements DirReader {
  private readonly dir: Dir;
  private readonly path: string;
  private done = false;
  private closed = false;
  // XEON-PATCH: P16
  private readonly logger: Logger | undefined;

  // XEON-PATCH: P16
  constructor(dir: Dir, path: string, logger?: Logger) {
    this.dir = dir;
    this.path = path;
    this.logger = logger;
  }

  async next(
    maxEntries: number,
    context: Context,
  ): Promise<Result<{ entries: FileInfo[]; done: boolean }, FileError>> {
    const aborted = abortResult(context.abortSignal, this.path);
    if (aborted) return aborted;
    if (this.closed) return closedResult("Directory reader", this.path);
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      return err(new FileError("invalid", "maxEntries must be a positive safe integer", this.path));
    }
    const entries: FileInfo[] = [];
    try {
      // XEON-PATCH: P15
      const interrupted = await repeatAsync<Result<never, FileError> | undefined>(async () => {
        if (this.done || entries.length >= maxEntries) return { value: undefined };
        const entry = await this.dir.read();
        if (entry === null) {
          this.done = true;
          return { value: undefined };
        }
        const loopAbort = abortResult(context.abortSignal, this.path);
        if (loopAbort) return { value: loopAbort };
        const entryPath = resolveAbsolute(this.path, entry.name);
        let stats: Stats;
        try {
          stats = await lstat(entryPath);
        } catch (error) {
          // Removed between enumeration and lstat: not part of the listing any more.
          if (isNodeError(error) && error.code === "ENOENT") return undefined;
          return { value: err(toFileError(error, entryPath)) };
        }
        const info = fileInfoFromStats(entryPath, stats);
        if (info.ok) entries.push(info.value);
        return undefined;
      });
      if (interrupted) return interrupted;
      return ok({ entries, done: this.done });
    } catch (error) {
      return err(toFileError(error, this.path));
    }
  }

  async close(_context: Context): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await closeBestEffort(this.dir, this.logger);
  }
}

function symlinkRefused(path: string, cause?: Error): FileError {
  return new FileError("invalid", "Refusing to follow a symbolic link", path, cause);
}

export class NodeExecutionEnv implements ExecutionEnv {
  /** Every local environment sees the same files. */
  readonly id: string = "node:local";
  cwd: string;
  // XEON-PATCH: P8
  private shellPath: string | undefined;
  // XEON-PATCH: P8
  private shellEnv: NodeJS.ProcessEnv | undefined;
  private watchOptions: NodeWatchOptions;
  // XEON-PATCH: P3
  private platform: ExecPlatformProvider;
  // XEON-PATCH: P16
  private logger: Logger | undefined;
  private activeChildPids = new Set<number>();

  // XEON-PATCH: P3
  constructor(options: {
    cwd: string;
    platform: ExecPlatformProvider;
    shellPath?: string;
    shellEnv?: NodeJS.ProcessEnv;
    watch?: Omit<NodeWatchOptions, "platform" | "logger">;
    // XEON-PATCH: P16
    logger?: Logger;
  }) {
    this.cwd = options.cwd;
    // XEON-PATCH: P3
    this.platform = options.platform;
    this.shellPath = options.shellPath;
    this.shellEnv = options.shellEnv;
    // XEON-PATCH: P3
    this.watchOptions = {
      ...options.watch,
      platform: options.platform,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    };
    // XEON-PATCH: P16
    this.logger = options.logger;
  }

  async watch(
    targets: readonly WatchTarget[],
    onChange: (change: WatchChange) => void,
    context: Context,
  ): Promise<Result<FileWatcher, FileError>> {
    const aborted = abortResult(context.abortSignal);
    if (aborted) return aborted;
    try {
      const watcher = await NodeFileWatcher.open(
        targets,
        // XEON-PATCH: P3
        (path) => resolvePath(this.cwd, path, this.platform),
        onChange,
        this.watchOptions,
      );
      const afterOpenAbort = abortResult(context.abortSignal);
      if (afterOpenAbort) {
        await watcher.close(context);
        return afterOpenAbort;
      }
      return ok(watcher);
    } catch (error) {
      return err(toFileError(error));
    }
  }

  // XEON-PATCH: P15
  absolutePath(path: string, _context: Context): Promise<Result<string, FileError>> {
    // XEON-PATCH: P3
    return Promise.resolve(ok(resolvePath(this.cwd, path, this.platform)));
  }

  // XEON-PATCH: P15
  joinPath(parts: string[], _context: Context): Promise<Result<string, FileError>> {
    return Promise.resolve(ok(join(...parts)));
  }

  async exec(
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    const signal = context.abortSignal;
    if (signal?.aborted) return err(new ExecutionError("aborted", "aborted"));
    const timeoutMsResult = resolveTimeoutMs(options?.timeout);
    if (!timeoutMsResult.ok) return err(timeoutMsResult.error);
    const timeoutMs = timeoutMsResult.value;

    // XEON-PATCH: P3
    const cwd = options?.cwd ? resolvePath(this.cwd, options.cwd, this.platform) : this.cwd;
    // A string runs through the shell; an argv array runs its program directly, without shell parsing.
    let program: string;
    let args: readonly string[];
    let stdinCommand: string | undefined;
    if (typeof command === "string") {
      // XEON-PATCH: P3
      const shellConfig = await getShellConfig(this.shellPath, this.platform);
      if (!shellConfig.ok) return shellConfig;
      const commandFromStdin = shellConfig.value.commandTransport === "stdin";
      program = shellConfig.value.shell;
      args = commandFromStdin ? shellConfig.value.args : [...shellConfig.value.args, command];
      stdinCommand = commandFromStdin ? command : undefined;
    } else {
      const [first, ...rest] = command;
      if (first === undefined)
        return err(new ExecutionError("spawn_error", "Empty argv: no program to run"));
      program = first;
      args = rest;
    }
    try {
      await access(cwd, constants.F_OK);
    } catch (error) {
      const cause = toError(error);
      return err(
        new ExecutionError(
          "spawn_error",
          `Working directory does not exist: ${cwd}\nCannot execute bash commands.`,
          cause,
        ),
      );
    }

    // XEON-PATCH: P15
    return await new Promise((resolve) => {
      let settled = false;
      let timedOut = false;
      let callbackError: ExecutionError | undefined;
      let spillError: ExecutionError | undefined;
      let child: ReturnType<typeof spawn> | undefined;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const spillPrefix: SpillChunk[] = [];
      let spillPath: string | undefined;
      const spillQueue: SpillChunk[] = [];
      let spillStart: Promise<void> | undefined;
      let spillStream: WriteStream | undefined;
      let spillBackpressured = false;

      const onAbort = () => {
        // XEON-PATCH: P3
        if (child?.pid) this.platform.killProcessTree(child.pid);
      };
      const failCallback = (error: unknown) => {
        if (callbackError !== undefined) return;
        const cause = toError(error);
        callbackError = new ExecutionError("callback_error", cause.message, cause);
        onAbort();
      };
      // One decoder per stream, so a character split across chunks of one stream survives interleaving.
      const stdoutDecoder = new StreamDecoder();
      const stderrDecoder = new StreamDecoder();
      // No output reaches the caller after exec() settled, for example from a descendant holding stdio open.
      const emit = (text: string, stream: ShellOutputInfo["stream"]): void => {
        if (
          settled ||
          text === "" ||
          options?.onOutput === undefined ||
          callbackError !== undefined
        )
          return;
        try {
          options.onOutput(text, context, { stream });
        } catch (error) {
          failCallback(error);
        }
      };
      // Output seen before the spill starts: counted against the thresholds and kept for the spill's prefix.
      let seenBytes = 0;
      let seenNewlines = 0;

      const settle = (result: Result<ShellExecResult, ExecutionError>) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        if (signal) signal.removeEventListener("abort", onAbort);
        if (child?.pid) this.activeChildPids.delete(child.pid);
        resolve(result);
      };
      const pauseOutput = () => {
        child?.stdout?.pause();
        child?.stderr?.pause();
      };
      const resumeOutput = () => {
        if (callbackError || spillError || timedOut || signal?.aborted || spillBackpressured)
          return;
        child?.stdout?.resume();
        child?.stderr?.resume();
      };
      const failSpill = (error: unknown) => {
        if (spillError !== undefined) return;
        const cause = toError(error);
        spillError = new ExecutionError(
          "unknown",
          `Failed to preserve complete shell output: ${cause.message}`,
          cause,
        );
        spillBackpressured = false;
        onAbort();
      };
      const writeSpill = (chunk: SpillChunk): void => {
        if (spillStream === undefined || chunk.length === 0) return;
        if (spillStream.write(chunk) || spillBackpressured) return;
        spillBackpressured = true;
        pauseOutput();
        spillStream.once("drain", () => {
          spillBackpressured = false;
          resumeOutput();
        });
      };
      const startSpill = (chunk: SpillChunk): void => {
        if (spillStream !== undefined) {
          writeSpill(chunk);
          return;
        }
        spillQueue.push(chunk);
        if (spillStart !== undefined) return;
        pauseOutput();
        spillStart = (async () => {
          const created = await this.createTempFile(
            { prefix: "pi-output-", suffix: ".log" },
            context,
          );
          if (!created.ok) throw created.error;
          spillPath = created.value;
          spillStream = createWriteStream(spillPath, {
            flags: "a",
            highWaterMark: SPILL_HIGH_WATER_MARK,
          });
          spillStream.on("error", failSpill);
          for (const queued of spillQueue) writeSpill(queued);
          spillQueue.length = 0;
        })()
          .catch(failSpill)
          .finally(resumeOutput);
      };
      const finishSpill = async (): Promise<void> => {
        await spillStart;
        const stream = spillStream;
        if (stream === undefined || spillError !== undefined || stream.destroyed) return;
        // XEON-PATCH: P15
        await waitForStreamFinish(stream);
      };

      try {
        child = spawn(program, args, {
          cwd,
          // XEON-PATCH: P3
          detached: this.platform.detachedSpawn,
          env: getShellEnv(this.shellEnv, options?.env, options?.inheritEnv),
          stdio: [stdinCommand === undefined ? "ignore" : "pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        if (child.pid) this.activeChildPids.add(child.pid);
        if (stdinCommand !== undefined) {
          child.stdin?.on("error", () => {});
          child.stdin?.end(stdinCommand);
        }
      } catch (error) {
        const cause = toError(error);
        settle(err(new ExecutionError("spawn_error", cause.message, cause)));
        return;
      }

      // XEON-PATCH: P15
      const armTimeout = (): void => {
        if (timeoutMs === undefined) return;
        timeoutId = setTimeout(() => {
          timedOut = true;
          onAbort();
        }, timeoutMs);
      };
      armTimeout();

      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }

      const feed =
        (source: ShellOutputInfo["stream"], decoder: StreamDecoder) => (chunk: Uint8Array) => {
          emit(decoder.decode(chunk), source);
          const spill = options?.spill;
          if (spill === undefined || chunk.length === 0) return;
          if (spillStart !== undefined) {
            startSpill(chunk);
            return;
          }
          seenBytes += chunk.length;
          for (
            let index = chunk.indexOf(0x0a);
            index !== -1;
            index = chunk.indexOf(0x0a, index + 1)
          )
            seenNewlines++;
          const lines = seenNewlines + (chunk[chunk.length - 1] === 0x0a ? 0 : 1);
          if (seenBytes <= spill.afterBytes && lines <= spill.afterLines) {
            spillPrefix.push(chunk);
            return;
          }
          for (const prefix of spillPrefix) startSpill(prefix);
          spillPrefix.length = 0;
          startSpill(chunk);
        };
      child.stdout?.on("data", feed("stdout", stdoutDecoder));
      child.stderr?.on("data", feed("stderr", stderrDecoder));

      // XEON-PATCH: P15
      const onChildExit = async ({
        code,
        signal: exitSignal,
      }: {
        code: number | null;
        signal: NodeJS.Signals | null;
      }): Promise<void> => {
        await finishSpill();
        emit(stdoutDecoder.decode(), "stdout");
        emit(stderrDecoder.decode(), "stderr");
        if (callbackError) {
          settle(err(callbackError));
          return;
        }
        const interrupted = timedOut
          ? new ExecutionError("timeout", `timeout:${options?.timeout}`)
          : signal?.aborted
            ? new ExecutionError("aborted", "aborted")
            : undefined;
        if (interrupted !== undefined) {
          if (spillPath !== undefined) interrupted.spillPath = spillPath;
          settle(err(interrupted));
          return;
        }
        if (spillError) {
          settle(err(spillError));
          return;
        }
        // A process killed by a signal (e.g. OOM killer) has no exit code; map it
        // to the conventional 128 + signal number so callers do not mistake it
        // for a successful exit.
        const exitCode = code ?? (exitSignal ? 128 + (signalNumber(exitSignal) ?? 0) : 1);
        settle(ok({ exitCode, ...(spillPath === undefined ? {} : { spillPath }) }));
      };
      void waitForChildProcess(
        child,
        () =>
          spillError === undefined &&
          spillStart !== undefined &&
          (spillStream === undefined || spillBackpressured),
      ).then(onChildExit, (error: unknown) => {
        const cause = toError(error);
        settle(err(new ExecutionError("spawn_error", cause.message, cause)));
      });
    });
  }

  async openTextLineReader(
    path: string,
    context: Context,
  ): Promise<Result<TextLineReader, FileError>> {
    // XEON-PATCH: P3
    const resolved = resolvePath(this.cwd, path, this.platform);
    const aborted = abortResult(context.abortSignal, resolved);
    if (aborted) return aborted;
    try {
      const file = await openFile(resolved, "r");
      const afterOpenAbort = abortResult(context.abortSignal, resolved);
      if (afterOpenAbort) {
        await closeBestEffort(file, this.logger);
        return afterOpenAbort;
      }
      return ok(new NodeTextLineReader(file, resolved, this.logger));
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async readTextFile(path: string, context: Context): Promise<Result<string, FileError>> {
    // XEON-PATCH: P3
    const resolved = resolvePath(this.cwd, path, this.platform);
    const signal = context.abortSignal;
    const aborted = abortResult(signal, resolved);
    if (aborted) return aborted;
    try {
      return ok(await readFile(resolved, { encoding: "utf8", signal }));
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async readTextLines(
    path: string,
    options: { maxLines?: number } | undefined,
    context: Context,
  ): Promise<Result<string[], FileError>> {
    if (options?.maxLines !== undefined && options.maxLines <= 0) return ok([]);
    const opened = await this.openTextLineReader(path, context);
    if (!opened.ok) return opened;
    const lines: string[] = [];
    const maxLines = options?.maxLines;
    try {
      // XEON-PATCH: P15
      const failed = await repeatAsync<Result<never, FileError> | undefined>(async () => {
        if (maxLines !== undefined && lines.length >= maxLines) return { value: undefined };
        const line = await opened.value.readLine(context);
        if (!line.ok) return { value: line };
        if (line.value === undefined) return { value: undefined };
        lines.push(line.value.text);
        return undefined;
      });
      return failed ?? ok(lines);
    } finally {
      await opened.value.close(context);
    }
  }

  async readBinaryFile(path: string, context: Context): Promise<Result<Uint8Array, FileError>> {
    // XEON-PATCH: P3
    const resolved = resolvePath(this.cwd, path, this.platform);
    const signal = context.abortSignal;
    const aborted = abortResult(signal, resolved);
    if (aborted) return aborted;
    try {
      return ok(await readFile(resolved, { signal }));
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async openBinaryReader(
    path: string,
    options: { noFollow?: boolean } | undefined,
    context: Context,
  ): Promise<Result<BinaryReader, FileError>> {
    // XEON-PATCH: P3
    const resolved = resolvePath(this.cwd, path, this.platform);
    const aborted = abortResult(context.abortSignal, resolved);
    if (aborted) return aborted;
    const noFollow = options?.noFollow === true;
    let file: FileHandle | undefined;
    try {
      let flags = constants.O_RDONLY;
      // XEON-PATCH: P3
      if (this.platform.noFollow === "lstat_precheck") {
        // Windows has no O_NOFOLLOW; check the final component before opening (not race-free).
        if (noFollow && (await lstat(resolved)).isSymbolicLink())
          return err(symlinkRefused(resolved));
      } else {
        // Nonblocking, so opening a FIFO does not wait for a writer.
        flags |= constants.O_NONBLOCK;
        if (noFollow) flags |= constants.O_NOFOLLOW;
      }
      file = await openFile(resolved, flags);
      const stats = await file.stat();
      if (!stats.isFile()) {
        await closeBestEffort(file, this.logger);
        return err(
          stats.isDirectory()
            ? new FileError(
                "is_directory",
                "EISDIR: illegal operation on a directory, read",
                resolved,
              )
            : new FileError("invalid", "Not a regular file", resolved),
        );
      }
      const afterOpenAbort = abortResult(context.abortSignal, resolved);
      if (afterOpenAbort) {
        await closeBestEffort(file, this.logger);
        return afterOpenAbort;
      }
      return ok(new NodeBinaryReader(file, resolved, this.logger));
    } catch (error) {
      await closeBestEffort(file, this.logger);
      // O_NOFOLLOW reports a final-component symlink as ELOOP (EMLINK on some BSDs).
      if (noFollow && isNodeError(error) && (error.code === "ELOOP" || error.code === "EMLINK")) {
        return err(symlinkRefused(resolved, toError(error)));
      }
      return err(toFileError(error, resolved));
    }
  }

  async writeFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ): Promise<Result<void, FileError>> {
    // XEON-PATCH: P3
    const resolved = resolvePath(this.cwd, path, this.platform);
    const signal = context.abortSignal;
    const aborted = abortResult(signal, resolved);
    if (aborted) return aborted;
    try {
      await mkdir(resolveAbsolute(resolved, ".."), { recursive: true });
      const afterMkdirAbort = abortResult(signal, resolved);
      if (afterMkdirAbort) return afterMkdirAbort;
      await writeFile(resolved, content, { signal });
      return ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async appendFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ): Promise<Result<void, FileError>> {
    // XEON-PATCH: P3
    const resolved = resolvePath(this.cwd, path, this.platform);
    const signal = context.abortSignal;
    const aborted = abortResult(signal, resolved);
    if (aborted) return aborted;
    try {
      await mkdir(resolveAbsolute(resolved, ".."), { recursive: true });
      const afterMkdirAbort = abortResult(signal, resolved);
      if (afterMkdirAbort) return afterMkdirAbort;
      await appendFile(resolved, content);
      const afterAppendAbort = abortResult(signal, resolved);
      return afterAppendAbort ?? ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async truncateFile(
    path: string,
    size: number,
    context: Context,
  ): Promise<Result<void, FileError>> {
    // XEON-PATCH: P3
    const resolved = resolvePath(this.cwd, path, this.platform);
    const signal = context.abortSignal;
    const aborted = abortResult(signal, resolved);
    if (aborted) return aborted;
    if (!Number.isSafeInteger(size) || size < 0) {
      return err(
        new FileError("invalid", "File size must be a non-negative safe integer", resolved),
      );
    }
    let file: Awaited<ReturnType<typeof openFile>> | undefined;
    try {
      file = await openFile(resolved, "r+");
      await file.truncate(size);
      const afterTruncateAbort = abortResult(signal, resolved);
      return afterTruncateAbort ?? ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    } finally {
      await closeBestEffort(file, this.logger);
    }
  }

  async flushFile(path: string, context: Context): Promise<Result<void, FileError>> {
    // XEON-PATCH: P3
    const resolved = resolvePath(this.cwd, path, this.platform);
    const signal = context.abortSignal;
    const aborted = abortResult(signal, resolved);
    if (aborted) return aborted;
    let file: Awaited<ReturnType<typeof openFile>> | undefined;
    try {
      file = await openFile(resolved, "r+");
      // POSIX refuses to open a directory for writing; Windows opens it, so check explicitly.
      if ((await file.stat()).isDirectory())
        return err(new FileError("is_directory", "Is a directory", resolved));
      await file.sync();
      const afterSyncAbort = abortResult(signal, resolved);
      return afterSyncAbort ?? ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    } finally {
      await closeBestEffort(file, this.logger);
    }
  }

  async renameFile(
    sourcePath: string,
    destinationPath: string,
    context: Context,
  ): Promise<Result<void, FileError>> {
    // XEON-PATCH: P3
    const source = resolvePath(this.cwd, sourcePath, this.platform);
    // XEON-PATCH: P3
    const destination = resolvePath(this.cwd, destinationPath, this.platform);
    const aborted = abortResult(context.abortSignal, destination);
    if (aborted) return aborted;
    try {
      await rename(source, destination);
      return ok(undefined);
    } catch (error) {
      return err(toFileError(error, source));
    }
  }

  async fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>> {
    // XEON-PATCH: P3
    const resolved = resolvePath(this.cwd, path, this.platform);
    const aborted = abortResult(context.abortSignal, resolved);
    if (aborted) return aborted;
    try {
      return fileInfoFromStats(resolved, await lstat(resolved));
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async listDir(path: string, context: Context): Promise<Result<FileInfo[], FileError>> {
    // XEON-PATCH: P3
    const resolved = resolvePath(this.cwd, path, this.platform);
    const signal = context.abortSignal;
    const aborted = abortResult(signal, resolved);
    if (aborted) return aborted;
    try {
      const entries = await readdir(resolved, { withFileTypes: true });
      const infos: FileInfo[] = [];
      // XEON-PATCH: P15
      const failure = await eachAsync(entries, async (entry) => {
        const loopAbort = abortResult(signal, resolved);
        if (loopAbort) return { value: loopAbort };
        const entryPath = resolveAbsolute(resolved, entry.name);
        try {
          const info = fileInfoFromStats(entryPath, await lstat(entryPath));
          if (info.ok) infos.push(info.value);
        } catch (error) {
          return { value: err(toFileError(error, entryPath)) };
        }
        return undefined;
      });
      if (failure !== undefined) return failure.value;
      return ok(infos);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async openDirReader(path: string, context: Context): Promise<Result<DirReader, FileError>> {
    // XEON-PATCH: P3
    const resolved = resolvePath(this.cwd, path, this.platform);
    const aborted = abortResult(context.abortSignal, resolved);
    if (aborted) return aborted;
    try {
      const dir = await opendir(resolved);
      const afterOpenAbort = abortResult(context.abortSignal, resolved);
      if (afterOpenAbort) {
        await closeBestEffort(dir, this.logger);
        return afterOpenAbort;
      }
      return ok(new NodeDirReader(dir, resolved, this.logger));
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async canonicalPath(path: string, context: Context): Promise<Result<string, FileError>> {
    // XEON-PATCH: P3
    const resolved = resolvePath(this.cwd, path, this.platform);
    const aborted = abortResult(context.abortSignal, resolved);
    if (aborted) return aborted;
    try {
      return ok(await realpath(resolved));
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async exists(path: string, context: Context): Promise<Result<boolean, FileError>> {
    const result = await this.fileInfo(path, context);
    if (result.ok) return ok(true);
    if (result.error.code === "not_found") return ok(false);
    return err(result.error);
  }

  async createDir(
    path: string,
    options: { recursive?: boolean } | undefined,
    context: Context,
  ): Promise<Result<void, FileError>> {
    // XEON-PATCH: P3
    const resolved = resolvePath(this.cwd, path, this.platform);
    const aborted = abortResult(context.abortSignal, resolved);
    if (aborted) return aborted;
    try {
      await mkdir(resolved, { recursive: options?.recursive ?? true });
      return ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async remove(
    path: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
    context: Context,
  ): Promise<Result<void, FileError>> {
    // XEON-PATCH: P3
    const resolved = resolvePath(this.cwd, path, this.platform);
    const aborted = abortResult(context.abortSignal, resolved);
    if (aborted) return aborted;
    try {
      await rm(resolved, {
        recursive: options?.recursive ?? false,
        force: options?.force ?? false,
      });
      return ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async createTempDir(
    prefix: string | undefined,
    context: Context,
  ): Promise<Result<string, FileError>> {
    const aborted = abortResult(context.abortSignal);
    if (aborted) return aborted;
    try {
      // XEON-PATCH: P15
      const dirPrefix = prefix ?? "tmp-";
      return ok(await mkdtemp(join(tmpdir(), dirPrefix)));
    } catch (error) {
      return err(toFileError(error));
    }
  }

  async createTempFile(
    options: { prefix?: string; suffix?: string } | undefined,
    context: Context,
  ): Promise<Result<string, FileError>> {
    const dir = await this.createTempDir("tmp-", context);
    if (!dir.ok) return dir;
    const filePath = join(
      dir.value,
      `${options?.prefix ?? ""}${randomUUID()}${options?.suffix ?? ""}`,
    );
    try {
      await writeFile(filePath, "");
      return ok(filePath);
    } catch (error) {
      return err(toFileError(error, filePath));
    }
  }

  // XEON-PATCH: P15
  cleanup(_context: Context): Promise<void> {
    // XEON-PATCH: P3
    for (const pid of this.activeChildPids) this.platform.killProcessTree(pid);
    this.activeChildPids.clear();
    return Promise.resolve();
  }
}
export type { NodeWatchOptions } from "./node-watch.ts";

// XEON-PATCH: P1
// XEON-PATCH: P6
import type { CancelScope as Context, ExecutionError, FileError } from "@xeon/contracts/services";
// XEON-PATCH: P2
import { attempt, attemptAsync, type Result } from "@xeon/contracts";

// XEON-PATCH: P2
export { err, ok } from "@xeon/contracts";
// XEON-PATCH: P2
export type { Result };

// XEON-PATCH: P15
export function getOrThrow<TValue, TError extends Error>(result: Result<TValue, TError>): TValue {
  if (!result.ok) throw result.error;
  return result.value;
}

export function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  // XEON-PATCH: P14
  const serialized = attempt(() => JSON.stringify(error));
  return new Error(serialized.ok ? serialized.value : String(error));
}

// XEON-PATCH: P14
/** 던질 수 있는 비동기 조회 하나를 값으로 받는다. 실패하면 undefined(대상이 없거나 읽을 수 없다) */
export async function valueOrUndefined<TValue>(
  call: () => PromiseLike<TValue>,
): Promise<TValue | undefined> {
  const result = await attemptAsync(call);
  return result.ok ? result.value : undefined;
}

// XEON-PATCH: P14
/** 정리 단계의 close. 실패해도 원래 결과를 가리지 않도록 값으로 받아 버린다 */
export async function closeBestEffort(
  handle: { close(): Promise<void> } | undefined,
): Promise<void> {
  if (handle === undefined) return;
  await attemptAsync(() => handle.close());
}

export type FileKind = "file" | "directory" | "symlink";

// XEON-PATCH: P6
export { ExecutionError, FileError } from "@xeon/contracts/services";
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
  readLine(context: Context): Promise<Result<TextLine | undefined, FileError>>;
  close(context: Context): Promise<void>;
}

/** Positional reads from one opened regular file; all calls see the same file even if its path is renamed. */
export interface BinaryReader {
  /** Metadata of the opened file, not of whatever its path names now. */
  info(context: Context): Promise<Result<FileInfo, FileError>>;
  /** Up to `length` bytes at `offset`; fewer only at end of file. */
  read(offset: number, length: number, context: Context): Promise<Result<Uint8Array, FileError>>;
  /**
   * One pass over the file that locates lines `[startLine, endLine)` (`endLine` absent: to the end), 0-based, where line
   * `k` starts after the `k`-th newline byte. Decoded sizes are those of the text `new TextDecoder().decode(file)` would
   * produce for that range, so a byte-order mark at the start of the file is not counted.
   */
  scanLines(
    options: { startLine: number; endLine?: number },
    context: Context,
  ): Promise<Result<LineScan, FileError>>;
  close(context: Context): Promise<void>;
}

/** A file or directory to watch. It may be missing; creating it is a change. */
export interface WatchTarget {
  path: string;
  /** Watch everything below a directory, not only its entries. Symbolic links below it are not followed. */
  recursive?: boolean;
  /** Entries below `path` that are neither watched nor reported: names starting with `.`, or these names. */
  exclude?: { hidden?: boolean; names?: readonly string[] };
}

/**
 * What changed:
 * - `paths`: something at or below each path may have changed (a directory path covers its whole subtree). Calls may be
 *   spurious; a change is never missed while the watcher is healthy.
 * - `overflow`: coverage was uncertain for a while (lost events, reconnect); rescan everything that is watched.
 * - `error`: the watcher stopped, for example because the watched tree grew past the environment's limit; no calls
 *   follow.
 */
export type WatchChange = { paths: string[] } | { overflow: true } | { error: FileError };

export interface FileWatcher {
  /**
   * `native`: changes are reported within about two seconds. `polling`: the environment compares snapshots, because
   * the file system does not report changes reliably (network and FUSE file systems); a change undone between two
   * snapshots can be missed.
   */
  readonly mode: "native" | "polling";
  /** Stop watching; no `onChange` call starts after this resolves. Idempotent. */
  close(context: Context): Promise<void>;
}

/** Where lines of a file are, as `BinaryReader.scanLines` found them. */
export interface LineScan {
  /** Newline bytes in the whole file; it has `newlines + 1` lines. */
  newlines: number;
  /**
   * Byte range of the selected lines: from the start of the first to the end of the last, without the newline that
   * ends it. A selection past the last line is empty at the end of the file.
   */
  start: number;
  end: number;
  /** Where the first selected line ends: its newline, or the end of the file. */
  firstLineEnd: number;
  /** Where the last selected line starts. */
  lastLineStart: number;
  /** UTF-8 byte length of the decoded selection and of its first line. */
  selectedBytes: number;
  firstLineBytes: number;
}

/** Pages of one directory's entries. */
export interface DirReader {
  /**
   * Up to `maxEntries` entries in the order the file system returns them, continuing where the previous call stopped.
   * `done` marks the end; it may come with the last entries or with an empty page. An entry that disappears before its
   * metadata is read is skipped, as are entries of unsupported kinds. After a failed or aborted call, close the reader.
   */
  next(
    maxEntries: number,
    context: Context,
  ): Promise<Result<{ entries: FileInfo[]; done: boolean }, FileError>>;
  close(context: Context): Promise<void>;
}

/** Portable filesystem capability. Operations return failures rather than throwing. */
interface FileSystem {
  /**
   * The file namespace: equal ids see the same files at the same paths, whatever their `cwd`. Every local Node
   * environment shares one id; each container or remote host has its own.
   */
  readonly id: string;
  cwd: string;
  absolutePath(path: string, context: Context): Promise<Result<string, FileError>>;
  joinPath(parts: string[], context: Context): Promise<Result<string, FileError>>;
  readTextFile(path: string, context: Context): Promise<Result<string, FileError>>;
  openTextLineReader(path: string, context: Context): Promise<Result<TextLineReader, FileError>>;
  readTextLines(
    path: string,
    options: { maxLines?: number } | undefined,
    context: Context,
  ): Promise<Result<string[], FileError>>;
  readBinaryFile(path: string, context: Context): Promise<Result<Uint8Array, FileError>>;
  /**
   * Open a regular file for bounded positional reads. A directory fails with `is_directory`, other non-regular files
   * with `invalid`. With `noFollow`, a symbolic link as the final path component fails with `invalid` instead of being
   * followed; earlier components are still resolved.
   */
  openBinaryReader(
    path: string,
    options: { noFollow?: boolean } | undefined,
    context: Context,
  ): Promise<Result<BinaryReader, FileError>>;
  writeFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ): Promise<Result<void, FileError>>;
  appendFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ): Promise<Result<void, FileError>>;
  /** Truncate or extend a file to exactly `size` bytes. */
  truncateFile(path: string, size: number, context: Context): Promise<Result<void, FileError>>;
  /** Flush file contents and metadata needed to retrieve them from an open file handle. */
  flushFile(path: string, context: Context): Promise<Result<void, FileError>>;
  renameFile(
    sourcePath: string,
    destinationPath: string,
    context: Context,
  ): Promise<Result<void, FileError>>;
  fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>>;
  listDir(path: string, context: Context): Promise<Result<FileInfo[], FileError>>;
  openDirReader(path: string, context: Context): Promise<Result<DirReader, FileError>>;
  /**
   * Report changes to files and directories, for hosts that load resources from the environment. When the returned
   * watcher exists, coverage is established: a host that watches before it loads cannot miss a change made during the
   * load. See `WatchChange` for what is reported and `FileWatcher.mode` for how reliably.
   */
  watch(
    targets: readonly WatchTarget[],
    onChange: (change: WatchChange) => void,
    context: Context,
  ): Promise<Result<FileWatcher, FileError>>;
  canonicalPath(path: string, context: Context): Promise<Result<string, FileError>>;
  exists(path: string, context: Context): Promise<Result<boolean, FileError>>;
  createDir(
    path: string,
    options: { recursive?: boolean } | undefined,
    context: Context,
  ): Promise<Result<void, FileError>>;
  remove(
    path: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
    context: Context,
  ): Promise<Result<void, FileError>>;
  createTempDir(prefix: string | undefined, context: Context): Promise<Result<string, FileError>>;
  createTempFile(
    options: { prefix?: string; suffix?: string } | undefined,
    context: Context,
  ): Promise<Result<string, FileError>>;
  cleanup(context: Context): Promise<void>;
}

/** Spill the complete output to a temporary file once it exceeds either threshold. */
interface ShellSpillOptions {
  afterBytes: number;
  /** Complete or partial lines. */
  afterLines: number;
}

export interface ShellExecResult {
  exitCode: number;
  /** Temporary file holding the complete raw output, when the spill thresholds were exceeded. */
  spillPath?: string;
}

export interface ShellExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  inheritEnv?: boolean;
  timeout?: number;
  /**
   * Every decoded chunk of stdout and stderr as it arrives, in arrival order, with the stream it came from: raw,
   * unbounded, and unthrottled. Each stream is decoded separately, so a character split across chunks survives.
   */
  onOutput?: (text: string, context: Context, info: ShellOutputInfo) => void;
  spill?: ShellSpillOptions;
  /**
   * The caller keeps only this tail of the output, so the environment may omit output outside it and report the omission
   * as `info.skipped`. Without it, every chunk is delivered.
   */
  window?: ShellOutputWindow;
}

/**
 * The tail of the combined output a caller keeps, and how often it samples it. An environment that transfers output
 * over a slow link uses it to omit what the caller would drop anyway and to send no faster than the caller commits.
 */
interface ShellOutputWindow {
  /** UTF-8 bytes of decoded text kept at the end of the output. */
  maxBytes: number;
  /** Lines kept at the end of the output. */
  maxLines: number;
  /** Minimum pause between the caller's samples of the output. */
  minIntervalMs: number;
  /** Each sample also pauses the caller in proportion to its size at this rate. */
  bytesPerSecond: number;
}

/**
 * Output an environment omitted, measured on the decoded text `onOutput` would have received: every U+FFFD counts as
 * three bytes, and no sanitizing is applied.
 */
interface ShellOutputSkip {
  /** UTF-8 byte length of the omitted text. */
  bytes: number;
  /** Newlines (U+000A) in the omitted text. */
  newlines: number;
  /** Whether the omitted text ends with a newline. */
  endsWithNewline: boolean;
}

export interface ShellOutputInfo {
  stream: "stdout" | "stderr";
  /**
   * Output omitted immediately before this chunk, only with `window`. The chunk then holds all output after the
   * omission up to its end, and that is more than the window by at least one byte or one line: more than
   * `window.maxBytes` bytes or more than `window.maxLines` newlines. So the omitted text can never be in the kept tail.
   * The omission and such a chunk may span both streams in arrival order; `stream` then names the chunk's last stream.
   * Callers that need the streams apart do not pass `window`.
   */
  skipped?: ShellOutputSkip;
}

interface Shell {
  /**
   * Run a command. A string runs through the environment's shell. An array runs `command[0]` directly with the rest
   * as its arguments, without a shell, so they reach the program unparsed. Aborting the context or a timeout kills
   * only this command's processes.
   */
  exec(
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>>;
  /** Kill every command this environment still runs; for its owner's shutdown, never for one request. */
  cleanup(context: Context): Promise<void>;
}

export interface ExecutionEnv extends FileSystem, Shell {}

export { rangeDecoder, StreamDecoder, startsWithBom } from "./decode.ts";
export { LineScanner } from "./line-scan.ts";

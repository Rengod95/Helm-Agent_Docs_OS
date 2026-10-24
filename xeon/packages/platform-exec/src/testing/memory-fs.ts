import { posix } from "node:path";
import { attempt, err, ok, type Clock, type Result } from "@xeon/contracts";
import {
  FileError,
  type BinaryReader,
  type CancelScope,
  type DirReader,
  type FileInfo,
  type FileSystem,
  type TextLineReader,
} from "@xeon/contracts/services";
import { LineScanner } from "../upstream/env/line-scan.ts";

// L0.exec.plan §2 memoryFs. 메모리 안의 POSIX 모양 FileSystem 대역. 심볼릭 링크와 감시는 없다.

export interface MemoryFsOptions {
  /** 기본 "/" */
  readonly cwd?: string;
  /** 처음부터 있는 파일. 키는 절대 경로, 부모 디렉터리는 자동으로 만든다 */
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
  /** mtime 공급원. 기본은 항상 0 */
  readonly clock?: Clock;
}

type Node =
  | { readonly kind: "directory"; mtimeMs: number }
  | { readonly kind: "file"; data: Uint8Array; mtimeMs: number };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? encoder.encode(content) : content;
}

function fail(code: FileError["code"], message: string, path?: string): Result<never, FileError> {
  return err(new FileError(code, message, path));
}

function aborted(context: CancelScope, path?: string): Result<never, FileError> | undefined {
  return context.abortSignal?.aborted === true ? fail("aborted", "aborted", path) : undefined;
}

function done<T>(value: Result<T, FileError>): Promise<Result<T, FileError>> {
  return Promise.resolve(value);
}

function textLineReader(path: string, text: string): TextLineReader {
  let rest = text;
  let closed = false;
  return {
    readLine(context) {
      const stop = aborted(context, path);
      if (stop !== undefined) return Promise.resolve(stop);
      if (closed) return Promise.resolve(fail("invalid", "Text line reader is closed", path));
      if (rest === "") return Promise.resolve(ok(undefined));
      const newline = rest.indexOf("\n");
      if (newline === -1) {
        const line = { text: rest, terminated: false };
        rest = "";
        return Promise.resolve(ok(line));
      }
      const line = { text: rest.slice(0, newline), terminated: true };
      rest = rest.slice(newline + 1);
      return Promise.resolve(ok(line));
    },
    close() {
      closed = true;
      return Promise.resolve();
    },
  };
}

export function memoryFs(options: MemoryFsOptions = {}): FileSystem {
  const clock: Clock = options.clock ?? { now: () => 0 };
  const nodes = new Map<string, Node>([["/", { kind: "directory", mtimeMs: clock.now() }]]);
  let cwd = options.cwd ?? "/";
  let tempCounter = 0;

  const resolve = (path: string): string => posix.resolve(cwd, path);
  function ensureDir(path: string): Result<void, FileError> {
    const missing: string[] = [];
    for (let current = path; ; current = posix.dirname(current)) {
      const node = nodes.get(current);
      if (node?.kind === "file") return fail("not_directory", "Not a directory", current);
      if (node?.kind === "directory") break;
      missing.push(current);
      if (current === "/") break;
    }
    for (const dir of missing.toReversed())
      nodes.set(dir, { kind: "directory", mtimeMs: clock.now() });
    return ok(undefined);
  }

  function infoOf(path: string, node: Node): FileInfo {
    return {
      name: posix.basename(path),
      path,
      kind: node.kind,
      size: node.kind === "file" ? node.data.length : 0,
      mtimeMs: node.mtimeMs,
    };
  }

  function fileAt(path: string): Result<Extract<Node, { kind: "file" }>, FileError> {
    const node = nodes.get(path);
    if (node === undefined) return fail("not_found", "No such file or directory", path);
    if (node.kind === "directory") return fail("is_directory", "Is a directory", path);
    return ok(node);
  }

  function dirAt(path: string): Result<void, FileError> {
    const node = nodes.get(path);
    if (node === undefined) return fail("not_found", "No such file or directory", path);
    if (node.kind !== "directory") return fail("not_directory", "Not a directory", path);
    return ok(undefined);
  }

  function childrenOf(path: string): FileInfo[] {
    const result: FileInfo[] = [];
    for (const [candidate, node] of nodes) {
      if (candidate !== path && posix.dirname(candidate) === path) {
        result.push(infoOf(candidate, node));
      }
    }
    return result;
  }

  function write(
    path: string,
    content: string | Uint8Array,
    append: boolean,
  ): Result<void, FileError> {
    const existing = nodes.get(path);
    if (existing?.kind === "directory") return fail("is_directory", "Is a directory", path);
    const parent = ensureDir(posix.dirname(path));
    if (!parent.ok) return parent;
    const bytes = toBytes(content);
    if (existing === undefined || !append) {
      nodes.set(path, { kind: "file", data: Uint8Array.from(bytes), mtimeMs: clock.now() });
    } else {
      const merged = new Uint8Array(existing.data.length + bytes.length);
      merged.set(existing.data, 0);
      merged.set(bytes, existing.data.length);
      existing.data = merged;
      existing.mtimeMs = clock.now();
    }
    return ok(undefined);
  }

  for (const [path, content] of Object.entries(options.files ?? {}))
    write(resolve(path), content, false);

  function binaryReader(path: string, node: Extract<Node, { kind: "file" }>): BinaryReader {
    const snapshot = node.data;
    let closed = false;
    const closedError = (): Result<never, FileError> =>
      fail("invalid", "Binary reader is closed", path);
    return {
      info(context) {
        const stop = aborted(context, path);
        if (stop !== undefined) return Promise.resolve(stop);
        return Promise.resolve(closed ? closedError() : ok(infoOf(path, node)));
      },
      read(offset, length, context) {
        const stop = aborted(context, path);
        if (stop !== undefined) return Promise.resolve(stop);
        if (closed) return Promise.resolve(closedError());
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          !Number.isSafeInteger(length) ||
          length < 0
        ) {
          return Promise.resolve(
            fail("invalid", "Offset and length must be non-negative safe integers", path),
          );
        }
        return Promise.resolve(ok(snapshot.slice(offset, offset + length)));
      },
      scanLines(scanOptions, context) {
        const stop = aborted(context, path);
        if (stop !== undefined) return Promise.resolve(stop);
        if (closed) return Promise.resolve(closedError());
        const created = attempt(() => new LineScanner(scanOptions.startLine, scanOptions.endLine));
        if (!created.ok) return Promise.resolve(fail("invalid", "Invalid line range", path));
        created.value.push(snapshot);
        return Promise.resolve(ok(created.value.finish()));
      },
      close() {
        closed = true;
        return Promise.resolve();
      },
    };
  }

  function dirReader(path: string): DirReader {
    const pending = childrenOf(path);
    let closed = false;
    return {
      next(maxEntries, context) {
        const stop = aborted(context, path);
        if (stop !== undefined) return Promise.resolve(stop);
        if (closed) return Promise.resolve(fail("invalid", "Directory reader is closed", path));
        if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
          return Promise.resolve(
            fail("invalid", "maxEntries must be a positive safe integer", path),
          );
        }
        const entries = pending.splice(0, maxEntries);
        return Promise.resolve(ok({ entries, done: pending.length === 0 }));
      },
      close() {
        closed = true;
        return Promise.resolve();
      },
    };
  }

  return {
    id: "memory:fs",
    get cwd(): string {
      return cwd;
    },
    set cwd(value: string) {
      cwd = value;
    },
    absolutePath: (path, context) => done(aborted(context) ?? ok(resolve(path))),
    joinPath: (parts, context) => done(aborted(context) ?? ok(posix.join(...parts))),
    readTextFile(path, context) {
      const target = resolve(path);
      const file = fileAt(target);
      return done(
        aborted(context, target) ?? (file.ok ? ok(decoder.decode(file.value.data)) : file),
      );
    },
    openTextLineReader(path, context) {
      const target = resolve(path);
      const file = fileAt(target);
      return done(
        aborted(context, target) ??
          (file.ok ? ok(textLineReader(target, decoder.decode(file.value.data))) : file),
      );
    },
    readTextLines(path, readOptions, context) {
      const target = resolve(path);
      const file = fileAt(target);
      const stop = aborted(context, target);
      if (stop !== undefined) return done(stop);
      if (!file.ok) return done(file);
      const text = decoder.decode(file.value.data);
      const lines = text === "" ? [] : text.split("\n");
      if (text.endsWith("\n")) lines.pop();
      const limit = readOptions?.maxLines;
      return done(ok(limit === undefined ? lines : lines.slice(0, Math.max(0, limit))));
    },
    readBinaryFile(path, context) {
      const target = resolve(path);
      const file = fileAt(target);
      return done(aborted(context, target) ?? (file.ok ? ok(file.value.data.slice()) : file));
    },
    openBinaryReader(path, _readerOptions, context) {
      const target = resolve(path);
      const file = fileAt(target);
      return done(
        aborted(context, target) ?? (file.ok ? ok(binaryReader(target, file.value)) : file),
      );
    },
    writeFile(path, content, context) {
      const target = resolve(path);
      return done(aborted(context, target) ?? write(target, content, false));
    },
    appendFile(path, content, context) {
      const target = resolve(path);
      return done(aborted(context, target) ?? write(target, content, true));
    },
    truncateFile(path, size, context) {
      const target = resolve(path);
      const stop = aborted(context, target);
      if (stop !== undefined) return Promise.resolve(stop);
      if (!Number.isSafeInteger(size) || size < 0) {
        return done(fail("invalid", "File size must be a non-negative safe integer", target));
      }
      const file = fileAt(target);
      if (!file.ok) return done(file);
      const resized = new Uint8Array(size);
      resized.set(file.value.data.subarray(0, size));
      file.value.data = resized;
      file.value.mtimeMs = clock.now();
      return done(ok(undefined));
    },
    flushFile(path, context) {
      const target = resolve(path);
      const file = fileAt(target);
      return done(aborted(context, target) ?? (file.ok ? ok(undefined) : file));
    },
    renameFile(sourcePath, destinationPath, context) {
      const source = resolve(sourcePath);
      const destination = resolve(destinationPath);
      const stop = aborted(context, destination);
      if (stop !== undefined) return Promise.resolve(stop);
      const node = nodes.get(source);
      if (node === undefined) return done(fail("not_found", "No such file or directory", source));
      const parent = dirAt(posix.dirname(destination));
      if (!parent.ok) return done(parent);
      const moved: [string, Node][] = [];
      for (const [path, entry] of nodes) {
        if (path === source || path.startsWith(`${source}/`)) {
          moved.push([destination + path.slice(source.length), entry]);
          nodes.delete(path);
        }
      }
      for (const [path, entry] of moved) nodes.set(path, entry);
      return done(ok(undefined));
    },
    fileInfo(path, context) {
      const target = resolve(path);
      const node = nodes.get(target);
      return done(
        aborted(context, target) ??
          (node === undefined
            ? fail("not_found", "No such file or directory", target)
            : ok(infoOf(target, node))),
      );
    },
    listDir(path, context) {
      const target = resolve(path);
      const dir = dirAt(target);
      return done(aborted(context, target) ?? (dir.ok ? ok(childrenOf(target)) : dir));
    },
    openDirReader(path, context) {
      const target = resolve(path);
      const dir = dirAt(target);
      return done(aborted(context, target) ?? (dir.ok ? ok(dirReader(target)) : dir));
    },
    watch: () => done(fail("not_supported", "memoryFs does not watch files")),
    canonicalPath(path, context) {
      const target = resolve(path);
      return done(
        aborted(context, target) ??
          (nodes.has(target) ? ok(target) : fail("not_found", "No such file or directory", target)),
      );
    },
    exists: (path, context) => done(aborted(context) ?? ok(nodes.has(resolve(path)))),
    createDir(path, dirOptions, context) {
      const target = resolve(path);
      const stop = aborted(context, target);
      if (stop !== undefined) return Promise.resolve(stop);
      if (dirOptions?.recursive ?? true) return done(ensureDir(target));
      const parent = dirAt(posix.dirname(target));
      if (!parent.ok) return done(parent);
      if (nodes.has(target)) return done(fail("invalid", "File exists", target));
      nodes.set(target, { kind: "directory", mtimeMs: clock.now() });
      return done(ok(undefined));
    },
    remove(path, removeOptions, context) {
      const target = resolve(path);
      const stop = aborted(context, target);
      if (stop !== undefined) return Promise.resolve(stop);
      const node = nodes.get(target);
      if (node === undefined) {
        return done(
          removeOptions?.force === true
            ? ok(undefined)
            : fail("not_found", "No such file or directory", target),
        );
      }
      if (node.kind === "directory" && removeOptions?.recursive !== true) {
        return done(fail("is_directory", "Is a directory", target));
      }
      for (const key of nodes.keys()) {
        if (key === target || key.startsWith(`${target}/`)) nodes.delete(key);
      }
      return done(ok(undefined));
    },
    createTempDir(prefix, context) {
      const target = `/tmp/${prefix ?? "tmp-"}${++tempCounter}`;
      const stop = aborted(context);
      if (stop !== undefined) return Promise.resolve(stop);
      const created = ensureDir(target);
      return done(created.ok ? ok(target) : created);
    },
    async createTempFile(tempOptions, context) {
      const dir = await this.createTempDir("tmp-", context);
      if (!dir.ok) return dir;
      const target = posix.join(
        dir.value,
        `${tempOptions?.prefix ?? ""}${++tempCounter}${tempOptions?.suffix ?? ""}`,
      );
      const written = write(target, "", false);
      return written.ok ? ok(target) : written;
    },
    cleanup: () => Promise.resolve(),
  };
}

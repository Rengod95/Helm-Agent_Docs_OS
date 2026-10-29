import { err, ok, type Result } from "@xeon/contracts";
import {
  ExecutionError,
  FileError,
  type BinaryReader,
  type CancelScope,
  type FileInfo,
  type LineScan,
  type ShellExecOptions,
  type ShellExecResult,
} from "@xeon/contracts/services";
import { fakeExec } from "@xeon/platform-exec/testing";
import type { WorkspaceEnv } from "../../src/env.ts";

// 시험용 ExecutionEnv 대역. 이 패키지가 쓰는 메서드(WorkspaceEnv)만 구현한다.
// 출력 절단(truncateHeadOf)은 운영과 같은 구현을 @xeon/platform-exec/testing의 fakeExec로 받는다(테스트 파일의 testing 서브패스 import, DR-08).
// 파일·셸 대역은 이 파일이 직접 구현한다(운영 대역 memoryFs로의 교체는 plan §5).

type Node = { kind: "file"; bytes: Uint8Array } | { kind: "directory" };

interface ExecCall {
  readonly command: string | readonly string[];
  readonly options: ShellExecOptions | undefined;
}

interface ExecReply {
  /** onOutput으로 흘려 보낼 조각. skipped는 window가 생략했다고 알리는 값 */
  readonly chunks?: readonly {
    readonly text: string;
    readonly skipped?: { bytes: number; newlines: number; endsWithNewline: boolean };
  }[];
  readonly exitCode?: number;
  readonly spillPath?: string;
  readonly sandbox?: ShellExecResult["sandbox"];
  /** 있으면 ExecutionError로 끝난다 */
  readonly error?: { readonly code: ExecutionError["code"]; readonly spillPath?: string };
}

export interface MemoryEnv extends WorkspaceEnv {
  readonly calls: ExecCall[];
  /** 다음 exec 호출들이 차례로 쓸 응답 */
  reply(...replies: ExecReply[]): void;
  /** 파일을 쓰고 부모 디렉터리를 만든다 */
  put(path: string, content: string | Uint8Array): void;
  mkdir(path: string): void;
  symlink(path: string, target: string): void;
  /** 파일 변경 시각을 바꾼다(읽는 동안 바뀌는 시험용) */
  touch(path: string): void;
  /** 파일에 덧붙인다 */
  append(path: string, content: string): void;
  /** 같은 파일 시스템과 호출 기록을 쓰고 cwd만 다른 환경 */
  withCwd(cwd: string): MemoryEnv;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

function segmentsOf(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

function join(parts: readonly string[]): string {
  return `/${parts.join("/")}`;
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const segment of segmentsOf(path)) {
    if (segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return join(out);
}

function decodedLength(bytes: Uint8Array): number {
  return encoder.encode(decoder.decode(bytes)).length;
}

/** LineScanner(pi durable env/line-scan.ts)와 같은 값을 전체 바이트에서 직접 센다. BOM은 다루지 않는다 */
function scanBytes(bytes: Uint8Array, startLine: number, endLine: number | undefined): LineScan {
  const newlinesAt: number[] = [];
  bytes.forEach((byte, index) => {
    if (byte === 0x0a) newlinesAt.push(index);
  });
  const newlines = newlinesAt.length;
  const size = bytes.length;
  if (startLine > newlines) {
    return {
      newlines,
      start: size,
      end: size,
      firstLineEnd: size,
      lastLineStart: size,
      selectedBytes: 0,
      firstLineBytes: 0,
    };
  }
  const lineStart = (line: number): number => (line === 0 ? 0 : (newlinesAt[line - 1] ?? size) + 1);
  const lastLine = Math.min(endLine === undefined ? newlines : endLine - 1, newlines);
  const start = lineStart(startLine);
  const end = lastLine < newlines ? (newlinesAt[lastLine] ?? size) : size;
  const firstLineEnd = startLine < newlines ? (newlinesAt[startLine] ?? size) : size;
  return {
    newlines,
    start,
    end,
    firstLineEnd,
    lastLineStart: lineStart(lastLine),
    selectedBytes: decodedLength(bytes.subarray(start, end)),
    firstLineBytes: decodedLength(bytes.subarray(start, firstLineEnd)),
  };
}

export function memoryEnv(options: { readonly cwd?: string } = {}): MemoryEnv {
  const exec = fakeExec({});
  const nodes = new Map<string, Node>([["/", { kind: "directory" }]]);
  const links = new Map<string, string>();
  const mtimes = new Map<string, number>();
  const calls: ExecCall[] = [];
  const replies: ExecReply[] = [];
  let clock = 1000;

  function mkdir(path: string): void {
    const parts = segmentsOf(normalize(path));
    for (let end = 1; end <= parts.length; end++) {
      const dir = join(parts.slice(0, end));
      if (!nodes.has(dir)) nodes.set(dir, { kind: "directory" });
    }
  }

  function put(path: string, content: string | Uint8Array): void {
    const full = normalize(path);
    mkdir(join(segmentsOf(full).slice(0, -1)));
    nodes.set(full, {
      kind: "file",
      bytes: typeof content === "string" ? encoder.encode(content) : content,
    });
    mtimes.set(full, (clock += 1));
  }

  /** 심볼릭 링크를 따라 정규 경로를 만든다 */
  function realpath(path: string, depth = 0): Result<string, FileError> {
    if (depth > 20) return err(new FileError("invalid", "too many links", path));
    const parts = segmentsOf(normalize(path));
    const resolved: string[] = [];
    for (let index = 0; index < parts.length; index++) {
      resolved.push(parts[index] ?? "");
      const here = join(resolved);
      const target = links.get(here);
      if (target !== undefined) {
        const followed = realpath(
          join([...segmentsOf(target), ...parts.slice(index + 1)]),
          depth + 1,
        );
        return followed;
      }
      const node = nodes.get(here);
      if (node === undefined) return err(new FileError("not_found", `not found: ${path}`, path));
      if (node.kind === "file" && index < parts.length - 1) {
        return err(new FileError("not_directory", `not a directory: ${here}`, path));
      }
    }
    return ok(join(resolved));
  }

  function infoOf(path: string, name: string, node: Node): FileInfo {
    return {
      name,
      path,
      kind: node.kind,
      size: node.kind === "file" ? node.bytes.length : 0,
      mtimeMs: mtimes.get(path) ?? 0,
    };
  }

  function reader(path: string, bytesOf: () => Uint8Array): BinaryReader {
    return {
      info: () =>
        Promise.resolve(
          ok(infoOf(path, segmentsOf(path).at(-1) ?? "", { kind: "file", bytes: bytesOf() })),
        ),
      read: (offset, length) => Promise.resolve(ok(bytesOf().slice(offset, offset + length))),
      scanLines: ({ startLine, endLine }) =>
        Promise.resolve(ok(scanBytes(bytesOf(), startLine, endLine))),
      close: () => Promise.resolve(),
    };
  }

  function view(cwd: string): MemoryEnv {
    const env: MemoryEnv = {
      id: "memory",
      cwd,
      withCwd: (path) => view(path),
      calls,
      reply: (...next) => {
        replies.push(...next);
      },
      put,
      mkdir,
      symlink: (path, target) => {
        mkdir(join(segmentsOf(normalize(path)).slice(0, -1)));
        links.set(normalize(path), target);
      },
      touch: (path) => {
        mtimes.set(normalize(path), (clock += 1));
      },
      append: (path, content) => {
        const node = nodes.get(normalize(path));
        if (node?.kind !== "file") return;
        const added = encoder.encode(content);
        const next = new Uint8Array(node.bytes.length + added.length);
        next.set(node.bytes);
        next.set(added, node.bytes.length);
        nodes.set(normalize(path), { kind: "file", bytes: next });
        mtimes.set(normalize(path), (clock += 1));
      },
      absolutePath: (path) =>
        Promise.resolve(ok(path.startsWith("/") ? normalize(path) : normalize(`${cwd}/${path}`))),
      canonicalPath: (path) => Promise.resolve(realpath(path)),
      exists: (path) => Promise.resolve(ok(realpath(path).ok)),
      fileInfo: (path) => {
        const real = realpath(path);
        if (!real.ok) return Promise.resolve(err(real.error));
        const node = nodes.get(real.value);
        if (node === undefined) return Promise.resolve(err(new FileError("not_found", path, path)));
        return Promise.resolve(ok(infoOf(real.value, segmentsOf(real.value).at(-1) ?? "", node)));
      },
      listDir: (path) => {
        const real = realpath(path);
        if (!real.ok) return Promise.resolve(err(real.error));
        if (nodes.get(real.value)?.kind !== "directory") {
          return Promise.resolve(err(new FileError("not_directory", path, path)));
        }
        const depth = segmentsOf(real.value).length;
        const names = new Map<string, FileInfo>();
        for (const [full, node] of nodes) {
          const parts = segmentsOf(full);
          if (
            parts.length !== depth + 1 ||
            !full.startsWith(real.value === "/" ? "/" : `${real.value}/`)
          )
            continue;
          const name = parts.at(-1) ?? "";
          names.set(name, infoOf(full, name, node));
        }
        for (const full of links.keys()) {
          const parts = segmentsOf(full);
          if (
            parts.length !== depth + 1 ||
            !full.startsWith(real.value === "/" ? "/" : `${real.value}/`)
          )
            continue;
          const name = parts.at(-1) ?? "";
          names.set(name, { name, path: full, kind: "symlink", size: 0, mtimeMs: 0 });
        }
        return Promise.resolve(ok([...names.values()]));
      },
      openBinaryReader: (path) => {
        const real = realpath(path);
        if (!real.ok) return Promise.resolve(err(real.error));
        const node = nodes.get(real.value);
        if (node?.kind !== "file") {
          return Promise.resolve(
            err(new FileError("is_directory", `is a directory: ${path}`, path)),
          );
        }
        const key = real.value;
        const bytesOf = (): Uint8Array => {
          const current = nodes.get(key);
          return current?.kind === "file" ? current.bytes : new Uint8Array();
        };
        return Promise.resolve(ok(reader(key, bytesOf)));
      },
      joinPath: (parts) => Promise.resolve(ok(normalize(parts.join("/")))),
      readTextFile: (path) => {
        const real = realpath(path);
        if (!real.ok) return Promise.resolve(err(real.error));
        const node = nodes.get(real.value);
        if (node?.kind !== "file") {
          return Promise.resolve(
            err(new FileError("is_directory", `is a directory: ${path}`, path)),
          );
        }
        return Promise.resolve(ok(decoder.decode(node.bytes)));
      },
      writeFile: (path, content) => {
        put(path, typeof content === "string" ? content : content.slice());
        return Promise.resolve(ok(undefined));
      },
      flushFile: () => Promise.resolve(ok(undefined)),
      renameFile: (source, destination) => {
        const from = normalize(source);
        const node = nodes.get(from);
        if (node === undefined) {
          return Promise.resolve(err(new FileError("not_found", `not found: ${source}`, source)));
        }
        nodes.set(normalize(destination), node);
        nodes.delete(from);
        mtimes.set(normalize(destination), (clock += 1));
        return Promise.resolve(ok(undefined));
      },
      remove: (path) => {
        nodes.delete(normalize(path));
        return Promise.resolve(ok(undefined));
      },
      exec: (command, execOptions, context: CancelScope) => {
        calls.push({ command, options: execOptions });
        const next = replies.shift() ?? { exitCode: 0 };
        for (const chunk of next.chunks ?? []) {
          execOptions?.onOutput?.(chunk.text, context, {
            stream: "stdout",
            ...(chunk.skipped === undefined ? {} : { skipped: chunk.skipped }),
          });
        }
        if (next.error !== undefined) {
          const failure = new ExecutionError(next.error.code, `exec failed: ${next.error.code}`);
          if (next.error.spillPath !== undefined) failure.spillPath = next.error.spillPath;
          return Promise.resolve(err(failure));
        }
        return Promise.resolve(
          ok({
            exitCode: next.exitCode ?? 0,
            ...(next.spillPath === undefined ? {} : { spillPath: next.spillPath }),
            ...(next.sandbox === undefined ? {} : { sandbox: next.sandbox }),
          }),
        );
      },
      cleanup: () => Promise.resolve(),
      truncateHeadOf: (prefix, totals, truncation) =>
        exec.truncateHeadOf(prefix, totals, truncation),
    };
    return env;
  }

  return view(options.cwd ?? "/work");
}

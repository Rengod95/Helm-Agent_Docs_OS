import { err, ok, type Result } from "@xeon/contracts";
import { createKeyedMutex } from "../../src/fs/mutex.ts";
import type { FsEntry, FsError, FsErrorKind, FsStat, KnowledgeFs } from "../../src/fs/port.ts";
import { compareBytes } from "../../src/hash.ts";

// L2.knowledge.plan §2 testing/memory-fs.ts. KnowledgeFs의 메모리 가짜다. 읽기 기록, 심볼릭 링크, 실패 주입을 지원한다.

type Node =
  | { readonly kind: "file"; readonly bytes: Uint8Array; readonly mtimeMs: number }
  | { readonly kind: "directory" }
  | { readonly kind: "symlink"; readonly target: string };

type MemoryFsOp =
  | "readFile"
  | "stat"
  | "list"
  | "realpath"
  | "mkdirp"
  | "writeAtomic"
  | "rename"
  | "remove";

interface FailureRule {
  readonly op: MemoryFsOp;
  readonly match: (path: string) => boolean;
  readonly kind: FsErrorKind;
  remaining: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fail(path: string, kind: FsErrorKind): FsError {
  return { kind, path, code: kind };
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function join(base: string, name: string): string {
  return base === "/" ? `/${name}` : `${base}/${name}`;
}

export interface MemoryFs extends KnowledgeFs {
  /** readFile로 읽은 경로(호출 순서) */
  readonly reads: string[];
  /** 부모 디렉터리를 만들며 파일을 둔다 */
  put(path: string, content: string | Uint8Array): void;
  mkdir(path: string): void;
  symlink(path: string, target: string): void;
  /** 파일 내용. 없으면 undefined */
  text(path: string): string | undefined;
  has(path: string): boolean;
  /** 경로 아래 모든 파일(정렬된 경로 → 내용) */
  files(root: string): Map<string, string>;
  /** 조건에 맞는 다음 호출 times번을 kind로 실패시킨다 */
  failNext(op: MemoryFsOp, match: string | RegExp, kind?: FsErrorKind, times?: number): void;
  /** 흐르는 시간. put과 writeAtomic이 mtime으로 쓴다 */
  setNow(ms: number): void;
}

export function createMemoryFs(): MemoryFs {
  const nodes = new Map<string, Node>([["/", { kind: "directory" }]]);
  const failures: FailureRule[] = [];
  const reads: string[] = [];
  const withLock = createKeyedMutex();
  let now = 1_000;

  const injected = (op: MemoryFsOp, path: string): FsError | undefined => {
    const rule = failures.find((candidate) => {
      return candidate.op === op && candidate.remaining > 0 && candidate.match(path);
    });
    if (rule === undefined) return undefined;
    rule.remaining -= 1;
    return fail(path, rule.kind);
  };

  /** 심볼릭 링크를 모두 푼 경로. 중간 마디가 없으면 not_found */
  const resolveReal = (path: string): Result<string, FsError> => {
    let current = "/";
    let pending = path.split("/").filter((part) => part !== "");
    let hops = 0;
    while (pending.length > 0) {
      const [head = "", ...rest] = pending;
      const next = join(current, head);
      const node = nodes.get(next);
      if (node === undefined) return err(fail(path, "not_found"));
      if (node.kind === "symlink") {
        hops += 1;
        if (hops > 40) return err(fail(path, "io"));
        const target = node.target.split("/").filter((part) => part !== "");
        current = "/";
        pending = [...target, ...rest];
        continue;
      }
      if (rest.length > 0 && node.kind !== "directory") return err(fail(path, "not_directory"));
      current = next;
      pending = rest;
    }
    return ok(current);
  };

  const ensureDir = (path: string): void => {
    let current = "/";
    for (const part of path.split("/").filter((p) => p !== "")) {
      current = join(current, part);
      if (!nodes.has(current)) nodes.set(current, { kind: "directory" });
    }
  };

  const childrenOf = (dir: string): string[] => {
    return [...nodes.keys()].filter((key) => key !== "/" && parentOf(key) === dir);
  };

  const removeTree = (path: string): void => {
    for (const key of Array.from(nodes.keys())) {
      if (key === path || key.startsWith(`${path}/`)) nodes.delete(key);
    }
  };

  const fs: MemoryFs = {
    reads,
    put(path, content) {
      ensureDir(parentOf(path));
      const bytes = typeof content === "string" ? encoder.encode(content) : content;
      nodes.set(path, { kind: "file", bytes, mtimeMs: now });
    },
    mkdir(path) {
      ensureDir(path);
    },
    symlink(path, target) {
      ensureDir(parentOf(path));
      nodes.set(path, { kind: "symlink", target });
    },
    text(path) {
      const node = nodes.get(path);
      return node?.kind === "file" ? decoder.decode(node.bytes) : undefined;
    },
    has(path) {
      return nodes.has(path);
    },
    files(root) {
      const out = new Map<string, string>();
      for (const key of Array.from(nodes.keys()).toSorted(compareBytes)) {
        const node = nodes.get(key);
        if (node?.kind === "file" && (key === root || key.startsWith(`${root}/`))) {
          out.set(key, decoder.decode(node.bytes));
        }
      }
      return out;
    },
    failNext(op, match, kind = "io", times = 1) {
      const test =
        typeof match === "string" ? (p: string) => p.includes(match) : (p: string) => match.test(p);
      failures.push({ op, match: test, kind, remaining: times });
    },
    setNow(ms) {
      now = ms;
    },
    readFile(path) {
      reads.push(path);
      const bad = injected("readFile", path);
      if (bad !== undefined) return Promise.resolve(err(bad));
      const real = resolveReal(path);
      if (!real.ok) return Promise.resolve(err(real.error));
      const node = nodes.get(real.value);
      if (node?.kind === "directory") return Promise.resolve(err(fail(path, "is_directory")));
      if (node?.kind !== "file") return Promise.resolve(err(fail(path, "not_found")));
      return Promise.resolve(ok(node.bytes));
    },
    stat(path) {
      const bad = injected("stat", path);
      if (bad !== undefined) return Promise.resolve(err(bad));
      const real = resolveReal(path);
      if (!real.ok) return Promise.resolve(err(real.error));
      const node = nodes.get(real.value);
      if (node === undefined || node.kind === "symlink") {
        return Promise.resolve(err(fail(path, "not_found")));
      }
      const stat: FsStat =
        node.kind === "file"
          ? { kind: "file", size: node.bytes.byteLength, mtimeMs: node.mtimeMs }
          : { kind: "directory", size: 0, mtimeMs: 0 };
      return Promise.resolve(ok(stat));
    },
    list(path) {
      const bad = injected("list", path);
      if (bad !== undefined) return Promise.resolve(err(bad));
      const real = resolveReal(path);
      if (!real.ok) return Promise.resolve(err(real.error));
      if (nodes.get(real.value)?.kind !== "directory") {
        return Promise.resolve(err(fail(path, "not_directory")));
      }
      const entries: FsEntry[] = childrenOf(real.value).map((key): FsEntry => {
        const node = nodes.get(key);
        const name = key.slice(key.lastIndexOf("/") + 1);
        return { name, kind: node?.kind === "symlink" ? "symlink" : (node?.kind ?? "other") };
      });
      return Promise.resolve(ok(entries.toSorted((a, b) => compareBytes(a.name, b.name))));
    },
    realpath(path) {
      const bad = injected("realpath", path);
      if (bad !== undefined) return Promise.resolve(err(bad));
      return Promise.resolve(resolveReal(path));
    },
    mkdirp(path) {
      const bad = injected("mkdirp", path);
      if (bad !== undefined) return Promise.resolve(err(bad));
      ensureDir(path);
      return Promise.resolve(ok(undefined));
    },
    writeAtomic(path, bytes) {
      const bad = injected("writeAtomic", path);
      if (bad !== undefined) return Promise.resolve(err(bad));
      const parent = resolveReal(parentOf(path));
      if (!parent.ok) return Promise.resolve(err({ ...parent.error, path }));
      if (nodes.get(parent.value)?.kind !== "directory") {
        return Promise.resolve(err(fail(path, "not_directory")));
      }
      if (nodes.get(path)?.kind === "directory") {
        return Promise.resolve(err(fail(path, "is_directory")));
      }
      nodes.set(path, { kind: "file", bytes: new Uint8Array(bytes), mtimeMs: now });
      return Promise.resolve(ok(undefined));
    },
    rename(from, to) {
      const bad = injected("rename", from) ?? injected("rename", to);
      if (bad !== undefined) return Promise.resolve(err(bad));
      if (!nodes.has(from)) return Promise.resolve(err(fail(from, "not_found")));
      if (nodes.has(to)) return Promise.resolve(err(fail(to, "exists")));
      const parent = resolveReal(parentOf(to));
      if (!parent.ok) return Promise.resolve(err({ ...parent.error, path: to }));
      const moved = [...nodes.entries()].filter(
        ([key]) => key === from || key.startsWith(`${from}/`),
      );
      for (const [key, node] of moved) {
        nodes.delete(key);
        nodes.set(`${to}${key.slice(from.length)}`, node);
      }
      return Promise.resolve(ok(undefined));
    },
    remove(path, options) {
      const bad = injected("remove", path);
      if (bad !== undefined) return Promise.resolve(err(bad));
      const node = nodes.get(path);
      if (node === undefined) return Promise.resolve(err(fail(path, "not_found")));
      if (node.kind === "directory" && !options.recursive && childrenOf(path).length > 0) {
        return Promise.resolve(err(fail(path, "exists")));
      }
      removeTree(path);
      return Promise.resolve(ok(undefined));
    },
    withLock,
  };
  return fs;
}

import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { attempt, err, ok, type Result } from "@fresnel/contracts";

// 폴더 내용 해시(M5c §4.6.1). 같은 내용이면 파일 시스템 나열 순서와 mtime과 무관하게 같은 값이다.
// 링크는 따라가지 않고 거절한다. 해시 줄의 형식을 깨는 이름(줄바꿈, NUL)도 거절한다.

export interface TreeLimits {
  readonly maxFiles: number;
  readonly maxBytes: number;
  /** 디렉터리 깊이. 루트의 자식 디렉터리가 1이다 */
  readonly maxDepth: number;
}

const DEFAULT_TREE_LIMITS: TreeLimits = {
  maxFiles: 2000,
  maxBytes: 32 * 1024 * 1024,
  maxDepth: 16,
};

export interface TreeFile {
  /** 폴더 기준 상대 경로. `/` 구분, NFC */
  readonly path: string;
  readonly bytes: number;
  /** 소문자 16진 64자 */
  readonly sha256: string;
  /** 실행 비트(mode & 0o111)가 있는가 */
  readonly executable: boolean;
}

export interface TreeHash {
  /** `sha256:<hex64>` */
  readonly contentHash: string;
  /** 경로의 UTF-8 바이트 순 */
  readonly files: readonly TreeFile[];
}

/** 폴더를 해시할 수 없는 이유. 루트 경로는 `""`로 적는다 */
export type TreeError =
  | { readonly kind: "symlink_refused"; readonly path: string }
  | { readonly kind: "node_modules_present"; readonly path: string }
  | { readonly kind: "too_large"; readonly limit: "files" | "bytes" | "depth" }
  | { readonly kind: "unsupported_name"; readonly path: string }
  | { readonly kind: "unsupported_entry"; readonly path: string }
  | { readonly kind: "read_failed"; readonly path: string; readonly cause: unknown };

const SKIPPED_DIRS: ReadonlySet<string> = new Set([".git", ".hg", ".svn"]);
const SKIPPED_FILES: ReadonlySet<string> = new Set([".DS_Store"]);

/** 경로나 이름을 UTF-8 바이트 순으로 비교한다. 코드 포인트 순과 같다 */
export function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

interface WalkState {
  readonly limits: TreeLimits;
  readonly files: TreeFile[];
  bytes: number;
}

function walk(
  absDir: string,
  rel: string,
  depth: number,
  state: WalkState,
): Result<void, TreeError> {
  const listed = attempt(() => readdirSync(absDir, { withFileTypes: true }));
  if (!listed.ok) {
    return err({ kind: "read_failed", path: rel, cause: listed.error.cause });
  }
  const entries: readonly Dirent[] = listed.value.toSorted((a, b) => compareUtf8(a.name, b.name));
  for (const entry of entries) {
    const name = entry.name.normalize("NFC");
    const childRel = rel === "" ? name : `${rel}/${name}`;
    if (name.includes("\n") || name.includes("\0")) {
      return err({ kind: "unsupported_name", path: childRel });
    }
    if (entry.isSymbolicLink()) return err({ kind: "symlink_refused", path: childRel });
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      if (entry.name === "node_modules") {
        return err({ kind: "node_modules_present", path: childRel });
      }
      if (depth + 1 > state.limits.maxDepth) return err({ kind: "too_large", limit: "depth" });
      const sub = walk(join(absDir, entry.name), childRel, depth + 1, state);
      if (!sub.ok) return err(sub.error);
      continue;
    }
    if (!entry.isFile()) return err({ kind: "unsupported_entry", path: childRel });
    if (SKIPPED_FILES.has(entry.name)) continue;

    const absFile = join(absDir, entry.name);
    const meta = attempt(() => statSync(absFile));
    if (!meta.ok) return err({ kind: "read_failed", path: childRel, cause: meta.error.cause });
    if (state.files.length + 1 > state.limits.maxFiles) {
      return err({ kind: "too_large", limit: "files" });
    }
    if (state.bytes + meta.value.size > state.limits.maxBytes) {
      return err({ kind: "too_large", limit: "bytes" });
    }
    const content = attempt(() => readFileSync(absFile));
    if (!content.ok) {
      return err({ kind: "read_failed", path: childRel, cause: content.error.cause });
    }
    state.bytes += content.value.length;
    state.files.push({
      path: childRel,
      bytes: content.value.length,
      sha256: createHash("sha256").update(content.value).digest("hex"),
      executable: (meta.value.mode & 0o111) !== 0,
    });
  }
  return ok(undefined);
}

/**
 * 폴더 하나의 내용 해시와 파일 목록. 해시 줄은 `"<경로>\0<x|->\0<sha256>\n"`이고 경로 순으로 이어 붙인 전체의 sha256이다.
 * 동기 호출이다: 재료 포트(`MaterialPort`)가 동기 인터페이스라 그 아래 읽기도 동기여야 한다.
 */
export function hashPluginTree(
  dir: string,
  limits?: Partial<TreeLimits>,
): Result<TreeHash, TreeError> {
  const root = attempt(() => lstatSync(dir));
  if (!root.ok) return err({ kind: "read_failed", path: "", cause: root.error.cause });
  if (root.value.isSymbolicLink()) return err({ kind: "symlink_refused", path: "" });
  if (!root.value.isDirectory()) return err({ kind: "unsupported_entry", path: "" });

  const state: WalkState = { limits: { ...DEFAULT_TREE_LIMITS, ...limits }, files: [], bytes: 0 };
  const walked = walk(dir, "", 0, state);
  if (!walked.ok) return err(walked.error);

  const files = state.files.toSorted((a, b) => compareUtf8(a.path, b.path));
  const body = files
    .map((file) => `${file.path}\0${file.executable ? "x" : "-"}\0${file.sha256}\n`)
    .join("");
  const digest = createHash("sha256").update(body, "utf8").digest("hex");
  return ok({ contentHash: `sha256:${digest}`, files });
}

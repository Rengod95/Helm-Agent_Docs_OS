import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { attempt, err, ok, type Result } from "@fresnel/contracts";

// T-TEST-ISO. 켬/끔 비교와 케이스 실행은 작업 폴더의 파일을 고치므로 원래 폴더가 아니라 복사본에서 돈다. 복사본은 시스템 임시 폴더 아래 새 폴더이고
// 끝나면 지운다. 원래 폴더가 그대로인지는 `digestTree`로 앞뒤를 견줘 확인한다.
// 이 모듈은 복사와 확인만 한다. 외부 부작용 차단(네트워크, 폴더 밖 쓰기)은 실행 쪽의 샌드박스 정책이 맡고 아직 Test run에 연결하지 않았다 [미결: T-TEST-ISO 나머지].

/** 복사 상한. 넘으면 복사하지 않는다(큰 저장소를 통째로 복사하지 않게 한다) */
const MAX_FILES = 20_000;
const MAX_BYTES = 512 * 1024 * 1024;
/** 복사하지 않는 이름. 의존 폴더는 실행이 다시 받는다 */
const SKIP_NAMES: ReadonlySet<string> = new Set(["node_modules", ".git"]);

export type IsolateError =
  | { readonly kind: "too_large"; readonly files: number; readonly bytes: number }
  | { readonly kind: "io"; readonly cause: unknown };

export interface IsolatedWorkspace {
  /** 복사본 폴더(절대 경로) */
  readonly dir: string;
  /** 복사본을 지운다. 두 번 불러도 된다 */
  dispose(): void;
}

interface Walked {
  readonly files: readonly string[];
  readonly bytes: number;
}

function walk(root: string): Walked {
  const files: string[] = [];
  let bytes = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (SKIP_NAMES.has(entry.name)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) {
        files.push(full);
        bytes += statSync(full).size;
      }
    }
  }
  return { files: files.toSorted(), bytes };
}

/** 폴더의 파일 경로와 내용으로 만든 해시. 의존 폴더와 `.git`은 뺀다. 같은 내용이면 같은 값이다 */
export function digestTree(root: string): Result<string, IsolateError> {
  const walked = attempt(() => walk(root));
  if (!walked.ok) return err({ kind: "io", cause: walked.error.cause });
  const hash = createHash("sha256");
  const read = attempt(() => {
    for (const file of walked.value.files) {
      hash.update(relative(root, file));
      hash.update("\0");
      hash.update(readFileSync(file));
      hash.update("\0");
    }
  });
  if (!read.ok) return err({ kind: "io", cause: read.error.cause });
  return ok(hash.digest("hex"));
}

/** `source`를 임시 폴더로 복사한다. `parent`를 주면 그 아래에 만든다(시험용) */
export function createIsolatedWorkspace(
  source: string,
  parent: string = tmpdir(),
): Result<IsolatedWorkspace, IsolateError> {
  const walked = attempt(() => walk(source));
  if (!walked.ok) return err({ kind: "io", cause: walked.error.cause });
  if (walked.value.files.length > MAX_FILES || walked.value.bytes > MAX_BYTES) {
    return err({
      kind: "too_large",
      files: walked.value.files.length,
      bytes: walked.value.bytes,
    });
  }
  const made = attempt(() => {
    const dir = mkdtempSync(join(parent, "fresnel-eval-"));
    cpSync(source, dir, {
      recursive: true,
      filter: (path) => !SKIP_NAMES.has(path.split("/").at(-1) ?? ""),
    });
    return dir;
  });
  if (!made.ok) return err({ kind: "io", cause: made.error.cause });
  const dir = made.value;
  return ok({
    dir,
    dispose: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  });
}

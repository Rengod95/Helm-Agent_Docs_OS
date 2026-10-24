import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { err, ok, type Result } from "@xeon/contracts";
import type { BinaryName } from "@xeon/contracts/services";

// OS-12(생성 스크립트 부분), L0.os.spec §3.6. `binaries.lock.json`은 빌드 때 만든다. 소스 실행에는 없다.
// 사이드카 빌드 스크립트(DESK.3)가 번들할 바이너리를 resource 디렉터리에 놓은 뒤 이 함수로 목록을 만든다.
// 해석기(resolve.ts)가 같은 모양을 읽고 실행 직전에 SHA-256을 다시 맞춰 본다.

export interface LockInput {
  readonly name: BinaryName;
  readonly platform: string;
  readonly arch: string;
  /** resource 디렉터리 기준 상대 경로. 디렉터리 밖을 가리킬 수 없다 */
  readonly path: string;
  readonly version: string;
}

/** 목록을 만들 때 파일을 읽는 수단. 해석기의 BinaryFs 중 이 부분만 쓴다 */
export interface LockReadFs {
  readFile(path: string): Promise<Result<Uint8Array, { readonly code: string }>>;
}

export type LockGenerateError =
  | { readonly kind: "path_escapes"; readonly path: string }
  | { readonly kind: "read_failed"; readonly path: string; readonly code: string }
  | {
      readonly kind: "duplicate_entry";
      readonly name: BinaryName;
      readonly platform: string;
      readonly arch: string;
    };

/** resource 디렉터리 안의 상대 경로를 절대 경로로 바꾼다. 디렉터리 밖이거나 디렉터리 자신이면 undefined */
export function resolveInsideResource(resourceDir: string, entryPath: string): string | undefined {
  const root = resolve(resourceDir);
  const full = resolve(root, entryPath);
  const rel = relative(root, full);
  if (isAbsolute(entryPath) || rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) {
    return undefined;
  }
  return full;
}

function byEntry(a: LockInput, b: LockInput): number {
  return (
    a.name.localeCompare(b.name) ||
    a.platform.localeCompare(b.platform) ||
    a.arch.localeCompare(b.arch)
  );
}

/** 입력마다 파일을 읽어 SHA-256을 계산하고 `binaries.lock.json` 본문을 만든다. 항목 순서는 이름·플랫폼·아키텍처 순이라 같은 입력이면 같은 본문이다 */
export async function generateBinariesLock(
  resourceDir: string,
  inputs: readonly LockInput[],
  fs: LockReadFs,
): Promise<Result<string, LockGenerateError>> {
  const sorted = inputs.toSorted(byEntry);
  for (const [index, input] of sorted.entries()) {
    const previous = sorted[index - 1];
    if (previous !== undefined && byEntry(previous, input) === 0) {
      return err({
        kind: "duplicate_entry",
        name: input.name,
        platform: input.platform,
        arch: input.arch,
      });
    }
  }
  const entries = await Promise.all(
    sorted.map(async (input): Promise<Result<Record<string, string>, LockGenerateError>> => {
      const full = resolveInsideResource(resourceDir, input.path);
      if (full === undefined) return err({ kind: "path_escapes", path: input.path });
      const bytes = await fs.readFile(full);
      if (!bytes.ok) return err({ kind: "read_failed", path: input.path, code: bytes.error.code });
      return ok({
        name: input.name,
        platform: input.platform,
        arch: input.arch,
        path: input.path,
        sha256: createHash("sha256").update(bytes.value).digest("hex"),
        version: input.version,
      });
    }),
  );
  const built: Record<string, string>[] = [];
  for (const entry of entries) {
    if (!entry.ok) return entry;
    built.push(entry.value);
  }
  return ok(`${JSON.stringify({ binaries: built }, null, 2)}\n`);
}

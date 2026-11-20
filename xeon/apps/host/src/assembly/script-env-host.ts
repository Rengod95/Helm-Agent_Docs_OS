import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import type { ScriptRefReader, ScriptRefStat } from "@fresnel/ext-host";
import type { ProtectedPathEntry } from "@fresnel/contracts/services";

// 환경 모드 스크립트(가져온 훅, AGE-58 원칙 가)의 호스트 쪽 수단 둘. 조립 루트가 `LoaderIsolation`에 넘긴다.
// (1) 참조 파일을 보는 `ScriptRefReader`(크기·수정 시각, 내용 지문). (2) 보호 경로 안의 참조 파일에 대한 읽기 예외를 고르는 함수.

/** 파일 시스템으로 참조 파일을 본다. 없으면 stat가 ok(null)이고, 그 밖의 오류는 `unreadable`이다 */
export const nodeScriptRefReader: ScriptRefReader = {
  async stat(path): Promise<Result<ScriptRefStat | null, { readonly kind: "unreadable" }>> {
    const seen = await attemptAsync(() => stat(path));
    if (seen.ok) {
      return seen.value.isFile()
        ? ok({ size: seen.value.size, mtimeMs: seen.value.mtimeMs })
        : err({ kind: "unreadable" });
    }
    const cause = seen.error.cause;
    const code = cause instanceof Error && "code" in cause ? cause.code : undefined;
    return code === "ENOENT" || code === "ENOTDIR" ? ok(null) : err({ kind: "unreadable" });
  },
  async sha256(path): Promise<Result<string, { readonly kind: "unreadable" }>> {
    const hashed = await attemptAsync(
      () =>
        new Promise<string>((resolve, reject) => {
          const hash = createHash("sha256");
          const stream = createReadStream(path);
          stream.on("data", (chunk) => {
            hash.update(chunk);
          });
          stream.on("error", reject);
          stream.on("end", () => {
            resolve(hash.digest("hex"));
          });
        }),
    );
    return hashed.ok ? ok(`sha256:${hashed.value}`) : err({ kind: "unreadable" });
  },
};

/** `inside`가 `root`와 같거나 그 아래인가 */
function isUnder(root: string, inside: string): boolean {
  return inside === root || inside.startsWith(root.endsWith("/") ? root : `${root}/`);
}

/**
 * 참조 파일 가운데 읽기 보호 경로 안에 있는 것의 읽기 예외를 고른다. 보호 경로 밖의 파일은 예외가 필요 없다.
 * 보호 경로 안의 파일은: 그 폴더가 보호 경로의 엄격한 하위 폴더이면 폴더(옆 모듈 import가 깨지지 않게),
 * 보호 경로 바로 아래의 파일이면 그 파일 하나(보호 경로 폴더를 통째로 열지 않는다)다. 하네스의 토큰과 대화 기록은 계속 막힌다.
 * 목록은 정렬하고 중복을 없앤다
 */
export function readCarveOutsOf(
  protectedEntries: () => readonly ProtectedPathEntry[],
): (refPaths: readonly string[]) => readonly string[] {
  return (refPaths) => {
    const roots = protectedEntries()
      .filter((entry) => entry.access === "read_write" && entry.match !== "basename")
      .map((entry) => entry.path);
    const out = new Set<string>();
    for (const file of refPaths) {
      const holder = roots.find((root) => isUnder(root, file));
      if (holder === undefined) continue;
      const folder = dirname(file);
      out.add(folder !== holder && isUnder(holder, folder) ? folder : file);
    }
    return [...out].toSorted();
  };
}

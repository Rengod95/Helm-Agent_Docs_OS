import { realpathSync, statSync } from "node:fs";
import { attempt, err, ok, type Result } from "@fresnel/contracts";
import { matchProtectedPath, type ProtectedPathEntry } from "@fresnel/contracts/services";
import { isInside, seatbeltSafe, sortedUnique } from "./paths.ts";
import { BASENAME_SEARCH_DEPTH, expandBasenameEntries } from "./protected-paths.ts";

// L0.sandbox.spec §4.9 "script-env" 읽기 예외(`policy.readCarveOuts`). 보호 경로 읽기 거부를 Seatbelt 프로필 끝의 allow 규칙으로 이긴다.
// 대상은 정규 경로(realpath)로 고른다. 없거나 안전하지 않은 경로, 보호 경로와 같거나 보호 경로를 품은 경로, 보호 파일 이름과 맞는 파일(또는 그런 파일을 품은 폴더)은
// 받지 않는다(닫힌 실패). 보호 경로 안쪽(예: `~/.claude/hooks`)은 받는다. 메시지에는 경로를 싣지 않는다.

/** 프로필 끝에 더할 예외. 파일은 `literal`, 폴더는 `subpath`로 쓴다 */
export interface CarveOutRules {
  readonly literal: readonly string[];
  readonly subpath: readonly string[];
}

/**
 * 예외를 거부한 사유.
 * - `unsafe_or_missing`: 절대 경로가 아니거나 Seatbelt 규칙에 넣을 수 없는 문자가 있거나, 없는 경로이거나, 파일도 폴더도 아니다
 * - `protected`: 보호 경로와 같거나 그것을 품는다, 또는 보호 파일 이름과 맞는다
 */
export type CarveOutError = "unsafe_or_missing" | "protected";

export function carveOutRules(input: {
  readonly carveOuts: readonly string[];
  /** 정책의 유효 읽기 거부 경로(정규 절대 경로). 보호 경로와 정책 `readDeny`, 프로젝트 안의 보호 파일이 든다 */
  readonly readDeny: readonly string[];
  /** 보호 경로 항목 전체. 그 가운데 basename 항목으로 파일 이름을 검사한다 */
  readonly protectedEntries: readonly ProtectedPathEntry[];
}): Result<CarveOutRules, CarveOutError> {
  const basenameEntries = input.protectedEntries.filter((entry) => entry.match === "basename");
  const literal: string[] = [];
  const subpath: string[] = [];
  for (const carveOut of sortedUnique(input.carveOuts)) {
    if (!carveOut.startsWith("/") || !seatbeltSafe(carveOut)) return err("unsafe_or_missing");
    const real = attempt(() => realpathSync(carveOut));
    if (!real.ok) return err("unsafe_or_missing");
    const target = real.value;
    if (!seatbeltSafe(target)) return err("unsafe_or_missing");
    const info = attempt(() => statSync(target));
    if (!info.ok) return err("unsafe_or_missing");
    const isFile = info.value.isFile();
    if (!isFile && !info.value.isDirectory()) return err("unsafe_or_missing");
    // 보호 경로와 같거나 그것을 품은 경로는 받지 않는다. 보호 경로 안쪽은 `isInside(target, denied)`가 거짓이라 받는다
    if (input.readDeny.some((denied) => isInside(target, denied))) return err("protected");
    const named = isFile
      ? matchProtectedPath(basenameEntries, target, "read") !== undefined
      : expandBasenameEntries(basenameEntries, [target], BASENAME_SEARCH_DEPTH).readFiles.length >
        0;
    if (named) return err("protected");
    if (isFile) literal.push(target);
    else subpath.push(target);
  }
  return ok({ literal: sortedUnique(literal), subpath: sortedUnique(subpath) });
}

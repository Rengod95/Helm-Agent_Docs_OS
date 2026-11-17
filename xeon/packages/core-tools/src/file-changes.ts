import { canonicalJson, parse } from "@fresnel/contracts";
import {
  FILE_CHANGES_KEY,
  FileChangeEntrySchema,
  fileChangesOf,
  type FileChangeEntry,
} from "@fresnel/contracts/capabilities";
import type { JsonObject, JsonValue } from "@fresnel/contracts/conversation";
import { isJsonObject, isJsonValue } from "./util.ts";

// 도구 결과의 파일 변경(M5e 스펙 §5.4 F-1·F-3·F-4·F-6). 예약 키 `fileChanges`는 코어만 쓴다.
// `observed`는 코어 기능 도구(내장 write·edit 등)의 결과에서, `reported`는 플러그인 도구의 `ctx.changes.report`에서 온다.

/** `ctx.changes.report`가 받은 값을 검증해 `source: "reported"` 항목으로 바꾼다. 모양이 틀린 것은 버리고 그 수를 돌려준다 */
export function reportedEntriesOf(values: readonly unknown[]): {
  readonly entries: readonly FileChangeEntry[];
  readonly rejected: number;
} {
  const entries: FileChangeEntry[] = [];
  let rejected = 0;
  for (const value of values) {
    const checked =
      typeof value === "object" && value !== null
        ? parse(FileChangeEntrySchema, { ...value, source: "reported" })
        : undefined;
    if (checked?.ok === true) entries.push(checked.value);
    else rejected += 1;
  }
  return { entries, rejected };
}

/**
 * 결과 `details`에서 코어가 관찰한 변경을 읽는다. 코어 기능 도구(`fromCore`)의 결과만 본다. 외부 도구가 낸 모양이
 * `observed`로 잡히지 않게 하려는 것이다.
 */
export function observedEntriesOf(details: unknown, fromCore: boolean): readonly FileChangeEntry[] {
  if (!fromCore || !isJsonValue(details)) return [];
  const observed: FileChangeEntry[] = [];
  for (const entry of fileChangesOf(details)) observed.push({ ...entry, source: "observed" });
  return observed;
}

/**
 * 코어가 쓰는 `fileChanges`를 결과 `details`에 합친다. 관찰 항목이 보고 항목보다 이긴다(같은 `path`면 보고를 버린다).
 * 합칠 것이 없으면 예약 키를 두지 않는다(도구나 훅이 낸 같은 키는 지운다). 관찰 항목이 옛 `FileChange` 한 건과 같으면
 * 모양을 바꾸지 않는다(F-2). `details`가 객체가 아니면 합칠 때 그 값은 버린다.
 */
export function withFileChanges(
  details: JsonValue | null,
  observed: readonly FileChangeEntry[],
  reported: readonly FileChangeEntry[],
): JsonValue | null {
  const observedPaths = new Set(observed.map((entry) => entry.path));
  const entries = [...observed, ...reported.filter((entry) => !observedPaths.has(entry.path))];
  if (entries.length === 0) {
    return isJsonObject(details) && details[FILE_CHANGES_KEY] !== undefined
      ? withoutKey(details)
      : details;
  }
  if (canonicalJson(fileChangesOf(details)) === canonicalJson(entries)) return details;
  const base: JsonObject = isJsonObject(details) ? withoutKey(details) : {};
  return { ...base, [FILE_CHANGES_KEY]: entries };
}

function withoutKey(details: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(details).filter(([key]) => key !== FILE_CHANGES_KEY));
}

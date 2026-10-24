import { Bug } from "@xeon/contracts";
import { toJsonValue, type JsonValue } from "@xeon/contracts/conversation";
import type { Upcaster } from "@xeon/contracts/records";
import { isRecord } from "./util.ts";

/** 상태 문서 마이그레이션. 키는 출발 버전. { 1: v1→v2, 2: v2→v3 }. 순수 함수 */
export type StateMigrations = Readonly<Record<number, (previous: unknown) => unknown>>;

/**
 * GroupDef.migrations를 F Upcaster 배열로 바꾼다(L3.group-kit.spec §4.7). 순수 함수.
 * upcasters[i]는 v(i+1) → v(i+2)다(F.records.spec versioning). 길이는 version - 1이다.
 * 빠진 출발 버전은 validateGroupDef가 `state_migration_missing`으로 막으므로 여기서 만나면 Bug다.
 */
export function stateUpcasters(
  version: number,
  migrations: StateMigrations | undefined,
): readonly Upcaster[] {
  const upcasters: Upcaster[] = [];
  for (let from = 1; from < version; from += 1) {
    const step = migrations?.[from];
    if (step === undefined) throw new Bug(`state.upcaster: migrations[${from}] is missing`);
    upcasters.push((payload) => {
      if (!isRecord(payload) || !("doc" in payload)) return payload;
      return { ...payload, version: from + 1, doc: step(payload.doc) };
    });
  }
  return upcasters;
}

/**
 * X `hostOf(g).migrateState`에 넘길 함수. 저장된 문서를 version까지 한 단계씩 올린다(L3.group-kit.spec §4.7).
 * 결과가 JSON이 아니면 던진다. X가 `state_migration_failed`로 그 그룹의 로드를 실패시킨다
 */
export function migrationChain(
  version: number,
  migrations: StateMigrations | undefined,
): (doc: JsonValue, fromVersion: number) => JsonValue {
  return (doc, fromVersion) => {
    let current: unknown = doc;
    for (let from = fromVersion; from < version; from += 1) {
      const step = migrations?.[from];
      if (step === undefined) {
        throw new TypeError(`state migration from version ${from} is not defined`);
      }
      current = step(current);
    }
    const checked = toJsonValue(current);
    if (checked === undefined) throw new TypeError("state migration result is not JSON");
    return checked;
  };
}

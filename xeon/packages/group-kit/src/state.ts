import { Bug, canonicalJson, parse } from "@xeon/contracts";
import { toJsonValue, type JsonValue } from "@xeon/contracts/conversation";
import type { StateDecl } from "@xeon/contracts/extensions";
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

export const STATE_DOC_MAX_BYTES = 65_536;

/** grp.<그룹>.state.committed payload. 모양의 정본은 X.primitives.spec §4.6.1 */
export interface StateCommittedPayload {
  readonly scopeId: string;
  /** 활성 가지 위 판 */
  readonly rev: number;
  /** 같은 가지에서 그 scope의 바로 앞 상태 이벤트 id. 첫 커밋이면 null */
  readonly prevEventId: string | null;
  /** StateDecl.version */
  readonly version: number;
  readonly doc: JsonValue;
}

/**
 * x_<그룹>_state 투영 행. 열 이름과 DDL의 정본은 X.primitives.spec §4.6.1(X 소유 투영기).
 * X 열 이름을 그대로 쓴다([결정: review.decisions-2 §3 T-20]).
 */
export interface StateProjectionRow {
  readonly thread_id: string;
  readonly scope_id: string;
  /** state.committed 이벤트 id. 기본 키 */
  readonly event_id: string;
  /** 같은 가지에서 바로 앞 state.committed 이벤트 id. 첫 커밋이면 null */
  readonly prev_event_id: string | null;
  readonly rev: number;
  readonly version: number;
  readonly doc: string;
}

/** commit 전 검사 결과(L3.group-kit.spec §3.6, §4.5) */
export type StateCheck =
  | { readonly ok: true; readonly bytes: number; readonly unchanged: boolean }
  | { readonly ok: false; readonly kind: "state.schema"; readonly issues: readonly string[] }
  | {
      readonly ok: false;
      readonly kind: "state.tooLarge";
      readonly bytes: number;
      readonly limit: number;
    };

const encoder = new TextEncoder();

/**
 * commit 전 검사. 순수 함수. 스키마 검사, 직렬화 UTF-8 64 KiB 상한, 직전 값과 깊이 같은지(canonical JSON)를 본다.
 * `unchanged`가 참이면 호출한 쪽은 이벤트를 쓰지 않고 현재 값을 돌려준다(§4.5 3번).
 */
export function checkStateCommit<S>(decl: StateDecl<S>, current: Readonly<S>, next: S): StateCheck {
  const parsed = parse(decl.schema, next);
  if (!parsed.ok) {
    return {
      ok: false,
      kind: "state.schema",
      issues: parsed.error.issues.map((found) => `${found.path} ${found.message}`),
    };
  }
  const bytes = encoder.encode(JSON.stringify(next)).length;
  if (bytes > STATE_DOC_MAX_BYTES) {
    return { ok: false, kind: "state.tooLarge", bytes, limit: STATE_DOC_MAX_BYTES };
  }
  return { ok: true, bytes, unchanged: canonicalJson(current) === canonicalJson(next) };
}

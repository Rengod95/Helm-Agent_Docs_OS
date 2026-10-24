import { err, ok, type Result } from "../base/index.ts";
import type { JsonValue } from "../conversation/index.ts";
import type { DurableEventEnvelope } from "./envelope.ts";
import type { SqlTx } from "./sql.ts";
import type { Upcaster } from "./upcaster.ts";

export type { Upcaster } from "./upcaster.ts";

export interface KindVersioning {
  /** 현재 버전 */
  current: number;
  /** upcasters[i]: v(i+1) → v(i+2). 길이 = current - 1 */
  upcasters: readonly Upcaster[];
}

export type UpcasterRegistry = ReadonlyMap<string, KindVersioning>;

export type UpcastError =
  | { kind: "unknown_kind"; eventKind: string }
  | { kind: "future_version"; eventKind: string; version: number; current: number }
  | { kind: "missing_upcaster"; eventKind: string; from: number };

export type UpcastResult = Result<DurableEventEnvelope, UpcastError>;

/**
 * version을 current까지 올린 사본을 돌려준다. 원본 envelope는 바꾸지 않는다.
 * 알 수 없는 kind, 현재보다 큰 version, 빠진 업캐스터는 오류다(건너뛰고 투영하지 않는다).
 */
export function upcastEvent(event: DurableEventEnvelope, registry: UpcasterRegistry): UpcastResult {
  const versioning = registry.get(event.kind);
  if (versioning === undefined) return err({ kind: "unknown_kind", eventKind: event.kind });
  if (event.version > versioning.current) {
    return err({
      kind: "future_version",
      eventKind: event.kind,
      version: event.version,
      current: versioning.current,
    });
  }
  let payload: unknown = event.payload;
  for (let from = event.version; from < versioning.current; from += 1) {
    const upcaster = versioning.upcasters[from - 1];
    if (upcaster === undefined)
      return err({ kind: "missing_upcaster", eventKind: event.kind, from });
    payload = upcaster(payload);
  }
  return ok({ ...event, version: versioning.current, payload });
}

/** 투영 모양이나 규칙이 바뀌면 version을 올린다. DB 마이그레이션 없이 내구 이벤트를 처음부터 재생해 투영을 다시 만든다. */
export interface ProjectionVersion {
  name: string;
  version: number;
}

/**
 * 큰 백필을 청크로 나누는 마이그레이션 계약. 구현은 L0-e. 커서는 JSON 값으로 저장한다.
 * runChunk는 동기이고 실행기가 연 트랜잭션 tx를 받는다. 실행기는 같은 tx에 커서를 저장한다.
 */
export interface ChunkMigration<C extends JsonValue> {
  readonly id: string;
  readonly initialCursor: C;
  runChunk(
    tx: SqlTx,
    cursor: C,
    budget: { readonly maxRows: number },
  ): { readonly next: C | null; readonly processed: number };
}

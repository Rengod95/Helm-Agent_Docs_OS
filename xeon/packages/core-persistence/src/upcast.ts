import { assertNever, Bug, err, ok, type Result } from "@xeon/contracts";
import { Type, type TSchema } from "typebox";
import { rowInvalid, type RowFault } from "./rows.ts";
import {
  EVENT_CATALOG,
  upcastEvent,
  type CatalogEntry,
  type DurableEventEnvelope,
  type EventKindRegistry,
  type ExtensionEventKind,
  type KindVersioning,
  type ReadOnlyReason,
  type UpcastResult,
} from "@xeon/contracts/records";
import { EXT_STATE_KIND_SUFFIX, ExtStatePayloadSchema } from "./ext-state.ts";

/** 코어·도메인 카탈로그와 확장 kind 등록부를 한 번에 묻는 조회(L1.persistence.spec §4.12) */
export interface KindCatalog {
  entryOf(kind: string): CatalogEntry | undefined;
  versioningOf(kind: string): KindVersioning | undefined;
  /** 저장된 envelope를 현재 버전으로 올린 사본. 저장된 행은 바꾸지 않는다 */
  upcast(event: DurableEventEnvelope): UpcastResult;
  /**
   * `ext.commit` 경로가 쓴다. 확장 등록부(EventKindRegistry)에 없는 확장 kind를 "열린 kind"로 올린다.
   * 열린 kind의 payload는 X가 커밋 앞에서 이미 검사했다(공개 기록은 매니페스트 `recordKinds` 스키마, 상태 문서는 `StateDecl.schema`,
   * 비공개 기록은 쓰는 확장의 몫, X.primitives.spec §4.6.5). 여기서는 상태 kind의 모양만 본다. 이미 등록부에 있으면 그 항목을 돌려준다
   */
  openExtension(kind: ExtensionEventKind, version: number): CatalogEntry;
}

function isExtensionKind(kind: string): boolean {
  return kind.startsWith("x.") || kind.startsWith("grp.");
}

function payloadSchemaOfOpenKind(kind: string): TSchema {
  return kind.endsWith(EXT_STATE_KIND_SUFFIX) ? ExtStatePayloadSchema : Type.Unknown();
}

export function createKindCatalog(eventKinds?: EventKindRegistry): KindCatalog {
  const core = new Map<string, CatalogEntry>(EVENT_CATALOG.map((entry) => [entry.kind, entry]));
  // 열린 확장 kind는 프로세스 안에서만 안다. 다시 시작하면 비고, 읽기 경로는 등록되지 않은 확장 kind를 그대로 통과시킨다
  const open = new Map<string, CatalogEntry>();
  const registered = (kind: string): CatalogEntry | undefined =>
    core.get(kind) ?? eventKinds?.lookup(kind);
  const entryOf = (kind: string): CatalogEntry | undefined => registered(kind) ?? open.get(kind);
  const versioningOf = (kind: string): KindVersioning | undefined => {
    // 열린 kind는 업캐스터가 없으므로 버전 정보를 주지 않는다(읽기 경로는 그대로 통과시킨다)
    const entry = registered(kind);
    // 확장 등록부의 조회 결과에는 업캐스터 목록이 없다. 현재 버전까지는 통과시키고 낮은 버전은 아래 열기 검사가 Bug로 알린다
    return entry === undefined ? undefined : { current: entry.version, upcasters: [] };
  };
  return {
    entryOf,
    versioningOf,
    upcast(event: DurableEventEnvelope): UpcastResult {
      const versioning = versioningOf(event.kind);
      // 등록되지 않은 확장 kind는 다른 설치에서 쓴 이벤트일 수 있다. 업캐스트할 수 없으므로 그대로 통과시킨다(§4.12 표)
      if (versioning === undefined && isExtensionKind(event.kind)) return ok(event);
      const registry = new Map<string, KindVersioning>();
      if (versioning !== undefined) registry.set(event.kind, versioning);
      return upcastEvent(event, registry);
    },
    openExtension(kind: ExtensionEventKind, version: number): CatalogEntry {
      const known = registered(kind);
      if (known !== undefined) return known;
      const prior = open.get(kind);
      if (prior !== undefined && prior.version >= version) return prior;
      const entry: CatalogEntry = {
        kind,
        version,
        durable: true,
        payload: payloadSchemaOfOpenKind(kind),
      };
      open.set(kind, entry);
      return entry;
    },
  };
}

/**
 * 저장된 envelope를 현재 버전으로 올린다. 모르는 kind나 더 새 version은 다른 버전이 쓴 데이터라 row_invalid로 돌려준다.
 * 업캐스터가 빠진 경우는 코드 결함이다(Bug)
 */
export function upcastStored(
  catalog: KindCatalog,
  event: DurableEventEnvelope,
): Result<DurableEventEnvelope, RowFault> {
  const upcasted = catalog.upcast(event);
  if (upcasted.ok) return ok(upcasted.value);
  switch (upcasted.error.kind) {
    case "unknown_kind":
    case "future_version":
      return err(rowInvalid(`events.envelope ${event.kind} v${event.version}`));
    case "missing_upcaster":
      throw new Bug(`store.schema_invalid: missing upcaster for ${event.kind} v${event.version}`, {
        cause: upcasted.error,
      });
    default:
      return assertNever(upcasted.error, "upcastStored");
  }
}

/**
 * thread의 서로 다른 (kind, version) 쌍으로 쓰기 열기 가능 여부를 본다(§4.12 표).
 * - 코어 kind를 모르거나 카탈로그보다 높은 version이면 쓰기 모드로 열지 않는다.
 * - 등록되지 않은 확장 kind는 쓰기 모드로 연다. 코어 투영기는 그 이벤트의 payload를 읽지 않는다.
 * - 업캐스터가 없는 낮은 version은 코드 결함이다.
 */
export function readOnlyReasonFor(
  pairs: readonly { readonly kind: string; readonly version: number }[],
  catalog: KindCatalog,
): ReadOnlyReason | null {
  let reason: ReadOnlyReason | null = null;
  for (const pair of pairs) {
    const versioning = catalog.versioningOf(pair.kind);
    if (versioning === undefined) {
      if (!isExtensionKind(pair.kind)) reason ??= "unknown_event_kind";
      continue;
    }
    if (pair.version > versioning.current) {
      reason = "newer_event_version";
      continue;
    }
    if (pair.version < versioning.current && versioning.upcasters.length < pair.version) {
      // 확장 kind의 낮은 version은 업캐스터 목록에 없다. 코어 카탈로그는 version 1뿐이라 여기 오지 않는다
      if (isExtensionKind(pair.kind)) continue;
      throw new Bug(`store.schema_invalid: missing upcaster for ${pair.kind} v${pair.version}`);
    }
  }
  return reason;
}

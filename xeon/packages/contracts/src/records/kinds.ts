import { Type, type TSchema, type TUnsafe } from "typebox";
import { err, ok, type Result } from "../base/index.ts";
import { EVENT_CATALOG, type CatalogEntry } from "./catalog/index.ts";
import {
  CORE_AREAS,
  DOMAIN_AREAS,
  RESERVED_DOMAIN_AREAS,
  type CoreArea,
  type DomainArea,
  type EventKind,
  type ExtensionEventKind,
  type ReservedDomainArea,
} from "./kind-names.ts";
import type { Upcaster } from "./upcaster.ts";

export * from "./kind-names.ts";

/** 코어·도메인 kind: 점 하나, 소문자 snake_case */
export const CORE_KIND_PATTERN: string = "^[a-z][a-z_]*\\.[a-z][a-z_]*$";
/**
 * 확장 kind. 둘째 마디는 ExtensionName(소문자·숫자·하이픈 2~32자, 밑줄 없음, U-18),
 * 셋째 마디는 영역(L2.artifacts 확장 ArtifactKind의 셋째 마디와 같은 규칙)이다.
 */
export const EXTENSION_KIND_PATTERN: string =
  "^(x|grp)\\.[a-z][a-z0-9-]{1,31}\\.[a-z][a-z0-9_]{0,31}\\.[a-z][a-z_]*$";

const CORE_KIND_REGEX = new RegExp(CORE_KIND_PATTERN);
const EXTENSION_KIND_REGEX = new RegExp(EXTENSION_KIND_PATTERN);

export const EventKindSchema: TUnsafe<EventKind> = Type.Unsafe<EventKind>(
  Type.String({
    pattern: `(?:${CORE_KIND_PATTERN})|(?:${EXTENSION_KIND_PATTERN})`,
    minLength: 3,
    maxLength: 160,
  }),
);

export type ParsedKind =
  | { origin: "core"; area: CoreArea; name: string }
  | { origin: "domain"; area: DomainArea; name: string }
  | { origin: "extension"; ownerType: "x" | "grp"; ownerId: string; area: string; name: string };

export type KindError =
  | { kind: "malformed"; eventKind: string }
  /** 접두 없는 비코어·비도메인 영역, 예약 영역(ReservedDomainArea), 코어·도메인 영역의 미등록 이름 */
  | { kind: "reserved_area"; eventKind: string }
  /** 레지스트리 등록 충돌 */
  | { kind: "duplicate"; eventKind: string };

function isCoreArea(area: string): area is CoreArea {
  return (CORE_AREAS as readonly string[]).includes(area);
}

function isDomainArea(area: string): area is DomainArea {
  return (DOMAIN_AREAS as readonly string[]).includes(area);
}

function isReservedArea(area: string): area is ReservedDomainArea {
  return (RESERVED_DOMAIN_AREAS as readonly string[]).includes(area);
}

const MERGED_KINDS: ReadonlySet<string> = new Set(EVENT_CATALOG.map((entry) => entry.kind));

/**
 * 이벤트 kind 문자열을 해석한다(F.records.spec §3.2). 코어·도메인은 병합 카탈로그에 있는 이름만 통과한다.
 * 확장은 x.<extId>.<영역>.<이름> 또는 grp.<groupId>.<영역>.<이름>이다. 순수 함수.
 */
export function parseEventKind(kind: string): Result<ParsedKind, KindError> {
  const extension = EXTENSION_KIND_REGEX.exec(kind);
  if (extension !== null) {
    const parts = kind.split(".");
    const ownerType = parts[0] === "grp" ? "grp" : "x";
    return ok({
      origin: "extension",
      ownerType,
      ownerId: parts[1] ?? "",
      area: parts[2] ?? "",
      name: parts[3] ?? "",
    });
  }
  if (!CORE_KIND_REGEX.test(kind)) return err({ kind: "malformed", eventKind: kind });

  const [area = "", name = ""] = kind.split(".");
  if (isReservedArea(area)) return err({ kind: "reserved_area", eventKind: kind });
  if (isCoreArea(area) && MERGED_KINDS.has(kind)) return ok({ origin: "core", area, name });
  if (isDomainArea(area) && MERGED_KINDS.has(kind)) return ok({ origin: "domain", area, name });
  return err({ kind: "reserved_area", eventKind: kind });
}

/** 확장이 kind를 등록하는 타입. 구현은 X(X.primitives.spec, X.loading-trust.spec). */
export interface EventKindRegistration {
  kind: ExtensionEventKind;
  version: number;
  durable: boolean;
  payload: TSchema;
  /** upcasters[i]: v(i+1) → v(i+2). 길이 = version - 1 */
  upcasters?: readonly Upcaster[];
}

export interface EventKindRegistry {
  register(
    owner: { type: "x" | "grp"; id: string },
    entry: EventKindRegistration,
  ): Result<void, KindError>;
  lookup(kind: string): CatalogEntry | undefined;
}

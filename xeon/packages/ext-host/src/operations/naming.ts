import type { ExtensionName } from "@xeon/contracts/extensions";
import type {
  ResourceExposure,
  ResourceKind,
  ResourcePolicy,
  ResourceRecord,
} from "../primitives/resources.ts";

// 이름 충돌 규칙(X.operations.spec §3.5, §4.5). 도구, 명령, 단축키, 플래그 네 종류에 같은 규칙을 쓴다.

/** 이름 규칙을 적용하는 리소스. 나머지(provider, mcp_server, message_renderer)는 같은 이름이면 거부한다 */
export type NamedResourceKind = Extract<ResourceKind, "tool" | "command" | "shortcut" | "flag">;

export interface ResourceClaim {
  readonly kind: NamedResourceKind;
  readonly owner: ExtensionName;
  /** 등록 요청 이름(접두 없음) */
  readonly name: string;
  /** 내장 패키지(trust builtin)의 등록이면 참 */
  readonly builtin: boolean;
}

export interface ResolvedName {
  readonly claim: ResourceClaim;
  /** 항상 있는 정식 이름 */
  readonly qualified: string;
  /** 사용자·모델에 보이는 이름. 짧은 이름을 받지 못하면 qualified와 같다 */
  readonly exposed: string;
  readonly reason?: "reserved" | "conflict" | "too_long";
}

/** 내장 예약 이름. 내장 패키지의 등록과 이 목록의 이름은 외부 확장이 짧은 이름으로 쓸 수 없다 */
export interface ReservedNames {
  readonly tool: ReadonlySet<string>;
  readonly command: ReadonlySet<string>;
  readonly shortcut: ReadonlySet<string>;
  readonly flag: ReadonlySet<string>;
}

/** 예약 이름이 없다. 내장 패키지의 등록만 짧은 이름을 지킨다 */
export const NO_RESERVED_NAMES: ReservedNames = {
  tool: new Set(),
  command: new Set(),
  shortcut: new Set(),
  flag: new Set(),
};

/** 모델 도구 정식 이름의 최대 길이(F.capabilities.spec §3.1 TOOL_NAME_WIRE_PATTERN) */
const MAX_TOOL_NAME = 64;

const NAMED_KINDS: ReadonlySet<ResourceKind> = new Set(["tool", "command", "shortcut", "flag"]);

function isNamedKind(kind: ResourceKind): kind is NamedResourceKind {
  return NAMED_KINDS.has(kind);
}

/** tool: "<owner>__<name>", 그 밖: "<owner>:<name>" */
export function qualifiedName(kind: NamedResourceKind, owner: ExtensionName, name: string): string {
  return kind === "tool" ? `${owner}__${name}` : `${owner}:${name}`;
}

function groupKey(claim: ResourceClaim): string {
  return `${claim.kind}\u0000${claim.name}`;
}

/**
 * 순수 함수. 결과는 입력 순서와 무관하다(§4.5 규칙 3). 결과 배열은 입력과 같은 순서다.
 * - 내장 패키지의 등록은 짧은 이름을 받는다. 서로 다른 내장 둘이 같은 이름을 쓰면 둘 다 정식 이름이다(conflict).
 * - 외부 확장의 등록은 예약 이름이거나 내장이 쓰는 이름이면 정식 이름이다(reserved).
 * - 외부 확장 둘 이상이 같은 짧은 이름을 요청하면 모두 정식 이름이다(conflict).
 * - 정식 이름이 64자를 넘는 외부 도구는 too_long이다(등록 거부 대상)
 */
export function resolveNames(
  claims: readonly ResourceClaim[],
  reserved: ReservedNames,
): readonly ResolvedName[] {
  const builtinOwners = new Map<string, Set<string>>();
  const externalOwners = new Map<string, Set<string>>();
  for (const claim of claims) {
    const table = claim.builtin ? builtinOwners : externalOwners;
    const owners = table.get(groupKey(claim)) ?? new Set<string>();
    owners.add(claim.owner);
    table.set(groupKey(claim), owners);
  }
  return claims.map((claim): ResolvedName => {
    const qualified = qualifiedName(claim.kind, claim.owner, claim.name);
    const key = groupKey(claim);
    if (claim.builtin) {
      const conflict = (builtinOwners.get(key)?.size ?? 0) > 1;
      return conflict
        ? { claim, qualified, exposed: qualified, reason: "conflict" }
        : { claim, qualified, exposed: claim.name };
    }
    if (claim.kind === "tool" && qualified.length > MAX_TOOL_NAME) {
      return { claim, qualified, exposed: qualified, reason: "too_long" };
    }
    if (reserved[claim.kind].has(claim.name) || builtinOwners.has(key)) {
      return { claim, qualified, exposed: qualified, reason: "reserved" };
    }
    if ((externalOwners.get(key)?.size ?? 0) > 1) {
      return { claim, qualified, exposed: qualified, reason: "conflict" };
    }
    return { claim, qualified, exposed: claim.name };
  });
}

function claimOf(record: ResourceRecord & { readonly kind: NamedResourceKind }): ResourceClaim {
  return { kind: record.kind, owner: record.extension, name: record.name, builtin: record.builtin };
}

/**
 * X.primitives.spec §3.9 ResourcePolicy 구현. 집합 판정(`exposeAll`)이 레지스트리가 쓰는 주 경로이고,
 * 쌍 판정(`resolve`)은 집합 판정을 못 쓰는 호출자를 위해 들어오는 쪽만 정식 이름으로 바꾼다(rename).
 * 쌍 판정만으로는 먼저 등록된 쪽이 짧은 이름을 유지해 로드 순서 무관 규칙을 지키지 못한다(§4.5)
 */
export function createResourcePolicy(reserved: ReservedNames): ResourcePolicy {
  return {
    resolve(incoming, existing) {
      if (!isNamedKind(incoming.kind)) return { action: "reject" };
      // 같은 확장이 같은 이름을 두 번 등록하는 것은 정식 이름으로도 구분되지 않는다
      if (incoming.extension === existing.extension) return { action: "reject" };
      return {
        action: "rename",
        name: qualifiedName(incoming.kind, incoming.extension, incoming.name),
      };
    },
    exposeAll(records) {
      const named = records.filter(
        (record): record is ResourceRecord & { readonly kind: NamedResourceKind } =>
          isNamedKind(record.kind),
      );
      const resolved = resolveNames(named.map(claimOf), reserved);
      return named.map((record, index): ResourceExposure => {
        const entry = resolved[index];
        const exposed = entry?.exposed ?? record.name;
        const reason = entry?.reason;
        return reason === undefined
          ? { kind: record.kind, scopeId: record.scopeId, name: record.name, exposed }
          : { kind: record.kind, scopeId: record.scopeId, name: record.name, exposed, reason };
      });
    },
  };
}

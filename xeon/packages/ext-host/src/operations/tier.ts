import { err, ok, type Result } from "@xeon/contracts";
import type { ExtensionManifest, ExtensionName, ScopeId } from "@xeon/contracts/extensions";
import type { HandlerEntryInfo } from "../primitives/dispatch-types.ts";
import type { InstallSource, TrustLevel } from "../loading-trust/trust/levels.ts";

export type Tier = "guard" | "user" | "project" | "builtin" | "core";

/** 바깥에서 안쪽 순서. 인덱스가 순위다(X.operations.spec §3.1) */
export const TIERS: readonly ["guard", "user", "project", "builtin", "core"] = [
  "guard",
  "user",
  "project",
  "builtin",
  "core",
];

export type HookId = string;

/** 핸들러를 등록한 주체 */
export type HandlerOwner =
  | { readonly type: "extension"; readonly name: ExtensionName; readonly scopeId: ScopeId }
  | { readonly type: "hook"; readonly hookId: HookId };

/** 실패 장부와 진단의 키. "ext:<확장 이름>" 또는 "hook:<훅 id>" */
export type HandlerOwnerKey = `ext:${string}` | `hook:${string}`;

export function ownerKey(owner: HandlerOwner): HandlerOwnerKey {
  return owner.type === "extension" ? `ext:${owner.name}` : `hook:${owner.hookId}`;
}

/** primitives 레지스트리가 on 등록 때 채우는 출처 */
export interface HandlerOrigin {
  readonly owner: HandlerOwner;
  readonly tier: Tier;
  /** 확장 로드 순서. 외부 훅은 모든 확장 뒤에 설정 파일 순서로 이어 붙인다 */
  readonly loadIndex: number;
  /** 같은 주체 안의 on 호출 순서. 0부터 */
  readonly registrationIndex: number;
}

/** 전체 정렬 키 */
export type HandlerOrderKey = readonly [
  tierRank: number,
  loadIndex: number,
  registrationIndex: number,
];

/** tier 순위 함수. DispatchPolicy.tierOf 자리에 그대로 들어간다 */
export type TierOfFn = (entry: HandlerEntryInfo) => number;

/** 순수 함수. HandlerOrigin에서 전체 키를 만든다 */
export function orderKeyOf(origin: HandlerOrigin): HandlerOrderKey {
  return [TIERS.indexOf(origin.tier), origin.loadIndex, origin.registrationIndex];
}

/** 사전식 비교. 음수면 a가 먼저 */
export function compareOrderKey(a: HandlerOrderKey, b: HandlerOrderKey): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export interface TierInput {
  readonly name: ExtensionName;
  readonly source: InstallSource;
  /** X.loading-trust.spec §4.6.1의 유효 등급 */
  readonly trust: TrustLevel;
  readonly layer: ExtensionManifest["layer"];
}

export type TierError =
  /** 같은 프로세스에 싣지 않는다 */
  | { readonly kind: "untrusted"; readonly name: ExtensionName }
  /** 예: source가 project인데 trust가 builtin */
  | { readonly kind: "source_trust_mismatch"; readonly name: ExtensionName };

/** 확장 이름 → tier 표. 로더가 확장을 실을 때 채우고 tierOf가 읽는다 */
export interface TierTable {
  set(name: ExtensionName, tier: Tier): void;
  get(name: ExtensionName): Tier | undefined;
  delete(name: ExtensionName): void;
}

export function createTierTable(): TierTable {
  const tiers = new Map<ExtensionName, Tier>();
  return {
    set: (name, tier) => {
      tiers.set(name, tier);
    },
    get: (name) => tiers.get(name),
    delete: (name) => {
      tiers.delete(name);
    },
  };
}

/** tierOf 구현. 표에 없는 확장(로드 경로 밖에서 등록된 핸들러)은 가장 안쪽 순위 밖(TIERS.length)으로 둔다 */
export function tierOfFrom(table: TierTable): TierOfFn {
  return (entry) => {
    const tier = table.get(entry.extension);
    return tier === undefined ? TIERS.length : TIERS.indexOf(tier);
  };
}

/** 보안 가드 허용 목록. 이 목록의 내장 패키지만 guard tier를 받는다. L0 패키지는 on을 쓰지 않아 넣지 않는다 */
export const GUARD_EXTENSIONS: ReadonlySet<ExtensionName> = new Set(["core-tools"]);

/** 순수 함수. §4.1.2 표를 구현한다 */
export function assignTier(
  input: TierInput,
  guards: ReadonlySet<ExtensionName> = GUARD_EXTENSIONS,
): Result<Tier, TierError> {
  if (input.trust === "untrusted") return err({ kind: "untrusted", name: input.name });
  const mismatch = err({ kind: "source_trust_mismatch" as const, name: input.name });
  switch (input.source) {
    case "builtin":
      if (input.trust !== "builtin") return mismatch;
      if (guards.has(input.name)) return ok("guard");
      return ok(input.layer === "L1" ? "core" : "builtin");
    case "managed":
      // 관리 위치(2차)는 사용자 등급 상한이다. builtin을 요청한 매니페스트는 거부한다
      return input.trust === "builtin" ? mismatch : ok("guard");
    case "user":
      return input.trust === "user" ? ok("user") : mismatch;
    case "project":
      return input.trust === "project" ? ok("project") : mismatch;
    default:
      return mismatch;
  }
}

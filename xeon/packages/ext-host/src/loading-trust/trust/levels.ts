/** 신뢰 등급과 설치 위치(X.loading-trust.spec §3.1, §4.6) */

/** F.extensions.spec TrustRequestSchema의 값 집합을 확정한다 [제안] */
export type TrustLevel = "builtin" | "user" | "project" | "untrusted";

/** 높은 등급이 앞이다. 비교는 이 배열의 index로 한다 */
export const TRUST_LEVELS: readonly ["builtin", "user", "project", "untrusted"] = [
  "builtin",
  "user",
  "project",
  "untrusted",
];

/** 숫자가 작을수록 높은 등급이다 */
export function trustRank(level: TrustLevel): number {
  return TRUST_LEVELS.indexOf(level);
}

export type InstallSource = "builtin" | "managed" | "user" | "project";

export const INSTALL_SOURCES: readonly ["builtin", "managed", "user", "project"] = [
  "builtin",
  "managed",
  "user",
  "project",
];

/** 설치 위치가 정하는 상한 등급 */
export const SOURCE_TRUST: { readonly [S in InstallSource]: Exclude<TrustLevel, "untrusted"> } = {
  builtin: "builtin",
  managed: "user",
  user: "user",
  project: "project",
};

type StorageAccess = "prefix" | "none";
type IsolationRule = "forbidden" | "optional" | "notLoaded";

export interface TrustPermissions {
  readonly load: boolean;
  /** project_trust 외 지점 */
  readonly on: boolean;
  /** project_trust 지점에 on을 걸 수 있는가 */
  readonly onProjectTrust: boolean;
  readonly post: boolean;
  /** kind가 group이고 usesDrive가 참일 때 */
  readonly drive: boolean;
  /** 도구·명령·provider 등록 */
  readonly resources: boolean;
  /** 확장 접두 테이블. 격리 확장은 이 값과 무관하게 직접 접근이 없다 */
  readonly storage: StorageAccess;
  readonly isolation: IsolationRule;
}

/** §4.6.2 표의 코드형. 문서 표와 같은지 docs-consistency 테스트가 확인한다 */
export const TRUST_MATRIX: { readonly [L in TrustLevel]: TrustPermissions } = {
  builtin: {
    load: true,
    on: true,
    onProjectTrust: true,
    post: true,
    drive: true,
    resources: true,
    storage: "prefix",
    isolation: "forbidden",
  },
  user: {
    load: true,
    on: true,
    onProjectTrust: true,
    post: true,
    drive: true,
    resources: true,
    storage: "prefix",
    isolation: "optional",
  },
  project: {
    load: true,
    on: true,
    onProjectTrust: false,
    post: true,
    drive: true,
    resources: true,
    storage: "prefix",
    isolation: "optional",
  },
  untrusted: {
    load: false,
    on: false,
    onProjectTrust: false,
    post: false,
    drive: false,
    resources: false,
    storage: "none",
    isolation: "notLoaded",
  },
};

export type EffectiveTrust =
  | { readonly ok: true; readonly level: TrustLevel }
  | { readonly ok: false; readonly reason: "trust_exceeds_source" };

/**
 * 유효 등급 = min(설치 위치 상한, 매니페스트 요청). 요청이 상한보다 높으면 거부한다(X.loading-trust.spec §4.6.1).
 * 외부 확장이 builtin을 요청해 예약 이름 검사를 피하는 길을 막는다. 순수 함수
 */
export function effectiveTrust(
  source: InstallSource,
  requested: TrustLevel | undefined,
): EffectiveTrust {
  const ceiling = SOURCE_TRUST[source];
  if (requested === undefined) return { ok: true, level: ceiling };
  if (trustRank(requested) < trustRank(ceiling))
    return { ok: false, reason: "trust_exceeds_source" };
  return { ok: true, level: requested };
}

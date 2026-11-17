// 확장의 실효 격리 판정(F5, 2026-11-17 결정). 순수 함수다. 로더가 설치 전에 한 번, 설치와 다시 읽기에서 한 번 부른다.
// 규칙: builtin은 언제나 엔진 안이다. 그 밖은 설정(`ext.<이름>.isolation`)의 명시 값, 매니페스트 `isolation`, 기본 `process` 순이다.
// 설정 값 `none`이 엔진 안 실행을 허용한다. "명시"는 설정이나 매니페스트가 `process`라고 했다는 뜻이다(기본 선택과 구분한다).

/** 격리 설정 값. 설정과 매니페스트가 같은 두 값을 쓴다 */
export type IsolationMode = "none" | "process";

/** 엔진 안에서 돈다. 이유는 진단과 시험이 구분하도록 남긴다 */
export type InEngineReason =
  | "builtin"
  | "setting_none"
  | "manifest_none"
  | "default_no_port"
  | "default_drives";

/** 거부 코드. 로더가 이 값을 진단 코드로 쓴다(LoadDiagnosticCode) */
export type IsolationRefusal = "isolation_unavailable" | "isolation_drive_unsupported";

export type IsolationDecision =
  | { readonly kind: "in_engine"; readonly reason: InEngineReason }
  | { readonly kind: "process" }
  | { readonly kind: "refused"; readonly code: IsolationRefusal };

export interface IsolationInput {
  /** 설치 위치. builtin만 특별하다 */
  readonly source: "builtin" | "managed" | "user" | "project";
  /** `ext.<이름>.isolation`의 명시 값. 값이 없으면 undefined(기본값은 세지 않는다) */
  readonly setting: IsolationMode | undefined;
  /** 매니페스트 `isolation`. 없으면 undefined */
  readonly manifest: IsolationMode | undefined;
  /** 매니페스트 플러그인 중 `drives`가 참인 것이 있는가 */
  readonly hasDrives: boolean;
  /** 격리 포트와 띄우기 설정이 모두 주입되었는가 */
  readonly portAvailable: boolean;
}

/**
 * 실효 격리를 정한다. 표(위에서 아래 순서로 처음 맞는 행):
 * - builtin → 엔진 안
 * - 요청(설정이 있으면 설정, 없으면 매니페스트)이 none → 엔진 안
 * - 포트가 없음 → 명시면 `isolation_unavailable`, 기본이면 엔진 안
 * - drives가 있음 → 명시면 `isolation_drive_unsupported`, 기본이면 엔진 안
 * - 그 밖 → process
 */
export function effectiveIsolationOf(input: IsolationInput): IsolationDecision {
  if (input.source === "builtin") return { kind: "in_engine", reason: "builtin" };
  const requested = input.setting ?? input.manifest;
  if (requested === "none") {
    return {
      kind: "in_engine",
      reason: input.setting === "none" ? "setting_none" : "manifest_none",
    };
  }
  const explicit = requested === "process";
  if (!input.portAvailable) {
    return explicit
      ? { kind: "refused", code: "isolation_unavailable" }
      : { kind: "in_engine", reason: "default_no_port" };
  }
  if (input.hasDrives) {
    return explicit
      ? { kind: "refused", code: "isolation_drive_unsupported" }
      : { kind: "in_engine", reason: "default_drives" };
  }
  return { kind: "process" };
}

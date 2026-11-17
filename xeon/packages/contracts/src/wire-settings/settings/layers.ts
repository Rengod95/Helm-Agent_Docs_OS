import type { SettingKey, SettingScope } from "./def.ts";

/**
 * 높은 우선순위가 앞이다(F.wire-settings.spec §4.7 [제안], M5c §4.1.7 [결정]).
 * 관리는 잠금으로서 맨 위, 세션은 Claude Code의 플래그 자리, 프로필은 대화가 참조한 프로필과 공통 묶음의 병합 값이다.
 * 나머지는 layer-plan의 덮어쓰기 순서다. 순서는 managed > launch > profile > local > project > user > default다.
 * [미결] 관리 범위가 잠금 전용인지 관리 기본값도 두는지는 사용자 확인 대상이다. 바뀌면 이 줄과 테스트만 고친다.
 */
export const SCOPE_PRECEDENCE: readonly [
  "managed",
  "launch",
  "profile",
  "local",
  "project",
  "user",
] = ["managed", "launch", "profile", "local", "project", "user"];

/** 한 범위에서 이미 읽은 값들. 파일 읽기는 F 밖(L4·L1)이 한다. */
export interface ScopeLayer {
  readonly scope: SettingScope;
  readonly values: ReadonlyMap<SettingKey, unknown>;
  /** 파일 범위면 그 파일 경로. session이면 없음 */
  readonly path?: string;
}

export type ScopeStack = readonly ScopeLayer[];

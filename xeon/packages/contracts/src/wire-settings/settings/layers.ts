import type { SettingKey, SettingScope } from "./def.ts";

/**
 * 높은 우선순위가 앞이다(F.wire-settings.spec §4.7 [제안]).
 * 관리는 잠금으로서 맨 위, 세션은 Claude Code의 플래그 자리, 나머지는 layer-plan의 덮어쓰기 순서다.
 * [미결] 관리 범위가 잠금 전용인지 관리 기본값도 두는지는 사용자 확인 대상이다. 바뀌면 이 줄과 테스트만 고친다.
 */
export const SCOPE_PRECEDENCE: readonly ["managed", "session", "local", "project", "user"] = [
  "managed",
  "session",
  "local",
  "project",
  "user",
];

/** 한 범위에서 이미 읽은 값들. 파일 읽기는 F 밖(L4·L1)이 한다. */
export interface ScopeLayer {
  readonly scope: SettingScope;
  readonly values: ReadonlyMap<SettingKey, unknown>;
  /** 파일 범위면 그 파일 경로. session이면 없음 */
  readonly path?: string;
}

export type ScopeStack = readonly ScopeLayer[];

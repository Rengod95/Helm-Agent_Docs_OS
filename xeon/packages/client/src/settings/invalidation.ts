import type { ThreadId } from "@fresnel/contracts/conversation";
import type { SettingKey } from "@fresnel/contracts/settings";
import type { ServerNotificationParams } from "@fresnel/contracts/wire";

// `settings.invalidated` 알림의 대상 판정(L4.settings-ui §4.5.2 규칙 I1~I3). 순수 함수다.
// 알림에는 값이 없다. 화면은 여기서 "지금 연 대화와 상관있는가"와 "어느 키를 다시 읽는가"만 정한다.

export type SettingsInvalidation = ServerNotificationParams<"settings.invalidated">;

/** 대화 하나에 묶인 쓰기 범위. wire의 `threadId`는 이 범위의 변경에서만 채운다(`settings-store`) */
export const THREAD_SCOPE = "launch";

/**
 * 이 알림이 열린 대화의 화면을 다시 읽게 하는가.
 * - 대화에 묶이지 않은 범위(managed, user, project, local)가 하나라도 있으면 그렇다.
 * - 대화 범위만 바뀌었으면 알림의 `threadId`가 열린 대화와 같을 때만 그렇다. 다른 대화의 변경은 무시한다.
 * - `threadId`가 비어 있으면 어느 대화인지 모르므로 다시 읽는다(보수적으로 본다).
 */
export function invalidationConcerns(
  notice: SettingsInvalidation,
  openThreadId: ThreadId | null,
): boolean {
  if (notice.scopes.some((scope) => scope !== THREAD_SCOPE)) return true;
  if (notice.threadId === null) return true;
  return notice.threadId === openThreadId;
}

/** 알림의 키 목록을 키 집합으로 펼친다. 키가 없으면(전체) 카탈로그의 모든 키다. 정렬해 돌려준다 */
export function affectedKeys(
  keys: readonly SettingKey[],
  catalog: ReadonlyMap<SettingKey, unknown>,
): readonly SettingKey[] {
  return keys.length === 0 ? [...catalog.keys()].toSorted() : keys;
}

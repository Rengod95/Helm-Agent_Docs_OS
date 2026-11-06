import { invalidationConcerns, type SettingsInvalidation } from "@fresnel/client/settings";
import { parse } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { SettingsChangedPayloadSchema } from "@fresnel/contracts/records";
import type { PermissionMode } from "@fresnel/contracts/services";
import type { EventsBatchParams } from "@fresnel/contracts/wire";
import type { SwitchMode } from "./commands.ts";

// 입력창 승인 모드 칩의 순수 판정. 화면 부품에서 떼어 React 밖에서 시험한다(permission-mode-model.test.ts).
// 모드는 설정 `l1.tools.permissionMode`의 대화 범위(`launch`) 값이다. 칩은 기본과 편집 자동 허용만 목표로 준다.

/** 권한 모드 설정 키(L1.tools). 세션 범위(`launch`)로 대화마다 정한다 */
export const PERMISSION_MODE_KEY = "l1.tools.permissionMode";

const MODES: readonly PermissionMode[] = ["default", "acceptEdits", "plan", "bypass"];
const SWITCH_MODES: readonly SwitchMode[] = ["default", "acceptEdits"];

/** `settings.get`이 준 값이 네 모드 가운데 하나면 그 모드, 아니면 null(모르는 값)이다. 값을 단언하지 않고 같은지만 본다 */
export function permissionModeOf(value: unknown): PermissionMode | null {
  return MODES.find((mode) => mode === value) ?? null;
}

/** 칩 메뉴가 고른 값을 바꿀 수 있는 모드로 좁힌다. `plan`·`bypass`와 모르는 값은 null이라 칩이 바꾸지 않는다 */
export function switchModeOf(value: string): SwitchMode | null {
  return SWITCH_MODES.find((mode) => mode === value) ?? null;
}

export interface PermissionModeOption {
  readonly mode: PermissionMode;
  /** 고를 수 있는 줄인가. 지금 모드가 계획이나 모두 허용이면 그 줄은 칩 글을 보이려고만 둔다 */
  readonly selectable: boolean;
}

/**
 * 칩 메뉴의 줄. 기본과 편집 자동 허용은 늘 고를 수 있다. 지금 모드가 그 둘이 아니면(계획, 모두 허용) 그 모드를
 * 고를 수 없는 줄로 끝에 더해, 칩 글이 지금 모드로 보이게 한다. 계획과 모두 허용으로 들어가는 줄은 만들지 않는다.
 */
export function permissionModeOptionsOf(current: PermissionMode): readonly PermissionModeOption[] {
  const switchable: readonly PermissionModeOption[] = SWITCH_MODES.map((mode) => ({
    mode,
    selectable: true,
  }));
  return switchModeOf(current) === null
    ? [...switchable, { mode: current, selectable: false }]
    : switchable;
}

/**
 * 설정 변경 알림이 이 대화의 칩을 다시 읽게 하는가. 권한 모드 키가 바뀌었거나 키 목록이 비었을 때(어느 키인지 모름)이고,
 * 대화 범위만 바뀐 경우는 이 대화의 변경일 때만이다(`invalidationConcerns`, L4.settings-ui §4.5.2)
 */
export function modeChangeConcerns(notice: SettingsInvalidation, threadId: ThreadId): boolean {
  const keyChanged = notice.keys.length === 0 || notice.keys.includes(PERMISSION_MODE_KEY);
  return keyChanged && invalidationConcerns(notice, threadId);
}

/**
 * 내구 이벤트 묶음에 이 대화의 권한 모드 설정 기록(`settings.changed`, 키가 권한 모드)이 있나. 계획 승인은 세션 값을 호스트 안에서
 * `ToolService.setMode`로 쓰므로 `settings.invalidated`가 오지 않고 이 기록만 남는다. 그래서 칩은 이 기록으로도 다시 읽는다
 */
export function modeEventConcerns(
  batch: Pick<EventsBatchParams, "events">,
  threadId: ThreadId,
): boolean {
  return batch.events.some((event) => {
    if (event.kind !== "settings.changed" || event.threadId !== threadId) return false;
    const payload = parse(SettingsChangedPayloadSchema, event.payload);
    return payload.ok && payload.value.key === PERMISSION_MODE_KEY;
  });
}

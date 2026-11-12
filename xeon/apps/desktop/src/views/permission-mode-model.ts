import { invalidationConcerns, type SettingsInvalidation } from "@fresnel/client/settings";
import { parse } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { SettingsChangedPayloadSchema } from "@fresnel/contracts/records";
import type { PermissionMode } from "@fresnel/contracts/services";
import type { EventsBatchParams } from "@fresnel/contracts/wire";
import type { SwitchMode } from "./commands.ts";

// 입력창 승인 모드 칩의 순수 판정. 화면 부품에서 떼어 React 밖에서 시험한다(permission-mode-model.test.ts).
// 모드는 설정 `l1.tools.permissionMode`의 대화 범위(`launch`) 값이다(DP-101 [결정: 2026-11-11 사용자]).
// 칩 메뉴는 실행마다 묻기, 편집 자동 허용, 계획 모드, 모두 허용(설정 `l1.tools.bypassAllowed`가 참일 때만) 넷이다.
// 계획 모드는 설정 쓰기가 아니라 `/plan` 명령으로 들어가고 `/plan exit`로 나온다. 계획에서 다른 모드로 가면 나온 뒤 그 모드를 쓴다.

/** 권한 모드 설정 키(L1.tools). 세션 범위(`launch`)로 대화마다 정한다 */
export const PERMISSION_MODE_KEY = "l1.tools.permissionMode";

/** 모두 허용을 쓸 수 있는가(L1.tools). 거짓이면 칩 메뉴에 모두 허용이 없다 */
export const BYPASS_ALLOWED_KEY = "l1.tools.bypassAllowed";

const MODES: readonly PermissionMode[] = ["default", "acceptEdits", "plan", "bypass"];
const SWITCH_MODES: readonly SwitchMode[] = ["default", "acceptEdits", "bypass"];

/** `settings.get`이 준 값이 네 모드 가운데 하나면 그 모드, 아니면 null(모르는 값)이다. 값을 단언하지 않고 같은지만 본다 */
export function permissionModeOf(value: unknown): PermissionMode | null {
  return MODES.find((mode) => mode === value) ?? null;
}

/** 설정 쓰기로 고르는 모드로 좁힌다. `plan`과 모르는 값은 null이다(계획은 명령으로 간다) */
export function switchModeOf(value: string): SwitchMode | null {
  return SWITCH_MODES.find((mode) => mode === value) ?? null;
}

/**
 * 칩 글의 색. 모두 허용은 승인 없이 명령과 편집을 실행하므로 위험 색으로 보인다. 나머지 모드는 보통 색이다.
 * 색은 글과 함께 쓰므로 칩의 글 자체는 바뀌지 않는다
 */
export function permissionModeToneOf(mode: PermissionMode): "normal" | "danger" {
  return mode === "bypass" ? "danger" : "normal";
}

/** 칩 메뉴의 줄 */
export interface PermissionModeOption {
  readonly mode: PermissionMode;
  /** 지금 모드인가 */
  readonly selected: boolean;
}

/**
 * 칩 메뉴의 줄: 묻기, 편집 자동 허용, 계획, 그리고 모두 허용이 허락되면 모두 허용. 허락되지 않아도 지금 모드가 모두 허용이면(관리 설정 등)
 * 그 줄을 남겨 지금 상태가 보이게 한다
 */
export function permissionModeOptionsOf(
  current: PermissionMode,
  bypassAllowed: boolean,
): readonly PermissionModeOption[] {
  const modes: readonly PermissionMode[] =
    bypassAllowed || current === "bypass" ? MODES : ["default", "acceptEdits", "plan"];
  return modes.map((mode) => ({ mode, selected: mode === current }));
}

/** `settings.get`이 준 `l1.tools.bypassAllowed` 값. 참일 때만 참이다(모르면 숨긴다) */
export function bypassAllowedOf(value: unknown): boolean {
  return value === true;
}

/** 모드를 바꾸는 걸음. 계획에 들어가고 나오는 것은 명령이고, 나머지는 설정 쓰기다 */
export type ModeStep =
  | { readonly kind: "none" }
  | { readonly kind: "enterPlan" }
  /** 계획에서 나온 뒤 계획 서비스가 돌려놓은 모드가 `target`과 다르면 `target`을 쓴다 */
  | { readonly kind: "exitPlan"; readonly target: SwitchMode }
  | { readonly kind: "set"; readonly mode: SwitchMode };

/** 지금 모드에서 고른 모드로 가는 걸음 */
export function modeStepOf(current: PermissionMode, next: PermissionMode): ModeStep {
  if (current === next) return { kind: "none" };
  if (next === "plan") return { kind: "enterPlan" };
  if (current === "plan") return { kind: "exitPlan", target: next };
  return { kind: "set", mode: next };
}

/**
 * 설정 변경 알림이 이 대화의 칩을 다시 읽게 하는가. 권한 모드 키가 바뀌었거나 키 목록이 비었을 때(어느 키인지 모름)이고,
 * 대화 범위만 바뀐 경우는 이 대화의 변경일 때만이다(`invalidationConcerns`, L4.settings-ui §4.5.2)
 */
export function modeChangeConcerns(notice: SettingsInvalidation, threadId: ThreadId): boolean {
  const keyChanged =
    notice.keys.length === 0 ||
    notice.keys.includes(PERMISSION_MODE_KEY) ||
    notice.keys.includes(BYPASS_ALLOWED_KEY);
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

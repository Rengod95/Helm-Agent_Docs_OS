import type { MessageId } from "@fresnel/client/i18n";
import { invalidationConcerns, type SettingsInvalidation } from "@fresnel/client/settings";
import { assertNever, parse } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { SettingsChangedPayloadSchema } from "@fresnel/contracts/records";
import type { PermissionMode } from "@fresnel/contracts/services";
import type { EventsBatchParams } from "@fresnel/contracts/wire";
import type { SwitchMode } from "./commands.ts";

// 입력창 승인 모드 칩의 순수 판정. 화면 부품에서 떼어 React 밖에서 시험한다(permission-mode-model.test.ts).
// 모드는 설정 `l1.tools.permissionMode`의 대화 범위(`launch`) 값이다(DP-101 [결정: 2026-11-11 사용자]).
// 칩 메뉴는 실행마다 묻기, 편집 자동 허용, 모두 허용(설정 `l1.tools.bypassAllowed`가 참일 때만) 셋이다. 계획 모드는 없앴다 [결정: 2026-11-13 사용자].

/** 권한 모드 설정 키(L1.tools). 세션 범위(`launch`)로 대화마다 정한다 */
export const PERMISSION_MODE_KEY = "l1.tools.permissionMode";

/** 모두 허용을 쓸 수 있는가(L1.tools). 거짓이면 칩 메뉴에 모두 허용이 없다 */
export const BYPASS_ALLOWED_KEY = "l1.tools.bypassAllowed";

const MODES: readonly PermissionMode[] = ["default", "acceptEdits", "bypass"];
const SWITCH_MODES: readonly SwitchMode[] = ["default", "acceptEdits", "bypass"];

/** `settings.get`이 준 값이 세 모드 가운데 하나면 그 모드, 아니면 null(모르는 값)이다. 값을 단언하지 않고 같은지만 본다 */
export function permissionModeOf(value: unknown): PermissionMode | null {
  return MODES.find((mode) => mode === value) ?? null;
}

/**
 * 칩이 아는 승인 모드(DP-213). 읽는 중, 읽음, 읽기 실패, 엔진이 모르는 값(옛 엔진의 `plan` 등)이나 값 없음을 가른다.
 * 어느 경우에도 칩 자리는 그대로이고, 모르는 동안은 기본 모드로 보이며 이유를 말한다(조용히 숨기지 않는다)
 */
export type PermissionModeRead =
  | { readonly kind: "loading" }
  | { readonly kind: "known"; readonly mode: PermissionMode }
  | { readonly kind: "failed" }
  | { readonly kind: "unknown"; readonly value: string | null };

/** 모르는 값을 이유 문장에 넣을 때의 최대 글자 수 */
const UNKNOWN_VALUE_MAX = 24;

/** `settings.get` 결과(성공 여부와 값)를 읽기 상태로 바꾼다. 값이 문자열이 아니면(없음 포함) 값 없는 모름이다 */
export function permissionModeReadOf(ok: boolean, value: unknown): PermissionModeRead {
  if (!ok) return { kind: "failed" };
  const mode = permissionModeOf(value);
  if (mode !== null) return { kind: "known", mode };
  return {
    kind: "unknown",
    value: typeof value === "string" && value !== "" ? value.slice(0, UNKNOWN_VALUE_MAX) : null,
  };
}

/** 칩이 그릴 값. `mode`가 null이면 읽는 중이라 "승인 모드" 글로 자리만 지킨다. `note`가 있으면 기본 모드로 보이는 까닭이다 */
export interface PermissionChipView {
  readonly mode: PermissionMode | null;
  readonly note: { readonly id: MessageId; readonly value?: string } | null;
  /** 메뉴에 "다시 읽기"를 둘지(읽기 실패) */
  readonly retry: boolean;
}

export function permissionChipViewOf(read: PermissionModeRead): PermissionChipView {
  switch (read.kind) {
    case "loading":
      return { mode: null, note: null, retry: false };
    case "known":
      return { mode: read.mode, note: null, retry: false };
    case "failed":
      return { mode: "default", note: { id: "desktop.composer.approvalMode.failed" }, retry: true };
    case "unknown":
      return {
        mode: "default",
        note:
          read.value === null
            ? { id: "desktop.composer.approvalMode.missing" }
            : { id: "desktop.composer.approvalMode.unknown", value: read.value },
        retry: false,
      };
    default:
      return assertNever(read, "PermissionModeRead");
  }
}

/** 설정 쓰기로 고르는 모드로 좁힌다. 모르는 값은 null이다 */
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
 * 칩 메뉴의 줄: 묻기, 편집 자동 허용, 그리고 모두 허용이 허락되면 모두 허용. 허락되지 않아도 지금 모드가 모두 허용이면(관리 설정 등)
 * 그 줄을 남겨 지금 상태가 보이게 한다
 */
export function permissionModeOptionsOf(
  current: PermissionMode,
  bypassAllowed: boolean,
): readonly PermissionModeOption[] {
  const modes: readonly PermissionMode[] =
    bypassAllowed || current === "bypass" ? MODES : ["default", "acceptEdits"];
  return modes.map((mode) => ({ mode, selected: mode === current }));
}

/** `settings.get`이 준 `l1.tools.bypassAllowed` 값. 참일 때만 참이다(모르면 숨긴다) */
export function bypassAllowedOf(value: unknown): boolean {
  return value === true;
}

/** 모드를 바꾸는 걸음. 모드는 설정 쓰기로 바꾼다 */
export type ModeStep =
  | { readonly kind: "none" }
  | { readonly kind: "set"; readonly mode: SwitchMode };

/** 지금 모드에서 고른 모드로 가는 걸음 */
export function modeStepOf(current: PermissionMode, next: PermissionMode): ModeStep {
  if (current === next) return { kind: "none" };
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
 * 내구 이벤트 묶음에 이 대화의 권한 모드 설정 기록(`settings.changed`, 키가 권한 모드)이 있나. 호스트 안에서 세션 값을 바꾸면
 * (`ToolService.setMode`) `settings.invalidated`가 오지 않고 이 기록만 남는다. 그래서 칩은 이 기록으로도 다시 읽는다
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

/**
 * 이 대화의 권한 모드 값을 누가 정했나(`settings.get`의 `source.scope`). `launch`는 이 대화에서 따로 고른 값이고, `profile`은 대화의
 * 프로필(공통 묶음 포함)이 정한 값이다. 그 밖(관리 잠금, 사용자 파일, 기본값)은 `other`다 [결정: 2026-11-23 사용자, AGE-71]
 */
export type ModeOrigin = "thread" | "profile" | "other";

export function modeOriginOf(scope: unknown): ModeOrigin {
  if (scope === "launch") return "thread";
  if (scope === "profile") return "profile";
  return "other";
}

/** 프로필이 실행 방식을 정하지 않았을 때 엔진이 쓰는 값("모두 허용", 호스트 `FACTORY_PERMISSION_MODE`) */
const PROFILE_MODE_FALLBACK: PermissionMode = "bypass";

/** 설정 줄 하나(프로필과 공통 묶음의 `settings` 원소) */
interface SettingLine {
  readonly key: string;
  readonly value?: unknown;
}

/**
 * 한 프로필을 쓰는 대화의 실행 방식. 엔진의 `profile` 층과 같은 규칙이다: 프로필 값이 공통 묶음 값을 이기고(같은 키는 마지막 값),
 * 둘 다 없으면 "모두 허용"이다 [결정: 2026-11-23 사용자, AGE-71 질문 3]. 엔진이 모르는 값이면 null이다
 */
export function profileModeFrom(
  own: readonly SettingLine[],
  shared: readonly SettingLine[],
): PermissionMode | null {
  const found =
    own.findLast((setting) => setting.key === PERMISSION_MODE_KEY) ??
    shared.findLast((setting) => setting.key === PERMISSION_MODE_KEY);
  return found === undefined ? PROFILE_MODE_FALLBACK : permissionModeOf(found.value);
}

/**
 * 입력창 칩 메뉴의 구분선 아래 고정 줄(AGE-71). 대화에서 따로 고른 값이 없으면 `applied`: 프로필이 정한 지금 값을 골라진 줄로 보이고
 * 위의 세 줄에는 체크가 없다. 따로 고른 값이 있으면 `revert`: 누르면 그 값을 지우고 프로필 값으로 돌아간다(`mode`는 프로필 값, 모르면 null).
 * 값을 모르거나(읽는 중, 실패, 모르는 값) 관리 잠금처럼 프로필도 대화도 정하지 않은 값이면 줄이 없다
 */
export type ProfileModeRowView =
  | { readonly kind: "applied"; readonly mode: PermissionMode }
  | { readonly kind: "revert"; readonly mode: PermissionMode | null };

export function profileModeRowOf(input: {
  readonly read: PermissionModeRead;
  readonly origin: ModeOrigin;
  /** 대화의 프로필이 정한 값(따로 고른 값이 있을 때 메뉴를 열며 읽는다). 모르면 null */
  readonly profileMode: PermissionMode | null;
}): ProfileModeRowView | null {
  if (input.read.kind !== "known") return null;
  switch (input.origin) {
    case "profile":
      return { kind: "applied", mode: input.read.mode };
    case "thread":
      return { kind: "revert", mode: input.profileMode };
    case "other":
      return null;
    default:
      return assertNever(input.origin, "ModeOrigin");
  }
}

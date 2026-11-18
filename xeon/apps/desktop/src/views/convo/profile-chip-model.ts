import type { MessageId } from "@fresnel/client/i18n";
import type { Profile, ProfileIssue } from "@fresnel/contracts/wire";
import { permissionModeOf } from "../permission-mode-model.ts";
import type { ProfilesRead } from "./profile-listing.ts";

// 입력창 프로필 칩의 값(lcM6a, L4 desktop-ux §6.6.1, craft-flows T1). 순수 함수만 있다.
// - 지금 프로필: 마지막 `profile.applied`(단계 경계에서 실제로 쓰인 값). 아직 없으면 대화가 가리키는 프로필이다.
// - 바꿀 프로필: 보낸 요청, 대화가 가리키는 프로필(`thread.updated.profileId`) 순. 지금 값과 다르면 "다음 단계부터"다.
// - 탈출구: 기본 프로필이 아니면 "기본 프로필로 전환", 이미 기본이면 같은 자리가 "기본 프로필 되돌리기"다(T1 [제안]).

export const DEFAULT_PROFILE_ID = "default";
/** 프로필 설정 가운데 권한 모드 키 */
const PERMISSION_MODE_KEY = "l1.tools.permissionMode";

export type ProfileChipView = {
  /** 단계 경계에서 쓰이는 프로필 */
  readonly currentId: string;
  readonly title: string;
  /** 다음 단계 경계에서 바뀔 프로필. 없으면 null */
  readonly pending: { readonly id: string; readonly title: string } | null;
  /** 칩이 보이는 프로필(바뀔 것이 있으면 그것)의 스타트 Drive 플러그인 */
  readonly startDrive: string | null;
  readonly escape: "switch" | "reset";
};

function profileOf(read: ProfilesRead, id: string): Profile | undefined {
  return read.kind === "ready" ? read.profiles.find((profile) => profile.id === id) : undefined;
}

export function profileChipViewOf(input: {
  /** 마지막 `profile.applied`의 프로필. 없으면 null */
  readonly applied: string | null;
  /** 대화 요약의 `profileId`. 없으면 null */
  readonly assigned: string | null;
  /** 이 칩이 보내고 아직 대화 요약에 오지 않은 요청. 없으면 null */
  readonly requested: string | null;
  readonly read: ProfilesRead;
}): ProfileChipView {
  const target = input.requested ?? input.assigned ?? input.applied ?? DEFAULT_PROFILE_ID;
  const currentId = input.applied ?? target;
  const titleOf = (id: string): string => profileOf(input.read, id)?.title ?? id;
  return {
    currentId,
    title: titleOf(currentId),
    pending: target === currentId ? null : { id: target, title: titleOf(target) },
    startDrive: profileOf(input.read, target)?.startDrive ?? null,
    escape: target === DEFAULT_PROFILE_ID ? "reset" : "switch",
  };
}

/** 메뉴의 프로필 한 줄 */
export type ProfileMenuRow = {
  readonly id: string;
  readonly title: string;
  readonly selected: boolean;
  /** 이 폴더의 새 대화가 받을 프로필(`profile.defaultFor`) */
  readonly recent: boolean;
  readonly startDrive: string | null;
  /** 프로필이 정한 권한 모드. 정하지 않았으면 null */
  readonly permission: string | null;
};

/** 숨긴 프로필은 지금 고른 것만 남긴다. 순서는 목록 그대로다 */
export function profileMenuOf(
  profiles: readonly Profile[],
  selectedId: string,
  recentId: string | null,
): readonly ProfileMenuRow[] {
  return profiles
    .filter((profile) => profile.hidden !== true || profile.id === selectedId)
    .map((profile) => {
      const mode = profile.settings.find((setting) => setting.key === PERMISSION_MODE_KEY);
      return {
        id: profile.id,
        title: profile.title,
        selected: profile.id === selectedId,
        recent: profile.id === recentId && profile.id !== selectedId,
        startDrive: profile.startDrive,
        permission: mode === undefined ? null : permissionModeOf(mode.value),
      };
    });
}

/** 스타트 Drive를 시작할 수 없는 까닭. `profile.preview`의 이슈에서 그 플러그인 것만 본다 */
export type StartDriveBlock = "missing" | "notReviewed" | "stopped" | "cannotDrive" | "notInList";

const BLOCK_TEXT: Readonly<Record<StartDriveBlock, MessageId>> = {
  missing: "desktop.startDrive.reason.missing",
  notReviewed: "desktop.startDrive.reason.notReviewed",
  stopped: "desktop.startDrive.reason.stopped",
  cannotDrive: "desktop.startDrive.reason.cannotDrive",
  notInList: "desktop.startDrive.reason.notInList",
};

export function startDriveBlockText(block: StartDriveBlock): MessageId {
  return BLOCK_TEXT[block];
}

/** 첫 막힘. 막힌 것이 없으면 null */
export function startDriveBlockOf(
  issues: readonly ProfileIssue[],
  plugin: string,
): StartDriveBlock | null {
  for (const issue of issues) {
    const mine = issue.plugin === undefined || issue.plugin === plugin;
    if (!mine) continue;
    if (issue.code === "driver_unavailable") return "stopped";
    if (issue.code === "driver_cannot_drive") return "cannotDrive";
    if (issue.code === "driver_not_in_list") return "notInList";
    if (issue.plugin !== plugin) continue;
    if (issue.code === "plugin_unknown") return "missing";
    if (issue.code === "plugin_not_reviewed") return "notReviewed";
  }
  return null;
}

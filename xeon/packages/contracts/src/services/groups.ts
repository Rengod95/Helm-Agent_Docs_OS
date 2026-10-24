import type {
  GroupId,
  LeaseArbiterPort,
  LeaseId,
  RecordKind,
  ScopeId,
  ScopeStatus,
  Unsubscribe,
} from "../extensions/index.ts";

// L3.group-kit.spec §3.8. 구현은 group-kit이다. GroupService는 X 포트 LeaseArbiterPort(F.extensions.spec §3.2.1)를 확장하고
// X가 그 포트로 주입받는다. settings를 import하지 않으므로 설정 범위는 SettingScope와 같은 모양의 리터럴 유니언으로 적는다.

export const GroupServiceName = "xeon.groups" as const;

/** 설정 x.primitives.activeDriveGroup의 유효 값. null은 auto(요청 순서)다 */
export type DriveHolderSetting = ScopeId | null;

/** F.wire-settings의 SettingScope와 서로 대입 가능해야 한다 */
type HolderSettingScope = "managed" | "user" | "project" | "local" | "session";

/** GroupStatus.metrics. group-kit GroupMetrics(L3.group-kit.spec §3.12)의 부분 필드와 같은 모양이다 */
export interface GroupMetricsSummary {
  readonly denies: number;
  readonly posts: number;
  readonly spawns: number;
  readonly delegates: number;
  readonly costUsd: number;
  readonly leaseMs: number;
}

export type DriveRole = "holder" | "waiting" | "none" | "error";

export interface GroupError {
  readonly kind:
    | "group.driveThrew"
    | "group.setupFailed"
    | "group.stateInvalid"
    | "group.migrationFailed";
  readonly message: string;
  /** 오류를 기록한 이벤트 seq. 기록 전이면 null */
  readonly atSeq: number | null;
}

export interface GroupStatus {
  readonly id: GroupId;
  readonly displayName: string;
  readonly scope: ScopeStatus;
  /** scope가 enabling이면 "enable", disabling이면 "disable" */
  readonly pendingToggle: "enable" | "disable" | null;
  readonly usesDrive: boolean;
  /** drive를 쓰지 않거나 꺼져 있으면 "none" */
  readonly drive: DriveRole;
  readonly leaseId: LeaseId | null;
  readonly lastError: GroupError | null;
  /** 매니페스트 recordKinds의 kind 목록 */
  readonly recordKinds: readonly RecordKind[];
  /** l3.group-kit.instrumentation이 false면 null */
  readonly metrics: GroupMetricsSummary | null;
}

export type GroupCommandError =
  | { readonly kind: "group.unknown"; readonly id: string; readonly known: readonly GroupId[] }
  | { readonly kind: "group.noDrive"; readonly id: GroupId }
  | { readonly kind: "group.settingLocked"; readonly key: string };

export type GroupResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: GroupCommandError };

export interface ToggleReceipt {
  readonly id: GroupId;
  readonly status: ScopeStatus;
  /** 실행 중인 turn이 있으면 nextStepBoundary. 유휴 시점 적용은 X.primitives.spec [가정] */
  readonly appliesAt: "nextStepBoundary" | "now";
}

export interface HolderReceipt {
  readonly holder: DriveHolderSetting;
  readonly scope: HolderSettingScope;
  /**
   * auto, 또는 지정한 그룹이 이미 holder면 now(현재 holder 유지). 임대가 없으면 nextStepBoundary.
   * 다른 그룹이 임대를 가졌고 지정한 그룹이 후보(켜짐, drive 등록, 오류 아님)이면 X가 다음 경계에서 회수하므로 nextStepBoundary,
   * 후보가 아니면 현재 임대를 유지하므로 afterLeaseRelease(L3.group-kit.spec §3.8, X.primitives.spec P-22)
   */
  readonly appliesAt: "nextStepBoundary" | "now" | "afterLeaseRelease";
}

/** xeon.groups 서비스. X LeaseArbiterPort(choose)를 확장한다 */
export interface GroupService extends LeaseArbiterPort {
  /** 설치된 모든 그룹. 정렬: holder, 켜진 그룹(로드 순서), 꺼진 그룹(이름순) */
  list(): readonly GroupStatus[];
  status(id: string): GroupResult<GroupStatus>;
  /** ScopeHandle.enable() 요청만 기록. 이미 켜져 있으면 그대로 ok */
  enable(id: string): GroupResult<ToggleReceipt>;
  disable(id: string): GroupResult<ToggleReceipt>;
  /**
   * 설정 x.primitives.activeDriveGroup을 쓴다. holder "auto"는 null로 쓴다. scope 기본값 "session".
   * 이름을 지정하면 X가 다음 경계에서 현재 임대를 회수한다. 지정한 그룹이 후보가 아니면 현재 임대를 유지한다.
   * "auto"(null)로 바꿔도 회수하지 않는다(L3.group-kit.spec §3.8, X.primitives.spec P-22). 진행 중인 loop.turn은 끊지 않는다
   */
  setDriveHolder(
    holder: string,
    options?: { readonly scope?: HolderSettingScope },
  ): Promise<GroupResult<HolderReceipt>>;
  /** 상태가 바뀔 때 전체 목록을 넘긴다. 단계 경계마다 최대 한 번 */
  onChange(listener: (groups: readonly GroupStatus[]) => void): Unsubscribe;
}

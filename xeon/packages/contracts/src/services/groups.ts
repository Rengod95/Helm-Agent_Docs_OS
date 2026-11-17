import type {
  GroupId,
  DriveLockId,
  RecordKind,
  RegistrationStatus,
  Unsubscribe,
} from "../extensions/index.ts";

// L3.group-sdk.spec §3.8. 구현은 group-sdk이다. 엔진은 주도권 스택(drive-isolation.md 2.1)을 `ExtHost.driveFrames`로 읽고,
// 그룹 서비스는 그 스택에서 drive 역할을 계산한다. 후보 중재와 구동 그룹 설정(`x.primitives.activeDriver`)은 없다(2.2).

export const GroupServiceName = "fresnel.groups" as const;

/** GroupStatus.metrics. group-sdk GroupMetrics(L3.group-sdk.spec §3.12)의 부분 필드와 같은 모양이다 */
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
  readonly scope: RegistrationStatus;
  /** scope가 enabling이면 "enable", disabling이면 "disable" */
  readonly pendingToggle: "enable" | "disable" | null;
  readonly usesDrive: boolean;
  /** drive를 쓰지 않거나 꺼져 있으면 "none" */
  readonly drive: DriveRole;
  readonly leaseId: DriveLockId | null;
  readonly lastError: GroupError | null;
  /** 매니페스트 recordKinds의 kind 목록 */
  readonly recordKinds: readonly RecordKind[];
  /** l3.group-sdk.instrumentation이 false면 null */
  readonly metrics: GroupMetricsSummary | null;
}

/** 그룹 명령이 값으로 돌려주는 오류. 설정 쓰기 오류는 `setDriveHolder`와 함께 없앴다(drive-isolation.md 2.2) */
export type GroupCommandError = {
  readonly kind: "group.unknown";
  readonly id: string;
  readonly known: readonly GroupId[];
};

export type GroupResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: GroupCommandError };

export interface ToggleReceipt {
  readonly id: GroupId;
  readonly status: RegistrationStatus;
  /** 실행 중인 turn이 있으면 nextStepBoundary. 유휴 시점 적용은 X.primitives.spec [가정] */
  readonly appliesAt: "nextStepBoundary" | "now";
}

/** fresnel.groups 서비스. 그룹 목록, 켜기 끄기, 상태 읽기만 낸다 */
export interface GroupService {
  /** 설치된 모든 그룹. 정렬: 맨 위 프레임(holder), 켜진 그룹(로드 순서), 꺼진 그룹(이름순) */
  list(): readonly GroupStatus[];
  status(id: string): GroupResult<GroupStatus>;
  /** RegistrationHandle.enable() 요청만 기록. 이미 켜져 있으면 그대로 ok */
  enable(id: string): GroupResult<ToggleReceipt>;
  disable(id: string): GroupResult<ToggleReceipt>;
  /** 상태가 바뀔 때 전체 목록을 넘긴다. 단계 경계마다 최대 한 번 */
  onChange(listener: (groups: readonly GroupStatus[]) => void): Unsubscribe;
}

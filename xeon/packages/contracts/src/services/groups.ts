import type {
  OrchestrationId,
  DriveLockId,
  RecordKind,
  RegistrationStatus,
} from "../extensions/index.ts";

// L3.group-sdk.spec §3.8. 구현은 group-sdk이다. 엔진은 주도권 스택(drive-isolation.md 2.1)을 `ExtHost.driveFrames`로 읽고,
// 그룹 서비스는 그 스택에서 drive 역할을 계산한다. 후보 중재와 구동 그룹 설정(`x.primitives.activeDriver`)은 없다(2.2).

export const OrchestrationServiceName = "fresnel.orchestration" as const;

/** OrchestrationStatus.metrics. group-sdk OrchestrationMetrics(L3.group-sdk.spec §3.12)의 부분 필드와 같은 모양이다 */
export interface OrchestrationMetricsSummary {
  readonly denies: number;
  readonly posts: number;
  readonly spawns: number;
  readonly delegates: number;
  readonly costUsd: number;
  readonly leaseMs: number;
}

export type DriveRole = "holder" | "waiting" | "none" | "error";

export interface OrchestrationError {
  readonly kind:
    | "orchestration.driveThrew"
    | "orchestration.setupFailed"
    | "orchestration.stateInvalid"
    | "orchestration.migrationFailed";
  readonly message: string;
  /** 오류를 기록한 이벤트 seq. 기록 전이면 null */
  readonly atSeq: number | null;
}

export interface OrchestrationStatus {
  readonly id: OrchestrationId;
  readonly displayName: string;
  readonly scope: RegistrationStatus;
  /** scope가 enabling이면 "enable", disabling이면 "disable" */
  readonly pendingToggle: "enable" | "disable" | null;
  readonly usesDrive: boolean;
  /** drive를 쓰지 않거나 꺼져 있으면 "none" */
  readonly drive: DriveRole;
  readonly leaseId: DriveLockId | null;
  readonly lastError: OrchestrationError | null;
  /** 매니페스트 recordKinds의 kind 목록 */
  readonly recordKinds: readonly RecordKind[];
  /** l3.orchestration.instrumentation이 false면 null */
  readonly metrics: OrchestrationMetricsSummary | null;
}

/** fresnel.orchestration 서비스. 그룹 목록과 상태 읽기만 낸다 */
export interface OrchestrationService {
  /** 설치된 모든 그룹. 정렬: 맨 위 프레임(holder), 켜진 그룹(로드 순서), 꺼진 그룹(이름순) */
  list(): readonly OrchestrationStatus[];
}

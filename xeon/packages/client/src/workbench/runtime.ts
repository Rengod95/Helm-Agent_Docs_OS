// 런타임 탭(spec L4.desktop-ux §4.9.8)의 순수 모델. 대화 영역 오른쪽 "런타임" 탭이 그리는 값을 만든다.
// drive 구역의 보유·대기열·거절은 `group.list`의 `GroupStatus.drive`가 정하고, `group.driveLock`은 차수·상한·사용량과 후보별 대기 횟수를 더한다.
// Helm만 다루지 않는다: `drive`를 쓰는 그룹(review, work 등)은 같은 모양으로 나온다.
import type { LeaseReleasedPayload, ScopeChangedPayload } from "@fresnel/contracts/records";
import type { ExtListEntry, GroupDriveLockResult, GroupStatusWire } from "@fresnel/contracts/wire";
import {
  failureRowsOfOwner,
  rowOf,
  type ExtKind,
  type ExtState,
  type FailureRowVM,
  type HandlerFailureEntry,
} from "./model.ts";

/** 그룹의 drive 역할(`GroupStatus.drive`) */
export type DriveRole = GroupStatusWire["drive"];

/** drive 구역의 그룹 한 줄. `id`는 그룹 id이고 등록 id와 같다(group-sdk가 매니페스트 이름을 등록 id로 쓴다) */
export interface DriveMemberVM {
  readonly id: string;
  readonly displayName: string;
  /** 거절·양보로 기다린 횟수(`driveLock.candidates`). 후보가 아니면 null */
  readonly waits: number | null;
  /** 넘으면 거부되는 대기 상한(`driveLock.candidates`). 후보가 아니면 null */
  readonly waitLimit: number | null;
}

/** 런타임 탭 drive 구역. 보유·대기열·거절·오류는 `GroupStatus.drive`에서, 차수·상한·사용량은 `driveLock`에서 온다 */
export interface RuntimeDriveView {
  /** `GroupStatus.drive`가 `holder`인 그룹. 없으면 null */
  readonly holder: DriveMemberVM | null;
  /** 보유자(`holder`)가 `driveLock.holder`와 같은가. 둘 다 없으면 참 */
  readonly holderAgrees: boolean;
  /** 대기 그룹. 순서는 `driveLock.candidates`의 순서이고, 후보 목록에 없는 대기 그룹은 뒤에 목록 순서대로 붙는다 */
  readonly queue: readonly DriveMemberVM[];
  /** 대기 상한을 넘어 거부된 그룹 */
  readonly rejected: readonly DriveMemberVM[];
  /** drive 오류인 그룹 */
  readonly errored: readonly DriveMemberVM[];
  readonly leaseEpoch: number;
  /** 설정 `x.primitives.activeDriver`의 값. 없으면 null(자동 중재) */
  readonly activeDriver: string | null;
  readonly limits: {
    readonly turns: number;
    readonly spawns: number;
    /** 토큰 상한이 없으면 null */
    readonly tokens: number | null;
  };
  readonly used: { readonly turns: number; readonly spawns: number; readonly tokens: number };
  /** 가장 최근에 거부된 기록(`lease.rejected`). 없으면 null */
  readonly lastRejected: GroupDriveLockResult["lastRejected"];
}

function memberOf(
  group: GroupStatusWire,
  wait: GroupDriveLockResult["candidates"][number] | undefined,
): DriveMemberVM {
  return {
    id: group.id,
    displayName: group.displayName,
    waits: wait?.waits ?? null,
    waitLimit: wait?.waitLimit ?? null,
  };
}

/**
 * drive 구역 값. `groupList`는 `group.list`의 결과, `driveLock`은 같은 대화의 `group.driveLock` 결과다.
 * drive를 쓰지 않는 그룹(`drive: "none"`)은 어느 목록에도 들지 않는다.
 */
export function runtimeViewOf(
  groupList: readonly GroupStatusWire[],
  driveLock: GroupDriveLockResult,
): RuntimeDriveView {
  const holderGroup = groupList.find((group) => group.drive === "holder");
  const waitOf = (id: string): GroupDriveLockResult["candidates"][number] | undefined =>
    driveLock.candidates.find((candidate) => candidate.registrationId === id);
  const waiting = groupList.filter((group) => group.drive === "waiting");
  const queueOrdered = driveLock.candidates.flatMap((candidate) => {
    const group = waiting.find((g) => g.id === candidate.registrationId);
    return group === undefined ? [] : [memberOf(group, candidate)];
  });
  const queueRest = waiting
    .filter((group) => waitOf(group.id) === undefined)
    .map((group) => memberOf(group, undefined));
  return {
    holder: holderGroup === undefined ? null : memberOf(holderGroup, undefined),
    holderAgrees: (holderGroup?.id ?? null) === driveLock.holder,
    queue: [...queueOrdered, ...queueRest],
    rejected: groupList.filter((g) => g.drive === "rejected").map((g) => memberOf(g, undefined)),
    errored: groupList.filter((g) => g.drive === "error").map((g) => memberOf(g, undefined)),
    leaseEpoch: driveLock.leaseEpoch,
    activeDriver: driveLock.activeDriver,
    limits: driveLock.limits,
    used: driveLock.used,
    lastRejected: driveLock.lastRejected,
  };
}

/** 이 대화에서 켜진 확장과 그룹 한 줄(상태, 훅 수, drive 역할) */
export interface RuntimeExtRowVM {
  readonly name: string;
  /** 표시 이름이 이름과 같으면 null(화면은 mono id만 보인다). 행 부품 `rowOf`와 같은 규칙 */
  readonly displayName: string | null;
  readonly layer: string;
  readonly kind: ExtKind;
  readonly state: ExtState;
  readonly hookCount: number;
  /** 그룹이면 drive 역할, 확장이면 null */
  readonly drive: DriveRole | null;
}

/**
 * 이 대화의 켜진 확장·그룹 행. 대화 범위 상태(`registration`, 없으면 전역 `status`)가 꺼짐이고 자동 꺼짐도 아니면 뺀다.
 * 그룹에 켜짐 요청이 걸려 있으면(`GroupStatus.pendingToggle`) 상태는 켜는 중·끄는 중이다.
 */
export function runtimeRowsOf(
  entries: readonly ExtListEntry[],
  groups: readonly GroupStatusWire[],
): readonly RuntimeExtRowVM[] {
  return entries.flatMap((entry) => {
    const status = entry.registration ?? entry.status;
    if (status === "disabled" && !entry.autoDisabled) return [];
    const row = rowOf({ ...entry, status }, {});
    const group = groups.find((g) => g.id === entry.name);
    const pending = group?.pendingToggle ?? null;
    const state: ExtState =
      row.state === "safe_excluded" || row.state === "auto_disabled" || pending === null
        ? row.state
        : pending === "enable"
          ? "enabling"
          : "disabling";
    return [
      {
        name: row.name,
        displayName: row.displayName,
        layer: row.layer,
        kind: row.kind,
        state,
        hookCount: row.hookCount,
        drive: group?.drive ?? null,
      },
    ];
  });
}

/** 실패 기록 한 묶음: 확장(`ext:<이름>`)이나 훅(`hook:<이름>`)의 owner와 행 */
export interface FailureGroupVM {
  readonly owner: string;
  /** 표시 이름: `ext:` 접두를 뗀다 */
  readonly label: string;
  readonly rows: readonly FailureRowVM[];
}

/**
 * 엔진 거울의 `scope.handler_failed` 기록을 owner별 묶음으로 나눈다. owner가 처음 나온 순서를 따른다.
 * 기록에는 대화 id가 없어서 이 묶음은 열린 연결 전체의 실패다.
 */
export function failureGroupsOf(
  records: readonly HandlerFailureEntry[],
): readonly FailureGroupVM[] {
  const owners = [...new Set(records.map((record) => record.owner))];
  return owners.map((owner) => ({
    owner,
    label: owner.startsWith("ext:") ? owner.slice("ext:".length) : owner,
    rows: failureRowsOfOwner(records, owner),
  }));
}

/**
 * 전환 기록 한 건의 내용. 종류마다 모양이 다르다. 켜기·끄기는 상태와 사유를 함께 싣는다.
 * 거절의 사유는 계약이 열린 글(`LeaseRejectedPayload.reason`)이라 글 그대로 둔다.
 */
export type TransitionChange =
  | { readonly kind: "lease.acquired"; readonly leaseEpoch: number | null }
  | { readonly kind: "lease.released"; readonly reason: LeaseReleasedPayload["reason"] }
  | { readonly kind: "lease.rejected"; readonly reason: string }
  | {
      readonly kind: "scope.changed";
      readonly status: ScopeChangedPayload["status"];
      /** 계약 주석대로 사유가 없으면 "request"다 */
      readonly reason: NonNullable<ScopeChangedPayload["reason"]>;
    };

/**
 * 전환 기록 한 건(엔진 거울이 받은 `lease.*`·`scope.changed`). `subject`는 scope id이고 거절은 요청한 그룹 id다.
 * 거울의 기록(`TransitionRecord`)은 이 모양에 thread id를 더한 것이다.
 */
export interface TransitionEntry {
  readonly seq: number;
  readonly at: string;
  readonly turnId: string | null;
  readonly subject: string;
  readonly change: TransitionChange;
}

/** 전환 기록 한 줄 */
export interface TransitionRowVM {
  readonly seq: number;
  /** 지역 시각 HH:MM:SS */
  readonly time: string;
  /** 턴 id의 끝 여섯 글자. 턴이 없으면 null */
  readonly turn: string | null;
  readonly subject: string;
  readonly change: TransitionChange;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * 한 대화의 전환 기록을 줄로 바꾼다. 최근 것이 먼저다. 상한(대화마다 20개)은 거울이 둔다. 여기서는 자르지 않는다.
 * 시각은 `at`을 지역 시각으로 읽는다.
 */
export function transitionRowsOf(records: readonly TransitionEntry[]): readonly TransitionRowVM[] {
  return records
    .toSorted((a, b) => b.seq - a.seq)
    .map((record) => {
      const when = new Date(record.at);
      return {
        seq: record.seq,
        time: [when.getHours(), when.getMinutes(), when.getSeconds()].map(pad2).join(":"),
        turn: record.turnId === null ? null : record.turnId.slice(-6),
        subject: record.subject,
        change: record.change,
      };
    });
}

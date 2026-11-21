// 런타임 탭(spec L4.desktop-ux §4.9.8)의 순수 모델. 대화 영역 오른쪽 "런타임" 탭이 그리는 값을 만든다.
// drive 구역의 보유자와 대기열은 주도권 스택(`drive.frames`)이 정한다: 맨 위 플러그인 프레임이 보유자, `waiting` 프레임이 대기다.
// 그룹의 표시 이름과 오류는 `group.list`의 `OrchestrationStatus`에서 온다. Helm만 다루지 않는다: `drive`를 쓰는 그룹(review, work 등)은 같은 모양으로 나온다.
import type { DriveFrameView } from "@fresnel/contracts/extensions";
import type { LeaseReleasedPayload, ScopeChangedPayload } from "@fresnel/contracts/records";
import type { ExtListEntry, OrchestrationStatusWire } from "@fresnel/contracts/wire";
import {
  failureRowsOfOwner,
  rowOf,
  type ExtKind,
  type ExtState,
  type FailureRowVM,
  type HandlerFailureEntry,
} from "./model.ts";

/** 그룹의 drive 역할(`OrchestrationStatus.drive`) */
export type DriveRole = OrchestrationStatusWire["drive"];

/** drive 구역의 그룹 한 줄. `id`는 그룹 id이고 등록 id와 같다(orchestration-sdk가 매니페스트 이름을 등록 id로 쓴다) */
export interface DriveMemberVM {
  readonly id: string;
  readonly displayName: string;
}

/** 런타임 탭 drive 구역. 보유자와 대기열은 `drive.frames`에서, 오류는 `OrchestrationStatus.drive`에서 온다 */
export interface RuntimeDriveView {
  /** 맨 위 플러그인 프레임의 그룹. 플러그인 프레임이 없으면 null */
  readonly holder: DriveMemberVM | null;
  /** 보유자가 `OrchestrationStatus.drive`의 `holder` 그룹과 같은가. 둘 다 없으면 참 */
  readonly holderAgrees: boolean;
  /** 맡겨서 기다리는 프레임(`state: "waiting"`)의 그룹. 프레임 목록의 순서(아래에서 위)다 */
  readonly queue: readonly DriveMemberVM[];
  /** drive 오류인 그룹 */
  readonly errored: readonly DriveMemberVM[];
  /** 주도권 스택 전체(`drive.frames`), 아래에서 위 순서. 맨 아래는 코어 루프(depth 0)다. 화면 설계(M6a)가 쓴다 */
  readonly frames: readonly DriveFrameView[];
  /** 맨 위 플러그인 프레임이 쓴 양. 프레임이 없으면 0 */
  readonly used: { readonly turns: number; readonly spawns: number; readonly tokens: number };
  /** 맨 위 플러그인 프레임의 상한. 없는 항목은 null(상한 없음). 프레임이 없으면 모두 null */
  readonly limits: {
    readonly turns: number | null;
    readonly spawns: number | null;
    readonly tokens: number | null;
  };
}

/** 그룹 id의 표시 이름을 `group.list`에서 찾는다. 목록에 없으면 id를 그대로 쓴다 */
function memberOf(
  orchestrationList: readonly OrchestrationStatusWire[],
  id: string,
): DriveMemberVM {
  return { id, displayName: orchestrationList.find((group) => group.id === id)?.displayName ?? id };
}

/**
 * drive 구역 값. `orchestrationList`는 `group.list`의 결과, `frames`는 같은 대화의 `drive.frames` 결과(아래에서 위 순서)다.
 * drive를 쓰지 않는 그룹(`drive: "none"`)은 어느 목록에도 들지 않는다.
 */
export function runtimeViewOf(
  orchestrationList: readonly OrchestrationStatusWire[],
  frames: readonly DriveFrameView[],
): RuntimeDriveView {
  const top = frames.findLast((frame) => frame.plugin !== null);
  const topPlugin = top?.plugin ?? null;
  const holderGroup = orchestrationList.find((group) => group.drive === "holder");
  const queue = frames.flatMap((frame) =>
    frame.state === "waiting" && frame.plugin !== null
      ? [memberOf(orchestrationList, frame.plugin)]
      : [],
  );
  return {
    holder: topPlugin === null ? null : memberOf(orchestrationList, topPlugin),
    holderAgrees: (holderGroup?.id ?? null) === topPlugin,
    queue,
    errored: orchestrationList
      .filter((group) => group.drive === "error")
      .map((group) => memberOf(orchestrationList, group.id)),
    frames,
    used: top?.used ?? { turns: 0, spawns: 0, tokens: 0 },
    limits: {
      turns: top?.limits.turns ?? null,
      spawns: top?.limits.spawns ?? null,
      tokens: top?.limits.tokens ?? null,
    },
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
 * 그룹에 켜짐 요청이 걸려 있으면(`OrchestrationStatus.pendingToggle`) 상태는 켜는 중·끄는 중이다.
 */
export function runtimeRowsOf(
  entries: readonly ExtListEntry[],
  groups: readonly OrchestrationStatusWire[],
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

/** 지역 시각 HH:MM:SS(두 자리씩). 전환 기록 줄과 실패 기록 줄이 같이 쓴다 */
export function clockTextOf(when: Date): string {
  return [when.getHours(), when.getMinutes(), when.getSeconds()].map(pad2).join(":");
}

/**
 * 실패 기록 한 건의 시각(지역 HH:MM:SS). 시각이 없거나 날짜로 읽히지 않으면 null이라 화면은 시각을 보이지 않는다.
 * 같은 시각이면 같은 글이다. 시간대에 따라 글이 달라지므로 시험은 지역 시각으로 만든 값을 쓴다.
 */
export function failureClockOf(at: string | undefined): string | null {
  if (at === undefined) return null;
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? null : clockTextOf(when);
}

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
        time: clockTextOf(when),
        turn: record.turnId === null ? null : record.turnId.slice(-6),
        subject: record.subject,
        change: record.change,
      };
    });
}

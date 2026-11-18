import { assertNever, attemptAsync, err, ok, parse, type Result } from "@fresnel/contracts";
import type { EventId, ThreadId, TurnId } from "@fresnel/contracts/conversation";
import {
  AgentSpawnedPayloadSchema,
  EffectIntentSchema,
  WorkspaceFilesCapturedPayloadSchema,
  type DurableEventEnvelope,
  type FileBefore,
  type RewindFileAction,
  type RewindPlanOutcome,
} from "@fresnel/contracts/records";
import type { RewindPreviewFile, UntrackedEffect } from "@fresnel/contracts/services";
import { resolveWorkspacePath, scopedDeps, WorkspaceFailure } from "@fresnel/core-workspace";
import type { WorkspaceDeps } from "../deps.ts";
import {
  NO_CANCEL,
  inOrder,
  matchesBefore,
  matchesSha,
  readCurrent,
  type CurrentFile,
} from "./files.ts";

// 되감기 계획(L1.persistence.spec §4.13.2, design.md "서비스" 절). 범위는 `to` 항목 뒤의 활성 가지 이벤트다.
// 같은 경로는 범위 안에서 가장 이른 `first:true`의 옛 상태로 돌아가고, 기대 해시는 범위 안 마지막 쓰기 해시다.

/** 계획의 한 줄. 파일 내용은 들지 않는다. `current`는 이 호출 안에서만 쓴다(옛 내용 저장) */
export interface PlanEntry {
  readonly path: string;
  readonly turnId: TurnId;
  readonly action: RewindFileAction;
  readonly expectedSha256: string | null;
  readonly targetBefore: FileBefore;
  readonly outcome: RewindPlanOutcome;
  readonly reason: string | null;
  readonly current: CurrentFile;
}

interface Group {
  readonly path: string;
  readonly turnId: TurnId;
  readonly targetBefore: FileBefore;
  expectedSha256: string;
}

/** 범위 안에서 처음 본 쓰기가 `first:false`면 그 앞의 옛 상태를 알 수 없다(턴 중간 목표). 저장하지 못한 것과 같이 다룬다 */
const UNREADABLE_BEFORE: FileBefore = { state: "unrestorable", reason: "unreadable", size: null };

export interface Decision {
  readonly outcome: RewindPlanOutcome;
  readonly reason: string | null;
}

/**
 * 파일 하나의 결과를 정한다. 순서가 뜻을 정한다. 옛 상태를 저장하지 못했으면 건드리지 않고, 이미 옛 상태면 건너뛴다.
 * 밖에서 바뀌었으면(기대 해시와 다름) 건드리지 않고 알린다. `forced`는 사용자가 덮어쓰기로 고른 경로다.
 */
export function decide(
  targetBefore: FileBefore,
  expectedSha256: string | null,
  current: CurrentFile,
  forced: boolean,
): Decision {
  if (targetBefore.state === "unrestorable") {
    return { outcome: "unrestorable", reason: targetBefore.reason };
  }
  if (current.kind === "denied") return { outcome: "skipped", reason: "denied" };
  if (matchesBefore(current, targetBefore))
    return { outcome: "skipped", reason: "already_original" };
  if (current.kind === "unreadable") return { outcome: "skipped", reason: "unreadable" };
  if (forced || matchesSha(current, expectedSha256)) return { outcome: "planned", reason: null };
  return {
    outcome: "kept_changed",
    reason: current.kind === "absent" ? "deleted_outside" : "changed_outside",
  };
}

async function planOne(scoped: WorkspaceDeps, group: Group, forced: boolean): Promise<PlanEntry> {
  const action: RewindFileAction = group.targetBefore.state === "absent" ? "delete" : "restore";
  const resolved = await attemptAsync(() =>
    resolveWorkspacePath(scoped.roots, group.path, "write", NO_CANCEL),
  );
  // 쓰기 루트 밖이나 보호 경로는 읽지도 않고 건너뛴다. 그 밖의 실패는 읽을 수 없는 것이다
  const current: CurrentFile = resolved.ok
    ? await readCurrent(scoped.env, resolved.value.canonical)
    : { kind: resolved.error.cause instanceof WorkspaceFailure ? "denied" : "unreadable" };
  const decision = decide(group.targetBefore, group.expectedSha256, current, forced);
  return {
    path: group.path,
    turnId: group.turnId,
    action,
    expectedSha256: group.expectedSha256,
    targetBefore: group.targetBefore,
    outcome: decision.outcome,
    reason: decision.reason,
    current,
  };
}

/**
 * 범위(`to` 뒤의 활성 가지 이벤트)의 계획을 만든다. 파일을 쓰지 않는다. `overwrite`에 든 경로는 밖에서 바뀌었어도 계획에 든다.
 * 읽기 실패나 손상된 행은 `row_invalid:<kind>` 문자열이다.
 */
export async function planRange(
  deps: WorkspaceDeps,
  threadId: ThreadId,
  range: readonly DurableEventEnvelope[],
  overwrite: ReadonlySet<string>,
): Promise<Result<PlanEntry[], string>> {
  const groups = new Map<string, Group>();
  for (const event of range) {
    if (event.kind !== "workspace.files_captured" || event.turnId === null) continue;
    const payload = parse(WorkspaceFilesCapturedPayloadSchema, event.payload);
    if (!payload.ok) return err("row_invalid:workspace.files_captured");
    for (const entry of payload.value.entries) {
      const group = groups.get(entry.path);
      if (group === undefined) {
        groups.set(entry.path, {
          path: entry.path,
          turnId: event.turnId,
          targetBefore: entry.first ? entry.before : UNREADABLE_BEFORE,
          expectedSha256: entry.afterSha256,
        });
      } else {
        group.expectedSha256 = entry.afterSha256;
      }
    }
  }
  const scoped = scopedDeps(deps, threadId);
  const plan = await inOrder([...groups.values()], (group) =>
    planOne(scoped, group, overwrite.has(group.path)),
  );
  return ok(plan);
}

/** 미리보기 한 줄. 건너뛴 이유는 미리보기 사유 목록에 있는 것만 보인다(그 밖의 사유는 null) */
export function previewFileOf(entry: PlanEntry): RewindPreviewFile {
  switch (entry.outcome) {
    case "planned":
      return { path: entry.path, action: entry.action, reason: null, turnId: entry.turnId };
    case "kept_changed":
      return {
        path: entry.path,
        action: "keep",
        reason: entry.reason === "deleted_outside" ? "deleted_outside" : "changed_outside",
        turnId: entry.turnId,
      };
    case "skipped":
      return {
        path: entry.path,
        action: "skip",
        reason:
          entry.reason === "already_original" || entry.reason === "unreadable"
            ? entry.reason
            : null,
        turnId: entry.turnId,
      };
    case "unrestorable":
      return {
        path: entry.path,
        action: "skip",
        reason: entry.targetBefore.state === "unrestorable" ? entry.targetBefore.reason : null,
        turnId: entry.turnId,
      };
    default:
      return assertNever(entry.outcome, "RewindPlanOutcome");
  }
}

/**
 * 범위 안의 추적 밖 효과: 셸 명령(`effect.intent`의 도구 이름 `bash`)과 서브에이전트 생성(`agent.spawned`).
 * turn이 없는 이벤트는 건너뛴다. 손상된 행은 `row_invalid`다.
 */
export function untrackedOf(
  range: readonly DurableEventEnvelope[],
): Result<UntrackedEffect[], string> {
  const out: UntrackedEffect[] = [];
  for (const event of range) {
    if (event.turnId === null) continue;
    if (event.kind === "effect.intent") {
      const payload = parse(EffectIntentSchema, event.payload);
      if (!payload.ok) return err("row_invalid:effect.intent");
      if (payload.value.toolName === "bash") {
        out.push({ turnId: event.turnId, kind: "shell", toolCallId: payload.value.toolCallId });
      }
    } else if (event.kind === "agent.spawned") {
      const payload = parse(AgentSpawnedPayloadSchema, event.payload);
      if (!payload.ok) return err("row_invalid:agent.spawned");
      const owner = payload.value.owner;
      out.push({
        turnId: event.turnId,
        kind: "agent",
        toolCallId: owner.kind === "tool" ? owner.toolCallId : null,
      });
    }
  }
  return ok(out);
}

/** `eventId` 뒤의 범위를 활성 가지에서 찾는다. 없으면 빈 범위다 */
export function rangeAfter(
  branch: readonly DurableEventEnvelope[],
  eventId: EventId,
): readonly DurableEventEnvelope[] {
  const index = branch.findIndex((event) => event.id === eventId);
  return index < 0 ? [] : branch.slice(index + 1);
}

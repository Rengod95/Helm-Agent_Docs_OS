import type { TSchema } from "typebox";
import { Bug } from "../../base/index.ts";
import {
  ItemStartedPayloadSchema,
  ItemUpdatedPayloadSchema,
  StepCompletedPayloadSchema,
  StepStartedPayloadSchema,
  StepUpdatedPayloadSchema,
  ThreadClosedPayloadSchema,
  ThreadStartedPayloadSchema,
  ThreadUpdatedPayloadSchema,
  TurnCompletedPayloadSchema,
  TurnStartedPayloadSchema,
  TurnUpdatedPayloadSchema,
} from "../../conversation/index.ts";
import { StepCheckpointSchema } from "../checkpoint.ts";
import { EffectExecSchema, EffectIntentSchema, EffectResultSchema } from "../effects.ts";
import type { CoreEventKind } from "../kind-names.ts";
import {
  AgentJudgedPayloadSchema,
  AgentSettledEventPayloadSchema,
  AgentSpawnedPayloadSchema,
} from "./agent.ts";
import { ARTIFACT_EVENT_CATALOG } from "./artifact.ts";
import { DIALOG_EVENT_CATALOG } from "./dialog.ts";
import type { CatalogEntry } from "./entry.ts";
import { SCHEDULE_EVENT_CATALOG } from "./schedule.ts";
import { WORK_EVENT_CATALOG } from "./work.ts";
import { ApprovalRequestedPayloadSchema, ApprovalResolvedPayloadSchema } from "./approval.ts";
import { ItemRecordedPayloadSchema, PartRecordedPayloadSchema } from "./content.ts";
import {
  LeaseAcquiredPayloadSchema,
  LeaseRejectedPayloadSchema,
  LeaseReleasedPayloadSchema,
  PostAcceptedPayloadSchema,
  ScopeChangedPayloadSchema,
  ScopeHandlerFailedPayloadSchema,
} from "./extension-ops.ts";
import {
  InputPlacedPayloadSchema,
  InputQueuedPayloadSchema,
  InputWithdrawnPayloadSchema,
} from "./input.ts";
import {
  SecretApprovedPayloadSchema,
  SecretDeniedPayloadSchema,
  SecretMaskedPayloadSchema,
  SecretUsedPayloadSchema,
} from "./secret.ts";
import { SettingsChangedPayloadSchema } from "./settings.ts";
import {
  BranchSummarizedPayloadSchema,
  CompactedPayloadSchema,
  LeafMovedPayloadSchema,
  ThreadResumedPayloadSchema,
} from "./thread.ts";
import { TurnAbortRequestedPayloadSchema } from "./turn.ts";

function core(kind: CoreEventKind, durable: boolean, payload: TSchema): CatalogEntry {
  return { kind, version: 1, durable, payload };
}

/** 없앤 kind. 옛 행을 읽는 스키마만 남기고 새로 쓰지 않는다(F.records.spec §3.2 규칙 5) */
function retiredCore(kind: CoreEventKind, durable: boolean, payload: TSchema): CatalogEntry {
  return { kind, version: 1, durable, payload, retired: true };
}

/**
 * 코어 카탈로그 40종, 모두 version 1. F.records.spec §3.3 표와 같다(scripts/check-event-catalog.ts가 대조한다).
 * 휘발 kind: turn.updated, step.updated, item.started, item.updated, scope.handler_failed.
 */
export const CORE_EVENT_CATALOG: readonly CatalogEntry[] = [
  core("thread.started", true, ThreadStartedPayloadSchema),
  core("thread.updated", true, ThreadUpdatedPayloadSchema),
  core("thread.closed", true, ThreadClosedPayloadSchema),
  core("thread.leaf_moved", true, LeafMovedPayloadSchema),
  core("thread.compacted", true, CompactedPayloadSchema),
  core("thread.branch_summarized", true, BranchSummarizedPayloadSchema),
  core("thread.resumed", true, ThreadResumedPayloadSchema),
  core("turn.started", true, TurnStartedPayloadSchema),
  core("turn.updated", false, TurnUpdatedPayloadSchema),
  core("turn.completed", true, TurnCompletedPayloadSchema),
  core("turn.abort_requested", true, TurnAbortRequestedPayloadSchema),
  core("step.started", true, StepStartedPayloadSchema),
  core("step.updated", false, StepUpdatedPayloadSchema),
  core("step.completed", true, StepCompletedPayloadSchema),
  core("item.started", false, ItemStartedPayloadSchema),
  core("item.updated", false, ItemUpdatedPayloadSchema),
  core("item.recorded", true, ItemRecordedPayloadSchema),
  core("part.recorded", true, PartRecordedPayloadSchema),
  core("effect.intent", true, EffectIntentSchema),
  core("effect.exec", true, EffectExecSchema),
  core("effect.result", true, EffectResultSchema),
  core("checkpoint.step", true, StepCheckpointSchema),
  core("scope.changed", true, ScopeChangedPayloadSchema),
  core("scope.handler_failed", false, ScopeHandlerFailedPayloadSchema),
  core("lease.acquired", true, LeaseAcquiredPayloadSchema),
  core("lease.released", true, LeaseReleasedPayloadSchema),
  core("lease.rejected", true, LeaseRejectedPayloadSchema),
  retiredCore("post.accepted", true, PostAcceptedPayloadSchema),
  core("settings.changed", true, SettingsChangedPayloadSchema),
  core("approval.requested", true, ApprovalRequestedPayloadSchema),
  core("approval.resolved", true, ApprovalResolvedPayloadSchema),
  core("input.queued", true, InputQueuedPayloadSchema),
  core("input.placed", true, InputPlacedPayloadSchema),
  core("input.withdrawn", true, InputWithdrawnPayloadSchema),
  core("agent.spawned", true, AgentSpawnedPayloadSchema),
  core("agent.settled", true, AgentSettledEventPayloadSchema),
  core("agent.judged", true, AgentJudgedPayloadSchema),
  core("secret.used", true, SecretUsedPayloadSchema),
  core("secret.denied", true, SecretDeniedPayloadSchema),
  core("secret.approved", true, SecretApprovedPayloadSchema),
  core("secret.masked", true, SecretMaskedPayloadSchema),
];

/** 카탈로그 목록을 이어 붙인다. 같은 kind가 두 번 나오면 Bug다(모듈 로드 시 검사). */
export function mergeCatalogs(
  ...lists: readonly (readonly CatalogEntry[])[]
): readonly CatalogEntry[] {
  const seen = new Set<string>();
  const merged: CatalogEntry[] = [];
  for (const list of lists) {
    for (const entry of list) {
      if (seen.has(entry.kind)) throw new Bug(`duplicate event kind in catalog: ${entry.kind}`);
      seen.add(entry.kind);
      merged.push(entry);
    }
  }
  return merged;
}

/**
 * 코어 카탈로그와 내장 L2 도메인 카탈로그를 이은 병합 카탈로그.
 * 도메인 카탈로그는 work, dialog, artifact, schedule이 채워져 있다.
 */
export const EVENT_CATALOG: readonly CatalogEntry[] = mergeCatalogs(
  CORE_EVENT_CATALOG,
  WORK_EVENT_CATALOG,
  DIALOG_EVENT_CATALOG,
  ARTIFACT_EVENT_CATALOG,
  SCHEDULE_EVENT_CATALOG,
);

const CORE_BY_KIND: ReadonlyMap<string, CatalogEntry> = new Map(
  CORE_EVENT_CATALOG.map((entry) => [entry.kind, entry]),
);

export function catalogEntry(kind: CoreEventKind): CatalogEntry {
  const entry = CORE_BY_KIND.get(kind);
  if (entry === undefined) throw new Bug(`catalogEntry: ${kind} is not in the core catalog`);
  return entry;
}

export type { CatalogEntry } from "./entry.ts";
export * from "./agent.ts";
export * from "./approval.ts";
export * from "./artifact.ts";
export * from "./content.ts";
export * from "./dialog.ts";
export * from "./extension-ops.ts";
export * from "./input.ts";
export * from "./schedule.ts";
export * from "./secret.ts";
export * from "./settings.ts";
export * from "./thread.ts";
export * from "./turn.ts";
export * from "./work.ts";

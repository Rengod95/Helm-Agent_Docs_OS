export type CoreArea =
  | "thread"
  | "turn"
  | "step"
  | "item"
  | "part"
  | "effect"
  | "checkpoint"
  | "scope"
  | "lease"
  | "post"
  | "settings"
  | "approval"
  | "input"
  | "agent"
  | "secret";

/** 코어 kind 41종. F.records.spec §3.3 표와 같다(scripts/check-event-catalog.ts가 대조한다). */
export const CORE_EVENT_KINDS: readonly [
  "thread.started",
  "thread.updated",
  "thread.closed",
  "thread.leaf_moved",
  "thread.compacted",
  "thread.branch_summarized",
  "thread.resumed",
  "turn.started",
  "turn.updated",
  "turn.completed",
  "turn.abort_requested",
  "step.started",
  "step.updated",
  "step.completed",
  "item.started",
  "item.updated",
  "item.recorded",
  "part.recorded",
  "effect.intent",
  "effect.exec",
  "effect.result",
  "checkpoint.step",
  "scope.changed",
  "scope.handler_failed",
  "lease.acquired",
  "lease.released",
  "lease.rejected",
  "post.accepted",
  "settings.changed",
  "approval.requested",
  "approval.resolved",
  "input.queued",
  "input.placed",
  "input.withdrawn",
  "agent.spawned",
  "agent.settled",
  "agent.judged",
  "secret.used",
  "secret.denied",
  "secret.approved",
  "secret.masked",
] = [
  "thread.started",
  "thread.updated",
  "thread.closed",
  "thread.leaf_moved",
  "thread.compacted",
  "thread.branch_summarized",
  "thread.resumed",
  "turn.started",
  "turn.updated",
  "turn.completed",
  "turn.abort_requested",
  "step.started",
  "step.updated",
  "step.completed",
  "item.started",
  "item.updated",
  "item.recorded",
  "part.recorded",
  "effect.intent",
  "effect.exec",
  "effect.result",
  "checkpoint.step",
  "scope.changed",
  "scope.handler_failed",
  "lease.acquired",
  "lease.released",
  "lease.rejected",
  "post.accepted",
  "settings.changed",
  "approval.requested",
  "approval.resolved",
  "input.queued",
  "input.placed",
  "input.withdrawn",
  "agent.spawned",
  "agent.settled",
  "agent.judged",
  "secret.used",
  "secret.denied",
  "secret.approved",
  "secret.masked",
];
export type CoreEventKind = (typeof CORE_EVENT_KINDS)[number];

/** 코어 영역 목록. CoreEventKind의 첫 마디 집합과 같다. */
export const CORE_AREAS: readonly CoreArea[] = [
  "thread",
  "turn",
  "step",
  "item",
  "part",
  "effect",
  "checkpoint",
  "scope",
  "lease",
  "post",
  "settings",
  "approval",
  "input",
  "agent",
  "secret",
];

/** 내장 L2 도메인이 소유하는 영역(§3.3.2). 카탈로그 파일이 있는 영역만 */
export type DomainArea = "work" | "dialog" | "artifact" | "schedule";
export const DOMAIN_AREAS: readonly DomainArea[] = ["work", "dialog", "artifact", "schedule"];
/** 예약만 한 L2 영역. 그 도메인이 kind를 처음 더할 때 DomainArea로 옮긴다 */
export type ReservedDomainArea = "workspace" | "mcp" | "web" | "knowledge";
export const RESERVED_DOMAIN_AREAS: readonly ReservedDomainArea[] = [
  "workspace",
  "mcp",
  "web",
  "knowledge",
];
export type DomainEventKind = `${DomainArea}.${string}`;

export type ExtensionEventKind =
  | `x.${string}.${string}.${string}`
  | `grp.${string}.${string}.${string}`;
export type EventKind = CoreEventKind | DomainEventKind | ExtensionEventKind;

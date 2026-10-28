import { toJsonValue, type JsonValue } from "@xeon/contracts/conversation";
import { parseProposal, type Proposal, type ProposalReason } from "./proposal.ts";
import type { ReviewOutcome } from "./reader.ts";

// L3.learning.spec §3.7.1 비공개 기록 아홉 종. 이벤트가 정본이고 투영기(`learningProjector`)가 `x_learning_*`를 만든다. 모든 payload는 시각 `at`을 싣는다:
// 투영은 시계를 읽지 않는다(eng.events.design EV-06) [제안]. 후보 본문은 `proposal.created`와 `proposal.edited`에만 있고 diff는 싣지 않는다(투영기가 본문에서 만든다).

export type LearningEvent =
  | {
      readonly kind: "fork.started";
      readonly requestId: string;
      readonly epoch: number;
      readonly childThreadId: string;
      readonly reasons: readonly string[];
      readonly parentThreadId: string;
      readonly at: number;
    }
  | {
      readonly kind: "fork.finished";
      readonly requestId: string;
      readonly parentThreadId: string;
      readonly outcome: ReviewOutcome;
      readonly proposalIds: readonly string[];
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly at: number;
    }
  | { readonly kind: "proposal.created"; readonly proposal: Proposal }
  | {
      readonly kind: "proposal.edited";
      readonly id: string;
      readonly revision: number;
      readonly body: string;
      readonly bodyHash: string;
      readonly at: number;
    }
  | {
      readonly kind: "proposal.decided";
      readonly id: string;
      readonly revision: number;
      readonly status: "approved" | "rejected";
      readonly reason: ProposalReason | null;
      readonly scope: "user" | "project";
      readonly at: number;
    }
  | {
      readonly kind: "proposal.applied";
      readonly id: string;
      readonly ledgerId: string;
      readonly afterHash: string;
      readonly at: number;
    }
  | {
      readonly kind: "proposal.apply_failed";
      readonly id: string;
      readonly reason: ProposalReason;
      readonly nextStatus: "pending" | "rejected" | "applied";
      readonly at: number;
    }
  | {
      readonly kind: "proposal.reverted";
      readonly id: string;
      readonly ledgerId: string;
      readonly at: number;
    }
  | { readonly kind: "proposal.expired"; readonly id: string; readonly at: number };

export const LEARNING_EVENT_KINDS: readonly LearningEvent["kind"][] = [
  "fork.started",
  "fork.finished",
  "proposal.created",
  "proposal.edited",
  "proposal.decided",
  "proposal.applied",
  "proposal.apply_failed",
  "proposal.reverted",
  "proposal.expired",
];

export type LearningEventKind = `grp.learning.${LearningEvent["kind"]}`;

export function eventKindOf(event: LearningEvent): LearningEventKind {
  return `grp.learning.${event.kind}`;
}

function without(value: object, omitted: string): { [key: string]: JsonValue } {
  const out: { [key: string]: JsonValue } = {};
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) {
    if (key === omitted) continue;
    const json = toJsonValue(member);
    if (json !== undefined) out[key] = json;
  }
  return out;
}

/** 기록 payload. `kind`는 기록 kind가 싣고, 후보의 diff는 싣지 않는다 */
export function payloadOf(event: LearningEvent): JsonValue {
  return event.kind === "proposal.created"
    ? without(event.proposal, "diff")
    : without(event, "kind");
}

type Fields = Readonly<Record<string, unknown>>;

function fieldsOf(value: unknown): Fields | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries: [string, unknown][] = Object.entries(value);
  return Object.fromEntries(entries);
}

function str(fields: Fields, key: string): string | undefined {
  const value = fields[key];
  return typeof value === "string" ? value : undefined;
}

function num(fields: Fields, key: string): number | undefined {
  const value = fields[key];
  return typeof value === "number" ? value : undefined;
}

function strings(fields: Fields, key: string): readonly string[] | undefined {
  const value = fields[key];
  if (!Array.isArray(value)) return undefined;
  const items: readonly unknown[] = value;
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") return undefined;
    out.push(item);
  }
  return out;
}

const REASONS: readonly ProposalReason[] = [
  "user_rejected",
  "scan_failed",
  "base_stale",
  "op_not_allowed",
  "apply_failed",
  "ttl",
  "rollback_refused",
];
const OUTCOMES: readonly ReviewOutcome[] = ["completed", "aborted", "error", "budget"];

function reasonOf(fields: Fields, key: string): ProposalReason | null | undefined {
  const value = fields[key];
  if (value === null) return null;
  return REASONS.find((reason) => reason === value);
}

/** 기록 kind와 payload를 이벤트로 읽는다. 알 수 없는 kind나 모양이면 undefined(투영은 건너뛴다) */
export function decodeEvent(kind: string, payload: unknown): LearningEvent | undefined {
  const fields = fieldsOf(payload);
  if (fields === undefined || !kind.startsWith("grp.learning.")) return undefined;
  const name = kind.slice("grp.learning.".length);
  const at = num(fields, "at");
  const id = str(fields, "id");
  if (name === "proposal.created") {
    const parsed = parseProposal({ ...fields, diff: "" });
    return parsed.ok ? { kind: "proposal.created", proposal: parsed.value } : undefined;
  }
  if (at === undefined) return undefined;
  if (name === "fork.started") {
    const requestId = str(fields, "requestId");
    const epoch = num(fields, "epoch");
    const childThreadId = str(fields, "childThreadId");
    const parentThreadId = str(fields, "parentThreadId");
    const reasons = strings(fields, "reasons");
    if (requestId === undefined || epoch === undefined || childThreadId === undefined)
      return undefined;
    if (parentThreadId === undefined || reasons === undefined) return undefined;
    return { kind: "fork.started", requestId, epoch, childThreadId, reasons, parentThreadId, at };
  }
  if (name === "fork.finished") {
    const requestId = str(fields, "requestId");
    const parentThreadId = str(fields, "parentThreadId");
    const proposalIds = strings(fields, "proposalIds");
    const inputTokens = num(fields, "inputTokens");
    const outputTokens = num(fields, "outputTokens");
    const outcome = OUTCOMES.find((candidate) => candidate === fields["outcome"]);
    if (requestId === undefined || parentThreadId === undefined || proposalIds === undefined)
      return undefined;
    if (inputTokens === undefined || outputTokens === undefined || outcome === undefined)
      return undefined;
    return {
      kind: "fork.finished",
      requestId,
      parentThreadId,
      outcome,
      proposalIds,
      inputTokens,
      outputTokens,
      at,
    };
  }
  if (id === undefined) return undefined;
  if (name === "proposal.edited") {
    const revision = num(fields, "revision");
    const body = str(fields, "body");
    const bodyHash = str(fields, "bodyHash");
    if (revision === undefined || body === undefined || bodyHash === undefined) return undefined;
    return { kind: "proposal.edited", id, revision, body, bodyHash, at };
  }
  if (name === "proposal.decided") {
    const revision = num(fields, "revision");
    const status =
      fields["status"] === "approved" || fields["status"] === "rejected"
        ? fields["status"]
        : undefined;
    const reason = reasonOf(fields, "reason");
    const scope =
      fields["scope"] === "user" || fields["scope"] === "project" ? fields["scope"] : undefined;
    if (
      revision === undefined ||
      status === undefined ||
      reason === undefined ||
      scope === undefined
    )
      return undefined;
    return { kind: "proposal.decided", id, revision, status, reason, scope, at };
  }
  if (name === "proposal.applied") {
    const ledgerId = str(fields, "ledgerId");
    const afterHash = str(fields, "afterHash");
    return ledgerId === undefined || afterHash === undefined
      ? undefined
      : { kind: "proposal.applied", id, ledgerId, afterHash, at };
  }
  if (name === "proposal.apply_failed") {
    const reason = reasonOf(fields, "reason");
    const next = fields["nextStatus"];
    const nextStatus =
      next === "pending" || next === "rejected" || next === "applied" ? next : undefined;
    if (reason === undefined || reason === null || nextStatus === undefined) return undefined;
    return { kind: "proposal.apply_failed", id, reason, nextStatus, at };
  }
  if (name === "proposal.reverted") {
    const ledgerId = str(fields, "ledgerId");
    return ledgerId === undefined ? undefined : { kind: "proposal.reverted", id, ledgerId, at };
  }
  if (name === "proposal.expired") return { kind: "proposal.expired", id, at };
  return undefined;
}

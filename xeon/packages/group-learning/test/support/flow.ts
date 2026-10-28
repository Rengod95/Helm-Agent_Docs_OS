import type { ThreadId } from "@xeon/contracts/conversation";
import { err, ok, type Result } from "@xeon/contracts";
import {
  decisionCommandLine,
  type DecisionResult,
  type LearningError,
  type ProposalDecision,
  type ProposalFilter,
  type ProposalView,
  type QueueSweep,
} from "../../src/index.ts";
import type { ProposeResult } from "../../src/review/propose.ts";
import { createRig, type Rig, type RigOptions } from "./rig.ts";

export interface Review {
  readonly rig: Rig;
  readonly requestId: string;
  readonly childThreadId: ThreadId;
}

/** 임계 1로 turn 하나를 정착시켜 검토 포크를 시작한다 */
export async function startReview(options: RigOptions = {}): Promise<Review> {
  const rig = await createRig({
    ...options,
    settings: { "l3.learning.trigger.userTurns": 1, ...options.settings },
  });
  await rig.turn();
  const delegation = rig.agents.delegated[0];
  if (delegation === undefined) throw new Error("the review did not start");
  return { rig, requestId: delegation.request.requestId, childThreadId: delegation.childThreadId };
}

/** 검토 포크가 제안 도구를 부른다 */
export async function submit(
  review: Review,
  args: unknown,
  options: { readonly afterUntrusted?: boolean; readonly toolCallId?: string } = {},
): Promise<ProposeResult> {
  // 도구 execute는 자식 대화의 ambient 안에서 돈다. 자식 thread는 열려 있어야 한다
  await review.rig.t.host.openThread(review.childThreadId);
  toolCalls += 1;
  const result: unknown = await review.rig.tool().execute(toJson(args), {
    threadId: review.childThreadId,
    signal: new AbortController().signal,
    toolCallId: options.toolCallId ?? `call_${String(toolCalls)}`,
    caller: {
      kind: "model",
      agent: "background",
      ...(options.afterUntrusted === true ? { afterUntrusted: true } : {}),
    },
  });
  return asProposeResult(result);
}

let toolCalls = 0;

function toJson(value: unknown): never {
  // 시험 입력은 JSON 값이다. 도구 인자 형식은 도구가 검사한다
  const copied: unknown = JSON.parse(JSON.stringify(value));
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A6 시험의 입력 주입: 인자 형식 검사는 도구가 한다 (eng.typescript.guide TY-06)
  return copied as never;
}

function asProposeResult(value: unknown): ProposeResult {
  if (typeof value === "object" && value !== null && "ok" in value) {
    if (
      value.ok === true &&
      "proposalId" in value &&
      typeof value.proposalId === "string" &&
      "status" in value &&
      typeof value.status === "string"
    ) {
      // 시험은 값을 그대로 비교하므로 형태만 확인한다
      return { ok: true, proposalId: value.proposalId, status: statusOf(value.status) };
    }
    if (
      value.ok === false &&
      "reason" in value &&
      "hint" in value &&
      typeof value.hint === "string"
    ) {
      return { ok: false, reason: reasonOf(value.reason), hint: value.hint };
    }
  }
  throw new Error(`unexpected tool result ${JSON.stringify(value)}`);
}

const STATUSES: readonly Extract<ProposeResult, { ok: true }>["status"][] = [
  "pending",
  "approved",
  "rejected",
  "applied",
  "reverted",
  "expired",
];

const REASONS: readonly Extract<ProposeResult, { ok: false }>["reason"][] = [
  "base_missing",
  "base_stale",
  "op_not_allowed",
  "invalid",
  "limit",
  "name_exists",
  "unavailable",
];

function statusOf(value: string): Extract<ProposeResult, { ok: true }>["status"] {
  const found = STATUSES.find((status) => status === value);
  if (found === undefined) throw new Error(`unexpected status ${value}`);
  return found;
}

function reasonOf(value: unknown): Extract<ProposeResult, { ok: false }>["reason"] {
  const found = REASONS.find((reason) => reason === value);
  if (found === undefined) throw new Error(`unexpected reason ${String(value)}`);
  return found;
}

/** 대기열 결정은 `/learning` 명령으로 실행한다(기록을 쓰려면 대화가 필요하다). 시험이 읽기 쉽게 같은 모양의 면으로 감싼다 */
export interface QueueTestApi {
  list(filter: ProposalFilter): Promise<Result<readonly ProposalView[], LearningError>>;
  decide(decision: ProposalDecision, signal?: AbortSignal): Promise<DecisionResult>;
  sweep(): Promise<Result<QueueSweep, LearningError>>;
}

export function queueApi(rig: Rig): QueueTestApi {
  return {
    list: (filter) => {
      const api = rig.bridge.api();
      if (api === undefined) throw new Error("the learning group is not attached to the bridge");
      return api.list(filter);
    },
    async decide(decision) {
      const report = await rig.command(decisionCommandLine(decision));
      if (report.kind === "decision") return report.result;
      if (report.kind === "error") return { ok: false, error: report.error };
      throw new Error(`unexpected report ${report.kind}`);
    },
    async sweep() {
      const report = await rig.command("queue");
      if (report.kind === "queue" && report.sweep !== null) return ok(report.sweep);
      if (report.kind === "error") return err(report.error);
      throw new Error("the command did not sweep");
    },
  };
}

export const NEW_SKILL = {
  kind: "skill",
  op: "create",
  target: "release-notes",
  body: "# Release notes\nWrite release notes from the merged pull requests.",
  rationale: "The user asked twice for the same release notes format.",
  evidenceEventIds: ["evt_00000000000000000000000001"],
} as const;

import { parse, type Clock, type Result, type SchemaProof } from "@xeon/contracts";
import type { CallerInfo } from "@xeon/contracts/capabilities";
import type { JsonValue, ThreadId } from "@xeon/contracts/conversation";
import type { ToolResourceDef } from "@xeon/contracts/extensions";
import { Type, type TUnsafe } from "typebox";
import { sha256Hex } from "../hash.ts";
import { renderDiff } from "../proposals/diff.ts";
import type { KnowledgeCall, KnowledgeFailure, KnowledgePort } from "../proposals/knowledge.ts";
import { descriptionOf } from "../proposals/knowledge.ts";
import type { QueueOps } from "../proposals/ops.ts";
import {
  isDestructiveOp,
  opAllowedFor,
  type Proposal,
  type ProposalOp,
  type ProposalStatus,
} from "../proposals/proposal.ts";
import { needsApproval } from "../proposals/queue.ts";
import { preScan, selfCheck } from "../proposals/scan.ts";
import type { LearningQueueReader, StoreFailure } from "../proposals/reader.ts";
import { parseTarget, type ParsedTarget } from "../proposals/target.ts";
import type { LearningSettings, SettingsUnavailable } from "../settings.ts";
import { LEARNING_PROPOSE_TOOL } from "./policy.ts";

// L3.learning.spec §3.5 제안 도구. 이 도구는 파일을 바꾸지 않는다. 후보 행을 대기열에 넣는 것만 한다(§4.5 규칙 1).
// 도구 execute는 재실행되는 코드가 아니므로 능력 읽기를 직접 부를 수 있다(ADR-0015 §3.1 1번).

/** 한 검토에서 받을 후보 수 상한 [제안, §3.5] */
const MAX_CANDIDATES_PER_REVIEW = 8;

interface ProposeInput {
  readonly kind: "skill" | "memory" | "feedback";
  readonly op: ProposalOp;
  /** 스킬 이름 또는 메모리 영역 이름. 연산별 형식은 proposals/target.ts */
  readonly target: string;
  /** 새 내용 전체(create, add_file, add, replace) 또는 치환 목록 JSON(patch) */
  readonly body: string;
  /** 스킬 create의 설명. 없으면 본문 첫 줄 [제안] */
  readonly description?: string;
  /** patch·replace·archive·remove에서 필수. skill_view·memory 읽기가 돌려준 해시 */
  readonly baseHash?: string;
  readonly rationale: string;
  /** 근거가 된 부모 대화 이벤트 id. 1개 이상 */
  readonly evidenceEventIds: readonly string[];
}

const inputShape = Type.Object(
  {
    kind: Type.Union([Type.Literal("skill"), Type.Literal("memory"), Type.Literal("feedback")]),
    op: Type.Union([
      Type.Literal("create"),
      Type.Literal("patch"),
      Type.Literal("add_file"),
      Type.Literal("archive"),
      Type.Literal("add"),
      Type.Literal("replace"),
      Type.Literal("remove"),
    ]),
    target: Type.String({ minLength: 1, maxLength: 128 }),
    body: Type.String({ minLength: 1, maxLength: 100_000 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
    baseHash: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })),
    rationale: Type.String({ minLength: 1, maxLength: 2000 }),
    evidenceEventIds: Type.Array(Type.String(), { minItems: 1, maxItems: 32 }),
  },
  { additionalProperties: false },
);

const ProposeInputSchema: TUnsafe<ProposeInput> = Type.Unsafe<ProposeInput>(
  inputShape satisfies SchemaProof<ProposeInput, typeof inputShape>,
);

/** 도구 결과로 돌려주는 거부 사유. 모델이 고쳐 다시 부를 수 있는 값이다 */
type ProposeRefusal =
  | "base_missing"
  | "base_stale"
  | "op_not_allowed"
  | "invalid"
  | "limit"
  /** create인데 같은 이름의 스킬이 있음. patch와 baseHash로 다시 제안하라는 안내(§4.5 규칙 4) */
  | "name_exists"
  /** 지식 능력이 없거나 일시 실패, 설정을 읽지 못함. 후보 없음 */
  | "unavailable";

export type ProposeResult =
  | { readonly ok: true; readonly proposalId: string; readonly status: ProposalStatus }
  | { readonly ok: false; readonly reason: ProposeRefusal; readonly hint: string };

export interface ProposeDeps {
  readonly reader: LearningQueueReader;
  readonly clock: Clock;
  readonly settings: () => Result<LearningSettings, SettingsUnavailable>;
  readonly knowledge: () => Result<KnowledgePort, KnowledgeFailure>;
  readonly ops: QueueOps;
}

function refuse(reason: ProposeRefusal, hint: string): ProposeResult {
  return { ok: false, reason, hint };
}

function storeRefusal(failure: StoreFailure): ProposeResult {
  return refuse("unavailable", `the proposal queue is unavailable: ${failure.detail}`);
}

const OPEN: readonly ProposalStatus[] = ["pending", "approved"];

/** 제안 하나를 처리한다. 예상 가능한 실패는 모두 `ProposeResult`다 */
async function propose(
  deps: ProposeDeps,
  args: unknown,
  ctx: {
    readonly threadId: ThreadId;
    readonly signal: AbortSignal;
    readonly toolCallId: string;
    readonly caller: CallerInfo;
  },
): Promise<ProposeResult> {
  const input = parse(ProposeInputSchema, args);
  if (!input.ok) {
    return refuse(
      "invalid",
      `the arguments do not match the schema: ${input.error.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`,
    );
  }
  const value = input.value;
  const settings = deps.settings();
  if (!settings.ok) return refuse("unavailable", "the learning settings could not be read");
  if (!opAllowedFor(value.kind, value.op)) {
    return refuse("op_not_allowed", `${value.kind} candidates do not take ${value.op}`);
  }
  const target = parseTarget(value.kind, value.op, value.target);
  if (!target.ok) return refuse("invalid", target.error.detail);
  const own = selfCheck({ ...value, baseHash: value.baseHash ?? null });
  if (own.kind === "refused") return refuse(own.why, own.detail);
  if (isDestructiveOp(value.op) && value.baseHash === undefined) {
    return refuse(
      "base_missing",
      "read the current content first (skill_view or the memory read) and pass its hash as baseHash",
    );
  }
  const knowledge = deps.knowledge();
  if (!knowledge.ok) return refuse("unavailable", "the knowledge store is not available");
  const call = { signal: ctx.signal, threadId: ctx.threadId };

  // 검토 포크의 도구 호출이면 그 검토의 후보다. 부모 thread는 검토 행이 안다
  const review = await deps.reader.getReviewByChild(ctx.threadId);
  if (!review.ok) return storeRefusal(review.error);
  const reviewId = review.value?.requestId ?? null;
  const parentThread = review.value?.threadId ?? ctx.threadId;
  const open = await deps.reader.listProposals({ statuses: OPEN });
  if (!open.ok) return storeRefusal(open.error);
  if (reviewId !== null) {
    const made = await deps.reader.listProposals({ reviewId });
    if (!made.ok) return storeRefusal(made.error);
    if (made.value.length >= MAX_CANDIDATES_PER_REVIEW) {
      return refuse(
        "limit",
        `a review accepts at most ${String(MAX_CANDIDATES_PER_REVIEW)} candidates`,
      );
    }
  }
  const bodyHash = sha256Hex(value.body);
  const same = open.value.find(
    (row) =>
      row.kind === value.kind &&
      row.op === value.op &&
      row.target === value.target &&
      row.bodyHash === bodyHash,
  );
  if (same !== undefined) return { ok: true, proposalId: same.id, status: same.status };

  const guard = await guardOf(knowledge.value, value, target.value, open.value, call);
  if (guard.kind === "refused") return guard.result;

  const scanned = await preScan(
    { ...value, baseHash: value.baseHash ?? null },
    knowledge.value,
    settings.value.scanEnabled,
    call,
  );
  if (!scanned.ok) return refuse("unavailable", "the pre-scan could not run");
  if (scanned.value.kind === "refused") return refuse(scanned.value.why, scanned.value.detail);
  const now = deps.clock.now();
  const blocked = scanned.value.kind === "blocked";
  const destructive = isDestructiveOp(value.op);
  const base: Proposal = {
    // 호출 id에서 만든 결정적 id: 같은 호출을 다시 실행해도 같은 후보다(ambient의 멱등 키와 같은 근거)
    id: `prop_${sha256Hex(ctx.toolCallId).slice(0, 26).toUpperCase()}`,
    kind: value.kind,
    op: value.op,
    target: value.target,
    diff: blocked ? "" : renderDiff(value.op, value.target, value.body),
    // 스캔이 막은 후보는 본문을 남기지 않는다(§4.5 표). 해시는 같은 후보를 다시 올리는 것을 알아보는 데 쓴다
    body: blocked ? "" : value.body,
    description:
      !blocked && value.kind === "skill" && value.op === "create"
        ? (value.description ?? descriptionOf(value.body))
        : null,
    bodyHash,
    baseHash: value.baseHash ?? null,
    rationale: value.rationale,
    evidenceEventIds: [...value.evidenceEventIds],
    threadId: parentThread,
    status: blocked ? "rejected" : "pending",
    reviewId,
    conflictsWith: guard.conflictsWith,
    destructive,
    // 도구로 만든 후보는 모두 사용자 범위다. 프로젝트 범위는 승인 화면에서만 고른다 [결정: D-M3-09](§4.5 규칙 8)
    scope: "user",
    // 이번 turn에 웹·MCP 같은 신뢰할 수 없는 도구 결과를 읽었다(M3-REQ-100). 검토 포크는 부모 스냅샷을 복제하므로 부모가 읽었으면 참이다
    afterUntrusted: ctx.caller.afterUntrusted === true,
    reason: blocked ? "scan_failed" : null,
    findings: scanned.value.kind === "blocked" ? [...scanned.value.rules] : [],
    ledgerId: null,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
  const policyApproved = !blocked && !needsApproval(base, settings.value.approvalRequired);
  const queued = await deps.ops.enqueue(base, policyApproved, ctx.signal);
  return { ok: true, proposalId: base.id, status: queued.status };
}

type Guard =
  | { readonly kind: "ok"; readonly conflictsWith: string | null }
  | { readonly kind: "refused"; readonly result: ProposeResult };

function unavailableGuard(failure: KnowledgeFailure): Guard {
  return {
    kind: "refused",
    result: refuse("unavailable", `the knowledge store failed: ${failure.detail ?? "unknown"}`),
  };
}

/** 읽기 선행 가드(`baseHash`)와 같은 이름 검사, 유사 스킬 표시(§4.5 규칙 4). 능력 읽기는 도구 execute에서만 부른다 */
async function guardOf(
  knowledge: KnowledgePort,
  input: ProposeInput,
  target: ParsedTarget,
  open: readonly Proposal[],
  call: KnowledgeCall,
): Promise<Guard> {
  if (target.kind === "skill") {
    if (input.op === "create") {
      const queued = open.some(
        (row) => row.kind === "skill" && row.op === "create" && row.target === input.target,
      );
      if (queued) return nameExists(input.target);
      const current = await knowledge.skillHash(target.name, call);
      if (!current.ok) return unavailableGuard(current.error);
      if (current.value.state === "present") return nameExists(target.name);
      const similar = await knowledge.similarSkill(
        target.name,
        input.description ?? descriptionOf(input.body),
        call,
      );
      return { kind: "ok", conflictsWith: similar.ok ? similar.value : null };
    }
    const current = await knowledge.skillHash(target.name, call);
    if (!current.ok) return unavailableGuard(current.error);
    if (current.value.state === "absent") {
      return {
        kind: "refused",
        result: refuse("invalid", `skill ${target.name} does not exist; create it first`),
      };
    }
    if (input.op !== "add_file" && current.value.hash !== input.baseHash) return baseStale();
    return { kind: "ok", conflictsWith: null };
  }
  if (target.kind === "memory" && input.op !== "add") {
    const current = await knowledge.memoryHash(target.area, call);
    if (!current.ok) return unavailableGuard(current.error);
    if (current.value !== input.baseHash) return baseStale();
  }
  return { kind: "ok", conflictsWith: null };
}

function nameExists(name: string): Guard {
  return {
    kind: "refused",
    result: refuse(
      "name_exists",
      `a skill named ${name} already exists or is already queued; read it with skill_view and propose a patch with its treeHash as baseHash`,
    ),
  };
}

function baseStale(): Guard {
  return {
    kind: "refused",
    result: refuse(
      "base_stale",
      "the content changed since you read it; read it again and use the new hash as baseHash",
    ),
  };
}

const PROPOSE_DESCRIPTION =
  "Submit a candidate for the user to review: a skill (create, patch, add_file, archive), a memory entry (add, replace, remove) or a work-style feedback note (feedback add). " +
  "This never changes a file; the candidate waits in the approval queue. Patch, archive, replace and remove need baseHash from a fresh read.";

/** 모델 도구 정의. `g.registerTool`로 등록한다. 후보 id와 기록 키가 호출 id에서 정해져 같은 호출의 재실행은 같은 후보다 */
export function proposeTool(deps: ProposeDeps): ToolResourceDef {
  return {
    name: LEARNING_PROPOSE_TOOL,
    description: PROPOSE_DESCRIPTION,
    parameters: inputShape,
    replay: "safe",
    // 파일을 바꾸지 않고 대기열에 후보만 넣는다. 읽기 등급이라 무인 검토 포크가 승인을 기다리지 않는다(M3-REQ-78, builtin 그룹만 선언할 수 있다).
    // 같은 호출 id와 같은 후보는 한 번만 남는다
    risk: "read",
    hints: { idempotent: true },
    async execute(args: JsonValue, ctx): Promise<unknown> {
      return propose(deps, args, ctx);
    },
  };
}

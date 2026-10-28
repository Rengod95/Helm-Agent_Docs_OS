import { assertNever, attemptAsync, parse, parseJson, type LogFields } from "@xeon/contracts";
import { isId } from "@xeon/contracts/conversation";
import { isCapabilityError, type CallOptions } from "@xeon/contracts/capabilities";
import type {
  ProposalDecideParams,
  ProposalDecideResult,
  ProposalListParams,
  ProposalListResult,
  ProposalRow,
  ProposalSource,
  ProposalStatusWire,
} from "@xeon/contracts/wire";
import type { KnowledgeProposalWire } from "@xeon/cap-knowledge";
import {
  decisionCommandLine,
  type CommandReport,
  type DecisionResult,
  type LearningError,
  type LearningQueueApi,
  type ProposalDecision,
  type ProposalView,
} from "@xeon/group-learning";
import type { LearningRunner } from "./learning.ts";
import { Type } from "typebox";
import type { ProposalPort } from "../types.ts";

// M3-REQ-18(D-M3-32 a). 승인 화면이 읽는 대기열 둘을 한 목록으로 합치고 결정을 출처로 보낸다. 대기열은 합치지 않는다: 학습 그룹은 근거 이벤트,
// 검토 id, 수정(`edit`), 충돌 대상을 가지고 L2 대기열에는 그 필드가 없다(L3.learning.spec §3.7.1). 이 파일은 조립 루트 코드다(DR-14 예외 2).

/** 학습 그룹의 상태 집합. wire 상태 합집합에서 `stale`(지식 전용)만 없다 */
const LEARNING_STATUSES: ReadonlySet<ProposalStatusWire> = new Set<ProposalStatusWire>([
  "pending",
  "approved",
  "applied",
  "rejected",
  "expired",
  "reverted",
]);

const DEFAULT_LIMIT = 50;
/** 쪽 크기 상한. 요청한 `limit`이 더 커도 이 크기로 줄여 돌려주고 `nextCursor`가 이어 간다 */
const PAGE_MAX = 100;
/** 같은 `createdAt`의 행이 쪽 경계에 걸릴 때를 위한 여유 행 수(지식 어댑터의 같은 시각 정렬은 id 내림차순이라 합친 목록과 반대다) */
const TIE_PAD = 50;

export interface ProposalPortDeps {
  /** 학습 그룹이 켜져 있으면 대기열 면, 꺼졌거나 안전 모드면 undefined */
  readonly learning: () => LearningQueueApi | undefined;
  /** 결정과 지연 정리를 `/learning` 명령으로 실행한다(기록을 쓰므로 대화가 필요하다) */
  readonly runner: LearningRunner;
  /** 지식 능력이 있으면 대기열 어댑터, 없으면 undefined */
  readonly knowledge: () => KnowledgeProposalWire | undefined;
  /** 오류 기록(결정에 쓰지 않는 실패: 정리, 알 수 없는 오류 코드) */
  readonly report: (message: string, fields: LogFields) => void;
}

/** 학습 후보 보기를 합친 목록의 행으로 옮긴다. `scope`는 스킬만 의미가 있고 그 밖은 null이다 */
function learningRowOf(view: ProposalView): ProposalRow {
  return {
    source: "learning",
    id: view.id,
    kind: view.kind,
    op: view.op,
    target: view.target,
    status: view.status,
    destructive: view.destructive,
    diff: view.diff,
    rationale: view.rationale,
    evidence: view.evidence.flatMap((entry) =>
      isId("thr", entry.threadId) ? [{ eventId: entry.eventId, threadId: entry.threadId }] : [],
    ),
    conflictsWith: view.conflictsWith,
    reason: view.reason,
    revision: view.revision,
    scope: view.kind === "skill" ? view.scope : null,
    afterUntrusted: view.afterUntrusted,
    createdAt: view.createdAt,
  };
}

interface RowKey {
  readonly createdAt: number;
  readonly source: ProposalSource;
  readonly id: string;
}

/** 합친 목록의 순서: `createdAt` 내림차순, 같으면 `(source, id)` 오름차순 */
function compareKeys(a: RowKey, b: RowKey): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

const CursorSchema = Type.Object(
  {
    createdAt: Type.Integer({ minimum: 0 }),
    source: Type.Union([Type.Literal("learning"), Type.Literal("knowledge")]),
    id: Type.String(),
  },
  { additionalProperties: false },
);

function encodeCursor(row: RowKey): string {
  const cursor: RowKey = { createdAt: row.createdAt, source: row.source, id: row.id };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** 불투명 커서. 읽을 수 없으면 undefined이고 호출한 쪽은 처음부터 읽는다 */
function decodeCursor(text: string | undefined): RowKey | undefined {
  if (text === undefined) return undefined;
  const json = parseJson(Buffer.from(text, "base64url").toString("utf8"));
  if (!json.ok) return undefined;
  const parsed = parse(CursorSchema, json.value);
  return parsed.ok ? parsed.value : undefined;
}

function afterCursor(row: RowKey, cursor: RowKey | undefined): boolean {
  return cursor === undefined || compareKeys(row, cursor) > 0;
}

/** 호스트(사용자)가 부른 호출 문맥. 결정과 목록은 사람의 일이다(`ledger.decide`는 호스트 호출만 받는다) */
function hostCall(signal: AbortSignal): CallOptions {
  return { signal, context: { caller: { kind: "host" } } };
}

function decideFailure(
  reason: Extract<ProposalDecideResult, { ok: false }>["reason"],
  detail?: string,
): ProposalDecideResult {
  return { ok: false, reason, ...(detail === undefined ? {} : { detail }) };
}

/** 학습 대기열의 오류를 결정 실패 이유로 옮긴다(L3.learning.spec §3.9 → F wire `PROPOSAL_DECIDE_FAILURES`) */
function failureOfLearning(error: LearningError): ProposalDecideResult {
  switch (error.kind) {
    case "learning.notFound":
      return decideFailure("not_found");
    case "learning.revisionMismatch":
      return decideFailure("revision_mismatch", `current revision is ${String(error.current)}`);
    case "learning.closed":
      return decideFailure("closed", `the proposal is ${error.status}`);
    case "learning.scopeNotAllowed":
      return decideFailure("scope_not_allowed");
    case "learning.invalidBody":
      return decideFailure("unsupported", error.detail.slice(0, 500));
    case "learning.noConversation":
    case "learning.knowledgeUnavailable":
    case "learning.settingsUnavailable":
    case "learning.storeUnavailable":
    case "learning.reviewBusy":
    case "learning.noSnapshot":
    case "learning.delegateFailed":
      return decideFailure("unavailable", error.kind);
    default:
      return assertNever(error, "LearningError");
  }
}

/**
 * 결정이 끝난 행의 상태가 실패를 뜻하는가: 스캔이 막아 거절되었거나(수정 뒤 스캔 포함), 원본이 바뀌어 `pending`으로 돌아갔다.
 * 승인 뒤 적용이 일시 실패하면(`approved` 유지) 성공이고 `applied`는 거짓이다. 다음 명령 진입 또는 목록 조회의 지연 정리가 다시 적용한다
 */
function resultOfDecision(result: DecisionResult): ProposalDecideResult {
  if (!result.ok) return failureOfLearning(result.error);
  const row = learningRowOf(result.proposal);
  if (result.proposal.status === "rejected" && result.proposal.reason === "scan_failed") {
    return decideFailure("scan_failed");
  }
  if (result.proposal.status === "rejected" && result.proposal.reason === "apply_failed") {
    return decideFailure("unavailable", "apply_failed");
  }
  if (result.proposal.status === "pending" && result.proposal.reason === "base_stale") {
    return decideFailure("base_stale");
  }
  return { ok: true, proposal: row, applied: result.applied };
}

/** 명령이 낸 값을 결정 결과로 옮긴다. 결정 명령은 `decision`이나 `error` 값을 낸다 */
function resultOfReport(report: CommandReport): ProposalDecideResult {
  switch (report.kind) {
    case "decision":
      return resultOfDecision(report.result);
    case "error":
      return failureOfLearning(report.error);
    case "usage":
      return decideFailure("unsupported", report.text.slice(0, 500));
    case "queue":
    case "show":
    case "review":
    case "cancel":
      return decideFailure("unavailable", `unexpected command result: ${report.kind}`);
    default:
      return assertNever(report, "CommandReport");
  }
}

function learningDecision(params: ProposalDecideParams): ProposalDecision {
  switch (params.decision) {
    case "approve":
      return {
        kind: "approve",
        proposalId: params.id,
        revision: params.revision,
        ...(params.scope === undefined ? {} : { scope: params.scope }),
      };
    case "reject":
      return {
        kind: "reject",
        proposalId: params.id,
        ...(params.note === undefined ? {} : { note: params.note }),
      };
    case "edit":
      return {
        kind: "edit",
        proposalId: params.id,
        revision: params.revision,
        body: params.body,
      };
    case "revert":
      return { kind: "revert", proposalId: params.id };
    default:
      return assertNever(params, "ProposalDecideParams");
  }
}

export function createProposalPort(deps: ProposalPortDeps): ProposalPort {
  /** 학습 출처의 행. 읽지 못하면 undefined(출처를 `unavailable`에 올린다) */
  async function learningRows(
    params: ProposalListParams,
  ): Promise<readonly ProposalRow[] | undefined> {
    const api = deps.learning();
    if (api === undefined) return undefined;
    // 화면을 열 때 지연 정리가 돈다: 만료와 승인된 미적용 재적용(L3.learning.spec §4.5 규칙 7). `/learning queue`가 진입 때 정리하므로
    // 그 명령을 열린 대화에서 실행한다. 대화가 없거나 실패해도 목록은 읽는다
    const swept = await deps.runner.run("queue", undefined);
    if (swept.kind === "unavailable")
      deps.report("proposal.sweep_skipped", { detail: swept.detail });
    else if (swept.report.kind === "error")
      deps.report("proposal.sweep_failed", { error: swept.report.error.kind });
    const statuses = params.status?.filter((status) => LEARNING_STATUSES.has(status));
    // 학습 상태가 하나도 없는 필터(예: stale만)는 학습 쪽에서 빈 목록이다
    if (statuses !== undefined && statuses.length === 0) return [];
    const listed = await api.list(
      statuses === undefined
        ? {}
        : {
            statuses: statuses.flatMap((status) => (status === "stale" ? [] : [status])),
          },
    );
    if (!listed.ok) {
      deps.report("proposal.learning_list_failed", { error: listed.error.kind });
      return undefined;
    }
    // 근거의 thread id가 `thr` 형식이 아니면 wire 행에 실을 수 없어 그 항목을 뺀다. 조용히 빼지 않고 알린다
    return listed.value.map((view) => {
      const mapped = learningRowOf(view);
      if (mapped.evidence.length < view.evidence.length) {
        deps.report("proposal.evidence_dropped", {
          id: view.id,
          dropped: view.evidence.length - mapped.evidence.length,
        });
      }
      return mapped;
    });
  }

  /** 지식 출처의 행. 어댑터가 없거나 읽기가 실패하면 undefined */
  async function knowledgeRows(
    params: ProposalListParams,
    limit: number,
    cursor: RowKey | undefined,
    signal: AbortSignal,
  ): Promise<readonly ProposalRow[] | undefined> {
    const wire = deps.knowledge();
    if (wire === undefined) return undefined;
    const read = await attemptAsync(() =>
      wire.list(
        {
          ...(params.status === undefined ? {} : { status: params.status }),
          limit: Math.min(limit, 200),
          // 커서가 있으면 그 시각 이전(같은 시각 포함)부터 읽는다. 같은 시각의 앞선 행은 호출한 쪽이 `afterCursor`로 거른다
          ...(cursor === undefined ? {} : { before: { createdAt: cursor.createdAt + 1, id: "" } }),
        },
        hostCall(signal),
      ),
    );
    if (read.ok) return read.value;
    if (isCapabilityError(read.error.cause)) {
      deps.report("proposal.knowledge_list_failed", { code: read.error.cause.data.code });
      return undefined;
    }
    throw read.error.cause;
  }

  return {
    async list(params, signal) {
      const wanted: readonly ProposalSource[] =
        params.source === undefined ? ["learning", "knowledge"] : [params.source];
      // 지식 어댑터는 한 번에 200행까지 준다. 한 쪽(page)이 그 안에서 `limit + 1`행과 같은 시각의 중복 여유(TIE_PAD)를 채우도록 쪽 크기를 제한한다
      const limit = Math.min(params.limit ?? DEFAULT_LIMIT, PAGE_MAX);
      const cursor = decodeCursor(params.cursor);
      const unavailable: ProposalSource[] = [];
      const rows: ProposalRow[] = [];
      if (wanted.includes("learning")) {
        const learning = await learningRows(params);
        if (learning === undefined) unavailable.push("learning");
        else rows.push(...learning);
      }
      if (wanted.includes("knowledge")) {
        const knowledge = await knowledgeRows(params, limit + 1 + TIE_PAD, cursor, signal);
        if (knowledge === undefined) unavailable.push("knowledge");
        else rows.push(...knowledge);
      }
      const ordered = rows.toSorted(compareKeys).filter((row) => afterCursor(row, cursor));
      const page = ordered.slice(0, limit);
      const last = page.at(-1);
      const result: ProposalListResult = {
        proposals: page,
        nextCursor: ordered.length > limit && last !== undefined ? encodeCursor(last) : null,
        unavailable,
      };
      return result;
    },
    async decide(params, signal) {
      if (params.source === "learning") {
        const api = deps.learning();
        if (api === undefined) return decideFailure("unavailable", "learning group is not running");
        // 결정은 후보의 부모 대화에서 실행한다. 그 대화가 이 호스트에서 열려 있지 않으면 열린 대화에서 실행한다
        const listed = await api.list({});
        const owner = listed.ok
          ? listed.value.find((view) => view.id === params.id)?.evidence[0]?.threadId
          : undefined;
        const ran = await deps.runner.run(decisionCommandLine(learningDecision(params)), owner);
        return ran.kind === "unavailable"
          ? decideFailure("unavailable", ran.detail)
          : resultOfReport(ran.report);
      }
      const wire = deps.knowledge();
      if (wire === undefined)
        return decideFailure("unavailable", "knowledge store is not available");
      return wire.decide(params, hostCall(signal));
    },
  };
}

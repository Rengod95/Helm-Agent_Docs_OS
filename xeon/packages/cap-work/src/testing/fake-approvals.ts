import { Bug, err, ok, parse, type Result } from "@xeon/contracts";
import {
  JsonObjectSchema,
  ApprovalIdSchema,
  type ApprovalId,
  type IdFactory,
  type JsonValue,
  type ThreadId,
} from "@xeon/contracts/conversation";
import type {
  ApprovalDecision,
  ApprovalOrigin,
  ApprovalRequestError,
  L2ApprovalRequest,
  L2ApprovalRespondInput,
  L2ApprovalSnapshot,
  L2ApprovalsPort,
  PermissionMode,
} from "@xeon/contracts/services";
import type { PlanApprovalsFactory } from "../ports/approvals.ts";
import type { FakeWriter } from "./fake-writer.ts";

// L1.tools 승인 대역(L2ApprovalsPort). 요청과 해결을 실제 세션에 `approval.requested`·`approval.resolved`로 커밋해 투영기가
// 실제 L1과 같은 이벤트를 본다. 응답 규칙은 L1.tools.spec §3.6 표를 따르되, kind plan의 `answer`(수정 요청)는
// L2ApprovalRequest.answerSchema 계약대로 받는다(L1A.4의 실제 구현은 아직 plan에 answer를 받지 않는다. 통합 때 맞춘다).

export interface FakeRequest {
  readonly approvalId: ApprovalId;
  readonly threadId: ThreadId;
  readonly requestId: string;
  readonly kind: L2ApprovalRequest["kind"];
  readonly subject: JsonValue;
  readonly origin: ApprovalOrigin;
}

export interface FakeApprovals {
  /** 서비스에 넘기는 포트 공장. 출처를 기록한다 */
  readonly factory: PlanApprovalsFactory;
  /** 만들어진 요청 목록(같은 키의 재요청은 더하지 않는다) */
  readonly requests: FakeRequest[];
  /** request 호출 횟수(재요청 포함) */
  requestCalls(): number;
  /** 다음 request 호출들을 저장소 실패로 끝낸다(강제 종료 흉내). 0이면 정상 */
  failRequests(count: number): void;
  /** 사용자 화면처럼 응답한다(approval.respond) */
  respond(approvalId: ApprovalId, decision: ApprovalDecision, answer?: JsonValue): Promise<boolean>;
  /** plan allow 응답의 mode 선택을 적용하는 길(L1.tools가 ToolService.setMode를 부른다) */
  onPlanMode: ((threadId: ThreadId, mode: PermissionMode) => void) | undefined;
}

type Resolution = {
  decision: ApprovalDecision;
  answer: JsonValue | null;
  state: "resolved" | "cancelled";
};

interface Entry {
  readonly request: FakeRequest;
  resolution: Resolution | undefined;
  readonly waiters: ((resolution: Resolution) => void)[];
}

function asApprovalId(raw: string): ApprovalId {
  const parsed = parse(ApprovalIdSchema, raw);
  return parsed.ok ? parsed.value : failWith(`fake approvals: ${raw} is not an approval id`);
}

function failWith(message: string): never {
  throw new Bug(message);
}

function snapshotOf(entry: Entry): L2ApprovalSnapshot {
  const { resolution } = entry;
  return {
    approvalId: entry.request.approvalId,
    state: resolution === undefined ? "pending" : resolution.state,
    resolution:
      resolution === undefined
        ? null
        : { decision: resolution.decision, answer: resolution.answer },
  };
}

function objectOf(answer: JsonValue | undefined): Readonly<Record<string, JsonValue>> | undefined {
  const parsed = parse(JsonObjectSchema, answer);
  return parsed.ok ? parsed.value : undefined;
}

/** kind별 응답 규칙(L1.tools.spec §3.6). 어긋나면 사유 문장을 돌려준다 */
function responseProblem(
  kind: FakeRequest["kind"],
  decision: ApprovalDecision,
  answer: JsonValue | undefined,
): string | undefined {
  if (kind === "plan") {
    if (decision === "answer") {
      const object = objectOf(answer);
      return object?.["action"] === "revise" &&
        typeof object["feedback"] === "string" &&
        object["feedback"] !== ""
        ? undefined
        : "a revise answer needs action and feedback";
    }
    return undefined;
  }
  if (kind === "question")
    return decision === "allow" ? "question needs answer or deny" : undefined;
  return decision === "answer" ? "tool approvals take allow or deny" : undefined;
}

export function createFakeApprovals(options: {
  readonly writer: FakeWriter;
  readonly ids: IdFactory;
  readonly now: () => number;
}): FakeApprovals {
  const entries = new Map<string, Entry>();
  const byId = new Map<string, Entry>();
  const requests: FakeRequest[] = [];
  let calls = 0;
  let failures = 0;

  function settleEntry(
    entry: Entry,
    resolution: Resolution,
    resolvedBy: "user" | "cancelled",
  ): void {
    options.writer.write(
      entry.request.threadId,
      `approval:${entry.request.approvalId}:resolve`,
      "approval.resolved",
      {
        approvalId: entry.request.approvalId,
        decision: resolution.decision,
        answer: resolution.answer,
        remember: "once",
        requestedRemember: null,
        resolvedBy,
      },
    );
    entry.resolution = resolution;
    for (const waiter of entry.waiters.splice(0)) waiter(resolution);
  }

  const self: FakeApprovals = {
    requests,
    onPlanMode: undefined,
    requestCalls: () => calls,
    failRequests(count) {
      failures = count;
    },
    async respond(approvalId, decision, answer) {
      const entry = byId.get(approvalId);
      if (entry === undefined || entry.resolution !== undefined) return false;
      const problem = responseProblem(entry.request.kind, decision, answer);
      if (problem !== undefined) throw new Bug(`fake approvals: ${problem}`);
      const object = objectOf(answer);
      if (
        decision === "allow" &&
        entry.request.kind === "plan" &&
        typeof object?.["mode"] === "string"
      ) {
        const mode = (["default", "acceptEdits", "plan", "bypass"] as const).find(
          (m) => m === object["mode"],
        );
        if (mode !== undefined) self.onPlanMode?.(entry.request.threadId, mode);
      }
      settleEntry(entry, { decision, answer: answer ?? null, state: "resolved" }, "user");
      await Promise.resolve();
      return true;
    },
    factory(origin) {
      const port: L2ApprovalsPort = {
        request(
          input: L2ApprovalRequest,
        ): Promise<Result<L2ApprovalSnapshot, ApprovalRequestError>> {
          calls += 1;
          if (failures > 0) {
            failures -= 1;
            return Promise.resolve(err({ kind: "store", error: { kind: "io", code: "EIO" } }));
          }
          const key = `${input.threadId}:${input.requestId}`;
          const known = entries.get(key);
          if (known !== undefined) return Promise.resolve(ok(snapshotOf(known)));
          const approvalId = asApprovalId(
            options.writer.write(
              input.threadId,
              `approval:${input.threadId}:${input.requestId}:request`,
              "approval.requested",
              {
                origin,
                requestKey: input.requestId,
                title: "Review the plan",
                body: { kind: input.kind, [input.kind]: input.subject },
                remember: ["once"],
                surfaceThreadId: input.threadId,
                requestedAt: options.now(),
              },
            ),
          );
          const request: FakeRequest = {
            approvalId,
            threadId: input.threadId,
            requestId: input.requestId,
            kind: input.kind,
            subject: input.subject,
            origin,
          };
          const entry: Entry = { request, resolution: undefined, waiters: [] };
          entries.set(key, entry);
          byId.set(approvalId, entry);
          requests.push(request);
          return Promise.resolve(ok(snapshotOf(entry)));
        },
        get(_threadId, approvalId) {
          const entry = byId.get(approvalId);
          return Promise.resolve(ok(entry === undefined ? null : snapshotOf(entry)));
        },
        respond(input: L2ApprovalRespondInput) {
          return self
            .respond(input.approvalId, input.decision, input.answer)
            .then((applied) => ({ applied }));
        },
        cancel(_threadId, approvalId) {
          const entry = byId.get(approvalId);
          if (entry === undefined || entry.resolution !== undefined)
            return Promise.resolve({ applied: false });
          settleEntry(entry, { decision: "deny", answer: null, state: "cancelled" }, "cancelled");
          return Promise.resolve({ applied: true });
        },
        wait(_threadId, approvalId, signal) {
          const entry = byId.get(approvalId);
          if (entry === undefined) return Promise.resolve(err({ kind: "cancelled" as const }));
          if (entry.resolution !== undefined) return Promise.resolve(ok(snapshotOf(entry)));
          return new Promise((resolve) => {
            const onAbort = (): void => resolve(err({ kind: "cancelled" as const }));
            signal.addEventListener("abort", onAbort, { once: true });
            entry.waiters.push(() => {
              signal.removeEventListener("abort", onAbort);
              resolve(ok(snapshotOf(entry)));
            });
          });
        },
      };
      return port;
    },
  };
  return self;
}

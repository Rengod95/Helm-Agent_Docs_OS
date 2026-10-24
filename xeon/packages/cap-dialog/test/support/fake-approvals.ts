import { err, ok } from "@xeon/contracts";
import type { CallContext } from "@xeon/contracts/capabilities";
import type { ApprovalId, JsonValue, ThreadId } from "@xeon/contracts/conversation";
import type {
  ApprovalDecision,
  ApprovalRequestError,
  L2ApprovalRequest,
  L2ApprovalSnapshot,
  L2ApprovalsPort,
} from "@xeon/contracts/services";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import type { ApprovalsPortFactory } from "../../src/ports/approvals.ts";

// L1.tools 승인 프로토콜의 가짜(L2.dialog.plan §5). 요청 멱등, 수동 응답, 응답 검사(L1.tools.spec §3.6 응답 검사 규칙),
// 취소, 메모리 대기를 흉내 낸다. 내구 상태는 이 객체가 가진다: 새 런타임이 같은 가짜를 받으면 재시작 뒤 재개와 같다.

interface Entry {
  readonly approvalId: ApprovalId;
  readonly threadId: ThreadId;
  readonly key: string;
  readonly subject: JsonValue;
  state: "pending" | "resolved" | "cancelled";
  resolution: { decision: ApprovalDecision; answer: JsonValue | null } | null;
  readonly waiters: ((snapshot: L2ApprovalSnapshot) => void)[];
}

export interface FakeApprovals {
  readonly factory: ApprovalsPortFactory;
  /** `request`로 들어온 요청을 들어온 순서대로 */
  readonly requests: L2ApprovalRequest[];
  /** `forCall`이 받은 호출 문맥 */
  readonly contexts: (CallContext | undefined)[];
  /** 만들어진 승인 요청 수(멱등 재요청은 세지 않는다) */
  entries(): readonly { readonly approvalId: ApprovalId; readonly subject: JsonValue }[];
  /** 클라이언트가 `approval.respond`를 보낸 것처럼 응답한다. 검사에 걸리면 applied: false다 */
  respond(
    approvalId: ApprovalId,
    decision: ApprovalDecision,
    answer?: JsonValue,
  ): Promise<{ readonly applied: boolean }>;
  /** 응답 시각까지의 현재 스냅숏 */
  snapshotOf(approvalId: ApprovalId): L2ApprovalSnapshot | undefined;
  /** 응답 검사 없이 해결로 기록한다(구버전 클라이언트가 남긴 규칙 밖 답을 시험한다) */
  forceResolve(approvalId: ApprovalId, decision: ApprovalDecision, answer: JsonValue | null): void;
  /** `request`를 거부하게 한다(저장 실패 등) */
  failNext(error: ApprovalRequestError): void;
}

function isObject(
  value: JsonValue | null | undefined,
): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArray(value: JsonValue | null | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/** L1.tools의 질문 응답 검사. 어긋나면 false다 */
function validQuestionAnswer(subject: JsonValue, answer: JsonValue | null | undefined): boolean {
  if (!isObject(subject) || !isArray(subject["questions"])) return false;
  if (!isObject(answer)) return false;
  for (const question of subject["questions"]) {
    if (!isObject(question)) return false;
    const id = question["id"];
    if (typeof id !== "string") return false;
    const entry = answer[id];
    if (!isObject(entry)) return false;
    const selected = entry["selected"];
    if (!isArray(selected)) return false;
    const rawOptions = question["options"];
    const options = isArray(rawOptions) ? rawOptions : [];
    const known = new Set(options.map((option) => (isObject(option) ? option["id"] : undefined)));
    if (new Set(selected).size !== selected.length) return false;
    if (selected.some((choice) => !known.has(choice))) return false;
    if (question["multiSelect"] !== true && selected.length > 1) return false;
    const text = entry["text"];
    if (text !== undefined && typeof text !== "string") return false;
    if (question["allowFreeText"] === false && text !== undefined) return false;
    if (selected.length === 0 && (text === undefined || text === "")) return false;
  }
  return true;
}

export function fakeApprovals(): FakeApprovals {
  const ids = fixedIdFactory();
  const byKey = new Map<string, Entry>();
  const byId = new Map<ApprovalId, Entry>();
  const requests: L2ApprovalRequest[] = [];
  const contexts: (CallContext | undefined)[] = [];
  let failure: ApprovalRequestError | undefined;

  function snapshot(entry: Entry): L2ApprovalSnapshot {
    return { approvalId: entry.approvalId, state: entry.state, resolution: entry.resolution };
  }

  function settle(entry: Entry): void {
    for (const waiter of entry.waiters.splice(0)) waiter(snapshot(entry));
  }

  function portFor(): L2ApprovalsPort {
    return {
      request(input) {
        requests.push(input);
        if (failure !== undefined) {
          const error = failure;
          failure = undefined;
          return Promise.resolve(err(error));
        }
        const key = `${input.threadId}\0${input.requestId}`;
        const existing = byKey.get(key);
        if (existing !== undefined) {
          if (JSON.stringify(existing.subject) !== JSON.stringify(input.subject)) {
            return Promise.resolve(err({ kind: "key_reused", requestId: input.requestId }));
          }
          return Promise.resolve(ok(snapshot(existing)));
        }
        const entry: Entry = {
          approvalId: ids.next("evt"),
          threadId: input.threadId,
          key,
          subject: input.subject,
          state: "pending",
          resolution: null,
          waiters: [],
        };
        byKey.set(key, entry);
        byId.set(entry.approvalId, entry);
        return Promise.resolve(ok(snapshot(entry)));
      },
      get(_threadId, approvalId) {
        const entry = byId.get(approvalId);
        return Promise.resolve(ok(entry === undefined ? null : snapshot(entry)));
      },
      respond(input) {
        return respond(input.approvalId, input.decision, input.answer);
      },
      cancel(_threadId, approvalId) {
        const entry = byId.get(approvalId);
        if (entry === undefined || entry.state !== "pending") {
          return Promise.resolve({ applied: false });
        }
        entry.state = "cancelled";
        entry.resolution = { decision: "deny", answer: null };
        settle(entry);
        return Promise.resolve({ applied: true });
      },
      wait(_threadId, approvalId, signal) {
        const entry = byId.get(approvalId);
        if (entry === undefined) return Promise.resolve(err({ kind: "cancelled" }));
        if (entry.state !== "pending") return Promise.resolve(ok(snapshot(entry)));
        return new Promise((resolve) => {
          const onAbort = (): void => {
            const index = entry.waiters.indexOf(waiter);
            if (index >= 0) entry.waiters.splice(index, 1);
            resolve(err({ kind: "cancelled" }));
          };
          const waiter = (settled: L2ApprovalSnapshot): void => {
            signal.removeEventListener("abort", onAbort);
            resolve(ok(settled));
          };
          entry.waiters.push(waiter);
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        });
      },
    };
  }

  function respond(
    approvalId: ApprovalId,
    decision: ApprovalDecision,
    answer: JsonValue | undefined,
  ): Promise<{ readonly applied: boolean }> {
    const entry = byId.get(approvalId);
    if (entry === undefined || entry.state !== "pending")
      return Promise.resolve({ applied: false });
    if (decision === "allow") return Promise.resolve({ applied: false });
    if (decision === "answer" && !validQuestionAnswer(entry.subject, answer)) {
      return Promise.resolve({ applied: false });
    }
    entry.state = "resolved";
    entry.resolution = { decision, answer: decision === "answer" ? (answer ?? null) : null };
    settle(entry);
    return Promise.resolve({ applied: true });
  }

  return {
    factory: {
      forCall(context) {
        contexts.push(context);
        return portFor();
      },
    },
    requests,
    contexts,
    entries: () =>
      [...byId.values()].map((entry) => ({ approvalId: entry.approvalId, subject: entry.subject })),
    respond,
    snapshotOf: (approvalId) => {
      const entry = byId.get(approvalId);
      return entry === undefined ? undefined : snapshot(entry);
    },
    forceResolve: (approvalId, decision, answer) => {
      const entry = byId.get(approvalId);
      if (entry === undefined || entry.state !== "pending") return;
      entry.state = "resolved";
      entry.resolution = { decision, answer };
      settle(entry);
    },
    failNext: (error) => {
      failure = error;
    },
  };
}

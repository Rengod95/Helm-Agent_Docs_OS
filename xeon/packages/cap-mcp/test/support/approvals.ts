import { Bug, err, ok, parse, type Result } from "@xeon/contracts";
import {
  ApprovalIdSchema,
  ThreadIdSchema,
  type ApprovalId,
  type JsonValue,
  type ThreadId,
} from "@xeon/contracts/conversation";
import type {
  ApprovalDecision,
  ApprovalRequestError,
  L2ApprovalRequest,
  L2ApprovalSnapshot,
  L2ApprovalsPort,
} from "@xeon/contracts/services";

// F `L2ApprovalsPort`의 메모리 대역(m2-plan §3 규칙 6). 같은 requestId로 다시 요청하면 기존 요청의 현재 상태를 돌려준다.

const ULID_HEAD = "01ARZ3NDEKTSV4RRFFQ69G5F";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function testThreadId(): ThreadId {
  const parsed = parse(ThreadIdSchema, `thr_${ULID_HEAD}AV`);
  if (!parsed.ok) throw new Bug("test thread id is invalid");
  return parsed.value;
}

function approvalIdAt(index: number): ApprovalId {
  const tail = `${CROCKFORD.charAt(Math.floor(index / 32) % 32)}${CROCKFORD.charAt(index % 32)}`;
  const parsed = parse(ApprovalIdSchema, `evt_${ULID_HEAD}${tail}`);
  if (!parsed.ok) throw new Bug("test approval id is invalid");
  return parsed.value;
}

interface Entry {
  readonly approvalId: ApprovalId;
  readonly request: L2ApprovalRequest;
  snapshot: L2ApprovalSnapshot;
  readonly settled: PromiseWithResolvers<L2ApprovalSnapshot>;
}

export interface FakeApprovals extends L2ApprovalsPort {
  readonly requests: L2ApprovalRequest[];
  /** 마지막 요청에 응답한다 */
  resolveLast(decision: ApprovalDecision, answer?: JsonValue): void;
  /** 마지막 요청을 취소로 닫는다 */
  cancelLast(): void;
  /** 다음 request 호출을 이 오류로 실패시킨다 */
  failNext(error: ApprovalRequestError): void;
}

export function fakeApprovals(): FakeApprovals {
  const entries = new Map<string, Entry>();
  const requests: L2ApprovalRequest[] = [];
  let counter = 0;
  let failure: ApprovalRequestError | undefined;
  const last = (): Entry => {
    const entry = [...entries.values()].at(-1);
    if (entry === undefined) throw new Bug("no approval request was made");
    return entry;
  };
  const settle = (entry: Entry, snapshot: L2ApprovalSnapshot): void => {
    entry.snapshot = snapshot;
    entry.settled.resolve(snapshot);
  };
  return {
    requests,
    resolveLast(decision, answer) {
      const entry = last();
      settle(entry, {
        approvalId: entry.approvalId,
        state: "resolved",
        resolution: { decision, answer: answer ?? null },
      });
    },
    cancelLast() {
      const entry = last();
      settle(entry, { approvalId: entry.approvalId, state: "cancelled", resolution: null });
    },
    failNext(error) {
      failure = error;
    },
    request(input): Promise<Result<L2ApprovalSnapshot, ApprovalRequestError>> {
      if (failure !== undefined) {
        const error = failure;
        failure = undefined;
        return Promise.resolve(err(error));
      }
      const known = entries.get(input.requestId);
      if (known !== undefined) return Promise.resolve(ok(known.snapshot));
      requests.push(input);
      counter += 1;
      const approvalId = approvalIdAt(counter);
      const entry: Entry = {
        approvalId,
        request: input,
        snapshot: { approvalId, state: "pending", resolution: null },
        settled: Promise.withResolvers<L2ApprovalSnapshot>(),
      };
      entries.set(input.requestId, entry);
      return Promise.resolve(ok(entry.snapshot));
    },
    get(_threadId, approvalId) {
      const entry = [...entries.values()].find((candidate) => candidate.approvalId === approvalId);
      return Promise.resolve(ok(entry?.snapshot ?? null));
    },
    respond(input) {
      const entry = [...entries.values()].find(
        (candidate) => candidate.approvalId === input.approvalId,
      );
      if (entry === undefined || entry.snapshot.state !== "pending") {
        return Promise.resolve({ applied: false });
      }
      settle(entry, {
        approvalId: entry.approvalId,
        state: "resolved",
        resolution: { decision: input.decision, answer: input.answer ?? null },
      });
      return Promise.resolve({ applied: true });
    },
    cancel(_threadId, approvalId) {
      const entry = [...entries.values()].find((candidate) => candidate.approvalId === approvalId);
      if (entry === undefined || entry.snapshot.state !== "pending") {
        return Promise.resolve({ applied: false });
      }
      settle(entry, { approvalId, state: "cancelled", resolution: null });
      return Promise.resolve({ applied: true });
    },
    async wait(_threadId, approvalId, signal) {
      const entry = [...entries.values()].find((candidate) => candidate.approvalId === approvalId);
      if (entry === undefined) return err({ kind: "cancelled" as const });
      if (entry.snapshot.state !== "pending") return ok(entry.snapshot);
      const aborted = new Promise<"aborted">((resolve) => {
        signal.addEventListener("abort", () => resolve("aborted"), { once: true });
      });
      const outcome = await Promise.race([entry.settled.promise, aborted]);
      return outcome === "aborted" ? err({ kind: "cancelled" as const }) : ok(outcome);
    },
  };
}

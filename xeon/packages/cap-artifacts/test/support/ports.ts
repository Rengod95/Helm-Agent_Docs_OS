// 리뷰 서비스의 포트 대역(파일, 가드, 큐, 승인). 실제 구현 대신 기록과 설정 가능한 응답만 둔다.
import { Bug, err, ok, type Result } from "@xeon/contracts";
import type { ApprovalId, ThreadId, TurnId } from "@xeon/contracts/conversation";
import type { EnqueueError, PostItem, PostWhen } from "@xeon/contracts/extensions";
import type {
  ApprovalRequestError,
  GuardExecutionOutcome,
  L2ApprovalRequest,
  L2ApprovalSnapshot,
  L2ApprovalsPort,
  LoopError,
} from "@xeon/contracts/services";
import type { ExecutionGuardPort, ReviewFilesPort, ReviewQueuePort } from "../../src/ports.ts";

function occurrences(text: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let from = text.indexOf(needle);
  while (from !== -1) {
    count += 1;
    from = text.indexOf(needle, from + needle.length);
  }
  return count;
}

interface ReplaceCall {
  readonly path: string;
  readonly oldText: string;
  readonly newText: string;
  readonly requestId: string;
}

export interface FakeFiles extends ReviewFilesPort {
  /** 현재 파일 내용(경로 → 텍스트) */
  readonly contents: Map<string, string>;
  /** 받은 replace 호출, 받은 순서대로 */
  readonly calls: ReplaceCall[];
}

/** oldText가 파일에 정확히 한 번 있어야 바꾼다. 없으면 edit_not_found, 여러 번이면 edit_ambiguous */
export function fakeFiles(initial: Readonly<Record<string, string>>): FakeFiles {
  const contents = new Map(Object.entries(initial));
  const calls: ReplaceCall[] = [];
  return {
    contents,
    calls,
    async replace(input): Promise<Result<void, { code: string; message: string }>> {
      calls.push({
        path: input.path,
        oldText: input.oldText,
        newText: input.newText,
        requestId: input.requestId,
      });
      const current = contents.get(input.path);
      if (current === undefined) {
        return err({ code: "file_not_found", message: `${input.path} does not exist` });
      }
      const found = occurrences(current, input.oldText);
      if (found === 0)
        return err({ code: "edit_not_found", message: "oldText is not in the file" });
      if (found > 1) {
        return err({ code: "edit_ambiguous", message: "oldText occurs more than once" });
      }
      const at = current.indexOf(input.oldText);
      contents.set(
        input.path,
        current.slice(0, at) + input.newText + current.slice(at + input.oldText.length),
      );
      return ok(undefined);
    },
  };
}

interface GuardCall {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly content: string;
  readonly requestId: string;
}

export interface FakeGuard extends ExecutionGuardPort {
  readonly calls: GuardCall[];
  /** 다음 검사부터 막는다. reason은 사용자에게 보이는 문장이다 */
  block(reason: string): void;
  allow(): void;
}

export function fakeGuard(): FakeGuard {
  const calls: GuardCall[] = [];
  let verdict: GuardExecutionOutcome = { status: "allowed" };
  return {
    calls,
    block(reason) {
      verdict = { status: "blocked", reason };
    },
    allow() {
      verdict = { status: "allowed" };
    },
    async check(input): Promise<Result<GuardExecutionOutcome, LoopError>> {
      calls.push({
        threadId: input.threadId,
        turnId: input.turnId,
        content: input.content,
        requestId: input.requestId,
      });
      return ok(verdict);
    },
  };
}

interface PostRecord {
  readonly requestId: string;
  readonly when: PostWhen;
  readonly item: PostItem;
}

export interface FakeQueue extends ReviewQueuePort {
  /** 실제로 들어간 입력(중복은 넣지 않는다) */
  readonly posts: PostRecord[];
  /** 받은 모든 enqueue 요청의 requestId, 중복 포함 */
  readonly attempts: string[];
  /** 이미 큐에 있는 요청으로 만든다(프로세스가 post 뒤에 죽은 상황을 흉내 낸다) */
  alreadyQueued(requestId: string): void;
}

export function fakeQueue(): FakeQueue {
  const posts: PostRecord[] = [];
  const attempts: string[] = [];
  const keys = new Set<string>();
  return {
    posts,
    attempts,
    alreadyQueued(requestId) {
      keys.add(requestId);
    },
    async enqueue(input): Promise<Result<{ duplicate: boolean }, EnqueueError>> {
      attempts.push(input.requestId);
      if (keys.has(input.requestId)) return ok({ duplicate: true });
      keys.add(input.requestId);
      posts.push({ requestId: input.requestId, when: input.when, item: input.item });
      return ok({ duplicate: false });
    },
  };
}

export interface FakeApprovals extends L2ApprovalsPort {
  /** 새로 낸 요청. 같은 requestId로 다시 부른 것은 넣지 않는다(승인 서비스의 멱등 키와 같다) */
  readonly requests: L2ApprovalRequest[];
  /** 새로 낸 요청의 응답 스냅샷, 낸 순서대로 */
  readonly snapshots: L2ApprovalSnapshot[];
}

/** 쓰지 않는 메서드는 부르면 시험이 실패하도록 거부한다 */
const unused = (method: string): Promise<never> =>
  Promise.reject(new Bug(`approvals fake: ${method} is not used by the review tests`));

/** 새 요청마다 pending 스냅샷을 돌려준다. approvalId는 발급기가 준 값이다 */
export function fakeApprovals(nextApprovalId: () => ApprovalId): FakeApprovals {
  const requests: L2ApprovalRequest[] = [];
  const snapshots: L2ApprovalSnapshot[] = [];
  const byKey = new Map<string, L2ApprovalSnapshot>();
  return {
    requests,
    snapshots,
    async request(input): Promise<Result<L2ApprovalSnapshot, ApprovalRequestError>> {
      const known = byKey.get(input.requestId);
      if (known !== undefined) return ok(known);
      requests.push(input);
      const snapshot: L2ApprovalSnapshot = {
        approvalId: nextApprovalId(),
        state: "pending",
        resolution: null,
      };
      byKey.set(input.requestId, snapshot);
      snapshots.push(snapshot);
      return ok(snapshot);
    },
    get(_threadId, approvalId) {
      return Promise.resolve(
        ok(snapshots.find((snapshot) => snapshot.approvalId === approvalId) ?? null),
      );
    },
    respond: () => unused("respond"),
    cancel: () => unused("cancel"),
    wait: () => unused("wait"),
  };
}

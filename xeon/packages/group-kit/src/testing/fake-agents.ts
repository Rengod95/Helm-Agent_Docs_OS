import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type { AgentSettledEventPayload } from "@xeon/contracts/records";
import type {
  AgentService,
  CancelTarget,
  ChildStatus,
  DelegateRequest,
  DelegateResult,
  SpawnOrigin,
  SpawnRequest,
  SpawnResult,
} from "@xeon/contracts/services";

/** `FakeAgents`가 새로 만든(중복이 아닌) 위임 하나 */
export interface FakeDelegation {
  readonly request: DelegateRequest;
  readonly origin: SpawnOrigin;
  readonly childThreadId: ThreadId;
}

export interface FakeCancel {
  readonly target: CancelTarget;
  readonly reason: string;
}

export interface FakeAgentsOptions {
  /** 자식 thread id 발급. 호스트의 ids와 같은 것을 넘기면 id가 겹치지 않는다 */
  readonly ids: IdFactory;
  /** 참이면 delegate가 `agents.unavailable`을 돌려준다(스텁 상태의 L1을 흉내 낸다) */
  readonly unavailable?: boolean;
}

/**
 * L1 위임 서비스의 시험 대역(`xeon.agents`, L3.group-kit.spec §3.4). 학습·Helm 그룹 시험이 쓴다.
 * 같은 (부모 thread, requestId)의 두 번째 delegate는 `duplicate`이고 `delegated`에 더하지 않는다.
 * `settle`은 정착 이벤트 페이로드를 만들어 준다. 호스트로 보내는 일은 시험이 한다(`host.afterCommit`)
 */
export interface FakeAgents extends AgentService {
  /** 새로 만든 위임. 중복 호출은 없다 */
  readonly delegated: readonly FakeDelegation[];
  /** 새로 만든 spawn 수(중복 제외) */
  readonly spawnCount: () => number;
  readonly cancels: readonly FakeCancel[];
  /** 위임을 정착시키고 `agent.settled` 이벤트 페이로드를 돌려준다. 없는 위임이면 undefined */
  settle(
    parentThreadId: ThreadId,
    requestId: string,
    status: "completed" | "aborted" | "error",
  ): AgentSettledEventPayload | undefined;
}

interface Child {
  readonly delegation: FakeDelegation;
  settled: "completed" | "aborted" | "error" | null;
}

function keyOf(parentThreadId: ThreadId, requestId: string): string {
  return `${parentThreadId}|${requestId}`;
}

function spawnResult(requestId: string, childThreadId: ThreadId, reused: boolean): SpawnResult {
  return {
    childThreadId,
    status: "completed",
    requestId,
    report: null,
    usage: null,
    reused,
  };
}

export function fakeAgents(options: FakeAgentsOptions): FakeAgents {
  const children = new Map<string, Child>();
  const delegated: FakeDelegation[] = [];
  const cancels: FakeCancel[] = [];
  const spawned = new Set<string>();

  return {
    delegated,
    cancels,
    spawnCount: () => spawned.size,
    delegate(request: DelegateRequest, origin: SpawnOrigin): Promise<DelegateResult> {
      if (options.unavailable === true) {
        return Promise.resolve({
          ok: false,
          error: { kind: "agents.unavailable", message: "delegation is not available" },
        });
      }
      const key = keyOf(origin.parentThreadId, request.requestId);
      const existing = children.get(key);
      if (existing !== undefined) {
        return Promise.resolve({
          ok: true,
          receipt: {
            requestId: request.requestId,
            childThreadId: existing.delegation.childThreadId,
            status: "duplicate",
          },
        });
      }
      const childThreadId = options.ids.next("thr");
      const delegation: FakeDelegation = { request, origin, childThreadId };
      children.set(key, { delegation, settled: null });
      delegated.push(delegation);
      return Promise.resolve({
        ok: true,
        receipt: { requestId: request.requestId, childThreadId, status: "accepted" },
      });
    },
    spawn(request: SpawnRequest, origin: SpawnOrigin): Promise<SpawnResult> {
      const requestId = request.requestId ?? `${origin.ownerRequestId}:spawn:0`;
      const key = keyOf(origin.parentThreadId, requestId);
      const childThreadId = options.ids.next("thr");
      const reused = spawned.has(key);
      spawned.add(key);
      return Promise.resolve(spawnResult(requestId, childThreadId, reused));
    },
    cancel(target: CancelTarget, reason: string): Promise<{ readonly cancelled: boolean }> {
      cancels.push({ target, reason });
      if (!("ownerScopeId" in target)) return Promise.resolve({ cancelled: false });
      const open = [...children.values()].filter(
        (child) =>
          child.settled === null &&
          child.delegation.origin.owner.kind === "scope" &&
          child.delegation.origin.owner.scopeId === target.ownerScopeId,
      );
      for (const child of open) child.settled = "aborted";
      return Promise.resolve({ cancelled: open.length > 0 });
    },
    status(parentThreadId: ThreadId, requestId: string): ChildStatus | undefined {
      const child = children.get(keyOf(parentThreadId, requestId));
      if (child === undefined) return undefined;
      const { childThreadId } = child.delegation;
      if (child.settled === null) return { state: "running", childThreadId };
      return {
        state: "settled",
        childThreadId,
        result: {
          childThreadId,
          status: child.settled,
          requestId,
          report: null,
          usage: null,
          reused: false,
        },
      };
    },
    settle(parentThreadId, requestId, status) {
      const child = children.get(keyOf(parentThreadId, requestId));
      if (child === undefined) return undefined;
      child.settled = status;
      const { owner } = child.delegation.origin;
      return {
        childThreadId: child.delegation.childThreadId,
        requestId,
        status,
        report: null,
        answerItemId: null,
        usage: null,
        error: status === "error" ? "fake failure" : null,
        ...(owner.kind === "scope" ? { owner: { kind: "scope", scopeId: owner.scopeId } } : {}),
      };
    },
    define: () => () => {},
    definition: () => undefined,
    definitions: () => [],
    judge: () =>
      Promise.resolve({ kind: "failed", message: "judge is not available in fakeAgents" }),
  };
}

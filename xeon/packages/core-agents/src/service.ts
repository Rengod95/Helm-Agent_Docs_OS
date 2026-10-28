// AgentService 구현(L1.agents.spec §3.3, §4.1~§4.8, AG-1·2·3·6·7·8·11). 포그라운드 spawn, 백그라운드 delegate, 목표 판정을 한다.
import { assertNever, attemptAsync, detach, parse } from "@xeon/contracts";
import {
  AgentSettledEventPayloadSchema,
  AgentSpawnedPayloadSchema,
  commitKeyPart,
  type AgentView,
  type CommitPlan,
  type LeaseToken,
  type SpawnOwnerJson,
} from "@xeon/contracts/records";
import {
  TurnCompletedPayloadSchema,
  type ItemId,
  type ThreadId,
} from "@xeon/contracts/conversation";
import {
  AGENT_REPORT_TYPE,
  type AgentDefinition,
  type AdvertisedToolset,
  type AgentService,
  type AgentsErrorCode,
  type CancelTarget,
  type ChildStatus,
  type DelegateRequest,
  type DelegateResult,
  type GuardedReport,
  type MimicryFlag,
  type ReportDelivery,
  type RuleRegistration,
  type SpawnOrigin,
  type SpawnOwner,
  type SpawnRequest,
  type SpawnResult,
  type TaskScope,
} from "@xeon/contracts/services";
import type { RecordKind } from "@xeon/contracts/extensions";
import { ceilingOf, childMode } from "./permission-ceiling.ts";
import { AGENTS_RULE_SOURCE, definitionRules, subagentRules } from "./denylist.ts";
import { createDefinitionRegistry } from "./definitions/registry.ts";
import type { AgentsDeps } from "./deps.ts";
import { createConcurrencyGate, type ConcurrencyGate } from "./gate.ts";
import { sha256Hex } from "./hash.ts";
import { readFinalText } from "./report-reader.ts";
import { childRequestId, createSpawnCounter, derivedRequestId } from "./request-id.ts";
import { createJudge, JUDGE_MAX_RUNS_DEFAULT } from "./judge.ts";
import { guardReport } from "./result-guard.ts";

/** agent.settled에 싣는 보고 본문 상한(AgentSettledEventPayload.report.text 65,536자에서 격리 블록 여유를 뺀다) */
const STORED_REPORT_MAX = 60_000;

const KNOWN_FLAGS: ReadonlySet<string> = new Set<MimicryFlag>([
  "role_marker",
  "system_tag",
  "tool_call_markup",
  "override_phrase",
  "wrapper_escape",
]);

function isMimicryFlag(value: string): value is MimicryFlag {
  return KNOWN_FLAGS.has(value);
}

/** 이 프로세스에서 도는 자식 하나 */
interface LiveChild {
  readonly parentThreadId: ThreadId;
  readonly requestId: string;
  /** queued: 동시 상한이나 풀을 기다림, running: 자식 turn이 돎 */
  readonly phase: { state: "queued" | "running" };
  readonly scope: TaskScope;
  /** 소유 단위 취소(`CancelTarget.ownerScopeId`)가 고르는 근거 */
  readonly owner: SpawnOwnerJson;
  readonly done: Promise<SpawnResult>;
}

/** 자식 대화의 문맥: 중첩 spawn이 깊이와 승인 표면을 이어 받는다 */
interface ChildMeta {
  readonly agent: string;
  readonly depth: number;
  readonly surfaceThreadId: ThreadId;
  readonly interactive: boolean;
}

export interface AgentServiceImpl extends AgentService {
  /** 자식 대화의 문맥(없으면 주 대화). 모델 도구 어댑터가 부모의 caller·깊이를 정한다 */
  contextOf(threadId: ThreadId): {
    readonly caller: `subagent:${string}` | "main";
    readonly depth: number;
    readonly surfaceThreadId: ThreadId;
    readonly interactive: boolean;
  };
  /** 지금 이 프로세스에서 도는 자식 수(진단용) */
  liveCount(): number;
  /** 등록한 규칙을 뺀다(플러그인 해제) */
  dispose(): void;
  /** 차단 규칙과 정의 규칙을 다시 등록한다(maxDepth나 정의가 바뀌었을 때) */
  syncRules(): void;
}

interface PreparedSpawn {
  readonly definition: AgentDefinition;
  readonly requestId: string;
  readonly childDepth: number;
  readonly surfaceThreadId: ThreadId;
  readonly interactive: boolean;
  /** 백그라운드 위임이면 참. 소유 경계라 부모 취소가 넘지 않는다(§4.7 3번) */
  readonly background: boolean;
  /** 완료 보고를 부모 inbox에 넣는 방법. 없으면 agent.settled만 남는다(M3-REQ-66) */
  readonly report: ReportDelivery | undefined;
}

/** 거절 사유. spawn은 SpawnResult로, delegate는 DelegateResult로 바꾼다 */
interface Refusal {
  readonly code: AgentsErrorCode;
  readonly message: string;
  readonly childThreadId?: ThreadId;
}

/** 코어 보고 customType(`agent.report`)은 F RecordKind 형식(x.·grp. 접두)에 없어 코어 소유 확장 kind로 싣는다 [제안: F 요청 6 전까지] */
const CORE_REPORT_KIND: RecordKind = "x.core-agents.agent.report";

function reportKindOf(customType: ReportDelivery["customType"]): RecordKind {
  return customType === AGENT_REPORT_TYPE ? CORE_REPORT_KIND : customType;
}

function ownerJsonOf(owner: SpawnOwner): SpawnOwnerJson {
  switch (owner.kind) {
    case "tool":
      return { kind: "tool", turnId: owner.turnId, toolCallId: owner.toolCallId };
    case "drive":
      return {
        kind: "drive",
        turnId: owner.turnId,
        scopeId: owner.scopeId,
        leaseId: owner.leaseId,
      };
    case "scope":
      return { kind: "scope", scopeId: owner.scopeId };
    default:
      return assertNever(owner, "ownerJsonOf");
  }
}

/** DelegateRequest.requestId 상한. 보고 입력 키 "<requestId>:report"가 입력 큐의 64자 안에 들어야 한다 */
const DELEGATE_REQUEST_ID_MAX = 48;

/** 같은 requestId로 다른 요청(다른 정의, 다른 task)이 오면 커밋 키 재사용으로 거부하게 하는 지문 */
function spawnFingerprint(requestId: string, request: SpawnRequest): Record<string, string> {
  return { requestId, agent: request.agent, taskHash: sha256Hex(request.task) };
}

function spawnKey(parent: ThreadId, requestId: string): string {
  return `spawn:${commitKeyPart(parent, sha256Hex)}:${commitKeyPart(requestId, sha256Hex)}`;
}

function creationKeyOf(parent: ThreadId, requestId: string): string {
  return `spawn:${sha256Hex(`${parent}\0${requestId}`).slice(0, 40)}`;
}

type Provisioned =
  | { readonly kind: "run"; readonly childThreadId: ThreadId }
  | { readonly kind: "exists"; readonly link: AgentView }
  | { readonly kind: "refused"; readonly refusal: Refusal };

function refused(code: AgentsErrorCode, message: string, childThreadId?: ThreadId): Provisioned {
  return {
    kind: "refused",
    refusal: { code, message, ...(childThreadId === undefined ? {} : { childThreadId }) },
  };
}

function receiptOf(
  requestId: string,
  childThreadId: ThreadId,
  status: "accepted" | "duplicate",
): DelegateResult {
  return { ok: true, receipt: { requestId, childThreadId, status } };
}

function abortReasonOf(reason: string): { readonly code: "user"; readonly message: string } {
  return { code: "user", message: reason };
}

export function createAgentService(deps: AgentsDeps): AgentServiceImpl {
  const { session, tasks, tools, producer, ids, settings, ownership, log } = deps;
  const live = new Map<ThreadId, LiveChild>();
  const meta = new Map<ThreadId, ChildMeta>();
  const gates = new Map<ThreadId, ConcurrencyGate>();
  const counter = createSpawnCounter();

  let rules: RuleRegistration | undefined;
  const syncRules = (): void => {
    const all = [
      ...subagentRules(settings.maxDepth()),
      ...registry.list().flatMap((definition) => definitionRules(definition)),
    ];
    // 같은 출처로 다시 등록하면 그 출처의 규칙을 통째로 바꾼다(ToolService.registerRules)
    rules = tools.registerRules(AGENTS_RULE_SOURCE, all);
    for (const issue of rules.issues) {
      log.warn("agents.rule_issue", { ruleId: issue.ruleId, code: issue.code });
    }
  };
  const registry = createDefinitionRegistry(() => {
    syncRules();
  });

  const gateOf = (root: ThreadId): ConcurrencyGate => {
    const found = gates.get(root);
    if (found !== undefined) return found;
    const created = createConcurrencyGate(() => settings.maxConcurrent());
    gates.set(root, created);
    return created;
  };

  const failure = (
    requestId: string,
    code: AgentsErrorCode,
    message: string,
    childThreadId: ThreadId = ids.next("thr"),
  ): SpawnResult => ({
    childThreadId,
    status: "error",
    answer: `[xeon:subagent_error] ${code}: ${message}`,
    requestId,
    report: null,
    usage: null,
    reused: false,
  });

  const contextOf: AgentServiceImpl["contextOf"] = (threadId) => {
    const known = meta.get(threadId);
    if (known === undefined) {
      return { caller: "main", depth: 0, surfaceThreadId: threadId, interactive: true };
    }
    return {
      caller: `subagent:${known.agent}`,
      depth: known.depth,
      surfaceThreadId: known.surfaceThreadId,
      interactive: known.interactive,
    };
  };

  /** 재개한 자식의 소유자는 처음 기록한 agent.spawned의 것이다. 읽을 수 없으면 이번 호출자의 것을 쓴다 */
  const recordedOwnerOf = (origin: SpawnOrigin, requestId: string): SpawnOwnerJson => {
    const event = session.query.latestEvent(origin.parentThreadId, "agent.spawned", {
      pointer: "/requestId",
      equals: requestId,
    });
    if (event.ok && event.value !== undefined) {
      const payload = parse(AgentSpawnedPayloadSchema, event.value.payload);
      if (payload.ok) return payload.value.owner;
    }
    return ownerJsonOf(origin.owner);
  };

  /** 같은 requestId의 기존 연결에 다른 요청이 왔는가(커밋 키는 있고 지문이 다르다) */
  const clashesWithRecorded = (
    origin: SpawnOrigin,
    requestId: string,
    request: SpawnRequest,
  ): boolean => {
    const checked = session.commit({
      threadId: origin.parentThreadId,
      requestId: spawnKey(origin.parentThreadId, requestId),
      fingerprintSource: spawnFingerprint(requestId, request),
      build: () => ({ kind: "reject", code: "exists", detail: null }),
    });
    return checked.ok && checked.value.status === "key_reused";
  };

  /** agent.spawned를 커밋한 뒤 runChild가 live 표에 올리기 전까지의 자식. 같은 requestId의 겹친 호출이 둘째 실행을 시작하지 않게 한다 */
  const starting = new Map<ThreadId, PromiseWithResolvers<void>>();
  const markStarting = (childThreadId: ThreadId): void => {
    starting.set(childThreadId, Promise.withResolvers<void>());
  };
  const releaseStarting = (childThreadId: ThreadId): void => {
    starting.get(childThreadId)?.resolve();
    starting.delete(childThreadId);
  };

  /** 입력 검사(§4.1 1번). 실패는 값으로 돌려준다 */
  const prepare = (
    request: SpawnRequest,
    origin: SpawnOrigin,
    mode: { readonly background: boolean; readonly report?: ReportDelivery },
  ):
    | { readonly ok: true; readonly value: PreparedSpawn }
    | { readonly ok: false; readonly refusal: Refusal; readonly requestId: string } => {
    const requestId = childRequestId(
      request.requestId ??
        derivedRequestId(origin.ownerRequestId, counter.next(origin.ownerRequestId)),
    );
    const refuse = (code: AgentsErrorCode, message: string) => ({
      ok: false as const,
      refusal: { code, message },
      requestId,
    });
    const definition = registry.get(request.agent);
    if (definition === undefined) {
      return refuse("agents.unknown_definition", `no subagent definition named "${request.agent}"`);
    }
    if (!mode.background && request.background === true) {
      return refuse("agents.invalid_request", "background runs go through delegate");
    }
    const childDepth = origin.depth + 1;
    if (childDepth > settings.maxDepth()) {
      return refuse(
        "agents.depth_exceeded",
        `depth ${String(childDepth)} exceeds l1.agents.maxDepth ${String(settings.maxDepth())}`,
      );
    }
    if (origin.signal.aborted) {
      return refuse("agents.parent_aborting", "the parent turn is being aborted");
    }
    // 백그라운드 자식은 부모 thread 노드 아래 경계로 연다. 노드가 없으면 소유 트리에 매달 곳이 없다
    if (mode.background && tasks.find("thread", origin.parentThreadId) === undefined) {
      return refuse("agents.unavailable", "the parent thread is not open in the task tree");
    }
    const parentContext = contextOf(origin.parentThreadId);
    return {
      ok: true,
      value: {
        definition,
        requestId,
        childDepth,
        surfaceThreadId: parentContext.surfaceThreadId,
        interactive: parentContext.interactive,
        background: mode.background,
        report: mode.report,
      },
    };
  };

  /** 소유 간선의 부모 노드(§4.1 4번): 도구 호출, turn, 아니면 thread */
  const parentScopeOf = (origin: SpawnOrigin, background: boolean): TaskScope => {
    const { owner } = origin;
    if (background) {
      // 백그라운드는 부모 thread 노드 아래다(prepare가 노드의 존재를 확인했다)
      return tasks.find("thread", origin.parentThreadId) ?? tasks.root;
    }
    const candidates: (TaskScope | undefined)[] = [];
    if (owner.kind === "tool") {
      candidates.push(tasks.find("tool", owner.toolCallId), tasks.find("turn", owner.turnId));
    } else if (owner.kind === "drive" && owner.turnId !== null) {
      candidates.push(tasks.find("turn", owner.turnId));
    }
    candidates.push(tasks.find("thread", origin.parentThreadId));
    return candidates.find((candidate) => candidate !== undefined) ?? tasks.root;
  };

  /** 부모 대화의 이 requestId 자식 연결 */
  const linkOf = (parent: ThreadId, requestId: string): AgentView | undefined | "unreadable" => {
    const children = session.query.childAgents(parent);
    if (!children.ok) return "unreadable";
    return children.value.find((child) => child.requestId === requestId);
  };

  /** 정착한 자식의 기록을 SpawnResult로 되살린다(재개 때 reused: true) */
  const settledResult = (parent: ThreadId, link: AgentView): SpawnResult | undefined => {
    const event = session.query.latestEvent(parent, "agent.settled", {
      pointer: "/childThreadId",
      equals: link.childThreadId,
    });
    if (!event.ok || event.value === undefined) return undefined;
    const payload = parse(AgentSettledEventPayloadSchema, event.value.payload);
    if (!payload.ok) return undefined;
    const stored = payload.value.report;
    const report: GuardedReport | null =
      stored === null
        ? null
        : {
            text: stored.text,
            truncated: stored.truncated,
            flags: stored.flags.filter(isMimicryFlag),
            originalChars: stored.originalChars,
          };
    return {
      childThreadId: link.childThreadId,
      status: payload.value.status,
      ...(report === null ? {} : { answer: report.text }),
      requestId: link.requestId,
      report,
      usage: payload.value.usage,
      reused: true,
    };
  };

  /** 자식 임대를 다시 얻고 쓰기로 연다(재개, 이미 만든 creationKey 재시도) */
  const reopenChild = (childThreadId: ThreadId): LeaseToken | undefined => {
    const acquired = ownership.leases.acquire(`session:${childThreadId}`, ownership.holder);
    if (!acquired.ok) return undefined;
    const opened = session.openForWrite(childThreadId, acquired.value);
    return opened.ok ? acquired.value : undefined;
  };

  /** 부모 대화에 agent.spawned를 커밋한다. exists면 다른 호출이 먼저 만든 것이다 */
  const commitSpawned = (
    origin: SpawnOrigin,
    prepared: PreparedSpawn,
    request: SpawnRequest,
    childThreadId: ThreadId,
  ): "committed" | "exists" | "parent_aborting" | "unavailable" | "key_reused" => {
    const { owner } = origin;
    const ownerJson = ownerJsonOf(owner);
    const turnId = owner.kind === "scope" ? null : owner.turnId;
    const committed = session.commit({
      threadId: origin.parentThreadId,
      requestId: spawnKey(origin.parentThreadId, prepared.requestId),
      fingerprintSource: spawnFingerprint(prepared.requestId, request),
      build(view): CommitPlan {
        if (view.agentByRequestId(origin.parentThreadId, prepared.requestId) !== undefined) {
          return { kind: "reject", code: "exists", detail: null };
        }
        if (view.threadStatus === "closed" || view.threadStatus === "absent") {
          return { kind: "reject", code: "parent_unavailable", detail: null };
        }
        if (turnId !== null && view.turnAbortRequested(turnId)) {
          return { kind: "reject", code: "parent_aborting", detail: null };
        }
        return {
          kind: "append",
          drafts: [
            producer.draft({
              id: ids.next("evt"),
              kind: "agent.spawned",
              threadId: origin.parentThreadId,
              turnId,
              stepId: null,
              causationId: null,
              correlationId: null,
              payload: {
                childThreadId,
                agent: prepared.definition.name,
                requestId: prepared.requestId,
                owner: ownerJson,
                caller: `subagent:${prepared.definition.name}`,
                depth: prepared.childDepth,
                background: prepared.background,
                fork: request.fork ?? null,
                modelRole: request.model ?? prepared.definition.model ?? "subagent",
              },
            }),
          ],
          checkpoint: null,
        };
      },
    });
    if (!committed.ok) return "unavailable";
    const result = committed.value;
    if (result.status === "committed") return "committed";
    if (result.status === "key_reused") return "key_reused";
    if (result.code === "exists") return "exists";
    if (result.code === "parent_aborting") return "parent_aborting";
    return "unavailable";
  };

  /** 자식을 돌리고 정착을 기록한다. 이 프로세스의 live 표에 등록한 뒤 결과를 돌려준다 */
  const runChild = (
    origin: SpawnOrigin,
    prepared: PreparedSpawn,
    request: SpawnRequest,
    childThreadId: ThreadId,
  ): Promise<SpawnResult> => {
    const { definition } = prepared;
    const parentScope = parentScopeOf(origin, prepared.background);
    const scope = tasks.openScope(parentScope, {
      kind: "subagent",
      id: childThreadId,
      ...(prepared.background ? { background: true } : {}),
    });
    meta.set(childThreadId, {
      agent: definition.name,
      depth: prepared.childDepth,
      surfaceThreadId: prepared.surfaceThreadId,
      interactive: prepared.interactive,
    });
    // 드라이브 임대 신호처럼 소유 트리 밖에서 오는 취소도 이 노드로 잇는다
    const abortChild = async (): Promise<void> => {
      const aborted = await tasks.abort(scope, { code: "parent", message: null });
      // 취소 의도 커밋이 실패하면 자식이 계속 돌 수 있다. 조용히 넘기지 않고 기록한다
      if (!aborted.ok) {
        log.warn("agents.abort_not_committed", { childThreadId, reason: aborted.error.kind });
      }
    };
    const onOriginAbort = (): void => {
      detach(abortChild(), (cause) =>
        log.error("agents.abort_failed", {
          childThreadId,
          message: cause instanceof Error ? cause.message : "non_error_thrown",
        }),
      );
    };
    // 백그라운드 자식은 소유 경계다. 부모 turn의 취소 신호를 잇지 않는다(§4.7 3번)
    if (!prepared.background)
      origin.signal.addEventListener("abort", onOriginAbort, { once: true });

    const phase: LiveChild["phase"] = { state: "queued" };
    const work = (async (): Promise<SpawnResult> => {
      // 기다리는 동안의 취소만 aborted 정착으로 바꾼다. 그 밖의 오류(Bug, 정착 커밋 실패)는 삼키지 않고 호출자에게 전한다
      const gated = await attemptAsync(() =>
        gateOf(prepared.surfaceThreadId).acquire(scope.signal),
      );
      if (!gated.ok) return await settleAborted(origin, prepared, childThreadId, gated.error.cause);
      try {
        const slotted = await attemptAsync(() => tasks.limiter("subagents").acquire(scope));
        if (!slotted.ok) {
          return await settleAborted(origin, prepared, childThreadId, slotted.error.cause);
        }
        try {
          phase.state = "running";
          return await settle(origin, prepared, request, childThreadId, scope);
        } finally {
          slotted.value.release();
        }
      } finally {
        gated.value();
      }
    })();
    const tracked = scope.track(work);
    const done = tracked.finally(() => {
      if (!prepared.background) origin.signal.removeEventListener("abort", onOriginAbort);
      live.delete(childThreadId);
    });
    live.set(childThreadId, {
      parentThreadId: origin.parentThreadId,
      requestId: prepared.requestId,
      phase,
      scope,
      owner: recordedOwnerOf(origin, prepared.requestId),
      done,
    });
    return done;
  };

  /** 자식 turn 하나를 돌리고 최종 보고를 정착 기록으로 남긴다 */
  const settle = async (
    origin: SpawnOrigin,
    prepared: PreparedSpawn,
    request: SpawnRequest,
    childThreadId: ThreadId,
    scope: TaskScope,
  ): Promise<SpawnResult> => {
    const { definition } = prepared;
    const parentMode = tools.mode(origin.parentThreadId);
    const wanted = childMode(parentMode, definition.permissions?.mode);
    if (tools.mode(childThreadId) !== wanted) {
      const changed = await tools.setMode(childThreadId, wanted, "user");
      if (!changed.ok) {
        return await recordSettled(origin, prepared, childThreadId, {
          status: "error",
          text: null,
          reason: `agents.denied: ${changed.error.kind}`,
          usage: null,
          answerItemId: null,
        });
      }
    }
    const ceiling = ceilingOf({
      parent: { caller: origin.caller, depth: origin.depth, mode: parentMode },
      definitionTools: definition.tools,
      requestAllow: request.tools?.allow,
    });
    let parentList: AdvertisedToolset | undefined;
    if (request.tools?.keepParentList === true) {
      const advertised = await tools.advertise({
        run: { threadId: origin.parentThreadId, caller: origin.caller, depth: origin.depth },
        activated: new Set(),
      });
      if (!advertised.ok) {
        // 부모의 광고 목록을 만들 수 없으면 같은 목록을 공유할 수 없다. 자식을 돌리지 않고 오류로 정착한다
        return await recordSettled(origin, prepared, childThreadId, {
          status: "error",
          text: null,
          reason: `agents.denied: tools.${advertised.error.kind}`,
          usage: null,
          answerItemId: null,
        });
      }
      parentList = advertised.value;
    }
    const ran = await loopTurn(prepared, request, childThreadId, scope, ceiling, parentList);
    return await recordSettled(origin, prepared, childThreadId, ran);
  };

  interface RanTurn {
    readonly status: "completed" | "aborted" | "error";
    readonly text: string | null;
    readonly reason?: string;
    readonly usage: SpawnResult["usage"];
    readonly answerItemId: ItemId | null;
    /** 상한에 닿아 끝났으면 어느 상한인가 */
    readonly limitHit?: "steps" | "tokens";
  }

  /** 자식의 마지막 turn.completed에서 상한 종료를 읽는다(`step_limit`, `child_limit`). 읽을 수 없으면 상한 종료로 보지 않는다 */
  const limitHitOf = (
    childThreadId: ThreadId,
    limits: SpawnRequest["limits"],
  ): "steps" | "tokens" | undefined => {
    const event = session.query.latestEvent(childThreadId, "turn.completed");
    if (!event.ok || event.value === undefined) return undefined;
    const payload = parse(TurnCompletedPayloadSchema, event.value.payload);
    if (!payload.ok) return undefined;
    const { error, stepCount } = payload.value;
    if (error === "step_limit") return "steps";
    if (error !== "child_limit") return undefined;
    const maxSteps = limits?.maxSteps;
    return maxSteps !== undefined && maxSteps > 0 && stepCount >= maxSteps ? "steps" : "tokens";
  };

  const loopTurn = async (
    prepared: PreparedSpawn,
    request: SpawnRequest,
    childThreadId: ThreadId,
    scope: TaskScope,
    ceiling: ReturnType<typeof ceilingOf>,
    parentList: AdvertisedToolset | undefined,
  ): Promise<RanTurn> => {
    const { definition } = prepared;
    const outcome = await deps.loop().runChildTurn({
      threadId: childThreadId,
      input: { kind: "user", content: request.task },
      requestId: prepared.requestId,
      systemPrompt: definition.prompt,
      model: request.model ?? definition.model ?? "subagent",
      tools: {
        caller: `subagent:${definition.name}`,
        depth: prepared.childDepth,
        ceiling,
        surfaceThreadId: prepared.surfaceThreadId,
        interactive: prepared.interactive,
        ...(ceiling.allow === undefined ? {} : { allow: ceiling.allow }),
        ...(request.tools?.deny === undefined || request.tools.deny.length === 0
          ? {}
          : { deny: request.tools.deny }),
        ...(request.tools?.denyHint === undefined ? {} : { denyHint: request.tools.denyHint }),
        ...(parentList === undefined ? {} : { keepParentList: { parent: parentList } }),
      },
      scope,
      ...(request.limits === undefined ? {} : { limits: request.limits }),
      signal: scope.signal,
    });
    if (!outcome.ok) {
      return {
        status: "error",
        text: null,
        reason: `loop: ${outcome.error.kind}`,
        usage: null,
        answerItemId: null,
      };
    }
    const turn = outcome.value;
    const finalItemId = turn.outcome.finalItemId ?? null;
    const limitHit = limitHitOf(childThreadId, request.limits);
    const limited = limitHit === undefined ? {} : { limitHit };
    if (turn.outcome.status !== "completed") {
      return {
        ...limited,
        status: turn.outcome.status,
        text: null,
        reason:
          turn.outcome.status === "aborted"
            ? "the subagent was aborted"
            : "the subagent turn failed",
        usage: turn.usage,
        answerItemId: finalItemId,
      };
    }
    let text: string | null = null;
    if (finalItemId !== null) {
      const read = await readFinalText(session, childThreadId, finalItemId);
      if (read.ok) text = read.value;
      else log.warn("agents.report_unreadable", { childThreadId, reason: read.error.kind });
    }
    return { ...limited, status: "completed", text, usage: turn.usage, answerItemId: finalItemId };
  };

  const settleAborted = (
    origin: SpawnOrigin,
    prepared: PreparedSpawn,
    childThreadId: ThreadId,
    cause: unknown,
  ): Promise<SpawnResult> =>
    recordSettled(origin, prepared, childThreadId, {
      status: "aborted",
      text: null,
      reason: cause instanceof Error ? cause.message : "the subagent was aborted before it ran",
      usage: null,
      answerItemId: null,
    });

  /** 결과 검사(§4.6)를 거쳐 부모 대화에 agent.settled를 커밋하고 자식 임대를 놓는다 */
  const recordSettled = async (
    origin: SpawnOrigin,
    prepared: PreparedSpawn,
    childThreadId: ThreadId,
    ran: RanTurn,
  ): Promise<SpawnResult> => {
    const maxChars = Math.min(settings.resultMaxChars(), STORED_REPORT_MAX);
    const report = guardReport({
      agent: prepared.definition.name,
      childThreadId,
      status: ran.status,
      text: ran.text,
      ...(ran.reason === undefined ? {} : { reason: ran.reason }),
      maxChars,
    });
    const committed = session.commit({
      threadId: origin.parentThreadId,
      requestId: `agent:${childThreadId}:settled`,
      fingerprintSource: { childThreadId, requestId: prepared.requestId },
      build(view): CommitPlan {
        const link = view.agentByRequestId(origin.parentThreadId, prepared.requestId);
        if (link === undefined) return { kind: "reject", code: "not_spawned", detail: null };
        if (link.settled !== null) return { kind: "reject", code: "already_settled", detail: null };
        const settledDraft = producer.draft({
          id: ids.next("evt"),
          kind: "agent.settled",
          threadId: origin.parentThreadId,
          turnId: null,
          stepId: null,
          causationId: null,
          correlationId: null,
          payload: {
            childThreadId,
            requestId: prepared.requestId,
            status: ran.status,
            report: {
              text: report.text,
              truncated: report.truncated,
              flags: [...report.flags],
              originalChars: report.originalChars,
            },
            answerItemId: ran.answerItemId,
            usage: ran.usage,
            error: ran.status === "error" ? (ran.reason ?? null) : null,
            owner: recordedOwnerOf(origin, prepared.requestId),
            limitHit: ran.limitHit ?? null,
          },
        });
        // 완료 보고 입력은 같은 커밋에 넣는다. 정착이 있으면 보고도 있어 재전송 규칙이 필요 없다(§4.7 2번·6번).
        // 부모 대화가 사라졌으면 보고를 버리고 agent.settled만 남긴다(§5 사례 7)
        const delivery = prepared.report;
        if (delivery === undefined || view.threadStatus === "absent") {
          return { kind: "append", drafts: [settledDraft], checkpoint: null };
        }
        const queued = tasks.inputs.draftQueued(view, {
          threadId: origin.parentThreadId,
          mode: delivery.when,
          item: {
            kind: "context",
            customType: reportKindOf(delivery.customType),
            content: report.text,
            display: delivery.display,
            details: {
              childThreadId,
              requestId: prepared.requestId,
              status: ran.status,
              flags: [...report.flags],
            },
          },
          requestId: `${prepared.requestId}:report`,
          source: { type: "delegation", childThreadId },
        });
        return { kind: "append", drafts: [settledDraft, ...queued.drafts], checkpoint: null };
      },
    });
    // 자식 임대는 정착을 기록한 뒤에 놓는다
    const released = await attemptAsync(() => session.release(childThreadId, "quit"));
    if (!released.ok) log.warn("agents.child_release_failed", { childThreadId });
    meta.delete(childThreadId);
    if (!committed.ok) {
      return failure(
        prepared.requestId,
        "agents.unavailable",
        `settle commit failed: ${committed.error.kind}`,
        childThreadId,
      );
    }
    return {
      childThreadId,
      status: ran.status,
      answer: report.text,
      requestId: prepared.requestId,
      report,
      usage: ran.usage,
      reused: false,
    };
  };

  /** 이미 자식 연결이 있는 requestId(정착, 진행 중, 끊김 세 경우, §4.5) */
  const attach = async (
    link: AgentView,
    origin: SpawnOrigin,
    prepared: PreparedSpawn,
    request: SpawnRequest,
  ): Promise<SpawnResult> => {
    if (link.settled !== null) {
      const recorded = settledResult(origin.parentThreadId, link);
      return (
        recorded ??
        failure(
          prepared.requestId,
          "agents.unavailable",
          "the settled record is unreadable",
          link.childThreadId,
        )
      );
    }
    await starting.get(link.childThreadId)?.promise;
    const running = live.get(link.childThreadId);
    if (running !== undefined) return { ...(await running.done), reused: true };
    // 재시작으로 끊긴 자식: 같은 대화를 재개한다. 자식 임대를 다시 얻고 쓰기로 연다
    if (reopenChild(link.childThreadId) === undefined) {
      return failure(
        prepared.requestId,
        "agents.unavailable",
        "cannot take the child's write lease",
        link.childThreadId,
      );
    }
    const resumed = await runChild(origin, prepared, request, link.childThreadId);
    return { ...resumed, reused: true };
  };

  /** 백그라운드 자식의 실행을 기다리지 않고 시작한다. 예상 못 한 실패는 기록한다 */
  const startInBackground = (
    origin: SpawnOrigin,
    prepared: PreparedSpawn,
    request: SpawnRequest,
    childThreadId: ThreadId,
  ): void => {
    const running = (() => {
      try {
        return runChild(origin, prepared, request, childThreadId);
      } finally {
        releaseStarting(childThreadId);
      }
    })();
    detach(running, (cause) =>
      log.error("agents.background_failed", {
        childThreadId,
        requestId: prepared.requestId,
        message: cause instanceof Error ? cause.message : "non_error_thrown",
      }),
    );
  };

  /** 이미 연결이 있는 백그라운드 requestId: 끊긴 자식이면 이어서 돌리고, 새 자식은 만들지 않는다(§4.5, M3-REQ-69) */
  const attachBackground = (
    link: AgentView,
    origin: SpawnOrigin,
    prepared: PreparedSpawn,
    request: SpawnRequest,
  ): DelegateResult => {
    const duplicate = receiptOf(prepared.requestId, link.childThreadId, "duplicate");
    if (link.settled !== null || live.has(link.childThreadId) || starting.has(link.childThreadId)) {
      return duplicate;
    }
    if (reopenChild(link.childThreadId) === undefined) {
      return {
        ok: false,
        error: { kind: "agents.unavailable", message: "cannot take the child's write lease" },
      };
    }
    startInBackground(origin, prepared, request, link.childThreadId);
    return duplicate;
  };

  /** 자식 thread를 만들고 부모에 agent.spawned를 커밋한다(§4.1 3번). 실행은 호출자가 한다 */
  const provision = async (
    origin: SpawnOrigin,
    prepared: PreparedSpawn,
    request: SpawnRequest,
  ): Promise<Provisioned> => {
    const parentToken = origin.parentToken ?? ownership.parentToken(origin.parentThreadId);
    if (parentToken === undefined) {
      return refused("agents.unavailable", "the parent's write token is unknown");
    }
    const newId = ids.next("thr");
    let childThreadId: ThreadId;
    if (request.fork === undefined) {
      const created = session.threads.create({
        threadId: newId,
        title: prepared.definition.name,
        creationKey: creationKeyOf(origin.parentThreadId, prepared.requestId),
        inheritOwnerFrom: parentToken,
      });
      if (!created.ok) {
        return refused("agents.unavailable", `child creation failed: ${created.error.kind}`);
      }
      childThreadId = created.value.threadId;
      // 이전 시도가 만든 자식을 creationKey로 다시 만났다: 임대는 그때 얻었고 프로세스는 바뀌었을 수 있다
      if (created.value.replayed && reopenChild(childThreadId) === undefined) {
        return refused("agents.unavailable", "cannot take the child's write lease", childThreadId);
      }
    } else {
      if (request.fork.at === "event") {
        return refused(
          "agents.invalid_request",
          "fork at an event needs session fork-by-event (not available yet)",
        );
      }
      const forked = await session.threads.fork(origin.parentThreadId, request.fork.itemId, newId);
      if (!forked.ok) {
        return refused("agents.unavailable", `fork failed: ${forked.error.kind}`);
      }
      childThreadId = forked.value.threadId;
      if (reopenChild(childThreadId) === undefined) {
        return refused("agents.unavailable", "cannot take the child's write lease", childThreadId);
      }
    }
    const spawned = commitSpawned(origin, prepared, request, childThreadId);
    switch (spawned) {
      case "committed":
        markStarting(childThreadId);
        return { kind: "run", childThreadId };
      case "exists": {
        // 다른 호출이 먼저 연결을 남겼다. 그 연결을 따른다
        const link = linkOf(origin.parentThreadId, prepared.requestId);
        if (link === undefined || link === "unreadable") {
          return refused("agents.unavailable", "the child link is unreadable", childThreadId);
        }
        return { kind: "exists", link };
      }
      case "parent_aborting":
        return refused("agents.parent_aborting", "the parent turn is being aborted", childThreadId);
      case "key_reused":
        return refused(
          "agents.invalid_request",
          "this requestId was already used for another subagent",
          childThreadId,
        );
      case "unavailable":
        return refused(
          "agents.unavailable",
          "the spawn record could not be committed",
          childThreadId,
        );
      default:
        return assertNever(spawned, "commitSpawned");
    }
  };

  const failureOf = (requestId: string, refusal: Refusal): SpawnResult =>
    failure(requestId, refusal.code, refusal.message, refusal.childThreadId);

  const judge = createJudge({
    session,
    producer,
    ids,
    models: deps.models ?? (() => undefined),
    maxRuns: () => settings.judgeMaxRuns?.() ?? JUDGE_MAX_RUNS_DEFAULT,
    now: deps.now ?? Date.now,
    log,
  });

  return {
    async spawn(request, origin): Promise<SpawnResult> {
      const prepared = prepare(request, origin, { background: false });
      if (!prepared.ok) return failureOf(prepared.requestId, prepared.refusal);
      const link = linkOf(origin.parentThreadId, prepared.value.requestId);
      if (link === "unreadable") {
        return failure(
          prepared.value.requestId,
          "agents.unavailable",
          "the child links are unreadable",
        );
      }
      if (link !== undefined) {
        if (clashesWithRecorded(origin, prepared.value.requestId, request)) {
          return failure(
            prepared.value.requestId,
            "agents.invalid_request",
            "this requestId was already used for another subagent",
            link.childThreadId,
          );
        }
        return await attach(link, origin, prepared.value, request);
      }
      const provisioned = await provision(origin, prepared.value, request);
      switch (provisioned.kind) {
        case "run": {
          const running = (() => {
            try {
              return runChild(origin, prepared.value, request, provisioned.childThreadId);
            } finally {
              releaseStarting(provisioned.childThreadId);
            }
          })();
          return await running;
        }
        case "exists":
          return await attach(provisioned.link, origin, prepared.value, request);
        case "refused":
          return failureOf(prepared.value.requestId, provisioned.refusal);
        default:
          return assertNever(provisioned, "spawn.provision");
      }
    },

    async delegate(request: DelegateRequest, origin: SpawnOrigin): Promise<DelegateResult> {
      if (request.requestId.length < 1 || request.requestId.length > DELEGATE_REQUEST_ID_MAX) {
        return {
          ok: false,
          error: {
            kind: "agents.invalid_request",
            message: `requestId must be 1 to ${String(DELEGATE_REQUEST_ID_MAX)} characters`,
          },
        };
      }
      // 멱등을 먼저 본다: 이미 정착했거나 도는 위임은 지금의 검사(깊이, 정의, 부모 상태)에 걸리지 않고 duplicate다
      const requestId = childRequestId(request.requestId);
      const early = linkOf(origin.parentThreadId, requestId);
      if (early !== undefined && early !== "unreadable") {
        if (clashesWithRecorded(origin, requestId, request)) {
          return {
            ok: false,
            error: {
              kind: "agents.invalid_request",
              message: "this requestId was already used for another subagent",
            },
          };
        }
        if (
          early.settled !== null ||
          live.has(early.childThreadId) ||
          starting.has(early.childThreadId)
        ) {
          return receiptOf(requestId, early.childThreadId, "duplicate");
        }
      }
      const prepared = prepare(request, origin, {
        background: true,
        ...(request.report === undefined ? {} : { report: request.report }),
      });
      if (!prepared.ok) {
        return {
          ok: false,
          error: { kind: prepared.refusal.code, message: prepared.refusal.message },
        };
      }
      // 멱등: 같은 (부모, requestId)의 agent.spawned가 DB에 있으면 새 자식을 만들지 않는다
      const link = linkOf(origin.parentThreadId, prepared.value.requestId);
      if (link === "unreadable") {
        return {
          ok: false,
          error: { kind: "agents.unavailable", message: "the child links are unreadable" },
        };
      }
      if (link !== undefined) return attachBackground(link, origin, prepared.value, request);
      const provisioned = await provision(origin, prepared.value, request);
      switch (provisioned.kind) {
        case "run":
          startInBackground(origin, prepared.value, request, provisioned.childThreadId);
          return receiptOf(prepared.value.requestId, provisioned.childThreadId, "accepted");
        case "exists":
          return attachBackground(provisioned.link, origin, prepared.value, request);
        case "refused":
          return {
            ok: false,
            error: { kind: provisioned.refusal.code, message: provisioned.refusal.message },
          };
        default:
          return assertNever(provisioned, "delegate.provision");
      }
    },

    async cancel(target: CancelTarget, reason: string): Promise<{ readonly cancelled: boolean }> {
      if ("ownerScopeId" in target) {
        // 소유 scope(그룹) 단위 취소: 이 프로세스에서 도는 그 scope의 위임을 모두 멈춘다. 취소된 자식도 agent.settled{aborted}를 남긴다
        const owned = [...live.values()].filter(
          (child) => child.owner.kind !== "tool" && child.owner.scopeId === target.ownerScopeId,
        );
        const tickets = await Promise.all(
          owned.map((child) => tasks.abort(child.scope, abortReasonOf(reason))),
        );
        return { cancelled: tickets.some((t) => t.ok && t.value.status === "signalled") };
      }
      let childThreadId: ThreadId | undefined;
      if ("childThreadId" in target) {
        childThreadId = target.childThreadId;
      } else {
        const link = linkOf(target.parentThreadId, target.requestId);
        childThreadId =
          link === undefined || link === "unreadable" ? undefined : link.childThreadId;
      }
      if (childThreadId === undefined) return { cancelled: false };
      const scope = live.get(childThreadId)?.scope ?? tasks.find("subagent", childThreadId);
      if (scope === undefined) return { cancelled: false };
      const ticket = await tasks.abort(scope, abortReasonOf(reason));
      return { cancelled: ticket.ok && ticket.value.status === "signalled" };
    },

    status(parentThreadId, requestId): ChildStatus | undefined {
      const link = linkOf(parentThreadId, requestId);
      if (link === undefined || link === "unreadable") return undefined;
      if (link.settled !== null) {
        const result = settledResult(parentThreadId, link);
        return result === undefined
          ? undefined
          : { state: "settled", childThreadId: link.childThreadId, result };
      }
      const running = live.get(link.childThreadId);
      return { state: running?.phase.state ?? "running", childThreadId: link.childThreadId };
    },

    define: (definition) => registry.define(definition),
    definition: (name) => registry.get(name),
    definitions: () => registry.list(),

    judge,

    contextOf,
    liveCount: () => live.size,
    syncRules,
    dispose(): void {
      rules?.dispose();
      rules = undefined;
    },
  };
}

// AgentService 구현(L1.agents.spec §3.3, §4.1~§4.6, AG-1·2·3·6·11). M2는 포그라운드 spawn까지다.
// delegate(백그라운드, AG-7)와 judge(AG-8)는 M3이고 지금은 `agents.unavailable` 값을 돌려준다.
import { assertNever, attemptAsync, detach, parse } from "@xeon/contracts";
import {
  AgentSettledEventPayloadSchema,
  commitKeyPart,
  type AgentView,
  type CommitPlan,
  type LeaseToken,
} from "@xeon/contracts/records";
import type { ItemId, ThreadId } from "@xeon/contracts/conversation";
import type {
  AgentDefinition,
  AdvertisedToolset,
  AgentService,
  AgentsErrorCode,
  CancelTarget,
  ChildStatus,
  DelegateRequest,
  DelegateResult,
  GuardedReport,
  JudgeInput,
  JudgeOutcome,
  MimicryFlag,
  RuleRegistration,
  SpawnOrigin,
  SpawnRequest,
  SpawnResult,
  TaskScope,
} from "@xeon/contracts/services";
import { ceilingOf, childMode } from "./permission-ceiling.ts";
import { AGENTS_RULE_SOURCE, definitionRules, subagentRules } from "./denylist.ts";
import { createDefinitionRegistry } from "./definitions/registry.ts";
import type { AgentsDeps } from "./deps.ts";
import { createConcurrencyGate, type ConcurrencyGate } from "./gate.ts";
import { sha256Hex } from "./hash.ts";
import { readFinalText } from "./report-reader.ts";
import { childRequestId, createSpawnCounter, derivedRequestId } from "./request-id.ts";
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
}

function spawnKey(parent: ThreadId, requestId: string): string {
  return `spawn:${commitKeyPart(parent, sha256Hex)}:${commitKeyPart(requestId, sha256Hex)}`;
}

function creationKeyOf(parent: ThreadId, requestId: string): string {
  return `spawn:${sha256Hex(`${parent}\0${requestId}`).slice(0, 40)}`;
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

  /** 입력 검사(§4.1 1번). 실패는 값으로 돌려준다 */
  const prepare = (
    request: SpawnRequest,
    origin: SpawnOrigin,
  ):
    | { readonly ok: true; readonly value: PreparedSpawn }
    | { readonly ok: false; readonly result: SpawnResult } => {
    const requestId = childRequestId(
      request.requestId ??
        derivedRequestId(origin.ownerRequestId, counter.next(origin.ownerRequestId)),
    );
    const refuse = (code: AgentsErrorCode, message: string) => ({
      ok: false as const,
      result: failure(requestId, code, message),
    });
    const definition = registry.get(request.agent);
    if (definition === undefined) {
      return refuse("agents.unknown_definition", `no subagent definition named "${request.agent}"`);
    }
    if (request.background === true) {
      return refuse("agents.unavailable", "background delegation arrives with M3");
    }
    if ((request.tools?.deny?.length ?? 0) > 0) {
      // ChildTurnRequest에 deny를 실을 자리가 없다. 조용히 무시하면 권한이 넓어지므로 거부한다 [미결]
      return refuse("agents.invalid_request", "tools.deny is not supported yet; use tools.allow");
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
    const parentContext = contextOf(origin.parentThreadId);
    return {
      ok: true,
      value: {
        definition,
        requestId,
        childDepth,
        surfaceThreadId: parentContext.surfaceThreadId,
        interactive: parentContext.interactive,
      },
    };
  };

  /** 소유 간선의 부모 노드(§4.1 4번): 도구 호출, turn, 아니면 thread */
  const parentScopeOf = (origin: SpawnOrigin): TaskScope => {
    const { owner } = origin;
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
    const ownerJson =
      owner.kind === "tool"
        ? ({ kind: "tool", turnId: owner.turnId, toolCallId: owner.toolCallId } as const)
        : owner.kind === "drive"
          ? ({
              kind: "drive",
              turnId: owner.turnId,
              scopeId: owner.scopeId,
              leaseId: owner.leaseId,
            } as const)
          : ({ kind: "scope", scopeId: owner.scopeId } as const);
    const turnId = owner.kind === "scope" ? null : owner.turnId;
    const committed = session.commit({
      threadId: origin.parentThreadId,
      requestId: spawnKey(origin.parentThreadId, prepared.requestId),
      fingerprintSource: {
        requestId: prepared.requestId,
        agent: prepared.definition.name,
        depth: prepared.childDepth,
      },
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
                background: false,
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
    const parentScope = parentScopeOf(origin);
    const scope = tasks.openScope(parentScope, { kind: "subagent", id: childThreadId });
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
      origin.signal.removeEventListener("abort", onOriginAbort);
      live.delete(childThreadId);
    });
    live.set(childThreadId, {
      parentThreadId: origin.parentThreadId,
      requestId: prepared.requestId,
      phase,
      scope,
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
  }

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
    if (turn.outcome.status !== "completed") {
      return {
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
    return { status: "completed", text, usage: turn.usage, answerItemId: finalItemId };
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
        return {
          kind: "append",
          drafts: [
            producer.draft({
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
              },
            }),
          ],
          checkpoint: null,
        };
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

  const createChild = async (
    origin: SpawnOrigin,
    prepared: PreparedSpawn,
    request: SpawnRequest,
  ): Promise<SpawnResult> => {
    const parentToken = ownership.parentToken(origin.parentThreadId);
    if (parentToken === undefined) {
      return failure(
        prepared.requestId,
        "agents.unavailable",
        "the parent's write token is unknown",
      );
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
        return failure(
          prepared.requestId,
          "agents.unavailable",
          `child creation failed: ${created.error.kind}`,
        );
      }
      childThreadId = created.value.threadId;
      // 이전 시도가 만든 자식을 creationKey로 다시 만났다: 임대는 그때 얻었고 프로세스는 바뀌었을 수 있다
      if (created.value.replayed && reopenChild(childThreadId) === undefined) {
        return failure(
          prepared.requestId,
          "agents.unavailable",
          "cannot take the child's write lease",
          childThreadId,
        );
      }
    } else {
      const at = request.fork.at === "item" ? request.fork.itemId : undefined;
      if (request.fork.at === "event") {
        return failure(
          prepared.requestId,
          "agents.invalid_request",
          "fork at an event needs session fork-by-event (not available yet)",
        );
      }
      const forked = await session.threads.fork(origin.parentThreadId, at, newId);
      if (!forked.ok) {
        return failure(
          prepared.requestId,
          "agents.unavailable",
          `fork failed: ${forked.error.kind}`,
        );
      }
      childThreadId = forked.value.threadId;
      if (reopenChild(childThreadId) === undefined) {
        return failure(
          prepared.requestId,
          "agents.unavailable",
          "cannot take the child's write lease",
          childThreadId,
        );
      }
    }
    const spawned = commitSpawned(origin, prepared, request, childThreadId);
    switch (spawned) {
      case "committed":
        return await runChild(origin, prepared, request, childThreadId);
      case "exists": {
        // 다른 호출이 먼저 연결을 남겼다. 그 연결을 따른다
        const link = linkOf(origin.parentThreadId, prepared.requestId);
        if (link === undefined || link === "unreadable") {
          return failure(
            prepared.requestId,
            "agents.unavailable",
            "the child link is unreadable",
            childThreadId,
          );
        }
        return await attach(link, origin, prepared, request);
      }
      case "parent_aborting":
        return failure(
          prepared.requestId,
          "agents.parent_aborting",
          "the parent turn is being aborted",
          childThreadId,
        );
      case "key_reused":
        return failure(
          prepared.requestId,
          "agents.invalid_request",
          "this requestId was already used for another subagent",
          childThreadId,
        );
      case "unavailable":
        return failure(
          prepared.requestId,
          "agents.unavailable",
          "the spawn record could not be committed",
          childThreadId,
        );
      default:
        return assertNever(spawned, "commitSpawned");
    }
  };

  return {
    async spawn(request, origin): Promise<SpawnResult> {
      const prepared = prepare(request, origin);
      if (!prepared.ok) return prepared.result;
      const link = linkOf(origin.parentThreadId, prepared.value.requestId);
      if (link === "unreadable") {
        return failure(
          prepared.value.requestId,
          "agents.unavailable",
          "the child links are unreadable",
        );
      }
      if (link !== undefined) return await attach(link, origin, prepared.value, request);
      return await createChild(origin, prepared.value, request);
    },

    delegate(_request: DelegateRequest, _origin: SpawnOrigin): Promise<DelegateResult> {
      return Promise.resolve({
        ok: false,
        error: { kind: "agents.unavailable", message: "background delegation arrives with M3" },
      });
    },

    async cancel(target: CancelTarget, reason: string): Promise<{ readonly cancelled: boolean }> {
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
      const ticket = await tasks.abort(scope, { code: "user", message: reason });
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

    judge(_input: JudgeInput): Promise<JudgeOutcome> {
      return Promise.resolve({ kind: "failed", message: "goal judging arrives with M3" });
    },

    contextOf,
    liveCount: () => live.size,
    syncRules,
    dispose(): void {
      rules?.dispose();
      rules = undefined;
    },
  };
}

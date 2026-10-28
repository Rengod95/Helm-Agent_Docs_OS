import { assertNever } from "@xeon/contracts";
import type { AgentEvent, ThreadId, TurnId } from "@xeon/contracts/conversation";
import type { TaskScope } from "@xeon/contracts/services";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { createDrafter } from "../../src/drafts.ts";
import { createTurnRun, type TurnRun } from "../../src/loop/turn-run.ts";
import type { TurnEntry, TurnRunSpec } from "../../src/loop/types.ts";
import { createThreadGate } from "../../src/thread-gate.ts";
import type { LoopContext, ThreadRuntime } from "../../src/types.ts";
import type { Harness } from "./harness.ts";

// 루프 단계 함수를 서비스 없이 직접 부르는 시험 장치. 서비스가 만드는 TurnRun을 같은 모양으로 만들고,
// 매퍼에 들어가는 AgentEvent를 순서대로 모은다(원본 agent-loop 시험의 이벤트 순서 사례용).

export interface LoopRig {
  readonly run: TurnRun;
  readonly ctx: LoopContext;
  /** 매퍼가 받은 AgentEvent 전부(순서대로) */
  readonly events: AgentEvent[];
  readonly turnScope: TaskScope;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  /** 이벤트 종류만(message 이벤트는 role을 붙인다) */
  trace(): string[];
}

function describeEvent(event: AgentEvent): string {
  switch (event.type) {
    case "message_start":
    case "message_end":
      return `${event.type}:${event.message.role}`;
    case "tool_execution_start":
    case "tool_execution_end":
    case "tool_execution_update":
      return `${event.type}:${event.toolCallId}`;
    case "agent_start":
    case "agent_end":
    case "turn_start":
    case "turn_end":
    case "message_update":
      return event.type;
    default:
      return assertNever(event, "AgentEvent");
  }
}

export function createRig(
  h: Harness,
  options: { readonly entry?: TurnEntry; readonly seed?: number } = {},
): LoopRig {
  const ids = fixedIdFactory(options.seed ?? 7_000_000);
  const ctx: LoopContext = {
    clock: h.clock,
    ids,
    logger: h.logs.logger,
    session: h.fake.session,
    tasks: h.tasks.service,
    tools: h.tools.service,
    context: h.context.service,
    models: h.models.service,
    ext: h.host.host,
    settings: { maxSteps: () => 0, gateMaxContinues: () => 8 },
    basePrompt: "You are a test assistant.",
    hostMode: "in-process",
    kindLookup: () => undefined,
    cancelledByOwner: () => false,
    drafter: createDrafter({ session: h.fake.session, ids }),
  };
  const turnId = ids.next("trn");
  const threadScope = h.tasks.service.openScope(h.tasks.service.root, {
    kind: "thread",
    id: h.threadId,
  });
  const turnScope = h.tasks.service.openScope(threadScope, { kind: "turn", id: turnId });
  const thread: ThreadRuntime = {
    threadId: h.threadId,
    gate: createThreadGate(),
    scope: threadScope,
    running: { turnId, scope: turnScope, stepIndex: null, phase: "requesting" },
    starting: null,
    leaf: null,
    stopRequested: false,
    placed: new Map(),
  };
  // 서비스처럼 커밋한 쪽과 무관하게 활성 가지의 마지막 이벤트를 따라간다
  h.fake.session.feed.onCommit((batch) => {
    for (const event of batch.events) {
      if (event.threadId === h.threadId) thread.leaf = event.id;
    }
  });
  const spec: TurnRunSpec = {
    thread,
    turnId,
    scope: turnScope,
    entry: options.entry ?? { kind: "request", stepIndex: 0, adoptStepId: null, binding: null },
    interactive: true,
    origin: "user",
    scopeId: null,
    leaseId: null,
    driveSignal: null,
    consumedSeq: 0,
    leaseRefs: [],
    scopeRef: null,
    priorStepCount: 0,
    priorUsage: null,
    priorFinalItemId: null,
    priorLastStop: null,
    priorLastError: null,
    child: null,
  };
  const base = createTurnRun(ctx, spec);
  const events: AgentEvent[] = [];
  const run: TurnRun = {
    ...base,
    mapper: {
      ...base.mapper,
      map: (event) => {
        events.push(event);
        return base.mapper.map(event);
      },
    },
  };
  return {
    run,
    ctx,
    events,
    turnScope,
    threadId: h.threadId,
    turnId,
    trace: () => events.map(describeEvent),
  };
}

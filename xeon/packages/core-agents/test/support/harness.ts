import type { Logger } from "@xeon/contracts";
import { ok } from "@xeon/contracts";
import type { ThreadId, TurnId } from "@xeon/contracts/conversation";
import type { LeaseHolder } from "@xeon/contracts/records";
import type {
  AgentDefinition,
  ChildTurnRequest,
  SpawnOrigin,
  TaskScope,
} from "@xeon/contracts/services";
import {
  createAgentService,
  createStaticAgentsSettings,
  type AgentServiceImpl,
  type StaticAgentsSettings,
} from "../../src/index.ts";
import { fakeChildLoop, type FakeChildLoop, type FakeChildTurn } from "../../src/testing/index.ts";
import type { FakeModels } from "./fake-models.ts";
import { fakeSession, type FakeSession } from "./fake-session.ts";
import { fakeTasks, type FakeTasks } from "./fake-tasks.ts";
import { fakeTools, type FakeTools } from "./fake-tools.ts";
import { fixedIdFactory } from "./ids.ts";

export const HOLDER: LeaseHolder = {
  holderId: "holder-a",
  kind: "cli",
  pid: 1001,
  startedAt: 1_767_571_200_000,
  host: "test-host",
};

export const NOOP_LOG: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOG,
};

export const EXPLORER: AgentDefinition = {
  name: "explorer",
  description: "Explores the repository.",
  prompt: "You explore the repository and report findings.",
  source: { kind: "builtin" },
};

export interface Harness {
  readonly ids: ReturnType<typeof fixedIdFactory>;
  readonly session: FakeSession;
  readonly tasks: FakeTasks;
  readonly tools: FakeTools;
  readonly loop: FakeChildLoop;
  readonly service: AgentServiceImpl;
  readonly parentThreadId: ThreadId;
  readonly parentScope: TaskScope;
  /** 주 대화에서 도구 호출 하나를 열고(turn 노드 아래 tool 노드) 그 호출의 spawn 입력을 돌려준다 */
  openToolCall(toolCallId: string): {
    readonly turnId: TurnId;
    readonly tool: TaskScope;
    readonly origin: SpawnOrigin;
    readonly controller: AbortController;
  };
}

export interface HarnessOptions extends StaticAgentsSettings {
  /** 자식 turn 본문. 기본은 곧바로 completed + 보고 "found it" */
  readonly run?: (request: ChildTurnRequest, session: FakeSession) => Promise<FakeChildTurn>;
  /** 이전 하네스의 세션을 이어 쓴다(프로세스 재시작 흉내) */
  readonly session?: FakeSession;
  readonly definitions?: readonly AgentDefinition[];
  /** 판정이 부르는 xeon.models 대역 */
  readonly models?: FakeModels;
}

export function openHarness(options: HarnessOptions = {}): Harness {
  const ids = fixedIdFactory(options.session === undefined ? 1 : 2);
  const session = options.session ?? fakeSession(fixedIdFactory(7));
  const tasks = fakeTasks({ producer: session.producer("core.tasks"), ids });
  const tools = fakeTools();
  const loop = fakeChildLoop({
    ids,
    run:
      options.run === undefined
        ? (request) => {
            const finalItemId = session.seedAssistantItem(request.threadId, "found it");
            return Promise.resolve({ status: "completed", finalItemId });
          }
        : (request) => options.run?.(request, session) ?? Promise.reject(new Error("no run")),
  });
  const service = createAgentService({
    session,
    loop: () => loop,
    tasks,
    tools,
    producer: session.producer("core.agents"),
    ids,
    settings: createStaticAgentsSettings(options),
    ownership: {
      parentToken: (threadId) => session.tokenOf(threadId),
      holder: HOLDER,
      leases: {
        acquire: (resource, holder) => ok({ resource, holderId: holder.holderId, epoch: 2 }),
      },
    },
    log: NOOP_LOG,
    now: () => 1_767_571_200_000,
    ...(options.models === undefined ? {} : { models: () => options.models }),
  });
  service.syncRules();
  for (const definition of options.definitions ?? [EXPLORER]) service.define(definition);

  const parentThreadId = ids.next("thr");
  const created = session.threads.create({ threadId: parentThreadId });
  if (!created.ok) throw new Error("fake parent creation failed");
  const parentScope = tasks.openScope(tasks.root, { kind: "thread", id: parentThreadId });

  return {
    ids,
    session,
    tasks,
    tools,
    loop,
    service,
    parentThreadId,
    parentScope,
    openToolCall(toolCallId) {
      const turnId = ids.next("trn");
      const turn = tasks.openScope(parentScope, { kind: "turn", id: turnId });
      const tool = tasks.openScope(turn, { kind: "tool", id: toolCallId });
      const controller = new AbortController();
      const origin: SpawnOrigin = {
        parentThreadId,
        owner: { kind: "tool", turnId, toolCallId },
        caller: "main",
        depth: 0,
        ownerRequestId: `tool:${toolCallId}`,
        signal: controller.signal,
      };
      return { turnId, tool, origin, controller };
    },
  };
}

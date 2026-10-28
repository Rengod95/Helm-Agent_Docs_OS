import {
  KnowledgeLedger,
  KnowledgeMemory,
  KnowledgeSearch,
  KnowledgeSkills,
} from "@xeon/contracts/capabilities";
import type {
  AssistantMessage,
  ItemId,
  StepId,
  ThreadId,
  ToolResultMessage,
  TurnId,
  TurnOrigin,
  UserMessage,
} from "@xeon/contracts/conversation";
import { ToolsPortKey, type ToolResourceDef } from "@xeon/contracts/extensions";
import type { AgentSettledEventPayload } from "@xeon/contracts/records";
import { ok, parse } from "@xeon/contracts";
import { AgentServicePortKey } from "@xeon/contracts/services";
import { Type } from "typebox";
import { capabilityDefTable } from "@xeon/ext-host";
import { createTestHost, type TestHost } from "@xeon/ext-host/testing";
import { GroupSettingsSourceKey, type GroupModule } from "@xeon/group-kit";
import { fakeAgents, type FakeAgents } from "@xeon/group-kit/testing";
import {
  createLearningBridge,
  createLearningGroup,
  type CommandReport,
  type LearningBridge,
  type LearningQueueReader,
} from "../../src/index.ts";
import { foldReader, type FoldedEvent } from "./projection.ts";
import { INITIAL_LEARNING_STATE, type LearningState } from "../../src/state.ts";
import { manualClock, type ManualClock } from "./clock.ts";
import { fakeKnowledge, type FakeKnowledge } from "./fake-knowledge.ts";

const nullableId = Type.Union([Type.String(), Type.Null()]);
const StateDocSchema = Type.Object({
  userTurnsSinceReview: Type.Integer(),
  toolIterationsSinceSkillWrite: Type.Integer(),
  lastReviewId: nullableId,
  epoch: Type.Integer(),
  inFlightReviewId: nullableId,
  settledReviewId: nullableId,
  lastTurnId: nullableId,
  lastItemId: nullableId,
  delegateFailures: Type.Integer(),
  curatorLastRunAt: Type.Union([Type.Integer(), Type.Null()]),
});
const CommittedSchema = Type.Object({ doc: StateDocSchema });

const usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 15,
  cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
} as const;

const userText: UserMessage = { role: "user", content: "hello", timestamp: 1_700_000_000_002 };
const assistantStop: AssistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "answer" }],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-x",
  usage,
  stopReason: "stop",
  timestamp: 1_700_000_000_004,
};

function toolResult(toolName: string, n: number): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: `call_${String(n)}`,
    toolName,
    content: [{ type: "text", text: "ok" }],
    isError: false,
    timestamp: 1_700_000_000_005,
  };
}

export interface RigOptions {
  /** 설정 키 값(`l3.learning.*`). 없는 키는 기본값이다 */
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly knowledge?: FakeKnowledge;
  readonly agents?: FakeAgents;

  /** 모듈을 올리지 않는다(재시작 시험이 직접 올린다) */
  readonly skipInstall?: boolean;
}

interface TurnSpec {
  readonly origin?: TurnOrigin;
  readonly status?: "completed" | "aborted" | "error";
  readonly hasFinalAnswer?: boolean;
  /** 도구 결과가 있는 step 수 */
  readonly toolSteps?: number;
  /** step 하나의 도구 결과 수 */
  readonly toolsPerStep?: number;
  readonly toolName?: string;
  /** null이면 lastItemId를 싣지 않는다(옛 페이로드) */
  readonly lastItemId?: ItemId | null;
  /** 같은 지점의 재발화를 흉내 내려고 키를 고정한다 */
  readonly key?: string;
  /** 같은 turn의 재발화를 흉내 낸다 */
  readonly turnId?: TurnId;
  /** 거짓이면 turn 뒤에 `host.settled()`를 기다리지 않는다(임대를 쥔 drive가 끝나지 않는 시험) */
  readonly settle?: boolean;
  /** 같은 step의 재발화를 흉내 내려고 stepId를 고정한다 */
  readonly stepIds?: readonly StepId[];
}

export interface Rig {
  readonly t: TestHost;
  readonly thread: ThreadId;
  readonly agents: FakeAgents;
  readonly knowledge: FakeKnowledge;
  /** 기록을 접어 읽는 대기열 읽기 면(투영의 메모리 구현) */
  readonly reader: LearningQueueReader;
  readonly bridge: LearningBridge;
  readonly clock: ManualClock;
  readonly reports: CommandReport[];
  readonly module: GroupModule;
  readonly values: Map<string, unknown>;
  /** 거짓이면 turn과 정착 뒤에 `host.settled()`를 기다리지 않는다(임대를 쥔 drive가 끝나지 않는 시험). 설정 저장소를 읽을 수 없게 하는 스위치도 여기 있다 */
  readonly control: { settingsDown: boolean; waitSettled: boolean };
  /** 그룹을 올릴 때 X가 낸 이슈(선언 없는 등록 등) */
  readonly installIssues: readonly { readonly severity: string; readonly code: string }[];
  /** 그룹을 끈다: 요청은 다음 단계 경계에서 적용된다 */
  disable(): Promise<void>;
  /** 그룹을 다시 켠다 */
  enable(): Promise<void>;
  /** 마지막으로 커밋한 그룹 상태. 커밋이 없으면 초기값 */
  state(): LearningState;
  /** 그룹 상태 커밋 이벤트 수 */
  commits(): number;
  /** 이 kind의 기록 payload. 공개 레코드는 GroupRecord 봉투를 벗긴 안쪽 payload다 */
  payloads(kind: string): readonly unknown[];
  /** 이 kind의 기록(공개와 비공개 모두) */
  events(kind: string): readonly { readonly kind: string; readonly payload: unknown }[];
  /** turn 하나: turn.before → step.after × n → settle.after */
  turn(spec?: TurnSpec): Promise<ItemId>;
  /** 자식 위임을 정착시키고 agent.settled 지점을 부른다 */
  settle(
    requestId: string,
    status?: "completed" | "aborted" | "error",
    extra?: Partial<AgentSettledEventPayload>,
  ): Promise<AgentSettledEventPayload | undefined>;
  tool(): ToolResourceDef;
  command(args: string, threadId?: ThreadId | null): Promise<CommandReport>;
  /** 이 thread에서 학습 기록을 접는 순서: 후보를 만든 자식 thread가 먼저다 */
  foldedEvents(): readonly FoldedEvent[];
}

let counter = 0;

/** 학습 그룹을 올린 테스트 호스트. 위임 서비스, 지식 저장소, 설정은 대역이다 */
export async function createRig(options: RigOptions = {}): Promise<Rig> {
  const t = await createTestHost({
    capabilityDefs: capabilityDefTable([
      KnowledgeSkills,
      KnowledgeMemory,
      KnowledgeSearch,
      KnowledgeLedger,
    ]),
  });
  return rigOn(t, options);
}

export async function rigOn(
  t: TestHost,
  options: RigOptions = {},
  thread?: ThreadId,
): Promise<Rig> {
  const agents = options.agents ?? fakeAgents({ ids: t.ids });
  const knowledge = options.knowledge ?? fakeKnowledge();
  const bridge = createLearningBridge();
  const clock = manualClock();
  const reports: CommandReport[] = [];
  const reportOf = new Map<string, CommandReport>();
  const rigThreadId = thread ?? t.newThread();
  const foldedEvents = (): readonly FoldedEvent[] =>
    [...agents.delegated.map((delegation) => delegation.childThreadId), rigThreadId].flatMap(
      (threadId) =>
        t.records
          .events(threadId)
          .filter((draft) => draft.kind.startsWith("grp.learning."))
          .map((draft) => ({ kind: draft.kind, payload: draft.payload })),
    );
  const allDrafts = () =>
    [...agents.delegated.map((delegation) => delegation.childThreadId), rigThreadId].flatMap(
      (threadId) => t.records.events(threadId),
    );
  const reader = foldReader(foldedEvents);
  const values = new Map<string, unknown>(Object.entries(options.settings ?? {}));
  const tools = new Map<string, ToolResourceDef>();
  const control = { settingsDown: false, waitSettled: true };
  const module = createLearningGroup({
    clock,
    reader,
    bridge,
    report: (report, invocationId) => {
      reports.push(report);
      reportOf.set(invocationId, report);
    },
  });
  await t.host.registerPlatform({
    name: "learning-ports",
    setup(ctx) {
      ctx.providePort(AgentServicePortKey, agents);
      ctx.providePort(GroupSettingsSourceKey, {
        value: (key) => {
          if (control.settingsDown) throw new Error("the settings store is down");
          return values.get(key);
        },
      });
      // L1.tools의 등록 면 대역: 등록한 도구 정의를 모아 시험이 execute를 직접 부른다
      ctx.providePort(ToolsPortKey, {
        register(_owner, def) {
          tools.set(def.name, def);
          return ok(() => {
            tools.delete(def.name);
          });
        },
      });
    },
  });
  await t.host.install(knowledge.unit(0));
  const rigThread = rigThreadId;
  let installIssues: readonly { readonly severity: string; readonly code: string }[] = [];
  if (options.skipInstall !== true) {
    const installed = await t.host.install({
      manifest: module.manifest,
      entry: module.entry,
      loadIndex: 1,
      builtin: true,
    });
    installIssues = installed.issues;
    const failed = installed.setups.find((setup) => setup.status === "failed");
    if (failed !== undefined || installed.entryError !== undefined) {
      throw new Error(
        `learning failed to start: ${String(failed?.failure?.error ?? installed.entryError)}`,
      );
    }
    await t.host.openThread(rigThread);
    await t.settled();
  }
  const toolDef = (): ToolResourceDef => {
    const found = tools.get("learning_propose");
    if (found === undefined) throw new Error("learning_propose is not registered");
    return found;
  };
  return {
    t,
    thread: rigThread,
    agents,
    knowledge,
    reader,
    bridge,
    clock,
    reports,
    module,
    values,
    control,
    installIssues,
    async disable() {
      t.host.scope("learning")?.disable();
      await t.boundary(rigThread).turnSettled();
      await t.settled();
    },
    async enable() {
      t.host.scope("learning")?.enable();
      await t.boundary(rigThread).turnSettled();
      await t.settled();
    },
    state() {
      const last = t.records
        .events(rigThread)
        .findLast((draft) => draft.kind === "grp.learning.state.committed");
      const parsed = parse(CommittedSchema, last?.payload);
      return parsed.ok ? parsed.value.doc : INITIAL_LEARNING_STATE;
    },
    commits: () =>
      t.records.events(rigThread).filter((draft) => draft.kind === "grp.learning.state.committed")
        .length,
    payloads: (kind) =>
      allDrafts()
        .filter((draft) => draft.kind === kind)
        .map((draft) => {
          const payload: unknown = draft.payload;
          const isEnvelope =
            typeof payload === "object" &&
            payload !== null &&
            "groupId" in payload &&
            "payload" in payload;
          return isEnvelope ? payload.payload : payload;
        }),
    events: (kind) => allDrafts().filter((draft) => draft.kind === kind),
    async turn(spec = {}) {
      counter += 1;
      const turnId = spec.turnId ?? t.ids.next("trn");
      const lastItemId = spec.lastItemId === undefined ? t.ids.next("itm") : spec.lastItemId;
      const key = spec.key ?? `turn:${String(counter)}`;
      await t.host.dispatch(
        "boundary.turn.before",
        { turnId, ...(spec.origin === undefined ? {} : { origin: spec.origin }) },
        { threadId: rigThread, dispatchKey: `${key}:before` },
      );
      const steps = spec.toolSteps ?? 0;
      for (let step = 0; step < steps; step += 1) {
        const results = Array.from({ length: spec.toolsPerStep ?? 1 }, (_, n) =>
          toolResult(spec.toolName ?? "read", n),
        );
        // eslint-disable-next-line no-await-in-loop -- step은 차례로 끝난다
        await t.host.dispatch(
          "boundary.step.after",
          {
            stepIndex: step,
            stepId: spec.stepIds?.[step] ?? t.ids.next("stp"),
            message: assistantStop,
            toolResults: results,
            messageItemId: t.ids.next("itm"),
            toolResultItemIds: results.map(() => t.ids.next("itm")),
            context: {
              contextMessages: [userText, assistantStop],
              llmMessages: [userText],
              pendingMessages: [],
              canContinue: true,
            },
          },
          {
            threadId: rigThread,
            dispatchKey: `${key}:step:${String(step)}`,
            initial: { entries: [], continue: true },
            finalize: (value) => value,
          },
        );
      }
      await t.host.dispatch(
        "boundary.settle.after",
        {
          turnId,
          aborted: spec.status === "aborted",
          ...(spec.origin === undefined ? {} : { origin: spec.origin }),
          ...(spec.status === undefined ? {} : { status: spec.status }),
          ...(spec.hasFinalAnswer === undefined ? {} : { hasFinalAnswer: spec.hasFinalAnswer }),
          ...(lastItemId === null ? {} : { lastItemId }),
        },
        { threadId: rigThread, dispatchKey: `${key}:settle` },
      );
      if (spec.settle !== false && control.waitSettled) await t.settled();
      return lastItemId ?? t.ids.next("itm");
    },
    async settle(requestId, status = "completed", extra = {}) {
      const payload = agents.settle(rigThread, requestId, status);
      if (payload === undefined) return undefined;
      const merged: AgentSettledEventPayload = { ...payload, ...extra };
      await t.host.dispatch("lifecycle.agent.settled", merged, {
        threadId: rigThread,
        dispatchKey: `settled:${requestId}:${status}`,
        ...(merged.owner?.kind === "scope" ? { onlyScope: merged.owner.scopeId } : {}),
      });
      if (control.waitSettled) await t.settled();
      return merged;
    },
    tool: toolDef,
    foldedEvents,
    async command(args, threadId = rigThread) {
      const found = t.host.resources.list("command").find((record) => record.name === "learning");
      if (found === undefined) throw new Error("/learning is not registered");
      const def: unknown = found.def;
      if (!isCommandDef(def)) throw new Error("registered command is not a CommandResourceDef");
      commandCounter += 1;
      const invocationId = `cmd_${String(commandCounter)}`;
      await def.handler(args, { threadId, invocationId });
      const report = reportOf.get(invocationId);
      if (report === undefined) throw new Error("the command reported nothing");
      return report;
    },
  };
}

let commandCounter = 0;

interface CommandDef {
  handler(
    args: string,
    ctx: { readonly threadId: ThreadId | null; readonly invocationId: string },
  ): Promise<void>;
}

function isCommandDef(value: unknown): value is CommandDef {
  return typeof value === "object" && value !== null && "handler" in value;
}

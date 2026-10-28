import {
  CapabilityError,
  KnowledgeMemory,
  KnowledgeMemoryKey,
  KnowledgeSearch,
  KnowledgeSearchKey,
  KnowledgeSkills,
  WebFetch,
  WebSearch,
  WebSearchKey,
  WorkTasks,
  WorkTasksKey,
  type CallOptions,
  type CapabilityApi,
  type ServiceKey,
} from "@xeon/contracts/capabilities";
import type { IdFactory, ThreadId, TurnId } from "@xeon/contracts/conversation";
import type {
  ExtensionManifest,
  LoopSpawnRequest,
  LoopTurnRequest,
} from "@xeon/contracts/extensions";
import {
  capabilityDefTable,
  hostOf,
  type CapabilityDefLookup,
  type ExtensionUnit,
  type PayloadOf,
} from "@xeon/ext-host";
import {
  createTestHost,
  fakeUsage,
  fixedIdFactory,
  type MemoryLoopOptions,
  type TestHost,
  type TestHostOptions,
} from "@xeon/ext-host/testing";
import { GroupSettingsSourceKey, type GroupModule } from "@xeon/group-kit";
import { helmBuiltinGroup, helmGroup } from "../../src/index.ts";
import { fakeService } from "./unsafe.ts";

export const DEFS: CapabilityDefLookup = capabilityDefTable([
  WebSearch,
  WebFetch,
  KnowledgeSearch,
  KnowledgeMemory,
  KnowledgeSkills,
  WorkTasks,
]);

/** 렌즈 id로 explorer 답을 정한다. 문자열이면 completed, ERROR·ABORTED 표지면 그 상태 */
export type LensAnswers = Readonly<Record<string, string>>;
export const ERROR = "@error";
export const ABORTED = "@aborted";

function report(claim: string, followUp?: string): string {
  const finding = {
    claim,
    sources: [{ origin: "web", ref: `https://example.test/${encodeURIComponent(claim)}` }],
    confidence: "medium",
    ...(followUp === undefined ? {} : { followUp }),
  };
  return `\`\`\`json\n${JSON.stringify({ findings: [finding] })}\n\`\`\``;
}

/** 렌즈마다 발견 하나를 내는 기본 답. followUp은 처음 두 렌즈에만 둔다 */
export function defaultAnswers(): LensAnswers {
  return {
    analogy: report("면역 기억을 닮은 재검증", "재검증 정책 초안 쓰기"),
    "prior-art": report("선행 사례: 버전 태그 캐시", "버전 태그 사례 정리"),
    "first-principles": report("전제: 무효화는 일관성 비용이다"),
    "failure-modes": report("실패: 오래된 항목 서빙"),
    inversion: report("반대로: 절대 무효화하지 않으면"),
    constraints: report("제약: 메모리 한도 절반"),
  };
}

interface Counting {
  calls: number;
  readonly requestIds: (string | undefined)[];
}

interface Fakes {
  readonly web: Counting;
  readonly knowledge: Counting;
  readonly memory: Counting;
  /** 새로 만든 작업(같은 requestId의 두 번째 호출은 처음 결과를 돌려준다) */
  readonly tasks: { readonly created: string[]; calls: number };
}

export interface WorldOptions {
  /** web.search를 이 코드로 실패시킨다 */
  readonly webError?: string;
}

/** 가짜 능력 서비스와 계수기. 재시작을 흉내 내는 시험은 한 세계를 여러 호스트가 나눠 쓴다(멱등 기억이 이어진다) */
export interface World {
  readonly fakes: Fakes;
  /** 시험이 프로세스 강제 종료를 흉내 내는 지점. 그 번째 호출이 던진다 */
  readonly hooks: { crashOnTaskCall: number | null };
  readonly services: {
    readonly web: CapabilityApi<typeof WebSearch>;
    readonly knowledge: CapabilityApi<typeof KnowledgeSearch>;
    readonly memory: CapabilityApi<typeof KnowledgeMemory>;
    readonly work: CapabilityApi<typeof WorkTasks>;
  };
}

function webService(fakes: Fakes, webError: string | undefined): CapabilityApi<typeof WebSearch> {
  return fakeService(WebSearchKey, {
    search: (_input: unknown, callOptions?: CallOptions) => {
      fakes.web.calls += 1;
      fakes.web.requestIds.push(callOptions?.requestId);
      if (webError !== undefined) {
        return Promise.reject(
          new CapabilityError({
            capability: "web.search",
            method: "search",
            code: webError,
            message: webError,
            retryable: false,
          }),
        );
      }
      return Promise.resolve({
        results: [
          {
            rank: 1,
            sourceId: "s1",
            url: "https://example.test/cache",
            title: "캐시 문서",
            passages: [],
          },
        ],
        sources: [],
      });
    },
  });
}

function knowledgeService(fakes: Fakes): CapabilityApi<typeof KnowledgeSearch> {
  return fakeService(KnowledgeSearchKey, {
    query: (input: { kinds?: string[] }, callOptions?: CallOptions) => {
      fakes.knowledge.calls += 1;
      fakes.knowledge.requestIds.push(callOptions?.requestId);
      const kind = input.kinds?.[0] ?? "skill";
      return Promise.resolve({
        hits: [{ kind, ref: `${kind}-1`, title: `${kind} 항목`, snippet: "s" }],
        path: "fts",
      });
    },
  });
}

function memoryService(fakes: Fakes): CapabilityApi<typeof KnowledgeMemory> {
  return fakeService(KnowledgeMemoryKey, {
    read: (_input: unknown, callOptions?: CallOptions) => {
      fakes.memory.calls += 1;
      fakes.memory.requestIds.push(callOptions?.requestId);
      return Promise.resolve({ stores: [] });
    },
  });
}

function workService(
  fakes: Fakes,
  hooks: { crashOnTaskCall: number | null },
): CapabilityApi<typeof WorkTasks> {
  const byRequest = new Map<string, string>();
  return fakeService(WorkTasksKey, {
    create: (input: { content: string }, callOptions: CallOptions) => {
      fakes.tasks.calls += 1;
      if (hooks.crashOnTaskCall === fakes.tasks.calls) throw new TypeError("simulated crash");
      const requestId = callOptions.requestId ?? "";
      let id = byRequest.get(requestId);
      if (id === undefined) {
        id = `t${String(fakes.tasks.created.length + 1)}`;
        byRequest.set(requestId, id);
        fakes.tasks.created.push(input.content);
      }
      return Promise.resolve({ task: { id } });
    },
  });
}

export function createWorld(options: WorldOptions = {}): World {
  const fakes: Fakes = {
    web: { calls: 0, requestIds: [] },
    knowledge: { calls: 0, requestIds: [] },
    memory: { calls: 0, requestIds: [] },
    tasks: { created: [], calls: 0 },
  };
  const hooks: { crashOnTaskCall: number | null } = { crashOnTaskCall: null };
  return {
    fakes,
    hooks,
    services: {
      web: webService(fakes, options.webError),
      knowledge: knowledgeService(fakes),
      memory: memoryService(fakes),
      work: workService(fakes, hooks),
    },
  };
}

function providerUnit<Api>(
  name: string,
  capability: string,
  key: ServiceKey<Api>,
  service: Api,
  loadIndex: number,
): ExtensionUnit {
  const manifest: ExtensionManifest = {
    schemaVersion: 1,
    name,
    version: "0.1.0",
    layer: "plugin",
    kind: "plugin",
    entry: "./src/index.ts",
    points: [],
    usesDrive: false,
    provides: [{ id: capability, version: "1.0.0" }],
  };
  return {
    manifest,
    entry: ({ scope }) => {
      scope(name, {}, (g) => {
        hostOf(g).provide(key, service);
      });
    },
    loadIndex,
    builtin: true,
  };
}

export type Provided = "web" | "knowledge" | "memory" | "work";

/** 세계의 능력 공급자를 호스트에 올린다. 다음 loadIndex를 돌려준다 */
export async function installWorld(
  t: TestHost,
  world: World,
  without: readonly Provided[] = [],
): Promise<number> {
  const skip = new Set(without);
  const units: readonly (readonly [Provided, ExtensionUnit])[] = [
    ["web", providerUnit("fake-web", "web.search", WebSearchKey, world.services.web, 0)],
    [
      "knowledge",
      providerUnit(
        "fake-knowledge",
        "knowledge.search",
        KnowledgeSearchKey,
        world.services.knowledge,
        1,
      ),
    ],
    [
      "memory",
      providerUnit("fake-memory", "knowledge.memory", KnowledgeMemoryKey, world.services.memory, 2),
    ],
    ["work", providerUnit("fake-work", "work.tasks", WorkTasksKey, world.services.work, 3)],
  ];
  const installed = units.filter(([name]) => !skip.has(name));
  await Promise.all(installed.map(([, unit]) => t.host.install(unit)));
  return units.length;
}

function lensOf(request: LoopSpawnRequest): string {
  return request.requestId.split(":")[4] ?? "";
}

/** turn은 곧바로 completed, spawn은 렌즈별 답표를 따른다 */
export function scriptedLoop(
  ids: IdFactory,
  answers: LensAnswers,
  onTurn?: (request: LoopTurnRequest) => void,
): MemoryLoopOptions {
  return {
    runTurn: (request) => {
      onTurn?.(request);
      return Promise.resolve({
        outcome: { turnId: ids.next("trn"), status: "completed" },
        usage: fakeUsage(10),
      });
    },
    runSpawn: (request) => {
      const answer = answers[lensOf(request)];
      const childThreadId = ids.next("thr");
      const outcome =
        answer === undefined || answer === ERROR
          ? { childThreadId, status: "error" as const }
          : answer === ABORTED
            ? { childThreadId, status: "aborted" as const }
            : { childThreadId, status: "completed" as const, answer };
      return Promise.resolve({ outcome, usage: fakeUsage(5) });
    },
  };
}

export interface RigOptions extends WorldOptions {
  readonly answers?: LensAnswers;
  readonly host?: TestHostOptions;
  /** 제공하지 않을 능력 */
  readonly without?: readonly Provided[];
  /** 설정 `l3.helm.*` 값. 주면 내장 신뢰판 그룹으로 올려 g.settings()가 이 값을 읽는다 */
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly module?: GroupModule;
  /** 시험이 turn 하나를 더 가로챈다 */
  readonly onTurn?: (request: LoopTurnRequest) => void;
}

export interface Rig {
  readonly t: TestHost;
  readonly thread: ThreadId;
  readonly fakes: Fakes;
  /** /helm 명령 처리기를 부른다 */
  command(args: string): Promise<void>;
  /** boundary.settle.after를 한 번 발화한다 */
  settle(key: string, turnId?: TurnId): Promise<void>;
  /** 경계를 돌려 drive가 다시 불리게 한다 */
  drain(rounds?: number, kind?: BoundaryKind): Promise<void>;
  /** 한 번의 /helm start → 탐구 끝까지 */
  runInquiry(topic: string): Promise<void>;
  kinds(): readonly string[];
  records(kind: string): readonly unknown[];
}

export type BoundaryKind = "turnSettled" | "idle" | "stepEnd";

/** 경계를 차례로 돌린다. turnSettled는 drive를 다시 부르고, idle·stepEnd는 켜기·끄기 요청을 적용한다 */
export async function drainRounds(
  t: TestHost,
  thread: ThreadId,
  rounds: number,
  kind: BoundaryKind = "turnSettled",
): Promise<void> {
  if (rounds <= 0) return;
  await t.boundary(thread)[kind]();
  await t.settled();
  await drainRounds(t, thread, rounds - 1, kind);
}

/** 설정 읽기 포트를 호스트에 올린다 */
async function provideSettings(
  t: TestHost,
  values: Readonly<Record<string, unknown>>,
): Promise<void> {
  await t.host.registerPlatform({
    name: "test-settings",
    setup(ctx) {
      ctx.providePort(GroupSettingsSourceKey, { value: (key) => values[key] });
    },
  });
}

/** 등록된 /helm 명령 처리기를 부른다 */
export async function callCommand(t: TestHost, thread: ThreadId, args: string): Promise<void> {
  const def: unknown = t.host.resources.list("command").find((entry) => entry.name === "helm")?.def;
  if (typeof def !== "object" || def === null || !("handler" in def)) {
    throw new Error("the helm command is not registered");
  }
  const handler: unknown = def.handler;
  if (typeof handler !== "function") throw new Error("the helm command has no handler");
  const done: unknown = Reflect.apply(handler, def, [args, { threadId: thread }]);
  await done;
}

export function settleOnce(
  t: TestHost,
  thread: ThreadId,
  key: string,
  turnId?: TurnId,
): Promise<unknown> {
  const payload: PayloadOf<"boundary.settle.after"> = {
    turnId: turnId ?? t.ids.next("trn"),
    aborted: false,
  };
  return t.host.dispatch("boundary.settle.after", payload, { threadId: thread, dispatchKey: key });
}

export async function createRig(options: RigOptions = {}): Promise<Rig> {
  const world = createWorld(options);
  const t = await createTestHost({
    capabilityDefs: DEFS,
    ...options.host,
    loop: scriptedLoop(fixedIdFactory(9000), options.answers ?? defaultAnswers(), options.onTurn),
  });
  const loadIndex = await installWorld(t, world, options.without);
  const values = options.settings;
  if (values !== undefined) await provideSettings(t, values);
  const module = options.module ?? (values === undefined ? helmGroup : helmBuiltinGroup);
  await t.host.install({
    manifest: module.manifest,
    entry: module.entry,
    loadIndex,
    builtin: true,
  });
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();

  const rig: Rig = {
    t,
    thread,
    fakes: world.fakes,
    command: (args) => callCommand(t, thread, args),
    async settle(key, turnId) {
      await settleOnce(t, thread, key, turnId);
    },
    drain: (rounds = 8, kind = "turnSettled") => drainRounds(t, thread, rounds, kind),
    async runInquiry(topic) {
      await rig.command(`start ${topic}`);
      await rig.settle("start");
      await rig.drain();
    },
    kinds() {
      return t.records.events(thread).map((event) => event.kind);
    },
    records(kind) {
      return t.records
        .events(thread)
        .filter((event) => event.kind === kind)
        .map((event) => {
          const wrapped: unknown = event.payload;
          return typeof wrapped === "object" && wrapped !== null && "payload" in wrapped
            ? wrapped.payload
            : wrapped;
        });
    },
  };
  return rig;
}

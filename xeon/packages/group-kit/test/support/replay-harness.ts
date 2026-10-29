import { canonicalJson } from "@xeon/contracts";
import { toJsonValue, type JsonValue, type ThreadId } from "@xeon/contracts/conversation";
import type { DurableEventDraft } from "@xeon/contracts/records";
import { AgentServicePortKey } from "@xeon/contracts/services";
import {
  createTestHost,
  memoryInputQueue,
  memoryLoopPort,
  type MemoryInputQueue,
  type MemoryLoopPort,
  type TestHost,
} from "@xeon/ext-host/testing";
import type { GroupModule } from "../../src/index.ts";
import { fakeAgents, type FakeAgents, type ReplayHarness } from "../../src/testing/index.ts";
import { install } from "./host.ts";

/** 효과 계수 하니스. 가짜 포트(루프, 입력 큐, 위임 서비스)가 기준 실행과 절단 실행 사이에 멱등 기억을 이어 쓴다 */
export interface CountingReplayHarness extends ReplayHarness {
  /** 지금 실행 중인 가짜 위임 서비스. 그룹이 delegate에 넣는 접근이 읽는다 */
  agents(): FakeAgents | undefined;
  /** 지금 실행 중인 thread */
  thread(): ThreadId | undefined;
}

interface SharedPorts {
  readonly loop: MemoryLoopPort;
  readonly queue: MemoryInputQueue;
  readonly agents: FakeAgents;
}

/** F ID 형식: `<접두 3자>_<ULID 26자>` */
const ID_PATTERN = /^[a-z]{3}_[0-9A-Z]{26}$/;
const DRAIN_ROUNDS = 6;

/**
 * 실행마다 쓴 thread id가 첫 실행(기준 실행)과 같은지 본다. 다른 실행의 번호(0부터)를 돌려준다. 모두 같으면 빈 배열.
 * `normalizeIds`는 ID를 자리표시자로 바꾸므로 thread id가 달라도 이벤트열 비교로는 보이지 않는다. 그래서 따로 본다.
 */
export function threadMismatches(threads: readonly string[]): readonly number[] {
  const [baseline] = threads;
  return threads.flatMap((thread, index) => (thread === baseline ? [] : [index]));
}

/** 이벤트의 ID를 처음 나온 순서의 자리표시자로 바꿔 호스트마다 다른 ID 범위를 지운다 */
function normalizeIds(events: readonly JsonValue[]): JsonValue[] {
  const seen = new Map<string, string>();
  const visit = (value: JsonValue): JsonValue => {
    if (typeof value === "string") {
      if (!ID_PATTERN.test(value)) return value;
      const known = seen.get(value);
      if (known !== undefined) return known;
      const placeholder = `${value.slice(0, 3)}#${seen.size + 1}`;
      seen.set(value, placeholder);
      return placeholder;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, visit(member)]));
    }
    return value;
  };
  return events.map(visit);
}

function isEventOfKind(event: JsonValue, kind: string): boolean {
  if (typeof event !== "object" || event === null || Array.isArray(event)) return false;
  const found: unknown = Reflect.get(event, "kind");
  return found === kind;
}

/** 커밋 지점: 그룹 상태 커밋(`grp.<이름>.state.committed`) 이벤트 바로 뒤의 이벤트 수 */
function commitPointsOf(events: readonly JsonValue[], groupName: string): number[] {
  const kind = `grp.${groupName}.state.committed`;
  return events.flatMap((event, index) => (isEventOfKind(event, kind) ? [index + 1] : []));
}

async function commitSeed(
  t: TestHost,
  thread: ReturnType<TestHost["newThread"]>,
  drafts: readonly DurableEventDraft[],
  index = 0,
): Promise<void> {
  const [first, ...rest] = drafts;
  if (first === undefined) return;
  await t.records.commit({ threadId: thread, requestId: `seed:${index}`, drafts: [first] });
  await commitSeed(t, thread, rest, index + 1);
}

/** 경계를 정해진 횟수만큼 돌려 drive가 다시 불리게 한다. 호출 횟수가 고정이라 두 실행의 길이가 같다 */
async function drain(t: TestHost, thread: ReturnType<TestHost["newThread"]>, rounds: number) {
  if (rounds <= 0) return;
  await t.boundary(thread).turnSettled();
  await t.settled();
  await drain(t, thread, rounds - 1);
}

/**
 * 테스트 호스트와 인메모리 기록 저장소로 만든 ReplayHarness.
 * 복원은 기준 실행의 앞 커밋 지점까지의 이벤트를 새 저장소에 넣고 호스트를 다시 만든 뒤(`restart`) thread를 여는 것이다.
 */
export function createReplayHarness(): CountingReplayHarness {
  const originals = new WeakMap<object, DurableEventDraft>();
  let shared: SharedPorts | undefined;
  let current: { readonly agents: FakeAgents; readonly thread: ThreadId } | undefined;
  return {
    agents: () => current?.agents,
    thread: () => current?.thread,
    async run(group: GroupModule, restore) {
      // 기준 실행이 새 가짜 포트를 만들고, 절단 실행은 그 포트의 멱등 기억을 이어 쓴다
      if (restore === null || shared === undefined) {
        const loop = memoryLoopPort();
        const queue = memoryInputQueue();
        const idsHost = await createTestHost();
        shared = { loop, queue, agents: fakeAgents({ ids: idsHost.ids }) };
      }
      const ports = shared;
      const before = {
        turn: ports.loop.turns.length,
        spawn: ports.loop.spawns.length,
        post: ports.queue.items.length,
        delegate: ports.agents.delegated.length,
      };
      const first = await createTestHost({ shared: { loop: ports.loop, queue: ports.queue } });
      const thread = first.newThread();
      current = { agents: ports.agents, thread };
      let t = first;
      if (restore !== null) {
        const points = commitPointsOf(restore.events, group.manifest.name);
        const upto = points[restore.commits - 1] ?? 0;
        const drafts = restore.events.slice(0, upto).flatMap((event) => {
          const draft =
            typeof event === "object" && event !== null ? originals.get(event) : undefined;
          return draft === undefined ? [] : [draft];
        });
        await commitSeed(first, thread, drafts);
        t = await first.restart();
      }
      await t.host.registerPlatform({
        name: "replay-agents",
        setup(ctx) {
          ctx.providePort(AgentServicePortKey, ports.agents);
        },
      });
      await install(t, group);
      await t.host.openThread(thread);
      await t.settled();
      await drain(t, thread, DRAIN_ROUNDS);
      const events = t.records.events(thread).map((draft) => {
        const json = toJsonValue(draft);
        if (json === undefined) throw new TypeError(`event ${draft.kind} is not JSON`);
        if (typeof json === "object" && json !== null) originals.set(json, draft);
        return json;
      });
      // 마지막 커밋 뒤의 임대 반납·재부여는 경계를 몇 번 돌렸는지에 따라 길이가 달라지는 X의 꼬리다. 그룹이 정하는 부분은 마지막 커밋까지다
      const commitPoints = commitPointsOf(events, group.manifest.name);
      const end = commitPoints.at(-1) ?? 0;
      return {
        events: events.slice(0, end),
        commitPoints,
        effects: {
          turn: ports.loop.turns.length - before.turn,
          spawn: ports.loop.spawns.length - before.spawn,
          delegate: ports.agents.delegated.length - before.delegate,
          post: ports.queue.items.length - before.post,
        },
      };
    },
    digest: (events) => canonicalJson(normalizeIds(events)),
    firstDiff(a, b) {
      const left = normalizeIds(a).map((event) => canonicalJson(event));
      const right = normalizeIds(b).map((event) => canonicalJson(event));
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) {
        if (left[index] !== right[index]) return index;
      }
      return null;
    },
  };
}

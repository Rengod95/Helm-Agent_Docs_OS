import { canonicalJson } from "@xeon/contracts";
import { toJsonValue, type JsonValue } from "@xeon/contracts/conversation";
import type { DurableEventDraft } from "@xeon/contracts/records";
import {
  createTestHost,
  fixedIdFactory,
  memoryInputQueue,
  memoryLoopPort,
  type MemoryInputQueue,
  type MemoryLoopPort,
  type TestHost,
} from "@xeon/ext-host/testing";
import type { GroupModule } from "@xeon/group-kit";
import type { ReplayHarness } from "@xeon/group-kit/testing";
import {
  DEFS,
  callCommand,
  createWorld,
  defaultAnswers,
  drainRounds,
  installWorld,
  scriptedLoop,
  settleOnce,
  type LensAnswers,
  type World,
} from "./rig.ts";

interface Shared {
  readonly loop: MemoryLoopPort;
  readonly queue: MemoryInputQueue;
  readonly world: World;
}

const ID_PATTERN = /^[a-z]{3}_[0-9A-Z]{26}$/;
const DRAIN_ROUNDS = 8;

/** 이벤트의 ID를 처음 나온 순서의 자리표시자로 바꿔 호스트마다 다른 ID 범위를 지운다 */
function normalizeIds(events: readonly JsonValue[]): JsonValue[] {
  const seen = new Map<string, string>();
  const visit = (value: JsonValue): JsonValue => {
    if (typeof value === "string") {
      if (!ID_PATTERN.test(value)) return value;
      const known = seen.get(value);
      if (known !== undefined) return known;
      const placeholder = `${value.slice(0, 3)}#${String(seen.size + 1)}`;
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

function kindOf(event: JsonValue): unknown {
  const record: unknown = event;
  return typeof record === "object" && record !== null && "kind" in record
    ? record.kind
    : undefined;
}

function commitPointsOf(events: readonly JsonValue[], groupName: string): number[] {
  const kind = `grp.${groupName}.state.committed`;
  return events.flatMap((event, index) => (kindOf(event) === kind ? [index + 1] : []));
}

async function seed(
  t: TestHost,
  thread: ReturnType<TestHost["newThread"]>,
  drafts: readonly DurableEventDraft[],
  index = 0,
): Promise<void> {
  const [first, ...rest] = drafts;
  if (first === undefined) return;
  await t.records.commit({ threadId: thread, requestId: `seed:${String(index)}`, drafts: [first] });
  await seed(t, thread, rest, index + 1);
}

export interface HelmReplay {
  readonly harness: ReplayHarness;
  /** 마지막으로 돌린 세계. 가짜 능력의 호출 수를 읽는다 */
  world(): World | undefined;
}

/**
 * Helm용 효과 계수 하니스(L3.group-kit.plan G-20). 기준 실행은 `/helm start`로 시작하고, 절단 실행은 복원한 이벤트에서 이어 간다.
 * 가짜 루프·큐·능력 세계가 기준 실행과 절단 실행 사이에 멱등 기억을 이어 쓴다. 명령 응답 알림은 drive 효과가 아니라 세지 않는다
 */
export function createHelmReplay(
  options: { readonly answers?: LensAnswers; readonly topic?: string } = {},
): HelmReplay {
  const originals = new WeakMap<object, DurableEventDraft>();
  let shared: Shared | undefined;
  const answers = options.answers ?? defaultAnswers();
  const topic = options.topic ?? "캐시 무효화";
  const harness: ReplayHarness = {
    async run(group: GroupModule, restore) {
      if (restore === null || shared === undefined) {
        shared = {
          loop: memoryLoopPort(scriptedLoop(fixedIdFactory(9000), answers)),
          queue: memoryInputQueue(),
          world: createWorld(),
        };
      }
      const ports = shared;
      const driveItems = (): number =>
        ports.queue.items.filter((item) => !item.requestId.startsWith("helm:cmd:")).length;
      const before = {
        turn: ports.loop.turns.length,
        spawn: ports.loop.spawns.length,
        post: driveItems(),
        tasks: ports.world.fakes.tasks.created.length,
      };
      const first = await createTestHost({
        capabilityDefs: DEFS,
        shared: { loop: ports.loop, queue: ports.queue },
      });
      const thread = first.newThread();
      let t = first;
      if (restore !== null) {
        const points = commitPointsOf(restore.events, group.manifest.name);
        const upto = points[restore.commits - 1] ?? 0;
        const drafts = restore.events.slice(0, upto).flatMap((event) => {
          const draft =
            typeof event === "object" && event !== null ? originals.get(event) : undefined;
          return draft === undefined ? [] : [draft];
        });
        await seed(first, thread, drafts);
        t = await first.restart();
      }
      const loadIndex = await installWorld(t, ports.world);
      await t.host.install({
        manifest: group.manifest,
        entry: group.entry,
        loadIndex,
        builtin: true,
      });
      await t.host.openThread(thread);
      await t.settled();
      if (restore === null) {
        await callCommand(t, thread, `start ${topic}`);
        await settleOnce(t, thread, "start");
      }
      await drainRounds(t, thread, DRAIN_ROUNDS);
      const events = t.records.events(thread).map((draft) => {
        const json = toJsonValue(draft);
        if (json === undefined) throw new TypeError(`event ${draft.kind} is not JSON`);
        if (typeof json === "object" && json !== null) originals.set(json, draft);
        return json;
      });
      const commitPoints = commitPointsOf(events, group.manifest.name);
      const end = commitPoints.at(-1) ?? 0;
      return {
        events: events.slice(0, end),
        commitPoints,
        effects: {
          turn: ports.loop.turns.length - before.turn,
          spawn: ports.loop.spawns.length - before.spawn,
          delegate: 0,
          capabilityWrite: ports.world.fakes.tasks.created.length - before.tasks,
          post: driveItems() - before.post,
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
  return { harness, world: () => shared?.world };
}

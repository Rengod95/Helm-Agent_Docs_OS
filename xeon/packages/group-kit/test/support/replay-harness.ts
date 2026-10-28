import { canonicalJson } from "@xeon/contracts";
import { toJsonValue, type JsonValue } from "@xeon/contracts/conversation";
import type { DurableEventDraft } from "@xeon/contracts/records";
import { createTestHost, type TestHost } from "@xeon/ext-host/testing";
import type { GroupModule } from "../../src/index.ts";
import type { ReplayHarness } from "../../src/testing/index.ts";
import { install } from "./host.ts";

/** F ID 형식: `<접두 3자>_<ULID 26자>` */
const ID_PATTERN = /^[a-z]{3}_[0-9A-Z]{26}$/;
const DRAIN_ROUNDS = 6;

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
export function createReplayHarness(): ReplayHarness {
  const originals = new WeakMap<object, DurableEventDraft>();
  return {
    async run(group: GroupModule, restore) {
      const first = await createTestHost();
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
        await commitSeed(first, thread, drafts);
        t = await first.restart();
      }
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
      return { events: events.slice(0, end), commitPoints };
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

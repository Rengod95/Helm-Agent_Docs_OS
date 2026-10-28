import { canonicalJson, ok } from "@xeon/contracts";
import {
  toJsonValue,
  type ItemId,
  type JsonValue,
  type ThreadId,
  type TurnId,
} from "@xeon/contracts/conversation";
import { ToolsPortKey, type ExtCommitRequest } from "@xeon/contracts/extensions";
import type { DurableEventDraft } from "@xeon/contracts/records";
import { AgentServicePortKey } from "@xeon/contracts/services";
import {
  createTestHost,
  memoryInputQueue,
  memoryLoopPort,
  memoryRecordStore,
  type MemoryRecordStore,
  type TestHost,
} from "@xeon/ext-host/testing";
import { GroupSettingsSourceKey, type GroupModule } from "@xeon/group-kit";
import {
  fakeAgents,
  type EffectCounts,
  type FakeAgents,
  type ReplayHarness,
} from "@xeon/group-kit/testing";
import type { LearningQueueReader } from "../../src/index.ts";
import { foldReader } from "./projection.ts";
import { fakeKnowledge, type FakeKnowledge } from "./fake-knowledge.ts";

// ADR-0015 재생 시험의 하니스(L3.learning.plan LR-25). group-kit의 재생 하니스는 drive 그룹을 경계 반복으로 돌리므로, on 핸들러 그룹용으로
// 정해진 지점 발화 순서(스크립트)를 다시 돌린다. 복원은 기준 실행의 커밋 요청을 원래 `requestId`와 함께 앞부분만 다시 커밋한다:
// 그래야 재발화한 핸들러의 기록과 커밋이 멱등 키로 한 번만 반영된다.

const ID_PATTERN = /^[a-z]{3}_[0-9A-Z]{26}$/;

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

function isEventOfKind(event: JsonValue, kind: string): boolean {
  if (typeof event !== "object" || event === null || Array.isArray(event)) return false;
  return Object.entries(event).some(([key, value]) => key === "kind" && value === kind);
}

/** 커밋 지점: 그룹 상태 커밋 이벤트 바로 뒤의 이벤트 수 */
function commitPointsOf(events: readonly JsonValue[]): number[] {
  return events.flatMap((event, index) =>
    isEventOfKind(event, "grp.learning.state.committed") ? [index + 1] : [],
  );
}

/** 커밋 요청을 기록하는 기록 저장소 */
function loggedRecords(store: MemoryRecordStore, log: ExtCommitRequest[]): MemoryRecordStore {
  return {
    ...store,
    commit(request) {
      log.push(request);
      return store.commit(request);
    },
  };
}

/** 지점 하나를 발화하는 단계. 키는 실행마다 같다 */
type ReplayStep = (t: TestHost, thread: ThreadId, agents: FakeAgents) => Promise<void>;

/**
 * 정해진 순서의 단계. 복원 뒤에는 끊은 커밋을 낸 단계부터 다시 발화한다: 앞선 단계는 끝났고, 그 단계는 커밋이 남은 뒤에 재발화하는 최악의 경우이며,
 * 뒤 단계는 처음 실행된다. (재개 때 다시 발화하는 것은 진행 중이던 지점뿐이다.)
 */
export type ReplayScript = readonly ReplayStep[];

interface Shared {
  readonly loop: ReturnType<typeof memoryLoopPort>;
  readonly queue: ReturnType<typeof memoryInputQueue>;
  readonly agents: FakeAgents;
  readonly knowledge: FakeKnowledge;
}

export interface LearningReplayHarness extends ReplayHarness {
  /** 지금 실행 중인 호스트의 기록을 접어 읽는 대기열 읽기 면. 그룹을 이 면으로 만든다 */
  readonly reader: LearningQueueReader;
  readonly diagnostics: () => readonly string[];
  readonly knowledge: () => FakeKnowledge | undefined;
}

export function createLearningReplayHarness(
  settings: Readonly<Record<string, unknown>>,
  script: ReplayScript,
): LearningReplayHarness {
  const originals = new WeakMap<object, DurableEventDraft>();
  let shared: Shared | undefined;
  let baselineLog: readonly ExtCommitRequest[] = [];
  let lastDiagnostics: readonly string[] = [];
  let current:
    | { readonly t: TestHost; readonly thread: ThreadId; readonly agents: FakeAgents }
    | undefined;
  const reader = foldReader(() => {
    if (current === undefined) return [];
    const { t, thread, agents } = current;
    return [...agents.delegated.map((delegation) => delegation.childThreadId), thread].flatMap(
      (threadId) =>
        t.records
          .events(threadId)
          .filter((draft) => draft.kind.startsWith("grp.learning."))
          .map((draft) => ({ kind: draft.kind, payload: draft.payload })),
    );
  });
  /** 기준 실행에서 i번째 상태 커밋을 낸 단계의 번호 */
  let commitStepOf: readonly number[] = [];
  return {
    reader,
    diagnostics: () => lastDiagnostics,
    knowledge: () => shared?.knowledge,
    async run(group: GroupModule, restore) {
      if (restore === null || shared === undefined) {
        const idsHost = await createTestHost();
        shared = {
          loop: memoryLoopPort(),
          queue: memoryInputQueue(),
          agents: fakeAgents({ ids: idsHost.ids }),
          knowledge: fakeKnowledge(),
        };
      }
      const ports = shared;
      const before = {
        turn: ports.loop.turns.length,
        spawn: ports.loop.spawns.length,
        post: ports.queue.items.length,
        delegate: ports.agents.delegated.length,
        capabilityWrite: ports.knowledge.effects(),
      };
      const log: ExtCommitRequest[] = [];
      const records = loggedRecords(memoryRecordStore(), log);
      const first = await createTestHost({
        shared: { loop: ports.loop, queue: ports.queue, records },
      });
      const thread = first.newThread();
      let t = first;
      if (restore !== null) {
        const points = commitPointsOf(restore.events);
        const upto = points[restore.commits - 1] ?? 0;
        const kept = new Set<DurableEventDraft>(
          restore.events.slice(0, upto).flatMap((event) => {
            const draft =
              typeof event === "object" && event !== null ? originals.get(event) : undefined;
            return draft === undefined ? [] : [draft];
          }),
        );
        const requests = baselineLog.filter(
          (request) =>
            request.drafts.length > 0 && request.drafts.every((draft) => kept.has(draft)),
        );
        await requests.reduce<Promise<unknown>>(async (previous, request) => {
          await previous;
          return records.commit({ ...request, threadId: thread });
        }, Promise.resolve());
        t = await first.restart();
      }
      await t.host.registerPlatform({
        name: "replay-ports",
        setup(ctx) {
          ctx.providePort(AgentServicePortKey, ports.agents);
          ctx.providePort(GroupSettingsSourceKey, { value: (key) => settings[key] });
          ctx.providePort(ToolsPortKey, { register: () => ok(() => {}) });
        },
      });
      await t.host.install(ports.knowledge.unit(0));
      await t.host.install({
        manifest: group.manifest,
        entry: group.entry,
        loadIndex: 1,
        builtin: true,
      });
      current = { t, thread, agents: ports.agents };
      await t.host.openThread(thread);
      await t.settled();
      const stateCommits = (): number =>
        t.records.events(thread).filter((draft) => draft.kind === "grp.learning.state.committed")
          .length;
      const resumeFrom = restore === null ? 0 : (commitStepOf[restore.commits - 1] ?? 0);
      const stepOfCommit: number[] = [];
      await script.slice(resumeFrom).reduce<Promise<unknown>>(async (previous, step, offset) => {
        await previous;
        await step(t, thread, ports.agents);
        await t.settled();
        while (stepOfCommit.length < stateCommits()) stepOfCommit.push(resumeFrom + offset);
        return undefined;
      }, Promise.resolve());
      if (restore === null) commitStepOf = stepOfCommit;
      lastDiagnostics = t.diagnostics.map(
        (entry) => `${entry.level} ${entry.code} ${entry.message}`,
      );
      const events = t.records.events(thread).map((draft) => {
        const json = toJsonValue(draft);
        if (json === undefined) throw new TypeError(`event ${draft.kind} is not JSON`);
        if (typeof json === "object" && json !== null) originals.set(json, draft);
        return json;
      });
      if (restore === null) {
        // 기준 실행의 요청: 초안 객체가 저장소의 것과 같아야 복원 때 대응한다
        const stored = new Map(t.records.events(thread).map((draft) => [draft.id, draft]));
        const mapped: ExtCommitRequest[] = [];
        for (const request of log) {
          mapped.push({
            ...request,
            drafts: request.drafts.map((draft) => stored.get(draft.id) ?? draft),
          });
        }
        baselineLog = mapped;
      }
      // 마지막 커밋 뒤의 꼬리(임대 반납 등)는 그룹이 정하지 않는다. 마지막 상태 커밋까지만 비교한다
      const commitPoints = commitPointsOf(events);
      const end = commitPoints.at(-1) ?? 0;
      const effects: EffectCounts = {
        turn: ports.loop.turns.length - before.turn,
        spawn: ports.loop.spawns.length - before.spawn,
        delegate: ports.agents.delegated.length - before.delegate,
        capabilityWrite: ports.knowledge.effects() - before.capabilityWrite,
        post: ports.queue.items.length - before.post,
      };
      return { events: events.slice(0, end), commitPoints, effects };
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

/** 스크립트가 쓰는 고정 id: 새 호스트의 발급기는 항상 같은 순서의 값을 내므로 실행마다 같은 turn과 item을 가리킨다 */
export async function scriptIds(): Promise<{ turn(n: number): TurnId; item(n: number): ItemId }> {
  const fresh = await createTestHost();
  const turns = Array.from({ length: 8 }, () => fresh.ids.next("trn"));
  const items = Array.from({ length: 8 }, () => fresh.ids.next("itm"));
  return {
    turn: (n) => turns[n] ?? fresh.ids.next("trn"),
    item: (n) => items[n] ?? fresh.ids.next("itm"),
  };
}

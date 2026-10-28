import { expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  createTestHost,
  fixedIdFactory,
  memoryInputQueue,
  memoryLoopPort,
  type MemoryInputQueue,
  type MemoryLoopPort,
  type TestHost,
} from "@xeon/ext-host/testing";
import { NO_EFFECTS, replayDrive } from "@xeon/group-kit/testing";
import { helmGroup } from "../../src/index.ts";
import { createHelmReplay } from "../support/replay.ts";
import {
  DEFS,
  callCommand,
  createWorld,
  defaultAnswers,
  drainRounds,
  installWorld,
  scriptedLoop,
  settleOnce,
  type World,
} from "../support/rig.ts";

test("drive.recall-from-committed-state-spawns-once", async () => {
  const replay = createHelmReplay();
  const report = await replayDrive({ group: helmGroup, harness: replay.harness });
  expect(report.failure).toBeUndefined();
  expect(report.cuts.every((cut) => cut.equal && cut.firstDiff === null)).toBe(true);
  expect(report.cuts.map((cut) => cut.commitIndex)).toEqual(
    Array.from({ length: report.commits }, (_, index) => index + 1),
  );
  // 모든 커밋 지점에서 끊고 다시 부른 실행은 새 효과를 내지 않는다
  expect(report.cuts.map((cut) => cut.effects)).toEqual(
    Array.from({ length: report.commits }, () => NO_EFFECTS),
  );
  expect(report.ok).toBe(true);
});

test("replay.twice-effects-once: new turns 2, spawns 3, tasks 2, finish notice 1, inquiry.finished 1", async () => {
  const replay = createHelmReplay();
  const report = await replayDrive({
    group: helmGroup,
    harness: replay.harness,
    expectEffects: { turn: 2, spawn: 3, capabilityWrite: 2, post: 1, delegate: 0 },
  });
  expect(report.failure).toBeUndefined();
  expect(report.effects).toEqual({ turn: 2, spawn: 3, delegate: 0, capabilityWrite: 2, post: 1 });
  expect(report.ok).toBe(true);
});

/** 프로세스 강제 종료 뒤 같은 기록 저장소·루프·큐·능력 세계로 다시 시작해 탐구를 끝낸다 */
async function crashAndResume(crash: {
  readonly taskCall?: number;
  readonly post?: boolean;
}): Promise<{
  readonly world: World;
  readonly loop: MemoryLoopPort;
  readonly queue: MemoryInputQueue;
  readonly records: ReturnType<TestHost["records"]["events"]>;
  readonly thread: ThreadId;
}> {
  const loop = memoryLoopPort(scriptedLoop(fixedIdFactory(9000), defaultAnswers()));
  const queue = memoryInputQueue();
  const world = createWorld();
  if (crash.taskCall !== undefined) world.hooks.crashOnTaskCall = crash.taskCall;
  const armed = { post: crash.post === true };
  const crashing: MemoryInputQueue = {
    get items() {
      return queue.items;
    },
    enqueue(request) {
      if (armed.post && request.requestId.endsWith(":finished")) {
        armed.post = false;
        throw new TypeError("simulated crash");
      }
      return queue.enqueue(request);
    },
  };
  const first = await createTestHost({ capabilityDefs: DEFS, shared: { loop, queue: crashing } });
  const thread = first.newThread();
  await installWorld(first, world);
  await first.host.install({
    manifest: helmGroup.manifest,
    entry: helmGroup.entry,
    loadIndex: 4,
    builtin: true,
  });
  await first.host.openThread(thread);
  await first.settled();
  await callCommand(first, thread, "start 캐시 무효화");
  await settleOnce(first, thread, "start");
  await drainRounds(first, thread, 8);
  // 강제 종료: 같은 저장소·포트로 새 호스트를 만든다. 첫 호스트는 그대로 둔다
  world.hooks.crashOnTaskCall = null;
  const second = await first.restart();
  await installWorld(second, world);
  await second.host.install({
    manifest: helmGroup.manifest,
    entry: helmGroup.entry,
    loadIndex: 4,
    builtin: true,
  });
  await second.host.openThread(thread);
  await second.settled();
  await drainRounds(second, thread, 8);
  return { world, loop, queue, records: second.records.events(thread), thread };
}

/** 읽는 쪽 규칙: 발견은 (inquiryId, findingId), 종료는 inquiryId로 중복을 지운다(L3.helm.spec §4.8) */
function distinct(
  events: readonly { readonly kind: string; readonly payload: unknown }[],
  kind: string,
  key: (payload: Readonly<Record<string, unknown>>) => string,
): readonly string[] {
  const keys = events
    .filter((event) => event.kind === kind)
    .flatMap((event) => {
      const wrapped: unknown = event.payload;
      if (typeof wrapped !== "object" || wrapped === null || !("payload" in wrapped)) return [];
      const payload: unknown = wrapped.payload;
      return typeof payload === "object" && payload !== null
        ? [key(Object.fromEntries(Object.entries(payload)))]
        : [];
    });
  return [...new Set(keys)];
}

for (const [name, crash] of [
  ["between recordDiscoveries and linkWork", { taskCall: 1 }],
  ["between linkWork and the applied commit", { post: true }],
] as const) {
  test(`replay.apply-split-points: a crash ${name} keeps two tasks, one apply turn and the discoveries by key`, async () => {
    const result = await crashAndResume(crash);
    expect(result.world.fakes.tasks.created).toEqual([
      "재검증 정책 초안 쓰기",
      "버전 태그 사례 정리",
    ]);
    // diverge 1회와 apply 1회. 같은 requestId의 두 번째 turn은 기록된 결과를 돌려받는다
    expect(result.loop.turns).toHaveLength(2);
    expect(
      distinct(
        result.records,
        "grp.helm.discovery.recorded",
        (p) => `${String(p["inquiryId"])}/${String(p["findingId"])}`,
      ),
    ).toHaveLength(3);
    expect(
      distinct(result.records, "grp.helm.inquiry.finished", (p) => String(p["inquiryId"])),
    ).toHaveLength(1);
    expect(result.queue.items.filter((item) => item.requestId.endsWith(":finished"))).toHaveLength(
      1,
    );
  });
}

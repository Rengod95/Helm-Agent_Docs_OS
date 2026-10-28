import { expect, test } from "bun:test";
import { NO_EFFECTS, replayDrive } from "@xeon/group-kit/testing";
import { helmGroup } from "../../src/index.ts";
import { crashAndResume } from "../support/crash.ts";
import { createHelmReplay } from "../support/replay.ts";

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

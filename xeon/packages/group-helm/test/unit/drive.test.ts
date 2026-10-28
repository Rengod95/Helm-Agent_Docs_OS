import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { HelmStateSchema, type HelmState } from "../../src/state.ts";
import { InquiryFinishedPayloadSchema } from "../../src/records.ts";
import {
  ABORTED,
  ERROR,
  createRig,
  defaultAnswers,
  drainRounds,
  type Rig,
} from "../support/rig.ts";

function finishedOf(rig: Rig): readonly unknown[] {
  return rig.records("grp.helm.inquiry.finished");
}

function statesOf(rig: Rig): readonly HelmState[] {
  return rig.t.records
    .events(rig.thread)
    .filter((event) => event.kind === "grp.helm.state.committed")
    .flatMap((event) => {
      const payload: unknown = event.payload;
      if (typeof payload !== "object" || payload === null || !("doc" in payload)) return [];
      const checked = parse(HelmStateSchema, payload.doc);
      return checked.ok ? [checked.value] : [];
    });
}

for (const lenses of [1, 3, 6]) {
  test(`drive.n-lenses-n-spawns-then-one-apply-turn (${String(lenses)} lenses)`, async () => {
    const seen: { phase: string; findings: number }[] = [];
    const holder: { rig?: Rig } = {};
    const rig = await createRig({
      settings: { "ext.helm.maxLenses": lenses },
      onTurn: (request) => {
        const rigNow = holder.rig;
        if (rigNow === undefined || !request.requestId.includes(":turn:apply:")) return;
        const last = statesOf(rigNow).at(-1);
        seen.push({ phase: last?.phase ?? "?", findings: last?.findings.length ?? -1 });
      },
    });
    holder.rig = rig;
    await rig.runInquiry("캐시 무효화");
    const spawnIds = rig.t.loop.spawns.map((request) =>
      request.requestId.split(":").slice(2).join(":"),
    );
    expect({ lenses, spawns: spawnIds.length }).toEqual({ lenses, spawns: lenses });
    expect(new Set(spawnIds).size).toBe(lenses);
    expect(
      rig.t.loop.turns.map((request) => request.requestId.split(":").slice(2).join(":")),
    ).toEqual(["turn:diverge:1", "turn:apply:1"]);
    // 적용 turn은 렌즈마다 발견 하나가 커밋된 converge 이후 상태에서만 실행된다
    expect(seen).toEqual([{ phase: "apply", findings: lenses }]);
    const finished = finishedOf(rig);
    expect(finished).toHaveLength(1);
    expect(parse(InquiryFinishedPayloadSchema, finished[0]).ok).toBe(true);
    expect(finished[0]).toMatchObject({
      outcome: "applied",
      lensCount: lenses,
      failedLenses: 0,
      findingCount: lenses,
    });
    expect(rig.records("grp.helm.discovery.recorded")).toHaveLength(lenses);
  });
}

test("drive.partial-failure-commits-rest", async () => {
  const rig = await createRig({
    answers: { ...defaultAnswers(), "prior-art": ERROR },
  });
  await rig.runInquiry("캐시 무효화");
  expect(rig.t.loop.spawns).toHaveLength(3);
  expect(rig.t.loop.turns).toHaveLength(2);
  expect(finishedOf(rig)[0]).toMatchObject({
    outcome: "applied",
    lensCount: 3,
    failedLenses: 1,
    findingCount: 2,
  });
  const lenses = statesOf(rig)
    .find((state) => state.phase === "converge")
    ?.lenses.map((lens) => `${lens.id}:${lens.status}`);
  expect(lenses).toEqual(["analogy:done", "prior-art:failed", "first-principles:done"]);
});

test("a run where every lens fails ends failed without an apply turn", async () => {
  const rig = await createRig({
    answers: { analogy: ERROR, "prior-art": ABORTED, "first-principles": ERROR },
  });
  await rig.runInquiry("캐시 무효화");
  expect(rig.t.loop.turns).toHaveLength(1);
  expect(finishedOf(rig)[0]).toMatchObject({
    outcome: "failed",
    failedLenses: 3,
    reason: "all lenses failed",
  });
});

test("drive.limit-reached-releases-lease: maxSpawns 2 with 3 lenses skips one and announces the limit", async () => {
  const rig = await createRig({
    settings: { "ext.helm.driveLimits": { maxTurns: 4, maxSpawns: 2, maxTokens: 400000 } },
  });
  await rig.runInquiry("캐시 무효화");
  expect(rig.t.loop.spawns).toHaveLength(2);
  const lenses = statesOf(rig)
    .find((state) => state.phase === "converge")
    ?.lenses.map((lens) => lens.status);
  expect(lenses).toEqual(["done", "done", "skipped"]);
  expect(finishedOf(rig)).toHaveLength(1);
});

test("drive.limit-reached: maxTurns 1 stops before the apply turn and records the discoveries unapplied", async () => {
  const rig = await createRig({
    settings: { "ext.helm.driveLimits": { maxTurns: 1, maxSpawns: 8, maxTokens: 400000 } },
  });
  await rig.runInquiry("캐시 무효화");
  expect(rig.t.loop.turns).toHaveLength(1);
  expect(finishedOf(rig)).toEqual([
    expect.objectContaining({ outcome: "limit", limit: "turns", findingCount: 3 }),
  ]);
  const discoveries = rig.records("grp.helm.discovery.recorded");
  expect(discoveries).toHaveLength(3);
  expect(
    discoveries.every(
      (found) =>
        typeof found === "object" &&
        found !== null &&
        "applied" in found &&
        found.applied === false,
    ),
  ).toBe(true);
  const notices = rig.t.queue.items.filter((item) => item.requestId.endsWith(":limit"));
  expect(notices).toHaveLength(1);
  expect(statesOf(rig).at(-1)?.phase).toBe("idle");
});

test("ext.helm.driveLimits changed between inquiries takes effect on the next lease", async () => {
  const settings: Record<string, unknown> = {
    "ext.helm.driveLimits": { maxTurns: 1, maxSpawns: 8, maxTokens: 400000 },
  };
  const rig = await createRig({ settings });
  await rig.runInquiry("첫 탐구");
  expect(finishedOf(rig)).toEqual([expect.objectContaining({ outcome: "limit", limit: "turns" })]);
  settings["ext.helm.driveLimits"] = { maxTurns: 4, maxSpawns: 8, maxTokens: 400000 };
  await rig.runInquiry("둘째 탐구");
  expect(finishedOf(rig)).toHaveLength(2);
  expect(finishedOf(rig)[1]).toMatchObject({ outcome: "applied" });
});

test("a thread without inquiry state, such as a subagent child, gets no effect from the drive", async () => {
  const rig = await createRig();
  const child = rig.t.newThread();
  await rig.t.host.openThread(child);
  await rig.t.settled();
  const before = rig.t.records.events(child).length;
  await drainRounds(rig.t, child, 4);
  expect(rig.t.loop.turns).toHaveLength(0);
  expect(rig.t.loop.spawns).toHaveLength(0);
  const kinds = rig.t.records
    .events(child)
    .slice(before)
    .map((event) => event.kind);
  expect(kinds.filter((kind) => kind.startsWith("grp.helm."))).toEqual([]);
});

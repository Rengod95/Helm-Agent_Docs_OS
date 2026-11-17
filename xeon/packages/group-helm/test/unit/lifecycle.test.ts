import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { defineManifest } from "@fresnel/contracts/extensions";
import { defineGroup } from "@fresnel/group-sdk";
import { HelmStateSchema, type HelmState } from "../../src/state.ts";
import { callCommand, createRig, type Rig } from "../support/rig.ts";

function statesOf(
  records: readonly { readonly kind: string; readonly payload: unknown }[],
): readonly HelmState[] {
  return records
    .filter((event) => event.kind === "grp.helm.state.committed")
    .flatMap((event) => {
      const payload: unknown = event.payload;
      if (typeof payload !== "object" || payload === null || !("doc" in payload)) return [];
      const checked = parse(HelmStateSchema, payload.doc);
      return checked.ok ? [checked.value] : [];
    });
}

function leaseReleases(rig: Rig): readonly unknown[] {
  return rig.t.records
    .events(rig.thread)
    .filter((event) => event.kind === "lease.released")
    .map((event) => event.payload);
}

test("disable.at-step-boundary-releases-lease: the inquiry resumes from the same phase after re-enabling", async () => {
  const holder: { rig?: Rig } = {};
  const rig = await createRig({
    onTurn: async (request) => {
      const target = holder.rig;
      if (target === undefined || !request.requestId.includes(":turn:diverge:")) return;
      // diverge turn 도중 끄기를 요청하고, 턴 안의 단계 경계가 그것을 적용한다
      target.t.host.registration("helm")?.disable();
      await target.t.boundary(target.thread).stepEnd();
    },
  });
  holder.rig = rig;
  await rig.command("start 캐시 무효화");
  await rig.settle("s");
  await rig.drain();
  const disabled = leaseReleases(rig).filter(
    (payload) =>
      typeof payload === "object" &&
      payload !== null &&
      "reason" in payload &&
      payload.reason === "disabled",
  );
  expect(disabled).toHaveLength(1);
  const stopped = statesOf(rig.t.records.events(rig.thread)).at(-1);
  expect(stopped?.phase).toBe("diverge");
  expect(rig.t.loop.spawns).toHaveLength(0);
  const inquiryId = stopped?.inquiryId;
  expect(inquiryId).not.toBeNull();
  // 다시 켜는 것은 scope만 켠다. 탐구는 같은 주제의 `/helm start`로 이어 간다(drive-isolation.md 2.2)
  rig.t.host.registration("helm")?.enable();
  // 켜기는 유휴 경계에서 적용된다. 그 뒤에야 /helm 명령이 다시 등록된다
  await rig.drain(1, "idle");
  await rig.command("start 캐시 무효화");
  await rig.drain(12);
  const finished = rig.records("grp.helm.inquiry.finished");
  expect(finished).toHaveLength(1);
  expect(finished[0]).toMatchObject({ inquiryId, outcome: "applied" });
  // 같은 requestId라 diverge turn은 기록된 결과를 돌려받고 적용 turn은 한 번이다
  expect(
    rig.t.loop.turns.filter((request) => request.requestId.includes(":turn:apply:")),
  ).toHaveLength(1);
});

test("coexist.learning-on-while-helm-holds-lease: another group's on handler and post keep working", async () => {
  const seen: (string | undefined)[] = [];
  const holder: { rig?: Rig } = {};
  const learn = defineGroup({
    manifest: defineManifest({
      schemaVersion: 2,
      name: "learn-fake",
      version: "0.1.0",
      entry: "./src/index.ts",
      trust: { level: "builtin" },
      plugins: [{ layer: "L3", hooks: ["boundary.settle.after"], usesPost: true }],
      group: {},
    }),
    setup(g) {
      g.on("boundary.settle.after", async (payload) => {
        seen.push(holder.rig?.t.host.leaseOf(holder.rig.thread)?.scopeId);
        await g.post(
          {
            kind: "context",
            customType: "grp.learn-fake.notice.seen",
            content: "x",
            display: false,
          },
          { when: "next", requestId: `learn:${payload.turnId}` },
        );
      });
    },
  });
  const rig = await createRig({
    onTurn: (request) => {
      if (!request.requestId.includes(":turn:diverge:")) return;
      void holder.rig?.t.host.dispatch(
        "boundary.settle.after",
        { turnId: holder.rig.t.ids.next("trn"), aborted: false },
        { threadId: holder.rig.thread, dispatchKey: "learn-during-helm" },
      );
    },
  });
  holder.rig = rig;
  await rig.t.host.install({
    manifest: learn.manifest,
    entry: learn.entry,
    loadIndex: 9,
    builtin: true,
  });
  await rig.runInquiry("캐시 무효화");
  expect(seen).toContain("helm");
  expect(rig.t.queue.items.some((item) => item.requestId.startsWith("learn:"))).toBe(true);
  expect(rig.records("grp.helm.inquiry.finished")[0]).toMatchObject({ outcome: "applied" });
});

test("start.refused-start-keeps-the-request-and-says-why: a start from a child conversation leaves the inquiry waiting; stop clears it", async () => {
  const rig = await createRig();
  const child = rig.t.newThread();
  await rig.t.host.openThread(child, { child: true });
  await rig.t.settled();
  const text = await callCommand(rig.t, child, "start 캐시 무효화");
  expect(text).toContain("하위 대화에서는 탐구를 시작할 수 없습니다");
  expect(statesOf(rig.t.records.events(child)).at(-1)?.pending).toMatchObject({
    topic: "캐시 무효화",
  });
  // 기다리는 요청은 `/helm stop`으로 지운다
  await callCommand(rig.t, child, "stop");
  expect(statesOf(rig.t.records.events(child)).at(-1)?.pending).toBeNull();
});

test("disable.while-explorer-waits: turning Helm off aborts the waiting spawn and the scope reaches disabled", async () => {
  const holder: { rig?: Rig } = {};
  const seen = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  const rig = await createRig({
    onSpawn: async (request) => {
      // 부모 대화는 spawn 동안 실행 중이라 유휴 적용이 없다. 자식 대화는 열려 있고 승인 답을 기다린다
      holder.rig?.t.loop.setRunning(request.threadId, true);
      seen.resolve();
      // 승인 답을 기다리는 explorer처럼 임대 신호가 abort될 때까지 끝나지 않는다
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) resolve();
        else request.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      holder.rig?.t.loop.setRunning(request.threadId, false);
      aborted.resolve();
    },
  });
  holder.rig = rig;
  await rig.command("start 캐시 무효화");
  await rig.settle("s");
  await seen.promise;
  rig.t.host.registration("helm")?.disable();
  await aborted.promise;
  await rig.drain(8, "idle");
  expect(rig.t.host.registration("helm")?.status).toBe("disabled");
});

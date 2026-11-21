import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { defineManifest, type DriveFrameView, type PostItem } from "@fresnel/contracts/extensions";
import { LeaseAcquiredPayloadSchema, LeaseReleasedPayloadSchema } from "@fresnel/contracts/records";
import {
  defineOrchestration,
  type OrchestrationManifest,
  type OrchestrationModule,
} from "@fresnel/orchestration-sdk";
import { HelmStateSchema, pluginNeedOf, type HelmState } from "../../src/state.ts";
import { createRig, type Rig } from "../support/rig.ts";

// `/helm plugin` 맡기기의 엔진 통합 시험. Helm과 빌더 대역(`authoring`, 같은 이름과 단계 모양)을 한 호스트에 올려
// 주도 스택과 기록을 본다. 빌더 대역은 plugin-builder의 `authoringDrive`를 그대로 쓰지 않는다: 같은 층 패키지를
// 가져오지 않으려고 맡기기 모양만 흉내 낸다. 실제 빌더의 맡기기 단계는 plugin-builder 시험(handoff-a~d)이 본다.

const BUILDER = "authoring";

/** 맡기기를 받으면 알리고 `accepted`로 돌려주는 빌더 대역. 세션은 없다고 본다 */
function builderStandIn(
  seen: (readonly DriveFrameView[])[],
  frames: () => readonly DriveFrameView[],
): OrchestrationModule {
  const manifest: OrchestrationManifest = defineManifest({
    schemaVersion: 2,
    name: BUILDER,
    version: "0.1.0",
    displayName: "Plugin Builder (stand-in)",
    description: "맡기기 모양만 흉내 내는 빌더 대역(시험용)",
    entry: "./src/index.ts",
    defaultEnabled: true,
    trust: { level: "builtin" },
    plugins: [{ layer: "L3", drives: true, usesPost: true, hooks: [], requires: [], optional: [] }],
    orchestration: {},
  });
  return defineOrchestration({
    manifest,
    setup(g) {
      g.drive(async ({ last, frame }) => {
        seen.push(frames());
        if (frame.calledBy === null || last !== null) return { do: "done" };
        await g.post(
          {
            kind: "context",
            customType: "grp.authoring.notice.status",
            content: `[authoring] ${frame.calledBy}가 플러그인 제작을 맡겼다`,
            display: true,
          },
          { when: "next", requestId: "authoring:handoff:standin" },
        );
        return { do: "done", result: { accepted: true } };
      });
    },
  });
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

function texts(items: readonly { readonly item: PostItem }[]): string[] {
  return items.flatMap(({ item }) => (typeof item.content === "string" ? [item.content] : []));
}

test("handoff.engine: /helm plugin hands the purpose to the builder, the frames follow the handoff, and the stack empties", async () => {
  const seen: (readonly DriveFrameView[])[] = [];
  const holder: { rig?: Rig } = {};
  const frames = (): readonly DriveFrameView[] =>
    holder.rig === undefined ? [] : holder.rig.t.host.driveFrames(holder.rig.thread);
  const rig = await createRig({ companions: [builderStandIn(seen, frames)] });
  holder.rig = rig;

  const reply = await rig.command("plugin 로그 정리 도구");
  expect(reply).toContain("로그 정리 도구");
  await rig.settle("plugin");
  await rig.drain();

  // 빌더가 불린 순간의 스택: 코어 아래, Helm은 기다리고 빌더가 주도한다
  expect(
    seen.map((frames) => frames.map((frame) => [frame.depth, frame.plugin, frame.state])),
  ).toEqual([
    [
      [0, null, "driving"],
      [1, "helm", "waiting"],
      [2, BUILDER, "driving"],
    ],
  ]);
  // 끝난 뒤 플러그인 프레임은 없다. 맨 아래 코어 프레임(depth 0)만 남는다
  expect(rig.t.host.driveFrames(rig.thread).map((frame) => [frame.depth, frame.plugin])).toEqual([
    [0, null],
  ]);

  // 기록: Helm은 맨 아래 프레임(depth 0), 빌더는 그 위(depth 1)이고 parent가 Helm의 임대다
  const acquired = rig.t.records
    .events(rig.thread)
    .filter((event) => event.kind === "lease.acquired")
    .map((event) => parse(LeaseAcquiredPayloadSchema, event.payload));
  expect(
    acquired.map((entry) => (entry.ok ? [entry.value.scopeId, entry.value.depth] : null)),
  ).toEqual([
    ["helm", 0],
    [BUILDER, 1],
  ]);
  const helmLease = acquired[0]?.ok ? acquired[0].value.leaseId : null;
  expect(acquired[1]?.ok ? acquired[1].value.parent : null).toBe(helmLease);

  const released = rig.t.records
    .events(rig.thread)
    .filter((event) => event.kind === "lease.released")
    .map((event) => parse(LeaseReleasedPayloadSchema, event.payload));
  expect(
    released.map((entry) => (entry.ok ? [entry.value.scopeId, entry.value.reason] : null)),
  ).toEqual([
    [BUILDER, "done"],
    ["helm", "done"],
  ]);

  // Helm 상태의 요청은 비워졌고, 결과는 한 줄 알림으로 남았다
  const last = statesOf(rig).at(-1);
  expect(last === undefined ? "no state" : pluginNeedOf(last)).toBeNull();
  expect(texts(rig.t.queue.items).filter((text) => text.includes("받았어요"))).toHaveLength(1);
});

test("handoff.refused: with no builder installed the handoff is refused as target_unavailable and the request is cleared", async () => {
  const rig = await createRig();
  await rig.command("plugin 로그 정리 도구");
  await rig.settle("plugin");
  await rig.drain();

  // 거부된 맡기기는 프레임을 쌓지 않는다: Helm 하나만 주도했고 끝났다
  expect(rig.t.host.driveFrames(rig.thread).map((frame) => [frame.depth, frame.plugin])).toEqual([
    [0, null],
  ]);
  expect(
    rig.t.records.events(rig.thread).filter((event) => event.kind === "lease.acquired"),
  ).toHaveLength(1);
  const lines = texts(rig.t.queue.items).filter((text) => text.includes("거부당했어요"));
  expect(lines).toEqual([
    "[helm] 플러그인 맡기기를 거부당했어요: 로그 정리 도구 (맡을 플러그인을 쓸 수 없어요(꺼져 있거나 구동 기능이 없어요)).",
  ]);
  expect(statesOf(rig).at(-1)?.pluginNeed ?? null).toBeNull();
});

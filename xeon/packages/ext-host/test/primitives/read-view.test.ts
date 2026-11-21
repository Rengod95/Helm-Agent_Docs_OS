import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { budgetClassOf, DEFAULT_BUDGETS_MS, extReadViewOf } from "../../src/index.ts";
import { HOOKS, type DriveCommand, type DriveFrameView } from "@fresnel/contracts/extensions";
import { createTestHost } from "../../src/testing/index.ts";
import { hostOf } from "../../src/primitives/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { echoDefs, makeOrchestrationUnit, makeUnit } from "./fixtures/support.ts";

// X.primitives.spec §4.4.9: 조립 루트가 wire 확장 읽기에 쓰는 읽기 전용 조회

test("threadStatus: unknown for a thread that is not open, then enabled, disabling after a thread-only disable", async () => {
  const t = await createTestHost();
  await t.host.install(makeOrchestrationUnit({ name: "scp-group", hooks: [] }, () => {}));
  const view = extReadViewOf(t.host);
  const thread = t.newThread();
  expect(view.threadStatus(thread, "scp-group")).toBeUndefined();
  await t.host.openThread(thread);
  await t.settled();
  expect(view.threadStatus(thread, "scp-group")).toBe("enabled");
  expect(view.threadStatus(thread, "no-such-scope")).toBeUndefined();
  t.host.registration("scp-group")?.disable();
  expect(view.threadStatus(thread, "scp-group")).toBe("disabling");
  const other: ThreadId = t.newThread();
  expect(view.threadStatus(other, "scp-group")).toBeUndefined();
});

/** 시험용 단계 명령: 첫 단계는 turn을 내고, 그 결과를 받은 단계는 끝낸다 */
function turnThenYield(last: unknown): DriveCommand<never> {
  return last === null ? { do: "turn", input: { kind: "user", content: "go" } } : { do: "yield" };
}

test("driveFrames: only the core frame until a start request is granted, then the plugin frame at depth 1 with its lease and usage", async () => {
  const t = await createTestHost();
  await t.host.install(
    makeOrchestrationUnit({ name: "frame-driver" }, (g) => {
      g.drive(({ last }) => Promise.resolve(turnThenYield(last)), { limits: { maxTurns: 3 } });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  const core: DriveFrameView = {
    depth: 0,
    plugin: null,
    versionId: null,
    leaseId: null,
    state: "driving",
    used: { turns: 0, spawns: 0, tokens: 0 },
    limits: {},
  };
  expect(t.host.driveFrames(thread)).toEqual([core]);

  expect(t.host.startDrive(thread, "frame-driver")).toEqual({ ok: true, value: undefined });
  await t.settled();
  const lease = t.host.leaseOf(thread);
  expect(lease).toMatchObject({ scopeId: "frame-driver" });
  const leaseId = lease?.leaseId ?? null;
  expect(t.host.driveFrames(thread)).toEqual([
    core,
    {
      depth: 1,
      plugin: "frame-driver",
      versionId: null,
      leaseId,
      state: "driving",
      // 턴 하나는 기본 사용량 10 토큰으로 센다
      used: { turns: 1, spawns: 0, tokens: 10 },
      // 요청한 턴 상한 3은 turns 키로, 요청하지 않은 spawns·tokens는 일반 기본 상한(8, 400000)으로 채워진다
      limits: { turns: 3, spawns: 8, tokens: 400_000 },
    },
  ]);
});

test("budgetClassOf and DEFAULT_BUDGETS_MS are public: a first hook uses the first-class default", () => {
  expect(budgetClassOf(HOOKS["tool.call.before"])).toBe("first");
  expect(DEFAULT_BUDGETS_MS.first).toBe(30_000);
  expect(DEFAULT_BUDGETS_MS.streamTap).toBe(1_000);
});

test("handlers: the registered handlers of a hook come back in dispatch order, not install order", async () => {
  const t = await createTestHost();
  await eachInOrder(
    [
      ["hv-late", 2],
      ["hv-first", 0],
      ["hv-mid", 1],
    ] as const,
    async ([name, loadIndex]) => {
      await t.host.install(
        makeUnit({ name, loadIndex, hooks: ["boundary.settle.after"] }, (g) => {
          g.on("boundary.settle.after", () => {});
        }),
      );
      return "continue";
    },
  );
  await t.host.install(
    makeUnit({ name: "hv-other", loadIndex: 0, hooks: ["boundary.step.after"] }, (g) => {
      g.on("boundary.step.after", () => {});
    }),
  );
  const rows = extReadViewOf(t.host).handlers();
  expect(
    rows.map((row) => [row.point, row.scopeId, row.extension, row.tier, row.loadIndex]),
  ).toEqual([
    ["boundary.settle.after", "hv-first", "hv-first", 0, 0],
    ["boundary.settle.after", "hv-mid", "hv-mid", 0, 1],
    ["boundary.settle.after", "hv-late", "hv-late", 0, 2],
    ["boundary.step.after", "hv-other", "hv-other", 0, 0],
  ]);
  // 등록 순번은 설치 순서(late, first, mid)이고 같은 키 안의 마지막 정렬 기준이다
  const seqs = rows.map((row) => row.seq);
  expect(seqs[0]).toBeGreaterThan(seqs[2] ?? Infinity);
});

test("handlers: a scope that is fully turned off has no row any more, registrations() still lists it as disabled", async () => {
  const t = await createTestHost();
  await t.host.openThread(t.newThread());
  await t.host.install(
    makeUnit({ name: "hv-off", hooks: ["boundary.settle.after"] }, (g) => {
      g.on("boundary.settle.after", () => {});
    }),
  );
  t.host.registration("hv-off")?.disable();
  await t.settled();
  expect(extReadViewOf(t.host).handlers()).toEqual([]);
  expect(t.host.registrations().find((info) => info.id === "hv-off")?.status).toBe("disabled");
});

test("boundCapabilities: the bound provider with its version, nothing for a capability nobody provides", async () => {
  const t = await createTestHost({ capabilityDefs: echoDefs });
  const view = extReadViewOf(t.host);
  expect(view.boundCapabilities()).toEqual([]);
  await t.host.install(
    makeUnit({ name: "demo-provider", provides: [{ id: "demo.echo", version: "1.2.0" }] }, (g) => {
      hostOf(g).provide({ capability: "demo.echo", version: "1.0.0" }, { echo: () => "x" });
    }),
  );
  await t.settled();
  expect(view.boundCapabilities()).toEqual([
    { capability: "demo.echo", provider: "demo-provider", version: "1.2.0" },
  ]);
});

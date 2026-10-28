import { expect, test } from "bun:test";
import { defineManifest, type ExtensionEntry } from "@xeon/contracts/extensions";
import type { ExtensionUnit } from "@xeon/ext-host";
import { createHarness, type Harness } from "./support/harness.ts";
import { countKind, firstOfKind } from "./support/inspect.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";

// L1A.6 (LP7): 완료 게이트 횟수 상한 `l1.loop.gate.maxContinues`(L1.loop.spec §4.9)

const read = (id: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "toolCall", id, name: "read", arguments: {} }],
  stopReason: "toolUse",
});
const done = (value: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text: value }],
  stopReason: "stop",
});

/** 지점 하나가 매번 continue: true를 돌려주는 확장 */
function continuing(point: "boundary.settle.before" | "boundary.step.after"): ExtensionUnit {
  const entry: ExtensionEntry = ({ manifest, scope }) => {
    scope(manifest.name, {}, (g) => {
      g.on(point, () => ({ continue: true }));
    });
  };
  return {
    manifest: defineManifest({
      schemaVersion: 1,
      name: `always-continue-${point.replaceAll("_", "-")}`,
      version: "0.1.0",
      layer: "plugin",
      kind: "plugin",
      entry: "./index.ts",
      points: [point],
      usesDrive: false,
    }),
    entry,
    loadIndex: 2,
    builtin: false,
  };
}

async function start(h: Harness, unit: ExtensionUnit): Promise<void> {
  await h.host.host.install(unit);
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
}

test("gate_stops_after_max_continues: a boundary that always continues is capped by the setting", async () => {
  const h = await createHarness({
    script: Array.from({ length: 12 }, (_value, index) => done(`answer ${index}`)),
    gateMaxContinues: 3,
  });
  await start(h, continuing("boundary.settle.before"));
  // 처음 요청 하나와 게이트 계속 3번
  expect(h.models.requests).toHaveLength(1 + 3);
  expect(firstOfKind(h.fake.events(h.threadId), "turn.completed")?.payload).toMatchObject({
    status: "completed",
  });
});

test("the default cap is 8 continues", async () => {
  const h = await createHarness({
    script: Array.from({ length: 14 }, (_value, index) => done(`answer ${index}`)),
  });
  await start(h, continuing("boundary.settle.before"));
  expect(h.models.requests).toHaveLength(1 + 8);
});

test("a cap of 0 ignores the boundary's continue instruction", async () => {
  const h = await createHarness({ script: [done("one"), done("never")], gateMaxContinues: 0 });
  await start(h, continuing("boundary.settle.before"));
  expect(h.models.requests).toHaveLength(1);
  expect(countKind(h.fake.events(h.threadId), "turn.completed")).toBe(1);
});

test("gate_ignores_continue_on_non_final_step: a boundary.step.after continue on a tool step is not counted", async () => {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [read("c1"), read("c2"), done("final"), done("extra")],
    gateMaxContinues: 1,
  });
  await start(h, continuing("boundary.step.after"));
  // 도구 단계 둘의 continue는 세지 않는다. 마지막 단계에서 한 번만 계속하고 상한에 닿는다
  expect(h.models.requests).toHaveLength(4);
  expect(h.tools.executed).toEqual(["c1", "c2"]);
  expect(countKind(h.fake.events(h.threadId), "turn.completed")).toBe(1);
});

test("the count starts from 0 on every turn", async () => {
  const h = await createHarness({
    script: Array.from({ length: 10 }, (_value, index) => done(`answer ${index}`)),
    gateMaxContinues: 2,
  });
  await start(h, continuing("boundary.settle.before"));
  expect(h.models.requests).toHaveLength(3);
  await h.loop.admit({ threadId: h.threadId, content: "again", via: "interactive" });
  await h.settle();
  expect(h.models.requests).toHaveLength(6);
});

test("gate_limit_notice: the step that hits the cap tells the user once and keeps it out of the record", async () => {
  const h = await createHarness({
    script: Array.from({ length: 6 }, (_value, index) => done(`answer ${index}`)),
    gateMaxContinues: 2,
  });
  await start(h, continuing("boundary.settle.before"));
  const notices = h.fake
    .volatile()
    .filter((event) => event.kind === "turn.updated")
    .map((event) => event.payload)
    .filter((payload) => JSON.stringify(payload).includes("notice"));
  expect(notices).toEqual([
    { status: "running", notice: { code: "gate_limit", detail: { limit: 2 } } },
  ]);
  // 내구 기록에는 알림이 없다
  expect(JSON.stringify(h.fake.events(h.threadId))).not.toContain("gate_limit");
});

test("no gate_limit notice when the boundary does not ask to continue", async () => {
  const h = await createHarness({ script: [done("one")], gateMaxContinues: 0 });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const notices = h.fake
    .volatile()
    .filter((event) => event.kind === "turn.updated")
    .filter((event) => JSON.stringify(event.payload).includes("notice"));
  expect(notices).toEqual([]);
});

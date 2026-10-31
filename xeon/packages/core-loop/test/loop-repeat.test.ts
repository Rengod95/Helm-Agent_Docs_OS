import { expect, test } from "bun:test";
import type { ScriptedResponse } from "./support/fake-models.ts";
import { createHarness, type Harness, type HarnessOptions } from "./support/harness.ts";
import { firstOfKind } from "./support/inspect.ts";

// L1.loop.spec §4.10 반복 감지의 턴 단위 시험. 알림은 휘발이고 관찰만 하므로 턴은 정상 끝난다.

/** 같은 인자(`a.txt`)로 read를 부르는 응답. 호출 id만 다르다 */
const readSame = (id: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "toolCall", id, name: "read", arguments: { path: "a.txt" } }],
  stopReason: "toolUse",
});
const done = (text: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text }],
  stopReason: "stop",
});

/** 휘발 turn.updated 가운데 notice를 실은 payload만 */
function noticePayloads(h: Harness): unknown[] {
  return h.fake
    .volatile()
    .filter((event) => event.kind === "turn.updated")
    .filter((event) => JSON.stringify(event.payload).includes("notice"))
    .map((event) => event.payload);
}

async function runTurn(options: HarnessOptions): Promise<Harness> {
  const h = await createHarness(options);
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  return h;
}

test("four identical calls with the same output notify once and the turn still completes", async () => {
  const h = await runTurn({
    tools: [{ name: "read" }],
    script: [readSame("r1"), readSame("r2"), readSame("r3"), readSame("r4"), done("finished")],
  });
  expect(noticePayloads(h)).toEqual([
    {
      status: "running",
      notice: { code: "repeat_detected", detail: { kind: "action_observation", count: 4 } },
    },
  ]);
  // 관찰만 한다: 네 번째 결과 뒤에도 막지 않고 모델이 한 번 더 답해 turn이 끝난다
  expect(h.tools.executed).toHaveLength(4);
  expect(h.models.requests).toHaveLength(5);
  expect(firstOfKind(h.fake.events(h.threadId), "turn.completed")?.payload).toMatchObject({
    status: "completed",
  });
  // 내구 기록에는 알림이 없다
  const durable = JSON.stringify(h.fake.events(h.threadId));
  expect(durable).not.toContain("repeat_detected");
  expect(durable).not.toContain("notice");
});

test("three identical failing calls notify action_error on the third and the turn still completes", async () => {
  const h = await runTurn({
    tools: [{ name: "read", blockReason: "no such file" }],
    script: [readSame("r1"), readSame("r2"), readSame("r3"), done("finished")],
  });
  expect(noticePayloads(h)).toEqual([
    {
      status: "running",
      notice: { code: "repeat_detected", detail: { kind: "action_error", count: 3 } },
    },
  ]);
  expect(h.tools.executed).toEqual([]);
  expect(h.models.requests).toHaveLength(4);
  expect(firstOfKind(h.fake.events(h.threadId), "turn.completed")?.payload).toMatchObject({
    status: "completed",
  });
  expect(JSON.stringify(h.fake.events(h.threadId))).not.toContain("repeat_detected");
});

test("repeat.enabled false gives no notice for repeated calls", async () => {
  const h = await runTurn({
    tools: [{ name: "read" }],
    script: [readSame("r1"), readSame("r2"), readSame("r3"), readSame("r4"), done("finished")],
    repeat: { enabled: false },
  });
  expect(noticePayloads(h)).toEqual([]);
  expect(h.models.requests).toHaveLength(5);
  expect(firstOfKind(h.fake.events(h.threadId), "turn.completed")?.payload).toMatchObject({
    status: "completed",
  });
});

test("repeat.enabled false gives no notice for repeated failures either", async () => {
  const h = await runTurn({
    tools: [{ name: "read", blockReason: "no such file" }],
    script: [readSame("r1"), readSame("r2"), readSame("r3"), done("finished")],
    repeat: { enabled: false },
  });
  expect(noticePayloads(h)).toEqual([]);
});

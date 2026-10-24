import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { ItemRecordedPayloadSchema } from "@xeon/contracts/records";
import { createHarness } from "../support/harness.ts";
import { countKind } from "../support/inspect.ts";
import { createRecorder } from "../support/recorder.ts";
import type { ScriptedResponse } from "../support/fake-models.ts";

// L1.loop.plan §5 stream_response_*. 원본 streamAssistantResponse(381-476) 사례.

const text = (value: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text: value }],
  stopReason: "stop",
});

function assistantMessages(
  events: readonly { readonly kind: string; readonly payload: unknown }[],
): { readonly role: string; readonly thinkingLevel?: string; readonly content: unknown }[] {
  const found: { role: string; thinkingLevel?: string; content: unknown }[] = [];
  for (const event of events) {
    if (event.kind !== "item.recorded") continue;
    const parsed = parse(ItemRecordedPayloadSchema, event.payload);
    if (parsed.ok && parsed.value.item.kind === "assistant") found.push(parsed.value.item.message);
  }
  return found;
}

test("stream_response_emits_start_updates_and_one_message_end_for_a_normal_stream", async () => {
  const h = await createHarness({ script: [text("hello")] });
  const recorder = createRecorder(h.fake);
  await h.host.host.install(recorder.unit);
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  const count = (point: string): number =>
    recorder.sightings.filter((sighting) => sighting.point === point).length;
  expect(count("message_start")).toBe(1);
  // 텍스트 블록 하나는 start, delta, end 세 갱신이다
  expect(count("message_update")).toBe(3);
  expect(count("message_end")).toBe(1);
});

test("stream_response_handles_a_stream_that_ends_without_a_start_event", async () => {
  const h = await createHarness({ script: [{ kind: "bare", text: "no start" }] });
  const recorder = createRecorder(h.fake);
  await h.host.host.install(recorder.unit);
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  const count = (point: string): number =>
    recorder.sightings.filter((sighting) => sighting.point === point).length;
  // 시작 이벤트가 없어도 message_start와 message_end가 한 번씩 나가고 응답은 기록된다
  expect(count("message_start")).toBe(1);
  expect(count("message_update")).toBe(0);
  expect(count("message_end")).toBe(1);
  expect(countKind(h.fake.events(h.threadId), "turn.completed")).toBe(1);
  const recorded = assistantMessages(h.fake.events(h.threadId));
  expect(recorded).toHaveLength(1);
  expect(recorded[0]?.content).toEqual([{ type: "text", text: "no start" }]);
});

test("stream_response_records_the_requested_thinking_level_on_the_final_message", async () => {
  const h = await createHarness({ script: [text("deep")] });
  h.models.setBinding({ role: "main", provider: "fake", modelId: "fake-1", thinkingLevel: "high" });
  await h.loop.admit({ threadId: h.threadId, content: "think", via: "interactive" });
  await h.settle();
  const recorded = assistantMessages(h.fake.events(h.threadId));
  expect(recorded[0]?.thinkingLevel).toBe("high");

  const off = await createHarness({ script: [text("plain")] });
  await off.loop.admit({ threadId: off.threadId, content: "plain", via: "interactive" });
  await off.settle();
  expect(assistantMessages(off.fake.events(off.threadId))[0]?.thinkingLevel).toBe("off");
});

test("stream_response_keeps_no_context_array_between_requests", async () => {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [
      {
        kind: "message",
        content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
        stopReason: "toolUse",
      },
      text("done"),
    ],
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const first = h.models.requests[0]?.messages ?? [];
  const second = h.models.requests[1]?.messages ?? [];
  // 둘째 요청은 첫 요청 + 어시스턴트 응답 + 도구 결과다. 부분 메시지나 중복이 섞이지 않는다
  expect(second.map((message) => message.role)).toEqual([
    ...first.map((message) => message.role),
    "assistant",
    "toolResult",
  ]);
});

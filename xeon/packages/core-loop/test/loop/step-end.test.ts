import { expect, test } from "bun:test";
import type { AssistantMessage } from "@xeon/contracts/conversation";
import { endStep } from "../../src/loop/step-end.ts";
import { resolveModel } from "../../src/loop/turn-run.ts";
import { createHarness } from "../support/harness.ts";
import { createRig } from "../support/loop-rig.ts";
import { kindsOf } from "../support/inspect.ts";

// L1.loop.plan §5 step-end 시험. 단계 끝(C5)은 콜백 없이 값으로 다음 행동과 배치한 입력을 돌려준다.

function finalAnswer(): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "partial answer" }],
    api: "fake-api",
    provider: "fake",
    model: "fake-1",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}

test("step_end_returns_placed_steer_without_callback", async () => {
  const h = await createHarness({ withoutLoop: true, script: [] });
  const rig = createRig(h);
  rig.run.mapper.map({ type: "turn_start" });
  expect(resolveModel(rig.run).ok).toBe(true);
  const queued = await h.tasks.service.inputs.enqueue({
    threadId: h.threadId,
    mode: "steer",
    item: { kind: "user", content: "also this" },
    requestId: "steer-1",
    source: { type: "user", via: "interactive" },
  });
  expect(queued.ok).toBe(true);

  const next = await endStep(rig.run, {
    message: finalAnswer(),
    outcomes: [],
    terminate: false,
    contextMessages: [],
  });

  // 도구 호출이 없는 응답이어도 대기 중인 steer가 있으면 정착하지 않고 다음 요청으로 이어진다
  expect(next.ok).toBe(true);
  if (!next.ok) return;
  expect(next.value.kind).toBe("request");
  if (next.value.kind !== "request") return;
  // 배치한 입력은 반환 값으로 돌아오고 다음 요청의 메시지 앞에 붙는다
  expect(next.value.placed).toHaveLength(1);
  expect(next.value.placed[0]?.message).toMatchObject({ role: "user", content: "also this" });
  // 같은 커밋에 step.completed와 입력 item, input.placed, 체크포인트가 함께 있다
  const kinds = kindsOf(h.fake.events(h.threadId));
  for (const kind of ["step.completed", "item.recorded", "input.placed", "checkpoint.step"]) {
    expect(kinds).toContain(kind);
  }
  // 큐에 steer가 남아 있지 않다
  const remaining = h.tasks.service.inputs.peek(h.threadId, ["steer"]);
  expect(remaining.ok && remaining.value).toEqual([]);
});

test("step_end_settles_when_no_steer_is_queued", async () => {
  const h = await createHarness({ withoutLoop: true, script: [] });
  const rig = createRig(h);
  rig.run.mapper.map({ type: "turn_start" });
  expect(resolveModel(rig.run).ok).toBe(true);
  const next = await endStep(rig.run, {
    message: finalAnswer(),
    outcomes: [],
    terminate: false,
    contextMessages: [],
  });
  expect(next.ok && next.value.kind).toBe("settle");
});

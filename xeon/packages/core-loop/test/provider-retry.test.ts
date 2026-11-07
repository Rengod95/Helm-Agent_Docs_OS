import { expect, test } from "bun:test";
import type { ScriptedResponse } from "./support/fake-models.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { firstOfKind } from "./support/inspect.ts";

// L1.models.spec §4.5 재시도 상태 이벤트 → 휘발 `turn.updated`(notice `provider_retry`, L1.loop.spec §4.9).
// 알림은 그 turn의 사용자에게만 보이고 내구 기록과 모델 컨텍스트에 들어가지 않는다.

const done = (text: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text }],
  stopReason: "stop",
});

/** 제공자 재시도 알림을 실은 휘발 turn.updated의 payload와 turn id */
function retryNotices(h: Harness): { readonly turnId: unknown; readonly payload: unknown }[] {
  return h.fake
    .volatile()
    .filter((event) => JSON.stringify(event.payload).includes("provider_retry"))
    .map((event) => ({ turnId: event.turnId, payload: event.payload }));
}

function turnIdOf(h: Harness): unknown {
  return firstOfKind(h.fake.events(h.threadId), "turn.started")?.turnId;
}

test("each re-sent model request announces its retry on the turn with the exact detail", async () => {
  const h = await createHarness({
    script: [
      {
        kind: "message",
        content: [{ type: "text", text: "done" }],
        stopReason: "stop",
        retries: [
          { attempt: 1, maxRetries: 3, waitMs: 1000 },
          { attempt: 2, maxRetries: 3, waitMs: 1500.2 },
        ],
      },
    ],
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();

  // 대기 시간은 정수 ms로 올린다(detail 스키마)
  expect(retryNotices(h)).toEqual([
    {
      turnId: turnIdOf(h),
      payload: {
        status: "running",
        notice: { code: "provider_retry", detail: { attempt: 1, maxRetries: 3, waitMs: 1000 } },
      },
    },
    {
      turnId: turnIdOf(h),
      payload: {
        status: "running",
        notice: { code: "provider_retry", detail: { attempt: 2, maxRetries: 3, waitMs: 1501 } },
      },
    },
  ]);
  // 알림이 있어도 turn은 정상 끝난다
  expect(firstOfKind(h.fake.events(h.threadId), "turn.completed")?.payload).toMatchObject({
    status: "completed",
  });
});

test("the provider retry notice stays out of the durable record", async () => {
  const h = await createHarness({
    script: [
      {
        kind: "message",
        content: [{ type: "text", text: "done" }],
        stopReason: "stop",
        retries: [{ attempt: 1, maxRetries: 3, waitMs: 500 }],
      },
    ],
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  expect(retryNotices(h)).toHaveLength(1);
  expect(JSON.stringify(h.fake.events(h.threadId))).not.toContain("provider_retry");
});

test("a retry of the threshold compaction summary is announced on the same turn", async () => {
  const h = await createHarness({ script: [done("done")] });
  h.context.compaction.shouldQueue.push(true);
  h.context.compaction.summaryRetries = [{ attempt: 1, maxRetries: 2, waitMs: 2000 }];
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();

  expect(retryNotices(h)).toEqual([
    {
      turnId: turnIdOf(h),
      payload: {
        status: "running",
        notice: { code: "provider_retry", detail: { attempt: 1, maxRetries: 2, waitMs: 2000 } },
      },
    },
  ]);
});

test("a retry of the overflow recovery summary is announced on the same turn", async () => {
  const h = await createHarness({
    script: [{ kind: "error", message: "context_overflow: prompt is too long" }, done("done")],
  });
  h.context.compaction.overflowQueue.push("retry");
  h.context.compaction.summaryRetries = [{ attempt: 1, maxRetries: 2, waitMs: 750 }];
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();

  expect(retryNotices(h)).toEqual([
    {
      turnId: turnIdOf(h),
      payload: {
        status: "running",
        notice: { code: "provider_retry", detail: { attempt: 1, maxRetries: 2, waitMs: 750 } },
      },
    },
  ]);
});

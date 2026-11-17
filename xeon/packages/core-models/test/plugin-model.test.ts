import { describe, expect, test } from "bun:test";
import { t, tape } from "../src/testing/index.ts";
import type { PluginModelRequest } from "@fresnel/contracts/capabilities";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { createHarness, type Harness } from "./support/harness.ts";

// drive-isolation.md §1.2의 `model` 명령이 쓰는 completeForPlugin. 역할 judge, 가드와 사용량 귀속, 프로세스 안 재생을 본다.

const JUDGE_ONCE = tape("core-models/plugin-judge", [
  {
    role: "judge",
    response: {
      type: "message",
      content: [t.text("met")],
      stopReason: "stop",
      usage: { input: 6, output: 4 },
    },
  },
]);

const JUDGE_TWICE = tape("core-models/plugin-judge-twice", [
  { role: "judge", response: { type: "message", content: [t.text("first")], stopReason: "stop" } },
  { role: "judge", response: { type: "message", content: [t.text("second")], stopReason: "stop" } },
]);

/** 제공자 쪽 역할 표지. 테이프는 모델에서 역할을 정하므로 판정 역할의 테이프 줄을 맞춘다 */
const JUDGE_PROVIDER = { roleOf: () => "judge" as const };

function requestOf(h: Harness, requestId: string, scopeId = "judge-group"): PluginModelRequest {
  return {
    threadId: h.threadId,
    plugin: { name: "judge-group", scopeId },
    requestId,
    messages: [
      { role: "system", content: "Judge." },
      { role: "user", content: "Is it done?" },
    ],
  };
}

describe("completeForPlugin", () => {
  test("plays the judge role and returns the text, usage and stop reason, and the usage is attributed to the caller's scope", async () => {
    const h = createHarness({ tape: JUDGE_ONCE, provider: JUDGE_PROVIDER });
    const result = await h.service.completeForPlugin(requestOf(h, "m-1"));
    expect(result).toEqual({
      ok: true,
      value: {
        text: "met",
        usage: { input: 6, output: 4, total: 10 },
        stopReason: "stop",
        replayed: false,
      },
    });
    expect(
      h.service.usage.totals({ threadId: h.threadId, role: "judge", scopeId: "judge-group" }),
    ).toMatchObject({ calls: 1, input: 6, output: 4, totalTokens: 10 });
    h.player.assertExhausted();
  });

  test("the system message becomes the system prompt of the provider request, ahead of the user message", async () => {
    const h = createHarness({ tape: JUDGE_ONCE, provider: JUDGE_PROVIDER });
    await h.service.completeForPlugin(requestOf(h, "m-1"));
    const payload = h.fake.calls()[0]?.payload;
    expect(JSON.stringify(payload)).toContain("Judge.");
    expect(JSON.stringify(payload)).toContain("Is it done?");
  });

  test("the same scope and request id return the stored result in this process without a second provider call", async () => {
    const h = createHarness({ tape: JUDGE_ONCE, provider: JUDGE_PROVIDER });
    const first = await h.service.completeForPlugin(requestOf(h, "m-1"));
    const second = await h.service.completeForPlugin(requestOf(h, "m-1"));
    expect(first.ok).toBe(true);
    expect(second).toEqual({
      ok: true,
      value: {
        text: "met",
        usage: { input: 6, output: 4, total: 10 },
        stopReason: "stop",
        replayed: true,
      },
    });
    expect(h.fake.calls()).toHaveLength(1);
  });

  test("the same request id under another scope is a separate call", async () => {
    const h = createHarness({ tape: JUDGE_TWICE, provider: JUDGE_PROVIDER });
    const a = await h.service.completeForPlugin(requestOf(h, "m-1", "scope-a"));
    const b = await h.service.completeForPlugin(requestOf(h, "m-1", "scope-b"));
    expect(a).toMatchObject({ ok: true, value: { text: "first", replayed: false } });
    expect(b).toMatchObject({ ok: true, value: { text: "second", replayed: false } });
    expect(h.fake.calls()).toHaveLength(2);
  });

  test("the same scope and request id in another conversation is a separate call", async () => {
    const h = createHarness({ tape: JUDGE_TWICE, provider: JUDGE_PROVIDER });
    const other = fixedIdFactory(9000).next("thr");
    const first = await h.service.completeForPlugin(requestOf(h, "m-1"));
    const second = await h.service.completeForPlugin({ ...requestOf(h, "m-1"), threadId: other });
    expect(first).toMatchObject({ ok: true, value: { text: "first", replayed: false } });
    expect(second).toMatchObject({ ok: true, value: { text: "second", replayed: false } });
    expect(h.fake.calls()).toHaveLength(2);
  });

  test("a guard denial comes back as denied_by_guard, the provider is not called, and the guard is asked again on the same id", async () => {
    let guarded = 0;
    const h = createHarness({
      tape: JUDGE_ONCE,
      provider: JUDGE_PROVIDER,
      dispatcher: {
        beforeProviderRequest: (input) => Promise.resolve(input.payload),
        guardProviderRequest() {
          guarded += 1;
          return Promise.resolve({ block: true, reason: "no model calls" });
        },
      },
    });
    const denied = await h.service.completeForPlugin(requestOf(h, "m-1"));
    expect(denied).toEqual({
      ok: false,
      error: { kind: "denied_by_guard", message: "[fresnel:denied_by_guard] no model calls" },
    });
    expect(h.fake.calls()).toEqual([]);
    await h.service.completeForPlugin(requestOf(h, "m-1"));
    expect(guarded).toBe(2);
  });

  test("a provider error comes back as an error value and does not throw", async () => {
    const h = createHarness({
      provider: JUDGE_PROVIDER,
      tape: tape("core-models/plugin-judge-error", [
        {
          role: "judge",
          response: { type: "error", reason: "error", errorMessage: "upstream exploded" },
        },
      ]),
    });
    const failed = await h.service.completeForPlugin(requestOf(h, "m-1"));
    expect(failed).toEqual({
      ok: false,
      error: { kind: "provider_error", message: "upstream exploded" },
    });
  });
});

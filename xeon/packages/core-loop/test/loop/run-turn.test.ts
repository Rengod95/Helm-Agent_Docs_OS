import { expect, test } from "bun:test";
import { createHarness } from "../support/harness.ts";
import { countKind, firstOfKind } from "../support/inspect.ts";
import type { ScriptedResponse } from "../support/fake-models.ts";

// L1.loop.plan §5 run-turn 시험. 단계 실패는 값으로 돌아오고, 예기치 않은 예외도 같은 경로로 T6 failed에 이른다.

const callGo: ScriptedResponse = {
  kind: "message",
  content: [{ type: "toolCall", id: "c1", name: "go", arguments: {} }],
  stopReason: "toolUse",
};

test("a_failed_step_commit_ends_the_turn_as_failed_without_throwing", async () => {
  const h = await createHarness({ tools: [{ name: "go" }], script: [callGo] });
  h.fake.failBusyFor((key) => key.startsWith("resp:"), 99);
  const admitted = await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  expect(admitted.ok).toBe(true);
  await h.settle();
  const events = h.fake.events(h.threadId);
  expect(firstOfKind(events, "turn.completed")?.payload).toMatchObject({
    status: "failed",
    error: "loop_rejected",
  });
  expect(h.tools.executed).toEqual([]);
  expect(
    h.logs.records.some(
      (record) =>
        record.event === "loop.run_rejected" &&
        typeof record.fields["reason"] === "string" &&
        record.fields["reason"].startsWith("commit_failed"),
    ),
  ).toBe(true);
});

test("an_unexpected_exception_in_a_tool_step_is_contained_as_a_failed_turn", async () => {
  const h = await createHarness({
    tools: [
      {
        name: "go",
        run: () => Promise.reject(new Error("tool service broke")),
      },
    ],
    script: [callGo],
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const events = h.fake.events(h.threadId);
  expect(countKind(events, "turn.completed")).toBe(1);
  expect(firstOfKind(events, "turn.completed")?.payload).toMatchObject({
    status: "failed",
    error: "loop_rejected",
  });
  expect(h.loop.status(h.threadId)).toBe("idle");
});

test("a_model_that_cannot_be_resolved_fails_the_turn_with_a_logged_reason", async () => {
  const h = await createHarness({ script: [] });
  h.models.failResolve("model_not_found");
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  // 사용자가 설정으로 고칠 수 있는 원인이라 종결 오류에 종류와 메시지가 그대로 실린다
  expect(firstOfKind(h.fake.events(h.threadId), "turn.completed")?.payload).toMatchObject({
    status: "failed",
    error: "model_unavailable: model_not_found: fake",
  });
  expect(
    h.logs.records.some(
      (record) =>
        record.event === "loop.run_rejected" &&
        typeof record.fields["reason"] === "string" &&
        record.fields["reason"].startsWith("model_unavailable"),
    ),
  ).toBe(true);
});

// L1.loop.plan §5 resume_entries_use_main_path_step_functions (spec §9-16)
const textDone: ScriptedResponse = {
  kind: "message",
  content: [{ type: "text", text: "done" }],
  stopReason: "stop",
};
const callRead: ScriptedResponse = {
  kind: "message",
  content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
  stopReason: "toolUse",
};

interface Scenario {
  readonly entry: "request" | "tools" | "turn_end";
  readonly crash: (key: string) => boolean;
  readonly mode: "before" | "after";
}

function kindsWithoutResume(events: readonly { readonly kind: string }[]): string[] {
  return events.map((event) => event.kind).filter((kind) => kind !== "thread.resumed");
}

async function uninterruptedKinds(
  tools: Parameters<typeof createHarness>[0] & object,
  script: readonly ScriptedResponse[],
): Promise<string[]> {
  const h = await createHarness({ ...tools, script });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  return kindsWithoutResume(h.fake.events(h.threadId));
}

test("resume_entries_use_main_path_step_functions", async () => {
  const tools = { tools: [{ name: "read" }] };
  const baseline = await uninterruptedKinds(tools, [callRead, textDone]);
  expect(baseline.at(-1)).toBe("turn.completed");

  const cases: readonly Scenario[] = [
    // T4 뒤 끊김: 다음 요청부터 이어간다
    { entry: "request", crash: (key) => /^step:.*:0:end$/.test(key), mode: "after" },
    // 도구 결과 커밋 전 끊김: 의도 없는 호출을 이어서 실행한다
    // 크래시 술어는 응답 전에 걸리므로 호출 id는 접두어(`c1_<염>`)로 맞춘다
    {
      entry: "tools",
      crash: (key) => key.startsWith("tool:c1_") && key.endsWith(":result"),
      mode: "before",
    },
    // 마지막 단계 T4 뒤 T6 전 끊김: 요청 없이 turn_end부터 닫는다
    { entry: "turn_end", crash: (key) => /^turn:.*:end$/.test(key), mode: "before" },
  ];
  const checkScenario = async (scenario: Scenario): Promise<void> => {
    const h = await createHarness({ ...tools, script: [callRead, textDone] });
    if (scenario.mode === "before") h.fake.crashBefore(scenario.crash);
    else h.fake.crashAfter(scenario.crash);
    await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
    await h.settle();
    expect(countKind(h.fake.events(h.threadId), "turn.completed")).toBe(0);

    const h2 = await h.restart({ ...tools, script: [textDone] });
    const resumed = await h2.loop.resume(h2.threadId);
    expect(resumed.ok && resumed.value).toMatchObject({ status: "resumed", from: scenario.entry });
    await h2.settle();
    // 재개한 열은 끊기지 않은 열과 kind 순서가 같다(thread.resumed 하나만 더 있다)
    const events = h2.fake.events(h2.threadId);
    expect(countKind(events, "thread.resumed")).toBe(1);
    expect({ entry: scenario.entry, kinds: kindsWithoutResume(events) }).toEqual({
      entry: scenario.entry,
      kinds: baseline,
    });
  };
  await Promise.all(cases.map(checkScenario));
});

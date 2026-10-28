import { expect, test } from "bun:test";
import { createHarness } from "./support/harness.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";
import { countKind } from "./support/inspect.ts";

// L1A.5 (L1.tools.spec §4.1 규칙 5): advertise에 넘기는 activated는 tool_search 결과의 합집합이고, 재개 뒤에도 이벤트에서 같은 집합이 나온다.

const text = (value: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text: value }],
  stopReason: "stop",
});
const search = (id: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "toolCall", id, name: "tool_search", arguments: { query: "issue" } }],
  stopReason: "toolUse",
});

const tools = [
  {
    name: "tool_search",
    replay: "safe" as const,
    run: () =>
      Promise.resolve({ text: "found", structuredContent: { activated: ["gh_issue", "gh_pr"] } }),
  },
];

test("tool_search results are passed to the next advertise in the same turn", async () => {
  const h = await createHarness({ tools, script: [search("s1"), text("done")] });
  await h.loop.admit({ threadId: h.threadId, content: "find tools", via: "interactive" });
  await h.settle();
  expect(h.tools.advertisedActivated).toEqual([[], ["gh_issue", "gh_pr"]]);
});

test("after a restart the activated set is read back from the recorded results", async () => {
  const h = await createHarness({ tools, script: [search("s1"), text("never used")] });
  h.fake.crashAfter((key) => /^step:.*:0:end$/.test(key));
  await h.loop.admit({ threadId: h.threadId, content: "find tools", via: "interactive" });
  await h.settle();
  expect(countKind(h.fake.events(h.threadId), "effect.result")).toBe(1);

  const h2 = await h.restart({ tools, script: [text("resumed")] });
  const resumed = await h2.loop.resume(h2.threadId);
  expect(resumed.ok && resumed.value).toMatchObject({ status: "resumed", from: "request" });
  await h2.settle();
  expect(h2.tools.advertisedActivated).toEqual([["gh_issue", "gh_pr"]]);
});

test("a later turn sees the activations of an earlier turn", async () => {
  const h = await createHarness({ tools, script: [search("s1"), text("first"), text("second")] });
  await h.loop.admit({ threadId: h.threadId, content: "find tools", via: "interactive" });
  await h.settle();
  await h.loop.admit({ threadId: h.threadId, content: "again", via: "interactive" });
  await h.settle();
  expect(h.tools.advertisedActivated.at(-1)).toEqual(["gh_issue", "gh_pr"]);
});

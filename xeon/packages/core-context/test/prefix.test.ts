import { expect, test } from "bun:test";
import { canonicalJson } from "@xeon/contracts";
import type { SystemMessage } from "@xeon/contracts/conversation";
import { prefixHash, replaySystemMessages } from "../src/prefix.ts";
import { createContextService } from "../src/service.ts";
import {
  assembleOptions,
  assistantItem,
  sortedTools,
  systemItem,
  userItem,
} from "./support/builders.ts";
import { harness } from "./support/harness.ts";
import { present, valueOf } from "./support/result.ts";

async function firstAssembly() {
  const h = await harness();
  h.log.append("thread.started", {});
  h.log.append("item.recorded", userItem(h.log, "hello"));
  const opts = assembleOptions(h.log.ids);
  const assembled = valueOf(await h.service.assemble(h.log.threadId, h.log.leaf(), opts));
  return { h, opts, assembled };
}

test("prefix_bytes_stable_for_same_inputs", async () => {
  const { h, opts, assembled } = await firstAssembly();
  const again = valueOf(await h.service.assemble(h.log.threadId, h.log.leaf(), opts));
  expect(canonicalJson(again.messages[0])).toBe(canonicalJson(assembled.messages[0]));
  expect(again.prefix.prefixHash).toBe(assembled.prefix.prefixHash);
  expect(again.prefix.toolset).toBe(assembled.prefix.toolset);

  // 도구 입력 배열 순서를 섞어도, 절 키 순서가 달라도 같다
  const shuffled = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), {
      ...opts,
      tools: sortedTools.toReversed(),
      sections: { memory: "Memory notes", project: "Project notes" },
    }),
  );
  expect(canonicalJson(shuffled.messages[0])).toBe(canonicalJson(assembled.messages[0]));
  expect(shuffled.prefix.prefixHash).toBe(assembled.prefix.prefixHash);
});

test("prefix_has_base_prompt_sections_and_sorted_tools", async () => {
  const { assembled } = await firstAssembly();
  const [prefix] = assembled.messages;
  expect(prefix?.role).toBe("system");
  if (prefix?.role !== "system") return;
  expect(prefix.content).toBe("You are Xeon.");
  expect(Object.keys(prefix.sections ?? {})).toEqual(["memory", "project"]);
  expect(prefix.toolsAdded?.map((tool) => tool.name)).toEqual(["bash", "ls", "read"]);
  expect(assembled.prefix.prefixHash).toMatch(/^[0-9a-f]{64}$/);
  expect(assembled.prefix.toolset).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(assembled.prefix.recordedAt).toBeNull();
  expect(assembled.toolChange).toEqual({
    action: "readvertise",
    reason: "first_request",
    firstChangedIndex: 0,
  });
});

test("prefix_recorded_once_and_reused", async () => {
  const { h, opts, assembled } = await firstAssembly();
  expect(assembled.pendingItems).toHaveLength(1);
  const pending = present(assembled.pendingItems[0]);
  expect(pending.purpose).toBe("prefix");

  // loop가 단계 커밋에 접두 system item을 넣는다. 저장소는 JSON으로 왕복한다
  const stored: unknown = JSON.parse(JSON.stringify(systemItem(h.log, pending.message)));
  const recorded = h.log.append("item.recorded", stored);
  h.log.append("item.recorded", assistantItem(h.log, "hi there"));

  // 기본 프롬프트·도구·절이 바뀌어도 기록된 접두를 쓴다
  const later = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), {
      ...opts,
      basePrompt: "A different prompt",
      sections: { project: "changed" },
      tools: sortedTools.slice(0, 1),
    }),
  );
  // 접두는 그대로이고 달라진 도구와 절은 접두 뒤 변경 item으로 따로 나온다(§4.2, §4.3)
  expect(later.pendingItems.map((item) => item.purpose)).toEqual(["tool_change", "sections"]);
  expect(later.toolChange).toMatchObject({ action: "append" });
  expect(later.prefix.recordedAt).toBe(recorded.id);
  expect(later.prefix.prefixHash).toBe(assembled.prefix.prefixHash);
  expect(later.prefix.toolset).toBe(assembled.prefix.toolset);
  expect(canonicalJson(later.messages[0])).toBe(canonicalJson(assembled.messages[0]));
  // 접두는 messages[0] 한 번이고, 그 뒤 system 메시지는 이번 조립에서 덧붙인 변경 둘뿐이다
  expect(later.messages.filter((message) => message.role === "system")).toHaveLength(3);
});

test("prefix_same_after_restart", async () => {
  const { h, opts, assembled } = await firstAssembly();
  const pending = present(assembled.pendingItems[0]);
  h.log.append("item.recorded", systemItem(h.log, pending.message));

  // 프로세스를 다시 띄운 것처럼 서비스를 새로 만들어 같은 로그를 읽는다
  const restarted = createContextService({
    session: h.log,
    models: h.fake.models,
    ext: h.host.host,
  });
  const replay = valueOf(await restarted.assemble(h.log.threadId, h.log.leaf(), opts));
  expect(replay.prefix.prefixHash).toBe(assembled.prefix.prefixHash);
  expect(canonicalJson(replay.messages[0])).toBe(canonicalJson(assembled.messages[0]));
});

test("prefix_hoisted_when_user_item_precedes_it", async () => {
  const { h, opts, assembled } = await firstAssembly();
  const pending = present(assembled.pendingItems[0]);
  h.log.append("item.recorded", systemItem(h.log, pending.message));
  const result = valueOf(await h.service.assemble(h.log.threadId, h.log.leaf(), opts));
  expect(result.messages.map((message) => message.role)).toEqual(["system", "user"]);
});

test("prefix_timestamp_comes_from_leaf_not_clock", async () => {
  const { h, assembled } = await firstAssembly();
  const [prefix] = assembled.messages;
  expect(prefix?.timestamp).toBe(h.log.events.at(-1)?.recordedAt);
});

test("prefix_hash_changes_with_content", () => {
  const base: SystemMessage = { role: "system", content: "a", timestamp: 1 };
  expect(prefixHash(base)).toBe(prefixHash({ ...base }));
  expect(prefixHash(base)).not.toBe(prefixHash({ ...base, content: "b" }));
});

test("replay_system_messages_folds_deltas", () => {
  const prefix: SystemMessage = {
    role: "system",
    content: "base",
    sections: { a: "1", b: "2" },
    toolsAdded: [
      { name: "read", description: "r", parameters: {} },
      { name: "ls", description: "l", parameters: {} },
    ],
    timestamp: 5,
  };
  const delta: SystemMessage = {
    role: "system",
    content: "extra",
    sections: { a: null, c: "3" },
    toolsAdded: [{ name: "bash", description: "b", parameters: {} }],
    toolsRemoved: [{ name: "ls" }],
    timestamp: 9,
  };
  expect(replaySystemMessages([prefix])).toBe(prefix);
  expect(replaySystemMessages([])).toBeUndefined();
  const folded = replaySystemMessages([prefix, delta]);
  expect(folded?.content).toBe("base\n\nextra");
  expect(folded?.sections).toEqual({ b: "2", c: "3" });
  expect(folded?.toolsAdded?.map((tool) => tool.name)).toEqual(["read", "bash"]);
  expect(folded?.timestamp).toBe(5);
});

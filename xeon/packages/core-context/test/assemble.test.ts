import { expect, test } from "bun:test";
import type { EventId, Message, SystemMessage } from "@xeon/contracts/conversation";
import { convertToLlm } from "../src/convert.ts";
import {
  assembleOptions,
  assistantItem,
  compactedPayload,
  customItem,
  systemItem,
  userItem,
} from "./support/builders.ts";
import { harness, installContextHandler, type Harness } from "./support/harness.ts";
import { present, valueOf } from "./support/result.ts";

function blockText(
  content: string | readonly { readonly type: string; readonly text?: string }[],
): string {
  if (typeof content === "string") return content;
  return content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
}

function texts(messages: readonly Message[]): string[] {
  return messages.map((message) => {
    if (message.role === "assistant") return blockText(message.content);
    if (message.role === "system") return `system:${blockText(message.content)}`;
    return blockText(message.content);
  });
}

/** thread.started, 접두 기록, user/assistant 한 쌍, user 하나가 있는 로그 */
async function conversation(): Promise<{ h: Harness; prefixEvent: EventId }> {
  const h = await harness();
  h.log.append("thread.started", {});
  h.log.append("item.recorded", userItem(h.log, "question one"));
  const first = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  const prefix = present(first.pendingItems[0]);
  const recorded = h.log.append("item.recorded", systemItem(h.log, prefix.message));
  h.log.append("item.recorded", assistantItem(h.log, "answer one"));
  h.log.append("item.recorded", userItem(h.log, "question two"));
  return { h, prefixEvent: recorded.id };
}

test("context_point_chain_replaces_messages", async () => {
  const { h } = await conversation();
  const seen: (readonly Message[])[] = [];
  await installContextHandler(h.host, "ctx-rewrite", 0, (payload) => {
    seen.push(convertToLlm(payload.messages));
    return {
      messages: [
        ...payload.messages.slice(-1),
        { role: "user", content: "added by handler", timestamp: 9 },
      ],
    };
  });
  await installContextHandler(h.host, "ctx-second", 1, (_payload, current) => ({
    messages: [...current.messages, { role: "user", content: "second handler", timestamp: 10 }],
  }));

  const opts = assembleOptions(h.log.ids);
  const result = valueOf(await h.service.assemble(h.log.threadId, h.log.leaf(), opts));

  // 핸들러는 시스템 메시지를 받지 않는다
  expect(seen).toHaveLength(1);
  expect(present(seen[0]).every((message) => message.role !== "system")).toBe(true);
  expect(texts(present(seen[0]))).toEqual(["question one", "answer one", "question two"]);
  // 핸들러가 낸 배열이 조립 결과를 바꾸고, 접두가 맨 앞에 되돌아온다
  expect(texts(result.messages)).toEqual([
    "system:You are Xeon.",
    "question two",
    "added by handler",
    "second handler",
  ]);
  // 접두 정보는 핸들러 결과와 무관하게 기록된 접두의 것이다
  expect(result.prefix.recordedAt).not.toBeNull();
  expect(result.estimate.tokens).toBeGreaterThan(0);
});

test("context_point_handler_error_drops_only_that_patch", async () => {
  const { h } = await conversation();
  await installContextHandler(h.host, "ctx-throws", 0, () => {
    throw new Error("boom");
  });
  await installContextHandler(h.host, "ctx-invalid", 1, () => {
    // 타입은 맞지만 스키마를 어긴 패치: 시각이 유한한 수가 아니다
    return { messages: [{ role: "user", content: "nope", timestamp: Number.NaN }] };
  });
  const result = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  expect(texts(result.messages)).toEqual([
    "system:You are Xeon.",
    "question one",
    "answer one",
    "question two",
  ]);
});

test("context_point_without_handlers_keeps_messages_as_assembled", async () => {
  const { h } = await conversation();
  const result = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  expect(texts(result.messages)).toEqual([
    "system:You are Xeon.",
    "question one",
    "answer one",
    "question two",
  ]);
  expect(result.pendingItems).toHaveLength(0);
  expect(result.compactionHead).toBeNull();
  expect(result.warnings).toEqual([]);
  expect(result.cacheMarks.marks).toEqual([]);
});

test("context_point_change_folds_later_system_messages_into_the_leading_one", async () => {
  const { h } = await conversation();
  const delta: SystemMessage = {
    role: "system",
    content: "",
    toolsAdded: [{ name: "grep", description: "g", parameters: {} }],
    toolsRemoved: [{ name: "ls" }],
    timestamp: 50,
  };
  h.log.append("item.recorded", systemItem(h.log, delta));
  h.log.append("item.recorded", userItem(h.log, "question three"));

  // 핸들러가 없으면 도구 변경 메시지는 제자리에 남는다
  const plain = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  expect(plain.messages.map((message) => message.role)).toEqual([
    "system",
    "user",
    "assistant",
    "user",
    "system",
    "user",
  ]);

  // 핸들러가 배열을 바꾸면 접두와 변경을 합친 시스템 메시지 하나가 앞에 온다
  await installContextHandler(h.host, "ctx-trim", 0, (payload) => ({
    messages: payload.messages.slice(-1),
  }));
  const trimmed = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  expect(trimmed.messages.map((message) => message.role)).toEqual(["system", "user"]);
  const lead = present(trimmed.messages[0]);
  expect(lead.role).toBe("system");
  if (lead.role !== "system") return;
  expect(lead.toolsAdded?.map((tool) => tool.name)).toEqual(["bash", "read", "grep"]);
});

test("compaction_head_replaces_earlier_items_with_the_summary", async () => {
  const { h } = await conversation();
  // 컴팩션: question two부터 남기고, 같은 커밋에 새 접두를 덧붙인다
  const keptStart = present(h.log.events.find((event) => event.id === h.log.leaf()));
  const oldDelta: SystemMessage = {
    role: "system",
    content: "",
    toolsAdded: [{ name: "stale", description: "s", parameters: {} }],
    timestamp: 60,
  };
  // firstKept보다 앞에 있는 도구 변경은 새 접두가 이미 반영한다
  const before = h.log.events.length;
  expect(before).toBeGreaterThan(0);
  h.log.append("item.recorded", systemItem(h.log, oldDelta));
  h.log.append("item.recorded", userItem(h.log, "question three"));
  const compacted = h.log.append(
    "thread.compacted",
    compactedPayload(keptStart.id, "summary of one"),
  );
  const newPrefix: SystemMessage = {
    role: "system",
    content: "You are Xeon (rebuilt).",
    toolsAdded: [],
    timestamp: 70,
  };
  const prefixEvent = h.log.append("item.recorded", systemItem(h.log, newPrefix));
  h.log.append("item.recorded", assistantItem(h.log, "answer three"));

  const result = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  const rendered = texts(result.messages);
  expect(rendered[0]).toBe("system:You are Xeon (rebuilt).");
  expect(rendered[1]).toContain("<summary>\nsummary of one\n</summary>");
  expect(rendered.slice(2)).toEqual(["question two", "question three", "answer three"]);
  expect(rendered.join("|")).not.toContain("question one");
  expect(result.compactionHead).toEqual({ eventId: compacted.id, firstKeptEventId: keptStart.id });
  expect(result.prefix.recordedAt).toBe(prefixEvent.id);
  expect(result.pendingItems).toHaveLength(0);

  // 비파괴: leaf를 컴팩션 앞으로 옮기면 머리가 없는 가지가 되어 원문이 다시 조립된다
  const original = valueOf(
    await h.service.assemble(h.log.threadId, keptStart.id, assembleOptions(h.log.ids)),
  );
  expect(original.compactionHead).toBeNull();
  expect(texts(original.messages)).toEqual([
    "system:You are Xeon.",
    "question one",
    "answer one",
    "question two",
  ]);
});

test("compaction_without_new_prefix_builds_one_for_the_head", async () => {
  const { h } = await conversation();
  const keptStart = h.log.leaf();
  h.log.append("thread.compacted", compactedPayload(keptStart));
  const result = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  expect(result.pendingItems.map((item) => item.purpose)).toEqual(["prefix"]);
  expect(result.toolChange).toEqual({
    action: "readvertise",
    reason: "compaction",
    firstChangedIndex: 0,
  });
  expect(result.messages.map((message) => message.role)).toEqual(["system", "user", "user"]);
});

test("invalid_compaction_head_is_ignored_with_a_log", async () => {
  const { h } = await conversation();
  const missing = h.log.ids.next("evt");
  h.log.append("thread.compacted", compactedPayload(missing));
  const result = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  expect(result.compactionHead).toBeNull();
  expect(texts(result.messages)).toEqual([
    "system:You are Xeon.",
    "question one",
    "answer one",
    "question two",
  ]);
  expect(h.logged.map((call) => call.event)).toContain("context.compaction_head_invalid");
});

test("branch_summary_becomes_a_user_message_in_place", async () => {
  const { h } = await conversation();
  h.log.append("thread.branch_summarized", {
    fromEventId: h.log.leaf(),
    summary: "tried another way",
    details: null,
    usage: null,
  });
  h.log.append("item.recorded", customItem(h.log, { content: "hint", details: { a: 1 } }));
  const result = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  const rendered = texts(result.messages);
  expect(rendered).toHaveLength(6);
  expect(present(rendered[4])).toContain("tried another way");
  expect(rendered[5]).toBe("hint");
});

test("in_progress_items_are_left_out", async () => {
  const { h } = await conversation();
  const draft = assistantItem(h.log, "half written");
  h.log.append("item.recorded", { item: { ...draft.item, status: "in_progress" } });
  const result = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  expect(texts(result.messages)).not.toContain("half written");
});

test("unknown_leaf_is_branch_not_found", async () => {
  const { h } = await conversation();
  const result = await h.service.assemble(
    h.log.threadId,
    h.log.ids.next("evt"),
    assembleOptions(h.log.ids),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe("branch_not_found");
    expect(result.error.message).toContain("not on thread");
  }
});

test("malformed_item_payload_is_projection_failed", async () => {
  const { h } = await conversation();
  h.log.append("item.recorded", { item: { kind: "user" } });
  const result = await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe("projection_failed");
    expect(result.error.message).toContain("item.recorded");
  }
});

test("aborted_signal_stops_assembly", async () => {
  const { h } = await conversation();
  const controller = new AbortController();
  controller.abort();
  const result = await h.service.assemble(
    h.log.threadId,
    h.log.leaf(),
    assembleOptions(h.log.ids, { signal: controller.signal }),
  );
  expect(result).toEqual({
    ok: false,
    error: { kind: "aborted", message: "assemble aborted" },
  });
});

test("detached_events_are_hydrated_before_projection", async () => {
  const h = await harness();
  const sha256 = "a".repeat(64);
  h.log.append("thread.started", {});
  const big = h.log.append("item.recorded", userItem(h.log, "blob:sha256:" + sha256), {
    detached: [
      {
        pointer: "/item/message/content",
        ref: { type: "blob", sha256, size: 10, mediaType: null },
      },
    ],
  });
  valueOf(await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)));
  expect(h.log.hydrated).toEqual([big.id]);
});

test("volatile_layer_is_not_assembled_yet", async () => {
  const { h } = await conversation();
  const withVolatile = valueOf(
    await h.service.assemble(
      h.log.threadId,
      h.log.leaf(),
      assembleOptions(h.log.ids, { volatile: { date: "2026-10-21" } }),
    ),
  );
  const without = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  expect(texts(withVolatile.messages)).toEqual(texts(without.messages));
  expect(h.logged.map((call) => call.event)).toContain("context.volatile_ignored");
});

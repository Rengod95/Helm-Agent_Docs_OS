import { describe, expect, test } from "bun:test";
import { BRANCH_SUMMARY_PREAMBLE, BRANCH_SUMMARY_PROMPT } from "../src/compaction/prompts.ts";
import { assistantItem, userItem } from "./support/builders.ts";
import { harness } from "./support/harness.ts";
import { present, valueOf } from "./support/result.ts";
import { buildChat } from "./support/scenario.ts";

describe("branch_summary_draft_not_committed", () => {
  test("summarizes only what was left behind, with the branch prompt, the summary role and no commit", async () => {
    const h = await harness();
    const chat = await buildChat(h, 3, 50);
    const fork = present(chat.assistants[0]);
    // 가지 하나가 fork 뒤로 자라났다가 다른 가지로 돌아간다
    const side = h.log.append("item.recorded", userItem(h.log, "side branch question"), {
      parentId: fork,
    });
    const sideLeaf = h.log.append("item.recorded", assistantItem(h.log, "side branch answer"), {
      parentId: side.id,
    });
    const events = h.log.events.length;
    h.fake.replies.push({ kind: "text", text: "## Goal\nexplore" });

    const draft = valueOf(
      await h.service.summarizeBranch(
        h.log.threadId,
        sideLeaf.id,
        chat.assistants[2] ?? sideLeaf.id,
      ),
    );
    expect(draft.fromEventId).toBe(sideLeaf.id);
    expect(draft.summary).toBe(`${BRANCH_SUMMARY_PREAMBLE}## Goal\nexplore`);
    expect(draft.details).toEqual({ readFiles: [], modifiedFiles: [] });
    expect(draft.usage).not.toBeNull();
    expect(h.fake.calls).toHaveLength(1);
    expect(h.fake.calls[0]).toMatchObject({ role: "summary", cacheRetention: "none" });
    expect(h.fake.calls[0]?.prompt).toContain(BRANCH_SUMMARY_PROMPT);
    expect(h.fake.calls[0]?.prompt).toContain("[User]: side branch question");
    // 공통 조상까지의 대화는 요약하지 않는다
    expect(h.fake.calls[0]?.prompt).not.toContain("question 0");
    expect(h.log.events).toHaveLength(events);
    expect(h.log.commits).toHaveLength(0);
  });

  test("extra instructions are appended to the prompt", async () => {
    const h = await harness();
    const chat = await buildChat(h, 2, 50);
    const side = h.log.append("item.recorded", userItem(h.log, "side"), {
      parentId: present(chat.assistants[0]),
    });
    h.fake.replies.push({ kind: "text", text: "x" });
    valueOf(
      await h.service.summarizeBranch(h.log.threadId, side.id, present(chat.assistants[1]), {
        instructions: "mention the db",
      }),
    );
    expect(h.fake.calls[0]?.prompt).toContain("Additional focus: mention the db");
  });

  test("an empty abandoned branch gives the placeholder without a model call", async () => {
    const h = await harness();
    const chat = await buildChat(h, 2, 50);
    const draft = valueOf(
      await h.service.summarizeBranch(h.log.threadId, present(chat.assistants[0]), h.log.leaf()),
    );
    expect(draft.summary).toBe("No content to summarize");
    expect(draft.usage).toBeNull();
    expect(h.fake.calls).toHaveLength(0);
  });

  test("model failures and unknown events are context errors", async () => {
    const h = await harness();
    const chat = await buildChat(h, 2, 50);
    const side = h.log.append("item.recorded", userItem(h.log, "side"), {
      parentId: present(chat.assistants[0]),
    });
    h.fake.replies.push({ kind: "error", message: "boom" });
    expect(
      await h.service.summarizeBranch(h.log.threadId, side.id, present(chat.assistants[1])),
    ).toMatchObject({ ok: false, error: { kind: "summary_failed" } });
    h.fake.replies.push({ kind: "toolCall" });
    expect(
      await h.service.summarizeBranch(h.log.threadId, side.id, present(chat.assistants[1])),
    ).toMatchObject({ ok: false, error: { kind: "summary_has_tool_call" } });
    const unknown = h.log.ids.next("evt");
    expect(await h.service.summarizeBranch(h.log.threadId, unknown, side.id)).toMatchObject({
      ok: false,
      error: { kind: "branch_not_found" },
    });
  });
});

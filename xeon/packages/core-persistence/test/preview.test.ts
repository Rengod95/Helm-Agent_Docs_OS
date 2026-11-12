import { describe, expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { PREVIEW_LIMIT, previewOfContent } from "../src/preview.ts";
import {
  commitOrThrow,
  draftOf,
  endTurn,
  expectOk,
  newThread,
  openHarness,
  type Harness,
} from "./support/harness.ts";
import { itemAt } from "./support/branching.ts";
import { TEST_HOLDER_A } from "./support/sqlite-store.ts";

describe("previewOfContent", () => {
  test("keeps a short line as it is", () => {
    expect(previewOfContent("hello there")).toBe("hello there");
  });

  test("collapses newlines, tabs and runs of spaces to one space and trims the ends", () => {
    expect(previewOfContent("  first line\n\n  second\tline  \n")).toBe("first line second line");
    expect(previewOfContent("a\r\nb\rc")).toBe("a b c");
  });

  test("is undefined for empty, blank and image-only input", () => {
    expect(previewOfContent("")).toBeUndefined();
    expect(previewOfContent(" \n\t ")).toBeUndefined();
    expect(previewOfContent([])).toBeUndefined();
    expect(previewOfContent([{ type: "image" }])).toBeUndefined();
  });

  test("joins only the text blocks and never reads an attachment's content", () => {
    const content = [
      { type: "text", text: "first" },
      { type: "image", data: "SECRET-BYTES", mimeType: "image/png" },
      { type: "text", text: "second" },
      { type: "toolCall", text: "not a user block" },
    ];
    expect(previewOfContent(content)).toBe("first second");
    expect(previewOfContent(content)).not.toContain("SECRET");
  });

  test("keeps exactly 80 code points and cuts longer text to 79 plus an ellipsis", () => {
    expect(PREVIEW_LIMIT).toBe(80);
    const exact = "가".repeat(80);
    expect(previewOfContent(exact)).toBe(exact);
    const over = previewOfContent("가".repeat(81));
    expect(over).toBe(`${"가".repeat(79)}…`);
    expect(Array.from(over ?? "").length).toBe(80);
  });

  test("cuts by code points so an emoji is never split in half", () => {
    const cut = previewOfContent("😀".repeat(100));
    expect(cut).toBe(`${"😀".repeat(79)}…`);
    expect(/^(?:😀){79}…$/u.test(cut ?? "")).toBe(true);
    expect(Array.from(cut ?? "").length).toBe(80);
  });

  test("does not leave a space before the ellipsis when the cut lands on one", () => {
    const text = `${"a".repeat(78)} ${"b".repeat(30)}`;
    const cut = previewOfContent(text);
    expect(cut).toBe(`${"a".repeat(78)}…`);
    expect(Array.from(cut ?? "").length).toBe(79);
  });

  test("counts the collapsed text, not the raw text, when deciding whether to cut", () => {
    // 원문은 100자를 넘지만 줄인 글은 61자라 자르지 않는다
    const spaced = `${"a".repeat(30)}${" \n ".repeat(30)}${"b".repeat(30)}`;
    expect(spaced.length).toBeGreaterThan(PREVIEW_LIMIT);
    expect(previewOfContent(spaced)).toBe(`${"a".repeat(30)} ${"b".repeat(30)}`);
  });
});

/** 사용자 입력 한 번: turn 하나에 user item 하나를 기록하고 turn을 끝낸다. content는 그대로 payload에 든다 */
function userTurn(h: Harness, threadId: ThreadId, content: unknown): void {
  const turnId = h.ids.next("trn");
  const scope = { turnId, stepId: null };
  commitOrThrow(h, threadId, `turn:${turnId}:start`, () => ({
    kind: "append",
    drafts: [
      draftOf(h, h.loop, "turn.started", threadId, scope, {
        inputItemIds: [],
        requestId: null,
        scopeId: null,
      }),
      draftOf(h, h.loop, "item.recorded", threadId, scope, {
        item: {
          itemId: h.ids.next("itm"),
          status: "completed",
          kind: "user",
          message: { role: "user", content, timestamp: h.clock.now() },
          requestId: null,
        },
      }),
    ],
    checkpoint: null,
  }));
  endTurn(h, { threadId, turnId });
}

/** threads.list의 한 행. 없으면 시험이 틀린 것이라 던진다 */
function listedRow(h: Harness, threadId: ThreadId) {
  const row = h.service.threads.list({}).threads.find((r) => r.threadId === threadId);
  if (row === undefined) throw new Error(`thread ${threadId} is not listed`);
  return row;
}

describe("threads.list preview", () => {
  test("an untitled thread lists the cut preview of its first user message", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, null);
    const long = `첫 줄입니다.\n\n${"긴 문장 ".repeat(40)}`;
    userTurn(h, threadId, long);
    const row = listedRow(h, threadId);
    expect(row.title).toBeNull();
    expect(row.preview).toBe(previewOfContent(long));
    expect(row.preview?.startsWith("첫 줄입니다. 긴 문장")).toBe(true);
    expect(Array.from(row.preview ?? "").length).toBe(80);
    expect(row.preview?.endsWith("…")).toBe(true);
  });

  test("a titled thread carries the same preview; the title is still its own field", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, "사람이 정한 제목");
    userTurn(h, threadId, "처음 말");
    const row = listedRow(h, threadId);
    expect(row.title).toBe("사람이 정한 제목");
    expect(row.preview).toBe("처음 말");
  });

  test("a thread with no user text has no preview field at all", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, null);
    const row = listedRow(h, threadId);
    expect(row.title).toBeNull();
    expect(Object.hasOwn(row, "preview")).toBe(false);
  });

  test("an image-only first message gives no preview", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, null);
    userTurn(h, threadId, [{ type: "image", data: "SECRET-BYTES", mimeType: "image/png" }]);
    expect(Object.hasOwn(listedRow(h, threadId), "preview")).toBe(false);
  });

  test("a fork shows the origin's first message, and its own later input does not replace it", async () => {
    const h = await openHarness();
    const { threadId: origin } = newThread(h, null);
    userTurn(h, origin, "원본의 첫 입력");
    const forkId = h.ids.next("thr");
    expectOk(await h.service.threads.fork(origin, itemAt(h, origin, 0).itemId, forkId));
    const token = h.store.leases.acquire(`thread:${forkId}`, TEST_HOLDER_A);
    if (!token.ok) throw new Error("lease");
    expectOk(h.service.openForWrite(forkId, token.value));
    userTurn(h, forkId, "갈래에서 쓴 말");
    const row = listedRow(h, forkId);
    expect(row.title).toBeNull();
    expect(row.preview).toBe("원본의 첫 입력");
  });

  test("첨부 표식과 이미지 이름을 빼고, 문장부호만 남으면 없음 (DP-142)", () => {
    expect(
      previewOfContent([
        {
          type: "text",
          text: '색을 알려줘.\nred.png\n<attachment name="a.py">\nx = 1\n</attachment>',
        },
        { type: "image" },
      ]),
    ).toBe("색을 알려줘.");
    expect(previewOfContent(",")).toBeUndefined();
  });
});

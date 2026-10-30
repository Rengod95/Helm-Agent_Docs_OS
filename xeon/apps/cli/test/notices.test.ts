import { expect, test } from "bun:test";
import type { ScopeHandlerFailedPayload } from "@xeon/contracts/records";
import type { NotifyDeliveredParams, StreamChunkParams } from "@xeon/contracts/wire";
import {
  deliveredOpsOf,
  deliveredText,
  handlerFailedOpsOf,
  handlerFailedText,
  isShownFailure,
} from "../src/render/notices.ts";
import { handlerFailedChunk } from "./support/events.ts";
import { threadId } from "./support/ids.ts";

function payload(overrides: Partial<ScopeHandlerFailedPayload> = {}): ScopeHandlerFailedPayload {
  return {
    owner: "ext:acme-notes",
    point: "tool.before",
    result: "throw",
    message: "boom",
    consecutive: 1,
    ...overrides,
  };
}

function delivered(overrides: Partial<NotifyDeliveredParams> = {}): NotifyDeliveredParams {
  return {
    threadId: threadId(1),
    notice: {
      kind: "completed",
      title: "작업이 끝났다",
      body: null,
      seq: 7,
      sourceType: "dialog.notified",
    },
    deliveredAt: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

// ── scope.handler_failed ─────────────────────────────────────────────────

test("the first failure of an extension is one line with the prefix stripped", () => {
  expect(
    handlerFailedText({
      owner: "ext:acme-notes",
      point: "tool.before",
      result: "throw",
      message: "boom",
      consecutive: 1,
    }),
  ).toBe("확장 acme-notes의 tool.before 핸들러가 실패했다 (연속 1회): boom");
});

test("a hook owner is named as a hook, with its prefix stripped", () => {
  expect(
    handlerFailedText({
      owner: "hook:lint",
      point: "turn.end",
      result: "throw",
      message: "exit 2",
      consecutive: 1,
    }),
  ).toBe("훅 lint의 turn.end 핸들러가 실패했다 (연속 1회): exit 2");
});

test("an empty message leaves out the colon", () => {
  expect(handlerFailedText({ ...payload(), message: "" })).toBe(
    "확장 acme-notes의 tool.before 핸들러가 실패했다 (연속 1회)",
  );
});

test("the message is collapsed to one line and control characters become spaces", () => {
  expect(handlerFailedText({ ...payload(), message: "a\n  b\u001b[0m" })).toBe(
    "확장 acme-notes의 tool.before 핸들러가 실패했다 (연속 1회): a b [0m",
  );
});

test("a message of 120 characters is kept whole", () => {
  const message = "a".repeat(120);
  expect(handlerFailedText({ ...payload(), message })).toBe(
    `확장 acme-notes의 tool.before 핸들러가 실패했다 (연속 1회): ${message}`,
  );
});

test("a longer message is cut to its first 120 characters and ends with an ellipsis", () => {
  const message = "a".repeat(130);
  expect(handlerFailedText({ ...payload(), message })).toBe(
    `확장 acme-notes의 tool.before 핸들러가 실패했다 (연속 1회): ${"a".repeat(120)}…`,
  );
});

test("the cut counts code points, so an emoji is never split", () => {
  const message = "😀".repeat(121);
  expect(handlerFailedText({ ...payload(), message })).toBe(
    `확장 acme-notes의 tool.before 핸들러가 실패했다 (연속 1회): ${"😀".repeat(120)}…`,
  );
});

test("failures are shown at 1, then at every multiple of 5", () => {
  const shown = [1, 5, 10, 15].map(isShownFailure);
  const hidden = [2, 3, 4, 6, 9, 11].map(isShownFailure);
  expect(shown).toEqual([true, true, true, true]);
  expect(hidden).toEqual([false, false, false, false, false, false]);
});

test("a grouped-out failure has no text", () => {
  expect(handlerFailedText({ ...payload(), consecutive: 2 })).toBeUndefined();
  expect(handlerFailedText({ ...payload(), consecutive: 5 })).toBe(
    "확장 acme-notes의 tool.before 핸들러가 실패했다 (연속 5회): boom",
  );
});

test("a chunk of this thread's scope.handler_failed becomes one notice op", () => {
  const chunk: StreamChunkParams = {
    event: handlerFailedChunk({ thread: threadId(1), n: 0, afterSeq: 3, payload: payload() }),
  };
  expect(handlerFailedOpsOf(chunk, threadId(1))).toEqual([
    { kind: "notice", text: "확장 acme-notes의 tool.before 핸들러가 실패했다 (연속 1회): boom" },
  ]);
});

test("a chunk for another thread, another kind, an invalid payload, or a grouped-out failure gives no op", () => {
  const other: StreamChunkParams = {
    event: handlerFailedChunk({ thread: threadId(2), n: 0, afterSeq: 3, payload: payload() }),
  };
  expect(handlerFailedOpsOf(other, threadId(1))).toEqual([]);

  const invalid: StreamChunkParams = {
    event: handlerFailedChunk({
      thread: threadId(1),
      n: 1,
      afterSeq: 3,
      payload: payload({ consecutive: 0 }),
    }),
  };
  expect(handlerFailedOpsOf(invalid, threadId(1))).toEqual([]);

  const grouped: StreamChunkParams = {
    event: handlerFailedChunk({
      thread: threadId(1),
      n: 2,
      afterSeq: 3,
      payload: payload({ consecutive: 3 }),
    }),
  };
  expect(handlerFailedOpsOf(grouped, threadId(1))).toEqual([]);

  const progress: StreamChunkParams = {
    event: {
      ...handlerFailedChunk({ thread: threadId(1), n: 3, afterSeq: 3, payload: payload() }),
      kind: "item.updated",
    },
  };
  expect(handlerFailedOpsOf(progress, threadId(1))).toEqual([]);
});

// ── notify.delivered ─────────────────────────────────────────────────────

test("a notice with no body is one line, labelled by its kind", () => {
  expect(deliveredText(delivered(), threadId(1))).toBe("[완료] 작업이 끝났다");
});

test("a notice with a body puts the body on a second line", () => {
  const params = delivered({
    notice: {
      kind: "approval_waiting",
      title: "승인이 필요하다: bash",
      body: "rm -rf 임시 폴더",
      seq: 8,
      sourceType: "dialog.notified",
    },
  });
  expect(deliveredText(params, threadId(1))).toBe(
    "[승인 대기] 승인이 필요하다: bash\nrm -rf 임시 폴더",
  );
});

test("every notice kind has a Korean label", () => {
  const labels = (["question_waiting", "error", "background_completed"] as const).map((kind) =>
    deliveredText(
      delivered({ notice: { kind, title: "t", body: null, seq: 1, sourceType: "x" } }),
      threadId(1),
    ),
  );
  expect(labels).toEqual(["[질문 대기] t", "[오류] t", "[백그라운드 완료] t"]);
});

test("a notice with no thread, or with this thread, shows no suffix", () => {
  expect(deliveredText(delivered({ threadId: null }), threadId(1))).toBe("[완료] 작업이 끝났다");
  expect(deliveredText(delivered({ threadId: threadId(1) }), threadId(1))).toBe(
    "[완료] 작업이 끝났다",
  );
});

test("a notice of another thread ends its first line with (다른 대화)", () => {
  const params = delivered({
    threadId: threadId(2),
    notice: { kind: "error", title: "턴이 실패했다", body: "timeout", seq: 9, sourceType: "x" },
  });
  expect(deliveredText(params, threadId(1))).toBe("[오류] 턴이 실패했다 (다른 대화)\ntimeout");
});

test("control characters in the title and body are replaced, and an empty body adds no line", () => {
  const params = delivered({
    notice: { kind: "completed", title: "a\n b", body: "x\u0007y\r\nz", seq: 1, sourceType: "x" },
  });
  expect(deliveredText(params, threadId(1))).toBe("[완료] a b\nx y\nz");
  const empty = delivered({
    notice: { kind: "completed", title: "t", body: "", seq: 1, sourceType: "x" },
  });
  expect(deliveredText(empty, threadId(1))).toBe("[완료] t");
});

test("a delivered notice becomes one notice op", () => {
  expect(deliveredOpsOf(delivered(), threadId(1))).toEqual([
    { kind: "notice", text: "[완료] 작업이 끝났다" },
  ]);
});

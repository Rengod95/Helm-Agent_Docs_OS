import { describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { WIRE_ERRORS } from "@fresnel/contracts/wire";
import { evt, STORE } from "../state/helpers.ts";
import { compactNoticeOf } from "../../src/views/thread-compact.ts";

describe("compactNoticeOf", () => {
  test("요약했으면 엔진이 준 요약 전 토큰 수를 싣는다", () => {
    expect(
      compactNoticeOf(
        ok({
          status: "compacted",
          eventId: evt(1),
          tokensBefore: 12_500,
          fromExtension: null,
          position: { storeId: STORE, seq: 3 },
        }),
      ),
    ).toEqual({ tone: "success", id: "desktop.threads.compact.done", args: { tokens: 12_500 } });
  });
  test("요약할 것이 없으면 이유별 안내다", () => {
    expect(compactNoticeOf(ok({ status: "skipped", why: "disabled" }))).toEqual({
      tone: "info",
      id: "desktop.threads.compact.skipped.disabled",
    });
    expect(compactNoticeOf(ok({ status: "skipped", why: "nothing_to_summarize" }))).toEqual({
      tone: "info",
      id: "desktop.threads.compact.skipped.nothing",
    });
    expect(compactNoticeOf(ok({ status: "skipped", why: "last_entry_is_compaction" }))).toEqual({
      tone: "info",
      id: "desktop.threads.compact.skipped.already",
    });
  });
  test("실패는 이유별 문장이다", () => {
    expect(
      compactNoticeOf(err({ kind: "rejected", code: WIRE_ERRORS["thread.compactFailed"].code })),
    ).toEqual({ tone: "danger", id: "desktop.threads.compact.failed.summary" });
    expect(compactNoticeOf(err({ kind: "rejected", code: WIRE_ERRORS["turn.busy"].code }))).toEqual(
      { tone: "danger", id: "desktop.threads.compact.failed.busy" },
    );
    expect(compactNoticeOf(err({ kind: "offline" }))).toEqual({
      tone: "danger",
      id: "desktop.threads.menu.failed.offline",
    });
    expect(compactNoticeOf(err({ kind: "failed" }))).toEqual({
      tone: "danger",
      id: "desktop.threads.compact.failed",
    });
  });
});

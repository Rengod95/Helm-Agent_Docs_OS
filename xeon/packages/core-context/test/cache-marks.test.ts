import { describe, expect, test } from "bun:test";
import type { Message } from "@xeon/contracts/conversation";
import type { CachePolicy } from "@xeon/contracts/services";
import { computeCacheMarks } from "../src/cache-marks.ts";
import { COMPACTION_SUMMARY_PREFIX } from "../src/convert.ts";
import { cachePolicy } from "./support/builders.ts";

const prefix: Message = { role: "system", content: "base", timestamp: 1 };
const summary: Message = {
  role: "user",
  content: [{ type: "text", text: `${COMPACTION_SUMMARY_PREFIX}s\n</summary>` }],
  timestamp: 2,
};
const question: Message = { role: "user", content: "q", timestamp: 3 };

function policy(maxBreakpoints: number): CachePolicy {
  return { ...cachePolicy, maxBreakpoints };
}

describe("cache_marks_respect_policy_cap", () => {
  test("the four default sites, with summary and tail pointing at messages", () => {
    expect(computeCacheMarks(policy(4), [prefix, summary, question]).marks).toEqual([
      { site: "system", messageIndex: null },
      { site: "tools", messageIndex: null },
      { site: "summary", messageIndex: 1 },
      { site: "tail", messageIndex: 2 },
    ]);
  });

  test("without a compaction summary there are three marks", () => {
    expect(computeCacheMarks(policy(4), [prefix, question]).marks).toEqual([
      { site: "system", messageIndex: null },
      { site: "tools", messageIndex: null },
      { site: "tail", messageIndex: 1 },
    ]);
  });

  test("a cap of 2 keeps only system and tools, a cap of 3 drops the tail", () => {
    expect(
      computeCacheMarks(policy(2), [prefix, summary, question]).marks.map((m) => m.site),
    ).toEqual(["system", "tools"]);
    expect(
      computeCacheMarks(policy(3), [prefix, summary, question]).marks.map((m) => m.site),
    ).toEqual(["system", "tools", "summary"]);
  });

  test("the tail is the last user or system message and never repeats the summary", () => {
    const assistantLast: Message = {
      role: "assistant",
      content: [{ type: "text", text: "a" }],
      api: "x",
      provider: "x",
      model: "x",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 4,
    };
    expect(computeCacheMarks(policy(4), [prefix, question, assistantLast]).marks).toContainEqual({
      site: "tail",
      messageIndex: 1,
    });
    // 요약이 마지막 사용자 메시지이면 tail은 생략한다
    expect(computeCacheMarks(policy(4), [prefix, summary]).marks.map((m) => m.site)).toEqual([
      "system",
      "tools",
      "summary",
    ]);
  });

  test("a policy without sites (no retention) has no marks", () => {
    expect(computeCacheMarks({ ...cachePolicy, sites: [] }, [prefix, question]).marks).toEqual([]);
  });
});

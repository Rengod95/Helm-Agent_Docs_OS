import { expect, test } from "bun:test";
import {
  argTokensOf,
  jaccardOf,
  similarNotCaughtOf,
  SIMILAR_MAX,
  type SimilarCall,
} from "../../../src/assembly/backtest/similar.ts";

// 비슷하지만 못 잡은 호출(§4.8 규칙 51). 같은 대상이 먼저이고, 없으면 같은 도구에서 토큰 겹침이 0.6 이상인 것이다.

function call(id: string, overrides: Partial<SimilarCall> = {}): SimilarCall {
  return {
    toolCallId: id,
    tool: "bash",
    targetKey: null,
    argTokens: [],
    role: "passed",
    ...overrides,
  };
}

test("the argument tokens are lowercase words of two or more characters, first-seen order, no repeats", () => {
  expect(argTokensOf({ b: "Rm -rf /tmp/Foo", a: "x ls" })).toEqual([
    "ls",
    "rm",
    "rf",
    "tmp",
    "foo",
  ]);
  expect(argTokensOf({ n: 3, list: ["a"] })).toEqual([]);
  expect(argTokensOf({ s: "ab ab" })).toEqual(["ab"]);
  expect(argTokensOf({ long: "a".repeat(70) })).toEqual(["a".repeat(64)]);
  const many = Array.from({ length: 80 }, (_, i) => `tok${i}`).join(" ");
  expect(argTokensOf({ s: many })).toHaveLength(64);
});

test("the Jaccard overlap counts shared tokens over the union, and is zero for two empty lists", () => {
  expect(jaccardOf(["a", "b", "c"], ["a", "b", "d"])).toBe(0.5);
  expect(jaccardOf(["a"], ["a"])).toBe(1);
  expect(jaccardOf([], [])).toBe(0);
});

test("a passed call with the same tool and target as a stopped call is same_tool_same_target with no score", () => {
  const found = similarNotCaughtOf([
    call("blocked", { role: "stopped", targetKey: "t1" }),
    call("passed", { targetKey: "t1" }),
  ]);
  expect(found).toEqual([
    { toolCallId: "passed", similarTo: "blocked", why: "same_tool_same_target", score: null },
  ]);
});

test("without a shared target, the overlap of argument tokens at 0.6 or more is arg_overlap with its score", () => {
  const tokens = ["rm", "tmp", "build", "cache"];
  const found = similarNotCaughtOf([
    call("blocked", { role: "stopped", argTokens: tokens }),
    call("near", { argTokens: ["rm", "tmp", "build", "logs"] }),
    call("far", { argTokens: ["ls", "home"] }),
    call("other-tool", { tool: "read", argTokens: tokens }),
  ]);
  expect(found).toEqual([
    { toolCallId: "near", similarTo: "blocked", why: "arg_overlap", score: 0.6 },
  ]);
});

test("a passed call takes the best stopped call of its tool, and calls the candidate stopped or failed are not compared", () => {
  const found = similarNotCaughtOf([
    call("weak", { role: "stopped", argTokens: ["a", "b", "c", "d", "e"] }),
    call("strong", { role: "stopped", argTokens: ["a", "b", "c", "d"] }),
    call("passed", { argTokens: ["a", "b", "c", "d"] }),
    call("failed", { role: "other", argTokens: ["a", "b", "c", "d"] }),
  ]);
  expect(found).toEqual([
    { toolCallId: "passed", similarTo: "strong", why: "arg_overlap", score: 1 },
  ]);
});

test("the list keeps at most twenty entries", () => {
  const stopped = call("blocked", { role: "stopped", targetKey: "t" });
  const passed = Array.from({ length: 25 }, (_, i) => call(`p${i}`, { targetKey: "t" }));
  expect(SIMILAR_MAX).toBe(20);
  expect(similarNotCaughtOf([stopped, ...passed])).toHaveLength(20);
});

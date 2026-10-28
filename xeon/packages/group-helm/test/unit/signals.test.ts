import { expect, test } from "bun:test";
import {
  SIGNAL_DEFAULTS,
  decideAction,
  extractTerms,
  inquiryIdFrom,
  observeToolEnd,
  openTally,
  settleTurn,
  type HelmTurnTally,
  type ToolExecutionEndView,
} from "../../src/signals.ts";
import { INITIAL_HELM_STATE, INQUIRY_ID_PATTERN } from "../../src/state.ts";

function end(id: string, overrides: Partial<ToolExecutionEndView> = {}): ToolExecutionEndView {
  return { toolCallId: id, toolName: "bash", isError: false, result: "ok", ...overrides };
}

function observeAll(views: readonly ToolExecutionEndView[]): HelmTurnTally {
  return views.reduce(
    (tally, view) => observeToolEnd(tally, view, SIGNAL_DEFAULTS),
    openTally(INITIAL_HELM_STATE.watch),
  );
}

const failing = (id: string, line: number): ToolExecutionEndView =>
  end(id, {
    isError: true,
    result: {
      content: [{ type: "text", text: `error at /tmp/x${String(line)}.ts line ${String(line)}` }],
    },
  });

test("signals.stuck-after-n-same-errors", () => {
  const three = observeAll([failing("a", 1), failing("b", 2), failing("c", 3)]);
  expect(three.crossed).toEqual(["stuck"]);
  expect(three.evidence.stuck).toEqual({ toolName: "bash", count: 3 });
  const broken = observeAll([failing("a", 1), failing("b", 2), end("ok"), failing("c", 3)]);
  expect(broken.crossed).toEqual([]);
  const four = observeAll([1, 2, 3, 4].map((n) => failing(`e${String(n)}`, n)));
  expect(four.crossed).toEqual(["stuck"]);
  expect(four.watch.errorRun).toBe(4);
});

test("signals.repeat-after-n-same-calls", () => {
  const call = (id: string, input: Record<string, number | string>): ToolExecutionEndView =>
    end(id, { toolName: "grep", input });
  const same = observeAll([
    call("a", { pattern: "x", n: 1 }),
    call("b", { n: 1, pattern: "x" }),
    call("c", { pattern: "x", n: 1 }),
  ]);
  expect(same.crossed).toEqual(["repeat"]);
  const differs = observeAll([
    call("a", { pattern: "x" }),
    call("b", { pattern: "y" }),
    call("c", { pattern: "x" }),
  ]);
  expect(differs.crossed).toEqual([]);
  const noInput = observeAll([end("a"), end("b"), end("c")]);
  expect(noInput.crossed).toEqual([]);
  expect(noInput.watch.callRun).toBe(0);
});

test("signals.newdomain-on-knowledge-misses", () => {
  const miss = (id: string): ToolExecutionEndView =>
    end(id, { toolName: "knowledge_search", result: { structuredContent: { hits: [] } } });
  const hit = end("h", {
    toolName: "knowledge_search",
    result: { structuredContent: { hits: [{}] } },
  });
  const two = observeAll([miss("a"), hit, miss("b")]);
  expect(settleTurn(two, SIGNAL_DEFAULTS).crossed).toEqual(["newDomain"]);
  const one = observeAll([miss("a")]);
  expect(settleTurn(one, SIGNAL_DEFAULTS).crossed).toEqual([]);
  expect(settleTurn({ ...one, promptTerms: ["rust"] }, SIGNAL_DEFAULTS).crossed).toEqual([
    "newDomain",
  ]);
  // 다음 turn의 집계표는 0에서 다시 시작한다
  expect(openTally(two.watch).knowledgeMisses).toBe(0);
});

test("signals.pure-query-no-side-effect: the same payload counted twice changes nothing", () => {
  const once = observeAll([failing("a", 1)]);
  const twice = observeToolEnd(once, failing("a", 1), SIGNAL_DEFAULTS);
  expect(twice).toBe(once);
  const three = observeAll([failing("a", 1), failing("a", 1), failing("b", 2)]);
  expect(three.watch.errorRun).toBe(2);
});

test("signals.extract-terms-rules", () => {
  const prompt =
    "`LRU cache` 와 HTTP2, getUserName, event-loop 그리고 가비지컬렉션 설계 방법 hello";
  expect(extractTerms(prompt)).toEqual([
    "lru cache",
    "lru",
    "http2",
    "getusername",
    "event-loop",
    "가비지컬렉션",
  ]);
  expect(extractTerms("가나다 가나다 `x`")).toEqual(["x", "가나다"]);
  const many = Array.from({ length: 30 }, (_, index) => `\`t${String(index)}\``).join(" ");
  expect(extractTerms(many)).toHaveLength(16);
  expect(extractTerms(`\`${"q".repeat(100)}\``)[0]).toHaveLength(64);
});

test("inquiryIdFrom is deterministic and matches the id pattern", () => {
  const id = inquiryIdFrom("trn_ABC");
  expect(id).toMatch(new RegExp(INQUIRY_ID_PATTERN));
  expect(inquiryIdFrom("trn_ABC")).toBe(id);
  expect(inquiryIdFrom("trn_ABD")).not.toBe(id);
});

test("decideAction follows the autoStart table", () => {
  const seed = {
    turnId: "trn_1",
    evidence: { stuck: { toolName: "bash", count: 3 } },
    terms: ["lru", "cache"],
  };
  expect(decideAction(INITIAL_HELM_STATE, ["stuck"], "off", seed)).toEqual({ action: "recorded" });
  expect(decideAction(INITIAL_HELM_STATE, ["stuck"], "suggest", seed)).toEqual({
    action: "suggested",
  });
  const auto = decideAction(INITIAL_HELM_STATE, ["stuck"], "auto", seed);
  expect(auto).toEqual({
    action: "requested",
    pending: {
      inquiryId: inquiryIdFrom("trn_1"),
      topic: "bash: lru, cache",
      source: "signal",
      signal: "stuck",
    },
  });
  const busy = { ...INITIAL_HELM_STATE, phase: "explore" as const };
  expect(decideAction(busy, ["stuck"], "auto", seed)).toEqual({ action: "recorded" });
  const waiting = { ...INITIAL_HELM_STATE, pending: auto.pending ?? null };
  expect(decideAction(waiting, ["stuck"], "auto", seed)).toEqual({ action: "recorded" });
  expect(decideAction(INITIAL_HELM_STATE, [], "auto", seed)).toEqual({ action: "recorded" });
});

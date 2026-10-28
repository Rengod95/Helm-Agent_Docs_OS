import { expect, test } from "bun:test";
import { describePlan, planRecording, recorderExit } from "./tape-record.ts";

test("a scenario name gives the recorded tape path; --yes marks it confirmed", () => {
  expect(planRecording(["chat-first"], false)).toEqual({
    ok: true,
    plan: {
      scenario: "chat-first",
      out: "packages/core-models/test/tapes/recorded/chat-first.tape.jsonl",
      confirmed: false,
    },
  });
  expect(planRecording(["chat-first"], true)).toEqual({
    ok: true,
    plan: {
      scenario: "chat-first",
      out: "packages/core-models/test/tapes/recorded/chat-first.tape.jsonl",
      confirmed: true,
    },
  });
});

test("missing, extra or malformed scenario names are rejected", () => {
  expect(planRecording([], true)).toEqual({
    ok: false,
    error: "usage: tape-record <scenario> [--yes]",
  });
  expect(planRecording(["a", "b"], true)).toEqual({
    ok: false,
    error: "usage: tape-record <scenario> [--yes]",
  });
  expect(planRecording(["../evil"], true)).toEqual({
    ok: false,
    error: 'scenario "../evil" must be lower-case words joined by hyphens',
  });
});

test("the confirmation text names the cost, the output file and --yes", () => {
  const plan = planRecording(["web-search"], false);
  if (!plan.ok) throw new Error(plan.error);
  const text = describePlan(plan.plan);
  expect(text).toContain("real cost");
  expect(text).toContain("packages/core-models/test/tapes/recorded/web-search.tape.jsonl");
  expect(text).toContain("--yes");
});

test("the recorder's missing-key exit stays 2, other failures become 1", () => {
  expect([0, 1, 2, 3, 137].map(recorderExit)).toEqual([0, 1, 2, 1, 1]);
});

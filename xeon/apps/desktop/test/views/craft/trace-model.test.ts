import { describe, expect, test } from "bun:test";
import type { TurnRecordDeltaParams } from "@fresnel/contracts/wire";
import {
  drivePathOf,
  hookEntriesOf,
  hookPlaceOf,
  isFault,
  loadedOf,
  outcomeCountsOf,
  spansOf,
  stepMarksOf,
  totalsOf,
  turnLengthOf,
  usageOf,
  type Span,
} from "../../../src/views/craft/trace/model.ts";
import { sampleRecord } from "../../../src/views/craft/trace/sample.ts";
import { liveHookKey, withDelta } from "../../../src/views/craft/trace/source.ts";
import { packRows } from "../../../src/views/craft/trace/timeline.tsx";

describe("hook places", () => {
  test("a hook name maps to its block and side from the engine's block model, never shown by its inner name", () => {
    expect(hookPlaceOf("tool.call.before")).toEqual({
      kind: "block",
      block: "tools",
      side: "before",
    });
    expect(hookPlaceOf("tool.result")).toEqual({ kind: "block", block: "tools", side: "after" });
    expect(hookPlaceOf("request.model.after")).toEqual({
      kind: "block",
      block: "model",
      side: "event",
    });
    expect(hookPlaceOf("input.user.before")).toMatchObject({
      kind: "boundary",
      id: "input-received",
    });
    expect(hookPlaceOf("no.such.hook")).toEqual({ kind: "unknown" });
  });
});

describe("a finished turn", () => {
  const record = sampleRecord("trn_1", false);

  test("hook runs from the turn, its steps and its calls come in time order with their outcomes", () => {
    const entries = hookEntriesOf(record);
    expect(entries.map((e) => [e.run.atMs, e.run.plugin, e.outcome])).toEqual([
      [0, "repo-guard", "pass"],
      [40, "review-flow", "pass"],
      [160, "docs-voice", "modified"],
      [2_600, "repo-guard", "pass"],
      [2_620, "repo-guard", "blocked"],
      [6_000, "repo-guard", "pass"],
      [6_020, "review-flow", "asked"],
      [6_050, "commit-style", "modified"],
      [10_270, "issue-sync", "timeout"],
      [15_120, "review-flow", "pass"],
    ]);
    expect(outcomeCountsOf(entries)).toEqual([
      { outcome: "blocked", n: 1 },
      { outcome: "asked", n: 1 },
      { outcome: "modified", n: 2 },
      { outcome: "timeout", n: 1 },
      { outcome: "pass", n: 5 },
    ]);
    expect([isFault("timeout"), isFault("blocked")]).toEqual([true, false]);
  });

  test("spans: a blocked call has no tool span, an answered ask has a wait span, the Drive frame spans its lease", () => {
    const spans = spansOf(record);
    expect(
      spans.filter((s) => s.lane === "tool").map((s) => [s.label, s.startMs, s.endMs]),
    ).toEqual([
      ["read_file", 2_640, 2_760],
      ["git_commit", 9_400, 10_260],
      ["web_search", 6_100, 8_000],
    ]);
    expect(spans.filter((s) => s.lane === "ask").map((s) => [s.startMs, s.endMs])).toEqual([
      [6_200, 9_400],
      [6_042, 9_242],
    ]);
    expect(
      spans.filter((s) => s.lane === "drive").map((s) => [s.label, s.startMs, s.endMs]),
    ).toEqual([["review-flow", 2_900, 14_900]]);
    expect(turnLengthOf(record, spans)).toBe(15_200);
    expect(stepMarksOf(record)).toEqual([
      { step: 0, atMs: 180 },
      { step: 1, atMs: 2_900 },
      { step: 2, atMs: 12_400 },
    ]);
  });

  test("loaded material counts each distinct item once (steps resend the same context), biggest first, and flags a cut-off one", () => {
    const loaded = loadedOf(record);
    expect(loaded.map((g) => [g.plugin, g.instruction, g.skills, g.tools, g.truncated])).toEqual([
      ["review-flow", 1_460, 380, 940, false],
      ["docs-voice", 2_240, 0, 0, true],
      ["web-research", 0, 240, 1_720, false],
      ["repo-guard", 820, 0, 0, false],
      ["commit-style", 610, 0, 0, false],
      ["issue-sync", 0, 0, 520, false],
    ]);
  });

  test("totals add every model call, and Drive usage is a share of its limits", () => {
    expect(totalsOf(record)).toEqual({
      input: 14_200 + 16_300 + 18_400,
      output: 640 + 760 + 880,
      cacheRead: 23_600,
      cacheWrite: 14_200,
      modelCalls: 3,
      toolCalls: 4,
    });
    const frame = drivePathOf(record.frames)[0];
    expect(frame === undefined ? null : usageOf(frame)).toEqual({
      turns: 2 / 6,
      tokens: 0.39,
      spawns: null,
    });
  });
});

describe("a running turn", () => {
  test("its length is the latest span end, and a delta for the same turn lands in the record", () => {
    const record = sampleRecord("trn_live", true);
    expect(turnLengthOf(record, spansOf(record))).toBe(12_400);
    const delta: TurnRecordDeltaParams = {
      sub: "sub_1",
      threadId: record.threadId,
      turnId: "trn_live",
      stepIndex: null,
      rows: [{ kind: "turn", status: "completed", complete: true }],
      final: true,
    };
    const next = withDelta({ record, pending: [] }, delta);
    expect([next.record.status, next.record.complete, next.stale]).toEqual([
      "completed",
      true,
      false,
    ]);
    expect(withDelta({ record, pending: [] }, { ...delta, turnId: "trn_other" }).record).toBe(
      record,
    );
  });

  test("a Hook row that ends before its step is held, shown, and leaves once the step lands", () => {
    const record = sampleRecord("trn_live", true);
    const last = record.steps.at(-1);
    const run = record.steps.flatMap((st) => st.hooks).at(0);
    if (last === undefined || run === undefined) throw new Error("sample record has no step hook");
    const stepIndex = last.stepIndex + 1;
    const early = { ...run, seq: 900, toolCallId: null, subject: {} };
    const base = { sub: "sub_1", threadId: record.threadId, turnId: "trn_live", final: false };
    const held = withDelta(
      { record, pending: [] },
      { ...base, stepIndex, rows: [{ kind: "hook", stepIndex, hook: early }] },
    );
    expect([held.stale, held.pending.map((p) => [p.stepIndex, liveHookKey(p.run)])]).toEqual([
      false,
      [[stepIndex, `900:${run.registrationId}`]],
    ]);
    const landed = withDelta(held, {
      ...base,
      stepIndex,
      rows: [{ kind: "step", stepIndex, step: { ...last, stepIndex, hooks: [early], calls: [] } }],
    });
    expect([landed.pending.length, landed.record.steps.at(-1)?.hooks.map((h) => h.seq)]).toEqual([
      0,
      [900],
    ]);
  });

  test("a non-Hook row without its place still asks for a re-read", () => {
    const record = sampleRecord("trn_live", true);
    const call = record.steps.flatMap((st) => st.calls).at(0);
    if (call === undefined) throw new Error("sample record has no call");
    const out = withDelta(
      { record, pending: [] },
      {
        sub: "sub_1",
        threadId: record.threadId,
        turnId: "trn_live",
        stepIndex: 99,
        rows: [{ kind: "call", stepIndex: 99, call }],
        final: false,
      },
    );
    expect(out.stale).toBe(true);
  });
});

function span(id: string, startMs: number, endMs: number): Span {
  return {
    id,
    lane: "tool",
    startMs,
    endMs,
    label: id,
    plugin: null,
    outcome: null,
    step: null,
    depth: 0,
  };
}

describe("timeline packing", () => {
  test("overlapping spans in one lane move down a row, and rows stop at the cap", () => {
    const rows = packRows(
      [span("a", 0, 10), span("b", 5, 15), span("c", 12, 20), span("d", 6, 8)],
      20,
      0,
      2,
    );
    expect([...rows.entries()]).toEqual([
      ["a", 0],
      ["b", 1],
      ["d", 1],
      ["c", 0],
    ]);
  });
});

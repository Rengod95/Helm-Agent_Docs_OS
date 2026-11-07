import { expect, test } from "bun:test";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import { resumeBandClosed, resumeBandOf, rowResumable } from "../../src/views/resume-band-model.ts";
import { chipInputs } from "../../src/views/composer-model.ts";
import type { QueuedInput } from "../../src/state/engine/index.ts";
import { evt, thr, trn } from "../state/helpers.ts";

function summary(patch: Partial<ThreadSummary>): ThreadSummary {
  return {
    threadId: thr(1),
    title: "t",
    status: "idle",
    workspace: null,
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
    headSeq: 1,
    forkedFrom: null,
    resumable: null,
    queuedInputs: 0,
    pendingApprovals: 0,
    ...patch,
  };
}

test("a leftover recovery marker shows the crashed band even while the status says running", () => {
  const view = resumeBandOf(
    summary({
      status: "running",
      resumable: {
        turnId: trn(1),
        runningSince: "2026-11-07T00:00:00.000Z",
        resumeAttempts: 0,
      },
    }),
    0,
    0,
  );
  expect(view).toEqual({
    kind: "crashed",
    runningSince: "2026-11-07T00:00:00.000Z",
    turnId: trn(1),
  });
});

test("queued input left in an idle thread shows the held band with its count", () => {
  expect(resumeBandOf(summary({}), 2, 0)).toEqual({ kind: "held", queued: 2 });
});

test("no band for a quiet thread, a running thread with a queue, or no thread", () => {
  expect(resumeBandOf(summary({}), 0, 0)).toBeNull();
  expect(resumeBandOf(summary({ status: "running" }), 3, 0)).toBeNull();
  expect(resumeBandOf(undefined, 1, 0)).toBeNull();
});

test("the crashed band closes once that turn's resume has started and not before", () => {
  const view = resumeBandOf(
    summary({
      status: "running",
      resumable: { turnId: trn(1), runningSince: "2026-11-07T00:00:00.000Z", resumeAttempts: 0 },
    }),
    0,
    0,
  );
  expect(resumeBandClosed(view, null)).toBe(false);
  expect(resumeBandClosed(view, trn(2))).toBe(false);
  expect(resumeBandClosed(view, trn(1))).toBe(true);
  expect(resumeBandClosed({ kind: "held", queued: 1 }, trn(1))).toBe(false);
});

test("a turn waiting on an approval keeps its marker but shows no crashed band", () => {
  const marked = summary({
    status: "running",
    pendingApprovals: 1,
    resumable: { turnId: trn(1), runningSince: "2026-11-07T00:00:00.000Z", resumeAttempts: 0 },
  });
  expect(resumeBandOf(marked, 0, 1)).toBeNull();
  expect(resumeBandOf(marked, 0, 0)?.kind).toBe("crashed");
});

test("the sidebar row offers resume only for a marked thread that waits for no approval", () => {
  const marked = summary({
    status: "running",
    resumable: { turnId: trn(1), runningSince: "2026-11-07T00:00:00.000Z", resumeAttempts: 0 },
  });
  expect(rowResumable(marked, 0)).toBe(true);
  expect(rowResumable(marked, 1)).toBe(false);
  expect(rowResumable(summary({}), 0)).toBe(false);
});

const input = (over: Partial<QueuedInput>): QueuedInput => ({
  inputId: evt(1),
  threadId: thr(1),
  requestId: "r1",
  mode: "next",
  sourceType: "user",
  preview: { kind: "text", text: "이어서 해 줘" },
  ...over,
});
const hidden = (n: number): QueuedInput =>
  input({
    inputId: evt(n),
    sourceType: "extension",
    preview: { kind: "label", labelKey: "helm", internal: true },
  });

test("the held band counts only what the user can see: hidden internal input alone shows no band", () => {
  const idle = summary({});
  expect(resumeBandOf(idle, chipInputs([hidden(1), hidden(2)]).length, 0)).toBeNull();
  const mixed = [hidden(1), input({ inputId: evt(2) }), hidden(3)];
  expect(resumeBandOf(idle, chipInputs(mixed).length, 0)).toEqual({ kind: "held", queued: 1 });
});

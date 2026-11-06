import { expect, test } from "bun:test";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import { resumeBandOf } from "../../src/views/resume-band-model.ts";
import { thr, trn } from "../state/helpers.ts";

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
  );
  expect(view).toEqual({ kind: "crashed", runningSince: "2026-11-07T00:00:00.000Z" });
});

test("queued input left in an idle thread shows the held band with its count", () => {
  expect(resumeBandOf(summary({ queuedInputs: 2 }))).toEqual({ kind: "held", queued: 2 });
});

test("no band for a quiet thread, a running thread with a queue, or no thread", () => {
  expect(resumeBandOf(summary({}))).toBeNull();
  expect(resumeBandOf(summary({ status: "running", queuedInputs: 3 }))).toBeNull();
  expect(resumeBandOf(undefined)).toBeNull();
});

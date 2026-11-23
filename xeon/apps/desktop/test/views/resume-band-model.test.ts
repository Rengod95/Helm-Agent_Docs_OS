import { expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import {
  crashedBodyOf,
  resumeBandClosed,
  resumeBandOf,
  rowResumable,
} from "../../src/views/resume-band-model.ts";
import { chipInputs, heldCountOf } from "../../src/views/composer-model.ts";
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
  );
  expect(view).toEqual({
    kind: "crashed",
    runningSince: "2026-11-07T00:00:00.000Z",
    turnId: trn(1),
  });
});

test("no band without a recovery marker: held input is the queue head's job, not a band (DP-156)", () => {
  expect(resumeBandOf(summary({}), 0)).toBeNull();
  expect(resumeBandOf(summary({ status: "running" }), 0)).toBeNull();
  expect(resumeBandOf(undefined, 0)).toBeNull();
});

test("the crashed band closes once that turn's resume has started and not before", () => {
  const view = resumeBandOf(
    summary({
      status: "running",
      resumable: { turnId: trn(1), runningSince: "2026-11-07T00:00:00.000Z", resumeAttempts: 0 },
    }),
    0,
  );
  expect(resumeBandClosed(view, null)).toBe(false);
  expect(resumeBandClosed(view, trn(2))).toBe(false);
  expect(resumeBandClosed(view, trn(1))).toBe(true);
  expect(resumeBandClosed(null, trn(1))).toBe(false);
});

test("a turn waiting on an approval keeps its marker but shows no crashed band", () => {
  const marked = summary({
    status: "running",
    pendingApprovals: 1,
    resumable: { turnId: trn(1), runningSince: "2026-11-07T00:00:00.000Z", resumeAttempts: 0 },
  });
  expect(resumeBandOf(marked, 1)).toBeNull();
  expect(resumeBandOf(marked, 0)?.kind).toBe("crashed");
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

test("the crashed band's sentence names the service for a remote target and the app for this computer", () => {
  expect(crashedBodyOf(false)).toBe("desktop.resumeBand.crashed.body");
  expect(crashedBodyOf(true)).toBe("desktop.resumeBand.crashed.bodyService");
  expect(t(crashedBodyOf(true))).toBe(
    "서비스 연결이 끊겼다가 돌아왔어요. 이어서 실행하거나 그대로 둘 수 있어요.",
  );
  expect(t(crashedBodyOf(false))).toBe(
    "앱이 다시 시작되며 멈췄어요. 이어서 실행하거나 그대로 둘 수 있어요.",
  );
});

test("held counts only visible input that can start a turn on its own (DP-156)", () => {
  const idle = summary({});
  expect(heldCountOf(idle, chipInputs([hidden(1), hidden(2)]))).toBe(0);
  const mixed = [hidden(1), input({ inputId: evt(2), mode: "followUp" }), hidden(3)];
  expect(heldCountOf(idle, chipInputs(mixed))).toBe(1);
  // Helm 안내처럼 확장이 next로 넣은 입력은 turn.resume이 시작하지 않는다: 보내기를 내면 눌러도 아무 일이 없다
  const helm = input({
    inputId: evt(4),
    mode: "next",
    sourceType: "extension",
    preview: { kind: "label", labelKey: "helm" },
  });
  // 칩에도 오르지 않고(F-42) 보내기를 기다리는 수에도 들지 않는다
  expect(chipInputs([helm]).length).toBe(0);
  expect(heldCountOf(idle, [helm])).toBe(0);
  expect(heldCountOf(idle, [input({ mode: "aside" })])).toBe(0);
  expect(heldCountOf(idle, [input({ mode: "steer" }), input({ mode: "followUp" })])).toBe(2);
});

test("held is zero while the thread runs, carries a recovery marker, or is gone", () => {
  const queue = [input({ mode: "followUp" })];
  expect(heldCountOf(summary({ status: "running" }), queue)).toBe(0);
  expect(
    heldCountOf(
      summary({
        resumable: { turnId: trn(1), runningSince: "2026-11-07T00:00:00.000Z", resumeAttempts: 0 },
      }),
      queue,
    ),
  ).toBe(0);
  expect(heldCountOf(undefined, queue)).toBe(0);
});

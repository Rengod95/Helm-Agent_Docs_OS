import { describe, expect, test } from "bun:test";
import { Bug, parse } from "@xeon/contracts";
import { TurnIdSchema } from "@xeon/contracts/conversation";
import type { LeaseOwnerInfo, RecoveryMarker } from "@xeon/contracts/records";
import { buildResumeOffers, type ResumeCandidate, type ResumePolicyInput } from "../src/index.ts";

function marker(resumeAttempts: number): RecoveryMarker {
  const turn = parse(TurnIdSchema, "trn_01ARZ3NDEKTSV4RRFFQ69G5FAV");
  if (!turn.ok) throw new Bug("turn id fixture is invalid");
  return { turnId: turn.value, runningSince: 1_767_571_200_000, resumeAttempts };
}

function actionOf(policy: ResumePolicyInput): string | undefined {
  return buildResumeOffers([candidate("thr_a", 0)], NOBODY, policy)[0]?.action;
}

function candidate(threadId: string, resumeAttempts: number): ResumeCandidate {
  return { threadId, marker: marker(resumeAttempts) };
}

const HOLDER: LeaseOwnerInfo = {
  holderId: "holder-9",
  kind: "cli",
  pid: 77,
  startedAt: 1_767_571_200_000,
  host: "dev-host",
  epoch: 1,
  heartbeatAt: 1_767_571_200_000,
  expiresAt: 1_767_571_230_000,
};

const NOBODY = (): null => null;
const BASE: ResumePolicyInput = { serviceMode: false, autoResumeEnabled: false, maxAttempts: 3 };

describe("buildResumeOffers", () => {
  test("auto resume is off by default: every candidate is an offer", () => {
    const offers = buildResumeOffers([candidate("thr_a", 0), candidate("thr_b", 2)], NOBODY, BASE);
    expect(offers.map((offer) => offer.action)).toEqual(["offer", "offer"]);
    expect(offers[0]).toEqual({
      threadId: "thr_a",
      runningSince: 1_767_571_200_000,
      resumeAttempts: 0,
      action: "offer",
      heldBy: null,
    });
  });

  test("auto resume needs service mode and the setting together", () => {
    expect(actionOf({ ...BASE, autoResumeEnabled: true })).toBe("offer");
    expect(actionOf({ ...BASE, serviceMode: true })).toBe("offer");
    expect(actionOf({ ...BASE, serviceMode: true, autoResumeEnabled: true })).toBe("auto_resume");
  });

  test("the attempt cap wins over auto resume", () => {
    const policy: ResumePolicyInput = { ...BASE, serviceMode: true, autoResumeEnabled: true };
    const offers = buildResumeOffers(
      [candidate("thr_a", 2), candidate("thr_b", 3), candidate("thr_c", 9)],
      NOBODY,
      policy,
    );
    expect(offers.map((offer) => offer.action)).toEqual(["auto_resume", "exhausted", "exhausted"]);
  });

  test("a session held by another process is shown with its owner and never auto resumed", () => {
    const policy: ResumePolicyInput = { ...BASE, serviceMode: true, autoResumeEnabled: true };
    const offers = buildResumeOffers(
      [candidate("thr_held", 0), candidate("thr_free", 0)],
      (threadId) => (threadId === "thr_held" ? HOLDER : null),
      policy,
    );
    expect(
      offers.map((offer) => [offer.threadId, offer.action, offer.heldBy?.pid ?? null]),
    ).toEqual([
      ["thr_held", "offer", 77],
      ["thr_free", "auto_resume", null],
    ]);
  });

  test("no candidates, no offers", () => {
    expect(buildResumeOffers([], NOBODY, BASE)).toEqual([]);
  });
});

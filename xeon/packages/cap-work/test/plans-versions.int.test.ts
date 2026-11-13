import { afterEach, describe, expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import type { PlanVersion } from "@fresnel/contracts/capabilities";
import type { JsonValue } from "@fresnel/contracts/conversation";
import { rejection } from "./support/assertions.ts";
import { openHarness, type Harness } from "./support/harness.ts";
import { PlanId } from "./support/plans.ts";

// 계획 모드와 계획 승인은 없앴다 [결정: 2026-11-13 사용자]. 남는 work.plans.versions는 옛 계획 기록을 읽는다.
// 이 시험은 옛 기록(work.plan_submitted, work.plan_withdrawn, 계획 승인 요청과 해결)을 직접 커밋해 판 목록과 상태를 값으로 비교한다.

let opened: Harness | undefined;

afterEach(async () => {
  await opened?.[Symbol.asyncDispose]();
  opened = undefined;
});

async function harness(): Promise<Harness> {
  opened = await openHarness();
  return opened;
}

/** 판 목록을 문자열 값으로 옮긴다. 브랜드 id는 시험 기대값(문자열)과 같은 모양으로 읽는다 */
interface PlainVersion {
  readonly planId: string;
  readonly version: number;
  readonly title: string;
  readonly body: string;
  readonly status: PlanVersion["status"];
  readonly artifact: PlanVersion["artifact"];
  readonly approvalId: string | null;
  readonly feedback: string | null;
}

async function versionsOf(h: Harness, planId: string): Promise<PlainVersion[]> {
  const listed = await h.plans.versions({ planId: PlanId(planId) }, h.opts());
  return listed.versions.map((v) => ({
    planId: v.planId,
    version: v.version,
    title: v.title,
    body: v.body,
    status: v.status,
    artifact: v.artifact,
    approvalId: v.approvalId === null ? null : v.approvalId,
    feedback: v.feedback,
  }));
}

const AT = 1_767_571_200_000;
const ART = { artifactId: "art_1", kind: "plan", title: "Plan" };

/** 옛 기록 한 건. 생산자는 기록을 낸 쪽(cap.work 또는 core.tools)이다 */
interface LegacyDraft {
  readonly by: "work" | "tools";
  readonly kind:
    | "work.plan_submitted"
    | "work.plan_withdrawn"
    | "approval.requested"
    | "approval.resolved";
  readonly payload: JsonValue;
}

/** 옛 기록을 커밋 하나로 남기고, 낸 이벤트의 id를 순서대로 돌려준다(승인 요청의 id가 승인 id다) */
function commitLegacy(h: Harness, drafts: readonly LegacyDraft[], requestId: string): string[] {
  const planned = drafts.map((draft) => ({ draft, id: h.ids.next("evt") }));
  const result = h.session.commit({
    threadId: h.threadId,
    requestId: `legacy:${requestId}`,
    fingerprintSource: { requestId },
    build: () => ({
      kind: "append",
      drafts: planned.map(({ draft, id }) =>
        (draft.by === "work" ? h.workProducer : h.toolsProducer).draft({
          id,
          kind: draft.kind,
          threadId: h.threadId,
          turnId: null,
          stepId: null,
          causationId: null,
          correlationId: null,
          payload: draft.payload,
        }),
      ),
      checkpoint: null,
    }),
  });
  if (!result.ok || result.value.status !== "committed") {
    throw new Bug("the legacy plan record did not commit", { cause: result });
  }
  return planned.map(({ id }) => id);
}

/** 커밋이 낸 이벤트 id 하나. 없으면 시험 입력의 결함이다 */
function idAt(ids: readonly string[], index: number): string {
  const id = ids[index];
  if (id === undefined) throw new Bug(`the legacy record has no event at index ${index}`);
  return id;
}

function submitted(
  planId: string,
  version: number,
  body: string,
  supersedes: number | null,
  artifact: JsonValue = null,
): LegacyDraft {
  return {
    by: "work",
    kind: "work.plan_submitted",
    payload: { planId, version, title: "Plan", body, artifact, supersedes },
  };
}

function requested(h: Harness, planRef: string, body: string): LegacyDraft {
  return {
    by: "tools",
    kind: "approval.requested",
    payload: {
      origin: {
        threadId: h.threadId,
        turnId: null,
        stepId: null,
        toolCallId: null,
        caller: "host",
      },
      requestKey: planRef,
      title: "Review the plan",
      body: { kind: "plan", plan: { plan: body, planRef, nextModes: ["default"] } },
      remember: ["once"],
      surfaceThreadId: h.threadId,
      requestedAt: AT,
    },
  };
}

function resolved(
  approvalId: string,
  decision: "allow" | "deny",
  answer: JsonValue,
  resolvedBy: "user" | "cancelled",
): LegacyDraft {
  return {
    by: "tools",
    kind: "approval.resolved",
    payload: {
      approvalId,
      decision,
      answer,
      remember: "once",
      requestedRemember: null,
      resolvedBy,
    },
  };
}

describe("versions of the plans recorded before plan mode was removed", () => {
  test("each version keeps its own status, feedback, approval and artifact in submission order", async () => {
    const h = await harness();
    // p1: v1은 사유가 붙은 반려(수정 요청은 같은 기록이다), v2는 승인
    const a1 = idAt(
      commitLegacy(
        h,
        [submitted("p1", 1, "v1 body", null), requested(h, "plan:p1:1", "v1 body")],
        "p1v1",
      ),
      1,
    );
    commitLegacy(h, [resolved(a1, "deny", { feedback: "add tests" }, "user")], "p1v1-decide");
    const a2 = idAt(
      commitLegacy(
        h,
        [submitted("p1", 2, "v2 body", 1, ART), requested(h, "plan:p1:2", "v2 body")],
        "p1v2",
      ),
      1,
    );
    commitLegacy(h, [resolved(a2, "allow", null, "user")], "p1v2-decide");

    expect(await versionsOf(h, "p1")).toEqual([
      {
        planId: "p1",
        version: 1,
        title: "Plan",
        body: "v1 body",
        status: "rejected",
        artifact: null,
        approvalId: a1,
        feedback: "add tests",
      },
      {
        planId: "p1",
        version: 2,
        title: "Plan",
        body: "v2 body",
        status: "approved",
        artifact: ART,
        approvalId: a2,
        feedback: null,
      },
    ]);
  });

  test("a request closed without a person is withdrawn, and a newer version supersedes a waiting one", async () => {
    const h = await harness();
    const a3 = idAt(
      commitLegacy(
        h,
        [submitted("p2", 1, "p2 body", null), requested(h, "plan:p2:1", "p2 body")],
        "p2v1",
      ),
      1,
    );
    commitLegacy(h, [resolved(a3, "deny", null, "cancelled")], "p2v1-cancel");
    const a4 = idAt(
      commitLegacy(
        h,
        [submitted("p3", 1, "p3 v1", null), requested(h, "plan:p3:1", "p3 v1")],
        "p3v1",
      ),
      1,
    );
    const a5 = idAt(
      commitLegacy(h, [submitted("p3", 2, "p3 v2", 1), requested(h, "plan:p3:2", "p3 v2")], "p3v2"),
      1,
    );

    expect(await versionsOf(h, "p2")).toEqual([
      {
        planId: "p2",
        version: 1,
        title: "Plan",
        body: "p2 body",
        status: "withdrawn",
        artifact: null,
        approvalId: a3,
        feedback: null,
      },
    ]);
    // v1은 아직 대기 중이었는데 v2가 나왔으므로 대체된 판이다. v2는 대기 중이다
    expect(await versionsOf(h, "p3")).toEqual([
      {
        planId: "p3",
        version: 1,
        title: "Plan",
        body: "p3 v1",
        status: "superseded",
        artifact: null,
        approvalId: a4,
        feedback: null,
      },
      {
        planId: "p3",
        version: 2,
        title: "Plan",
        body: "p3 v2",
        status: "submitted",
        artifact: null,
        approvalId: a5,
        feedback: null,
      },
    ]);
  });

  test("a plan withdrawn by an exit record has no approval and reads as withdrawn", async () => {
    const h = await harness();
    commitLegacy(h, [submitted("p4", 1, "p4 body", null)], "p4v1");
    commitLegacy(
      h,
      [
        {
          by: "work",
          kind: "work.plan_withdrawn",
          payload: { planId: "p4", version: 1, reason: "exit_mode" },
        },
      ],
      "p4v1-withdraw",
    );
    expect(await versionsOf(h, "p4")).toEqual([
      {
        planId: "p4",
        version: 1,
        title: "Plan",
        body: "p4 body",
        status: "withdrawn",
        artifact: null,
        approvalId: null,
        feedback: null,
      },
    ]);
  });

  test("reads write nothing, an unknown plan is not_found, and a projection rebuild gives the same versions", async () => {
    const h = await harness();
    const a1 = idAt(
      commitLegacy(
        h,
        [submitted("p1", 1, "v1 body", null), requested(h, "plan:p1:1", "v1 body")],
        "p1v1",
      ),
      1,
    );
    commitLegacy(h, [resolved(a1, "deny", { feedback: "add tests" }, "user")], "p1v1-decide");
    const events = h.eventCount();
    const before = await h.plans.versions({ planId: PlanId("p1") }, h.opts());
    const missing = await rejection(h.plans.versions({ planId: PlanId("p9") }, h.opts()));
    expect(missing.data.code).toBe("not_found");
    expect(h.eventCount()).toBe(events);

    await h.rebuild();
    expect(await h.plans.versions({ planId: PlanId("p1") }, h.opts())).toEqual(before);
  });
});

import { describe, expect, test } from "bun:test";
import type { MessageId } from "@fresnel/client/i18n";
import {
  INITIAL_WORK_STATE,
  PLAN_PREVIEW_CHARS,
  PLAN_VERSION_LIST_MAX,
  latestPlanVersion,
  planActionOf,
  planCardOf,
  planLoadViewOf,
  planStatusIdOf,
  planVersionListOf,
  workReducer,
  type PlanLoad,
  type PlanVersionWire,
  type WorkState,
} from "../../src/views/pages/work/work-model.ts";
import { version, versionsUpTo } from "./plan-fixtures.ts";

// 계획 카드와 판 목록(W-18)의 순수 모델. 값은 `toEqual`로 비교한다. 판의 모양은 `PlanVersionsOutput` 스키마가 만든다.

const SUBMITTED = "desktop.work.plan.status.submitted";

describe("planStatusIdOf", () => {
  test("each version status has its own sentence id", () => {
    const cases: readonly [PlanVersionWire["status"], MessageId][] = [
      ["submitted", "desktop.work.plan.status.submitted"],
      ["approved", "desktop.work.plan.status.approved"],
      ["rejected", "desktop.work.plan.status.rejected"],
      ["revision_requested", "desktop.work.plan.status.revisionRequested"],
      ["superseded", "desktop.work.plan.status.superseded"],
      ["withdrawn", "desktop.work.plan.status.withdrawn"],
    ];
    for (const [status, id] of cases) expect(planStatusIdOf(status)).toBe(id);
  });
});

describe("latest version and the plan card", () => {
  test("the latest is the highest version number, whatever order the host sent", () => {
    const v1 = version(1);
    const v2 = version(2);
    const v3 = version(3);
    expect(latestPlanVersion([v2, v3, v1])).toEqual(v3);
  });

  test("an empty list has no latest version and no card", () => {
    expect(latestPlanVersion([])).toBeNull();
    expect(planCardOf([])).toBeNull();
  });

  test("the card keeps the latest title, number and status sentence", () => {
    const card = planCardOf([
      version(1, { title: "첫 계획", status: "approved" }),
      version(2, { title: "캐시 만료 수정", status: "submitted" }),
    ]);
    expect(card).toEqual({
      title: "캐시 만료 수정",
      version: 2,
      statusRef: { id: SUBMITTED },
    });
  });
});

const readyLoad = (versions: readonly PlanVersionWire[]): PlanLoad => ({
  status: "ready",
  versions,
});

const startPlan = (state: WorkState, planId: string | null): WorkState =>
  workReducer(state, { type: "planLoadStarted", planId });

describe("planLoadViewOf", () => {
  test("a read in flight is loading while live and offline without a connection", () => {
    expect(planLoadViewOf({ status: "loading" }, true)).toBe("loading");
    expect(planLoadViewOf({ status: "loading" }, false)).toBe("offline");
  });

  test("failed and not found read as themselves, whatever the connection", () => {
    expect(planLoadViewOf({ status: "failed" }, true)).toBe("failed");
    expect(planLoadViewOf({ status: "failed" }, false)).toBe("failed");
    expect(planLoadViewOf({ status: "notFound" }, true)).toBe("notFound");
  });

  test("a ready list with versions is ready, and an empty one is not found", () => {
    expect(planLoadViewOf(readyLoad([version(1)]), true)).toBe("ready");
    expect(planLoadViewOf(readyLoad([]), true)).toBe("notFound");
  });
});

describe("planVersionListOf", () => {
  test("the list is newest first and keeps at most the cap, counting the older ones as hidden", () => {
    expect(PLAN_VERSION_LIST_MAX).toBe(50);
    const list = planVersionListOf(versionsUpTo(52));
    expect(list.rows.length).toBe(50);
    expect(list.rows[0]?.version).toBe(52);
    expect(list.rows.at(-1)?.version).toBe(3);
    expect(list.hiddenCount).toBe(2);
  });

  test("a short list keeps every version in order with nothing hidden", () => {
    const list = planVersionListOf(versionsUpTo(3));
    expect(list.rows.map((row) => row.version)).toEqual([3, 2, 1]);
    expect(list.hiddenCount).toBe(0);
  });

  test("a body within the preview is shown whole and needs no expand", () => {
    const list = planVersionListOf([version(1, { body: "  짧은 본문  ", title: "짧은 계획" })]);
    expect(list.rows).toEqual([
      {
        version: 1,
        title: "짧은 계획",
        statusRef: { id: SUBMITTED },
        preview: "짧은 본문",
        expandable: false,
        body: "짧은 본문",
        feedback: null,
      },
    ]);
  });

  test("a longer body is cut at the preview length with an ellipsis, and the full body waits to expand", () => {
    const body = "a".repeat(PLAN_PREVIEW_CHARS + 50);
    const [row] = planVersionListOf([version(1, { body })]).rows;
    expect(row?.preview).toBe(`${"a".repeat(PLAN_PREVIEW_CHARS)}…`);
    expect(row?.expandable).toBe(true);
    expect(row?.body).toBe(body);
  });

  test("a cut never splits a surrogate pair", () => {
    // 200번째 글자 자리에 든 글자 쌍(😀)의 앞 절반에서 자르지 않는다
    const body = `${"a".repeat(PLAN_PREVIEW_CHARS - 1)}😀b`;
    const [row] = planVersionListOf([version(1, { body })]).rows;
    expect(row?.preview).toBe(`${"a".repeat(PLAN_PREVIEW_CHARS - 1)}…`);
  });

  test("feedback waits behind the expand; a blank feedback counts as none", () => {
    const rows = planVersionListOf([
      version(1, { feedback: "   " }),
      version(2, { body: "짧음", status: "rejected", feedback: " 범위를 줄여 주세요 " }),
    ]).rows;
    // 최신 판이 먼저 온다
    const [given, blank] = rows;
    expect(blank?.version).toBe(1);
    expect(blank?.feedback).toBeNull();
    expect(blank?.expandable).toBe(false);
    expect(given).toEqual({
      version: 2,
      title: "계획 2",
      statusRef: { id: "desktop.work.plan.status.rejected" },
      preview: "짧음",
      expandable: true,
      body: "짧음",
      feedback: "범위를 줄여 주세요",
    });
  });
});

describe("planActionOf", () => {
  test("a read that worked becomes a loaded list for that plan", () => {
    const versions = [version(1)];
    expect(planActionOf("p1", { ok: true, value: { versions } })).toEqual({
      type: "planLoaded",
      planId: "p1",
      versions,
    });
  });

  test("an unknown plan id (the rejection names planId) is not found", () => {
    expect(
      planActionOf("p9", { ok: false, error: { kind: "rejected", code: -32602, path: "planId" } }),
    ).toEqual({ type: "planFailed", planId: "p9", reason: "notFound" });
  });

  test("any other rejection, or an offline read, is a read failure", () => {
    expect(
      planActionOf("p1", { ok: false, error: { kind: "rejected", code: -32602, path: "name" } }),
    ).toEqual({ type: "planFailed", planId: "p1", reason: "failed" });
    expect(planActionOf("p1", { ok: false, error: { kind: "offline" } })).toEqual({
      type: "planFailed",
      planId: "p1",
      reason: "failed",
    });
  });
});

describe("the plan state in the work reducer", () => {
  test("the first read of a plan starts loading under that plan id", () => {
    expect(startPlan(INITIAL_WORK_STATE, "p1").plan).toEqual({
      planId: "p1",
      load: { status: "loading" },
    });
  });

  test("a loaded list for the current plan is ready; one for another plan is ignored", () => {
    const loading = startPlan(INITIAL_WORK_STATE, "p1");
    const loaded = workReducer(loading, {
      type: "planLoaded",
      planId: "p1",
      versions: [version(1)],
    });
    expect(loaded.plan).toEqual({
      planId: "p1",
      load: { status: "ready", versions: [version(1)] },
    });
    const late = workReducer(startPlan(loading, "p2"), {
      type: "planLoaded",
      planId: "p1",
      versions: [version(1)],
    });
    expect(late.plan).toEqual({ planId: "p2", load: { status: "loading" } });
  });

  test("a refresh of the same plan keeps the last list; a new plan starts over", () => {
    const ready = workReducer(startPlan(INITIAL_WORK_STATE, "p1"), {
      type: "planLoaded",
      planId: "p1",
      versions: [version(1)],
    });
    expect(startPlan(ready, "p1").plan.load).toEqual({
      status: "ready",
      versions: [version(1)],
    });
    expect(startPlan(ready, "p2").plan.load).toEqual({ status: "loading" });
  });

  test("no plan clears the plan id, so the card is hidden", () => {
    const ready = workReducer(startPlan(INITIAL_WORK_STATE, "p1"), {
      type: "planLoaded",
      planId: "p1",
      versions: [version(1)],
    });
    expect(startPlan(ready, null).plan).toEqual({ planId: null, load: { status: "loading" } });
  });

  test("a failed read says not found or failed for the current plan", () => {
    const loading = startPlan(INITIAL_WORK_STATE, "p1");
    expect(
      workReducer(loading, { type: "planFailed", planId: "p1", reason: "notFound" }).plan.load,
    ).toEqual({ status: "notFound" });
    expect(
      workReducer(loading, { type: "planFailed", planId: "p1", reason: "failed" }).plan.load,
    ).toEqual({ status: "failed" });
  });

  test("the version list opens and closes", () => {
    const opened = workReducer(INITIAL_WORK_STATE, { type: "versionsOpened" });
    expect(opened.versionsOpen).toBe(true);
    expect(workReducer(opened, { type: "versionsClosed" }).versionsOpen).toBe(false);
  });
});

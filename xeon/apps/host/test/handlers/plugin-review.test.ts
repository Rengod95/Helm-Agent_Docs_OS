import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { WireError, type WireRequestContext } from "@fresnel/contracts/wire";
import { partial } from "../fixtures/unsafe.ts";
import {
  createPluginReviewHandlers,
  type PluginReviewPort,
} from "../../src/handlers/m5/plugin-review.ts";
import {
  createPluginHandlers,
  type PluginPort,
  type PluginPortFailure,
} from "../../src/handlers/m5/plugins.ts";

// M5c §3.4 오류 표: 검토함과 플러그인 처리기가 포트의 실패를 스키마가 정한 wire 오류 이름과 번호로 옮기는지 본다.

/** 처리기가 요청 문맥으로 쓰는 값. 시험은 신호만 채운다(다른 처리기 시험과 같다) */
const CONTEXT = partial<WireRequestContext>({ signal: new AbortController().signal });

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected a wire error, the call succeeded");
}

test("a missing review item answers pluginReview.notFound (3651) with the id", async () => {
  const handlers = createPluginReviewHandlers(
    partial<PluginReviewPort>({
      get: () => Promise.resolve(err({ kind: "review_not_found", itemId: "rvw_missing" })),
    }),
  );
  const error = await wireErrorOf(handlers["pluginReview.get"]({ itemId: "rvw_missing" }, CONTEXT));
  expect(error.code).toBe(3651);
  expect(error.data.kind).toBe("pluginReview.notFound");
  expect(error.data.details).toEqual({ id: "rvw_missing" });
});

test("decide answers the review refusals with their own codes", async () => {
  const refusals: readonly [PluginPortFailure, number, string][] = [
    [{ kind: "not_pending", itemId: "rvw_a" }, 3652, "pluginReview.notPending"],
    [{ kind: "hand_edit", itemId: "rvw_a" }, 3654, "pluginReview.handEditNotAllowed"],
    [{ kind: "purpose_required", itemId: "rvw_a" }, 3655, "pluginReview.purposeRequired"],
    [{ kind: "description_required", itemId: "rvw_a" }, 3657, "pluginReview.descriptionRequired"],
  ];
  await Promise.all(
    refusals.map(async ([failure, code, kind]) => {
      const handlers = createPluginReviewHandlers(
        partial<PluginReviewPort>({ decide: () => Promise.resolve(err(failure)) }),
      );
      const error = await wireErrorOf(
        handlers["pluginReview.decide"](
          { itemId: "rvw_a", decision: { kind: "discard" } },
          CONTEXT,
        ),
      );
      expect([error.code, error.data.kind]).toEqual([code, kind]);
    }),
  );
});

test("a profile check that fails on approval answers pluginReview.profileInvalid (3656) with the issues", async () => {
  const handlers = createPluginReviewHandlers(
    partial<PluginReviewPort>({
      decide: () =>
        Promise.resolve(
          err({
            kind: "profile_invalid",
            issues: [
              {
                profile: "p1",
                code: "replace_conflict",
                severity: "error",
                plugin: "a",
                other: "b",
              },
            ],
          }),
        ),
    }),
  );
  const error = await wireErrorOf(
    handlers["pluginReview.decide"](
      {
        itemId: "rvw_a",
        decision: { kind: "approve", profileIds: ["work"], libraryOnly: false },
      },
      CONTEXT,
    ),
  );
  expect(error.code).toBe(3656);
  expect(error.data.details).toEqual({
    issues: [
      { profile: "p1", code: "replace_conflict", severity: "error", plugin: "a", other: "b" },
    ],
  });
});

test("a path outside the snapshot answers pluginReview.pathInvalid (3653)", async () => {
  const handlers = createPluginReviewHandlers(
    partial<PluginReviewPort>({ file: () => Promise.resolve(err({ kind: "path_invalid" })) }),
  );
  const error = await wireErrorOf(
    handlers["pluginReview.file"]({ itemId: "rvw_a", path: "../x" }, CONTEXT),
  );
  expect(error.code).toBe(3653);
});

test("pluginReview.file passes the side to the port and answers its result unchanged", async () => {
  const asked: (string | undefined)[] = [];
  const handlers = createPluginReviewHandlers(
    partial<PluginReviewPort>({
      file: (_itemId, path, side) => {
        asked.push(side);
        return Promise.resolve(ok({ path, text: null, truncated: false, missing: true }));
      },
    }),
  );
  expect(
    await handlers["pluginReview.file"]({ itemId: "rvw_a", path: "a.md", side: "base" }, CONTEXT),
  ).toEqual({ path: "a.md", text: null, truncated: false, missing: true });
  await handlers["pluginReview.file"]({ itemId: "rvw_a", path: "a.md" }, CONTEXT);
  expect(asked).toEqual(["base", undefined]);
});

test("a successful review answers its result unchanged", async () => {
  const handlers = createPluginReviewHandlers(
    partial<PluginReviewPort>({ submitDraft: () => Promise.resolve(ok({ itemId: "rvw_b" })) }),
  );
  expect(await handlers["pluginReview.submitDraft"]({ draftId: "drf_a" }, CONTEXT)).toEqual({
    itemId: "rvw_b",
  });
});

test("submitDraft passes the origin profile and the merge plan to the port, and leaves out the ones not sent", async () => {
  const sent: unknown[][] = [];
  const handlers = createPluginReviewHandlers(
    partial<PluginReviewPort>({
      submitDraft: (...args) => {
        sent.push(args);
        return Promise.resolve(ok({ itemId: "rvw_c" }));
      },
    }),
  );
  const plan = { swapOut: ["helm", "kit"], placeAfter: null, driveFrom: null };
  await handlers["pluginReview.submitDraft"](
    { draftId: "drf_a", originProfileId: "p1", profilePlan: plan },
    CONTEXT,
  );
  await handlers["pluginReview.submitDraft"]({ draftId: "drf_b" }, CONTEXT);
  expect(sent).toEqual([
    ["drf_a", { originProfileId: "p1", profilePlan: plan }],
    ["drf_b", {}],
  ]);
});

test("draft.notFound is 3616, and a discarded draft answers the empty result", async () => {
  const handlers = createPluginHandlers(
    partial<PluginPort>({
      draftDiscard: (draftId) =>
        Promise.resolve(
          draftId === "drf_gone" ? err({ kind: "draft_not_found", draftId }) : ok(undefined),
        ),
    }),
  );
  const error = await wireErrorOf(
    handlers["plugin.draft.discard"]({ draftId: "drf_gone" }, CONTEXT),
  );
  expect(error.code).toBe(3616);
  expect(error.data.kind).toBe("draft.notFound");
  expect(await handlers["plugin.draft.discard"]({ draftId: "drf_here" }, CONTEXT)).toEqual({});
});

test("a refused draft answers plugin.invalid (3621) with the code and severity of each issue", async () => {
  const handlers = createPluginHandlers(
    partial<PluginPort>({
      draftCreate: () =>
        Promise.resolve(
          err({
            kind: "draft_invalid",
            issues: [{ code: "manifest_invalid", severity: "error", path: "x", message: "bad" }],
          }),
        ),
    }),
  );
  const error = await wireErrorOf(handlers["plugin.draft.create"]({ dir: "/tmp/x" }, CONTEXT));
  expect(error.code).toBe(3621);
  expect(error.data.details).toEqual({
    issues: [{ code: "manifest_invalid", severity: "error" }],
  });
});

test("too large, a symbolic link, a missing reviewed copy and an unknown plugin keep their codes", async () => {
  const cases: readonly [PluginPortFailure, number][] = [
    [{ kind: "too_large" }, 3622],
    [{ kind: "symlink_refused" }, 3623],
    [{ kind: "no_reviewed_copy", name: "kit" }, 3625],
    [{ kind: "unknown_plugin", name: "kit" }, 3401],
  ];
  await Promise.all(
    cases.map(async ([failure, code]) => {
      const handlers = createPluginHandlers(
        partial<PluginPort>({ revert: () => Promise.resolve(err(failure)) }),
      );
      const error = await wireErrorOf(handlers["plugin.revert"]({ name: "kit" }, CONTEXT));
      expect(error.code).toBe(code);
    }),
  );
});

test("plugin.requestRemove answers the item id of the removal item", async () => {
  const handlers = createPluginHandlers(
    partial<PluginPort>({
      requestRemove: () => Promise.resolve(ok({ itemId: "rvw_removal" })),
    }),
  );
  expect(await handlers["plugin.requestRemove"]({ name: "kit" }, CONTEXT)).toEqual({
    itemId: "rvw_removal",
  });
});

// AGE-33: 의존 거절은 `plugin.dependency`(3627)다. 이유, 플러그인, 항목 값을 그대로 싣는다
test("a dependency refusal answers plugin.dependency (3627) with the reason, the plugin and each item", async () => {
  const items = [
    {
      from: "app",
      target: "core",
      kind: "hard",
      range: "^2.0.0",
      problem: "range_unmet",
      found: "1.0.0",
    },
  ] as const;
  const handlers = createPluginHandlers(
    partial<PluginPort>({
      requestRemove: () =>
        Promise.resolve(err({ kind: "dependency", reason: "unmet", plugin: "app", items })),
    }),
  );
  const error = await wireErrorOf(handlers["plugin.requestRemove"]({ name: "app" }, CONTEXT));
  expect(error.code).toBe(3627);
  expect(error.data.kind).toBe("plugin.dependency");
  expect(error.data.details).toEqual({ reason: "unmet", plugin: "app", items });
});

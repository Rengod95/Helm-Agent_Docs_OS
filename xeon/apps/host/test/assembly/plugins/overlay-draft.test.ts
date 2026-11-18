import { expect, test } from "bun:test";
import { err, ok, parse, type Result } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import type { LoadDraftFailure, LoadInstalledStarted } from "@fresnel/ext-host";
import type { PluginPortFailure } from "../../../src/handlers/m5/plugins.ts";
import {
  createDraftLoader,
  type DraftLoaderPort,
} from "../../../src/assembly/plugins/draft-load.ts";
import {
  createOverlayPort,
  planOverlay,
  type DraftRef,
  type OverlayTarget,
} from "../../../src/assembly/plugins/overlay.ts";
import { partial } from "../../fixtures/unsafe.ts";

// M5c §4.3.8, U2 결정(2026-11-17): 초안 덧씌우기. 검사는 초안이 있고 그 플러그인의 것인지 본다. 검토본이 없어도 된다.
// 싣기는 격리 프로세스에서만 한다. 어떤 실패든 덧씌우기는 `overlay.draftUnavailable`로 거절하고 아무것도 싣지 않는다.
// 시험은 값을 `toEqual`로 비교한다.

const HASH = "a".repeat(64);
const DRAFT_HASH = `sha256:${"d".repeat(64)}`;

function threadId(): ThreadId {
  const parsed = parse(ThreadIdSchema, "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV");
  if (!parsed.ok) throw new Error("fixture thread id is invalid");
  return parsed.value;
}

function target(
  name: string,
  reviewedHash: string | null,
  origin?: OverlayTarget["origin"],
): OverlayTarget {
  return {
    name,
    reviewedHash,
    entries: [],
    addsTools: false,
    ...(origin === undefined ? {} : { origin }),
  };
}

function targetOf(value: OverlayTarget | undefined) {
  return (): Promise<Result<OverlayTarget | undefined, PluginPortFailure>> =>
    Promise.resolve(ok(value));
}

/** 초안 조회. 이름과 식별자가 맞는 초안만 있다 */
function draftsOf(...drafts: readonly DraftRef[]) {
  return (draftId: string): Promise<Result<DraftRef | undefined, PluginPortFailure>> =>
    Promise.resolve(ok(drafts.find((item) => item.draftId === draftId)));
}

const DRAFT: DraftRef = {
  name: "widget",
  draftId: "drf-1",
  contentHash: DRAFT_HASH,
  tree: "/drafts/drf-1/tree",
};

test("초안 덧씌우기: 없는 초안 식별자는 draft_not_found로 거절한다(검토본 유무와 무관하게 이름을 보고)", async () => {
  expect(
    await planOverlay(
      [{ plugin: "widget", draftId: "drf-9" }],
      targetOf(target("widget", HASH)),
      new Set(),
      draftsOf(DRAFT),
    ),
  ).toEqual(err({ kind: "draft_not_found", name: "widget", draftId: "drf-9" }));
});

test("초안 덧씌우기: 다른 플러그인의 초안 식별자는 같은 이유로 draft_not_found다", async () => {
  expect(
    await planOverlay(
      [{ plugin: "gadget", draftId: DRAFT.draftId }],
      targetOf(target("gadget", HASH)),
      new Set(),
      draftsOf(DRAFT),
    ),
  ).toEqual(err({ kind: "draft_not_found", name: "gadget", draftId: DRAFT.draftId }));
});

test("초안 덧씌우기: 검토본이 없는 새 플러그인의 초안도 얹는다. 초안 해시와 내부 이름, 도구를 더한다고 본다", async () => {
  expect(
    await planOverlay(
      [{ plugin: "widget", draftId: DRAFT.draftId }],
      targetOf(target("widget", null)),
      new Set(),
      draftsOf(DRAFT),
    ),
  ).toEqual(
    ok([
      {
        plugin: "widget",
        contentHash: DRAFT_HASH,
        alreadyInProfile: false,
        addsTools: true,
        draft: {
          draftId: DRAFT.draftId,
          internalName: "ddrf1-widget",
          tree: DRAFT.tree,
        },
        invoked: [{ plugin: "widget", entry: "widget", kind: "plugin" }],
      },
    ]),
  );
});

test("초안 덧씌우기: 프로필에 이미 든 플러그인도 초안이 자리를 대신하므로 alreadyInProfile이 아니다", async () => {
  const planned = await planOverlay(
    [{ plugin: "widget", draftId: DRAFT.draftId }],
    targetOf(target("widget", HASH)),
    new Set(["widget"]),
    draftsOf(DRAFT),
  );
  expect(planned).toMatchObject(ok([{ plugin: "widget", alreadyInProfile: false }]));
});

test("초안 덧씌우기: 프로젝트 동반 플러그인의 초안은 draft_unavailable이다", async () => {
  expect(
    await planOverlay(
      [{ plugin: "widget", draftId: DRAFT.draftId }],
      targetOf(target("widget", HASH, "project")),
      new Set(),
      draftsOf(DRAFT),
    ),
  ).toEqual(err({ kind: "draft_unavailable", name: "widget" }));
});

test("초안 덧씌우기: 시작 Drive 항목(start)이나 다른 항목 이름은 no_entry다. 초안은 플러그인 전체만 얹는다", async () => {
  const planned = await Promise.all(
    ["start", "other"].map((entry) =>
      planOverlay(
        [{ plugin: "widget", draftId: DRAFT.draftId, entry }],
        targetOf(target("widget", HASH)),
        new Set(),
        draftsOf(DRAFT),
      ),
    ),
  );
  expect(planned).toEqual([
    err({ kind: "no_entry", name: "widget" }),
    err({ kind: "no_entry", name: "widget" }),
  ]);
});

test("초안 테스트 실행: 허용하면 시작 Drive 항목(start)은 drive 항목으로 얹고 표지에 startDrive를 싣는다. 다른 항목은 여전히 no_entry다", async () => {
  const allowed = { allowDraftDriveStart: true };
  expect(
    await planOverlay(
      [{ plugin: "widget", draftId: DRAFT.draftId, entry: "start" }],
      targetOf(target("widget", HASH)),
      new Set(),
      draftsOf(DRAFT),
      allowed,
    ),
  ).toEqual(
    ok([
      {
        plugin: "widget",
        contentHash: DRAFT_HASH,
        alreadyInProfile: false,
        addsTools: true,
        draft: {
          draftId: DRAFT.draftId,
          internalName: "ddrf1-widget",
          tree: DRAFT.tree,
          startDrive: true,
        },
        invoked: [{ plugin: "widget", entry: "start", kind: "drive" }],
      },
    ]),
  );
  expect(
    await planOverlay(
      [{ plugin: "widget", draftId: DRAFT.draftId, entry: "other" }],
      targetOf(target("widget", HASH)),
      new Set(),
      draftsOf(DRAFT),
      allowed,
    ),
  ).toEqual(err({ kind: "no_entry", name: "widget" }));
});

test("초안 덧씌우기: 같은 플러그인의 초안과 검토본을 한 요청에 섞으면 draft_unavailable이다", async () => {
  expect(
    await planOverlay(
      [{ plugin: "widget" }, { plugin: "widget", draftId: DRAFT.draftId }],
      targetOf(target("widget", HASH)),
      new Set(),
      draftsOf(DRAFT),
    ),
  ).toEqual(err({ kind: "draft_unavailable", name: "widget" }));
});

test("초안 싣기: 격리가 없으면(isolation_unavailable) 싣지 않고 실패를 알린다. 성공한 적재는 없다", async () => {
  const attempts: string[] = [];
  const reports: string[] = [];
  const loader: DraftLoaderPort = {
    loadDraft: (input) => {
      attempts.push(input.plugin);
      const refusal: LoadDraftFailure = { kind: "isolation_unavailable" };
      return Promise.resolve(err(refusal));
    },
    unloadDraft: () => Promise.resolve(true),
    draftOf: () => undefined,
  };
  const load = createDraftLoader({
    loader: () => loader,
    report: (event, fields) => reports.push(JSON.stringify([event, fields])),
    timeoutMs: 1_000,
  });
  expect(await load([DRAFT])).toEqual(err({ name: "widget", kind: "isolation_unavailable" }));
  expect(attempts).toEqual(["widget"]);
  expect(reports).toEqual([
    JSON.stringify([
      "plugin.overlay.draft_load_failed",
      { name: "widget", kind: "isolation_unavailable" },
    ]),
  ]);
});

test("초안 싣기: 두 번째 초안이 실패하면 이 호출이 싣은 첫 초안은 내린다", async () => {
  const loaded: string[] = [];
  const unloaded: string[] = [];
  const loader: DraftLoaderPort = {
    loadDraft: (input) => {
      if (input.plugin === "broken") {
        return Promise.resolve(err({ kind: "safe_mode" }));
      }
      loaded.push(input.plugin);
      return Promise.resolve(ok(partial<LoadInstalledStarted>({ appliesAt: "now" })));
    },
    unloadDraft: (name) => {
      unloaded.push(name);
      return Promise.resolve(true);
    },
    draftOf: () => undefined,
  };
  const load = createDraftLoader({ loader: () => loader, report: () => {}, timeoutMs: 1_000 });
  const broken: DraftRef = { ...DRAFT, name: "broken", draftId: "drf-2" };
  expect(await load([DRAFT, broken])).toEqual(err({ name: "broken", kind: "safe_mode" }));
  expect(loaded).toEqual(["widget"]);
  expect(unloaded).toEqual(["ddrf1-widget"]);
});

test("초안 덧씌우기 포트: 싣지 못한 초안이면 draft_unavailable로 거절하고, 얹지도 적재하지도 않는다", async () => {
  const loaded: string[] = [];
  const attached: unknown[] = [];
  const port = createOverlayPort({
    targetOf: (name) => Promise.resolve(ok(target(name, name === "widget" ? null : HASH))),
    inSet: () => [],
    ensureLoaded: (names) => {
      loaded.push(...names);
      return Promise.resolve();
    },
    draftOf: draftsOf(DRAFT),
    loadDrafts: () => Promise.resolve(err({ name: "widget", kind: "isolation_unavailable" })),
    pluginSet: {
      attachOverlay: (_threadId, marks) => {
        attached.push(marks);
        return Promise.resolve();
      },
      hold: () => Promise.resolve(() => undefined),
      cancelOverlay: () => Promise.resolve(),
    },
    startDrive: () => err({ kind: "no_drive" }),
  });
  expect(
    await port.attach(threadId(), [
      { plugin: "widget", draftId: DRAFT.draftId },
      { plugin: "other" },
    ]),
  ).toEqual(err({ kind: "draft_unavailable", name: "widget" }));
  expect(loaded).toEqual([]);
  expect(attached).toEqual([]);
});

test("초안 덧씌우기 포트: 싣기에 성공하면 표지는 초안 내부 이름으로, 실제 이름과 초안 식별자를 함께 단다", async () => {
  const attached: unknown[] = [];
  const port = createOverlayPort({
    targetOf: targetOf(target("widget", HASH)),
    inSet: () => ["widget"],
    ensureLoaded: () => Promise.resolve(),
    draftOf: draftsOf(DRAFT),
    loadDrafts: () => Promise.resolve(ok(undefined)),
    pluginSet: {
      attachOverlay: (_threadId, marks) => {
        attached.push(marks);
        return Promise.resolve();
      },
      hold: () => Promise.resolve(() => undefined),
      cancelOverlay: () => Promise.resolve(),
    },
    startDrive: () => err({ kind: "no_drive" }),
  });
  expect(await port.attach(threadId(), [{ plugin: "widget", draftId: DRAFT.draftId }])).toEqual(
    ok({
      cacheImpact: "tool_change_append",
      invoked: [{ plugin: "widget", entry: "widget", kind: "plugin" }],
    }),
  );
  expect(attached).toEqual([
    [
      {
        plugin: "ddrf1-widget",
        contentHash: DRAFT_HASH,
        until: "turn",
        draftId: DRAFT.draftId,
        replaces: "widget",
      },
    ],
  ]);
});

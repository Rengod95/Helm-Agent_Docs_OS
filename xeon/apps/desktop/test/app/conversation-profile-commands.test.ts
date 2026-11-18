import { describe, expect, test } from "bun:test";
import type { PluginCard } from "@fresnel/contracts/extensions";
import type {
  DraftInfo,
  InvocableEntry,
  Profile,
  ProfileDefaultResetResult,
} from "@fresnel/contracts/wire";
import { pluginSetOf } from "../../src/app/workbench-commands.ts";
import { thr } from "../state/helpers.ts";
import { engineFake, makeApp, until } from "./support.ts";

// lcM6a: 대화 화면(프로필 칩, 원샷 목록)이 새로 부르는 wire 메서드와 params를 가짜 엔진 위에서 값으로 본다.
// profile.defaultFor, profile.default.reset, plugin.invocables, plugin.list(프로필 필터), plugin.draft.list

type Extra = Parameters<typeof engineFake>[2];

async function liveApp(extra: Extra) {
  const engine = engineFake(undefined, undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().threads.status === "ready", "threads ready");
  return { app, ...engine };
}

const paramsOf = (
  calls: readonly { readonly method: string; readonly params: unknown }[],
  method: string,
): unknown[] => calls.filter((call) => call.method === method).map((call) => call.params);

const HASH = `sha256:${"a".repeat(64)}`;

function card(name: string, usedBy: readonly string[]): PluginCard {
  return {
    name,
    displayName: name,
    purpose: null,
    does: { inject: null, hook: null, drive: null },
    enforcement: "advisory",
    runs: { code: false, isolated: null },
    cost: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
    health: { state: "idle", lastActiveAt: null, lastError: null },
    origin: { kind: "user" },
    review: { state: "approved", currentHash: HASH, pendingItemId: null, approvedAt: null },
    usedBy: [...usedBy],
  };
}

const DEFAULT: Profile = {
  id: "default",
  title: "기본",
  builtin: true,
  plugins: [],
  settings: [],
  startDrive: null,
  updatedAt: "2026-11-18T09:00:00Z",
  rev: 3,
};

describe("대화 화면의 프로필·원샷 wire", () => {
  test("profile.defaultFor는 대화 폴더를 보내고, 폴더가 없으면 빈 params다. 결과는 프로필 id다", async () => {
    const { app, params } = await liveApp({
      results: { "profile.defaultFor": { profileId: "review" } },
    });
    expect(await app.commands.workbench.defaultProfileFor("/w/app")).toEqual({
      ok: true,
      value: "review",
    });
    expect(await app.commands.workbench.defaultProfileFor(null)).toEqual({
      ok: true,
      value: "review",
    });
    expect(paramsOf(params, "profile.defaultFor")).toEqual([{ workspace: "/w/app" }, {}]);
    await app.stop();
  });

  test("profile.default.reset은 preview 값을 그대로 보내고 바뀜을 돌려준다", async () => {
    const reset: ProfileDefaultResetResult = {
      profile: DEFAULT,
      changed: { plugins: true, settings: false },
      threadsUsing: 4,
    };
    const { app, params } = await liveApp({ results: { "profile.default.reset": reset } });
    expect(await app.commands.workbench.resetDefaultProfile(true)).toEqual({
      ok: true,
      value: reset,
    });
    expect(await app.commands.workbench.resetDefaultProfile(false)).toEqual({
      ok: true,
      value: reset,
    });
    expect(paramsOf(params, "profile.default.reset")).toEqual([
      { preview: true },
      { preview: false },
    ]);
    await app.stop();
  });

  test("plugin.invocables는 대화 id를 보내고 항목 배열을 돌려준다", async () => {
    const entries: InvocableEntry[] = [
      { plugin: "review", entry: "review", kind: "skill", title: "리뷰", reviewedHash: HASH },
    ];
    const { app, params } = await liveApp({ results: { "plugin.invocables": { entries } } });
    expect(await app.commands.workbench.invocables(thr(1))).toEqual({ ok: true, value: entries });
    expect(paramsOf(params, "plugin.invocables")).toEqual([{ threadId: thr(1) }]);
    await app.stop();
  });

  test("plugin.list는 프로필 필터를 보내고, 그 프로필이나 공통 묶음이 쓰는 플러그인 이름만 남긴다", async () => {
    const plugins = [
      card("helm", ["review"]),
      card("notes", ["common"]),
      card("lint-kit", ["other"]),
    ];
    const { app, params } = await liveApp({ results: { "plugin.list": { plugins } } });
    const got = await app.commands.workbench.pluginsInProfile("review");
    expect(got.ok ? [...got.value].toSorted() : null).toEqual(["helm", "notes"]);
    expect(paramsOf(params, "plugin.list")).toEqual([{ filter: { profileId: "review" } }]);
    await app.stop();
  });

  test("plugin.draft.list는 플러그인 이름을 보내고 드래프트 배열을 돌려준다", async () => {
    const drafts: DraftInfo[] = [
      {
        draftId: "drf_2",
        name: "lint-kit",
        contentHash: `sha256:${"b".repeat(64)}`,
        parent: null,
        createdAt: "2026-11-18T09:00:00Z",
        originThreadId: null,
        label: "더 엄격하게",
        submittedItemId: null,
      },
    ];
    const { app, params } = await liveApp({ results: { "plugin.draft.list": { drafts } } });
    expect(await app.commands.workbench.drafts("lint-kit")).toEqual({ ok: true, value: drafts });
    expect(paramsOf(params, "plugin.draft.list")).toEqual([{ name: "lint-kit" }]);
    await app.stop();
  });

  test("pluginSetOf: 공통 묶음(common)과 그 프로필이 쓰는 카드만 든다", () => {
    expect(
      [
        ...pluginSetOf(
          [
            { name: "a", usedBy: ["common"] },
            { name: "b", usedBy: ["p1", "p2"] },
            { name: "c", usedBy: [] },
          ],
          "p2",
        ),
      ].toSorted(),
    ).toEqual(["a", "b"]);
  });
});

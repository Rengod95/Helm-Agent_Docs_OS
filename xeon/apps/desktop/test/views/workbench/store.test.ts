import { describe, expect, test } from "bun:test";
import type { ExtGetResult, ExtHealthEntry, ExtListEntry } from "@fresnel/contracts/wire";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";

const e = (name: string, status: ExtListEntry["status"]): ExtListEntry => ({
  name,
  displayName: name,
  layer: "L2",
  isGroup: false,
  version: "1.0.0",
  location: "/x",
  requestedGrade: "user",
  effectiveGrade: "user",
  tier: null,
  status,
  plugins: [{ registrationId: `${name}#root`, layer: "L2", status, inGroup: false }],
  diagnostics: [],
  autoDisabled: false,
  safeModeExcluded: null,
  hookCount: 0,
});

const got = (name: string): ExtGetResult => ({
  entry: e(name, "enabled"),
  manifest: {},
  hooks: [],
  bindings: [],
});

const failing = (name: string): ExtHealthEntry => ({
  name,
  registrationId: `${name}#root`,
  consecutiveFailures: 3,
  windowFailures: 3,
  windowMs: 1000,
  autoDisabled: false,
  lastFailureAt: "2026-11-04T10:00:00Z",
  lastError: "timeout",
});

describe("크래프트 스토어", () => {
  test("고른 것과 자세히 보기는 목록 갱신에서 사라진 확장이면 풀린다", () => {
    const store = createWorkbenchStore();
    store.actions.listLoaded([e("a", "enabled"), e("b", "enabled")]);
    store.actions.pickPlugin("b");
    store.actions.openDetail("b");
    store.actions.listLoaded([e("a", "enabled")]);
    expect(store.actions.snapshot()).toMatchObject({
      sel: { k: "agent" },
      panel: false,
      detail: null,
      list: "ready",
    });
  });

  test("고르기는 플러그인·그룹·층을 구분하고, 자세히 보기는 선택을 바꾸지 않는다", () => {
    const store = createWorkbenchStore();
    store.actions.listLoaded([e("a", "enabled")]);
    store.actions.pickGroup("a");
    expect([store.actions.snapshot().sel, store.actions.snapshot().panel]).toEqual([
      { k: "group", id: "a" },
      true,
    ]);
    store.actions.pickSel({ k: "layer", id: "L2" });
    expect(store.actions.snapshot()).toMatchObject({ sel: { k: "layer", id: "L2" }, panel: true });
    store.actions.select("a");
    store.actions.openDetail("a");
    expect(store.actions.snapshot()).toMatchObject({ sel: { k: "plugin", id: "a" }, detail: "a" });
    store.actions.clearPick();
    expect(store.actions.snapshot()).toMatchObject({ sel: { k: "agent" }, panel: false });
    store.actions.select("a");
    store.actions.select(null);
    expect(store.actions.snapshot()).toMatchObject({ sel: { k: "agent" }, panel: false });
  });

  test("끄기 대기는 목록이 목표 상태를 보이면 걷힌다", () => {
    const store = createWorkbenchStore();
    store.actions.listLoaded([e("a", "enabled")]);
    store.actions.markPending("a", false);
    store.actions.listLoaded([e("a", "enabled")]);
    expect(store.actions.snapshot().pending).toEqual({ a: false });
    store.actions.listLoaded([e("a", "disabled")]);
    expect(store.actions.snapshot().pending).toEqual({});
  });

  test("거르기: 종류는 하나를 고르고 넣어 주는 것은 토글한다", () => {
    const store = createWorkbenchStore();
    store.actions.setKind("single");
    store.actions.toggleContrib("hook");
    store.actions.toggleContrib("view");
    expect(store.actions.snapshot()).toMatchObject({
      kind: "single",
      contrib: ["hook", "view"],
    });
    store.actions.toggleContrib("hook");
    expect(store.actions.snapshot().contrib).toEqual(["view"]);
  });

  test("상세, 실패 장부, 순서 표는 캐시에 들어가고, 상세는 목록에서 사라진 확장이면 걷힌다", () => {
    const store = createWorkbenchStore();
    store.actions.listLoaded([e("a", "enabled"), e("b", "enabled")]);
    store.actions.detailsLoaded("a", got("a"));
    store.actions.detailsLoaded("b", got("b"));
    store.actions.healthLoaded([failing("a")]);
    store.actions.ordersLoaded({ "tool.call.before": ["a#root"] });
    expect(Object.keys(store.actions.snapshot().details).toSorted()).toEqual(["a", "b"]);
    expect(store.actions.snapshot()).toMatchObject({
      health: { "a#root": failing("a") },
      order: { "tool.call.before": ["a#root"] },
    });
    store.actions.listLoaded([e("a", "enabled")]);
    expect(Object.keys(store.actions.snapshot().details)).toEqual(["a"]);
  });

  test("15-3: 빌더 요청이 훅 이름을 담는다", () => {
    const store = createWorkbenchStore();
    store.actions.requestBuilder("tool.call.before");
    expect(store.actions.snapshot().builder).toEqual({ hook: "tool.call.before" });
    store.actions.closeBuilder();
    expect(store.actions.snapshot().builder).toBeNull();
  });

  test("보기를 바꾸면 자세히 보기가 닫히고 고른 것은 남는다", () => {
    const store = createWorkbenchStore();
    store.actions.listLoaded([e("a", "enabled")]);
    store.actions.pickPlugin("a");
    store.actions.openDetail("a");
    store.actions.setView("strata");
    expect(store.actions.snapshot()).toMatchObject({
      view: "strata",
      detail: null,
      sel: { k: "plugin", id: "a" },
    });
  });
});

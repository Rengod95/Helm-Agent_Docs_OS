import { describe, expect, test } from "bun:test";
import type { ExtGetResult, ExtHealthEntry, ExtListEntry } from "@fresnel/contracts/wire";
import {
  INITIAL_WORKBENCH,
  clearPending,
  clearPick,
  closeBuilder,
  closeDetail,
  countsOf,
  detailsLoaded,
  extOf,
  healthLoaded,
  keepOffOf,
  layerGroups,
  listLoaded,
  markPending,
  openDetail,
  openLayerOf,
  ordersLoaded,
  pickGroup,
  pickPlugin,
  pickSel,
  rowOf,
  requestBuilder,
  select,
  selectedEntry,
  selectedName,
  setKind,
  setQuery,
  setView,
  toggleContrib,
  toggleRequestOf,
  versionRows,
  visibleRows,
} from "../../src/workbench/index.ts";

function entry(name: string, over: Partial<ExtListEntry> = {}): ExtListEntry {
  return {
    name,
    displayName: name,
    layer: "L2",
    isGroup: false,
    version: "1.0.0",
    location: "/x",
    origin: "user",
    requestedGrade: "user",
    effectiveGrade: "user",
    tier: null,
    status: "enabled",
    plugins: [{ registrationId: `${name}#root`, layer: "L2", status: "enabled", inGroup: false }],
    diagnostics: [],
    autoDisabled: false,
    safeModeExcluded: null,
    hookCount: 0,
    ...over,
  };
}

const web = entry("web", { displayName: "웹 검색" });

const base = listLoaded(INITIAL_WORKBENCH, [
  entry("core-loop", { layer: "L1", tier: "core", origin: "builtin" }),
  web,
  entry("helm", {
    layer: "L3",
    isGroup: true,
    plugins: [
      { registrationId: "helm", layer: "L3", status: "enabled", inGroup: true },
      { registrationId: "helm/lens", id: "lens", layer: "L3", status: "enabled", inGroup: true },
    ],
  }),
  entry("review", { layer: "L3", isGroup: true, status: "disabled", autoDisabled: true }),
  entry("acme", { layer: "external", safeModeExcluded: "안전 모드" }),
]);

function detailOf(e: ExtListEntry): ExtGetResult {
  return { entry: e, manifest: {}, hooks: [], bindings: [] };
}

function healthOf(registrationId: string, over: Partial<ExtHealthEntry> = {}): ExtHealthEntry {
  return {
    name: extOf(registrationId),
    registrationId,
    consecutiveFailures: 0,
    windowFailures: 0,
    windowMs: 0,
    autoDisabled: false,
    lastFailureAt: null,
    lastError: null,
    ...over,
  };
}

describe("workbench model", () => {
  test("초기 상태: 에이전트를 고르고 패널은 닫힌 채 거르기와 캐시는 비어 있다", () => {
    expect(INITIAL_WORKBENCH).toMatchObject({
      view: "orbit",
      sel: { k: "agent" },
      panel: false,
      detail: null,
      kind: "all",
      contrib: [],
      details: {},
      health: {},
      order: {},
      pending: {},
      builder: null,
    });
  });

  test("목록이 들어오면 준비 상태와 개수가 맞다", () => {
    expect(base.list).toBe("ready");
    expect(countsOf(base)).toEqual({ total: 5, on: 4, autoDisabled: 1 });
  });

  test("층 묶음은 L1, L2, L3, 그 밖 순서이고 켜짐 수를 센다", () => {
    expect(layerGroups(base).map((g) => [g.layer, g.total, g.on])).toEqual([
      ["L1", 1, 1],
      ["L2", 1, 1],
      ["L3", 2, 1],
      ["external", 1, 1],
    ]);
  });

  test("행 모델: 종류, 표시 이름, 상태, 잠금", () => {
    const rows = visibleRows(base);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName["core-loop"]).toMatchObject({ kind: "core", lock: "exempt", state: "on" });
    expect(byName["web"]).toMatchObject({ kind: "plugin", displayName: "웹 검색", lock: null });
    expect(byName["helm"]).toMatchObject({ kind: "group", displayName: null });
    expect(byName["review"]).toMatchObject({ state: "auto_disabled", on: false, failed: true });
    expect(byName["acme"]).toMatchObject({ state: "safe_excluded", lock: "safe_mode" });
  });

  test("찾기는 이름과 표시 이름을 대소문자 없이 거른다", () => {
    expect(visibleRows(setQuery(base, "웹")).map((r) => r.name)).toEqual(["web"]);
    expect(visibleRows(setQuery(base, "HEL")).map((r) => r.name)).toEqual(["helm"]);
  });

  test("켜기·끄기는 사용자 범위 키 하나이고 잠긴 행은 거절한다", () => {
    expect(toggleRequestOf(base, "web", false)).toEqual({
      ok: true,
      request: { key: "ext.web.enabled", value: false, scope: "user" },
    });
    expect(toggleRequestOf(base, "core-loop", false)).toEqual({ ok: false, reason: "locked" });
    expect(toggleRequestOf(base, "nope", true)).toEqual({ ok: false, reason: "unknown" });
  });

  test("계속 꺼 둘까요: 묻지 않은 확장은 null이고, 물으면 시작 횟수와 답할 수 있는지를 준다", () => {
    const asked = entry("review", {
      status: "disabled",
      autoDisabled: true,
      keepOffQuestion: { disabledStarts: 3 },
    });
    expect(keepOffOf(entry("web"), true)).toBeNull();
    expect(keepOffOf(asked, true)).toEqual({ disabledStarts: 3, answerable: true });
  });

  test("계속 꺼 둘까요: 연결이 끊기면 답할 수 없고, 잠긴 확장도 답할 수 없다", () => {
    const asked = { keepOffQuestion: { disabledStarts: 2 } };
    expect(keepOffOf(entry("review", asked), false)).toEqual({
      disabledStarts: 2,
      answerable: false,
    });
    expect(keepOffOf(entry("review", { ...asked, enabledSource: "managed" }), true)).toEqual({
      disabledStarts: 2,
      answerable: false,
    });
    expect(keepOffOf(entry("acme", { ...asked, safeModeExcluded: "안전 모드" }), true)).toEqual({
      disabledStarts: 2,
      answerable: false,
    });
  });

  test("대기 표시는 반영되면 목록이 걷어 낸다", () => {
    const pending = markPending(base, "web", false);
    expect(rowOf(web, pending.pending).pendingTarget).toBe(false);
    const still = listLoaded(pending, base.entries);
    expect(still.pending).toEqual({ web: false });
    const done = listLoaded(
      pending,
      base.entries.map((e) => (e.name === "web" ? { ...e, status: "disabled" as const } : e)),
    );
    expect(done.pending).toEqual({});
    expect(clearPending(pending, "web").pending).toEqual({});
  });

  test("extOf는 첫 슬래시 앞 조각이다", () => {
    expect(["helm", "helm/lens", "a/b/c", ""].map(extOf)).toEqual(["helm", "helm", "a", ""]);
  });

  test("고른 구성원은 확장 이름으로 찾고 자세히 보기가 있으면 그것을 우선한다", () => {
    const picked = pickPlugin(base, "helm/lens");
    expect([picked.sel, picked.panel]).toEqual([{ k: "plugin", id: "helm/lens" }, true]);
    expect(selectedName(picked)).toBe("helm");
    expect(selectedEntry(picked)?.name).toBe("helm");

    // 자세히 보기는 선택을 바꾸지 않는다. 열린 쪽이 선택 패널 대신 보인다
    const opened = openDetail(base, "web");
    expect(opened.sel).toEqual({ k: "agent" });
    expect(selectedName(opened)).toBeNull();
    expect(selectedEntry(opened)?.name).toBe("web");
    expect(selectedEntry(openDetail(picked, "review"))?.name).toBe("review");
  });

  test("목록 갱신은 사라진 확장을 가리키는 선택과 자세히 보기를 풀고 남은 것은 그대로 둔다", () => {
    const grouped = pickGroup(openDetail(base, "helm"), "helm");
    const kept = listLoaded(grouped, base.entries);
    expect([kept.sel, kept.panel, kept.detail]).toEqual([{ k: "group", id: "helm" }, true, "helm"]);

    const removed = listLoaded(
      grouped,
      base.entries.filter((e) => e.name !== "helm"),
    );
    expect([removed.sel, removed.panel, removed.detail]).toEqual([{ k: "agent" }, false, null]);
  });

  test("층과 훅 선택은 목록 갱신에도 남고 층만 openLayerOf가 읽는다", () => {
    const layer = pickSel(base, { k: "layer", id: "L2" });
    expect(openLayerOf(listLoaded(layer, base.entries))).toBe("L2");
    expect(openLayerOf(base)).toBeNull();
    expect(selectedName(layer)).toBeNull();
    const hook = pickSel(base, { k: "hook", id: "tool.call.before" });
    expect(listLoaded(hook, base.entries).sel).toEqual({ k: "hook", id: "tool.call.before" });
  });

  test("select는 이름이 있으면 플러그인으로 고르고 null이면 비운다", () => {
    expect(select(base, "web")).toMatchObject({ sel: { k: "plugin", id: "web" }, panel: true });
    expect(select(pickPlugin(base, "web"), null)).toMatchObject({
      sel: { k: "agent" },
      panel: false,
    });
    expect(clearPick(pickGroup(base, "helm"))).toMatchObject({ sel: { k: "agent" }, panel: false });
  });

  test("구성 요소 거르기: 종류는 하나로 고치고 넣어 주는 것은 토글한다", () => {
    expect(setKind(base, "group").kind).toBe("group");
    expect(toggleContrib(toggleContrib(base, "hook"), "tool").contrib).toEqual(["hook", "tool"]);
    expect(toggleContrib(toggleContrib(base, "hook"), "hook").contrib).toEqual([]);
  });

  test("보기를 바꾸면 자세히 보기가 닫히고 선택은 남는다", () => {
    const picked = pickPlugin(openDetail(base, "helm"), "helm");
    expect(setView(picked, "strata")).toMatchObject({
      view: "strata",
      detail: null,
      sel: { k: "plugin", id: "helm" },
    });
    expect(closeDetail(picked).detail).toBeNull();
  });

  test("ext.get 결과는 확장 이름 아래에 들어가고 목록에서 사라지면 걷힌다", () => {
    const got = detailsLoaded(base, "helm", detailOf(entry("helm", { isGroup: true })));
    expect(Object.keys(got.details)).toEqual(["helm"]);
    expect(got.details.helm?.entry.name).toBe("helm");
    const pruned = listLoaded(
      detailsLoaded(got, "web", detailOf(web)),
      base.entries.filter((e) => e.name !== "helm"),
    );
    expect(Object.keys(pruned.details)).toEqual(["web"]);
  });

  test("ext.health 결과는 등록 id별로 전체 장부를 바꾼다", () => {
    const first = healthLoaded(base, [
      healthOf("web", { consecutiveFailures: 2, lastError: "timeout" }),
      healthOf("helm/lens", { autoDisabled: true }),
    ]);
    expect(Object.keys(first.health).toSorted()).toEqual(["helm/lens", "web"]);
    expect(first.health.web).toMatchObject({ consecutiveFailures: 2, lastError: "timeout" });
    const second = healthLoaded(first, [healthOf("acme#root")]);
    expect(Object.keys(second.health)).toEqual(["acme#root"]);
  });

  test("순서 표는 훅마다 적용 중 Registration id 순서를 통째로 담는다", () => {
    const ordered = ordersLoaded(base, { "tool.call.before": ["helm/lens", "helm"] });
    expect(ordered.order).toEqual({ "tool.call.before": ["helm/lens", "helm"] });
    expect(ordersLoaded(ordered, {}).order).toEqual({});
  });

  test("빌더 요청은 고른 훅을 담고 닫으면 비운다", () => {
    const asked = requestBuilder(base, "tool.call.before");
    expect(asked.builder).toEqual({ hook: "tool.call.before" });
    expect(requestBuilder(base, null).builder).toEqual({ hook: null });
    expect(closeBuilder(asked).builder).toBeNull();
  });

  test("버전 행: 지금 판은 되돌릴 수 없고 스키마가 높으면 상태를 비워야 한다", () => {
    const rows = versionRows({
      versions: [
        {
          version: "0.3.0",
          installedAt: "t3",
          source: "user",
          manifestHash: "c",
          stateSchemaVersion: 2,
          current: true,
        },
        {
          version: "0.2.0",
          installedAt: "t2",
          source: "user",
          manifestHash: "b",
          stateSchemaVersion: 1,
          current: false,
        },
        {
          version: "0.4.0",
          installedAt: "t4",
          source: "bundled",
          manifestHash: "d",
          stateSchemaVersion: 3,
          current: false,
        },
      ],
    });
    expect(rows.map((r) => [r.version, r.canRollback, r.needsClearState])).toEqual([
      ["0.3.0", false, false],
      ["0.2.0", true, false],
      ["0.4.0", true, true],
    ]);
  });
});

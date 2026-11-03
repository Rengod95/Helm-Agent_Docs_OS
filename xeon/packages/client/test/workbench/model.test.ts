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
  failureRowsOf,
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
  versionsViewOf,
  visibleRows,
  type HandlerFailureEntry,
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

describe("버전 탭 그림(§6.24.1 전체·대체·오류)", () => {
  const history = {
    versions: [
      {
        version: "0.3.0",
        installedAt: "t3",
        source: "user" as const,
        manifestHash: "c",
        stateSchemaVersion: 2,
        current: true,
      },
      {
        version: "0.2.0",
        installedAt: "t2",
        source: "user" as const,
        manifestHash: "b",
        stateSchemaVersion: 1,
        current: false,
      },
    ],
  };

  test("기록이 있으면 전체 단계다: 행마다 되돌릴 수 있는지, 지금 판인지", () => {
    const view = versionsViewOf(
      { version: "0.3.0", origin: "user" },
      { kind: "ready", result: history },
    );
    expect(view).toEqual({
      kind: "history",
      rows: [
        {
          version: "0.3.0",
          installedAt: "t3",
          source: "user",
          current: true,
          canRollback: false,
          needsClearState: false,
        },
        {
          version: "0.2.0",
          installedAt: "t2",
          source: "user",
          current: false,
          canRollback: true,
          needsClearState: false,
        },
      ],
    });
  });

  test("기본(builtin) 플러그인에 기록이 없으면 대체: 설치본과 앱에 든 번들 버전을 같이 보인다", () => {
    const empty = { kind: "ready" as const, result: { versions: [] } };
    expect(versionsViewOf({ version: "0.4.1", origin: "builtin" }, empty)).toEqual({
      kind: "fallback",
      installed: "0.4.1",
      bundled: "0.4.1",
      rollbackTo: null,
    });
    expect(
      versionsViewOf({ version: "0.4.1", origin: "builtin" }, { kind: "unsupported" }),
    ).toEqual({ kind: "fallback", installed: "0.4.1", bundled: "0.4.1", rollbackTo: null });
  });

  test("사용자가 만든 확장에 기록이 없으면 대체이고 번들 버전은 없다", () => {
    const empty = { kind: "ready" as const, result: { versions: [] } };
    expect(versionsViewOf({ version: "0.0.9", origin: "user" }, empty)).toEqual({
      kind: "fallback",
      installed: "0.0.9",
      bundled: null,
      rollbackTo: null,
    });
    expect(versionsViewOf({ version: "0.0.9", origin: "user" }, { kind: "unsupported" })).toEqual({
      kind: "fallback",
      installed: "0.0.9",
      bundled: null,
      rollbackTo: null,
    });
  });

  test("origin이 없는 옛 호스트의 확장은 사용자 확장으로 본다", () => {
    expect(versionsViewOf({ version: "1.0.0" }, { kind: "unsupported" })).toEqual({
      kind: "fallback",
      installed: "1.0.0",
      bundled: null,
      rollbackTo: null,
    });
  });

  test("읽기 실패는 오류 그림이다", () => {
    expect(versionsViewOf({ version: "0.0.9", origin: "user" }, { kind: "error" })).toEqual({
      kind: "error",
    });
  });

  test("앱에 든 번들 판이 설치본과 다르고 기록에 없으면 되돌릴 수 있는 행을 맨 뒤에 더한다", () => {
    const view = versionsViewOf(
      { version: "0.3.0", origin: "user" },
      { kind: "ready", result: { ...history, bundledVersion: "0.1.0" } },
    );
    expect(view).toEqual({
      kind: "history",
      rows: [
        {
          version: "0.3.0",
          installedAt: "t3",
          source: "user",
          current: true,
          canRollback: false,
          needsClearState: false,
        },
        {
          version: "0.2.0",
          installedAt: "t2",
          source: "user",
          current: false,
          canRollback: true,
          needsClearState: false,
        },
        {
          version: "0.1.0",
          installedAt: null,
          source: "bundled",
          current: false,
          canRollback: true,
          needsClearState: false,
        },
      ],
    });
  });

  test("번들 판이 설치본과 같거나 기록에 이미 있으면 행을 더하지 않는다", () => {
    const sameAsInstalled = versionsViewOf(
      { version: "0.3.0", origin: "user" },
      { kind: "ready", result: { ...history, bundledVersion: "0.3.0" } },
    );
    expect(sameAsInstalled).toEqual(
      versionsViewOf({ version: "0.3.0", origin: "user" }, { kind: "ready", result: history }),
    );
    const recorded = versionsViewOf(
      { version: "0.3.0", origin: "user" },
      { kind: "ready", result: { ...history, bundledVersion: "0.2.0" } },
    );
    expect(recorded).toEqual(
      versionsViewOf({ version: "0.3.0", origin: "user" }, { kind: "ready", result: history }),
    );
    expect(recorded.kind === "history" ? recorded.rows.map((row) => row.version) : null).toEqual([
      "0.3.0",
      "0.2.0",
    ]);
  });

  test("기록이 비어도 번들 판이 설치본과 다르면 대체 그림에 번들 판으로 되돌리기를 연다", () => {
    expect(
      versionsViewOf(
        { version: "0.4.1", origin: "user" },
        { kind: "ready", result: { versions: [], bundledVersion: "0.4.0" } },
      ),
    ).toEqual({ kind: "fallback", installed: "0.4.1", bundled: "0.4.0", rollbackTo: "0.4.0" });
  });

  test("기록이 비고 번들 판이 설치본과 같으면 되돌릴 곳이 없다", () => {
    expect(
      versionsViewOf(
        { version: "0.4.1", origin: "user" },
        { kind: "ready", result: { versions: [], bundledVersion: "0.4.1" } },
      ),
    ).toEqual({ kind: "fallback", installed: "0.4.1", bundled: "0.4.1", rollbackTo: null });
  });
});

/** 기록 한 건을 만든다(시험용 짧은 이름) */
const rec = (
  owner: string,
  point: string,
  result: string,
  message: string,
  consecutive: number,
): HandlerFailureEntry => ({ owner, point, result, message, consecutive });

describe("기록 탭: 확장별 실패 묶음(scope.handler_failed)", () => {
  test("같은 훅·결과·메시지는 한 행이고 횟수는 기록 수, 연속은 가장 나중 값이다. 가장 최근 행이 위에 온다", () => {
    const rows = failureRowsOf(
      [
        rec("ext:flaky", "tool.call.before", "error", "boom", 1),
        rec("ext:flaky", "input.agent.before", "timeout", "slow", 1),
        rec("ext:flaky", "tool.call.before", "error", "boom", 2),
        rec("ext:other", "tool.call.before", "error", "boom", 9),
        rec("ext:flaky", "tool.call.before", "error", "boom", 3),
      ],
      "flaky",
    );
    expect(rows).toEqual([
      { point: "tool.call.before", result: "error", message: "boom", count: 3, consecutive: 3 },
      { point: "input.agent.before", result: "timeout", message: "slow", count: 1, consecutive: 1 },
    ]);
  });

  test("기록이 없는 확장은 빈 목록이다", () => {
    expect(failureRowsOf([rec("ext:other", "tool.call.before", "error", "x", 1)], "flaky")).toEqual(
      [],
    );
  });
});

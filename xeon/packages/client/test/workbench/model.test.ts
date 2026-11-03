import { describe, expect, test } from "bun:test";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import {
  INITIAL_WORKBENCH,
  clearPending,
  closeBuilder,
  closeDetail,
  countsOf,
  layerGroups,
  listLoaded,
  markPending,
  openDetail,
  rowOf,
  requestBuilder,
  select,
  setQuery,
  setView,
  toggleKind,
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

const base = listLoaded(INITIAL_WORKBENCH, [
  entry("core-loop", { layer: "L1", tier: "core", origin: "builtin" }),
  entry("web", { displayName: "웹 검색" }),
  entry("helm", { layer: "L3", isGroup: true }),
  entry("review", { layer: "L3", isGroup: true, status: "disabled", autoDisabled: true }),
  entry("acme", { layer: "external", safeModeExcluded: "안전 모드" }),
]);

describe("workbench model", () => {
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

  test("대기 표시는 반영되면 목록이 걷어 낸다", () => {
    const pending = markPending(base, "web", false);
    expect(rowOf(base.entries[1]!, pending.pending).pendingTarget).toBe(false);
    const still = listLoaded(pending, base.entries);
    expect(still.pending).toEqual({ web: false });
    const done = listLoaded(
      pending,
      base.entries.map((e) => (e.name === "web" ? { ...e, status: "disabled" as const } : e)),
    );
    expect(done.pending).toEqual({});
    expect(clearPending(pending, "web").pending).toEqual({});
  });

  test("사라진 확장을 가리키던 고름과 자세히 보기는 풀린다", () => {
    const opened = openDetail(base, "helm");
    expect(opened.selected).toBe("helm");
    const next = listLoaded(
      opened,
      base.entries.filter((e) => e.name !== "helm"),
    );
    expect([next.selected, next.detail]).toEqual([null, null]);
    expect(closeDetail(opened).detail).toBeNull();
    expect(select(base, "web").selected).toBe("web");
  });

  test("보기를 바꾸면 자세히 보기가 닫히고 구성 요소 필터는 토글된다", () => {
    expect(setView(openDetail(base, "helm"), "strata")).toMatchObject({
      view: "strata",
      detail: null,
    });
    expect(toggleKind(toggleKind(base, "hook"), "tool").kinds).toEqual(["hook", "tool"]);
    expect(toggleKind(toggleKind(base, "hook"), "hook").kinds).toEqual([]);
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

import { describe, expect, test } from "bun:test";
import type { ExtUiEntry, GroupMetricsResult } from "@fresnel/contracts/wire";
import {
  costText,
  durationOf,
  enabledScopeOf,
  extSettingPrefixes,
  extSettingRowsOf,
  groupMetricsOf,
  screenRowsOf,
  settingScopeOf,
  slotOf,
  tabReadOf,
  type TabSlot,
} from "../../src/workbench/index.ts";
import { effectiveOf, wireDef } from "../settings/fixtures.ts";

const ui = (over: Partial<ExtUiEntry> = {}): ExtUiEntry => ({
  extension: "web",
  id: "panel",
  placement: "panel",
  mode: "native",
  title: "웹 패널",
  state: "ok",
  version: "1.0.0",
  trust: "user",
  issues: [],
  ...over,
});

const metricsResult = (metrics: GroupMetricsResult["metrics"]): GroupMetricsResult => ({
  id: "review",
  metrics,
  since: null,
});

const FULL = {
  inputTokens: 1200,
  outputTokens: 300,
  cacheReadTokens: 900,
  cacheWriteTokens: 50,
  costUsd: 3.1,
  leaseMs: 2_460_000,
  leases: 4,
  denies: 12,
  chainPatches: 0,
  handlerErrors: 1,
  posts: 7,
  spawns: 3,
  delegates: 2,
  commits: 1,
  records: 9,
};

describe("출처 배지 범위", () => {
  test("켜짐 출처는 user가 전역, project가 작업 폴더, thread가 이 대화다", () => {
    expect(enabledScopeOf("user")).toBe("global");
    expect(enabledScopeOf("project")).toBe("project");
    expect(enabledScopeOf("thread")).toBe("thread");
    expect(enabledScopeOf("managed")).toBe("managed");
    expect(enabledScopeOf("default")).toBe("default");
  });

  test("출처를 싣지 않았으면 배지를 두지 않는다(null)", () => {
    expect(enabledScopeOf(undefined)).toBeNull();
  });

  test("설정 범위는 user가 전역, launch가 이 대화, project가 작업 폴더다", () => {
    expect(settingScopeOf("user")).toBe("global");
    expect(settingScopeOf("project")).toBe("project");
    expect(settingScopeOf("launch")).toBe("thread");
    expect(settingScopeOf("local")).toBe("local");
    expect(settingScopeOf("managed")).toBe("managed");
    expect(settingScopeOf("default")).toBe("default");
  });
});

describe("설정 탭 줄", () => {
  test("확장 설정 접두사는 ext.<이름>.과 l3.<이름>.이다", () => {
    expect(extSettingPrefixes("web")).toEqual(["ext.web.", "l3.web."]);
  });

  test("이 확장의 plugins 탭 키만 남기고, 정렬은 순서와 키 순서다", () => {
    const rows = extSettingRowsOf("web", {
      defs: [
        wireDef({
          key: "ext.web.instrumentation",
          type: { type: "boolean" },
          ui: { tab: "plugins", widget: "toggle", order: 200, label: "계측" },
        }),
        wireDef({
          key: "ext.web.enabled",
          type: { type: "boolean" },
          ui: { tab: "plugins", widget: "toggle", order: 10, label: "웹 검색 켜기" },
        }),
        wireDef({
          key: "ext.web.model",
          type: { type: "string" },
          ui: { tab: "plugins", widget: "text", order: 30, label: "모델" },
        }),
        wireDef({
          key: "ext.other.enabled",
          type: { type: "boolean" },
          ui: { tab: "plugins", widget: "toggle", order: 10, label: "다른 확장" },
        }),
        wireDef({
          key: "ext.web.general",
          type: { type: "boolean" },
          ui: { tab: "models", widget: "toggle", order: 1, label: "다른 탭" },
        }),
      ],
      values: [
        effectiveOf("ext.web.instrumentation", false, {
          source: { scope: "project", path: "/p/settings.json" },
        }),
        effectiveOf("ext.web.enabled", true, { source: { scope: "user" } }),
        effectiveOf("ext.web.model", "gpt", { source: { scope: "launch" } }),
        effectiveOf("ext.other.enabled", false),
        effectiveOf("ext.web.general", true),
      ],
      hasThread: true,
    });
    expect(rows).toEqual([
      {
        key: "ext.web.enabled",
        label: "웹 검색 켜기",
        value: { kind: "text", text: "true" },
        scope: "global",
      },
      {
        key: "ext.web.model",
        label: "모델",
        value: { kind: "text", text: "gpt" },
        scope: "thread",
      },
      {
        key: "ext.web.instrumentation",
        label: "계측",
        value: { kind: "text", text: "false" },
        scope: "project",
      },
    ]);
  });

  test("시크릿은 참조가 있으면 값 없이 secret, 없으면 unset이다", () => {
    const secret = wireDef({
      key: "ext.web.apiKey",
      type: { type: "string", pattern: "^secret://[a-z][a-z0-9-]{1,63}$" },
      secret: true,
      ui: { tab: "plugins", widget: "secret", order: 20, label: "키" },
    });
    const registered = extSettingRowsOf("web", {
      defs: [secret],
      values: [effectiveOf("ext.web.apiKey", "secret://web-key")],
      hasThread: false,
    });
    expect(registered).toEqual([
      { key: "ext.web.apiKey", label: "키", value: { kind: "secret" }, scope: "global" },
    ]);
    const missing = extSettingRowsOf("web", {
      defs: [secret],
      values: [],
      hasThread: false,
    });
    expect(missing).toEqual([
      { key: "ext.web.apiKey", label: "키", value: { kind: "unset" }, scope: "default" },
    ]);
  });

  test("값이 없는 설정은 unset이고 출처는 기본값이다. 이 확장 설정이 없으면 빈 목록이다", () => {
    const rows = extSettingRowsOf("web", {
      defs: [
        wireDef({
          key: "ext.web.limit",
          type: { type: "integer" },
          ui: { tab: "plugins", widget: "number", order: 5, label: "한도" },
        }),
      ],
      values: [],
      hasThread: false,
    });
    expect(rows).toEqual([
      { key: "ext.web.limit", label: "한도", value: { kind: "unset" }, scope: "default" },
    ]);
    expect(extSettingRowsOf("web", { defs: [], values: [], hasThread: false })).toEqual([]);
  });
});

describe("측정 탭 값", () => {
  test("시간은 밀리초, 초, 분으로 내림해서 단위와 함께 준다", () => {
    expect(durationOf(0)).toEqual({ unit: "ms", value: 0 });
    expect(durationOf(999)).toEqual({ unit: "ms", value: 999 });
    expect(durationOf(1000)).toEqual({ unit: "sec", value: 1 });
    expect(durationOf(59_999)).toEqual({ unit: "sec", value: 59 });
    expect(durationOf(60_000)).toEqual({ unit: "min", value: 1 });
    expect(durationOf(2_460_000)).toEqual({ unit: "min", value: 41 });
  });

  test("비용은 0이거나 1센트 이상이면 소수 둘, 그 밑이면 소수 넷이다", () => {
    expect(costText(0)).toBe("$0.00");
    expect(costText(3.1)).toBe("$3.10");
    expect(costText(0.01)).toBe("$0.01");
    expect(costText(0.004)).toBe("$0.0040");
    expect(costText(0.00003)).toBe("< $0.0001");
  });

  test("측정 값은 토큰 네 칸(입력, 출력, 캐시 읽기, 캐시 쓰기)과 나머지 수를 그대로 옮긴다", () => {
    expect(groupMetricsOf(metricsResult(FULL))).toEqual({
      tokens: [
        { key: "input", value: 1200 },
        { key: "output", value: 300 },
        { key: "cacheRead", value: 900 },
        { key: "cacheWrite", value: 50 },
      ],
      costUsd: 3.1,
      lead: { unit: "min", value: 41 },
      denies: 12,
      handlerErrors: 1,
      posts: 7,
      spawns: 3,
    });
  });

  test("계측이 꺼져 있으면(metrics가 null) 값이 없다", () => {
    expect(groupMetricsOf(metricsResult(null))).toBeNull();
  });
});

describe("화면 탭 줄", () => {
  test("이 확장이 기여한 화면만, 호스트 순서대로, 진단 수와 함께 준다", () => {
    const rows = screenRowsOf("web", [
      ui({ id: "panel", title: "웹 패널" }),
      ui({ extension: "other", id: "x", title: "다른 확장" }),
      ui({
        id: "status",
        placement: "status",
        mode: "app",
        state: "invalid",
        issues: [{ severity: "error", code: "bad", message: "깨짐" }],
      }),
    ]);
    expect(rows).toEqual([
      {
        id: "panel",
        title: "웹 패널",
        placement: "panel",
        mode: "native",
        state: "ok",
        issues: 0,
      },
      {
        id: "status",
        title: "웹 패널",
        placement: "status",
        mode: "app",
        state: "invalid",
        issues: 1,
      },
    ]);
  });

  test("화면이 없으면 빈 목록이다", () => {
    expect(screenRowsOf("web", [ui({ extension: "other" })])).toEqual([]);
  });
});

describe("탭 읽기 상태", () => {
  const ready: TabSlot<number> = { key: "web", state: { kind: "ready", value: 7 } };
  const failed: TabSlot<number> = { key: "web", state: { kind: "error" } };

  test("연결이 살아 있고 읽기 전이면 읽는 중이다", () => {
    expect(tabReadOf(null, "web", "live")).toEqual({ kind: "loading" });
  });

  test("같은 키의 읽은 값이 있으면 그 값을 보이고 마지막 값이 아니다", () => {
    expect(tabReadOf(ready, "web", "live")).toEqual({ kind: "ready", value: 7, stale: false });
  });

  test("다른 키(다른 확장이나 대화)의 값은 쓰지 않고 읽는 중이다", () => {
    expect(tabReadOf(ready, "learning", "live")).toEqual({ kind: "loading" });
  });

  test("읽기가 실패했으면 오류 한 줄 상태다", () => {
    expect(tabReadOf(failed, "web", "live")).toEqual({ kind: "error" });
  });

  test("연결 중에는 같은 키의 마지막 값을 stale로 보이고, 값이 없으면 읽는 중이다", () => {
    expect(tabReadOf(ready, "web", "pending")).toEqual({ kind: "ready", value: 7, stale: true });
    expect(tabReadOf(null, "web", "pending")).toEqual({ kind: "loading" });
  });

  test("연결이 끊기면 같은 키의 마지막 값을 stale로 보인다", () => {
    expect(tabReadOf(ready, "web", "offline")).toEqual({ kind: "ready", value: 7, stale: true });
  });

  test("연결이 끊겼고 읽은 값이 없거나 실패뿐이면 오프라인이다", () => {
    expect(tabReadOf(null, "web", "offline")).toEqual({ kind: "offline" });
    expect(tabReadOf(failed, "web", "offline")).toEqual({ kind: "offline" });
    expect(tabReadOf(ready, "learning", "offline")).toEqual({ kind: "offline" });
  });

  test("명령 결과를 슬롯으로 바꾸면 성공은 값, 실패는 오류 상태가 된다", () => {
    expect(slotOf("web", { ok: true, value: 3 })).toEqual({
      key: "web",
      state: { kind: "ready", value: 3 },
    });
    expect(slotOf("web", { ok: false, error: { kind: "unsupported" } })).toEqual({
      key: "web",
      state: { kind: "error" },
    });
  });
});

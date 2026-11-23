// 준비 상태 모으기(plugWire, AGE-76): 엔진 카드의 도구 칸(`externalTool`)과 의존(`dependencies.dependsOn`)에서 화면의 도구 줄을 만든다.
import { describe, expect, test } from "bun:test";
import type { CardDependency, CardExternalTool, PluginCard } from "@fresnel/contracts/extensions";
import {
  needsAttentionOf,
  readinessBlocked,
  toolNeedOf,
  toolReadinessOf,
  type ToolNeedVM,
} from "../../../src/views/workbench/tool-ready.ts";

function card(name: string, over: Partial<PluginCard> = {}): PluginCard {
  return {
    name,
    displayName: name,
    purpose: null,
    does: { inject: null, hook: null, drive: null },
    enforcement: "advisory",
    runs: { code: false, isolated: null },
    cost: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
    health: { state: "ok", lastActiveAt: null, lastError: null },
    origin: { kind: "builtin" },
    review: { state: "approved", currentHash: null, pendingItemId: null, approvedAt: null },
    usedBy: [],
    ...over,
  };
}

function tool(binary: string, over: Partial<CardExternalTool> = {}): CardExternalTool {
  return {
    binary,
    versionArgs: "--version",
    install: { ko: `${binary} 설치: brew install ${binary}`, en: `brew install ${binary}` },
    bundled: false,
    ...over,
  };
}

function dep(target: string, kind: CardDependency["kind"]): CardDependency {
  return { from: "cap-workspace", target, kind, range: null, problem: null };
}

describe("toolNeedOf: 도구 칸 하나를 줄로", () => {
  test("엔진 상태 다섯 가지와 점검 전을 화면 상태로 옮기고, 버전과 화면 언어의 설치 안내를 싣는다", () => {
    const of = (over: Partial<CardExternalTool>, required = true): ToolNeedVM =>
      toolNeedOf("tool-sops", tool("sops", over), required, "ko");
    expect(of({ status: { kind: "ready", version: "3.9.1" }, minVersion: "3.9.0" })).toEqual({
      plugin: "tool-sops",
      tool: "sops",
      state: "ready",
      required: true,
      minVersion: "3.9.0",
      foundVersion: "3.9.1",
      install: "sops 설치: brew install sops",
    });
    expect(of({ status: { kind: "bundled", version: "14.1.1" } }, false)).toMatchObject({
      state: "bundled",
      required: false,
      minVersion: null,
      foundVersion: "14.1.1",
    });
    expect(of({ status: { kind: "missing" } })).toMatchObject({
      state: "missing",
      foundVersion: null,
    });
    // 낮은 버전은 엔진이 판정에 쓴 필요한 버전을 보인다
    expect(
      of({ minVersion: "3.0.0", status: { kind: "too_old", found: "3.8.1", required: "3.9.0" } }),
    ).toMatchObject({ state: "tooOld", minVersion: "3.9.0", foundVersion: "3.8.1" });
    expect(of({ status: { kind: "unusable", reason: "spawn_failed" } })).toMatchObject({
      state: "unusable",
      foundVersion: null,
    });
    expect(of({})).toMatchObject({ state: "unchecked", foundVersion: null });
    expect(toolNeedOf("tool-sops", tool("sops"), true, "en").install).toBe("brew install sops");
  });
});

describe("toolReadinessOf: 카드의 준비 상태", () => {
  const rg = card("tool-rg", { externalTool: tool("rg", { status: { kind: "missing" } }) });
  const git = card("tool-git", {
    externalTool: tool("git", { status: { kind: "ready", version: "2.47.0" } }),
  });
  const cards = new Map([rg, git].map((c) => [c.name, c] as const));
  const cardOf = (name: string): PluginCard | null => cards.get(name) ?? null;

  test("도구 플러그인은 자기 도구 한 줄이고 늘 필수다", () => {
    expect(toolReadinessOf(git, cardOf, "ko")?.needs.map((n) => [n.plugin, n.required])).toEqual([
      ["tool-git", true],
    ]);
  });

  test("도구에 기대는 플러그인은 의존 순서대로 도구마다 한 줄: hard는 필수, soft는 선택이다", () => {
    const workspace = card("cap-workspace", {
      dependencies: {
        dependsOn: [
          dep("tool-rg", "hard"),
          dep("tool-git", "soft"),
          // 도구가 아닌 의존과 없는 카드, 자기 자신은 줄이 되지 않는다
          dep("cap-dialog", "hard"),
          dep("tool-missing-card", "hard"),
          dep("cap-workspace/inner", "hard"),
        ],
        dependents: [],
      },
    });
    const needs = toolReadinessOf(workspace, cardOf, "ko")?.needs ?? [];
    expect(needs.map((n) => [n.plugin, n.tool, n.state, n.required])).toEqual([
      ["tool-rg", "rg", "missing", true],
      ["tool-git", "git", "ready", false],
    ]);
  });

  test("같은 도구를 여러 멤버가 가리키면 한 줄이고 hard가 이긴다", () => {
    const many = card("kit", {
      dependencies: {
        dependsOn: [dep("tool-git", "soft"), dep("tool-git/x", "hard")],
        dependents: [],
      },
    });
    expect(toolReadinessOf(many, cardOf, "ko")?.needs.map((n) => [n.plugin, n.required])).toEqual([
      ["tool-git", true],
    ]);
  });

  test("도구와 상관없으면 null이다", () => {
    expect(toolReadinessOf(card("plain"), cardOf, "ko")).toBeNull();
    const nonTool = card("kit", {
      dependencies: { dependsOn: [dep("cap-dialog", "hard")], dependents: [] },
    });
    expect(toolReadinessOf(nonTool, cardOf, "ko")).toBeNull();
  });
});

function need(state: ToolNeedVM["state"], required: boolean): ToolNeedVM {
  return {
    plugin: "tool-x",
    tool: "x",
    state,
    required,
    minVersion: null,
    foundVersion: null,
    install: "",
  };
}

describe("경고와 준비 안 됨", () => {
  test("없거나 버전이 낮거나 쓸 수 없으면 경고 줄이다", () => {
    expect(
      (["ready", "bundled", "missing", "tooOld", "unusable", "unchecked"] as const).map((state) =>
        needsAttentionOf({ state }),
      ),
    ).toEqual([false, false, true, true, true, false]);
  });

  test("필수 도구가 경고일 때만 준비 안 됨이다(선택 도구와 점검 전은 막지 않는다)", () => {
    expect(readinessBlocked(null)).toBe(false);
    expect(readinessBlocked({ needs: [need("missing", true)] })).toBe(true);
    expect(readinessBlocked({ needs: [need("tooOld", true)] })).toBe(true);
    expect(readinessBlocked({ needs: [need("missing", false), need("ready", true)] })).toBe(false);
    expect(readinessBlocked({ needs: [need("unchecked", true)] })).toBe(false);
  });
});

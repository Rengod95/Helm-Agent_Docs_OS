// 플러그인 상세 "개요" 탭의 순수 모델(plugTab): 글 칸 정리, Hook·도구 수, 도구 상태 글 키, 경고 줄 기준, 프로필 이름.
import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { InjectInventory, PluginCard } from "@fresnel/contracts/extensions";
import type { Profile } from "@fresnel/contracts/wire";
import {
  cardTextOf,
  hookCountOf,
  needsAttentionOf,
  profilesWithOf,
  readinessWordOf,
  toolCountOf,
} from "../../../src/views/workbench/overview-model.ts";
import { TOOL_NEED_STATES, type ToolNeedVM } from "../../../src/views/workbench/tool-ready.ts";

function card(over: Partial<PluginCard> = {}): PluginCard {
  return {
    name: "kit",
    displayName: "킷",
    purpose: "목적",
    does: { inject: null, hook: null, drive: null },
    enforcement: "advisory",
    runs: { code: false, isolated: null },
    cost: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
    health: { state: "ok", lastActiveAt: null, lastError: null },
    origin: { kind: "user" },
    review: { state: "approved", currentHash: null, pendingItemId: null, approvedAt: null },
    usedBy: [],
    ...over,
  };
}

const INJECT: InjectInventory = {
  instructions: { always: [], skills: [] },
  tools: [{ name: "grep", description: null }],
  mcpServers: [{ name: "fs", transport: "stdio" }],
  agents: [],
  providers: [],
  commands: [],
  ui: [],
  replaces: [],
};

function need(over: Partial<ToolNeedVM>): ToolNeedVM {
  return {
    tool: "python3",
    state: "ready",
    required: true,
    minVersion: null,
    foundVersion: null,
    why: null,
    install: null,
    ...over,
  };
}

describe("개요의 글 칸", () => {
  test("목적과 설명은 앞뒤 공백을 떼고, 비었거나 없으면 null이다", () => {
    expect(cardTextOf("  목적  ")).toBe("목적");
    expect(cardTextOf("   ")).toBeNull();
    expect(cardTextOf("")).toBeNull();
    expect(cardTextOf(null)).toBeNull();
    expect(cardTextOf(undefined)).toBeNull();
  });
});

describe("개요의 셈", () => {
  test("Hook 수는 훅 칸의 개수이고, 칸이 없으면 0이다", () => {
    expect(hookCountOf(card())).toBe(0);
    const hook = { name: "h", fold: "tap" as const, position: "p", powers: [] };
    expect(
      hookCountOf(card({ does: { inject: null, hook: { hooks: [hook, hook] }, drive: null } })),
    ).toBe(2);
  });

  test("도구 수는 도구와 MCP 서버를 더한 값이고, Inject 칸이 없으면 0이다", () => {
    expect(toolCountOf(card())).toBe(0);
    expect(toolCountOf(card({ does: { inject: INJECT, hook: null, drive: null } }))).toBe(2);
  });
});

describe("준비 상태의 글과 경고 기준", () => {
  test("도구 상태마다 글 키가 하나씩 있다", () => {
    expect(TOOL_NEED_STATES.map(readinessWordOf)).toEqual([
      "desktop.workbench.detail.ready.ready",
      "desktop.workbench.detail.ready.missing",
      "desktop.workbench.detail.ready.tooOld",
      "desktop.workbench.detail.ready.bundled",
    ]);
    expect(t(readinessWordOf("tooOld"))).toBe("버전이 낮아요");
  });

  test("없거나 버전이 낮은 도구만 경고 줄이 된다", () => {
    expect(needsAttentionOf(need({ state: "missing" }))).toBe(true);
    expect(needsAttentionOf(need({ state: "tooOld" }))).toBe(true);
    expect(needsAttentionOf(need({ state: "ready" }))).toBe(false);
    expect(needsAttentionOf(need({ state: "bundled" }))).toBe(false);
  });
});

/** 시험용 프로필 하나. 넣은 플러그인 이름만 채운다 */
function profile(id: string, title: string, plugins: readonly string[]): Profile {
  return {
    id,
    title,
    builtin: false,
    plugins: plugins.map((name) => ({ name })),
    settings: [],
    startDrive: null,
    updatedAt: "2026-11-23T00:00:00.000Z",
    rev: 1,
  };
}

describe("프로필 이름", () => {
  test("플러그인을 넣은 프로필의 보이는 이름을 목록 순서대로 준다", () => {
    const profiles = [
      profile("review", "리뷰", ["kit"]),
      profile("writing", "글쓰기", ["other"]),
      profile("daily", "매일", ["kit", "other"]),
    ];
    expect(profilesWithOf("kit", profiles)).toEqual([
      { id: "review", title: "리뷰" },
      { id: "daily", title: "매일" },
    ]);
    expect(profilesWithOf("missing", profiles)).toEqual([]);
  });
});

// 플러그인 상세 "개요" 탭의 순수 모델(plugTab, plugWire): 글 칸 정리, 내장 플러그인 글의 화면 언어, Hook·도구 수, 도구 상태 글 키, 프로필 이름.
import { describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, t, type Locale } from "@fresnel/client/i18n";
import type { InjectInventory, PluginCard } from "@fresnel/contracts/extensions";
import type { Profile } from "@fresnel/contracts/wire";
import {
  cardLeadOf,
  cardTextIn,
  cardTextOf,
  firstSentenceOf,
  hookCountOf,
  profilesWithOf,
  readinessWordOf,
  toolCountOf,
} from "../../../src/views/workbench/overview-model.ts";
import { TOOL_NEED_STATES } from "../../../src/views/workbench/tool-ready.ts";

/** 화면 언어를 잠깐 바꿔 읽는다 */
function inLocale<T>(locale: Locale, read: () => T): T {
  const before = activeLocale();
  setActiveLocale(locale);
  try {
    return read();
  } finally {
    setActiveLocale(before);
  }
}

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

describe("개요의 글 칸", () => {
  test("목적과 설명은 앞뒤 공백을 떼고, 비었거나 없으면 null이다", () => {
    expect(cardTextOf("  목적  ")).toBe("목적");
    expect(cardTextOf("   ")).toBeNull();
    expect(cardTextOf("")).toBeNull();
    expect(cardTextOf(null)).toBeNull();
    expect(cardTextOf(undefined)).toBeNull();
  });

  test("내장 플러그인의 목적과 설명은 카탈로그의 화면 언어 글이고, 사용자 플러그인은 카드 값 그대로다", () => {
    const goal = card({
      name: "host-goal-bridge",
      purpose: "Shows goals beside the conversation.",
      origin: { kind: "builtin" },
    });
    expect(inLocale("ko", () => cardTextIn(goal, "purpose"))).toBe("목표를 대화 옆에 보여 줘요.");
    expect(inLocale("en", () => cardTextIn(goal, "purpose"))).toBe(
      "Shows goals beside the conversation.",
    );
    expect(inLocale("ko", () => cardTextIn(card({ purpose: " 내 목적 " }), "purpose"))).toBe(
      "내 목적",
    );
    // 이름이 내장과 같아도 사용자 플러그인이면 카드 값이다
    const mine = card({ name: "host-goal-bridge", purpose: "mine" });
    expect(inLocale("ko", () => cardTextIn(mine, "purpose"))).toBe("mine");
    expect(inLocale("ko", () => cardTextIn(card({ description: "설명" }), "description"))).toBe(
      "설명",
    );
  });
});

describe("카드의 한 줄(목적이 없으면 설명의 첫 문장)", () => {
  test("a purpose is the line, and a description is not repeated", () => {
    expect(cardLeadOf(card({ purpose: "보드를 관리해요", description: "설명. 둘째." }))).toEqual({
      text: "보드를 관리해요",
      fromDescription: false,
    });
  });

  test("without a purpose the line is the first sentence of the description", () => {
    expect(
      cardLeadOf(
        card({ purpose: null, description: "Helm이 목표를 나눠 조사해요. 결과를 모아요." }),
      ),
    ).toEqual({ text: "Helm이 목표를 나눠 조사해요.", fromDescription: true });
  });

  test("with neither a purpose nor a description there is no line", () => {
    expect(cardLeadOf(card({ purpose: null }))).toBeNull();
    expect(cardLeadOf(card({ purpose: "  ", description: "  " }))).toBeNull();
  });

  test("the first sentence ends at a period followed by a space or the end, not inside v1.2", () => {
    expect(firstSentenceOf("Reads files. Writes them.")).toBe("Reads files.");
    expect(firstSentenceOf("v1.2로 올려요")).toBe("v1.2로 올려요");
    expect(firstSentenceOf("첫 줄에 마침표 없음\n둘째 줄. 셋째.")).toBe("첫 줄에 마침표 없음");
    expect(firstSentenceOf("끝에 마침표.")).toBe("끝에 마침표.");
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

describe("준비 상태의 글", () => {
  test("도구 상태마다 글 키가 하나씩 있다", () => {
    expect(TOOL_NEED_STATES.map(readinessWordOf)).toEqual([
      "desktop.workbench.detail.ready.ready",
      "desktop.workbench.detail.ready.bundled",
      "desktop.workbench.detail.ready.missing",
      "desktop.workbench.detail.ready.tooOld",
      "desktop.workbench.detail.ready.unusable",
      "desktop.workbench.detail.ready.unchecked",
    ]);
    expect(t(readinessWordOf("tooOld"))).toBe("버전이 낮아요");
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

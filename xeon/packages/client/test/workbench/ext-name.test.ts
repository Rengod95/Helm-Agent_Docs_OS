import { describe, expect, test } from "bun:test";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { activeLocale, setActiveLocale, type Locale } from "../../src/i18n/index.ts";
import { extNameOf, rowOf } from "../../src/workbench/index.ts";

function inLocale<T>(locale: Locale, read: () => T): T {
  const before = activeLocale();
  setActiveLocale(locale);
  try {
    return read();
  } finally {
    setActiveLocale(before);
  }
}

const full = (over: Partial<ExtListEntry>): ExtListEntry => ({
  name: "x",
  displayName: "x",
  layer: "L1",
  isOrchestration: false,
  version: "1.0.0",
  location: "/x",
  origin: "builtin",
  requestedGrade: "user",
  effectiveGrade: "user",
  tier: null,
  status: "enabled",
  plugins: [],
  diagnostics: [],
  autoDisabled: false,
  safeModeExcluded: null,
  hookCount: 0,
  ...over,
});

const part: Pick<ExtListEntry, "name" | "displayName"> = {
  name: "core-persistence",
  displayName: "Session persistence",
};

describe("확장 이름", () => {
  test("카탈로그에 ext.name 키가 있으면 한국어 이름을 쓴다", () => {
    expect(inLocale("ko", () => extNameOf(part))).toBe("대화 저장");
  });

  test("영어 말투와 키가 없는 확장은 매니페스트 이름을 쓴다", () => {
    expect(inLocale("en", () => extNameOf(part))).toBe("Session persistence");
    expect(inLocale("ko", () => extNameOf({ name: "x-other", displayName: "Other Tool" }))).toBe(
      "Other Tool",
    );
  });

  test("행의 표시 이름은 한국어 이름이고, 이름이 id와 같으면 null이다", () => {
    inLocale("ko", () => {
      expect(rowOf(full(part)).displayName).toBe("대화 저장");
      expect(rowOf(full({})).displayName).toBeNull();
    });
  });
});

const pick = (name: string, displayName: string): string =>
  inLocale("ko", () => extNameOf({ name, displayName }));

describe("기능 부품 이름", () => {
  test("cap·host 부품과 그룹이 한국어 이름을 쓴다", () => {
    expect(pick("cap-workspace", "Workspace tools")).toBe("작업 폴더 도구");
    expect(pick("cap-dialog", "Client Services")).toBe("클라이언트 서비스");
    expect(pick("cap-artifacts", "Artifacts and reviews")).toBe("아티팩트와 검토");
    expect(pick("host-dialog-bridge", "Ask Service Bridge")).toBe("애스크 서비스 브릿지");
    expect(pick("cap-work", "Work management")).toBe("작업 관리");
    expect(pick("cap-mcp", "MCP client")).toBe("MCP 연결");
    expect(pick("cap-web", "Web tools")).toBe("웹 도구");
    expect(pick("cap-knowledge", "Knowledge and memory")).toBe("지식과 기억");
    expect(pick("host-goal-bridge", "Goal Service Bridge")).toBe("골 서비스 브릿지");
    expect(pick("host-task-bridge", "Task Service Bridge")).toBe("태스크 서비스 브릿지");
    expect(pick("host-skill-bridge", "Skill Service Bridge")).toBe("스킬 서비스 브릿지");
    expect(pick("host-memory-bridge", "Memory Service Bridge")).toBe("메모리 서비스 브릿지");
    expect(pick("host-proposals-bridge", "Proposal Service Bridge")).toBe("프로포절 서비스 브릿지");
    expect(pick("cap-schedule", "Schedules")).toBe("예약");
    expect(pick("authoring", "Plugin Builder")).toBe("플러그인 빌더");
  });
});

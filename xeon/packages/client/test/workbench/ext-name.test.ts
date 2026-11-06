import { describe, expect, test } from "bun:test";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { activeLocale, setActiveLocale, type Locale } from "../../src/i18n/index.ts";
import { extNameOf, INITIAL_WORKBENCH, rowOf } from "../../src/workbench/index.ts";

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
  isGroup: false,
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
      expect(rowOf(full(part), INITIAL_WORKBENCH.pending).displayName).toBe("대화 저장");
      expect(rowOf(full({}), INITIAL_WORKBENCH.pending).displayName).toBeNull();
    });
  });
});

const pick = (name: string, displayName: string): string =>
  inLocale("ko", () => extNameOf({ name, displayName }));

describe("기능 부품 이름", () => {
  test("cap·host 부품과 그룹이 한국어 이름을 쓴다", () => {
    expect(pick("cap-workspace", "Workspace tools")).toBe("작업 폴더 도구");
    expect(pick("cap-dialog", "Dialog")).toBe("질문과 알림");
    expect(pick("cap-artifacts", "Artifacts and reviews")).toBe("산출물과 검토");
    expect(pick("host-dialog-bridge", "Dialog bridge")).toBe("질문 연결");
    expect(pick("cap-work", "Work management")).toBe("작업 관리");
    expect(pick("cap-mcp", "MCP client")).toBe("MCP 연결");
    expect(pick("cap-web", "Web tools")).toBe("웹 도구");
    expect(pick("cap-knowledge", "Knowledge and memory")).toBe("지식과 기억");
    expect(pick("host-dialog-area-bridge", "Dialog area bridge")).toBe("대화 영역 연결");
    expect(pick("host-proposals-bridge", "Proposals bridge")).toBe("제안 연결");
    expect(pick("cap-schedule", "Schedules")).toBe("예약");
    expect(pick("host-groups", "Group service")).toBe("그룹 서비스");
    expect(pick("authoring", "Plugin Builder")).toBe("플러그인 빌더");
  });
});

import { describe, expect, test } from "bun:test";
import {
  SECTION_OF_KEY,
  SECTION_ORDER,
  SETTINGS_SECTIONS,
  searchSectionsOf,
  sectionOfJump,
  sectionStep,
  shownFieldsOf,
} from "../../src/views/pages/settings/settings-sections.ts";
import { defOf, settingOf, viewOf } from "./settings-fixtures.ts";

// 설정 구역 표(L4.settings-ui §3 [결정: 2026-11-11 사용자]). 키는 한 구역에만 들고, 예산 키는 화면에 없고, 점프는 키의
// 구역을 먼저 본다. 값은 `toEqual`·`toBe`로 비교한다.

describe("section table", () => {
  test("twelve sections in nav order, with the app, agent and engine groups", () => {
    expect(SECTION_ORDER).toEqual([
      "general",
      "notifications",
      "models",
      "secrets",
      "permissions",
      "sandbox",
      "tools",
      "plugins",
      "sessions",
      "connection",
      "execution",
      "data",
    ]);
  });

  test("no key is listed twice", () => {
    const keys = SECTION_ORDER.flatMap((id) =>
      SETTINGS_SECTIONS[id].parts.flatMap((part) => (part.kind === "fields" ? part.keys : [])),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(SECTION_OF_KEY.size).toBe(keys.length);
  });

  test("budget, continuation and service keys are not on the screen", () => {
    for (const key of [
      "l1.loop.maxSteps",
      "l1.loop.continuation.enabled",
      "l0.process.service.enabled",
      "l2.dialog.notify.turnEnd",
    ]) {
      expect(SECTION_OF_KEY.has(key)).toBe(false);
    }
  });

  test("moving in the nav stops at both ends", () => {
    expect(sectionStep("general", -1)).toBe("general");
    expect(sectionStep("general", 1)).toBe("notifications");
    expect(sectionStep("data", 1)).toBe("data");
    expect(sectionStep("sessions", 1)).toBe("connection");
  });
});

describe("jump", () => {
  test("a key on the screen opens its section, otherwise the target section or the old tab's new home", () => {
    expect(sectionOfJump("overview", "l1.models.default")).toBe("models");
    expect(sectionOfJump("connection", null)).toBe("connection");
    expect(sectionOfJump("budgets", null)).toBe("models");
    expect(sectionOfJump("advanced", "l1.loop.maxSteps")).toBe("data");
  });
});

describe("search", () => {
  const MODEL = defOf(
    "l1.models.default",
    "models",
    "text",
    { type: "string" },
    {},
    {
      order: 1,
      label: "기본 모델",
    },
  );
  const STEPS = defOf(
    "l1.loop.maxSteps",
    "budgets",
    "number",
    { type: "integer" },
    {},
    {
      order: 2,
      label: "단계 상한",
    },
  );
  const view = viewOf([MODEL, STEPS], [settingOf(MODEL.key, "a"), settingOf(STEPS.key, 3)]);
  const shown = shownFieldsOf(view.tabs);

  test("only keys on the screen are shown and searched", () => {
    expect([...shown.keys()]).toEqual(["l1.models.default"]);
    expect(searchSectionsOf(shown, "단계")).toEqual([]);
  });

  test("a match is grouped under its section, and an empty query finds nothing", () => {
    expect(
      searchSectionsOf(shown, " 기본 ").map((match) => ({
        section: match.section,
        keys: match.fields.map((field) => field.key),
      })),
    ).toEqual([{ section: "models", keys: ["l1.models.default"] }]);
    expect(searchSectionsOf(shown, "  ")).toEqual([]);
  });
});

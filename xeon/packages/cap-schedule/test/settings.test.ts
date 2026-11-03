import { describe, expect, test } from "bun:test";
import type { ScopeLayer } from "@fresnel/contracts/settings";
import {
  DEFAULT_SCHEDULE_SETTINGS,
  readScheduleSettings,
  SCHEDULE_SETTING_DEFS,
} from "../src/index.ts";

// L2.schedule.spec §6 `l2.schedule.entries.directCreate`. 기본 allow, 파일 범위는 managed와 user뿐이다 [결정: 2026-11-03 사용자].

const KEY = "l2.schedule.entries.directCreate";

function layer(scope: ScopeLayer["scope"], value: unknown): ScopeLayer {
  return { scope, values: new Map([[KEY, value]]) };
}

describe("l2.schedule.entries.directCreate declaration", () => {
  test("is declared once, defaults to allow, takes allow, ask and deny, and only managed and user may set it", () => {
    const matches = SCHEDULE_SETTING_DEFS.filter((def) => def.key === KEY);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      key: KEY,
      default: "allow",
      range: { enum: ["allow", "ask", "deny"] },
      allowedScopes: ["managed", "user"],
    });
  });
});

describe("readScheduleSettings", () => {
  test("with no layers the default is allow", () => {
    expect(readScheduleSettings([])).toEqual(DEFAULT_SCHEDULE_SETTINGS);
    expect(DEFAULT_SCHEDULE_SETTINGS.entries.directCreate).toBe("allow");
  });

  test("a user or managed value is read as given", () => {
    expect(readScheduleSettings([layer("user", "deny")]).entries.directCreate).toBe("deny");
    expect(readScheduleSettings([layer("user", "ask")]).entries.directCreate).toBe("ask");
    expect(readScheduleSettings([layer("managed", "deny")]).entries.directCreate).toBe("deny");
  });

  test("a repository's project or local layer has no effect on it", () => {
    expect(readScheduleSettings([layer("project", "deny")]).entries.directCreate).toBe("allow");
    expect(readScheduleSettings([layer("local", "deny")]).entries.directCreate).toBe("allow");
    expect(readScheduleSettings([layer("project", "ask")]).entries.directCreate).toBe("allow");
  });

  test("a project layer does not hide a user value", () => {
    const layers = [layer("project", "allow"), layer("user", "deny")];
    expect(readScheduleSettings(layers).entries.directCreate).toBe("deny");
  });

  test("a value outside the list is ignored and the default applies", () => {
    expect(readScheduleSettings([layer("user", "maybe")]).entries.directCreate).toBe("allow");
    expect(readScheduleSettings([layer("user", 1)]).entries.directCreate).toBe("allow");
  });
});

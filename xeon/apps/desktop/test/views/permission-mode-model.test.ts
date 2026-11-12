import { describe, expect, test } from "bun:test";
import type { SettingsInvalidation } from "@fresnel/client/settings";
import type { EventWire } from "@fresnel/contracts/wire";
import {
  BYPASS_ALLOWED_KEY,
  PERMISSION_MODE_KEY,
  bypassAllowedOf,
  modeChangeConcerns,
  modeEventConcerns,
  modeStepOf,
  permissionModeOf,
  permissionModeOptionsOf,
  permissionModeToneOf,
  switchModeOf,
  type PermissionModeOption,
} from "../../src/views/permission-mode-model.ts";
import { evt, thr } from "../state/helpers.ts";

const ALL_MODES = ["default", "acceptEdits", "plan", "bypass"] as const;

describe("permissionModeOf", () => {
  test("네 모드 값은 그대로 받는다", () => {
    expect(permissionModeOf("default")).toBe("default");
    expect(permissionModeOf("acceptEdits")).toBe("acceptEdits");
    expect(permissionModeOf("plan")).toBe("plan");
    expect(permissionModeOf("bypass")).toBe("bypass");
  });

  test("모르는 값과 문자열이 아닌 값은 null이다", () => {
    expect(permissionModeOf("Plan")).toBeNull();
    expect(permissionModeOf("auto")).toBeNull();
    expect(permissionModeOf("")).toBeNull();
    expect(permissionModeOf(null)).toBeNull();
    expect(permissionModeOf(undefined)).toBeNull();
    expect(permissionModeOf(["default"])).toBeNull();
  });
});

describe("permissionModeToneOf", () => {
  test("모두 허용만 위험 색이고 나머지 모드는 보통 색이다", () => {
    expect(permissionModeToneOf("bypass")).toBe("danger");
    expect(permissionModeToneOf("default")).toBe("normal");
    expect(permissionModeToneOf("acceptEdits")).toBe("normal");
    expect(permissionModeToneOf("plan")).toBe("normal");
  });
});

describe("switchModeOf", () => {
  test("기본, 편집 자동 허용, 모두 허용은 설정 쓰기로 고른다", () => {
    expect(switchModeOf("default")).toBe("default");
    expect(switchModeOf("acceptEdits")).toBe("acceptEdits");
    expect(switchModeOf("bypass")).toBe("bypass");
  });

  test("계획과 모르는 값은 설정 쓰기의 목표가 아니다(계획은 명령으로 간다)", () => {
    expect(switchModeOf("plan")).toBeNull();
    expect(switchModeOf("nope")).toBeNull();
  });
});

describe("permissionModeOptionsOf", () => {
  test("모두 허용이 허락되지 않으면 묻기, 편집 자동 허용, 계획 셋이고 지금 모드에 표시가 있다", () => {
    const expected: readonly PermissionModeOption[] = [
      { mode: "default", selected: false },
      { mode: "acceptEdits", selected: true },
      { mode: "plan", selected: false },
    ];
    expect(permissionModeOptionsOf("acceptEdits", false)).toEqual(expected);
  });

  test("모두 허용이 허락되면 넷째 줄로 나온다", () => {
    expect(permissionModeOptionsOf("plan", true).map((option) => option.mode)).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "bypass",
    ]);
  });

  test("허락되지 않아도 지금 모드가 모두 허용이면 그 줄을 남겨 지금 상태를 보인다", () => {
    const options = permissionModeOptionsOf("bypass", false);
    expect(options.at(-1)).toEqual({ mode: "bypass", selected: true });
    for (const current of ALL_MODES) {
      expect(permissionModeOptionsOf(current, true).filter((option) => option.selected)).toEqual([
        { mode: current, selected: true },
      ]);
    }
  });
});

describe("bypassAllowedOf", () => {
  test("참일 때만 참이다", () => {
    expect(bypassAllowedOf(true)).toBe(true);
    expect(bypassAllowedOf(false)).toBe(false);
    expect(bypassAllowedOf(undefined)).toBe(false);
    expect(bypassAllowedOf("true")).toBe(false);
  });
});

describe("modeStepOf", () => {
  test("같은 모드는 할 일이 없다", () => {
    expect(modeStepOf("default", "default")).toEqual({ kind: "none" });
  });

  test("계획으로는 명령으로 들어간다", () => {
    expect(modeStepOf("default", "plan")).toEqual({ kind: "enterPlan" });
    expect(modeStepOf("bypass", "plan")).toEqual({ kind: "enterPlan" });
  });

  test("계획에서는 나온 뒤 고른 모드를 쓴다", () => {
    expect(modeStepOf("plan", "acceptEdits")).toEqual({ kind: "exitPlan", target: "acceptEdits" });
    expect(modeStepOf("plan", "default")).toEqual({ kind: "exitPlan", target: "default" });
  });

  test("나머지는 설정 쓰기다", () => {
    expect(modeStepOf("default", "bypass")).toEqual({ kind: "set", mode: "bypass" });
    expect(modeStepOf("acceptEdits", "default")).toEqual({ kind: "set", mode: "default" });
  });
});

const notice = (over: Partial<SettingsInvalidation>): SettingsInvalidation => ({
  keys: [PERMISSION_MODE_KEY],
  scopes: ["launch"],
  threadId: thr(1),
  ...over,
});

describe("modeChangeConcerns", () => {
  test("이 대화의 권한 모드 키가 바뀌면 다시 읽는다", () => {
    expect(modeChangeConcerns(notice({}), thr(1))).toBe(true);
  });

  test("모두 허용 허락 키가 바뀌어도 다시 읽는다(메뉴의 모두 허용 줄)", () => {
    expect(modeChangeConcerns(notice({ keys: [BYPASS_ALLOWED_KEY] }), thr(1))).toBe(true);
  });

  test("다른 키만 바뀌었으면 다시 읽지 않는다", () => {
    expect(modeChangeConcerns(notice({ keys: ["l4.cli.theme"] }), thr(1))).toBe(false);
  });

  test("키 목록이 비었으면(어느 키인지 모름) 다시 읽는다", () => {
    expect(modeChangeConcerns(notice({ keys: [] }), thr(1))).toBe(true);
  });

  test("다른 대화의 대화 범위 변경은 무시한다", () => {
    expect(modeChangeConcerns(notice({ threadId: thr(2) }), thr(1))).toBe(false);
  });

  test("대화에 묶이지 않은 범위의 변경은 열린 대화와 상관없이 다시 읽는다", () => {
    expect(modeChangeConcerns(notice({ scopes: ["user"], threadId: null }), thr(1))).toBe(true);
  });
});

const record = (over: Partial<EventWire>): EventWire => ({
  id: evt(1),
  kind: "settings.changed",
  version: 1,
  durable: true,
  seq: 1,
  parentId: null,
  threadId: thr(1),
  turnId: null,
  stepId: null,
  recordedAt: "2026-11-07T10:00:00.000Z",
  causationId: null,
  correlationId: "c",
  payload: { key: PERMISSION_MODE_KEY, scope: "launch", value: "acceptEdits" },
  redactions: [],
  ...over,
});

describe("modeEventConcerns", () => {
  test("이 대화의 권한 모드 설정 기록이 있으면 다시 읽는다", () => {
    expect(modeEventConcerns({ events: [record({})] }, thr(1))).toBe(true);
  });

  test("다른 키, 다른 대화, 다른 종류, 모양이 맞지 않는 기록은 무시한다", () => {
    const threadId = thr(1);
    expect(
      modeEventConcerns(
        { events: [record({ payload: { key: "l4.cli.theme", scope: "user", value: "dark" } })] },
        threadId,
      ),
    ).toBe(false);
    expect(modeEventConcerns({ events: [record({ threadId: thr(2) })] }, threadId)).toBe(false);
    expect(modeEventConcerns({ events: [record({ kind: "turn.started" })] }, threadId)).toBe(false);
    expect(modeEventConcerns({ events: [record({ payload: {} })] }, threadId)).toBe(false);
    expect(modeEventConcerns({ events: [] }, threadId)).toBe(false);
  });
});

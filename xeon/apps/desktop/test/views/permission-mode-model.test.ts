import { describe, expect, test } from "bun:test";
import type { SettingsInvalidation } from "@fresnel/client/settings";
import type { EventWire } from "@fresnel/contracts/wire";
import {
  PERMISSION_MODE_KEY,
  modeChangeConcerns,
  modeEventConcerns,
  permissionModeOf,
  permissionModeOptionsOf,
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

describe("switchModeOf", () => {
  test("기본과 편집 자동 허용만 칩의 목표가 된다", () => {
    expect(switchModeOf("default")).toBe("default");
    expect(switchModeOf("acceptEdits")).toBe("acceptEdits");
  });

  test("계획, 모두 허용, 모르는 값은 칩의 목표가 아니다", () => {
    expect(switchModeOf("plan")).toBeNull();
    expect(switchModeOf("bypass")).toBeNull();
    expect(switchModeOf("nope")).toBeNull();
  });
});

describe("permissionModeOptionsOf", () => {
  test("기본과 편집 자동 허용은 둘 다 고를 수 있다", () => {
    const expected: readonly PermissionModeOption[] = [
      { mode: "default", selectable: true },
      { mode: "acceptEdits", selectable: true },
    ];
    expect(permissionModeOptionsOf("default")).toEqual(expected);
    expect(permissionModeOptionsOf("acceptEdits")).toEqual(expected);
  });

  test("지금이 계획이나 모두 허용이면 그 줄을 끝에 고를 수 없게 더한다", () => {
    expect(permissionModeOptionsOf("plan")).toEqual([
      { mode: "default", selectable: true },
      { mode: "acceptEdits", selectable: true },
      { mode: "plan", selectable: false },
    ]);
    expect(permissionModeOptionsOf("bypass")).toEqual([
      { mode: "default", selectable: true },
      { mode: "acceptEdits", selectable: true },
      { mode: "bypass", selectable: false },
    ]);
  });

  test("어느 모드에서든 고를 수 있는 목표는 기본과 편집 자동 허용뿐이다", () => {
    for (const current of ALL_MODES) {
      const targets = permissionModeOptionsOf(current)
        .filter((option) => option.selectable)
        .map((option) => option.mode);
      expect(targets).toEqual(["default", "acceptEdits"]);
    }
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

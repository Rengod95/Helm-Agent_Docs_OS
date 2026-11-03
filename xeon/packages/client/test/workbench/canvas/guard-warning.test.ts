import { describe, expect, test } from "bun:test";
import type { HooksOrderPreviewResult, HookOrderRef } from "@fresnel/contracts/wire";
import { buildOrderWarning, needsConfirm } from "../../../src/workbench/canvas/guard-warning.ts";

const NAMES = new Map([
  ["allow", "Allow"],
  ["deny", "Deny"],
  ["guard", "Guard"],
  ["tap", "Tap"],
  ["cleanup", "Cleanup"],
]);
const nameOf = (id: string): string => NAMES.get(id) ?? id;

const ALLOW: HookOrderRef = { registrationId: "allow", extension: "x", tier: 1 };

function preview(over: Partial<HooksOrderPreviewResult> = {}): HooksOrderPreviewResult {
  return {
    hook: "pre",
    order: ["allow", "deny", "guard"],
    saveable: true,
    skips: [],
    valueChanges: [],
    autoDisable: [],
    guardRisk: [],
    ...over,
  };
}

describe("buildOrderWarning", () => {
  test("건너뜀이 없으면 none이고 목록은 모두 빈 값이다", () => {
    const w = buildOrderWarning(preview(), nameOf);
    expect(w).toEqual({
      severity: "none",
      skipped: [],
      guardLosesFirst: [],
      guardMayBeSkipped: [],
      valueChanges: [],
      autoDisable: [],
    });
  });

  test("건너뜀 노트는 이름과 원래 wire 사유, 앞선 핸들러 이름으로 나온다", () => {
    const w = buildOrderWarning(
      preview({
        skips: [
          {
            registrationId: "deny",
            extension: "x",
            reason: "first_answer",
            by: [ALLOW],
          },
        ],
      }),
      nameOf,
    );
    expect(w.severity).toBe("skip");
    expect(w.skipped).toEqual([
      { registrationId: "deny", name: "Deny", reason: "first_answer", by: ["Allow"] },
    ]);
  });

  test("값 바뀜만 있으면 skip이다", () => {
    const w = buildOrderWarning(
      preview({ valueChanges: [{ registrationId: "tap", extension: "x", by: [ALLOW] }] }),
      nameOf,
    );
    expect(w.severity).toBe("skip");
    expect(w.valueChanges).toEqual(["Tap"]);
  });

  test("자동 끄기 대상만 있으면 skip이다", () => {
    const w = buildOrderWarning(
      preview({
        autoDisable: [{ registrationId: "cleanup", extension: "x", affects: [ALLOW] }],
      }),
      nameOf,
    );
    expect(w.severity).toBe("skip");
    expect(w.autoDisable).toEqual(["Cleanup"]);
  });

  test("guard가 맨 앞을 잃으면 guard이고 losesFirst에 이름이 든다", () => {
    const w = buildOrderWarning(
      preview({
        guardRisk: [
          {
            registrationId: "guard",
            extension: "sec",
            mayBeSkipped: false,
            losesFirstPosition: true,
            by: [ALLOW],
          },
        ],
      }),
      nameOf,
    );
    expect(w.severity).toBe("guard");
    expect(w.guardLosesFirst).toEqual(["Guard"]);
    expect(w.guardMayBeSkipped).toEqual([]);
  });

  test("guard가 건너뛰어질 수 있으면 guard이고 mayBeSkipped에 이름이 든다", () => {
    const w = buildOrderWarning(
      preview({
        guardRisk: [
          {
            registrationId: "guard",
            extension: "sec",
            mayBeSkipped: true,
            losesFirstPosition: false,
            by: [ALLOW],
          },
        ],
      }),
      nameOf,
    );
    expect(w.severity).toBe("guard");
    expect(w.guardLosesFirst).toEqual([]);
    expect(w.guardMayBeSkipped).toEqual(["Guard"]);
  });

  test("guard 위험이 있으면 건너뜀이 함께 있어도 guard이고 건너뜀 목록은 그대로다", () => {
    const w = buildOrderWarning(
      preview({
        skips: [{ registrationId: "deny", extension: "x", reason: "chain_stop", by: [ALLOW] }],
        guardRisk: [
          {
            registrationId: "guard",
            extension: "sec",
            mayBeSkipped: true,
            losesFirstPosition: true,
            by: [ALLOW],
          },
        ],
      }),
      nameOf,
    );
    expect(w.severity).toBe("guard");
    expect(w.skipped.map((s) => s.name)).toEqual(["Deny"]);
    expect(w.guardLosesFirst).toEqual(["Guard"]);
    expect(w.guardMayBeSkipped).toEqual(["Guard"]);
  });

  test("두 플래그가 모두 거짓인 guard 노트는 위험으로 세지 않는다", () => {
    const w = buildOrderWarning(
      preview({
        guardRisk: [
          {
            registrationId: "guard",
            extension: "sec",
            mayBeSkipped: false,
            losesFirstPosition: false,
            by: [],
          },
        ],
      }),
      nameOf,
    );
    expect(w.severity).toBe("none");
    expect(w.guardLosesFirst).toEqual([]);
    expect(w.guardMayBeSkipped).toEqual([]);
  });

  test("이름이 없으면 nameOf가 준 값을 그대로 쓴다", () => {
    const w = buildOrderWarning(
      preview({
        skips: [{ registrationId: "zz", extension: "x", reason: "first_answer", by: [] }],
      }),
      (id) => `name:${id}`,
    );
    expect(w.skipped).toEqual([
      { registrationId: "zz", name: "name:zz", reason: "first_answer", by: [] },
    ]);
  });
});

describe("needsConfirm", () => {
  test("none이면 바로 저장한다", () => {
    expect(needsConfirm(buildOrderWarning(preview(), nameOf))).toBe(false);
  });

  test("skip과 guard는 확인을 묻는다", () => {
    const skip = buildOrderWarning(
      preview({ valueChanges: [{ registrationId: "tap", extension: "x", by: [ALLOW] }] }),
      nameOf,
    );
    const guard = buildOrderWarning(
      preview({
        guardRisk: [
          {
            registrationId: "guard",
            extension: "sec",
            mayBeSkipped: true,
            losesFirstPosition: false,
            by: [ALLOW],
          },
        ],
      }),
      nameOf,
    );
    expect(needsConfirm(skip)).toBe(true);
    expect(needsConfirm(guard)).toBe(true);
  });
});

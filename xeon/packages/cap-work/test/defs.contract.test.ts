import { describe, expect, test } from "bun:test";
import {
  validateCapability,
  validateCapabilitySet,
  WORK_CAPABILITIES,
  WorkGoals,
  WorkPlans,
  WorkReports,
  WorkTasks,
} from "@xeon/contracts/capabilities";

// L2 정의의 readOnly·idempotent 분류는 M3-REQ-88이 채운다. 그 전까지 분류 경고(effect_class_missing)는 이슈로 세지 않는다.
function withoutClassWarnings(
  issues: ReturnType<typeof validateCapability>,
): ReturnType<typeof validateCapability> {
  return issues.filter((issue) => issue.code !== "effect_class_missing");
}

// L2.work.spec §9-6, plan §5 defs.contract. 정의의 정본은 F다. cap-work가 그 정의로 일하기 시작해도 계약이 깨지지 않았는지 확인한다.

describe("work capability definitions", () => {
  test("the four definitions have no validateCapability issue", () => {
    for (const def of [WorkTasks, WorkPlans, WorkGoals, WorkReports]) {
      expect(withoutClassWarnings(validateCapability(def))).toEqual([]);
    }
  });

  test("the set has no tool name conflict", () => {
    expect(validateCapabilitySet(WORK_CAPABILITIES)).toEqual([]);
    const names = WORK_CAPABILITIES.flatMap((def) => def.tools.map((tool) => tool.name));
    expect(new Set(names).size).toBe(names.length);
  });

  test("task_write is the only work.tasks tool and every task method requires replay safety", () => {
    expect(WorkTasks.tools.map((tool) => tool.name)).toEqual(["task_write"]);
    for (const [name, method] of Object.entries(WorkTasks.service.methods)) {
      expect(`${name}:${method.replay}`).toBe(`${name}:safe`);
    }
  });
});

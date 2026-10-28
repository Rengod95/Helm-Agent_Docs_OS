import { expect, test } from "bun:test";
import { buildCatalog, checkSettingDef, type ScopeStack } from "@xeon/contracts/settings";
import { createLayeredTasksSettings, tasksSettings } from "../src/settings.ts";
import { createStaticTasksSettings } from "../src/settings-source.ts";

test("settings_defs_pass_checks", () => {
  const defs = Object.values(tasksSettings.defs);
  expect(defs.map((def) => def.key)).toEqual([
    "l1.tasks.limits.tools",
    "l1.tasks.limits.subagents",
    "l1.tasks.limits.modelCalls",
    "l1.tasks.queue.steeringMode",
    "l1.tasks.queue.followUpMode",
  ]);
  for (const def of defs) {
    expect(checkSettingDef(def)).toEqual([]);
    // spec §6 표: runtimeChange, 허용 범위, 화면 위치
    expect(def.runtimeChange).toBe("live");
    expect(def.allowedScopes).toEqual(["managed", "user", "project", "local", "session"]);
    expect(def.layer).toBe("L1");
    expect(def.since).toBe("0.1.0");
    expect(def.secret).toBeUndefined();
    expect(def.ui?.tab).toBe("execution");
  }
  for (const key of ["limits.tools", "limits.subagents", "limits.modelCalls"] as const) {
    expect(tasksSettings.defs[key].ui?.widget).toBe("number");
    expect(tasksSettings.defs[key].ui?.unit).toBe("개");
  }
  for (const key of ["queue.steeringMode", "queue.followUpMode"] as const) {
    expect(tasksSettings.defs[key].default).toBe("one-at-a-time");
    expect(tasksSettings.defs[key].range).toEqual({ enum: ["all", "one-at-a-time"] });
    expect(tasksSettings.defs[key].ui?.widget).toBe("select");
  }
  expect(tasksSettings.defs["limits.tools"]).toMatchObject({
    default: 8,
    range: { min: 1, max: 64 },
  });
  expect(tasksSettings.defs["limits.subagents"]).toMatchObject({
    default: 16,
    range: { min: 1, max: 100 },
  });
  expect(tasksSettings.defs["limits.modelCalls"]).toMatchObject({
    default: 16,
    range: { min: 1, max: 100 },
  });
  expect(tasksSettings.defs["limits.tools"].ui).toMatchObject({
    order: 10,
    label: "동시 도구 실행 수",
  });
  expect(tasksSettings.defs["limits.subagents"].ui).toMatchObject({
    order: 20,
    label: "동시 서브에이전트 수",
  });
  expect(tasksSettings.defs["limits.modelCalls"].ui).toMatchObject({
    order: 30,
    label: "동시 모델 요청 수",
  });
  expect(tasksSettings.defs["queue.steeringMode"].ui).toMatchObject({
    order: 40,
    label: "방향 수정 입력 배치",
  });
  expect(tasksSettings.defs["queue.followUpMode"].ui).toMatchObject({
    order: 50,
    label: "후속 입력 배치",
  });
  const catalog = buildCatalog([{ owner: "core-tasks", namespace: tasksSettings.namespace, defs }]);
  expect(catalog.ok).toBe(true);
});

test("the static settings source defaults to one-at-a-time and takes overrides", () => {
  expect(createStaticTasksSettings().steeringMode()).toBe("one-at-a-time");
  expect(createStaticTasksSettings().followUpMode()).toBe("one-at-a-time");
  const source = createStaticTasksSettings({ steeringMode: "all" });
  expect(source.steeringMode()).toBe("all");
  expect(source.followUpMode()).toBe("one-at-a-time");
});

test("the layered source resolves effective values and follows later changes", () => {
  const user = new Map<string, unknown>([["l1.tasks.queue.steeringMode", "all"]]);
  const session = new Map<string, unknown>();
  const stack = (): ScopeStack => [
    { scope: "user", values: user },
    { scope: "session", values: session },
  ];
  const source = createLayeredTasksSettings(stack);
  expect(source.steeringMode()).toBe("all");
  expect(source.followUpMode()).toBe("one-at-a-time");
  // 높은 우선순위(session)가 이긴다. 다음 읽기부터 적용된다
  session.set("l1.tasks.queue.steeringMode", "one-at-a-time");
  expect(source.steeringMode()).toBe("one-at-a-time");
  // 유효하지 않은 값은 건너뛰고 아래 범위나 기본값을 쓴다
  session.set("l1.tasks.queue.steeringMode", "everything");
  expect(source.steeringMode()).toBe("all");
  user.set("l1.tasks.queue.followUpMode", 3);
  expect(source.followUpMode()).toBe("one-at-a-time");
});

test("pool limits: static defaults, overrides, and the layered source with invalid values falling back", () => {
  expect(createStaticTasksSettings().limit("tools")).toBe(8);
  expect(createStaticTasksSettings().limit("subagents")).toBe(16);
  expect(createStaticTasksSettings({ limits: { subagents: 3 } }).limit("subagents")).toBe(3);
  expect(createStaticTasksSettings({ limits: { subagents: 3 } }).limit("modelCalls")).toBe(16);
  const user = new Map<string, unknown>([["l1.tasks.limits.tools", 4]]);
  const session = new Map<string, unknown>();
  const source = createLayeredTasksSettings((): ScopeStack => [
    { scope: "user", values: user },
    { scope: "session", values: session },
  ]);
  expect(source.limit("tools")).toBe(4);
  session.set("l1.tasks.limits.tools", 2);
  expect(source.limit("tools")).toBe(2);
  // 범위 밖이거나 정수가 아닌 값은 건너뛰고 아래 범위나 기본값을 쓴다
  session.set("l1.tasks.limits.tools", 0);
  expect(source.limit("tools")).toBe(4);
  user.set("l1.tasks.limits.tools", 2.5);
  expect(source.limit("tools")).toBe(8);
  expect(source.limit("modelCalls")).toBe(16);
});

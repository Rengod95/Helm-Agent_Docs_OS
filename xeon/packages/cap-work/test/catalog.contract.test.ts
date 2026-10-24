import { describe, expect, test } from "bun:test";
import { TYPE_PREFIX_OWNERS, WORK_EVENT_CATALOG, parseEventKind } from "@xeon/contracts/records";
import { WORK_PROJECTOR_NAME } from "../src/projection/ddl.ts";
import { WORK_PRODUCER } from "../src/plugin.ts";
import { createWorkProjector } from "../src/projection/projector.ts";

// L2.work.spec §3.7 표의 kind 집합
const SPEC_KINDS = [
  "work.task_created",
  "work.task_changed",
  "work.task_linked",
  "work.task_unlinked",
  "work.plan_submitted",
  "work.plan_withdrawn",
  "work.goal_set",
  "work.goal_judged",
  "work.goal_settled",
  "work.report_built",
];

describe("work event catalog", () => {
  test("the catalog has the ten kinds of the spec table, all durable and version 1", () => {
    const kinds: string[] = WORK_EVENT_CATALOG.map((entry) => entry.kind);
    expect(kinds.toSorted()).toEqual(SPEC_KINDS.toSorted());
    for (const entry of WORK_EVENT_CATALOG) {
      expect(entry.durable).toBe(true);
      expect(entry.version).toBe(1);
    }
  });

  test("every kind parses and the work. prefix belongs to cap.work", () => {
    for (const kind of SPEC_KINDS) expect(parseEventKind(kind).ok).toBe(true);
    expect(TYPE_PREFIX_OWNERS["work."]).toBe(WORK_PRODUCER);
    expect(WORK_PRODUCER).toBe("cap.work");
  });

  test("the projector is named after its producer and reads only kinds it knows", () => {
    const projector = createWorkProjector();
    expect(projector.name).toBe(WORK_PROJECTOR_NAME);
    expect(projector.name).toBe(WORK_PRODUCER);
    const kinds = projector.kinds === "all" ? [] : projector.kinds;
    // 다른 컨텍스트의 이벤트 중 투영기가 읽는 것(spec §3.8 관심 type)
    const known = new Set<string>([
      ...SPEC_KINDS,
      "approval.requested",
      "approval.resolved",
      "settings.changed",
      "turn.completed",
    ]);
    for (const kind of kinds) expect(known.has(kind)).toBe(true);
  });

  test("projector tables are cap_work_ tables and each has DDL", () => {
    const projector = createWorkProjector();
    for (const table of projector.tables) {
      expect(table.startsWith("cap_work_")).toBe(true);
      expect(projector.ddl.some((statement) => statement.includes(`CREATE TABLE ${table} `))).toBe(
        true,
      );
    }
  });
});

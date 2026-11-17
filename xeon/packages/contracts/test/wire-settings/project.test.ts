import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import {
  PROJECT_ID_PATTERN,
  PROJECT_LIMITS,
  PROJECT_WIRE_METHODS,
  ProjectChangedParamsSchema,
  ProjectListItemSchema,
  ProjectListResultSchema,
  ProjectSchema,
} from "../../src/wire-settings/wire/project.ts";

function roundTrip(schema: TSchema, value: unknown): void {
  const result = parse(schema, value);
  expect(result.ok ? result.value : result.error).toEqual(value);
}

const project = {
  projectId: "prj_demo-1",
  name: "Demo",
  root: "/Users/me/demo",
  createdAt: "2026-11-17T00:00:00.000Z",
  rev: 1,
};
const item = { ...project, threadCount: 3, runningCount: 1 };

describe("Project (M5c-1 §3.1, §3.4)", () => {
  test("Project round trips and the id uses the prj_ prefix", () => {
    roundTrip(ProjectSchema, project);
    expect(new RegExp(PROJECT_ID_PATTERN).test("prj_default")).toBe(true);
    expect(parse(ProjectSchema, { ...project, projectId: "proj-1" }).ok).toBe(false);
    expect(parse(ProjectSchema, { ...project, root: "" }).ok).toBe(false);
    expect(parse(ProjectSchema, { ...project, extra: true }).ok).toBe(false);
  });

  test("project.list items carry threadCount and runningCount (M5c §3.6)", () => {
    roundTrip(ProjectListItemSchema, item);
    expect(parse(ProjectListItemSchema, project).ok).toBe(false);
    roundTrip(ProjectListResultSchema, { projects: [item] });
    expect(PROJECT_LIMITS.projects).toBe(200);
    const many = Array.from({ length: 201 }, (_, index) => ({
      ...item,
      projectId: `prj_p${index}`,
    }));
    expect(parse(ProjectListResultSchema, { projects: many }).ok).toBe(false);
  });

  test("project.create needs a root and takes an optional name", () => {
    const params = PROJECT_WIRE_METHODS["project.create"].params;
    expect(parse(params, { root: "/Users/me/demo" }).ok).toBe(true);
    expect(parse(params, { root: "/Users/me/demo", name: "Demo" }).ok).toBe(true);
    expect(parse(params, { name: "Demo" }).ok).toBe(false);
    expect(parse(params, { root: "/Users/me/demo", name: "" }).ok).toBe(false);
    roundTrip(PROJECT_WIRE_METHODS["project.create"].result, { project });
  });

  test("project.get answers with the pending review count", () => {
    expect(parse(PROJECT_WIRE_METHODS["project.get"].params, { projectId: "prj_demo-1" }).ok).toBe(
      true,
    );
    roundTrip(PROJECT_WIRE_METHODS["project.get"].result, { project, pendingReview: 2 });
    expect(parse(PROJECT_WIRE_METHODS["project.get"].result, { project }).ok).toBe(false);
  });

  test("project.rename and project.delete take a project id; delete answers with an empty object", () => {
    expect(
      parse(PROJECT_WIRE_METHODS["project.rename"].params, {
        projectId: "prj_demo-1",
        name: "Renamed",
      }).ok,
    ).toBe(true);
    expect(
      parse(PROJECT_WIRE_METHODS["project.rename"].params, { projectId: "prj_demo-1" }).ok,
    ).toBe(false);
    expect(
      parse(PROJECT_WIRE_METHODS["project.delete"].params, { projectId: "prj_demo-1" }).ok,
    ).toBe(true);
    roundTrip(PROJECT_WIRE_METHODS["project.delete"].result, {});
    expect(parse(PROJECT_WIRE_METHODS["project.delete"].result, { removed: true }).ok).toBe(false);
  });

  test("project.instructions lists the files with their inclusion flag", () => {
    expect(
      parse(PROJECT_WIRE_METHODS["project.instructions"].params, {
        workspace: "/Users/me/demo/app",
      }).ok,
    ).toBe(true);
    roundTrip(PROJECT_WIRE_METHODS["project.instructions"].result, {
      files: [
        { path: "AGENTS.md", bytes: 1200, included: true },
        { path: "app/AGENTS.md", bytes: 70000, included: false },
      ],
    });
    expect(
      parse(PROJECT_WIRE_METHODS["project.instructions"].result, {
        files: [{ path: "AGENTS.md", bytes: 1 }],
      }).ok,
    ).toBe(false);
  });

  test("project.changed carries the revision and the changed ids", () => {
    roundTrip(ProjectChangedParamsSchema, { rev: 4, ids: ["prj_demo-1"] });
    expect(parse(ProjectChangedParamsSchema, { rev: 4 }).ok).toBe(false);
  });

  test("project methods are M4 specs", () => {
    expect(Object.keys(PROJECT_WIRE_METHODS).toSorted()).toEqual([
      "project.create",
      "project.delete",
      "project.get",
      "project.instructions",
      "project.list",
      "project.rename",
    ]);
    for (const spec of Object.values(PROJECT_WIRE_METHODS)) expect(spec.stage).toBe("M4");
  });
});

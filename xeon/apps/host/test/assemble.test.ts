import { existsSync } from "node:fs";
import { afterAll, expect, test } from "bun:test";
import { Type } from "typebox";
import { defineSettings } from "@xeon/contracts/settings";
import { AssembleError, assemble, buildEngineCatalog, coreSettingGroups } from "../src/assemble.ts";
import { useEngineHome } from "./fixtures/engine-home.ts";

const home = useEngineHome();
afterAll(() => {
  home.dispose();
});

test("assemble-catalog-refused: a group that declares a core key again stops the start with code catalog", async () => {
  const duplicate = defineSettings("l4.host-service", {
    maxReplayEvents: {
      type: Type.Integer(),
      default: 5000,
      runtimeChange: "live",
      allowedScopes: ["user"],
      since: "0.1.0",
    },
  });
  const caught = await assemble({ mode: "in-process", settingGroups: [duplicate] }).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(AssembleError);
  if (caught instanceof AssembleError) {
    expect(caught.issues).toHaveLength(1);
    const issue = caught.issues[0];
    expect(issue?.code).toBe("catalog");
    if (issue?.code === "catalog") {
      expect(issue.issues).toEqual([
        {
          code: "duplicateKey",
          key: "l4.host-service.maxReplayEvents",
          owners: ["host", "app"],
        },
      ]);
    }
    expect(caught.message).toContain("duplicateKey");
  }
  // 열린 자원이 없다: 데이터 디렉터리도 DB 파일도 만들지 않았다
  expect(existsSync(home.dataDir)).toBe(false);
});

test("an app group such as l4.cli.* joins the catalog next to the core groups", () => {
  const stray = defineSettings("l4.cli", {
    color: {
      type: Type.Boolean(),
      default: true,
      runtimeChange: "live",
      allowedScopes: ["user"],
      since: "0.1.0",
    },
  });
  const built = buildEngineCatalog([stray]);
  expect(built.ok).toBe(true);
  if (built.ok) expect(built.catalog.has("l4.cli.color")).toBe(true);
});

test("the core groups build one catalog with the keys of every package that declares settings", () => {
  const built = buildEngineCatalog();
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  const owners = new Set(coreSettingGroups().map((group) => group.owner));
  expect([...owners].toSorted()).toEqual([
    "cap-workspace",
    "core-loop",
    "core-models",
    "core-tasks",
    "ext-host",
    "host",
    "platform-process",
    "platform-sandbox",
  ]);
  for (const key of [
    "x.primitives.driveLimits",
    "x.operations.budget.firstMs",
    "x.loading-trust.defaultProjectTrust",
    "l0.process.shutdown.timeoutMs",
    "l0.sandbox.enabled",
    "l1.models.default",
    "l1.loop.maxSteps",
    "l1.tasks.queue.steeringMode",
    "l2.workspace.read.maxLines",
    "l4.host-service.maxReplayEvents",
  ]) {
    expect(built.catalog.has(key)).toBe(true);
  }
});

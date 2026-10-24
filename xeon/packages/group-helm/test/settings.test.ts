import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { buildCatalog } from "@xeon/contracts/settings";
import { DEFAULT_HELM_DRIVE_LIMITS, helmSettings } from "../src/index.ts";

test("l3.helm.driveLimits is a catalog-valid setting with the 4/8/400000 default and the plugins tab", () => {
  const defs = Object.values(helmSettings.defs);
  const built = buildCatalog([{ owner: "group-helm", namespace: "l3.helm", defs }]);
  expect(built.ok).toBe(true);
  const def = helmSettings.defs.driveLimits;
  expect(def.key).toBe("l3.helm.driveLimits");
  expect(def.layer).toBe("L3");
  expect(def.default).toEqual({ maxTurns: 4, maxSpawns: 8, maxTokens: 400000 });
  expect(def.default).toEqual(DEFAULT_HELM_DRIVE_LIMITS);
  expect(def.runtimeChange).toBe("nextTurn");
  expect(def.allowedScopes).toEqual(["managed", "user", "project", "local", "session"]);
  expect(def.ui?.tab).toBe("plugins");
  expect(def.ui?.widget).toBe("table");
});

test("the schema accepts partial limits and rejects zero turns and unknown fields", () => {
  const schema = helmSettings.defs.driveLimits.type;
  expect(parse(schema, { maxTurns: 2 }).ok).toBe(true);
  expect(parse(schema, {}).ok).toBe(true);
  expect(parse(schema, { maxTurns: 0 }).ok).toBe(false);
  expect(parse(schema, { maxTurns: 2, extra: 1 }).ok).toBe(false);
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEngineCatalog } from "../src/assembly/catalog.ts";
import { hostSettings, renderSettingsSchema, type SettingsFileScope } from "../src/settings.ts";

const SCOPES: readonly SettingsFileScope[] = ["managed", "user", "project", "local"];
const SCHEMA_DIR = join(import.meta.dir, "..", "schema");

function keysOf(document: unknown): string[] {
  if (typeof document !== "object" || document === null || !("properties" in document)) return [];
  const properties = document.properties;
  return typeof properties === "object" && properties !== null ? Object.keys(properties) : [];
}

function coreCatalog() {
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error(`the core catalog must build: ${JSON.stringify(built.issues)}`);
  return built.catalog;
}

test("settings-schema-deterministic: rendering twice gives the same bytes, with a trailing newline", () => {
  const catalog = coreCatalog();
  for (const scope of SCOPES) {
    const first = renderSettingsSchema(catalog, scope);
    const second = renderSettingsSchema(catalog, scope);
    expect(first).toBe(second);
    expect(first.endsWith("}\n")).toBe(true);
    expect(first.startsWith('{\n  "$schema"')).toBe(true);
  }
});

test("settings-schema-deterministic: the catalog insertion order does not change the bytes", () => {
  const catalog = coreCatalog();
  const reversed = new Map([...catalog].toReversed());
  for (const scope of SCOPES) {
    expect(renderSettingsSchema(reversed, scope)).toBe(renderSettingsSchema(catalog, scope));
  }
});

test("settings-schema-committed: schema/ holds exactly the --core-only output for each file scope", () => {
  const catalog = coreCatalog();
  for (const scope of SCOPES) {
    const committed = readFileSync(join(SCHEMA_DIR, `settings.${scope}.schema.json`), "utf8");
    expect(committed).toBe(renderSettingsSchema(catalog, scope));
  }
});

test("each scope's schema lists only the keys that scope allows, and the host keys follow the spec", () => {
  const catalog = coreCatalog();
  const project: unknown = JSON.parse(renderSettingsSchema(catalog, "project"));
  const managed: unknown = JSON.parse(renderSettingsSchema(catalog, "managed"));
  // 프로젝트 범위를 허용하지 않는 호스트 키는 프로젝트 스키마에 없다(F wire §4.7 규칙 4)
  expect(keysOf(project)).not.toContain("l4.host-service.maxReplayEvents");
  expect(keysOf(managed)).toContain("l4.host-service.maxReplayEvents");
  expect(keysOf(managed)).toContain("l4.host-service.maxSubscriptionsPerConnection");
  // 무인 승인 정책 키(M3-REQ-73)는 파일 범위 네 곳에 모두 있다
  for (const scope of ["managed", "user", "project", "local"] as const) {
    const keys = keysOf(JSON.parse(renderSettingsSchema(catalog, scope)));
    expect(keys).toContain("l1.tools.unattended.approval");
    expect(keys).toContain("l1.tools.unattended.timeoutSeconds");
    // 반복 감지 키(M3-REQ-87)도 네 범위 모두에 있다
    expect(keys).toContain("l1.loop.repeat.enabled");
    expect(keys).toContain("l1.loop.repeat.actionObservation");
    expect(keys).toContain("l1.loop.repeat.actionError");
  }
});

test("hostSettings declares the two l4.host-service keys with the documented defaults and ranges", () => {
  const { maxReplayEvents, maxSubscriptionsPerConnection } = hostSettings.defs;
  expect(maxReplayEvents.key).toBe("l4.host-service.maxReplayEvents");
  expect(maxReplayEvents.default).toBe(100_000);
  expect(maxReplayEvents.range).toEqual({ min: 1000, max: 1_000_000 });
  expect(maxReplayEvents.runtimeChange).toBe("live");
  expect(maxReplayEvents.allowedScopes).toEqual(["managed", "user"]);
  expect(maxReplayEvents.layer).toBe("L4");
  expect(maxSubscriptionsPerConnection.key).toBe("l4.host-service.maxSubscriptionsPerConnection");
  expect(maxSubscriptionsPerConnection.default).toBe(16);
  expect(maxSubscriptionsPerConnection.range).toEqual({ min: 1, max: 256 });
  expect(maxSubscriptionsPerConnection.ui?.tab).toBe("execution");
});

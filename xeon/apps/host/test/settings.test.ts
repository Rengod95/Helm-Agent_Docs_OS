import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEngineCatalog } from "../src/assembly/catalog.ts";
import { hostSettings, renderSettingsSchema, type SettingsFileScope } from "../src/settings.ts";

const SCOPES: readonly SettingsFileScope[] = ["managed", "user", "project", "local"];
const SCHEMA_DIR = join(import.meta.dir, "..", "schema");
const LOCALES_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "packages",
  "client",
  "src",
  "i18n",
  "locales",
);

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

/** 클라이언트 카탈로그 원문. 호스트 테스트는 `@xeon/client`를 import하지 않으므로(DR-10) JSON 파일을 직접 읽는다 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function catalogOf(locale: "en" | "ko"): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), "utf8"));
  return isRecord(parsed) ? parsed : {};
}

test("hostSettings labels and help are catalog keys, with English text as the fallback", () => {
  const { maxReplayEvents, maxSubscriptionsPerConnection } = hostSettings.defs;
  expect(maxReplayEvents.ui?.labelKey).toBe("settings.l4.hostService.maxReplayEvents.label");
  expect(maxReplayEvents.ui?.helpKey).toBe("settings.l4.hostService.maxReplayEvents.help");
  expect(maxSubscriptionsPerConnection.ui?.labelKey).toBe(
    "settings.l4.hostService.maxSubscriptionsPerConnection.label",
  );
  // 키가 없을 때 클라이언트가 보이는 대체 문구는 영어다(한글을 싣지 않는다)
  expect(maxReplayEvents.ui?.label).toBe("Maximum events replayed per subscription");
  expect(maxReplayEvents.ui?.help).toBe(
    "Events one subscription can replay. Beyond this, subscribe again from a newer position",
  );
  expect(maxSubscriptionsPerConnection.ui?.label).toBe("Subscriptions per connection");
  for (const text of [maxReplayEvents.ui?.label, maxReplayEvents.ui?.help]) {
    expect(text).not.toMatch(/[ㄱ-ㆎ가-힣]/);
  }
});

test("the host label and help keys exist in both catalogs, and the English fallback equals the en text", () => {
  const en = catalogOf("en");
  const ko = catalogOf("ko");
  const { maxReplayEvents, maxSubscriptionsPerConnection } = hostSettings.defs;
  const replay = maxReplayEvents.ui;
  const perConnection = maxSubscriptionsPerConnection.ui;
  expect(en[replay?.labelKey ?? ""]).toBe(replay?.label);
  expect(en[replay?.helpKey ?? ""]).toBe(replay?.help);
  expect(en[perConnection?.labelKey ?? ""]).toBe(perConnection?.label);
  expect(ko["settings.l4.hostService.maxReplayEvents.label"]).toBe("구독 재전송 최대 이벤트 수");
  expect(ko["settings.l4.hostService.maxReplayEvents.help"]).toBe(
    "구독 한 번에 다시 보낼 수 있는 이벤트 수. 넘으면 새 위치에서 다시 구독해야 한다",
  );
  expect(ko["settings.l4.hostService.maxSubscriptionsPerConnection.label"]).toBe(
    "연결당 구독 한도",
  );
});

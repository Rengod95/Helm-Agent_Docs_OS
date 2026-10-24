// 공개 이름 대조(X.primitives.plan §6 6번): src/index.ts의 export가 X.primitives.spec §3.1 표와 같은지 본다.
// 아직 만들지 않은 M2 이름은 표에 있어도 요구하지 않고, 표에 없는 이름은 아래 ADDITIONS에 이유와 함께 적은 것만 허용한다.
import { join } from "node:path";
import { expect, test } from "bun:test";
import * as entry from "../../src/index.ts";
import { readDoc } from "../support/docs.ts";

/** 문서 표에 없지만 조립 루트가 필요해 더한 이름 [제안]. 문서 반영을 요청한다 */
const ADDITIONS: ReadonlySet<string> = new Set([
  "scopeToggleSourceOf",
  "ScopeToggleSourceOf",
  "createScopeControl",
  "ScopeToggleSource",
  "AdmitInfo",
  "LoaderSettingsSource",
  "ExtDiagnostic", // §3.2에 정의되어 있으나 §3.1 표에는 빠져 있다
]);

/** 이번 마일스톤(M0·M1)에 있어야 하는 값 이름 */
const REQUIRED_VALUES: readonly string[] = [
  "createExtHost",
  "DEFAULT_DISPATCH_POLICY",
  "LoopPortKey",
  "InputQueuePortKey",
  "RecordCommitPortKey",
  "ProjectorRegistryPortKey",
  "ScopedStorePortKey",
  "ProcessPortKey",
  "LeaseArbiterPortKey",
  "ExtHostPortKey",
  "capabilityServiceName",
  "providerServiceName",
  "isReservedServiceName",
  "hostOf",
  "PrimitiveError",
  "primitivesSettings",
  "TRUST_LEVELS",
  "SOURCE_TRUST",
  "TRUST_MATRIX",
  "LoadDiagnosticSchema",
  "createExtensionLoader",
  "LoadAbortError",
  "RESERVED_EXT_KEYS",
  "loadingTrustSettings",
  "TIERS",
  "storageOf",
  "extTablePrefix",
  "parseExtTableName",
  "createOperationsPolicy",
  "operationsSettings",
];

function namesInTable(markdown: string): ReadonlySet<string> {
  const start = markdown.indexOf("### 3.1 공개 API 목록");
  const end = markdown.indexOf("### 3.2 호스트 생성과 수명");
  const table = markdown.slice(start, end);
  const names = new Set<string>();
  for (const line of table.split("\n")) {
    if (!line.startsWith("|")) continue;
    const firstCell = line.split("|")[1] ?? "";
    for (const match of firstCell.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }
  return names;
}

async function exportedNames(): Promise<ReadonlySet<string>> {
  const source = await Bun.file(join(import.meta.dir, "../../src/index.ts")).text();
  const names = new Set<string>();
  for (const block of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    const body = (block[1] ?? "").replaceAll(/\/\/.*$/gm, "");
    for (const part of body.split(",")) {
      const name = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop();
      if (name !== undefined && name.length > 0) names.add(name);
    }
  }
  return names;
}

test("public surface: exports are the spec §3.1 names plus the documented additions", async () => {
  const documented = namesInTable(await readDoc("X/primitives/spec.md"));
  const exported = await exportedNames();
  const unexpected = [...exported].filter((name) => !documented.has(name) && !ADDITIONS.has(name));
  expect(unexpected).toEqual([]);
  // 값으로 내보낸 이름은 런타임 모듈에도 있어야 한다
  const values = new Set(Object.keys(entry));
  for (const name of REQUIRED_VALUES) {
    expect(values.has(name)).toBe(true);
    expect(exported.has(name)).toBe(true);
  }
  for (const value of values) expect(exported.has(value)).toBe(true);
});

test("public surface: internal names do not leave the package", async () => {
  const exported = await exportedNames();
  for (const internal of [
    "ScopeRuntime",
    "PostQueue",
    "LeaseBroker",
    "HandlerRegistry",
    "CordisBridge",
    "hostInternalsOf",
    "createStateService",
    "Context",
  ]) {
    expect(exported.has(internal)).toBe(false);
  }
});

test("vendored Cordis is imported only by the bridge", async () => {
  const importers: string[] = [];
  for await (const file of new Bun.Glob("src/**/*.ts").scan({
    cwd: join(import.meta.dir, "../.."),
  })) {
    const text = await Bun.file(join(import.meta.dir, "../..", file)).text();
    if (text.includes("@xeon/vendor-cordis")) importers.push(file);
  }
  expect(importers).toEqual(["src/primitives/cordis-bridge.ts"]);
});

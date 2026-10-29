import { afterEach, expect, test } from "bun:test";
import { parse, parseJson } from "@xeon/contracts";
import {
  EffectiveSettingSchema,
  SettingDefWireSchema,
  type EffectiveSetting,
  type SettingDefWire,
} from "@xeon/contracts/settings";
import { buildSettingsView, settingsViewKeys } from "@xeon/client/settings";
import { runHostCommand } from "@xeon/host";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT } from "../src/exit-codes.ts";
import { createRealCli, type RealCli } from "./support/real-host.ts";

// X10 (review.m3b-plan §1.1): 설정 화면 항목·설정 파일 키·설정 명령이 같은 F5 스키마에서 나온다. 화면은 M4라 view-model로 확인한다.
// 실제 호스트의 카탈로그 하나에서 세 집합을 만들어 견준다: (1) 설정 파일 스키마의 키(`xeon config schema`가 쓰는 경로),
// (2) `xeon config list --deprecated`가 보이는 키, (3) 설정 화면 view-model의 항목(탭 항목 + 파일 전용 항목). 셋은 같아야 한다.
// 읽는 코드가 없는 `reserved` 키는 목록과 화면에서 빠지므로 세 집합 모두에 없다.

const clis: RealCli[] = [];
afterEach(() => {
  for (const cli of clis.splice(0)) cli.dispose();
});

type ListRow = { readonly def: SettingDefWire; readonly setting: EffectiveSetting | null };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `xeon config schema --scope <범위> --out <파일>`이 쓴 설정 파일 스키마의 키 */
async function schemaKeys(
  cli: RealCli,
  scope: "managed" | "user" | "project" | "local",
): Promise<string[]> {
  const out = join(cli.home.root, `schema-${scope}.json`);
  expect(await cli.harness.run(["config", "schema", "--scope", scope, "--out", out])).toBe(EXIT.ok);
  const parsed = parseJson(readFileSync(out, "utf8"));
  if (!parsed.ok || !isRecord(parsed.value) || !isRecord(parsed.value["properties"])) {
    throw new Error("the schema is not a JSON schema object");
  }
  return Object.keys(parsed.value["properties"]);
}

test("X10: the settings file schema keys, the config list keys and the settings view items are one set", async () => {
  const cli = createRealCli({ harness: { runHostCommand } });
  clis.push(cli);
  expect(await cli.harness.run(["config", "list", "--deprecated", "--json"])).toBe(EXIT.ok);
  const rows: unknown = JSON.parse(cli.harness.stdoutText());
  if (!Array.isArray(rows)) throw new Error("config list --json is not an array");
  const listed: ListRow[] = rows.map((row: unknown) => {
    if (!isRecord(row)) throw new Error("bad row");
    const def = parse(SettingDefWireSchema, row["def"]);
    const setting = parse(EffectiveSettingSchema, row["setting"]);
    if (!def.ok) throw new Error("config list gave a definition outside the wire schema");
    return { def: def.value, setting: setting.ok ? setting.value : null };
  });
  expect(listed.length).toBeGreaterThan(100);
  const listKeys = listed.map((row) => row.def.key).toSorted();

  // (1) 설정 파일 스키마: 네 범위의 합집합. session 범위만 허용하는 키는 파일에 둘 수 없으므로 뺀다
  const fileKeys = new Set<string>();
  for (const scope of ["managed", "user", "project", "local"] as const) {
    // oxlint-disable-next-line no-await-in-loop -- 하네스는 한 번에 한 명령만 돌린다(출력 버퍼를 나눠 쓴다) (review.m3b-plan X10)
    for (const key of await schemaKeys(cli, scope)) fileKeys.add(key);
  }
  const sessionOnly = listed
    .filter((row) => row.def.allowedScopes.every((scope) => scope === "session"))
    .map((row) => row.def.key);
  // 읽는 코드가 없는 reserved 키는 파일 스키마에는 있지만 목록과 화면에서는 빠진다
  const extras = [...fileKeys].filter((key) => !listKeys.includes(key)).toSorted();
  expect(extras).toEqual([
    "l3.learning.curator.enabled",
    "l3.learning.curator.intervalHours",
    "l3.learning.curator.llmConsolidate",
    "l3.learning.curator.minIdleHours",
  ]);
  for (const key of extras) {
    // 이 키들은 `stage: "reserved"`라 쓰기를 받지 않는다
    // oxlint-disable-next-line no-await-in-loop -- 하네스는 한 번에 한 명령만 돌린다 (review.m3b-plan X10)
    expect(await cli.harness.run(["config", "set", key, "1"])).not.toBe(EXIT.ok);
  }
  const reserved = new Set(extras);
  const schemaSet = [...fileKeys].filter((key) => !reserved.has(key));
  expect([...schemaSet, ...sessionOnly].toSorted()).toEqual(listKeys);

  // (3) 화면 view-model
  const values = new Map<string, EffectiveSetting>();
  for (const row of listed) {
    if (row.setting !== null) values.set(row.setting.key, row.setting);
  }
  const view = buildSettingsView({ defs: listed.map((row) => row.def), values, hasThread: false });
  expect(settingsViewKeys(view)).toEqual(listKeys);
  // 실제 카탈로그의 모든 위젯이 정의 모양과 맞는다(tokenBudget·모델 위젯 포함)
  expect(view.diagnostics).toEqual([]);
}, 60_000);

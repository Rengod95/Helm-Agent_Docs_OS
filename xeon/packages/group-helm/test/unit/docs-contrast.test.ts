import { expect, test } from "bun:test";
import { TRANSITIONS } from "../../src/phase.ts";
import { HELM_RECORD_KINDS } from "../../src/records.ts";
import { helmSettings } from "../../src/settings.ts";
import { readDoc, tableRowsAfter } from "../support/docs.ts";

// H-17: 스펙 §4.2 전이표, §3.4 kind 목록, §6 설정 표와 코드 상수의 대조

const SPEC = await readDoc("L3/helm/spec.md");

function backticks(cell: string): readonly string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
}

test("spec 4.2 table: every phase row and its next phase and event match TRANSITIONS", () => {
  const rows = tableRowsAfter(SPEC, "### 4.2 단계와 전이표");
  expect(rows.map((row) => backticks(row[0] ?? "")[0])).toEqual([
    "idle",
    "diverge",
    "explore",
    "converge",
    "apply",
  ]);
  const progress = TRANSITIONS.filter(
    (entry) => !["stopRequested", "limitReached", "failed"].includes(entry.on),
  );
  for (const row of rows) {
    const from = backticks(row[0] ?? "")[0];
    const to = backticks(row[3] ?? "")[0];
    const found = progress.some((entry) => entry.from === from && entry.to === to);
    expect({ from, to, found }).toEqual({ from, to, found: true });
  }
  expect(
    TRANSITIONS.filter((entry) => entry.on === "stopRequested")
      .map((entry) => entry.from)
      .toSorted(),
  ).toEqual(["apply", "converge", "diverge", "explore", "idle"]);
});

test("spec 3.4 record kinds match HELM_RECORD_KINDS", () => {
  const rows = tableRowsAfter(SPEC, "### 3.4 레코드");
  expect(rows.map((row) => backticks(row[0] ?? "")[0])).toEqual(
    HELM_RECORD_KINDS.map((decl) => decl.kind),
  );
});

test("spec 6 settings table matches the setting definitions", () => {
  const rows = tableRowsAfter(SPEC, "## 6. 설정 노출");
  const byKey = new Map(rows.map((row) => [backticks(row[0] ?? "")[0], row]));
  expect([...byKey.keys()].toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual(
    Object.values(helmSettings.defs)
      .map((def) => def.key)
      .toSorted((a, b) => a.localeCompare(b)),
  );
  for (const def of Object.values(helmSettings.defs)) {
    const row = byKey.get(def.key);
    expect(row?.[4]).toContain(def.runtimeChange);
    expect(row?.[6]).toBe(def.ui?.widget ?? "");
  }
  expect(byKey.get("ext.helm.autoStart")?.[2]).toContain("suggest");
  expect(byKey.get("ext.helm.maxLenses")?.[2]).toContain("3");
  expect(byKey.get("ext.helm.writeGuard")?.[2]).toContain("true");
  expect(byKey.get("ext.helm.driveLimits")?.[2]).toContain(
    "maxTurns: 4, maxSpawns: 8, maxTokens: 400000",
  );
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkOrchestrationName,
  ORCHESTRATION_NAME_PATTERN,
  RESERVED_ORCHESTRATION_NAMES,
} from "../src/group/rules.ts";

// L3.slots.spec §3.3.4: apps/cli는 orchestration-sdk을 import하지 않는다(DR-14). 그래서 이름 상수를 복사해 두었다.
// 이 시험은 orchestration-sdk 소스 텍스트와 비교해, 두 목록이 갈라지면 실패한다(L3.slots.spec §3.3.4 정본은 orchestration-sdk이다).

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACTS = join(HERE, "..", "..", "..", "packages", "contracts");

/** 이름 규칙의 정본 파일은 contracts(F)다. orchestration-sdk는 그 값을 다시 내보낸다(AGE-60) */
function orchestrationSdkSource(): string {
  return readFileSync(join(CONTRACTS, "src", "services", "group-names.ts"), "utf8");
}

/** orchestration-sdk의 `RESERVED_ORCHESTRATION_NAMES` 배열 리터럴에서 따옴표 안 값을 순서대로 뽑는다 */
function reservedNamesInOrchestrationSdk(source: string): readonly string[] {
  const block = /RESERVED_ORCHESTRATION_NAMES: readonly string\[\] = \[([\s\S]*?)\];/.exec(
    source,
  )?.[1];
  if (block === undefined) return [];
  return [...block.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? "");
}

test("the reserved group names match orchestration-sdk's RESERVED_ORCHESTRATION_NAMES in value and order", () => {
  const fromKit = reservedNamesInOrchestrationSdk(orchestrationSdkSource());
  expect(fromKit).toHaveLength(23);
  expect([...RESERVED_ORCHESTRATION_NAMES]).toEqual([...fromKit]);
});

test("the name pattern matches orchestration-sdk's ORCHESTRATION_NAME_PATTERN", () => {
  const match = /ORCHESTRATION_NAME_PATTERN: string = "([^"]*)"/.exec(orchestrationSdkSource());
  expect(match?.[1]).toBe("^[a-z][a-z0-9-]{1,31}$");
  expect(ORCHESTRATION_NAME_PATTERN).toBe(match?.[1] ?? "");
});

test("checkOrchestrationName accepts hyphenated names and names only the rules refuse", () => {
  expect(checkOrchestrationName("focus-lens")).toEqual({ ok: true, value: "focus-lens" });
  expect(checkOrchestrationName(`a${"b".repeat(31)}`)).toEqual({
    ok: true,
    value: `a${"b".repeat(31)}`,
  });
  expect(checkOrchestrationName("Focus")).toEqual({
    ok: false,
    error: { kind: "orchestration_name", reason: "pattern" },
  });
  expect(checkOrchestrationName("focus_lens")).toEqual({
    ok: false,
    error: { kind: "orchestration_name", reason: "pattern" },
  });
  expect(checkOrchestrationName("a")).toEqual({
    ok: false,
    error: { kind: "orchestration_name", reason: "pattern" },
  });
  expect(checkOrchestrationName(`a${"b".repeat(32)}`)).toEqual({
    ok: false,
    error: { kind: "orchestration_name", reason: "pattern" },
  });
  expect(checkOrchestrationName("core")).toEqual({
    ok: false,
    error: { kind: "orchestration_name", reason: "reserved" },
  });
  expect(checkOrchestrationName("helm")).toEqual({ ok: true, value: "helm" });
});

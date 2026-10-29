import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkGroupName,
  fillPlaceholders,
  GROUP_NAME_PATTERN,
  isSafeRelativePath,
  parseTemplateIndex,
  RESERVED_GROUP_NAMES,
  targetPathOf,
} from "../src/group/rules.ts";

// L4.cli.spec §3.8: apps/cli는 group-kit을 import하지 않는다(DR-14). 그래서 이름 상수와 색인 형식을 복사해 두었다.
// 이 시험은 group-kit 소스 텍스트와 비교해, 두 목록이 갈라지면 실패한다(L3.slots.spec §3.3.4 정본은 group-kit이다).

const HERE = dirname(fileURLToPath(import.meta.url));
const GROUP_KIT = join(HERE, "..", "..", "..", "packages", "group-kit");

function groupKitSource(): string {
  return readFileSync(join(GROUP_KIT, "src", "define-group.ts"), "utf8");
}

/** group-kit의 `RESERVED_GROUP_NAMES` 배열 리터럴에서 따옴표 안 값을 순서대로 뽑는다 */
function reservedNamesInGroupKit(source: string): readonly string[] {
  const block = /RESERVED_GROUP_NAMES: readonly string\[\] = \[([\s\S]*?)\];/.exec(source)?.[1];
  if (block === undefined) return [];
  return [...block.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? "");
}

test("the reserved group names match group-kit's RESERVED_GROUP_NAMES in value and order", () => {
  const fromKit = reservedNamesInGroupKit(groupKitSource());
  expect(fromKit).toHaveLength(23);
  expect([...RESERVED_GROUP_NAMES]).toEqual([...fromKit]);
});

test("the name pattern matches group-kit's GROUP_NAME_PATTERN", () => {
  const match = /GROUP_NAME_PATTERN: string = "([^"]*)"/.exec(groupKitSource());
  expect(match?.[1]).toBe("^[a-z][a-z0-9-]{1,31}$");
  expect(GROUP_NAME_PATTERN).toBe(match?.[1] ?? "");
});

test("checkGroupName accepts hyphenated names and names only the rules refuse", () => {
  expect(checkGroupName("focus-lens")).toEqual({ ok: true, value: "focus-lens" });
  expect(checkGroupName(`a${"b".repeat(31)}`)).toEqual({ ok: true, value: `a${"b".repeat(31)}` });
  expect(checkGroupName("Focus")).toEqual({
    ok: false,
    error: { kind: "group_name", reason: "pattern" },
  });
  expect(checkGroupName("focus_lens")).toEqual({
    ok: false,
    error: { kind: "group_name", reason: "pattern" },
  });
  expect(checkGroupName("a")).toEqual({
    ok: false,
    error: { kind: "group_name", reason: "pattern" },
  });
  expect(checkGroupName(`a${"b".repeat(32)}`)).toEqual({
    ok: false,
    error: { kind: "group_name", reason: "pattern" },
  });
  expect(checkGroupName("core")).toEqual({
    ok: false,
    error: { kind: "group_name", reason: "reserved" },
  });
  expect(checkGroupName("helm")).toEqual({ ok: true, value: "helm" });
});

test("the real templates/index.json parses and lists 10, 8 and 9 files for drive, policy and observe", () => {
  const text = readFileSync(join(GROUP_KIT, "templates", "index.json"), "utf8");
  const parsed = parseTemplateIndex(text);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.templates.drive.files).toHaveLength(10);
  expect(parsed.value.templates.policy.files).toHaveLength(8);
  expect(parsed.value.templates.observe.files).toHaveLength(9);
  expect(parsed.value.templates.drive.usesDrive).toBe(true);
  expect(parsed.value.templates.policy.usesDrive).toBe(false);
});

test("parseTemplateIndex refuses another schemaVersion and text that is not JSON", () => {
  const other = parseTemplateIndex(JSON.stringify({ schemaVersion: 2, templates: {} }));
  expect(other.ok).toBe(false);
  if (!other.ok) expect(other.error).toBe("/schemaVersion must be equal to constant");
  expect(parseTemplateIndex("{")).toEqual({ ok: false, error: "색인이 JSON이 아니다" });
});

test("template paths are safe relative paths and map to target paths without the bundle name", () => {
  expect(isSafeRelativePath("common/package.json")).toBe(true);
  expect(isSafeRelativePath("../etc/passwd")).toBe(false);
  expect(isSafeRelativePath("/abs/path")).toBe(false);
  expect(isSafeRelativePath("a\\b")).toBe(false);
  expect(isSafeRelativePath("a//b")).toBe(false);
  expect(targetPathOf("common/test/manifest.test.ts")).toBe("test/manifest.test.ts");
  expect(targetPathOf("drive/.xeon-plugin/plugin.json")).toBe(".xeon-plugin/plugin.json");
  expect(targetPathOf("drive")).toBe(null);
});

test("fillPlaceholders replaces the three slots and nothing else", () => {
  const values = { id: "focus-lens", title: "Focus Lens", version: "0.1.0" };
  expect(fillPlaceholders("grp.__ID__.x __TITLE__ __VERSION__ __OTHER__", values)).toBe(
    "grp.focus-lens.x Focus Lens 0.1.0 __OTHER__",
  );
});

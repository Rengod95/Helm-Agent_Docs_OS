import { expect, test } from "bun:test";
import {
  DEFAULT_AUTO_DISABLE,
  DEFAULT_BUDGETS_MS,
  TIERS,
  operationsSettings,
} from "../../src/operations/index.ts";
import { readDoc, tableRowsAfter } from "../support/docs.ts";

const SPEC = "X/operations/spec.md";

function numberOf(text: string): number {
  return Number(text.replaceAll(",", "").replaceAll("`", ""));
}

test("docs: constants match spec tables (budgets §4.2.2)", async () => {
  const spec = await readDoc(SPEC);
  const rows = tableRowsAfter(spec, "#### 4.2.2 기본값");
  const byClass = new Map(
    rows.map((cells) => [(cells[0] ?? "").replaceAll("`", ""), numberOf(cells[2] ?? "")]),
  );
  expect(Object.fromEntries(byClass)).toEqual(DEFAULT_BUDGETS_MS);
});

test("docs: constants match spec tables (tiers §3.1, autoDisable §3.3)", async () => {
  const spec = await readDoc(SPEC);
  const tiers = /export const TIERS: readonly \[[^\]]*\] =\s*\n?\s*\[([^\]]*)\]/.exec(spec);
  const names = (tiers?.[1] ?? "").split(",").map((part) => part.trim().replaceAll('"', ""));
  expect(names).toEqual([...TIERS]);

  const auto = /DEFAULT_AUTO_DISABLE: AutoDisablePolicy;\n\/\/ = \{([^}]*)\}/.exec(spec);
  const parsed: Record<string, unknown> = {};
  for (const part of (auto?.[1] ?? "").split(",")) {
    const [key, value] = part.split(":").map((piece) => piece.trim());
    if (key !== undefined && value !== undefined)
      parsed[key] = value === "true" ? true : Number(value);
  }
  expect(parsed).toEqual({ ...DEFAULT_AUTO_DISABLE });
});

test("docs: settings keys match spec §6", async () => {
  const spec = await readDoc(SPEC);
  const rows = tableRowsAfter(spec, "## 6. 설정 노출").filter(
    (cells) => (cells[7] ?? "") === "1차",
  );
  const documented = new Map(rows.map((cells) => [(cells[0] ?? "").replaceAll("`", ""), cells]));
  const defs = Object.values(operationsSettings.defs);
  const keys: string[] = defs.map((def) => def.key);
  expect(keys.toSorted()).toEqual([...documented.keys()].toSorted());
  for (const def of defs) {
    const cells = documented.get(def.key);
    expect(cells).toBeDefined();
    if (cells === undefined) continue;
    expect(String(def.default)).toBe((cells[2] ?? "").replaceAll("`", ""));
    const runtimeChange: string = def.runtimeChange;
    const tab: string | undefined = def.ui?.tab;
    expect(runtimeChange).toBe(cells[4] ?? "");
    expect([...def.allowedScopes].join(", ")).toBe(cells[5] ?? "");
    expect(tab).toBe(cells[6]);
    const range = (cells[3] ?? "").replaceAll("`", "");
    if (range.includes("~")) {
      const [min, max] = range.split("~");
      expect(def.range).toEqual({ min: Number(min), max: Number(max) });
    }
  }
});

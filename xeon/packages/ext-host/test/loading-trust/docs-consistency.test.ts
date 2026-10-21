import { expect, test } from "bun:test";
import { TRUST_LEVELS, TRUST_MATRIX, type TrustLevel } from "../../src/loading-trust/index.ts";
import { readDoc, tableRowsAfter } from "../support/docs.ts";

const SPEC = "X/loading-trust/spec.md";

function yes(cell: string | undefined): boolean {
  if (cell === "예") return true;
  if (cell === "아니오") return false;
  throw new Error(`unexpected cell ${String(cell)}`);
}

test("docs: trust table matches TRUST_MATRIX", async () => {
  const spec = await readDoc(SPEC);
  const rows = tableRowsAfter(spec, "#### 4.6.2 등급 × 허용 연산 표");
  expect(rows).toHaveLength(4);
  const parsed = new Map<string, unknown>();
  for (const cells of rows) {
    const level = (cells[0] ?? "").replaceAll("`", "");
    parsed.set(level, {
      load: yes(cells[1]),
      on: yes(cells[2]),
      onProjectTrust: yes(cells[3]),
      post: yes(cells[4]),
      drive: yes(cells[5]),
      resources: yes(cells[6]),
      storage: cells[7],
      isolation: cells[8] === "notLoaded" ? "notLoaded" : cells[8],
    });
  }
  expect([...parsed.keys()]).toEqual([...TRUST_LEVELS]);
  for (const level of TRUST_LEVELS) {
    const documented = parsed.get(level);
    const expected: Record<TrustLevel, unknown> = TRUST_MATRIX;
    expect(documented).toEqual(expected[level]);
  }
});

test("docs: trust levels and install sources match spec §3.1", async () => {
  const spec = await readDoc(SPEC);
  expect(spec).toContain(
    'export const TRUST_LEVELS: readonly ["builtin", "user", "project", "untrusted"]',
  );
  expect(spec).toContain(
    'export const INSTALL_SOURCES: readonly ["builtin", "managed", "user", "project"]',
  );
  expect(spec).toContain(
    'export const SOURCE_ORDER: readonly ["builtin", "managed", "user", "project"]',
  );
  expect(spec).toContain('export const BUILTIN_LAYER_ORDER: readonly ["L1", "L2", "L3", "plugin"]');
});

import { expect, test } from "bun:test";
import { Glob } from "bun";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "..", "src");
const PI_SPECIFIER =
  /from\s+["']@earendil-works\/pi-[^"']+["']|import\s*\(\s*["']@earendil-works\/pi-/g;

test("F source references pi packages through import type / export type only", async () => {
  const offenders: string[] = [];
  for await (const file of new Glob("**/*.ts").scan({ cwd: SRC })) {
    const text = await Bun.file(join(SRC, file)).text();
    for (const match of text.matchAll(PI_SPECIFIER)) {
      const before = text.slice(0, match.index);
      const statementStart = Math.max(before.lastIndexOf("import"), before.lastIndexOf("export"));
      const statement = text.slice(statementStart, match.index);
      if (!/^(import|export)\s+type\b/.test(statement)) offenders.push(file);
    }
  }
  expect(offenders).toEqual([]);
});

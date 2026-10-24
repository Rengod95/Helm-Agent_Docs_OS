import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "bun:test";

// L0.exec.spec §9 7번: OS 이름을 읽는 곳은 src/select.ts 하나다(DR-13). src/upstream/**, src/providers/*도 센다.

const SRC = join(import.meta.dir, "..", "src");
const READS_PLATFORM =
  /process\s*\.\s*platform|os\s*\.\s*platform\s*\(|process\s*\.\s*arch|os\s*\.\s*(type|release)\s*\(/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

test("process.platform appears only in select", () => {
  const offenders = sources(SRC)
    .filter((path) => relative(SRC, path) !== "select.ts")
    .filter((path) => READS_PLATFORM.test(readFileSync(path, "utf8")))
    .map((path) => relative(SRC, path));
  expect(offenders).toEqual([]);
});

test("select reads the process OS name", () => {
  expect(readFileSync(join(SRC, "select.ts"), "utf8")).toMatch(READS_PLATFORM);
});

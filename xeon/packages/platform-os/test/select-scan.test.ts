import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// OS-16: OS 분기 표현은 select.ts에만 있다(DR-13, L0.os.spec §9 7번)
const SRC = join(import.meta.dir, "..", "src");
const FORBIDDEN: readonly string[] = [
  "process.platform",
  "os.platform(",
  "WSL_DISTRO_NAME",
  "/proc/version",
];

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

test("OS 분기 표현은 select.ts에만", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file);
    if (rel === "select.ts") continue;
    const text = readFileSync(file, "utf8");
    for (const word of FORBIDDEN) {
      if (text.includes(word)) offenders.push(`${rel}: ${word}`);
    }
  }
  expect(offenders).toEqual([]);
});

test("select.ts에는 분기 표현이 실제로 있다(스캔이 비어 있지 않음)", () => {
  const text = readFileSync(join(SRC, "select.ts"), "utf8");
  for (const word of FORBIDDEN) expect(text).toContain(word);
});

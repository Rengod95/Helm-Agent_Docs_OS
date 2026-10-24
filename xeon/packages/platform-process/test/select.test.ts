import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";
import { selectProcessPlatform } from "../src/index.ts";

// DR-13: OS 이름을 읽는 곳은 src/select.ts 하나다.

describe("select process platform", () => {
  test("posix systems detach the child so the whole tree can be signalled", () => {
    for (const platform of ["linux", "darwin"]) {
      const selected = selectProcessPlatform({ platform });
      expect(selected.ok && selected.value.kind).toBe("posix");
      expect(selected.ok && selected.value.detachedSpawn).toBe(true);
    }
  });

  test("windows does not detach", () => {
    const selected = selectProcessPlatform({ platform: "win32" });
    expect(selected.ok && selected.value.kind).toBe("win32");
    expect(selected.ok && selected.value.detachedSpawn).toBe(false);
  });

  test("an unsupported OS is an error value", () => {
    expect(selectProcessPlatform({ platform: "freebsd" })).toEqual({
      ok: false,
      error: { kind: "unsupported_platform", platform: "freebsd" },
    });
  });
});

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

describe("OS name is read in one place", () => {
  test("process.platform appears only in select", () => {
    const offenders = sources(SRC)
      .filter((path) => relative(SRC, path) !== "select.ts")
      .filter((path) => READS_PLATFORM.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });
});

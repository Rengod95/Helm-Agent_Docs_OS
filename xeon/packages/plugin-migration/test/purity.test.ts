// 수용 기준 4: 라이브러리는 네트워크, 프로세스, 파일 접근 모듈을 import하지 않고 시각·난수·환경을 읽지 않는다.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

function sourcesOf(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesOf(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

const FORBIDDEN =
  /node:(net|http|https|http2|dgram|tls|child_process|fs|fs\/promises)\b|Bun\.(spawn|file|write)|process\.env|Date\.now|Math\.random|new Date\(/;

test("no source file touches network, processes, files, clocks or the environment", () => {
  const offenders = sourcesOf(join(import.meta.dir, "..", "src")).filter((path) =>
    FORBIDDEN.test(readFileSync(path, "utf8")),
  );
  expect(offenders).toEqual([]);
});

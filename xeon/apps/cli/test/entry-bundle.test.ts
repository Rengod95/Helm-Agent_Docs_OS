import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// CLI.4, open-issues M-08: 컴파일 바이너리(`bun build --compile --minify --bytecode`)가 CLI 진입과 그 import 그래프 전체
// (엔진 조립 @xeon/host 포함)를 묶을 수 있어야 한다. bytecode 빌드는 최상위 await를 거부하므로 어느 파일에든 생기면 깨진다.
// 바이너리를 만들거나 실행하지 않고 같은 옵션으로 번들만 한다. 사이드카 빌드 자체는 scripts/build-sidecar.ts의 몫이다.

const out = mkdtempSync(join(tmpdir(), "xcli-bundle-"));
afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

test("the CLI entry bundles with --minify --bytecode, so nothing in its graph uses top-level await", async () => {
  const built = await Bun.build({
    entrypoints: [join(import.meta.dir, "../src/main.ts")],
    outdir: out,
    target: "bun",
    format: "cjs",
    minify: true,
    bytecode: true,
  });
  expect(built.logs.map((log) => log.message)).toEqual([]);
  expect(built.success).toBe(true);
  expect(built.outputs.length).toBeGreaterThan(0);
}, 60_000);

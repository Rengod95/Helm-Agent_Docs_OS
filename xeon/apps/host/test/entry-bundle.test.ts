import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// HOST.5, open-issues M-08: 컴파일 바이너리(`bun build --compile --minify --bytecode`)가 호스트 진입을 묶을 수 있어야 한다.
// bytecode 빌드는 최상위 await를 거부하므로, main.ts와 그 import 그래프에 최상위 await가 생기면 이 시험이 깨진다.
// 바이너리를 만들거나 실행하지 않고 같은 옵션으로 번들만 한다(프로세스 실행은 L0만 한다, DR-07).

const out = mkdtempSync(join(tmpdir(), "xh-bundle-"));
afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

test("the host entry bundles with --minify --bytecode, so it has no top-level await", async () => {
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

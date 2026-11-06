import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 묶은 사이드카에서도 변환 워커가 돈다(시나리오 scE S6): `build-sidecar`와 같은 작업 폴더(apps/desktop)에서 같은 방식으로 컴파일해 돌린다.
const DESKTOP = join(import.meta.dir, "..", "apps", "desktop");
const RUNNER = join(
  import.meta.dir,
  "..",
  "packages",
  "cap-web",
  "src",
  "fetch",
  "convert-runner.ts",
);
// build-sidecar는 워커를 apps/desktop 기준 상대 경로로 넘긴다(묶음 안 이름이 그 경로로 정해진다)
const WORKER = "../../packages/cap-web/src/fetch/convert-worker.ts";

test("a compiled binary converts a page through the bundled worker", () => {
  const dir = mkdtempSync(join(tmpdir(), "convert-compiled-"));
  try {
    const main = join(dir, "main.ts");
    writeFileSync(
      main,
      `import { createWorkerConvertRunner } from ${JSON.stringify(RUNNER)};
async function main() {
  const runner = createWorkerConvertRunner({ timeoutMs: 20000 });
  const html = "<html><body><article><h1>Compiled title</h1><p>The worker ran inside the bundle and read this paragraph of text.</p></article></body></html>";
  const out = await runner.convert(
    { bytes: new TextEncoder().encode(html), contentType: "text/html", baseUrl: "https://example.com/", extractor: "readability" },
    new AbortController().signal,
  );
  console.log(JSON.stringify(out));
  await runner.close();
}
main();
`,
    );
    const out = join(dir, "bin");
    const build = Bun.spawnSync(
      ["bun", "build", "--compile", "--minify", "--bytecode", main, WORKER, "--outfile", out],
      { cwd: DESKTOP, stdout: "pipe", stderr: "pipe" },
    );
    expect(build.exitCode).toBe(0);
    const run = Bun.spawnSync([out], { cwd: dir, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
    const text = run.stdout.toString();
    expect(text).toContain("Compiled title");
    expect(text).not.toContain("worker_failed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);

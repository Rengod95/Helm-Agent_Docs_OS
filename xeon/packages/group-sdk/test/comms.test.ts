import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const FIXTURES = join(import.meta.dir, "fixtures", "cross-group-import");
const CHECK_LAYERS = resolve(import.meta.dir, "../../../scripts/check-layers.ts");
const SRC = resolve(import.meta.dir, "../src");

interface PackageSpec {
  readonly dir: string;
  readonly deps: readonly string[];
  /** fixtures/cross-group-import/<case>/ 아래의 소스 파일 이름 */
  readonly source: string;
}

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** 가짜 xeon 작업 트리를 만들고 check-layers를 돌려 종료코드와 표준 오류를 돌려준다 */
async function runCheckLayers(
  fixtureCase: string,
  packages: readonly PackageSpec[],
  allowlist: readonly object[],
): Promise<{ readonly code: number; readonly stderr: string }> {
  const base = mkdtempSync(join(tmpdir(), "group-sdk-comms-"));
  made.push(base);
  // check-layers는 작업 트리 옆의 docs/xeon/_routing/routes.yaml도 읽는다
  mkdirSync(join(base, "docs/xeon/_routing"), { recursive: true });
  writeFileSync(
    join(base, "docs/xeon/_routing/routes.yaml"),
    "layout:\n  L0:\n    domains: []\n  L1:\n    domains: []\n  L2:\n    domains: []\n",
  );
  const root = join(base, "xeon");
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts/dependency-allowlist.json"), JSON.stringify(allowlist));
  for (const pkg of packages) {
    const dir = join(root, "packages", pkg.dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: `@fresnel/${pkg.dir}`,
        version: "0.0.0",
        private: true,
        type: "module",
        exports: { ".": "./src/index.ts" },
        dependencies: Object.fromEntries(pkg.deps.map((dep) => [dep, "workspace:*"])),
        xeon: {
          layer: "L3",
          domain: pkg.dir === "group-sdk" ? "group-sdk" : pkg.dir.slice("group-".length),
        },
      }),
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({ references: pkg.deps.map((dep) => ({ path: `../${dep.slice(6)}` })) }),
    );
    writeFileSync(
      join(dir, "src/index.ts"),
      readFileSync(join(FIXTURES, fixtureCase, `${pkg.source}.ts.txt`), "utf8"),
    );
  }
  const child = Bun.spawn([process.execPath, CHECK_LAYERS, root], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  return { code, stderr };
}

// scripts/dependency-allowlist.json의 DR-02/group-sdk와 같은 모양(가족 패턴, 두 진입점)
const ALLOW_KIT = {
  id: "DR-02/group-sdk",
  rule: "DR-02",
  from: "packages/group-*",
  to: "@fresnel/group-sdk",
  entries: [".", "./testing"],
  reason: "every group uses the shared group definition helpers of group-sdk (fixture)",
  approvedBy: "L3.group-sdk.plan G-21",
};

test("comms.no-cross-group-import", async () => {
  // 그룹이 다른 그룹을 import하면 DR-02로 실패한다
  const crossing = await runCheckLayers(
    "group-imports-group",
    [
      { dir: "group-a", deps: ["@fresnel/group-b"], source: "group-a" },
      { dir: "group-b", deps: [], source: "group-b" },
    ],
    [],
  );
  expect(crossing.code).toBe(1);
  expect(crossing.stderr).toContain("packages/group-a/src/index.ts:1 DR-02");

  // 허용 목록 항목(그룹 → group-sdk)이 있으면 같은 모양의 import가 통과한다
  const allowed = await runCheckLayers(
    "group-imports-kit",
    [
      { dir: "group-a", deps: ["@fresnel/group-sdk"], source: "group-a" },
      { dir: "group-sdk", deps: [], source: "group-sdk" },
    ],
    [ALLOW_KIT],
  );
  expect(allowed.stderr).toBe("");
  expect(allowed.code).toBe(0);

  // 허용 목록이 없으면 group-sdk import도 위반이다
  const unlisted = await runCheckLayers(
    "group-imports-kit",
    [
      { dir: "group-a", deps: ["@fresnel/group-sdk"], source: "group-a" },
      { dir: "group-sdk", deps: [], source: "group-sdk" },
    ],
    [],
  );
  expect(unlisted.code).toBe(1);
  expect(unlisted.stderr).toContain("DR-02");

  // 허용은 그룹 → group-sdk 한 방향이다. group-sdk이 그룹을 import하면 허용 목록이 있어도 위반이다
  const reverse = await runCheckLayers(
    "kit-imports-group",
    [
      { dir: "group-a", deps: [], source: "group-a" },
      { dir: "group-sdk", deps: ["@fresnel/group-a"], source: "group-sdk" },
    ],
    [ALLOW_KIT],
  );
  expect(reverse.code).toBe(1);
  expect(reverse.stderr).toContain("packages/group-sdk/src/index.ts:1 DR-02");
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(dir, entry.name)]
        : [],
  );
}

test("comms.group-sdk-sources-import-no-group-package", () => {
  const offenders = sourceFiles(SRC).filter((file) =>
    /@fresnel\/group-(?!sdk)/.test(readFileSync(file, "utf8")),
  );
  expect(offenders).toEqual([]);
});

// 계정 회전 플러그인 산출물을 만든다(B2-MDL, group-helm의 build-plugin과 같은 모양이다).
//   <outDir>/.xeon-plugin/plugin.json   accountRotationManifest를 JSON으로 옮긴 것(엔트리는 ./dist/index.js)
//   <outDir>/dist/index.js              엔트리 번들. 호스트가 같은 인스턴스를 주는 모듈(@xeon/contracts, @xeon/group-kit, typebox)은 외부 import로 둔다
// 사용: bun scripts/build-plugin.ts [outDir]   (기본 dist-plugin)
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { attemptAsync, err, ok, type Result } from "@xeon/contracts";
import { accountRotationManifest } from "../src/manifest.ts";

const PACKAGE_DIR = resolve(import.meta.dir, "..");

/** 번들에서 외부로 두는 지정자 패턴. 하위 경로 import(`@xeon/contracts/capabilities` 등)까지 포함한다 */
const EXTERNAL_PATTERNS: readonly string[] = [
  "@xeon/contracts",
  "@xeon/contracts/*",
  "@xeon/group-kit",
  "typebox",
  "typebox/*",
];

export interface PluginBuild {
  readonly outDir: string;
  /** 번들이 외부 import로 남긴 지정자. 호스트가 가상 모듈로 등록해야 하는 목록이다 */
  readonly externals: readonly string[];
}

export type PluginBuildError =
  | { readonly kind: "bundle"; readonly message: string }
  | { readonly kind: "io"; readonly cause: unknown };

const IMPORT_SPECIFIER =
  /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*["']([^"']+)["']/g;

/** 번들 텍스트에서 패키지 지정자(상대 경로와 node: 내장 제외)를 모은다 */
function externalsOf(bundle: string): readonly string[] {
  const found = new Set<string>();
  for (const match of bundle.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier === undefined || specifier.startsWith(".") || specifier.startsWith("node:"))
      continue;
    found.add(specifier);
  }
  return [...found].toSorted((a, b) => a.localeCompare(b));
}

export async function buildAccountRotationPlugin(
  outDir: string,
): Promise<Result<PluginBuild, PluginBuildError>> {
  const prepared = await attemptAsync(async () => {
    await rm(outDir, { recursive: true, force: true });
    await mkdir(join(outDir, ".xeon-plugin"), { recursive: true });
    await mkdir(join(outDir, "dist"), { recursive: true });
  });
  if (!prepared.ok) return err({ kind: "io", cause: prepared.error.cause });
  const bundled = await Bun.build({
    entrypoints: [join(PACKAGE_DIR, "src/index.ts")],
    outdir: join(outDir, "dist"),
    target: "bun",
    format: "esm",
    naming: "index.js",
    external: [...EXTERNAL_PATTERNS],
  });
  if (!bundled.success) {
    return err({ kind: "bundle", message: bundled.logs.map((log) => log.message).join("; ") });
  }
  const written = await attemptAsync(async () => {
    const text = await Bun.file(join(outDir, "dist", "index.js")).text();
    await writeFile(
      join(outDir, ".xeon-plugin", "plugin.json"),
      `${JSON.stringify(accountRotationManifest, null, 2)}\n`,
    );
    return externalsOf(text);
  });
  if (!written.ok) return err({ kind: "io", cause: written.error.cause });
  return ok({ outDir, externals: written.value });
}

if (import.meta.main) {
  const outDir = resolve(process.argv[2] ?? join(PACKAGE_DIR, "dist-plugin"));
  const built = await buildAccountRotationPlugin(outDir);
  if (!built.ok) {
    process.stderr.write(`build-plugin failed: ${built.error.kind}\n`);
    process.exit(1);
  }
  process.stdout.write(`${outDir}\nexternals: ${built.value.externals.join(", ")}\n`);
}

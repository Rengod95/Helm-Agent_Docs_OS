import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { err, ok, parseJson, type Result } from "@fresnel/contracts";
import { validateManifest } from "@fresnel/contracts/extensions";
import type { DevkitError, PackInput, PackResult } from "@fresnel/contracts/services";
import { SDK_MODULE_SPECIFIERS } from "@fresnel/ext-host";
import { invalid, io, mapAll } from "./errors.ts";
import { MANIFEST_PATH, validateExtensionDir } from "./validate.ts";

// L3.authoring.spec §3.3 `pack`. 확장 폴더를 설치 가능한 묶음 폴더로 만든다.
// 엔트리는 한 파일(`dist/index.js`)로 번들한다: `ext.reload`는 한 파일 번들 엔트리만 완전히 다시 읽는다(옛 상대 import는 모듈 캐시에 남는다).
// SDK 모듈(호스트가 같은 인스턴스를 주는 가상 모듈)은 번들에 넣지 않고 외부 import로 둔다.

export const BUNDLE_ENTRY = "./dist/index.js";
const DEFAULT_OUT = "dist/package";

/** 묶음에 넣지 않는 최상위 이름과 비밀처럼 보이는 파일 이름 */
const SKIPPED_TOP: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  ".git",
  "src",
  "test",
  "package.json",
  "tsconfig.json",
  "bun.lock",
]);
const SECRET_NAME =
  /(^\.env(\..*)?$|\.pem$|\.key$|\.p12$|\.pfx$|^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$|^credentials(\..*)?$)/i;

/** 비밀처럼 보이는 파일 이름인가(spec §3.3 pack) */
export function looksSecret(name: string): boolean {
  return SECRET_NAME.test(name);
}

const EXTERNAL: readonly string[] = [...SDK_MODULE_SPECIFIERS, "@fresnel/contracts/*", "typebox/*"];

async function copyTree(
  from: string,
  to: string,
  prefix: string,
): Promise<Result<string[], DevkitError>> {
  const entries = await io(from, () => readdir(join(from, prefix), { withFileTypes: true }));
  if (!entries.ok) return entries;
  const nested = await mapAll(entries.value, async (entry) => {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (prefix === "" && SKIPPED_TOP.has(entry.name)) return ok<string[]>([]);
    if (looksSecret(entry.name)) return ok<string[]>([]);
    if (entry.isDirectory()) return copyTree(from, to, rel);
    if (!entry.isFile()) return ok<string[]>([]);
    const done = await io(rel, async () => {
      await mkdir(dirname(join(to, rel)), { recursive: true });
      await cp(join(from, rel), join(to, rel));
    });
    return done.ok ? ok([rel]) : done;
  });
  if (!nested.ok) return nested;
  return ok(nested.value.flat());
}

async function listAll(root: string, prefix = ""): Promise<Result<string[], DevkitError>> {
  const entries = await io(root, () => readdir(join(root, prefix), { withFileTypes: true }));
  if (!entries.ok) return entries;
  const nested = await mapAll(entries.value, async (entry) => {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? listAll(root, rel) : ok([rel]);
  });
  if (!nested.ok) return nested;
  return ok(nested.value.flat().toSorted());
}

/** 파일 경로와 내용을 순서대로 묶은 sha256(소문자 hex) */
export async function folderHash(
  root: string,
  files: readonly string[],
): Promise<Result<string, DevkitError>> {
  const hash = createHash("sha256");
  const digests = await mapAll(files, async (file) => {
    const bytes = await io(file, () => readFile(join(root, file)));
    return bytes.ok
      ? ok(`${file}\0${createHash("sha256").update(bytes.value).digest("hex")}\n`)
      : bytes;
  });
  if (!digests.ok) return digests;
  for (const line of digests.value) hash.update(line);
  return ok(hash.digest("hex"));
}

async function bundleEntry(entryPath: string, outdir: string): Promise<Result<void, DevkitError>> {
  const built = await io("bundle", () =>
    Bun.build({
      entrypoints: [entryPath],
      outdir,
      target: "bun",
      format: "esm",
      naming: "index.js",
      external: [...EXTERNAL],
    }),
  );
  if (!built.ok) return built;
  if (!built.value.success)
    return err(invalid(`bundle failed: ${built.value.logs.map((log) => log.message).join("; ")}`));
  if (built.value.outputs.length !== 1)
    return err(invalid(`bundle produced ${built.value.outputs.length} files, expected one`));
  return ok(undefined);
}

/** 묶음을 만든다. 검사 오류가 있으면 만들지 않는다. 기본 출력은 `<dir>/dist/package`(다시 만들면 비우고 쓴다), 지정한 `out`은 없거나 비어 있어야 한다 */
export async function packExtension(input: PackInput): Promise<Result<PackResult, DevkitError>> {
  if (!isAbsolute(input.dir)) return err(invalid("dir must be an absolute path"));
  const report = await validateExtensionDir(input.dir);
  if (!report.ok) return report;
  if (!report.value.ok) {
    const errors = report.value.issues.filter((entry) => entry.severity === "error");
    return err(invalid(`validation failed: ${errors.map((entry) => entry.code).join(", ")}`));
  }
  const text = await io(MANIFEST_PATH, () => readFile(join(input.dir, MANIFEST_PATH), "utf8"));
  if (!text.ok) return text;
  const json = parseJson(text.value);
  if (
    !json.ok ||
    typeof json.value !== "object" ||
    json.value === null ||
    Array.isArray(json.value)
  )
    return err(invalid(`${MANIFEST_PATH} is not an object`));
  const manifest = validateManifest(json.value).manifest;
  if (manifest === undefined) return err(invalid("manifest is not valid"));

  const out = input.out ?? join(input.dir, DEFAULT_OUT);
  if (!isAbsolute(out)) return err(invalid("out must be an absolute path"));
  const outRel = relative(input.dir, out);
  const insideDir = !outRel.startsWith("..") && outRel !== "";
  if (outRel === "" || (!insideDir && relative(out, input.dir) === ""))
    return err(invalid("out must not be dir"));
  if (input.out === undefined) {
    await rm(out, { recursive: true, force: true });
  } else {
    const existing = await io(out, () => readdir(out));
    if (existing.ok && existing.value.length > 0)
      return err({ kind: "exists", message: `${out} is not empty` });
    if (!existing.ok && existing.error.kind !== "not_found") return existing;
  }
  const made = await io(out, () => mkdir(out, { recursive: true }));
  if (!made.ok) return made;

  const scratch = await io("tmp", () => mkdtemp(join(tmpdir(), "fresnel-pack-")));
  if (!scratch.ok) return scratch;
  try {
    const bundled = await bundleEntry(join(input.dir, manifest.entry), join(scratch.value));
    if (!bundled.ok) return bundled;
    const copied = await copyTree(input.dir, out, "");
    if (!copied.ok) return copied;
    const placed = await io("dist", async () => {
      await mkdir(join(out, "dist"), { recursive: true });
      await cp(join(scratch.value, "index.js"), join(out, "dist", "index.js"));
      await mkdir(join(out, ".fresnel-plugin"), { recursive: true });
      await writeFile(
        join(out, MANIFEST_PATH),
        `${JSON.stringify({ ...manifest, entry: BUNDLE_ENTRY }, null, 2)}\n`,
      );
    });
    if (!placed.ok) return placed;
  } finally {
    await rm(scratch.value, { recursive: true, force: true });
  }
  const files = await listAll(out);
  if (!files.ok) return files;
  const sha256 = await folderHash(out, files.value);
  if (!sha256.ok) return sha256;
  return ok({ path: out, files: files.value, sha256: sha256.value });
}

import { cp, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { err, ok, parseJson, type Result } from "@fresnel/contracts";
import { EXTENSION_NAME_PATTERN, validateManifest } from "@fresnel/contracts/extensions";
import type { ExtensionManifest } from "@fresnel/contracts/extensions";
import type {
  DevkitError,
  InstallPreview,
  LinkInput,
  LinkResult,
} from "@fresnel/contracts/services";
import { invalid, io } from "./errors.ts";
import { folderHash, listAll } from "./pack.ts";
import { MANIFEST_PATH, validateExtensionDir } from "./validate.ts";

// L3.authoring.spec §3.3 `link`(W-32). 묶음 폴더를 사용자 확장 위치 `<extensionsDir>/<이름>`에 놓는다.
// 사람 확인은 호출하는 쪽(그룹 `authoring`, 화면)이 한다. 한 파일 번들이 아닌 엔트리(`.ts` 소스)는 받지 않는다:
// `ext.reload`가 새 버전을 완전히 다시 읽으려면 묶인 한 파일 엔트리여야 한다.

export interface InstallOptions {
  readonly extensionsDir: string;
}
export interface InstallOutcome extends LinkResult {
  /** 같은 이름의 설치본이 있어 바꿨는가 */
  readonly replaced: boolean;
}

const NAME_REGEX = new RegExp(EXTENSION_NAME_PATTERN);

/** 설치와 미리 보기가 같이 쓰는 검사. 설치할 수 있는 폴더면 매니페스트를 돌려준다 */
async function readInstallable(source: string): Promise<Result<ExtensionManifest, DevkitError>> {
  if (!isAbsolute(source)) return err(invalid("source must be an absolute path"));
  const text = await io(MANIFEST_PATH, () => readFile(join(source, MANIFEST_PATH), "utf8"));
  if (!text.ok) return text;
  const json = parseJson(text.value);
  if (!json.ok) return err(invalid(`${MANIFEST_PATH} is not JSON`));
  const checked = validateManifest(json.value);
  const manifest = checked.manifest;
  if (manifest === undefined || checked.issues.some((entry) => entry.severity === "error"))
    return err(invalid("manifest is not valid"));
  if (manifest.trust?.level === "builtin")
    return err({ kind: "denied", message: "AU-002: builtin trust cannot be installed" });
  if (!/\.(js|mjs)$/.test(manifest.entry))
    return err(invalid("entry must be a bundled single file (run ext.package first)"));
  const entry = await io(manifest.entry, () => stat(join(source, manifest.entry)));
  if (!entry.ok) return err(invalid(`entry ${manifest.entry} does not exist`));
  return ok(manifest);
}

async function contentHash(root: string): Promise<Result<string, DevkitError>> {
  const files = await listAll(root);
  if (!files.ok) return files;
  return folderHash(root, files.value);
}

const NETWORK_PREFIXES: readonly string[] = ["web.", "mcp."];
const FILE_IDS: ReadonlySet<string> = new Set(["workspace.files", "workspace.images"]);
const SHELL_IDS: ReadonlySet<string> = new Set(["workspace.shell"]);

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].toSorted();
}

/** 설치 전 미리 보기. 디스크에 쓰지 않는다. 설치와 같은 검사를 거친 폴더만 보여 준다 */
export async function previewInstall(
  input: { readonly source: string },
  options: InstallOptions,
): Promise<Result<InstallPreview, DevkitError>> {
  if (!isAbsolute(options.extensionsDir)) return err(invalid("extensionsDir must be absolute"));
  const read = await readInstallable(input.source);
  if (!read.ok) return read;
  const manifest = read.value;
  const hash = await contentHash(input.source);
  if (!hash.ok) return hash;
  const report = await validateExtensionDir(input.source);
  const warnings = report.ok ? report.value.issues.filter((i) => i.severity !== "info") : [];
  const installed = await io(manifest.name, () =>
    readFile(join(options.extensionsDir, manifest.name, MANIFEST_PATH), "utf8"),
  );
  const current = installed.ok ? parseJson(installed.value) : undefined;
  const installedManifest = current?.ok ? validateManifest(current.value).manifest : undefined;
  const requested = manifest.plugins.flatMap((plugin) => [
    ...(plugin.requires ?? []).map((cap) => ({ id: cap.id, optional: false })),
    ...(plugin.optional ?? []).map((cap) => ({ id: cap.id, optional: true })),
  ]);
  const ids = [...new Set(requested.map((cap) => cap.id))];
  const trust = manifest.trust?.level;
  return ok({
    name: manifest.name,
    version: manifest.version,
    displayName: manifest.displayName ?? null,
    description: manifest.description ?? null,
    source: input.source,
    sha256: hash.value,
    trustRequest: trust === "user" || trust === "project" || trust === "untrusted" ? trust : null,
    installedVersion: installedManifest?.version ?? null,
    hooks: unique(manifest.plugins.flatMap((plugin) => plugin.hooks)),
    tools: unique(manifest.plugins.flatMap((plugin) => plugin.replaces ?? [])),
    capabilities: requested,
    network: unique(ids.filter((id) => NETWORK_PREFIXES.some((prefix) => id.startsWith(prefix)))),
    files: unique(ids.filter((id) => FILE_IDS.has(id))),
    shell: unique(ids.filter((id) => SHELL_IDS.has(id))),
    drives: manifest.plugins.some((plugin) => plugin.drives === true),
    warnings,
  });
}

export async function installExtension(
  input: LinkInput,
  options: InstallOptions,
): Promise<Result<InstallOutcome, DevkitError>> {
  if (!isAbsolute(options.extensionsDir)) return err(invalid("extensionsDir must be absolute"));
  const read = await readInstallable(input.source);
  if (!read.ok) return read;
  const manifest = read.value;

  const location = join(options.extensionsDir, manifest.name);
  const existing = await io(location, () => stat(location));
  if (!existing.ok && existing.error.kind !== "not_found") return existing;
  const replaced = existing.ok;
  const staging = join(options.extensionsDir, `.staging-${manifest.name}`);
  const staged = await io(staging, async () => {
    await mkdir(options.extensionsDir, { recursive: true });
    await rm(staging, { recursive: true, force: true });
    await cp(input.source, staging, { recursive: true });
  });
  if (!staged.ok) return staged;
  // 미리 보기에서 본 내용과 복사한 내용이 같은지 복사본으로 잰다(복사 뒤 원본이 바뀌어도 속지 않는다)
  if (input.expectedSha256 !== undefined) {
    const actual = await contentHash(staging);
    const same = actual.ok && actual.value === input.expectedSha256;
    if (!same) {
      await rm(staging, { recursive: true, force: true });
      if (!actual.ok) return actual;
      return err({
        kind: "source_changed",
        message: "the folder changed after the preview; preview it again",
      });
    }
  }
  const swapped = await io(location, async () => {
    await rm(location, { recursive: true, force: true });
    await rename(staging, location);
  });
  if (!swapped.ok) {
    await rm(staging, { recursive: true, force: true });
    return swapped;
  }
  return ok({ name: manifest.name, version: manifest.version, location, replaced });
}

/** 사용자 확장 위치에서 확장 폴더를 지운다. 없으면 `not_found`다 */
export async function removeExtension(
  name: string,
  options: InstallOptions,
): Promise<Result<{ readonly location: string }, DevkitError>> {
  if (!NAME_REGEX.test(name)) return err(invalid(`name "${name}" is not valid`));
  const location = join(options.extensionsDir, name);
  const existing = await io(location, () => stat(location));
  if (!existing.ok) return existing;
  const removed = await io(location, () => rm(location, { recursive: true, force: true }));
  if (!removed.ok) return removed;
  return ok({ location });
}

import { cp, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { err, ok, parseJson, type Result } from "@fresnel/contracts";
import { EXTENSION_NAME_PATTERN, validateManifest } from "@fresnel/contracts/extensions";
import type { DevkitError, LinkInput, LinkResult } from "@fresnel/contracts/services";
import { invalid, io } from "./errors.ts";
import { MANIFEST_PATH } from "./validate.ts";

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

export async function installExtension(
  input: LinkInput,
  options: InstallOptions,
): Promise<Result<InstallOutcome, DevkitError>> {
  if (!isAbsolute(input.source)) return err(invalid("source must be an absolute path"));
  if (!isAbsolute(options.extensionsDir)) return err(invalid("extensionsDir must be absolute"));
  const text = await io(MANIFEST_PATH, () => readFile(join(input.source, MANIFEST_PATH), "utf8"));
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
  const entry = await io(manifest.entry, () => stat(join(input.source, manifest.entry)));
  if (!entry.ok) return err(invalid(`entry ${manifest.entry} does not exist`));

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

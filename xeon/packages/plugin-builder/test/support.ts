import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "bun:test";
import { parseJson } from "@fresnel/contracts";
import { validateManifest, type ExtensionManifest } from "@fresnel/contracts/extensions";
import { locateTemplateDirs, type TemplateDirs } from "../src/index.ts";

// 시험 공용. 임시 폴더는 시험 파일이 끝나면 지운다.

export function tempRoot(): { readonly path: (name: string) => string } {
  const root = mkdtempSync(join(tmpdir(), "fresnel-authoring-"));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return { path: (name) => join(root, name) };
}

export function templateDirs(): TemplateDirs {
  const found = locateTemplateDirs({});
  if (found === null) throw new Error("templates are missing in the source tree");
  return found;
}

/** JSON 파일을 객체로 읽는다. 객체가 아니면 시험이 실패한다 */
export function readRecord(path: string): Record<string, unknown> {
  const parsed = parseJson(readFileSync(path, "utf8"));
  if (
    !parsed.ok ||
    typeof parsed.value !== "object" ||
    parsed.value === null ||
    Array.isArray(parsed.value)
  )
    throw new Error(`${path} is not a JSON object`);
  return { ...parsed.value };
}

/** 확장 폴더의 매니페스트(정규화본). 검사를 통과하지 못하면 시험이 실패한다 */
export function readManifest(dir: string): ExtensionManifest {
  const manifest = validateManifest(
    readRecord(join(dir, ".fresnel-plugin", "plugin.json")),
  ).manifest;
  if (manifest === undefined) throw new Error(`${dir} has no valid manifest`);
  return manifest;
}

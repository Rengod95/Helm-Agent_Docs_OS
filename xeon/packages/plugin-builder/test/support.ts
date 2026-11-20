import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll } from "bun:test";
import { parse, parseJson } from "@fresnel/contracts";
import { validateManifest, type ExtensionManifest } from "@fresnel/contracts/extensions";
import { TemplateIndexSchema } from "@fresnel/group-sdk";
import { locateTemplateDirs, type TemplateDirs } from "@fresnel/core-authoring";

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

/**
 * 드라이브 그룹 뼈대를 group-sdk 템플릿 `drive`에서 복사한다. 제작 도구는 종류가 플러그인 하나뿐이라 그룹 뼈대를 만들지 않으므로,
 * 그룹 시험(검사, 묶기, 재생)은 템플릿 파일을 직접 옮긴다. 목록의 경로에서 첫 칸(`drive/`, `common/`)을 떼고 자리를 채운다.
 */
export async function driveOrchestrationFixture(
  name: string,
  dir: string,
  templates: TemplateDirs,
): Promise<void> {
  const indexed = parseJson(await readFile(join(templates.group, "index.json"), "utf8"));
  if (!indexed.ok) throw new Error("group-sdk templates/index.json is not JSON");
  const index = parse(TemplateIndexSchema, indexed.value);
  if (!index.ok) throw new Error("group-sdk templates/index.json has an unexpected shape");
  const planned = await Promise.all(
    index.value.templates.drive.files.map(async (file) => {
      const target = join(dir, file.split("/").slice(1).join("/").replaceAll("__ID__", name));
      const text = await readFile(join(templates.group, file), "utf8");
      const filled = text
        .replaceAll("__ID__", name)
        .replaceAll("__TITLE__", name)
        .replaceAll("__VERSION__", "0.1.0");
      return { target, filled };
    }),
  );
  await Promise.all(
    planned.map(async ({ target, filled }) => {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, filled);
    }),
  );
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

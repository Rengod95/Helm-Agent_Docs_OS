import { symlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import {
  discoverPluginFolders,
  type DiscoverInput,
} from "../../../src/assembly/plugins/discover.ts";
import { removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c §4.5.2: 위치 순서, 숨은 폴더 건너뛰기, 이름 충돌, 프로젝트 위치의 링크 거절.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

const SKILL = "---\ndescription: x\n---\nbody";

/** 후보를 "출처/이름(legacy)" 꼴로 줄인다. macOS의 /var 링크 때문에 절대 경로 대신 이름으로 본다 */
function labelOf(candidate: {
  readonly origin: string;
  readonly dir: string;
  readonly legacy: boolean;
}): string {
  return `${candidate.origin}/${basename(candidate.dir)}${candidate.legacy ? " (legacy)" : ""}`;
}

test("위치 순서대로 후보를 모으고 숨은 폴더와 파일은 건너뛴다", () => {
  const root = tempRoot("plugin-discover-");
  roots.push(root);
  writeFiles(root, {
    "config/plugins/beta/SKILL.md": SKILL,
    "config/plugins/alpha/SKILL.md": SKILL,
    "config/plugins/.hidden/SKILL.md": SKILL,
    "config/plugins/loose.txt": "a file, not a folder",
    "config/extensions/legacy-one/SKILL.md": SKILL,
    "extra/extra-one/SKILL.md": SKILL,
    "project/.fresnel/plugins/proj-one/SKILL.md": SKILL,
    "project/.fresnel/extensions/proj-legacy/SKILL.md": SKILL,
    "managed/plugins/managed-one/SKILL.md": SKILL,
    "bundle/bundled-one/SKILL.md": SKILL,
  });
  const result = discoverPluginFolders({
    configDir: join(root, "config"),
    extraPaths: [join(root, "extra")],
    projectRoots: [{ root: join(root, "project"), projectId: "prj_one" }],
    managedDir: join(root, "managed"),
    bundleDir: join(root, "bundle"),
  });
  expect(result.candidates.map(labelOf)).toEqual([
    "user/alpha",
    "user/beta",
    "user/legacy-one (legacy)",
    "user/extra-one",
    "project/proj-one",
    "project/proj-legacy (legacy)",
    "managed/managed-one",
    "bundled/bundled-one",
  ]);
  // 프로젝트 위치의 후보는 루트의 프로젝트 id를 가진다(AGE-41). 다른 위치는 id가 없다
  expect(result.candidates.map((candidate) => [candidate.origin, candidate.projectId])).toEqual([
    ["user", null],
    ["user", null],
    ["user", null],
    ["user", null],
    ["project", "prj_one"],
    ["project", "prj_one"],
    ["managed", null],
    ["bundled", null],
  ]);
  expect(result.diagnostics).toEqual([]);
});

test("프로젝트 루트가 null이면 프로젝트 위치를 보지 않고, 없는 폴더는 진단을 남기지 않는다", () => {
  const root = tempRoot("plugin-discover-");
  roots.push(root);
  writeFiles(root, { "project/.fresnel/plugins/proj-one/SKILL.md": SKILL });
  const result = discoverPluginFolders({
    configDir: join(root, "nothing-here"),
    extraPaths: [],
    projectRoots: [],
    managedDir: null,
    bundleDir: null,
  });
  expect(result.candidates).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

test("같은 이름이 둘이면 먼저 발견된 것만 후보이고 나머지는 name_conflict다", () => {
  const root = tempRoot("plugin-discover-");
  roots.push(root);
  writeFiles(root, {
    "config/plugins/shared/SKILL.md": SKILL,
    "managed/plugins/shared/SKILL.md": SKILL,
  });
  const input: DiscoverInput = {
    configDir: join(root, "config"),
    extraPaths: [],
    projectRoots: [],
    managedDir: join(root, "managed"),
    bundleDir: null,
  };
  const result = discoverPluginFolders(input);
  expect(result.candidates.map((candidate) => candidate.origin)).toEqual(["user"]);
  expect(result.diagnostics.map((item) => item.code)).toEqual(["name_conflict"]);
  expect(result.diagnostics[0]?.dir).toBe(join(root, "managed", "plugins", "shared"));
});

test("이름 충돌은 매니페스트 name으로 판정한다(폴더 이름이 달라도)", () => {
  const root = tempRoot("plugin-discover-");
  roots.push(root);
  writeFiles(root, {
    "config/plugins/pkg-a/.fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "dup-name",
      version: "1.0.0",
    }),
    "config/plugins/pkg-b/.fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "dup-name",
      version: "1.0.0",
    }),
  });
  const result = discoverPluginFolders({
    configDir: join(root, "config"),
    extraPaths: [],
    projectRoots: [],
    managedDir: null,
    bundleDir: null,
  });
  expect(result.candidates.map((candidate) => basename(candidate.dir))).toEqual(["pkg-a"]);
  expect(result.diagnostics.map((item) => item.code)).toEqual(["name_conflict"]);
});

test("프로젝트 위치 밖을 가리키는 심볼릭 링크는 outside_root로 거절한다", () => {
  const root = tempRoot("plugin-discover-");
  roots.push(root);
  writeFiles(root, {
    "outside/secret-plugin/SKILL.md": SKILL,
    "project/.fresnel/plugins/inside/SKILL.md": SKILL,
  });
  symlinkSync(
    join(root, "outside", "secret-plugin"),
    join(root, "project", ".fresnel", "plugins", "escape"),
  );
  const result = discoverPluginFolders({
    configDir: join(root, "nothing-here"),
    extraPaths: [],
    projectRoots: [{ root: join(root, "project"), projectId: "prj_one" }],
    managedDir: null,
    bundleDir: null,
  });
  expect(result.candidates.map((candidate) => basename(candidate.dir))).toEqual(["inside"]);
  expect(result.diagnostics.map((item) => item.code)).toEqual(["outside_root"]);
});

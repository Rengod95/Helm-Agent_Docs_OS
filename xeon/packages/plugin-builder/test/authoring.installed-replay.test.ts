import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { packExtension, runInstalledReplay, scaffoldExtension } from "../src/index.ts";
import { tempRoot, templateDirs } from "./support.ts";

// 설치된 플러그인 그룹의 재생(`runInstalledReplay`). 뼈대를 묶어 설치 폴더 모양을 만든 뒤 재생한다. 실제 모델은 부르지 않는다.

const root = tempRoot();
const templates = templateDirs();

/**
 * 뼈대를 만들고 한 파일로 묶는다. 묶은 폴더(설치본 모양)를 돌려준다. `enabled`면 뼈대의 `defaultEnabled`를 켠다
 * (뼈대는 꺼진 채로 나온다. 꺼진 그룹은 drive가 돌지 않아 재생에 커밋이 없다)
 */
async function packed(
  name: string,
  kind: "plugin-group" | "single-plugin",
  enabled = false,
): Promise<string> {
  const dir = root.path(`src-${name}`);
  const made = await scaffoldExtension({ kind, name, dir }, { templates });
  if (!made.ok) throw new Error(made.error.message);
  if (enabled) {
    const manifestPath = join(dir, ".fresnel-plugin", "plugin.json");
    const text = await readFile(manifestPath, "utf8");
    if (!text.includes('"defaultEnabled": false'))
      throw new Error("the scaffold has no defaultEnabled");
    await writeFile(
      manifestPath,
      text.replace('"defaultEnabled": false', '"defaultEnabled": true'),
    );
  }
  const bundled = await packExtension({ dir });
  if (!bundled.ok) throw new Error(bundled.error.message);
  return bundled.value.path;
}

test("a single plugin is refused: the manifest has no group", async () => {
  const dir = await packed("replay-plain", "single-plugin");
  expect(await runInstalledReplay({ dir, maxCommits: 10 })).toEqual({
    ok: false,
    error: {
      kind: "invalid_input",
      message:
        "replay-plain is not a plugin group (its manifest needs a group declaration and a root L3 plugin)",
    },
  });
});

test("a missing entry file is not_found", async () => {
  const dir = await packed("replay-missing", "plugin-group");
  await rm(join(dir, "dist", "index.js"));
  expect(await runInstalledReplay({ dir, maxCommits: 10 })).toEqual({
    ok: false,
    error: { kind: "not_found", message: "entry ./dist/index.js does not exist" },
  });
});

test("an entry that links outside the extension folder is refused", async () => {
  const dir = await packed("replay-escape", "plugin-group");
  const outside = root.path("outside-entry.js");
  await writeFile(outside, "export default function () {}\n");
  await rm(join(dir, "dist", "index.js"));
  await symlink(outside, join(dir, "dist", "index.js"));
  expect(await runInstalledReplay({ dir, maxCommits: 10 })).toEqual({
    ok: false,
    error: {
      kind: "invalid_input",
      message: "entry ./dist/index.js resolves outside the extension root",
    },
  });
});

test("an entry without a function export is refused", async () => {
  const dir = await packed("replay-no-function", "plugin-group");
  await writeFile(join(dir, "dist", "index.js"), "export const value = 1;\n");
  expect(await runInstalledReplay({ dir, maxCommits: 10 })).toEqual({
    ok: false,
    error: {
      kind: "invalid_input",
      message: 'entry ./dist/index.js exports neither a default nor an "extension" function',
    },
  });
});

test("an entry that fails to import is an io error with the message, not a throw", async () => {
  const dir = await packed("replay-broken", "plugin-group");
  await writeFile(join(dir, "dist", "index.js"), 'import "./no-such-module.js";\n');
  const result = await runInstalledReplay({ dir, maxCommits: 10 });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected an error");
  expect(result.error.kind).toBe("io");
  expect(result.error.message.startsWith("entry ./dist/index.js failed to import: ")).toBe(true);
});

test("maxCommits outside 1 to 1000 is invalid input", async () => {
  const dir = await packed("replay-limit", "plugin-group");
  expect(await runInstalledReplay({ dir, maxCommits: 0 })).toEqual({
    ok: false,
    error: { kind: "invalid_input", message: "maxCommits must be an integer from 1 to 1000" },
  });
  expect(await runInstalledReplay({ dir, maxCommits: 1001 })).toEqual({
    ok: false,
    error: { kind: "invalid_input", message: "maxCommits must be an integer from 1 to 1000" },
  });
});

test("a disabled drive group replays with no commits: the report fails with no-commits", async () => {
  const dir = await packed("replay-off", "plugin-group");
  expect(await runInstalledReplay({ dir, maxCommits: 50 })).toEqual({
    ok: true,
    value: { ok: false, commits: 0, cuts: [], failure: "no-commits" },
  });
});

test("an enabled drive group replays at every commit and the report carries the cut values", async () => {
  const dir = await packed("replay-drive", "plugin-group", true);
  expect(await runInstalledReplay({ dir, maxCommits: 50 })).toEqual({
    ok: true,
    value: {
      ok: true,
      commits: 3,
      cuts: [
        { commitIndex: 1, equal: true, firstDiff: null },
        { commitIndex: 2, equal: true, firstDiff: null },
        { commitIndex: 3, equal: true, firstDiff: null },
      ],
      effects: { turn: 3, spawn: 0, delegate: 0, post: 0 },
    },
  });
});

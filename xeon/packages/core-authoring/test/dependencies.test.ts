import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson, type Result } from "@fresnel/contracts";
import type { DevkitError, ScaffoldInput } from "@fresnel/contracts/services";
import {
  editDependencies,
  editMembers,
  locateTemplateDirs,
  readDependencies,
  scaffoldExtension,
} from "../src/index.ts";
import { arrayOf } from "../src/errors.ts";
import type { TemplateDirs } from "../src/templates-dir.ts";
import { isRecord } from "../src/shared.ts";

// 의존 편집(`editDependencies`, `readDependencies`, AGE-33). 시험 폴더는 임시 폴더에 만든다. 엔트리를 불러오지 않으므로 패키지 안에 둘 필요가 없다.

function templateDirs(): TemplateDirs {
  const found = locateTemplateDirs({}, undefined);
  if (found === null) throw new Error("core-authoring templates are missing");
  return found;
}

const templates = templateDirs();
const root = await mkdtemp(join(tmpdir(), "core-authoring-deps-"));
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function must<T>(result: Result<T, DevkitError>): T {
  if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`);
  return result.value;
}

function refusal<T>(result: Result<T, DevkitError>): DevkitError {
  if (result.ok) throw new Error(`expected a refusal, got ${JSON.stringify(result.value)}`);
  return result.error;
}

async function scaffoldFolder(
  name: string,
  extra: Omit<ScaffoldInput, "kind" | "name" | "dir"> = {},
): Promise<string> {
  const dir = join(root, name);
  const made = await scaffoldExtension(
    { kind: "single-plugin", name, dir, ...extra },
    { templates },
  );
  if (!made.ok) throw new Error(made.error.message);
  return dir;
}

function textOf(dir: string, path: string): string {
  return readFileSync(join(dir, path), "utf8");
}

function rawOf(dir: string): Record<string, unknown> {
  const parsed = parseJson(textOf(dir, ".fresnel-plugin/plugin.json"));
  if (!parsed.ok || !isRecord(parsed.value)) throw new Error("manifest is not an object");
  return parsed.value;
}

/** `plugins[index]`의 선언 객체 */
function declOf(dir: string, index: number): Record<string, unknown> {
  const decl = arrayOf(rawOf(dir)["plugins"])[index];
  if (!isRecord(decl)) throw new Error(`plugins[${index}] is not an object`);
  return decl;
}

/** `plugins[index].dependsOn`을 그대로 읽는다. 키가 없으면 undefined다 */
function dependsOnOf(dir: string, index: number): unknown {
  return declOf(dir, index)["dependsOn"];
}

test("add: a new line goes to the end of the root plugin's dependsOn and the manifest keeps it", async () => {
  const dir = await scaffoldFolder("dep-add");
  const before = textOf(dir, "src/index.ts");
  const edited = must(
    await editDependencies({
      dir,
      ops: [{ kind: "add", dependency: { plugin: "base-kit", range: "^1.2.0", kind: "hard" } }],
    }),
  );
  expect(edited.dependencies).toEqual([
    { from: "dep-add", target: "base-kit", kind: "hard", range: "^1.2.0" },
  ]);
  expect(edited.changedFiles).toEqual([".fresnel-plugin/plugin.json"]);
  expect(dependsOnOf(dir, 0)).toEqual([{ plugin: "base-kit", range: "^1.2.0", kind: "hard" }]);
  // 코드 파일은 건드리지 않는다
  expect(textOf(dir, "src/index.ts")).toBe(before);
});

test("add with the same target replaces that line in place; a missing range or kind in the new op is left out", async () => {
  const dir = await scaffoldFolder("dep-replace");
  must(
    await editDependencies({
      dir,
      ops: [
        { kind: "add", dependency: { plugin: "base-kit", range: "^1.0.0", kind: "hard" } },
        { kind: "add", dependency: { plugin: "audit-kit" } },
      ],
    }),
  );
  const replaced = must(
    await editDependencies({
      dir,
      ops: [{ kind: "add", dependency: { plugin: "base-kit", kind: "soft" } }],
    }),
  );
  // 같은 대상의 줄은 첫 자리에 그대로 남고, 새 값만 남는다(범위는 새 건에 없으니 빠진다)
  expect(dependsOnOf(dir, 0)).toEqual([
    { plugin: "base-kit", kind: "soft" },
    { plugin: "audit-kit" },
  ]);
  expect(replaced.dependencies).toEqual([
    { from: "dep-replace", target: "base-kit", kind: "soft", range: null },
    { from: "dep-replace", target: "audit-kit", kind: "soft", range: null },
  ]);
});

test("remove drops one line, and removing the last line drops the dependsOn key", async () => {
  const dir = await scaffoldFolder("dep-remove");
  must(
    await editDependencies({
      dir,
      ops: [
        { kind: "add", dependency: { plugin: "base-kit" } },
        { kind: "add", dependency: { plugin: "audit-kit", kind: "hard" } },
      ],
    }),
  );
  const one = must(await editDependencies({ dir, ops: [{ kind: "remove", plugin: "base-kit" }] }));
  expect(one.dependencies).toEqual([
    { from: "dep-remove", target: "audit-kit", kind: "hard", range: null },
  ]);
  expect(dependsOnOf(dir, 0)).toEqual([{ plugin: "audit-kit", kind: "hard" }]);
  const none = must(
    await editDependencies({ dir, ops: [{ kind: "remove", plugin: "audit-kit" }] }),
  );
  expect(none.dependencies).toEqual([]);
  expect(Object.hasOwn(declOf(dir, 0), "dependsOn")).toBe(false);
});

test("remove of a line that is not there is refused as dependency_not_found, and nothing is written", async () => {
  const dir = await scaffoldFolder("dep-missing");
  must(await editDependencies({ dir, ops: [{ kind: "add", dependency: { plugin: "base-kit" } }] }));
  const before = textOf(dir, ".fresnel-plugin/plugin.json");
  const found = refusal(
    await editDependencies({ dir, ops: [{ kind: "remove", plugin: "nope-kit" }] }),
  );
  expect(found.kind).toBe("invalid_input");
  expect(found.reasons?.map((reason) => [reason.code, reason.field])).toEqual([
    ["dependency_not_found", "plugins/0/dependsOn"],
  ]);
  expect(textOf(dir, ".fresnel-plugin/plugin.json")).toBe(before);
});

test("from names a member: the line belongs to that member, the root keeps its own, and the member's code file stays", async () => {
  const dir = await scaffoldFolder("dep-member");
  must(await editMembers({ dir, ops: [{ kind: "add", id: "sync" }] }));
  const codeBefore = textOf(dir, "src/members/sync.ts");
  const edited = must(
    await editDependencies({
      dir,
      ops: [{ kind: "add", from: "sync", dependency: { plugin: "base-kit", kind: "hard" } }],
    }),
  );
  expect(edited.dependencies).toEqual([
    { from: "dep-member/sync", target: "base-kit", kind: "hard", range: null },
  ]);
  expect(edited.changedFiles).toEqual([".fresnel-plugin/plugin.json"]);
  expect(dependsOnOf(dir, 0)).toBeUndefined();
  expect(dependsOnOf(dir, 1)).toEqual([{ plugin: "base-kit", kind: "hard" }]);
  expect(textOf(dir, "src/members/sync.ts")).toBe(codeBefore);
});

test("a from that is not a declared member is refused as member_not_found, and nothing is written", async () => {
  const dir = await scaffoldFolder("dep-ghost");
  const before = textOf(dir, ".fresnel-plugin/plugin.json");
  const ghost = refusal(
    await editDependencies({
      dir,
      ops: [{ kind: "add", from: "ghost", dependency: { plugin: "base-kit" } }],
    }),
  );
  expect(ghost.kind).toBe("invalid_input");
  expect(ghost.reasons?.map((reason) => reason.code)).toEqual(["member_not_found"]);
  expect(textOf(dir, ".fresnel-plugin/plugin.json")).toBe(before);
});

test("a dependency on the same extension is refused by the manifest check, and the file stays as it was", async () => {
  const dir = await scaffoldFolder("dep-self");
  const before = textOf(dir, ".fresnel-plugin/plugin.json");
  const self = refusal(
    await editDependencies({ dir, ops: [{ kind: "add", dependency: { plugin: "dep-self" } }] }),
  );
  expect(self.kind).toBe("invalid_input");
  expect(self.reasons?.map((reason) => reason.code)).toEqual(["dependency_self"]);
  expect(textOf(dir, ".fresnel-plugin/plugin.json")).toBe(before);
});

test("a range that is not an accepted version range is refused as dependency_range_invalid", async () => {
  const dir = await scaffoldFolder("dep-range");
  const before = textOf(dir, ".fresnel-plugin/plugin.json");
  const range = refusal(
    await editDependencies({
      dir,
      ops: [{ kind: "add", dependency: { plugin: "base-kit", range: "*" } }],
    }),
  );
  expect(range.reasons?.map((reason) => [reason.code, reason.field])).toEqual([
    ["dependency_range_invalid", "plugins/0/dependsOn/0/range"],
  ]);
  expect(textOf(dir, ".fresnel-plugin/plugin.json")).toBe(before);
});

test("when one op fails, the earlier ops of the same call are not written either", async () => {
  const dir = await scaffoldFolder("dep-atomic");
  const before = textOf(dir, ".fresnel-plugin/plugin.json");
  const failed = refusal(
    await editDependencies({
      dir,
      ops: [
        { kind: "add", dependency: { plugin: "base-kit" } },
        { kind: "remove", plugin: "nope-kit" },
      ],
    }),
  );
  expect(failed.reasons?.map((reason) => reason.code)).toEqual(["dependency_not_found"]);
  expect(textOf(dir, ".fresnel-plugin/plugin.json")).toBe(before);
});

test("with no ops nothing is written, and readDependencies gives the same lines", async () => {
  const dir = await scaffoldFolder("dep-read");
  must(
    await editDependencies({
      dir,
      ops: [{ kind: "add", dependency: { plugin: "base-kit", range: "^2.0.0", kind: "hard" } }],
    }),
  );
  const before = textOf(dir, ".fresnel-plugin/plugin.json");
  const read = must(await editDependencies({ dir, ops: [] }));
  expect(read.changedFiles).toEqual([]);
  expect(textOf(dir, ".fresnel-plugin/plugin.json")).toBe(before);
  expect(must(await readDependencies(dir))).toEqual(read.dependencies);
  expect(read.dependencies).toEqual([
    { from: "dep-read", target: "base-kit", kind: "hard", range: "^2.0.0" },
  ]);
});

test("a manifest without plugins gets its root plugin when the op names no member, and a member name is refused there", async () => {
  const dir = await scaffoldFolder("dep-bare");
  // 매니페스트에서 `plugins`를 뺀다. 그러면 뿌리 플러그인은 추론된다
  const bare = Object.fromEntries(Object.entries(rawOf(dir)).filter(([key]) => key !== "plugins"));
  await writeFile(join(dir, ".fresnel-plugin/plugin.json"), `${JSON.stringify(bare, null, 2)}\n`);
  const member = refusal(
    await editDependencies({
      dir,
      ops: [{ kind: "add", from: "sync", dependency: { plugin: "base-kit" } }],
    }),
  );
  expect(member.reasons?.map((reason) => reason.code)).toEqual(["member_not_found"]);
  const added = must(
    await editDependencies({ dir, ops: [{ kind: "add", dependency: { plugin: "base-kit" } }] }),
  );
  expect(added.dependencies).toEqual([
    { from: "dep-bare", target: "base-kit", kind: "soft", range: null },
  ]);
  expect(rawOf(dir)["plugins"]).toEqual([
    { layer: "plugin", hooks: [], dependsOn: [{ plugin: "base-kit" }] },
  ]);
});

test("a relative folder is refused as invalid_input before any file is read", async () => {
  expect(await editDependencies({ dir: "dep-relative", ops: [] })).toEqual({
    ok: false,
    error: { kind: "invalid_input", message: "dir must be an absolute path" },
  });
});

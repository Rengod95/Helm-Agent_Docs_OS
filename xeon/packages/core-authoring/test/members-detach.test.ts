import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson, type Result } from "@fresnel/contracts";
import {
  validateManifest,
  type ExtensionEntry,
  type ExtensionManifest,
  type RegistrationFn,
} from "@fresnel/contracts/extensions";
import type { DevkitError, MembersDetachResult } from "@fresnel/contracts/services";
import { detachMember, editMembers, locateTemplateDirs, scaffoldExtension } from "../src/index.ts";
import { arrayOf } from "../src/errors.ts";
import { isRecord } from "../src/shared.ts";
import type { TemplateDirs } from "../src/templates-dir.ts";

// 구성원 떼기(`detachMember`, AGE-33). 원본 폴더는 바이트 그대로 있어야 하고, 새 폴더에는 검사를 통과한 매니페스트와
// 엔트리가 있어야 한다. 엔트리는 실제로 불러 뿌리 플러그인이 떼어 낸 setup으로 등록되는지 본다.

function templateDirs(): TemplateDirs {
  const found = locateTemplateDirs({}, undefined);
  if (found === null) throw new Error("core-authoring templates are missing");
  return found;
}

const templates = templateDirs();
const root = await mkdtemp(join(tmpdir(), "core-authoring-detach-"));
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const OPTIONS: { readonly templates: TemplateDirs; readonly installedNames: readonly string[] } = {
  templates,
  installedNames: [],
};

function must<T>(result: Result<T, DevkitError>): T {
  if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`);
  return result.value;
}

function refusal<T>(result: Result<T, DevkitError>): DevkitError {
  if (result.ok) throw new Error(`expected a refusal, got ${JSON.stringify(result.value)}`);
  return result.error;
}

/** 시험 원본: 구성원 `sync`(구성 블록이 있다)와 `other`를 가진 플러그인 `pilot`. 코드 파일과 엔트리가 뼈대 그대로다 */
async function sourceFolder(name: string): Promise<string> {
  const dir = join(root, name);
  const made = await scaffoldExtension(
    {
      kind: "single-plugin",
      name,
      dir,
      layer: "L3",
      orchestration: {
        members: ["sync", "other"],
        composition: {
          blocks: [
            {
              id: "sync-on",
              stage: "sync",
              op: "on",
              plugin: "sync",
              hooks: ["boundary.settle.after"],
            },
            { id: "root-on", stage: "root", op: "on", hooks: ["boundary.settle.after"] },
          ],
        },
      },
    },
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

function manifestOf(dir: string): ExtensionManifest {
  const checked = validateManifest(rawOf(dir));
  if (checked.manifest === undefined) throw new Error("manifest does not validate");
  return checked.manifest;
}

/** 폴더 안 파일의 상대 경로. 정렬해 돌려준다 */
function filesOf(dir: string, prefix = ""): string[] {
  return readdirSync(join(dir, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? filesOf(dir, path) : [path];
    })
    .toSorted();
}

/** 폴더의 모든 파일 바이트(base64). 원본이 그대로인지 비교한다 */
function snapshotOf(dir: string): Record<string, string> {
  return Object.fromEntries(
    filesOf(dir).map((path) => [path, readFileSync(join(dir, path)).toString("base64")]),
  );
}

/** 원본 매니페스트를 바꾼다(시험 준비용) */
function editManifest(
  dir: string,
  change: (raw: Record<string, unknown>) => Record<string, unknown>,
): void {
  writeFileSync(
    join(dir, ".fresnel-plugin/plugin.json"),
    `${JSON.stringify(change(rawOf(dir)), null, 2)}\n`,
  );
}

function issuesWith(result: MembersDetachResult, code: string): readonly string[] {
  return result.issues.filter((issue) => issue.code === code).map((issue) => issue.file ?? "");
}

function isEntry(value: unknown): value is ExtensionEntry {
  return typeof value === "function";
}

/** 엔트리를 실제로 불러 등록된 Registration id와 setup을 본다(엔트리는 타입 가져오기만 있어 이 폴더에서 풀린다) */
async function registeredAfterLoad(dir: string): Promise<readonly [string, unknown][]> {
  const manifest = manifestOf(dir);
  const loaded: unknown = await import(join(dir, "src", "index.ts"));
  const entry = isRecord(loaded) ? loaded["default"] : undefined;
  if (!isEntry(entry)) throw new Error("entry has no default function");
  const registered: [string, unknown][] = [];
  const register: RegistrationFn = (id, _options, setup) => {
    registered.push([id, setup]);
    return { id, status: "disabled", enable: () => {}, disable: () => {} };
  };
  await entry({ manifest, register });
  return registered;
}

test("detaching a member makes a one-plugin folder with the new name, the member's declaration and its blocks", async () => {
  const source = await sourceFolder("pilot");
  const frozen = snapshotOf(source);
  const outDir = join(root, "out-sync");
  const detached = must(await detachMember({ dir: source, member: "sync", outDir }, OPTIONS));
  expect(detached.outDir).toBe(outDir);
  expect(detached.name).toBe("pilot-sync");
  expect(detached.profileMove).toEqual({ from: "pilot/sync", to: "pilot-sync" });
  const raw = rawOf(outDir);
  expect(raw["name"]).toBe("pilot-sync");
  expect(raw["schemaVersion"]).toBe(2);
  expect(raw["version"]).toBe("0.1.0");
  expect(raw["plugins"]).toEqual([{ layer: "L3", hooks: ["boundary.settle.after"] }]);
  expect(raw["orchestration"]).toEqual({
    composition: {
      blocks: [{ id: "sync-on", stage: "sync", op: "on", hooks: ["boundary.settle.after"] }],
    },
  });
  expect(manifestOf(outDir).name).toBe("pilot-sync");
  // 원본 폴더는 한 바이트도 바뀌지 않는다
  expect(snapshotOf(source)).toEqual(frozen);
});

test("the member's code goes to src/root.ts and the new entry registers the root with that setup", async () => {
  const source = await sourceFolder("code-wiring");
  const outDir = join(root, "code-wiring-out");
  const detached = must(await detachMember({ dir: source, member: "sync", outDir }, OPTIONS));
  expect(detached.changedFiles.toSorted()).toEqual([
    ".fresnel-plugin/plugin.json",
    "src/index.ts",
    "src/root.ts",
  ]);
  expect(filesOf(outDir)).toEqual([".fresnel-plugin/plugin.json", "src/index.ts", "src/root.ts"]);
  expect(textOf(outDir, "src/root.ts")).toBe(textOf(source, "src/members/sync.ts"));
  expect(rawOf(outDir)["entry"]).toBe("./src/index.ts");
  expect(detached.issues).toEqual([]);
  const registered = await registeredAfterLoad(outDir);
  const moved: unknown = await import(join(outDir, "src", "root.ts"));
  expect(registered.map(([id]) => id)).toEqual(["code-wiring-sync"]);
  expect(registered[0]?.[1]).toBe(isRecord(moved) ? moved["setup"] : undefined);
});

test("keepDependency adds a dependency on the source extension: soft by default, hard when asked, and none without it", async () => {
  const source = await sourceFolder("deps");
  const plain = join(root, "deps-plain");
  must(await detachMember({ dir: source, member: "sync", outDir: plain }, OPTIONS));
  expect(rawOf(plain)["plugins"]).toEqual([{ layer: "L3", hooks: ["boundary.settle.after"] }]);

  const soft = join(root, "deps-soft");
  must(
    await detachMember(
      { dir: source, member: "sync", outDir: soft, name: "sync-kit", keepDependency: true },
      OPTIONS,
    ),
  );
  expect(rawOf(soft)["name"]).toBe("sync-kit");
  expect(rawOf(soft)["plugins"]).toEqual([
    {
      layer: "L3",
      hooks: ["boundary.settle.after"],
      dependsOn: [{ plugin: "deps", kind: "soft" }],
    },
  ]);

  const hard = join(root, "deps-hard");
  must(
    await detachMember(
      { dir: source, member: "sync", outDir: hard, keepDependency: true, dependencyKind: "hard" },
      OPTIONS,
    ),
  );
  expect(rawOf(hard)["plugins"]).toEqual([
    {
      layer: "L3",
      hooks: ["boundary.settle.after"],
      dependsOn: [{ plugin: "deps", kind: "hard" }],
    },
  ]);
});

test("a member that is not in plugins is refused as member_not_found, and the root is not a member", async () => {
  const source = await sourceFolder("missing");
  const outDir = join(root, "missing-out");
  const members = ["nope", "pilot"];
  const failures = await Promise.all(
    members.map((member) => detachMember({ dir: source, member, outDir }, OPTIONS)),
  );
  expect(failures.map((result) => refusal(result))).toEqual(
    members.map((member) => ({
      kind: "invalid_input",
      message: `plugin "${member}" is not a member of this extension`,
      reasons: [
        {
          code: "member_not_found",
          field: "plugins",
          message: `plugin "${member}" is not a member of this extension`,
        },
      ],
    })),
  );
  expect(existsSync(outDir)).toBe(false);
});

test("a folder with no members refuses every detach as member_not_found", async () => {
  const dir = join(root, "lonely");
  const made = await scaffoldExtension(
    { kind: "single-plugin", name: "lonely", dir, layer: "L3" },
    { templates },
  );
  if (!made.ok) throw new Error(made.error.message);
  const outDir = join(root, "lonely-out");
  const failure = refusal(await detachMember({ dir, member: "sync", outDir }, OPTIONS));
  expect((failure.reasons ?? []).map((reason) => reason.code)).toEqual(["member_not_found"]);
  expect(existsSync(outDir)).toBe(false);
  // 뿌리 플러그인 하나만 있고, 원본은 그대로다
  expect(rawOf(dir)["plugins"]).toEqual([{ layer: "L3", hooks: ["boundary.settle.after"] }]);
});

test("a name that is invalid, the source's own, installed, or too long for the default is refused with its reason", async () => {
  const source = await sourceFolder("names");
  const outDir = join(root, "names-out");
  const reasonsOf = async (input: { name?: string }, options = OPTIONS): Promise<string[]> => {
    const failure = refusal(
      await detachMember({ dir: source, member: "sync", outDir, ...input }, options),
    );
    return (failure.reasons ?? []).map((reason) => reason.code);
  };
  expect(await reasonsOf({ name: "Bad_Name" })).toEqual(["name_invalid"]);
  expect(await reasonsOf({ name: "x" })).toEqual(["name_invalid"]);
  expect(await reasonsOf({ name: "names" })).toEqual(["name_conflict"]);
  expect(await reasonsOf({}, { templates, installedNames: ["names-sync"] })).toEqual([
    "name_conflict",
  ]);

  const longSource = await sourceFolder("abcdefghijklmnopqrstuvwxyz0123");
  const longFailure = refusal(
    await detachMember({ dir: longSource, member: "sync", outDir }, OPTIONS),
  );
  expect((longFailure.reasons ?? []).map((reason) => reason.code)).toEqual(["name_invalid"]);
  expect(existsSync(outDir)).toBe(false);
});

test("an outDir that is not empty, or sits inside the source folder, is refused and the files there stay", async () => {
  const source = await sourceFolder("occupied");
  const occupied = join(root, "occupied-out");
  mkdirSync(occupied, { recursive: true });
  writeFileSync(join(occupied, "keep.txt"), "mine\n");
  const failure = refusal(
    await detachMember({ dir: source, member: "sync", outDir: occupied }, OPTIONS),
  );
  expect((failure.reasons ?? []).map((reason) => reason.code)).toEqual(["out_dir_not_empty"]);
  expect(filesOf(occupied)).toEqual(["keep.txt"]);
  expect(textOf(occupied, "keep.txt")).toBe("mine\n");

  const inside = join(source, "copy");
  const nested = refusal(
    await detachMember({ dir: source, member: "sync", outDir: inside }, OPTIONS),
  );
  expect((nested.reasons ?? []).map((reason) => reason.code)).toEqual(["out_dir_inside_source"]);
  expect(existsSync(inside)).toBe(false);
});

test("a result that does not validate writes nothing: the reserved name is refused and outDir stays absent", async () => {
  const source = await sourceFolder("reserved");
  const outDir = join(root, "reserved-out");
  const failure = refusal(
    await detachMember({ dir: source, member: "sync", outDir, name: "core" }, OPTIONS),
  );
  expect(failure.kind).toBe("invalid_input");
  expect((failure.reasons ?? []).map((reason) => reason.code)).toContain("name_reserved");
  expect(existsSync(outDir)).toBe(false);
});

test("a dependency that points at the new name fails the check and leaves outDir empty", async () => {
  const source = await sourceFolder("selfdep");
  editManifest(source, (raw) => ({
    ...raw,
    plugins: arrayOf(raw["plugins"]).map((decl) =>
      isRecord(decl) && decl["id"] === "sync"
        ? Object.assign(decl, { dependsOn: [{ plugin: "selfdep-sync" }] })
        : decl,
    ),
  }));
  const outDir = join(root, "selfdep-out");
  const failure = refusal(await detachMember({ dir: source, member: "sync", outDir }, OPTIONS));
  expect((failure.reasons ?? []).map((reason) => reason.code)).toContain("dependency_self");
  expect(existsSync(outDir)).toBe(false);
});

test("a member file that imports a sibling is copied as it is, the entry is not written, and the wiring is flagged", async () => {
  const source = await sourceFolder("sibling");
  const code =
    'import { tag } from "./tag.ts";\n\nexport function setup(_g: unknown): void {\n  void tag;\n}\n';
  writeFileSync(join(source, "src/members/sync.ts"), code);
  const outDir = join(root, "sibling-out");
  const detached = must(await detachMember({ dir: source, member: "sync", outDir }, OPTIONS));
  expect(detached.changedFiles.toSorted()).toEqual([
    ".fresnel-plugin/plugin.json",
    "src/members/sync.ts",
  ]);
  expect(filesOf(outDir)).toEqual([".fresnel-plugin/plugin.json", "src/members/sync.ts"]);
  expect(textOf(outDir, "src/members/sync.ts")).toBe(code);
  expect(rawOf(outDir)["entry"]).toBeUndefined();
  expect(issuesWith(detached, "detach_code_needs_wiring")).toEqual(["src/members/sync.ts"]);
});

test("an entry that is not the scaffold shape, or no template to compare with, also copies the code and flags it", async () => {
  const source = await sourceFolder("custom-entry");
  writeFileSync(join(source, "src/index.ts"), "export default () => {};\n");
  const outDir = join(root, "custom-entry-out");
  const detached = must(await detachMember({ dir: source, member: "sync", outDir }, OPTIONS));
  expect(detached.changedFiles).toContain("src/members/sync.ts");
  expect(detached.changedFiles).not.toContain("src/root.ts");
  expect(issuesWith(detached, "detach_code_needs_wiring")).toEqual(["src/members/sync.ts"]);

  const scaffolded = await sourceFolder("no-templates");
  const bare = join(root, "no-templates-out");
  const noTemplates = must(
    await detachMember(
      { dir: scaffolded, member: "sync", outDir: bare },
      { templates: null, installedNames: [] },
    ),
  );
  expect(noTemplates.changedFiles).toContain("src/members/sync.ts");
  expect(issuesWith(noTemplates, "detach_code_needs_wiring")).toEqual(["src/members/sync.ts"]);
});

test("shared fields the member does not own are reported as info and not copied", async () => {
  const source = await sourceFolder("shared");
  editManifest(source, (raw) => ({
    ...raw,
    userConfig: { key: { setting: "ext.shared.key", title: "Key" } },
  }));
  const outDir = join(root, "shared-out");
  const detached = must(await detachMember({ dir: source, member: "sync", outDir }, OPTIONS));
  const shared = detached.issues.filter((issue) => issue.code === "detach_shared_files_not_copied");
  expect(shared.map((issue) => issue.severity)).toEqual(["info"]);
  expect(shared[0]?.message).toContain("userConfig");
  expect(rawOf(outDir)["userConfig"]).toBeUndefined();
});

test("an outDir in folders that do not exist yet is created, and an empty existing outDir is used", async () => {
  const source = await sourceFolder("nested");
  const nested = join(root, "made", "deeper", "out");
  const detached = must(
    await detachMember({ dir: source, member: "sync", outDir: nested }, OPTIONS),
  );
  expect(filesOf(nested)).toEqual([".fresnel-plugin/plugin.json", "src/index.ts", "src/root.ts"]);
  expect(detached.outDir).toBe(nested);

  const empty = join(root, "empty-out");
  mkdirSync(empty);
  must(await detachMember({ dir: source, member: "sync", outDir: empty }, OPTIONS));
  expect(filesOf(empty)).toEqual([".fresnel-plugin/plugin.json", "src/index.ts", "src/root.ts"]);
});

test("a drive member detaches with drives true and an empty hook list", async () => {
  const source = await sourceFolder("agree");
  const edited = must(
    await editMembers({ dir: source, ops: [{ kind: "add", id: "drive-one", mode: "drive" }] }),
  );
  expect(edited.members.map((member) => member.id)).toContain("drive-one");
  const outDir = join(root, "agree-out");
  must(await detachMember({ dir: source, member: "drive-one", outDir }, OPTIONS));
  expect(rawOf(outDir)["plugins"]).toEqual([{ layer: "L3", hooks: [], drives: true }]);
});

test("a relative dir or outDir is refused before anything is read or written", async () => {
  const source = await sourceFolder("relative");
  expect(
    refusal(
      await detachMember({ dir: "relative", member: "sync", outDir: join(root, "r") }, OPTIONS),
    ),
  ).toEqual({
    kind: "invalid_input",
    message: "dir must be an absolute path",
  });
  expect(
    refusal(await detachMember({ dir: source, member: "sync", outDir: "out" }, OPTIONS)),
  ).toEqual({
    kind: "invalid_input",
    message: "outDir must be an absolute path",
  });
  expect(existsSync(join(root, "r"))).toBe(false);
});

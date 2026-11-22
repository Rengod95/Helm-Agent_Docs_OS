import { afterAll, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseJson, type Result } from "@fresnel/contracts";
import {
  pluginsOf,
  validateManifest,
  type ExtensionEntry,
  type ExtensionManifest,
  type RegistrationFn,
} from "@fresnel/contracts/extensions";
import type {
  DevkitError,
  MemberOp,
  MembersEditResult,
  ScaffoldInput,
} from "@fresnel/contracts/services";
import {
  editMembers,
  locateTemplateDirs,
  scaffoldExtension,
  validateExtensionDir,
} from "../src/index.ts";
import { arrayOf } from "../src/errors.ts";
import type { TemplateDirs } from "../src/templates-dir.ts";
import { isRecord } from "../src/shared.ts";

// 구성원 편집(`editMembers`)과 생성 파일 배선. 시험 폴더는 이 패키지 안에 만들어야 엔트리가 `@fresnel/contracts`를 풀 수 있다.
// 시험이 끝나면 지운다.

function templateDirs(): TemplateDirs {
  const found = locateTemplateDirs({}, undefined);
  if (found === null) throw new Error("core-authoring templates are missing");
  return found;
}

const templates = templateDirs();
const root = await mkdtemp(join(import.meta.dir, ".tmp-members-"));
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

function manifestOf(dir: string): ExtensionManifest {
  const checked = validateManifest(rawOf(dir));
  if (checked.manifest === undefined) throw new Error("manifest does not validate");
  return checked.manifest;
}

/** 루트는 `(root)`, 구성원은 id로 적은 plugins[] 순서 */
function orderOf(dir: string): string[] {
  return arrayOf(rawOf(dir)["plugins"]).map((decl) => {
    const id = isRecord(decl) ? decl["id"] : undefined;
    return typeof id === "string" ? id : "(root)";
  });
}

/** 엔트리 모듈의 기본 내보내기가 함수인지 본다. 함수라는 것만 확인하고 호출 형식은 엔트리 계약(F.extensions.spec)이 정한다 */
function isEntry(value: unknown): value is ExtensionEntry {
  return typeof value === "function";
}

/**
 * 엔트리를 실제로 불러 등록을 본다. 로더의 `unregistered`(호스트가 매니페스트 `pluginsOf`에서 등록되지 않은 것을 고른다)와
 * 같은 규칙으로 `plugin_not_registered` 대상을 센다. 엔트리 모듈은 이 패키지 폴더 안이라 `@fresnel/contracts`가 풀린다.
 */
async function unregisteredAfterLoad(dir: string): Promise<{
  readonly registered: readonly string[];
  readonly unregistered: readonly string[];
}> {
  const manifest = manifestOf(dir);
  const loaded: unknown = await import(join(dir, "src", "index.ts"));
  const entry = isRecord(loaded) ? loaded["default"] : undefined;
  if (!isEntry(entry)) throw new Error("entry has no default function");
  const registered: string[] = [];
  const register: RegistrationFn = (id) => {
    registered.push(id);
    return { id, status: "disabled", enable: () => {}, disable: () => {} };
  };
  await entry({ manifest, register });
  const unregistered = pluginsOf(manifest)
    .map((plugin) => plugin.registrationId)
    .filter((id) => !registered.includes(id));
  return { registered, unregistered };
}

/** `m0`, `m1`, … 이름의 추가 편집 `count`개 */
function addsOf(count: number): MemberOp[] {
  return Array.from({ length: count }, (_, index): MemberOp => ({ kind: "add", id: `m${index}` }));
}

function issuesWith(result: MembersEditResult, code: string): readonly string[] {
  return result.issues.filter((issue) => issue.code === code).map((issue) => issue.message);
}

test("editMembers add: hook, inject and drive members take the fields of their mode", async () => {
  const dir = await scaffoldFolder("add-modes", { layer: "L3" });
  const edited = must(
    await editMembers({
      dir,
      ops: [
        { kind: "add", id: "alpha", title: "Alpha" },
        { kind: "add", id: "beta", mode: "inject" },
        { kind: "add", id: "gamma", mode: "drive" },
      ],
    }),
  );
  expect(
    edited.members.map((member) => ({
      id: member.id,
      registrationId: member.registrationId,
      title: member.title,
      layer: member.layer,
      hooks: member.hooks,
      drives: member.drives,
      defaultEnabled: member.defaultEnabled,
      blockIds: member.blockIds,
    })),
  ).toEqual([
    {
      id: "alpha",
      registrationId: "add-modes/alpha",
      title: "Alpha",
      layer: "L3",
      hooks: ["boundary.settle.after"],
      drives: false,
      defaultEnabled: false,
      blockIds: [],
    },
    {
      id: "beta",
      registrationId: "add-modes/beta",
      title: null,
      layer: "L3",
      hooks: [],
      drives: false,
      defaultEnabled: false,
      blockIds: [],
    },
    {
      id: "gamma",
      registrationId: "add-modes/gamma",
      title: null,
      layer: "L3",
      hooks: [],
      drives: true,
      defaultEnabled: false,
      blockIds: [],
    },
  ]);
  // 구성원이 붙어도 orchestration.members는 만들지 않는다: 목록이 없으면 모든 플러그인이 구성원이다
  expect(rawOf(dir)["orchestration"]).toEqual({});
  expect(existsSync(join(dir, "src/members/alpha.ts"))).toBe(true);
  expect(existsSync(join(dir, "src/members/beta.ts"))).toBe(false);
  expect(existsSync(join(dir, "src/members/gamma.ts"))).toBe(true);
  expect(edited.entryWiring).toBe("generated");
  expect(edited.issues).toEqual([]);
  expect(edited.changedFiles.toSorted()).toEqual(
    [
      ".fresnel-plugin/plugin.json",
      "src/members.generated.ts",
      "src/members/alpha.ts",
      "src/members/gamma.ts",
    ].toSorted(),
  );
  expect(textOf(dir, "src/members.generated.ts")).toContain('"alpha": setupOf0');
  // 코드가 없는 구성원(inject)도 엔트리가 빈 setup으로 등록하므로 plugin_not_registered가 나지 않는다
  expect(await unregisteredAfterLoad(dir)).toEqual({
    registered: ["add-modes", "add-modes/alpha", "add-modes/beta", "add-modes/gamma"],
    unregistered: [],
  });
});

test("editMembers add: a drive member needs layer L3, and a member cannot mix external and internal layers", async () => {
  const dir = await scaffoldFolder("drive-plain");
  const before = textOf(dir, ".fresnel-plugin/plugin.json");
  const drive = refusal(
    await editMembers({ dir, ops: [{ kind: "add", id: "gamma", mode: "drive" }] }),
  );
  expect(drive.kind).toBe("invalid_input");
  expect(drive.message).toContain("L3");
  const mixed = refusal(
    await editMembers({ dir, ops: [{ kind: "add", id: "delta", layer: "L3" }] }),
  );
  expect(mixed.kind).toBe("invalid_input");
  expect(mixed.message).toContain("cannot be mixed");
  expect(textOf(dir, ".fresnel-plugin/plugin.json")).toBe(before);
  expect(existsSync(join(dir, "src/members"))).toBe(false);
});

test("editMembers rename: the code file moves and the block, orchestration.members and plugins[] follow", async () => {
  const dir = await scaffoldFolder("rename-refs", {
    layer: "L3",
    orchestration: {
      members: ["alpha"],
      composition: {
        blocks: [
          {
            id: "settle",
            stage: "settle",
            op: "on",
            plugin: "alpha",
            hooks: ["boundary.settle.after"],
          },
        ],
      },
    },
  });
  expect(existsSync(join(dir, "src/members/alpha.ts"))).toBe(true);
  const renamed = must(
    await editMembers({ dir, ops: [{ kind: "rename", id: "alpha", to: "omega" }] }),
  );
  expect(renamed.members.map((member) => member.id)).toEqual(["omega"]);
  expect(renamed.members[0]?.blockIds).toEqual(["settle"]);
  expect(renamed.members[0]?.registrationId).toBe("rename-refs/omega");
  expect(rawOf(dir)["orchestration"]).toEqual({
    composition: {
      blocks: [
        {
          id: "settle",
          stage: "settle",
          op: "on",
          plugin: "omega",
          hooks: ["boundary.settle.after"],
        },
      ],
    },
    members: ["omega"],
  });
  expect(existsSync(join(dir, "src/members/alpha.ts"))).toBe(false);
  expect(existsSync(join(dir, "src/members/omega.ts"))).toBe(true);
  expect(renamed.changedFiles).toContain("src/members/omega.ts");
  expect(renamed.changedFiles).toContain("src/members/alpha.ts");
  expect(await unregisteredAfterLoad(dir)).toEqual({
    registered: ["rename-refs", "rename-refs/omega"],
    unregistered: [],
  });

  const taken = refusal(
    await editMembers({
      dir,
      ops: [
        { kind: "add", id: "other" },
        { kind: "rename", id: "omega", to: "other" },
      ],
    }),
  );
  expect(taken.message).toContain('"other" already exists');
  expect(existsSync(join(dir, "src/members/other.ts"))).toBe(false);
});

test("editMembers rename: a code file already at the new id blocks the rename, and nothing moves", async () => {
  const dir = await scaffoldFolder("rename-stale", {
    layer: "L3",
    orchestration: { members: ["p1"] },
  });
  await writeFile(join(dir, "src/members/p2.ts"), "// 남은 코드\n");
  const refused = refusal(
    await editMembers({ dir, ops: [{ kind: "rename", id: "p1", to: "p2" }] }),
  );
  expect(refused.kind).toBe("invalid_input");
  expect(refused.message).toContain("src/members/p2.ts already exists");
  expect(existsSync(join(dir, "src/members/p1.ts"))).toBe(true);
  expect(textOf(dir, "src/members/p2.ts")).toBe("// 남은 코드\n");
});

test("editMembers add: an existing code file is never overwritten by the stub", async () => {
  const dir = await scaffoldFolder("keep-stub", {
    layer: "L3",
    orchestration: { members: ["p1"] },
  });
  await writeFile(join(dir, "src/members/p1.ts"), "// 직접 쓴 코드\n");
  must(await editMembers({ dir, ops: [{ kind: "remove", id: "p1" }] }));
  must(await editMembers({ dir, ops: [{ kind: "add", id: "p1" }] }));
  expect(textOf(dir, "src/members/p1.ts")).toBe("// 직접 쓴 코드\n");
});

test("editMembers remove: a member used by a block is refused, and the message names the block", async () => {
  const dir = await scaffoldFolder("remove-blocked", {
    layer: "L3",
    orchestration: {
      members: ["alpha"],
      composition: {
        blocks: [
          {
            id: "settle",
            stage: "settle",
            op: "on",
            plugin: "alpha",
            hooks: ["boundary.settle.after"],
          },
        ],
      },
    },
  });
  const before = textOf(dir, ".fresnel-plugin/plugin.json");
  const refused = refusal(await editMembers({ dir, ops: [{ kind: "remove", id: "alpha" }] }));
  expect(refused.kind).toBe("invalid_input");
  expect(refused.message).toContain("settle");
  expect(textOf(dir, ".fresnel-plugin/plugin.json")).toBe(before);
  expect(existsSync(join(dir, "src/members/alpha.ts"))).toBe(true);
});

test("editMembers remove: the code file is kept and reported as member_file_kept, and the root cannot be removed", async () => {
  const dir = await scaffoldFolder("remove-kept", {
    layer: "L3",
    orchestration: { members: ["alpha", "beta"] },
  });
  const removed = must(await editMembers({ dir, ops: [{ kind: "remove", id: "alpha" }] }));
  expect(removed.members.map((member) => member.id)).toEqual(["beta"]);
  expect(existsSync(join(dir, "src/members/alpha.ts"))).toBe(true);
  expect(removed.issues).toEqual([
    {
      severity: "info",
      code: "member_file_kept",
      path: "",
      file: "src/members/alpha.ts",
      message: "src/members/alpha.ts was kept; delete it by hand if the code is no longer needed",
    },
  ]);
  expect(rawOf(dir)["orchestration"]).toEqual({ members: ["beta"] });
  expect(textOf(dir, "src/members.generated.ts")).not.toContain('"alpha"');
  expect(removed.changedFiles).not.toContain("src/members/alpha.ts");

  const root = refusal(await editMembers({ dir, ops: [{ kind: "remove", id: "remove-kept" }] }));
  expect(root.kind).toBe("invalid_input");
  expect(root.message).toContain("root plugin");
});

test("editMembers remove: removing the last member drops orchestration.members, and orchestration when no composition is left", async () => {
  const dir = await scaffoldFolder("remove-last", {
    layer: "L3",
    orchestration: { members: ["alpha"] },
  });
  const removed = must(await editMembers({ dir, ops: [{ kind: "remove", id: "alpha" }] }));
  expect(removed.members).toEqual([]);
  expect(rawOf(dir)).not.toHaveProperty("orchestration");
});

test("editMembers move: the order of members follows toIndex and the root keeps its place", async () => {
  const dir = await scaffoldFolder("move-order", {
    layer: "L3",
    orchestration: { members: ["a1", "b1", "c1"] },
  });
  expect(orderOf(dir)).toEqual(["(root)", "a1", "b1", "c1"]);
  const first = must(await editMembers({ dir, ops: [{ kind: "move", id: "c1", toIndex: 0 }] }));
  expect(first.members.map((member) => member.id)).toEqual(["c1", "a1", "b1"]);
  expect(orderOf(dir)).toEqual(["(root)", "c1", "a1", "b1"]);
  const second = must(await editMembers({ dir, ops: [{ kind: "move", id: "a1", toIndex: 2 }] }));
  expect(second.members.map((member) => member.id)).toEqual(["c1", "b1", "a1"]);
  expect(orderOf(dir)).toEqual(["(root)", "c1", "b1", "a1"]);
  const outside = refusal(
    await editMembers({ dir, ops: [{ kind: "move", id: "b1", toIndex: 3 }] }),
  );
  expect(outside.message).toContain("out of range 0..2");
  expect(orderOf(dir)).toEqual(["(root)", "c1", "b1", "a1"]);
  // 등록 순서는 plugins[] 순서다: 엔트리가 이 순서로 register한다
  const loaded = await unregisteredAfterLoad(dir);
  expect(loaded.registered).toEqual([
    "move-order",
    "move-order/c1",
    "move-order/b1",
    "move-order/a1",
  ]);
});

test("editMembers cap: sixteen entries in plugins[] (the root included) is the most, and the next member is refused", async () => {
  const dir = await scaffoldFolder("capacity", { layer: "L3" });
  const before = textOf(dir, ".fresnel-plugin/plugin.json");
  const tooMany = refusal(await editMembers({ dir, ops: addsOf(16) }));
  expect(tooMany.kind).toBe("invalid_input");
  expect(tooMany.message).toContain("at most 16");
  expect(textOf(dir, ".fresnel-plugin/plugin.json")).toBe(before);
  expect(existsSync(join(dir, "src/members"))).toBe(false);

  const fifteen = must(await editMembers({ dir, ops: addsOf(15) }));
  expect(fifteen.members).toHaveLength(15);
  expect(orderOf(dir)).toHaveLength(16);
  const next = refusal(await editMembers({ dir, ops: [{ kind: "add", id: "extra" }] }));
  expect(next.message).toContain("at most 16");
});

test("editMembers: when one operation fails, no file changes, including the earlier operations of the same call", async () => {
  const dir = await scaffoldFolder("all-or-nothing", { layer: "L3" });
  const manifestBefore = textOf(dir, ".fresnel-plugin/plugin.json");
  const failed = refusal(
    await editMembers({
      dir,
      ops: [
        { kind: "add", id: "d1" },
        { kind: "rename", id: "missing", to: "x1" },
      ],
    }),
  );
  expect(failed.kind).toBe("not_found");
  expect(textOf(dir, ".fresnel-plugin/plugin.json")).toBe(manifestBefore);
  expect(existsSync(join(dir, "src/members/d1.ts"))).toBe(false);
  expect(existsSync(join(dir, "src/members.generated.ts"))).toBe(true);
  expect(textOf(dir, "src/members.generated.ts")).not.toContain("d1");
});

test("editMembers refuses unsafe ids and relative folders before any file is written", async () => {
  const dir = await scaffoldFolder("unsafe-ids", { layer: "L3" });
  const manifestBefore = textOf(dir, ".fresnel-plugin/plugin.json");
  const escape = refusal(await editMembers({ dir, ops: [{ kind: "add", id: "../evil" }] }));
  expect(escape.kind).toBe("invalid_input");
  expect(existsSync(join(root, "evil.ts"))).toBe(false);
  expect(existsSync(join(dir, "evil.ts"))).toBe(false);
  const bad = refusal(await editMembers({ dir, ops: [{ kind: "add", id: "Bad_Name" }] }));
  expect(bad.message).toContain("not valid");
  expect(textOf(dir, ".fresnel-plugin/plugin.json")).toBe(manifestBefore);

  const relative = refusal(await editMembers({ dir: "rel/dir", ops: [] }));
  expect(relative.message).toBe("dir must be an absolute path");
  const missing = refusal(await editMembers({ dir: join(root, "no-such-folder"), ops: [] }));
  expect(missing.kind).toBe("not_found");
});

test("editMembers: an entry that does not import the generated file gets entryWiring manual and the warning", async () => {
  const dir = await scaffoldFolder("legacy-entry");
  await writeFile(
    join(dir, "src/index.ts"),
    [
      'import type { ExtensionEntry } from "@fresnel/contracts/extensions";',
      "const entry: ExtensionEntry = ({ manifest, register }) => {",
      "  register(manifest.name, {}, () => {});",
      "};",
      "export default entry;",
      "",
    ].join("\n"),
  );
  const edited = must(await editMembers({ dir, ops: [{ kind: "add", id: "alpha" }] }));
  expect(edited.entryWiring).toBe("manual");
  expect(issuesWith(edited, "entry_wiring_manual")).toEqual([
    "src/index.ts가 구성원을 등록하는지 직접 확인",
  ]);
  expect(existsSync(join(dir, "src/members/alpha.ts"))).toBe(true);
  expect(existsSync(join(dir, "src/members.generated.ts"))).toBe(true);
});

test("scaffold with members loads without plugin_not_registered, and so does the folder after more edits", async () => {
  const dir = await scaffoldFolder("scaffold-members", {
    layer: "L3",
    orchestration: { members: ["alpha", "beta"] },
  });
  expect(rawOf(dir)["orchestration"]).toEqual({ members: ["alpha", "beta"] });
  expect(orderOf(dir)).toEqual(["(root)", "alpha", "beta"]);
  expect(manifestOf(dir).plugins?.[1]?.layer).toBe("L3");
  expect(await unregisteredAfterLoad(dir)).toEqual({
    registered: ["scaffold-members", "scaffold-members/alpha", "scaffold-members/beta"],
    unregistered: [],
  });
  const checked = await validateExtensionDir(dir);
  if (!checked.ok) throw new Error(checked.error.message);
  expect(checked.value.issues.filter((issue) => issue.severity !== "info")).toEqual([]);

  const edited = must(
    await editMembers({
      dir,
      ops: [
        { kind: "add", id: "gamma", mode: "drive" },
        { kind: "move", id: "beta", toIndex: 0 },
      ],
    }),
  );
  expect(edited.members.map((member) => member.id)).toEqual(["beta", "alpha", "gamma"]);
  expect(await unregisteredAfterLoad(dir)).toEqual({
    registered: [
      "scaffold-members",
      "scaffold-members/beta",
      "scaffold-members/alpha",
      "scaffold-members/gamma",
    ],
    unregistered: [],
  });
});

test("scaffold: a folder without members still gets the generated file that its entry imports", async () => {
  const dir = await scaffoldFolder("plain-entry");
  expect(textOf(dir, "src/members.generated.ts")).toBe(
    [
      "// 생성 파일: 직접 고치지 않는다",
      'import type { RegistrationApi } from "@fresnel/contracts/extensions";',
      "",
      "export const memberSetups: Readonly<Record<string, (g: RegistrationApi<unknown>) => void | Promise<void>>> = {};",
      "",
    ].join("\n"),
  );
  expect(await unregisteredAfterLoad(dir)).toEqual({
    registered: ["plain-entry"],
    unregistered: [],
  });
});

test("scaffold: a member id that is not a plugin id is refused before the folder is written", async () => {
  const dir = join(root, "scaffold-bad-member");
  const made = await scaffoldExtension(
    {
      kind: "single-plugin",
      name: "scaffold-bad-member",
      dir,
      orchestration: { members: ["Bad"] },
    },
    { templates },
  );
  expect(made.ok).toBe(false);
  expect(existsSync(dir)).toBe(false);
});

test("editMembers: with no ops nothing is written, and a repeated move gives the same members", async () => {
  const dir = await scaffoldFolder("order-check", {
    layer: "L3",
    orchestration: { members: ["x1", "y1"] },
  });
  const before = must(await editMembers({ dir, ops: [] }));
  expect(before.changedFiles).toEqual([]);
  expect(before.members.map((member) => member.id)).toEqual(["x1", "y1"]);
  const once = must(await editMembers({ dir, ops: [{ kind: "move", id: "y1", toIndex: 0 }] }));
  const again = must(await editMembers({ dir, ops: [{ kind: "move", id: "y1", toIndex: 0 }] }));
  expect(again.members).toEqual(once.members);
});

test("the generated file of a folder with members lists only the members that have a code file", async () => {
  const dir = await scaffoldFolder("coded-only", {
    layer: "L3",
    orchestration: { members: ["p1"] },
  });
  const added = must(await editMembers({ dir, ops: [{ kind: "add", id: "q1", mode: "inject" }] }));
  expect(added.members.map((member) => member.id)).toEqual(["p1", "q1"]);
  expect(textOf(dir, "src/members.generated.ts")).toContain('"p1": setupOf0');
  expect(textOf(dir, "src/members.generated.ts")).not.toContain("q1");
});

test("the members result carries the decl fields that the authoring screen reads", async () => {
  const dir = await scaffoldFolder("fields", { layer: "L3", orchestration: { members: ["s1"] } });
  const result = must(await editMembers({ dir, ops: [] }));
  const member = result.members[0];
  expect(member).toEqual({
    id: "s1",
    registrationId: "fields/s1",
    title: null,
    layer: "L3",
    hooks: ["boundary.settle.after"],
    drives: false,
    defaultEnabled: false,
    blockIds: [],
  });
});

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson, type Result } from "@fresnel/contracts";
import { validateManifest, type ExtensionLayer } from "@fresnel/contracts/extensions";
import type { DevkitError, MembersMergeResult } from "@fresnel/contracts/services";
import { editMembers, locateTemplateDirs, mergeMembers, scaffoldExtension } from "../src/index.ts";
import { arrayOf } from "../src/errors.ts";
import { isRecord } from "../src/shared.ts";
import type { TemplateDirs } from "../src/templates-dir.ts";

// 구성원 합치기(`mergeMembers`, AGE-33). 독립 플러그인 폴더 둘 이상을 한 플러그인의 구성원으로 묶은 새 폴더를 쓴다.
// 합치는 것은 매니페스트와 선언뿐이다: 코드 파일과 공용 항목은 옮기지 않고 issues로 알린다. 원본 폴더는 바이트 그대로 있어야 한다.

function templateDirs(): TemplateDirs {
  const found = locateTemplateDirs({}, undefined);
  if (found === null) throw new Error("core-authoring templates are missing");
  return found;
}

const templates = templateDirs();
const root = await mkdtemp(join(tmpdir(), "core-authoring-merge-"));
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const OPTIONS = { installedNames: [] };

function must<T>(result: Result<T, DevkitError>): T {
  if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`);
  return result.value;
}

function refusal<T>(result: Result<T, DevkitError>): DevkitError {
  if (result.ok) throw new Error(`expected a refusal, got ${JSON.stringify(result.value)}`);
  return result.error;
}

/** 시험 원본 폴더 하나. 뼈대 템플릿으로 만든 독립 플러그인이다(`plugins` 선언 하나, 엔트리 있음, `defaultEnabled` false) */
async function sourceOf(
  tag: string,
  name: string,
  layer: ExtensionLayer = "plugin",
): Promise<string> {
  const dir = join(root, tag, name);
  const made = await scaffoldExtension({ kind: "single-plugin", name, dir, layer }, { templates });
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

/** 원본의 유일한 플러그인 선언에 키를 더한다(시험 준비용) */
function editDecl(dir: string, patch: Record<string, unknown>): void {
  editManifest(dir, (raw) => ({
    ...raw,
    plugins: arrayOf(raw["plugins"]).map((decl) =>
      isRecord(decl) ? Object.assign({}, decl, patch) : decl,
    ),
  }));
}

/** 사유 목록을 코드와 `field`의 짝으로 줄인다 */
function reasonsOf(error: DevkitError): { code: string; field: string | undefined }[] {
  return (error.reasons ?? []).map((reason) => ({ code: reason.code, field: reason.field }));
}

/** 두 원본을 합친다. 시험마다 다른 `tag` 폴더 안에 둔다 */
async function mergePair(
  tag: string,
  names: readonly string[] = ["alpha", "beta"],
): Promise<Result<MembersMergeResult, DevkitError>> {
  const dirs = await Promise.all(names.map((name) => sourceOf(tag, name)));
  return mergeMembers(
    { dirs, outDir: join(root, tag, "out"), name: "pair", title: "Pair" },
    OPTIONS,
  );
}

test("two folders merge into one manifest: a root with the title, one member per folder named by its folder, and the member list", async () => {
  const merged = must(await mergePair("two"));
  const outDir = join(root, "two", "out");
  expect(merged.outDir).toBe(outDir);
  expect(merged.name).toBe("pair");
  expect(merged.changedFiles).toEqual([".fresnel-plugin/plugin.json"]);
  expect(merged.profileMove).toEqual([
    { from: "alpha", to: "pair/alpha" },
    { from: "beta", to: "pair/beta" },
  ]);
  expect(merged.members).toEqual([
    {
      id: "alpha",
      registrationId: "pair/alpha",
      title: null,
      layer: "plugin",
      hooks: ["boundary.settle.after"],
      drives: false,
      defaultEnabled: false,
      blockIds: [],
      injects: [],
      tools: [],
    },
    {
      id: "beta",
      registrationId: "pair/beta",
      title: null,
      layer: "plugin",
      hooks: ["boundary.settle.after"],
      drives: false,
      defaultEnabled: false,
      blockIds: [],
      injects: [],
      tools: [],
    },
  ]);
  expect(rawOf(outDir)).toEqual({
    schemaVersion: 2,
    name: "pair",
    version: "0.1.0",
    plugins: [
      { layer: "plugin", hooks: [], title: "Pair" },
      { id: "alpha", layer: "plugin", hooks: ["boundary.settle.after"], defaultEnabled: false },
      { id: "beta", layer: "plugin", hooks: ["boundary.settle.after"], defaultEnabled: false },
    ],
    orchestration: { members: ["alpha", "beta"] },
  });
  expect(validateManifest(rawOf(outDir)).manifest?.name).toBe("pair");
  // 코드는 옮기지 않으므로 폴더에는 매니페스트 하나만 있다
  expect(filesOf(outDir)).toEqual([".fresnel-plugin/plugin.json"]);
});

test("three folders keep their order in plugins and orchestration, and the title is optional", async () => {
  const dirs = [
    await sourceOf("three", "alpha"),
    await sourceOf("three", "beta"),
    await sourceOf("three", "gamma"),
  ];
  const outDir = join(root, "three", "out");
  const merged = must(await mergeMembers({ dirs, outDir, name: "trio" }, OPTIONS));
  expect(merged.members.map((member) => member.registrationId)).toEqual([
    "trio/alpha",
    "trio/beta",
    "trio/gamma",
  ]);
  const raw = rawOf(outDir);
  expect(arrayOf(raw["plugins"]).map((decl) => (isRecord(decl) ? decl["id"] : undefined))).toEqual([
    undefined,
    "alpha",
    "beta",
    "gamma",
  ]);
  expect(raw["orchestration"]).toEqual({ members: ["alpha", "beta", "gamma"] });
  expect(arrayOf(raw["plugins"])[0]).toEqual({ layer: "plugin", hooks: [] });
});

test("the source folders keep every byte, and the output is the only folder written", async () => {
  const dirs = [await sourceOf("frozen", "alpha"), await sourceOf("frozen", "beta")];
  const frozen = dirs.map((dir) => snapshotOf(dir));
  const outDir = join(root, "frozen", "out");
  must(await mergeMembers({ dirs, outDir, name: "frozen-pair" }, OPTIONS));
  expect(dirs.map((dir) => snapshotOf(dir))).toEqual(frozen);
  expect(filesOf(outDir)).toEqual([".fresnel-plugin/plugin.json"]);
});

test("a folder's defaultEnabled false keeps its member off, and true starts it on", async () => {
  const alpha = await sourceOf("defaults", "alpha");
  const beta = await sourceOf("defaults", "beta");
  editManifest(beta, (raw) => ({ ...raw, defaultEnabled: true }));
  const outDir = join(root, "defaults", "out");
  const merged = must(await mergeMembers({ dirs: [alpha, beta], outDir, name: "pair" }, OPTIONS));
  expect(merged.members.map((member) => member.defaultEnabled)).toEqual([false, true]);
  expect(rawOf(outDir)["plugins"]).toEqual([
    { layer: "plugin", hooks: [] },
    { id: "alpha", layer: "plugin", hooks: ["boundary.settle.after"], defaultEnabled: false },
    { id: "beta", layer: "plugin", hooks: ["boundary.settle.after"], defaultEnabled: true },
  ]);
});

test("a folder without defaultEnabled starts its member on, the way its own plugin started", async () => {
  const alpha = await sourceOf("on-default", "alpha");
  const beta = await sourceOf("on-default", "beta");
  editManifest(alpha, (raw) =>
    Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "defaultEnabled")),
  );
  editManifest(beta, (raw) =>
    Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "defaultEnabled")),
  );
  const outDir = join(root, "on-default", "out");
  const merged = must(await mergeMembers({ dirs: [alpha, beta], outDir, name: "pair" }, OPTIONS));
  expect(merged.members.map((member) => member.defaultEnabled)).toEqual([true, true]);
  expect(arrayOf(rawOf(outDir)["plugins"])[1]).toEqual({
    id: "alpha",
    layer: "plugin",
    hooks: ["boundary.settle.after"],
    defaultEnabled: true,
  });
});

test("a plugin's own defaultEnabled decides its member, and a plugin with its own id starts off as it did alone", async () => {
  const alpha = await sourceOf("own-default", "alpha");
  const beta = await sourceOf("own-default", "beta");
  editDecl(alpha, { defaultEnabled: false });
  editManifest(beta, (raw) => ({
    ...Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "defaultEnabled")),
    plugins: [{ layer: "plugin", hooks: ["boundary.settle.after"], defaultEnabled: true }],
  }));
  const outDir = join(root, "own-default", "out");
  const merged = must(await mergeMembers({ dirs: [alpha, beta], outDir, name: "pair" }, OPTIONS));
  expect(merged.members.map((member) => member.defaultEnabled)).toEqual([false, true]);
  // 선언에 id가 있는 플러그인은 떼어 놓으면 기본으로 꺼져 있었다. 합쳐도 그대로 꺼진다
  const own = await sourceOf("own-id-off", "alpha");
  const other = await sourceOf("own-id-off", "beta");
  editDecl(own, { id: "kit" });
  editManifest(own, (raw) =>
    Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "defaultEnabled")),
  );
  editManifest(other, (raw) =>
    Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "defaultEnabled")),
  );
  const kitOut = join(root, "own-id-off", "out");
  const kit = must(
    await mergeMembers({ dirs: [own, other], outDir: kitOut, name: "pair" }, OPTIONS),
  );
  expect(kit.members.map((member) => member.defaultEnabled)).toEqual([false, true]);
});

test("a folder whose only declaration has its own id is moved from that registration id, not from its name", async () => {
  const alpha = await sourceOf("own-id", "alpha");
  const beta = await sourceOf("own-id", "beta");
  editDecl(alpha, { id: "kit" });
  const merged = must(
    await mergeMembers(
      { dirs: [alpha, beta], outDir: join(root, "own-id", "out"), name: "pair" },
      OPTIONS,
    ),
  );
  expect(merged.profileMove).toEqual([
    { from: "alpha/kit", to: "pair/alpha" },
    { from: "beta", to: "pair/beta" },
  ]);
  expect(merged.members.map((member) => member.id)).toEqual(["alpha", "beta"]);
});

test("the merged purpose joins the folders' purposes in declared order with '; ', skips the folders without one, and an input purpose wins", async () => {
  const alpha = await sourceOf("purpose", "alpha");
  const beta = await sourceOf("purpose", "beta");
  const gamma = await sourceOf("purpose", "gamma");
  editManifest(alpha, (raw) => ({ ...raw, purpose: "알파 목적" }));
  editManifest(gamma, (raw) => ({ ...raw, purpose: "감마 목적" }));
  const joined = must(
    await mergeMembers(
      { dirs: [alpha, beta, gamma], outDir: join(root, "purpose", "joined"), name: "trio" },
      OPTIONS,
    ),
  );
  expect(rawOf(join(root, "purpose", "joined"))["purpose"]).toBe("알파 목적; 감마 목적");
  expect(joined.issues.map((issue) => issue.code)).not.toContain("merge_purpose_truncated");

  const typed = must(
    await mergeMembers(
      {
        dirs: [alpha, beta, gamma],
        outDir: join(root, "purpose", "typed"),
        name: "trio",
        purpose: "직접 쓴 목적",
      },
      OPTIONS,
    ),
  );
  expect(rawOf(join(root, "purpose", "typed"))["purpose"]).toBe("직접 쓴 목적");
  expect(typed.changedFiles).toEqual([".fresnel-plugin/plugin.json"]);
});

test("when no folder has a purpose and no input is given, the merged manifest has none", async () => {
  const dirs = [await sourceOf("no-purpose", "alpha"), await sourceOf("no-purpose", "beta")];
  const outDir = join(root, "no-purpose", "out");
  must(await mergeMembers({ dirs, outDir, name: "pair" }, OPTIONS));
  expect(rawOf(outDir)).not.toHaveProperty("purpose");
});

test("a joined purpose over 200 characters is cut to 200 with the info merge_purpose_truncated", async () => {
  const alpha = await sourceOf("long-purpose", "alpha");
  const beta = await sourceOf("long-purpose", "beta");
  editManifest(alpha, (raw) => ({ ...raw, purpose: "a".repeat(150) }));
  editManifest(beta, (raw) => ({ ...raw, purpose: "b".repeat(150) }));
  const outDir = join(root, "long-purpose", "out");
  const merged = must(await mergeMembers({ dirs: [alpha, beta], outDir, name: "pair" }, OPTIONS));
  const purpose = rawOf(outDir)["purpose"];
  expect(typeof purpose).toBe("string");
  expect(String(purpose)).toHaveLength(200);
  expect(String(purpose).startsWith("a".repeat(150) + "; b")).toBe(true);
  expect(merged.issues.filter((issue) => issue.code === "merge_purpose_truncated")).toEqual([
    {
      severity: "info",
      code: "merge_purpose_truncated",
      path: "/purpose",
      message:
        "원본들의 목적을 이어 붙이니 200자를 넘어 잘랐다. 목적을 직접 주려면 purpose를 넘긴다",
    },
  ]);
  expect(validateManifest(rawOf(outDir)).manifest?.purpose).toBe(String(purpose));
});

test("a dependency on another folder of the merge is dropped with an info, and a dependency outside it is kept", async () => {
  const alpha = await sourceOf("deps", "alpha");
  const beta = await sourceOf("deps", "beta");
  editDecl(alpha, {
    dependsOn: [{ plugin: "beta" }, { plugin: "outside-kit", kind: "soft" }],
  });
  const outDir = join(root, "deps", "out");
  const merged = must(await mergeMembers({ dirs: [alpha, beta], outDir, name: "pair" }, OPTIONS));
  expect(
    merged.issues.filter((issue) => issue.code === "merge_internal_dependency_dropped"),
  ).toEqual([
    {
      severity: "info",
      code: "merge_internal_dependency_dropped",
      path: "/plugins/1/dependsOn",
      message: "beta에 거는 의존 줄은 합치는 대상 안이라 뺐다",
    },
  ]);
  expect(arrayOf(rawOf(outDir)["plugins"])[1]).toEqual({
    id: "alpha",
    layer: "plugin",
    hooks: ["boundary.settle.after"],
    defaultEnabled: false,
    dependsOn: [{ plugin: "outside-kit", kind: "soft" }],
  });
});

test("a folder that already has members is refused as source_has_members with its index", async () => {
  const alpha = await sourceOf("has-members", "alpha");
  const pilot = await sourceOf("has-members", "pilot");
  must(await editMembers({ dir: pilot, ops: [{ kind: "add", id: "sync", mode: "hook" }] }));
  const outDir = join(root, "has-members", "out");
  const failure = refusal(
    await mergeMembers({ dirs: [alpha, pilot], outDir, name: "pair" }, OPTIONS),
  );
  expect(failure.kind).toBe("invalid_input");
  expect(reasonsOf(failure)).toEqual([{ code: "source_has_members", field: "dirs/1" }]);
  expect(existsSync(outDir)).toBe(false);
});

test("a folder on a built-in layer is refused, because the root is an external plugin and layers cannot mix", async () => {
  const alpha = await sourceOf("layers", "alpha");
  const gamma = await sourceOf("layers", "gamma", "L3");
  const outDir = join(root, "layers", "out");
  const failure = refusal(
    await mergeMembers({ dirs: [alpha, gamma], outDir, name: "pair" }, OPTIONS),
  );
  expect(reasonsOf(failure)).toEqual([{ code: "layer_mixed_external", field: "plugins/2/layer" }]);
  expect(existsSync(outDir)).toBe(false);
});

test("the same capability, replaced tool or record kind in two folders is refused, each with the later folder's index", async () => {
  const capability = await sourceOf("clash-cap", "alpha");
  const capabilityBeta = await sourceOf("clash-cap", "beta");
  editDecl(capability, { provides: [{ id: "web.search", version: "0.1.0" }] });
  editDecl(capabilityBeta, { provides: [{ id: "web.search", version: "0.1.0" }] });
  expect(
    refusal(
      await mergeMembers(
        {
          dirs: [capability, capabilityBeta],
          outDir: join(root, "clash-cap", "out"),
          name: "pair",
        },
        OPTIONS,
      ),
    ),
  ).toEqual({
    kind: "invalid_input",
    message: "the folders cannot be merged: capability_duplicate",
    reasons: [
      {
        code: "capability_duplicate",
        field: "dirs/1",
        message: "capability web.search is declared by alpha and beta",
      },
    ],
  });

  const replace = await sourceOf("clash-replace", "alpha");
  const replaceBeta = await sourceOf("clash-replace", "beta");
  editDecl(replace, { replaces: ["web_search"] });
  editDecl(replaceBeta, { replaces: ["web_search"] });
  expect(
    reasonsOf(
      refusal(
        await mergeMembers(
          {
            dirs: [replace, replaceBeta],
            outDir: join(root, "clash-replace", "out"),
            name: "pair",
          },
          OPTIONS,
        ),
      ),
    ),
  ).toEqual([{ code: "replace_conflict", field: "dirs/1" }]);

  const kind = await sourceOf("clash-kind", "alpha");
  const kindBeta = await sourceOf("clash-kind", "beta");
  const recordKind = {
    kind: "x.shared.note.saved",
    version: 1,
    description: "a saved note",
    payload: {},
  };
  editDecl(kind, { recordKinds: [recordKind] });
  editDecl(kindBeta, { recordKinds: [recordKind] });
  expect(
    reasonsOf(
      refusal(
        await mergeMembers(
          { dirs: [kind, kindBeta], outDir: join(root, "clash-kind", "out"), name: "pair" },
          OPTIONS,
        ),
      ),
    ),
  ).toEqual([{ code: "record_kind_duplicate", field: "dirs/1" }]);
});

test("the same tool name or command name in two folders is refused as tool_duplicate", async () => {
  const tool = await sourceOf("clash-tool", "alpha");
  const toolBeta = await sourceOf("clash-tool", "beta");
  editManifest(tool, (raw) => ({ ...raw, tools: [{ name: "lookup", description: "find" }] }));
  editManifest(toolBeta, (raw) => ({ ...raw, tools: [{ name: "lookup", description: "find" }] }));
  expect(
    refusal(
      await mergeMembers(
        { dirs: [tool, toolBeta], outDir: join(root, "clash-tool", "out"), name: "pair" },
        OPTIONS,
      ),
    ),
  ).toEqual({
    kind: "invalid_input",
    message: "the folders cannot be merged: tool_duplicate",
    reasons: [
      {
        code: "tool_duplicate",
        field: "dirs/1",
        message: "tool lookup is declared by alpha and beta",
      },
    ],
  });

  const command = await sourceOf("clash-command", "alpha");
  const commandBeta = await sourceOf("clash-command", "beta");
  editManifest(command, (raw) => ({ ...raw, commands: [{ name: "sync", description: "sync" }] }));
  editManifest(commandBeta, (raw) => ({
    ...raw,
    commands: [{ name: "sync", description: "sync" }],
  }));
  expect(
    reasonsOf(
      refusal(
        await mergeMembers(
          {
            dirs: [command, commandBeta],
            outDir: join(root, "clash-command", "out"),
            name: "pair",
          },
          OPTIONS,
        ),
      ),
    ),
  ).toEqual([{ code: "tool_duplicate", field: "dirs/1" }]);
});

test("a repeated source name, a new name equal to a member, an invalid name and an installed name are refused with their reasons", async () => {
  const first = await sourceOf("names", "alpha");
  const second = await sourceOf("names-again", "alpha");
  const beta = await sourceOf("names", "beta");
  const outDir = join(root, "names", "out");
  expect(
    reasonsOf(
      refusal(await mergeMembers({ dirs: [first, second], outDir, name: "pair" }, OPTIONS)),
    ),
  ).toEqual([{ code: "source_duplicate_name", field: "dirs/1" }]);
  expect(
    reasonsOf(refusal(await mergeMembers({ dirs: [first, beta], outDir, name: "alpha" }, OPTIONS))),
  ).toEqual([{ code: "member_id_conflict", field: "name" }]);
  expect(
    reasonsOf(
      refusal(await mergeMembers({ dirs: [first, beta], outDir, name: "Bad_Name" }, OPTIONS)),
    ),
  ).toEqual([{ code: "name_invalid", field: "name" }]);
  expect(
    reasonsOf(
      refusal(
        await mergeMembers(
          { dirs: [first, beta], outDir, name: "pair" },
          { installedNames: ["pair"] },
        ),
      ),
    ),
  ).toEqual([{ code: "name_conflict", field: "name" }]);
  expect(existsSync(outDir)).toBe(false);
});

test("an outDir that is not empty, or sits inside a source folder, is refused and the files there stay", async () => {
  const alpha = await sourceOf("occupied", "alpha");
  const beta = await sourceOf("occupied", "beta");
  const occupied = join(root, "occupied", "out");
  mkdirSync(occupied, { recursive: true });
  writeFileSync(join(occupied, "keep.txt"), "mine\n");
  expect(
    reasonsOf(
      refusal(await mergeMembers({ dirs: [alpha, beta], outDir: occupied, name: "pair" }, OPTIONS)),
    ),
  ).toEqual([{ code: "out_dir_not_empty", field: "outDir" }]);
  expect(filesOf(occupied)).toEqual(["keep.txt"]);
  expect(textOf(occupied, "keep.txt")).toBe("mine\n");

  const inside = join(alpha, "copy");
  expect(
    reasonsOf(
      refusal(await mergeMembers({ dirs: [alpha, beta], outDir: inside, name: "pair" }, OPTIONS)),
    ),
  ).toEqual([{ code: "out_dir_inside_source", field: "outDir" }]);
  expect(existsSync(inside)).toBe(false);
});

test("a folder count outside 2 to 16 and a relative path are refused before anything is read or written", async () => {
  const alpha = await sourceOf("shape", "alpha");
  const beta = await sourceOf("shape", "beta");
  const outDir = join(root, "shape", "out");
  expect(
    reasonsOf(refusal(await mergeMembers({ dirs: [alpha], outDir, name: "pair" }, OPTIONS))),
  ).toEqual([{ code: "dirs_count_invalid", field: "dirs" }]);
  const seventeen = Array.from({ length: 17 }, () => alpha);
  expect(
    reasonsOf(refusal(await mergeMembers({ dirs: seventeen, outDir, name: "pair" }, OPTIONS))),
  ).toEqual([{ code: "dirs_count_invalid", field: "dirs" }]);
  expect(
    refusal(await mergeMembers({ dirs: ["shape-alpha", beta], outDir, name: "pair" }, OPTIONS)),
  ).toEqual({ kind: "invalid_input", message: "dirs must be absolute paths" });
  expect(
    refusal(await mergeMembers({ dirs: [alpha, beta], outDir: "out", name: "pair" }, OPTIONS)),
  ).toEqual({ kind: "invalid_input", message: "outDir must be an absolute path" });
  expect(existsSync(outDir)).toBe(false);
});

test("a result that does not validate writes nothing: the reserved name is refused and outDir stays absent", async () => {
  const dirs = [await sourceOf("reserved", "alpha"), await sourceOf("reserved", "beta")];
  const outDir = join(root, "reserved", "out");
  const failure = refusal(await mergeMembers({ dirs, outDir, name: "core" }, OPTIONS));
  expect(failure.kind).toBe("invalid_input");
  expect(reasonsOf(failure)).toEqual([{ code: "name_reserved", field: "name" }]);
  expect(existsSync(outDir)).toBe(false);
});

test("folders with different versions take the first folder's version and report it as info", async () => {
  const alpha = await sourceOf("versions", "alpha");
  const beta = await sourceOf("versions", "beta");
  editManifest(beta, (raw) => ({ ...raw, version: "0.2.0" }));
  const outDir = join(root, "versions", "out");
  const merged = must(await mergeMembers({ dirs: [alpha, beta], outDir, name: "pair" }, OPTIONS));
  expect(rawOf(outDir)["version"]).toBe("0.1.0");
  expect(merged.issues.filter((issue) => issue.code === "merge_version_taken_from_first")).toEqual([
    {
      severity: "info",
      code: "merge_version_taken_from_first",
      path: "/version",
      message:
        "원본 버전이 다르다. 새 버전은 첫 원본의 0.1.0으로 했다. 가장 높은 버전으로 바꾸려면 직접 고친다",
    },
  ]);
});

test("the merge joins only manifests and declarations: shared items and code are reported, the code needs wiring by hand, and a folder with no code gets no code warning", async () => {
  const dirs = [await sourceOf("shared", "alpha"), await sourceOf("shared", "beta")];
  const outDir = join(root, "shared", "out");
  const coded = must(await mergeMembers({ dirs, outDir, name: "pair" }, OPTIONS));
  expect(coded.issues.map((issue) => [issue.severity, issue.code])).toEqual([
    ["info", "merge_shared_files_not_copied"],
    ["info", "merge_shared_files_not_copied"],
    ["warning", "merge_code_needs_wiring"],
  ]);
  expect(
    coded.issues
      .filter((issue) => issue.code === "merge_shared_files_not_copied")
      .map((issue) => issue.message),
  ).toEqual([
    "원본 alpha의 코드와 공용 항목은 옮기지 않았다(entry). 필요하면 손으로 옮긴다",
    "원본 beta의 코드와 공용 항목은 옮기지 않았다(entry). 필요하면 손으로 옮긴다",
  ]);

  const plainAlpha = await sourceOf("plain", "alpha");
  const plainBeta = await sourceOf("plain", "beta");
  for (const dir of [plainAlpha, plainBeta])
    editManifest(dir, (raw) =>
      Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "entry")),
    );
  const plainOut = join(root, "plain", "out");
  const plain = must(
    await mergeMembers({ dirs: [plainAlpha, plainBeta], outDir: plainOut, name: "pair" }, OPTIONS),
  );
  expect(plain.issues.map((issue) => [issue.severity, issue.code])).toEqual([
    ["info", "merge_shared_files_not_copied"],
    ["info", "merge_shared_files_not_copied"],
  ]);
  expect(plain.issues.map((issue) => issue.message)).toEqual([
    "원본 alpha의 코드와 공용 항목은 옮기지 않았다(없음). 필요하면 손으로 옮긴다",
    "원본 beta의 코드와 공용 항목은 옮기지 않았다(없음). 필요하면 손으로 옮긴다",
  ]);
});

test("sixteen folders are refused by the manifest check: the root takes one of the sixteen plugin slots, so at most fifteen members fit", async () => {
  const dirs = await Promise.all(
    Array.from({ length: 16 }, (_folder, at) => sourceOf("sixteen", `m${at}`)),
  );
  const outDir = join(root, "sixteen", "out");
  const failure = refusal(await mergeMembers({ dirs, outDir, name: "crowd" }, OPTIONS));
  expect(failure.kind).toBe("invalid_input");
  expect(existsSync(outDir)).toBe(false);
  // 구성원은 최대 15개다. 열여섯째는 `plugins[]` 상한(16)을 넘겨 매니페스트 검사의 `schema`로 거절된다
  expect(reasonsOf(failure)).toEqual([{ code: "schema", field: "plugins" }]);
});

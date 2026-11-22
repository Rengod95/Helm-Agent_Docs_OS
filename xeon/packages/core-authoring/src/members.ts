import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { err, ok, parseJson, type Result } from "@fresnel/contracts";
import {
  pluginDefaultEnabled,
  pluginsOf,
  validateManifest,
  type ExtensionManifest,
  type ManifestIssue,
} from "@fresnel/contracts/extensions";
import type {
  DevkitError,
  DevkitIssue,
  MemberInfo,
  MembersEditInput,
  MembersEditResult,
} from "@fresnel/contracts/services";
import { invalid, io } from "./errors.ts";
import {
  ENTRY_PATH,
  MEMBERS_DIR,
  MEMBERS_GENERATED_PATH,
  entryImportsGenerated,
  membersGeneratedText,
  planMembers,
  type FileAction,
  type MemberPlan,
} from "./members-plan.ts";
import { isRecord } from "./shared.ts";
import { MANIFEST_PATH } from "./validate.ts";

// L3.authoring.spec §3.3 `editMembers`. 원본 폴더의 구성원을 고친다. 계획(members-plan.ts)을 세우고 매니페스트를
// 검사한 뒤에만 쓴다. 설치된 사본은 건드리지 않는다. 고친 폴더는 호출자가 `plugin.draft.create`로 다시 초안을 만든다.

/** 구성원 편집을 적용한다. 하나라도 실패하면 아무 파일도 쓰지 않는다 */
export async function editMembers(
  input: MembersEditInput,
): Promise<Result<MembersEditResult, DevkitError>> {
  if (!isAbsolute(input.dir)) return err(invalid("dir must be an absolute path"));
  const text = await io(MANIFEST_PATH, () => readFile(join(input.dir, MANIFEST_PATH), "utf8"));
  if (!text.ok) return text;
  const parsed = parseJson(text.value);
  const raw = parsed.ok ? parsed.value : undefined;
  if (!isRecord(raw)) return err(invalid(`${MANIFEST_PATH} is not a JSON object`));
  const existing = await codeIdsOf(input.dir);
  if (!existing.ok) return existing;
  const entry = await entryTextOf(input.dir);
  if (!entry.ok) return entry;

  const plan = planMembers(raw, existing.value, input.ops);
  if (!plan.ok) return plan;
  const checked = validateManifest(plan.value.manifest);
  const manifest = checked.manifest;
  if (manifest === undefined) return err(refusedOf(checked.issues));

  const wiring: "generated" | "manual" =
    entry.value !== undefined && entryImportsGenerated(entry.value) ? "generated" : "manual";
  // 엔트리가 있는 폴더나 코드 구성원이 있으면 생성 파일을 쓴다(scaffold와 같은 규칙)
  const generated = entry.value !== undefined || plan.value.coded.length > 0;
  const writing = input.ops.length > 0;
  if (writing) {
    const written = await writeAll(
      input.dir,
      plan.value,
      generated ? membersGeneratedText(plan.value.coded) : undefined,
    );
    if (!written.ok) return written;
  }

  const members = membersInfo(manifest);
  const issues: DevkitIssue[] = [
    ...checked.issues.map(toDevkitIssue),
    ...plan.value.kept.map(keptIssue),
  ];
  if (wiring === "manual" && members.some((member) => member.hooks.length > 0 || member.drives))
    issues.push({
      severity: "warning",
      code: "entry_wiring_manual",
      path: "",
      file: ENTRY_PATH,
      message: "src/index.ts가 구성원을 등록하는지 직접 확인",
    });
  return ok({
    members,
    issues,
    changedFiles: writing ? changedFilesOf(plan.value, generated) : [],
    entryWiring: wiring,
  });
}

/** `src/members/`의 코드 파일 id. 폴더가 없으면 빈 집합이다 */
async function codeIdsOf(dir: string): Promise<Result<ReadonlySet<string>, DevkitError>> {
  const listed = await io(MEMBERS_DIR, () =>
    readdir(join(dir, MEMBERS_DIR), { withFileTypes: true }),
  );
  if (!listed.ok) return listed.error.kind === "not_found" ? ok(new Set<string>()) : listed;
  const ids = listed.value
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name.slice(0, -".ts".length));
  return ok(new Set(ids));
}

/** 엔트리 파일 글. 없으면 undefined다(지침 방식 폴더) */
async function entryTextOf(dir: string): Promise<Result<string | undefined, DevkitError>> {
  const text = await io(ENTRY_PATH, () => readFile(join(dir, ENTRY_PATH), "utf8"));
  if (text.ok) return ok(text.value);
  return text.error.kind === "not_found" ? ok(undefined) : text;
}

/** 계획한 파일 작업을 순서대로 하고, 생성 파일을 쓰고, 매니페스트는 마지막에 쓴다 */
async function writeAll(
  dir: string,
  plan: MemberPlan,
  generated: string | undefined,
): Promise<Result<void, DevkitError>> {
  for (const action of plan.actions) {
    // oxlint-disable-next-line no-await-in-loop -- 쓰기와 옮기기는 계획한 순서대로 해야 한다 (eng.typescript.guide TY-22)
    const done = await applyAction(dir, action);
    if (!done.ok) return done;
  }
  if (generated !== undefined) {
    const written = await writeText(dir, MEMBERS_GENERATED_PATH, generated);
    if (!written.ok) return written;
  }
  return writeText(dir, MANIFEST_PATH, `${JSON.stringify(plan.manifest, null, 2)}\n`);
}

function applyAction(dir: string, action: FileAction): Promise<Result<void, DevkitError>> {
  if (action.kind === "move")
    return io(action.to, () => rename(join(dir, action.from), join(dir, action.to)));
  return writeText(dir, action.path, action.text);
}

function writeText(dir: string, path: string, text: string): Promise<Result<void, DevkitError>> {
  const target = join(dir, path);
  return io(path, async () => {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
  });
}

function changedFilesOf(plan: MemberPlan, generated: boolean): string[] {
  const paths = plan.actions.flatMap((action) =>
    action.kind === "move" ? [action.from, action.to] : [action.path],
  );
  const all = [...paths, ...(generated ? [MEMBERS_GENERATED_PATH] : []), MANIFEST_PATH];
  return [...new Set(all)];
}

function membersInfo(manifest: ExtensionManifest): MemberInfo[] {
  const blocks = manifest.orchestration?.composition?.blocks ?? [];
  return pluginsOf(manifest).flatMap((entry) => {
    const id = entry.decl.id;
    if (entry.root || id === undefined) return [];
    return [
      {
        id,
        registrationId: entry.registrationId,
        title: entry.decl.title ?? null,
        layer: entry.decl.layer,
        hooks: entry.decl.hooks,
        drives: entry.decl.drives === true,
        defaultEnabled: pluginDefaultEnabled(manifest, entry),
        blockIds: blocks.filter((block) => block.plugin === id).map((block) => block.id),
      },
    ];
  });
}

function toDevkitIssue(found: ManifestIssue): DevkitIssue {
  return { severity: found.severity, code: found.code, path: found.path, message: found.message };
}

function keptIssue(id: string): DevkitIssue {
  const file = `${MEMBERS_DIR}/${id}.ts`;
  return {
    severity: "info",
    code: "member_file_kept",
    path: "",
    file,
    message: `${file} was kept; delete it by hand if the code is no longer needed`,
  };
}

/** 매니페스트 검사 오류로 거절한다. 사유마다 코드와 매니페스트 안 경로를 싣는다 */
function refusedOf(issues: readonly ManifestIssue[]): DevkitError {
  const errors = issues.filter((found) => found.severity === "error");
  return {
    kind: "invalid_input",
    message: `${MANIFEST_PATH} would not validate: ${errors.map((found) => found.code).join(", ")}`,
    reasons: errors.map((found) => ({
      code: found.code,
      field: found.path.replace(/^\//, ""),
      message: found.message,
    })),
  };
}

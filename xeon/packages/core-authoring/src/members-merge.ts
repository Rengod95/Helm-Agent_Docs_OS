import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { err, ok, parseJson, type Result } from "@fresnel/contracts";
import {
  EXTENSION_NAME_PATTERN,
  MANIFEST_SCHEMA_VERSION,
  pluginDefaultEnabled,
  pluginsOf,
  validateManifest,
  type ExtensionManifest,
  type ManifestIssue,
} from "@fresnel/contracts/extensions";
import type {
  DevkitError,
  DevkitIssue,
  DevkitReason,
  MemberInfo,
  MembersMergeInput,
  MembersMergeResult,
} from "@fresnel/contracts/services";
import { arrayOf, invalid, io, mapAll, refusal } from "./errors.ts";
import { checkOutDir, writeOutDir } from "./out-dir-write.ts";
import { isRecord } from "./shared.ts";
import { MANIFEST_PATH } from "./validate.ts";

const encoder = new TextEncoder();

// 구성원 합치기(`mergeMembers`, AGE-33). 독립 플러그인 폴더 2~16개를 한 플러그인의 구성원으로 묶은 새 폴더(`outDir`)를 쓴다.
// 원본 폴더는 읽기만 한다. 매니페스트와 선언만 합친다: 코드 파일과 공용 항목은 옮기지 않고 issues로 알린다.
// 새 매니페스트를 메모리에서 모두 세우고 F `validateManifest`로 검사한 뒤에만 쓴다. 쓰다가 실패하면 우리가 쓴 파일과
// 만든 폴더만 지운다. 프로필은 건드리지 않는다(`profileMove`로 알린다). 떼기(members-detach.ts)와 같은 규칙을 따른다.

/** 합칠 원본 폴더 수의 하한과 상한(wire와 같다). 상한 16은 뿌리 플러그인을 더하면 `plugins[]` 상한을 넘는 수라 검사가 거절한다 */
const MIN_SOURCES = 2;
const MAX_SOURCES = 16;
/** 옮기지 않는 공용 항목과 코드 입구. 원본마다 알린다 */
const SHARED_FIELDS: readonly string[] = [
  "userConfig",
  "components",
  "tools",
  "commands",
  "scripts",
  "ui",
  "methods",
  "entry",
];
/** 목적 한 문장의 상한. `ExtensionManifestSchema`의 `purpose`(200자)와 같다 */
const PURPOSE_LIMIT = 200;
/** 설명의 상한. `ExtensionManifestSchema`의 `description`(1024자)과 같다 */
const DESCRIPTION_LIMIT = 1024;
/** 원본 설명들을 잇는 글. 빈 줄 하나다 */
const DESCRIPTION_SEPARATOR = "\n\n";
const NAME = new RegExp(EXTENSION_NAME_PATTERN);

/** 합치기의 바깥 값. 설치된 이름은 새 이름의 충돌을 본다 */
interface MergeOptions {
  /** 설치된 이름들(새 이름과 겹치면 `name_conflict`) */
  readonly installedNames: readonly string[];
}

/** 읽은 원본 하나. `decl`은 그 폴더의 유일한 플러그인 선언이다(`plugins`가 없으면 추론한 뿌리) */
interface Source {
  /** `dirs`의 위치. 사유의 `field`(`dirs/<i>`)에 쓴다 */
  readonly index: number;
  readonly dir: string;
  readonly name: string;
  readonly version: string;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly decl: Readonly<Record<string, unknown>>;
}

/** 구성원 선언 하나와, 합치는 대상을 가리키다가 뺀 의존 줄의 대상 이름 */
interface Member {
  readonly decl: Record<string, unknown>;
  readonly dropped: readonly string[];
}

/** 원본 폴더들을 합쳐 새 폴더에 매니페스트를 쓴다. 실패하면 `outDir`에 아무 파일도 남기지 않는다 */
export async function mergeMembers(
  input: MembersMergeInput,
  options: MergeOptions,
): Promise<Result<MembersMergeResult, DevkitError>> {
  if (input.dirs.length < MIN_SOURCES || input.dirs.length > MAX_SOURCES)
    return err(
      refusal(
        "dirs_count_invalid",
        "dirs",
        `dirs must hold 2 to 16 folders, got ${input.dirs.length}`,
      ),
    );
  if (!input.dirs.every((dir) => isAbsolute(dir)))
    return err(invalid("dirs must be absolute paths"));
  if (!isAbsolute(input.outDir)) return err(invalid("outDir must be an absolute path"));
  const read = await readSources(input.dirs);
  if (!read.ok) return read;
  const sources = read.value;
  const [first] = sources;
  if (first === undefined)
    return err(refusal("dirs_count_invalid", "dirs", "dirs must hold 2 to 16 folders"));

  // 이름과 충돌은 한꺼번에 모아 거절한다(화면이 사유마다 문장을 고른다)
  const reasons: DevkitReason[] = [
    ...duplicateNameReasons(sources),
    ...newNameReasons(sources, input.name, options.installedNames),
    ...conflictReasons(sources),
  ];
  if (reasons.length > 0)
    return err({
      kind: "invalid_input",
      message: `the folders cannot be merged: ${reasons.map((reason) => reason.code).join(", ")}`,
      reasons,
    });
  const target = await checkOutDir(
    input.outDir,
    sources.map((source) => source.dir),
  );
  if (!target.ok) return target;

  const built = buildManifest(input, first, sources);
  const checked = validateManifest(built.manifest);
  if (checked.manifest === undefined) return err(refusedOf(checked.issues));
  const issues: DevkitIssue[] = [...built.notes, ...checked.issues.map(toDevkitIssue)];

  const written = await writeOutDir(input.outDir, [
    {
      path: MANIFEST_PATH,
      bytes: encoder.encode(`${JSON.stringify(built.manifest, null, 2)}\n`),
    },
  ]);
  if (!written.ok) return written;
  return ok({
    outDir: input.outDir,
    name: input.name,
    members: membersOf(checked.manifest),
    changedFiles: [MANIFEST_PATH],
    issues,
    profileMove: sources.map((source) => ({
      from: registrationOf(source),
      to: `${input.name}/${source.name}`,
    })),
  });
}

function reasonOf(code: string, field: string, message: string): DevkitReason {
  return { code, field, message };
}

/** 원본 한 폴더의 사유. 어느 폴더인지 `field`에 `dirs/<i>`로 싣는다 */
function sourceRefusal(index: number, code: string, message: string): DevkitError {
  return refusal(code, `dirs/${index}`, message);
}

/** 원본 폴더 목록을 읽는다. 첫 실패를 위치 순서로 돌려준다 */
async function readSources(dirs: readonly string[]): Promise<Result<Source[], DevkitError>> {
  return mapAll(
    dirs.map((dir, index) => ({ dir, index })),
    ({ dir, index }) => readSource(dir, index),
  );
}

async function readSource(dir: string, index: number): Promise<Result<Source, DevkitError>> {
  const text = await io(MANIFEST_PATH, () => readFile(join(dir, MANIFEST_PATH), "utf8"));
  if (!text.ok) return text;
  const parsed = parseJson(text.value);
  const raw = parsed.ok ? parsed.value : undefined;
  if (!isRecord(raw))
    return err(
      sourceRefusal(index, "source_manifest_invalid", `${MANIFEST_PATH} is not a JSON object`),
    );
  const name = raw["name"];
  if (typeof name !== "string")
    return err(sourceRefusal(index, "source_manifest_invalid", `${MANIFEST_PATH} has no name`));
  const version = raw["version"];
  if (typeof version !== "string")
    return err(sourceRefusal(index, "source_manifest_invalid", `${MANIFEST_PATH} has no version`));
  const decl = soleDeclOf(raw, index);
  if (!decl.ok) return decl;
  return ok({ index, dir, name, version, raw, decl: decl.value });
}

/**
 * 원본의 유일한 플러그인 선언. `plugins`가 없으면 추론한 뿌리 플러그인이다(층 `plugin`, 훅 없음). `orchestration`이 있거나
 * 선언이 둘 이상이면 이미 구성원이 있으므로 `source_has_members`로 거절한다
 */
function soleDeclOf(
  raw: Readonly<Record<string, unknown>>,
  index: number,
): Result<Readonly<Record<string, unknown>>, DevkitError> {
  if (raw["orchestration"] !== undefined)
    return err(
      refusal(
        "source_has_members",
        `dirs/${index}`,
        "the folder has an orchestration, so it already has members",
      ),
    );
  const plugins = raw["plugins"];
  if (plugins === undefined) return ok({ layer: "plugin", hooks: [] });
  if (!Array.isArray(plugins))
    return err(sourceRefusal(index, "source_manifest_invalid", "plugins must be an array"));
  const decls = arrayOf(plugins);
  if (decls.length > 1)
    return err(
      refusal(
        "source_has_members",
        `dirs/${index}`,
        `the folder declares ${decls.length} plugins, so it already has members`,
      ),
    );
  const only = decls[0];
  return isRecord(only)
    ? ok(only)
    : err(sourceRefusal(index, "source_manifest_invalid", "plugins must hold one declaration"));
}

/** 같은 원본 이름이 두 번 나오면 뒤의 원본마다 사유 하나를 낸다 */
function duplicateNameReasons(sources: readonly Source[]): DevkitReason[] {
  return sources.flatMap((source) => {
    const first = sources.find((other) => other.name === source.name);
    if (first === undefined || first.index === source.index) return [];
    return [
      reasonOf(
        "source_duplicate_name",
        `dirs/${source.index}`,
        `source name ${source.name} appears in dirs/${first.index} and dirs/${source.index}`,
      ),
    ];
  });
}

/** 새 이름: 이름 형식, 구성원 id(원본 이름)와 같지 않음, 설치된 이름과 겹치지 않음 */
function newNameReasons(
  sources: readonly Source[],
  name: string,
  installed: readonly string[],
): DevkitReason[] {
  const reasons: DevkitReason[] = [];
  if (!NAME.test(name))
    reasons.push(reasonOf("name_invalid", "name", `name "${name}" is not a valid extension name`));
  for (const source of sources.filter((item) => item.name === name))
    reasons.push(
      reasonOf(
        "member_id_conflict",
        "name",
        `name "${name}" is the same as the member id of dirs/${source.index}`,
      ),
    );
  if (installed.includes(name))
    reasons.push(reasonOf("name_conflict", "name", `name "${name}" is already installed`));
  return reasons;
}

/** 원본의 플러그인 Registration id(프로필이 쓰는 이름). 선언에 id가 없으면 원본 이름이고, 있으면 `<원본 이름>/<id>`다 */
function registrationOf(source: Source): string {
  const id = source.decl["id"];
  return typeof id === "string" ? `${source.name}/${id}` : source.name;
}

/** 두 원본이 같은 값을 내면(같은 원본 안의 중복은 매니페스트 검사가 본다) 뒤의 원본마다 사유 하나를 낸다 */
function clashesOf(
  sources: readonly Source[],
  code: string,
  label: string,
  keysOf: (source: Source) => readonly string[],
): DevkitReason[] {
  const claimed = new Map<string, Source>();
  return sources.flatMap((source) =>
    keysOf(source).flatMap((key) => {
      const first = claimed.get(key);
      if (first === undefined) {
        claimed.set(key, source);
        return [];
      }
      if (first.index === source.index) return [];
      return [
        reasonOf(
          code,
          `dirs/${source.index}`,
          `${label} ${key} is declared by ${first.name} and ${source.name}`,
        ),
      ];
    }),
  );
}

function conflictReasons(sources: readonly Source[]): DevkitReason[] {
  return [
    ...clashesOf(sources, "capability_duplicate", "capability", (source) =>
      stringsOf(recordsOf(source.decl["provides"]), "id"),
    ),
    ...clashesOf(sources, "replace_conflict", "replaced built-in tool", (source) =>
      stringListOf(source.decl["replaces"]),
    ),
    ...clashesOf(sources, "record_kind_duplicate", "record kind", (source) =>
      stringsOf(recordsOf(source.decl["recordKinds"]), "kind"),
    ),
    ...clashesOf(sources, "tool_duplicate", "tool", (source) =>
      stringsOf(recordsOf(source.raw["tools"]), "name"),
    ),
    ...clashesOf(sources, "tool_duplicate", "command", (source) =>
      stringsOf(recordsOf(source.raw["commands"]), "name"),
    ),
  ];
}

function recordsOf(value: unknown): Record<string, unknown>[] {
  return arrayOf(value).filter(isRecord);
}

function stringsOf(records: readonly Record<string, unknown>[], key: string): string[] {
  return records.flatMap((record) => {
    const value = record[key];
    return typeof value === "string" ? [value] : [];
  });
}

function stringListOf(value: unknown): string[] {
  return arrayOf(value).filter((item): item is string => typeof item === "string");
}

/**
 * 새 매니페스트. 뿌리 플러그인 하나(층 `plugin`, 훅 없음, 제목은 입력이 있으면), 원본마다 구성원 선언 하나(id는 원본 이름),
 * `orchestration.members`는 원본 이름들이다. 버전은 첫 원본의 것이다(비교는 여기서 하지 않는다).
 * 합치는 대상끼리를 가리키는 의존 줄은 같은 플러그인 안이 되므로 뺀다(`dependency_self`를 피한다)
 */
function buildManifest(
  input: MembersMergeInput,
  first: Source,
  sources: readonly Source[],
): { readonly manifest: Record<string, unknown>; readonly notes: readonly DevkitIssue[] } {
  const names = sources.map((source) => source.name);
  const members = sources.map((source) => memberOf(source, names));
  const root = {
    layer: "plugin",
    hooks: [],
    ...(input.title === undefined ? {} : { title: input.title }),
  };
  const purpose = purposeOf(input, sources);
  const description = descriptionOf(sources);
  const manifest: Record<string, unknown> = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    name: input.name,
    version: first.version,
    ...(purpose.text === undefined ? {} : { purpose: purpose.text }),
    ...(description.text === undefined ? {} : { description: description.text }),
    plugins: [root, ...members.map((member) => member.decl)],
    orchestration: { members: names },
  };
  const notes = notesOf(sources, first, members);
  if (purpose.truncated)
    notes.push({
      severity: "info",
      code: "merge_purpose_truncated",
      path: "/purpose",
      message:
        "원본들의 목적을 이어 붙이니 200자를 넘어 잘랐다. 목적을 직접 주려면 purpose를 넘긴다",
    });
  if (description.truncated)
    notes.push({
      severity: "info",
      code: "merge_description_truncated",
      path: "/description",
      message:
        "원본들의 설명을 이어 붙이니 1024자를 넘어 잘랐다. 전체를 다시 쓰려면 매니페스트의 description을 손으로 고친다",
    });
  return { manifest, notes };
}

/**
 * 합친 목적. 입력이 있으면 입력 그대로다(길이는 매니페스트 검사가 본다). 없으면 원본들의 `purpose`를 선언 순서대로
 * `; `로 잇고, 상한을 넘으면 자른다. 원본에 하나도 없으면 목적을 만들지 않는다
 */
function purposeOf(
  input: MembersMergeInput,
  sources: readonly Source[],
): { readonly text: string | undefined; readonly truncated: boolean } {
  if (input.purpose !== undefined) return { text: input.purpose, truncated: false };
  const purposes = sources.flatMap((source) => {
    const purpose = source.raw["purpose"];
    return typeof purpose === "string" && purpose !== "" ? [purpose] : [];
  });
  if (purposes.length === 0) return { text: undefined, truncated: false };
  const chars = Array.from(purposes.join("; "));
  return chars.length > PURPOSE_LIMIT
    ? { text: chars.slice(0, PURPOSE_LIMIT).join(""), truncated: true }
    : { text: chars.join(""), truncated: false };
}

/**
 * 합친 설명. 원본들의 `description` 가운데 앞뒤 공백을 뗀 뒤에도 글이 남는 것을 선언 순서대로 빈 줄 하나로 잇고, 상한을 넘으면
 * 코드 점 기준으로 자른다. 입력은 없다(설명은 원본에서만 온다). 원본에 하나도 없으면 설명을 만들지 않는다
 */
function descriptionOf(sources: readonly Source[]): {
  readonly text: string | undefined;
  readonly truncated: boolean;
} {
  const descriptions = sources.flatMap((source) => {
    const description = source.raw["description"];
    return typeof description === "string" && description.trim() !== "" ? [description] : [];
  });
  if (descriptions.length === 0) return { text: undefined, truncated: false };
  const chars = Array.from(descriptions.join(DESCRIPTION_SEPARATOR));
  return chars.length > DESCRIPTION_LIMIT
    ? { text: chars.slice(0, DESCRIPTION_LIMIT).join(""), truncated: true }
    : { text: chars.join(""), truncated: false };
}

/**
 * 원본 하나의 구성원 선언. `id`는 원본 이름이다. `defaultEnabled`는 원본 독립 플러그인이 처음 켜져 있었는지를 그대로 쓴다
 * (`startsOn`). 대상끼리의 의존 줄은 뺀다
 */
function memberOf(source: Source, names: readonly string[]): Member {
  const decl: Record<string, unknown> = { ...source.decl };
  delete decl["id"];
  decl["defaultEnabled"] = startsOn(source);
  const dropped: string[] = [];
  const lines = decl["dependsOn"];
  if (Array.isArray(lines)) {
    const kept = arrayOf(lines).filter((line) => {
      const plugin = isRecord(line) ? line["plugin"] : undefined;
      if (typeof plugin !== "string" || !targetsMerged(plugin, names)) return true;
      dropped.push(plugin);
      return false;
    });
    if (kept.length === 0) delete decl["dependsOn"];
    else decl["dependsOn"] = kept;
  }
  return { decl: { id: source.name, ...decl }, dropped };
}

/**
 * 원본 독립 플러그인이 처음 켜져 있었는가. `pluginDefaultEnabled`와 같은 규칙이다: 플러그인 선언의 값이 먼저이고, 선언에 없으면
 * id가 없는 뿌리 플러그인은 매니페스트 최상위의 `defaultEnabled`(없으면 켬), id가 있는 플러그인은 끔이다
 */
function startsOn(source: Source): boolean {
  const own = source.decl["defaultEnabled"];
  if (own !== undefined) return own !== false;
  if (source.decl["id"] !== undefined) return false;
  return source.raw["defaultEnabled"] !== false;
}

/** 의존 대상이 합치는 원본 가운데 하나(이름이나 `이름/id`)인가 */
function targetsMerged(plugin: string, names: readonly string[]): boolean {
  return names.some((name) => plugin === name || plugin.startsWith(`${name}/`));
}

/** 알림 목록: 버전이 다르면 첫 원본의 것을 쓴 사실, 원본마다 옮기지 않은 공용 항목, 코드 연결 경고, 뺀 의존 줄 */
function notesOf(
  sources: readonly Source[],
  first: Source,
  members: readonly Member[],
): DevkitIssue[] {
  const notes: DevkitIssue[] = [];
  if (sources.some((source) => source.version !== first.version))
    notes.push({
      severity: "info",
      code: "merge_version_taken_from_first",
      path: "/version",
      message: `원본 버전이 다르다. 새 버전은 첫 원본의 ${first.version}으로 했다. 가장 높은 버전으로 바꾸려면 직접 고친다`,
    });
  for (const source of sources) {
    const shared = SHARED_FIELDS.filter((key) => source.raw[key] !== undefined);
    notes.push({
      severity: "info",
      code: "merge_shared_files_not_copied",
      path: "",
      message: `원본 ${source.name}의 코드와 공용 항목은 옮기지 않았다(${shared.length > 0 ? shared.join(", ") : "없음"}). 필요하면 손으로 옮긴다`,
    });
  }
  const coded = sources.filter((source) => source.raw["entry"] !== undefined);
  if (coded.length > 0)
    notes.push({
      severity: "warning",
      code: "merge_code_needs_wiring",
      path: "",
      message: `구성원 코드 연결을 손으로 확인: 코드가 있는 원본(${coded.map((source) => source.name).join(", ")})의 코드는 옮기지 않았다`,
    });
  members.forEach((member, at) => {
    for (const plugin of member.dropped)
      notes.push({
        severity: "info",
        code: "merge_internal_dependency_dropped",
        path: `/plugins/${at + 1}/dependsOn`,
        message: `${plugin}에 거는 의존 줄은 합치는 대상 안이라 뺐다`,
      });
  });
  return notes;
}

/** 구성원 목록 요약. 합친 매니페스트에는 구성 블록이 없으므로 `blockIds`는 비어 있다 */
function membersOf(manifest: ExtensionManifest): MemberInfo[] {
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
        blockIds: [],
        injects: [],
        tools: [],
      },
    ];
  });
}

/** 매니페스트 검사 오류로 거절한다. 사유마다 코드와 매니페스트 안 경로를 싣는다(떼기와 같은 모양) */
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

function toDevkitIssue(found: ManifestIssue): DevkitIssue {
  return { severity: found.severity, code: found.code, path: found.path, message: found.message };
}

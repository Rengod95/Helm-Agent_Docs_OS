import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { err, ok, parseJson, type Result } from "@fresnel/contracts";
import {
  EXTENSION_NAME_PATTERN,
  validateManifest,
  type ManifestIssue,
} from "@fresnel/contracts/extensions";
import type {
  DevkitError,
  DevkitIssue,
  MembersDetachInput,
  MembersDetachResult,
} from "@fresnel/contracts/services";
import { arrayOf, invalid, io, mapAll, refusal } from "./errors.ts";
import { ENTRY_PATH, MEMBERS_DIR } from "./members-plan.ts";
import { checkOutDir, writeOutDir, type PlannedFile } from "./out-dir-write.ts";
import { isRecord } from "./shared.ts";
import type { TemplateDirs } from "./templates-dir.ts";
import { MANIFEST_PATH } from "./validate.ts";

// 구성원 떼기(`detachMember`, AGE-33). 구성원 하나를 독립 플러그인 폴더(`outDir`)로 옮긴다. 원본 폴더는 읽기만 한다.
// 새 매니페스트와 파일 목록을 메모리에서 모두 계획하고 매니페스트를 검사한 뒤에만 쓴다. 쓰다가 실패하면 우리가 쓴 파일과
// 만든 폴더만 지운다. 원본 폴더와 비어 있던 `outDir`은 지우지 않는다. 프로필은 건드리지 않는다(`profileMove`로 알린다).

/** 코드 파일이 엔트리로 연결되는 자리: 떼어 낸 구성원의 setup이 놓인다 */
const ROOT_CODE_PATH = "src/root.ts";
/** 템플릿 엔트리의 자리 표시. 뼈대를 만들 때 제목이 채워진다 */
const TITLE_SLOT = "__TITLE__";
/** 뼈대 엔트리가 있는 템플릿(훅 방식과 구동 방식). 엔트리가 이 가운데 하나 그대로여야 구성원 등록 방식을 안다 */
const TEMPLATE_ENTRY = "src/index.ts";
/** 구성원 코드가 다른 파일을 가져오면 그 파일이 없으므로 옮기지 않는다 */
const RELATIVE_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)["']\.\.?\//;
/** 구성원 코드가 `setup`을 내보내는가. 생성 파일이 이 이름으로 가져온다 */
const SETUP_EXPORT = /^export\s+(?:function|const)\s+setup\b/m;
/** 옮기지 않는 확장 공용 항목. 있으면 info 한 건으로 알린다 */
const SHARED_FIELDS = ["components", "userConfig", "tools", "commands", "scripts", "ui", "methods"];
/** 새 매니페스트에 따로 싣지 않는 구성원 선언의 키. `id`는 뿌리가 되면서 떼고, `defaultEnabled`는 뿌리 기본값을 따른다 */
const MEMBER_ONLY_KEYS: ReadonlySet<string> = new Set(["id", "defaultEnabled"]);

const NAME = new RegExp(EXTENSION_NAME_PATTERN);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** 떼기의 바깥 값. 템플릿은 엔트리가 뼈대와 같은지 보는 데 쓰고, 설치된 이름은 새 이름의 충돌을 본다 */
interface DetachOptions {
  /** 템플릿 폴더. 없으면 엔트리를 뼈대와 비교할 수 없어 코드는 옮기고 엔트리 연결을 손으로 확인하라고 알린다 */
  readonly templates: TemplateDirs | null;
  /** 설치된 확장 이름들(새 이름과 겹치면 `name_conflict`) */
  readonly installedNames: readonly string[];
}

/** 구성원 떼기. 실패하면 `outDir`에 아무 파일도 남기지 않는다 */
export async function detachMember(
  input: MembersDetachInput,
  options: DetachOptions,
): Promise<Result<MembersDetachResult, DevkitError>> {
  if (!isAbsolute(input.dir)) return err(invalid("dir must be an absolute path"));
  if (!isAbsolute(input.outDir)) return err(invalid("outDir must be an absolute path"));
  const text = await io(MANIFEST_PATH, () => readFile(join(input.dir, MANIFEST_PATH), "utf8"));
  if (!text.ok) return text;
  const parsed = parseJson(text.value);
  const raw = parsed.ok ? parsed.value : undefined;
  if (!isRecord(raw)) return err(invalid(`${MANIFEST_PATH} is not a JSON object`));
  const originalName = raw["name"];
  if (typeof originalName !== "string") return err(invalid(`${MANIFEST_PATH} has no name`));

  const decl = memberDeclOf(raw, input.member);
  if (decl === undefined)
    return err(
      refusal(
        "member_not_found",
        "plugins",
        `plugin "${input.member}" is not a member of this extension`,
      ),
    );
  const name = input.name ?? `${originalName}-${input.member}`;
  if (!NAME.test(name))
    return err(refusal("name_invalid", "name", `name "${name}" is not a valid extension name`));
  if (name === originalName)
    return err(
      refusal("name_conflict", "name", `name "${name}" is the name of the source extension`),
    );
  if (options.installedNames.includes(name))
    return err(refusal("name_conflict", "name", `name "${name}" is already installed`));
  const target = await checkOutDir(input.outDir, [input.dir]);
  if (!target.ok) return target;

  const codeRelative = `${MEMBERS_DIR}/${input.member}.ts`;
  const code = await readOptional(input.dir, codeRelative);
  if (!code.ok) return code;
  const entry = await readOptional(input.dir, ENTRY_PATH);
  if (!entry.ok) return entry;
  const scaffolded = await isScaffoldEntry(entry.value, options.templates);
  if (!scaffolded.ok) return scaffolded;

  // 코드를 엔트리 없이 연결할 수 있는 모양이면 뿌리의 setup으로 옮기고 엔트리를 새로 쓴다. 아니면 그대로 복사하고 알린다
  const wirable =
    code.value !== undefined &&
    scaffolded.value &&
    isSelfContained(code.value) &&
    SETUP_EXPORT.test(decoder.decode(code.value));
  const issues: DevkitIssue[] = [];
  const files: PlannedFile[] = [];
  const manifest = newManifest({
    raw,
    decl,
    member: input.member,
    originalName,
    name,
    keepDependency: input.keepDependency === true,
    dependencyKind: input.dependencyKind ?? "soft",
    entry: wirable ? "./src/index.ts" : undefined,
    purpose: input.purpose ?? raw["purpose"],
    description: raw["description"],
  });
  const checked = validateManifest(manifest);
  if (checked.manifest === undefined) return err(refusedOf(checked.issues));
  issues.push(...checked.issues.map(toDevkitIssue));
  files.push({
    path: MANIFEST_PATH,
    bytes: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`),
  });
  if (code.value !== undefined && wirable) {
    files.push({ path: ROOT_CODE_PATH, bytes: code.value });
    files.push({ path: ENTRY_PATH, bytes: encoder.encode(rootEntryText(input.member)) });
  } else if (code.value !== undefined) {
    files.push({ path: codeRelative, bytes: code.value });
    issues.push({
      severity: "warning",
      code: "detach_code_needs_wiring",
      path: "",
      file: codeRelative,
      message: `엔트리 연결을 손으로 확인: 코드는 ${codeRelative}에 그대로 옮겼다`,
    });
  }
  const shared = SHARED_FIELDS.filter((key) => raw[key] !== undefined);
  if (shared.length > 0)
    issues.push({
      severity: "info",
      code: "detach_shared_files_not_copied",
      path: "",
      message: `공용 항목(${shared.join(", ")})은 옮기지 않았다. 새 폴더에 필요하면 손으로 옮긴다`,
    });

  const written = await writeOutDir(input.outDir, files);
  if (!written.ok) return written;
  return ok({
    outDir: input.outDir,
    name,
    changedFiles: files.map((file) => file.path),
    issues,
    profileMove: { from: `${originalName}/${input.member}`, to: name },
  });
}

/** 구성원 선언(뿌리가 아니고 id가 같은 것) */
function memberDeclOf(
  raw: Readonly<Record<string, unknown>>,
  member: string,
): Readonly<Record<string, unknown>> | undefined {
  return arrayOf(raw["plugins"]).find(
    (decl): decl is Record<string, unknown> => isRecord(decl) && decl["id"] === member,
  );
}

/** 파일을 읽는다. 없으면 undefined다(이 파일이 없는 것은 오류가 아니다) */
async function readOptional(
  dir: string,
  path: string,
): Promise<Result<Uint8Array | undefined, DevkitError>> {
  const read = await io(path, () => readFile(join(dir, path)));
  if (read.ok) return ok(read.value);
  return read.error.kind === "not_found" ? ok(undefined) : read;
}

/** 엔트리가 뼈대 템플릿(훅, 구동)과 제목 자리만 다르면 참이다. 엔트리가 없으면 거짓이다 */
async function isScaffoldEntry(
  entry: Uint8Array | undefined,
  templates: TemplateDirs | null,
): Promise<Result<boolean, DevkitError>> {
  if (entry === undefined || templates === null) return ok(false);
  const text = decoder.decode(entry);
  const shapes = await mapAll([templates.single, templates.drive], (root) =>
    io(join(root, TEMPLATE_ENTRY), () => readFile(join(root, TEMPLATE_ENTRY), "utf8")),
  );
  if (!shapes.ok) return shapes;
  return ok(shapes.value.some((template) => templateRegExp(template).test(text)));
}

/** 템플릿 글을 정규식으로 바꾼다. 제목 자리만 한 줄의 아무 글과 맞춘다 */
function templateRegExp(template: string): RegExp {
  const pieces = template.split(TITLE_SLOT).map(escapeRegExp);
  return new RegExp(`^${pieces.join("[^\\n]*")}$`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 옮길 코드가 이 폴더 밖의 파일을 가져오지 않는가 */
function isSelfContained(code: Uint8Array): boolean {
  return !RELATIVE_SPECIFIER.test(decoder.decode(code));
}

interface NewManifestInput {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly decl: Readonly<Record<string, unknown>>;
  readonly member: string;
  /** 떼기 전 확장 이름. `keepDependency`가 이 이름에 거는 줄을 더한다 */
  readonly originalName: string;
  readonly name: string;
  readonly keepDependency: boolean;
  readonly dependencyKind: "hard" | "soft";
  /** 엔트리 경로. 코드를 엔트리로 연결했을 때만 준다 */
  readonly entry: string | undefined;
  /** 목적 한 문장. 입력이 있으면 입력이, 없으면 원본의 `purpose`가 온다. 둘 다 없으면 undefined다 */
  readonly purpose: unknown;
  /** 원본의 `description`(그대로). 빈 글이거나 글이 아니면 싣지 않는다 */
  readonly description: unknown;
}

/**
 * 새 매니페스트. 원본의 `schemaVersion`과 `version`, 목적 한 문장(`purpose`)과 설명(`description`, 빈 글이 아닐 때만), 새 `name`,
 * 구성원 선언(뿌리가 되도록 `id`와 `defaultEnabled`를 뗀 것 하나), 그 구성원의 구성 블록(`plugin`을 뗀 것)을 싣는다.
 * `keepDependency`면 원래 이름에 거는 의존 한 줄을 더한다.
 */
function newManifest(input: NewManifestInput): Record<string, unknown> {
  const root = Object.fromEntries(
    Object.entries(input.decl).filter(([key]) => !MEMBER_ONLY_KEYS.has(key)),
  );
  const current = root["dependsOn"];
  // 기존 줄이 배열이 아니면 손대지 않는다. 그러면 검사가 거절한다. 같은 대상의 줄은 새 줄로 바꾼다
  const dependsOn =
    input.keepDependency && (current === undefined || Array.isArray(current))
      ? [
          ...arrayOf(current).filter(
            (line) => !(isRecord(line) && line["plugin"] === input.originalName),
          ),
          { plugin: input.originalName, kind: input.dependencyKind },
        ]
      : current;
  const blocks = movedBlocksOf(input.raw, input.member);
  return {
    schemaVersion: input.raw["schemaVersion"],
    name: input.name,
    version: input.raw["version"],
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    ...(typeof input.description === "string" && input.description.trim() !== ""
      ? { description: input.description }
      : {}),
    ...(input.entry === undefined ? {} : { entry: input.entry }),
    plugins: [{ ...root, ...(dependsOn === undefined ? {} : { dependsOn }) }],
    ...(blocks.length === 0 ? {} : { orchestration: { composition: { blocks } } }),
  };
}

/** 구성원의 구성 블록. `plugin`을 뗀다(뿌리 플러그인의 블록이 된다) */
function movedBlocksOf(
  raw: Readonly<Record<string, unknown>>,
  member: string,
): Record<string, unknown>[] {
  const orchestration = raw["orchestration"];
  const composition = isRecord(orchestration) ? orchestration["composition"] : undefined;
  const blocks = isRecord(composition) ? arrayOf(composition["blocks"]) : [];
  return blocks.flatMap((block) =>
    isRecord(block) && block["plugin"] === member
      ? [Object.fromEntries(Object.entries(block).filter(([key]) => key !== "plugin"))]
      : [],
  );
}

/** 떼어 낸 뿌리 플러그인의 엔트리. 뼈대 엔트리가 뿌리를 등록하듯 등록하고, 그 setup은 떼어 낸 코드다 */
function rootEntryText(member: string): string {
  return [
    'import type { ExtensionEntry } from "@fresnel/contracts/extensions";',
    'import { setup } from "./root.ts";',
    "",
    `// 구성원 ${member}을 독립 플러그인으로 떼어 낸 엔트리. 뿌리 플러그인 하나를 등록하고, 그 setup은 ${ROOT_CODE_PATH}의 setup이다.`,
    "const entry: ExtensionEntry = ({ manifest, register }) => {",
    "  register(manifest.name, {}, setup);",
    "};",
    "",
    "export default entry;",
    "",
  ].join("\n");
}

/** 매니페스트 검사 오류로 거절한다. 사유마다 코드와 매니페스트 안 경로를 싣는다(`members.ts`와 같은 모양) */
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

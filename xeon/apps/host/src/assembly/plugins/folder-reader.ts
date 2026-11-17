import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { assertNever, attempt, err, ok, parse, parseJson, type Result } from "@fresnel/contracts";
import { JsonValueSchema, type JsonValue } from "@fresnel/contracts/conversation";
import {
  ExtensionNameSchema,
  validateManifest,
  type ExtensionManifest,
  type PluginOriginKind,
} from "@fresnel/contracts/extensions";
import { Type, type Static } from "typebox";
import { compareUtf8, hashPluginTree, type TreeError, type TreeFile } from "./content-hash.ts";

// 원본 폴더 읽기(M5c §4.5.1~4). 폴더 하나를 검토에 올릴 플러그인 원본으로 읽는다.
// 코드는 실행하지 않는다. 결과가 오류 없이 나오면 재료와 매니페스트가 채워진다.

/** 매니페스트 위치(폴더 기준). `.mcp.json`은 인식하지 않는다(§4.5.3) */
const MANIFEST_PATH = ".fresnel-plugin/plugin.json";
const MCP_FILE = "mcp.json";
const SKILL_FILE = "SKILL.md";
const CODE_FILES: readonly string[] = ["plugin.ts", "plugin.js"];
/** 항상 싣는 지침 파일 상한(§4.5.3 표 아래, 65536바이트) */
export const INSTRUCTION_MAX_BYTES = 65536;
/** 목적 한 문장의 상한(매니페스트 `purpose`와 같다) */
const PURPOSE_MAX_CHARS = 200;
const SKILL_NAME_MAX_CHARS = 128;

interface InstructionMaterial {
  readonly path: string;
  readonly text: string;
  readonly bytes: number;
  readonly when: "always";
}
export interface SkillMaterial {
  readonly name: string;
  /** `SKILL.md`의 폴더 기준 상대 경로 */
  readonly path: string;
  /** 머리말 `description`. 없거나 비었으면 null */
  readonly description: string | null;
  /** 설명의 글자 수(코드 포인트). 설명이 없으면 0 */
  readonly descriptionChars: number;
  readonly when: "on_demand";
}
interface McpMaterial {
  readonly name: string;
  readonly transport: "stdio" | "http";
  readonly config: JsonValue;
  readonly when: "always";
}
interface AgentMaterial {
  readonly name: string;
  readonly path: string;
  readonly text: string;
  readonly when: "on_demand";
}
interface CommandMaterial {
  readonly name: string;
  readonly path: string;
  readonly text: string;
  readonly when: "on_demand";
}
export interface PluginMaterials {
  readonly instructions: readonly InstructionMaterial[];
  readonly skills: readonly SkillMaterial[];
  readonly mcpServers: readonly McpMaterial[];
  readonly agents: readonly AgentMaterial[];
  readonly commands: readonly CommandMaterial[];
}

type FolderDiagnosticCode =
  | "name_invalid"
  | "no_signal"
  | "manifest_required"
  | "manifest_invalid"
  | "tree_rejected"
  | "read_failed"
  | "not_utf8"
  | "instructions_too_large"
  | "path_outside"
  | "component_missing"
  | "entry_missing"
  | "code_not_declared"
  | "mcp_invalid"
  | "skill_name_fallback";

export interface FolderDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: FolderDiagnosticCode;
  /** 폴더 기준 경로. 알 수 없으면 `""` */
  readonly path: string;
  readonly message: string;
}

/** 후보가 되지 못한 이유 요약. 자세한 내용은 `diagnostics`에 있다 */
type FolderRejectKind =
  | "name_invalid"
  | "no_signal"
  | "manifest_required"
  | "manifest_invalid"
  | "tree_rejected"
  | "material_invalid";

export interface FolderRejection {
  readonly kind: FolderRejectKind;
  readonly diagnostics: readonly FolderDiagnostic[];
}

export interface PluginFolder {
  readonly name: string;
  readonly origin: PluginOriginKind;
  readonly manifest: ExtensionManifest;
  /** 매니페스트 파일이 없어서 신호에서 추론했는가. 추론한 매니페스트는 파일로 쓰지 않는다 */
  readonly inferred: boolean;
  readonly materials: PluginMaterials;
  readonly files: readonly TreeFile[];
  readonly contentHash: string;
  /** 경고만 있는 경우에 담긴다. 오류가 있으면 결과가 아니라 `FolderRejection`이다 */
  readonly diagnostics: readonly FolderDiagnostic[];
}

export interface ReadFolderOptions {
  /** 원본이 어디서 왔는가. 읽는 결과에 그대로 싣는다(읽기 방식은 출처와 무관하다) */
  readonly origin: PluginOriginKind;
}

const McpFileShape = Type.Object({ mcpServers: Type.Record(Type.String(), Type.Unknown()) });
const McpEntryShape = Type.Object({
  type: Type.Optional(Type.String()),
  command: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
});
type McpEntry = Static<typeof McpEntryShape>;

const UTF8 = new TextDecoder("utf-8", { fatal: true });

interface TextRead {
  readonly text: string;
  readonly bytes: number;
}
type TextFailure =
  | { readonly kind: "read_failed"; readonly cause: unknown }
  | { readonly kind: "not_utf8"; readonly cause: unknown };

/** 파일을 UTF-8로 읽는다. 바이트 수를 함께 준다 */
function readText(absPath: string): Result<TextRead, TextFailure> {
  const raw = attempt(() => readFileSync(absPath));
  if (!raw.ok) return err({ kind: "read_failed", cause: raw.error.cause });
  const text = attempt(() => UTF8.decode(raw.value));
  if (!text.ok) return err({ kind: "not_utf8", cause: text.error.cause });
  return ok({ text: text.value, bytes: raw.value.length });
}

function diagnostic(
  severity: FolderDiagnostic["severity"],
  code: FolderDiagnosticCode,
  path: string,
  message: string,
): FolderDiagnostic {
  return { severity, code, path, message };
}

function readFailure(path: string, failure: TextFailure): FolderDiagnostic {
  return failure.kind === "not_utf8"
    ? diagnostic("error", "not_utf8", path, "file is not valid UTF-8")
    : diagnostic("error", "read_failed", path, "file could not be read");
}

function treeDiagnostic(error: TreeError): FolderDiagnostic {
  switch (error.kind) {
    case "symlink_refused":
      return diagnostic("error", "tree_rejected", error.path, "symbolic link refused");
    case "node_modules_present":
      return diagnostic("error", "tree_rejected", error.path, "node_modules is not allowed");
    case "too_large":
      return diagnostic("error", "tree_rejected", "", `folder too large (${error.limit})`);
    case "unsupported_name":
      return diagnostic("error", "tree_rejected", error.path, "file name cannot be hashed");
    case "unsupported_entry":
      return diagnostic("error", "tree_rejected", error.path, "unsupported entry type");
    case "read_failed":
      return diagnostic("error", "read_failed", error.path, "folder entry could not be read");
    default:
      return assertNever(error, "treeDiagnostic");
  }
}

function reject(
  kind: FolderRejectKind,
  diagnostics: readonly FolderDiagnostic[],
): Result<never, FolderRejection> {
  return err({ kind, diagnostics: [...diagnostics] });
}

/** 폴더 기준 상대 경로 `raw`를 정규화한다. 폴더 밖을 가리키면 오류 진단을 남기고 undefined를 준다 */
function normalizeDeclared(raw: string, diagnostics: FolderDiagnostic[]): string | undefined {
  const trimmed = raw.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  const path = trimmed === "." ? "" : trimmed;
  if (path.startsWith("/") || path.split("/").includes("..")) {
    diagnostics.push(diagnostic("error", "path_outside", raw, "path must stay inside the folder"));
    return undefined;
  }
  return path;
}

/** `prefix/` 바로 아래의 파일 가운데 `suffix`로 끝나는 것. `prefix`가 `""`면 루트다 */
function childFiles(prefix: string, present: ReadonlySet<string>, suffix: string): string[] {
  const head = prefix === "" ? "" : `${prefix}/`;
  return [...present].filter(
    (path) =>
      path.startsWith(head) && path.endsWith(suffix) && !path.slice(head.length).includes("/"),
  );
}

/** `prefix`(폴더)의 스킬 파일들. `includeOwn`이면 `prefix/SKILL.md` 자체도 든다 */
function skillFilesUnder(
  prefix: string,
  present: ReadonlySet<string>,
  includeOwn: boolean,
): string[] {
  const out: string[] = [];
  const own = prefix === "" ? SKILL_FILE : `${prefix}/${SKILL_FILE}`;
  if (includeOwn && present.has(own)) out.push(own);
  const head = prefix === "" ? "" : `${prefix}/`;
  const tail = `/${SKILL_FILE}`;
  for (const path of present) {
    if (!path.startsWith(head) || !path.endsWith(tail)) continue;
    const middle = path.slice(head.length, path.length - tail.length);
    if (middle !== "" && !middle.includes("/")) out.push(path);
  }
  return out;
}

/** 매니페스트가 선언하지 않은 신호(§4.5.3 표). 선언이 있는 칸은 호출자가 선언을 쓴다 */
interface Conventions {
  readonly rootSkill: boolean;
  readonly skills: readonly string[];
  readonly instructions: readonly string[];
  readonly agents: readonly string[];
  readonly commands: readonly string[];
  readonly mcp: boolean;
  readonly code: string | undefined;
}

function conventionsOf(present: ReadonlySet<string>): Conventions {
  return {
    rootSkill: present.has(SKILL_FILE),
    skills: skillFilesUnder("skills", present, false),
    instructions: [
      ...(present.has("instructions.md") ? ["instructions.md"] : []),
      ...childFiles("instructions", present, ".md"),
    ],
    agents: childFiles("agents", present, ".md"),
    commands: childFiles("commands", present, ".md"),
    mcp: present.has(MCP_FILE),
    code: CODE_FILES.find((file) => present.has(file)),
  };
}

function declaredMdFiles(
  list: readonly string[],
  present: ReadonlySet<string>,
  diagnostics: FolderDiagnostic[],
): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const path = normalizeDeclared(raw, diagnostics);
    if (path === undefined) continue;
    if (present.has(path)) {
      if (path.endsWith(".md")) out.push(path);
      else {
        diagnostics.push(diagnostic("error", "component_missing", path, "not a .md file"));
      }
      continue;
    }
    const inside = childFiles(path, present, ".md");
    if (inside.length === 0) {
      diagnostics.push(diagnostic("error", "component_missing", path, "no .md file found"));
    }
    out.push(...inside);
  }
  return out;
}

function declaredSkillFiles(
  list: readonly string[],
  present: ReadonlySet<string>,
  diagnostics: FolderDiagnostic[],
): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const path = normalizeDeclared(raw, diagnostics);
    if (path === undefined) continue;
    const found = skillFilesUnder(path, present, true);
    if (found.length === 0) {
      diagnostics.push(diagnostic("error", "component_missing", path, "no SKILL.md found"));
    }
    out.push(...found);
  }
  return out;
}

/** 파일 이름에서 `.md`를 뗀 이름 */
function mdName(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.slice(0, -".md".length);
}

/** `SKILL.md`의 폴더 이름. 루트의 `SKILL.md`는 플러그인 폴더 이름이다 */
function skillFolderName(path: string, folderName: string): string {
  const parts = path.split("/");
  if (parts.length < 2) return folderName;
  return parts[parts.length - 2] ?? folderName;
}

/**
 * 머리말 `---` 블록에서 `키: 값` 한 줄씩만 읽는다. 값의 바깥 따옴표는 벗긴다(§4.5.3 간단한 형식).
 * 블록이 없거나 닫히지 않으면 빈 맵이다
 */
function parseFrontmatter(text: string): ReadonlyMap<string, string> {
  const fields = new Map<string, string>();
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  if (lines[0]?.trim() !== "---") return fields;
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") break;
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    const key = match?.[1];
    const raw = match?.[2];
    if (key === undefined || raw === undefined) continue;
    fields.set(key, unquote(raw.trim()));
  }
  return fields;
}

function unquote(value: string): string {
  const quoted =
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")));
  return quoted ? value.slice(1, -1) : value;
}

/** 목적 문장 상한. 코드 포인트 단위로 자른다 */
function capPurpose(text: string): string {
  return Array.from(text).slice(0, PURPOSE_MAX_CHARS).join("");
}

/** 스킬이 정확히 하나일 때만 그 설명을 목적으로 쓴다(§4.5.4). 여럿이면 null */
export function singleSkillPurpose(skills: readonly SkillMaterial[]): string | null {
  const only = skills.length === 1 ? skills[0] : undefined;
  const description = only?.description ?? null;
  return description === null ? null : capPurpose(description);
}

function readManifest(dir: string, diagnostics: FolderDiagnostic[]): ExtensionManifest | undefined {
  const read = readText(join(dir, MANIFEST_PATH));
  if (!read.ok) {
    diagnostics.push(readFailure(MANIFEST_PATH, read.error));
    return undefined;
  }
  const json = parseJson(read.value.text);
  if (!json.ok) {
    diagnostics.push(diagnostic("error", "manifest_invalid", MANIFEST_PATH, "not valid JSON"));
    return undefined;
  }
  const result = validateManifest(json.value);
  for (const issue of result.issues) {
    const path = issue.path === "" ? MANIFEST_PATH : `${MANIFEST_PATH}#${issue.path}`;
    diagnostics.push(
      diagnostic(issue.severity, "manifest_invalid", path, `${issue.code}: ${issue.message}`),
    );
  }
  const failed = result.issues.some((issue) => issue.severity === "error");
  if (failed || result.manifest === undefined) return undefined;
  return result.manifest;
}

function transportOf(entry: McpEntry): "stdio" | "http" | undefined {
  const kind = entry.type?.toLowerCase() ?? "stdio";
  if (kind === "stdio") {
    return entry.command !== undefined && entry.command.length > 0 ? "stdio" : undefined;
  }
  if (kind === "http" || kind === "streamable-http" || kind === "sse") {
    return entry.url !== undefined ? "http" : undefined;
  }
  return undefined;
}

/** `mcp.json`의 서버 항목. `sse`도 원격 전송이라 `http`로 적는다. 잘못된 항목은 진단이다 */
function readMcpServers(
  text: string,
  path: string,
  diagnostics: FolderDiagnostic[],
): McpMaterial[] {
  const json = parseJson(text);
  if (!json.ok) {
    diagnostics.push(diagnostic("error", "mcp_invalid", path, "not valid JSON"));
    return [];
  }
  const file = parse(McpFileShape, json.value);
  if (!file.ok) {
    diagnostics.push(diagnostic("error", "mcp_invalid", path, "no mcpServers object"));
    return [];
  }
  const servers: McpMaterial[] = [];
  for (const [name, raw] of Object.entries(file.value.mcpServers)) {
    const entry = parse(McpEntryShape, raw);
    const transport = entry.ok ? transportOf(entry.value) : undefined;
    const config = parse(JsonValueSchema, raw);
    if (!entry.ok || transport === undefined || !config.ok) {
      diagnostics.push(diagnostic("error", "mcp_invalid", path, `server "${name}" is invalid`));
      continue;
    }
    servers.push({ name, transport, config: config.value, when: "always" });
  }
  return servers;
}

/** 중복을 없애고 경로 순으로 정렬한다. 결과가 파일 나열 순서와 무관하도록 한다 */
function sortPaths(paths: readonly string[]): string[] {
  return [...new Set(paths)].toSorted(compareUtf8);
}

function inferManifest(
  name: string,
  contentHash: string,
  skills: readonly SkillMaterial[],
): ExtensionManifest {
  const purpose = singleSkillPurpose(skills);
  const hash8 = contentHash.slice("sha256:".length, "sha256:".length + 8);
  return {
    schemaVersion: 2,
    name,
    // 빌드 메타데이터(`+`)는 SemVerSchema가 받지 않으므로 프리릴리스 자리를 쓴다 [스펙과 다름]
    version: `0.0.0-${hash8}`,
    plugins: [{ layer: "plugin", hooks: [] }],
    ...(purpose === null ? {} : { purpose }),
  };
}

/**
 * 폴더 하나를 읽는다. 결과가 오류 없이 나오면 `PluginFolder`, 아니면 `FolderRejection`이다.
 * 동기 호출이다(재료 포트가 동기다). 매니페스트가 있으면 선언이 우선하고 신호는 선언하지 않은 칸만 채운다.
 */
export function readPluginFolder(
  dir: string,
  options: ReadFolderOptions,
): Result<PluginFolder, FolderRejection> {
  const tree = hashPluginTree(dir);
  if (!tree.ok) return reject("tree_rejected", [treeDiagnostic(tree.error)]);
  const { files, contentHash } = tree.value;
  const present: ReadonlySet<string> = new Set(files.map((file) => file.path));
  const folderName = basename(resolve(dir));
  const diagnostics: FolderDiagnostic[] = [];

  let manifest: ExtensionManifest | undefined;
  if (present.has(MANIFEST_PATH)) {
    manifest = readManifest(dir, diagnostics);
    if (manifest === undefined) return reject("manifest_invalid", diagnostics);
  }

  if (manifest === undefined && !parse(ExtensionNameSchema, folderName).ok) {
    diagnostics.push(
      diagnostic(
        "error",
        "name_invalid",
        "",
        `folder name "${folderName}" is not a valid plugin name`,
      ),
    );
    return reject("name_invalid", diagnostics);
  }

  const convention = conventionsOf(present);
  if (manifest === undefined) {
    const hasSignal =
      convention.rootSkill ||
      convention.skills.length > 0 ||
      convention.instructions.length > 0 ||
      convention.agents.length > 0 ||
      convention.commands.length > 0 ||
      convention.mcp ||
      convention.code !== undefined;
    if (!hasSignal) {
      diagnostics.push(diagnostic("error", "no_signal", "", "no plugin signal and no manifest"));
      return reject("no_signal", diagnostics);
    }
    if (convention.code !== undefined) {
      diagnostics.push(
        diagnostic("error", "manifest_required", convention.code, "code plugin needs a manifest"),
      );
      return reject("manifest_required", diagnostics);
    }
  }

  const declared = manifest?.components;
  const instructionPaths =
    declared?.instructions !== undefined
      ? declaredMdFiles(declared.instructions, present, diagnostics)
      : convention.instructions;
  const skillPaths: readonly string[] =
    declared?.skills !== undefined
      ? declaredSkillFiles(declared.skills, present, diagnostics)
      : [...(convention.rootSkill ? [SKILL_FILE] : []), ...convention.skills];
  const agentPaths =
    declared?.agents !== undefined
      ? declaredMdFiles(declared.agents, present, diagnostics)
      : convention.agents;
  const commandPaths =
    declared?.commands !== undefined
      ? declaredMdFiles(declared.commands, present, diagnostics)
      : convention.commands;

  // 지침: 항상 싣는다
  const instructions: InstructionMaterial[] = [];
  for (const path of sortPaths(instructionPaths)) {
    const read = readText(join(dir, path));
    if (!read.ok) {
      diagnostics.push(readFailure(path, read.error));
      continue;
    }
    if (read.value.bytes > INSTRUCTION_MAX_BYTES) {
      diagnostics.push(
        diagnostic("error", "instructions_too_large", path, `over ${INSTRUCTION_MAX_BYTES} bytes`),
      );
      continue;
    }
    instructions.push({ path, text: read.value.text, bytes: read.value.bytes, when: "always" });
  }

  // 스킬: 머리말에서 이름과 설명만 읽고 본문은 필요할 때 읽는다
  const skills: SkillMaterial[] = [];
  for (const path of sortPaths(skillPaths)) {
    const read = readText(join(dir, path));
    if (!read.ok) {
      diagnostics.push(readFailure(path, read.error));
      continue;
    }
    const fields = parseFrontmatter(read.value.text);
    const declaredName = fields.get("name")?.trim() ?? "";
    let name = skillFolderName(path, folderName);
    if (declaredName !== "" && declaredName.length <= SKILL_NAME_MAX_CHARS) {
      name = declaredName;
    } else if (declaredName !== "") {
      diagnostics.push(
        diagnostic("warning", "skill_name_fallback", path, "name too long, using folder name"),
      );
    }
    const described = (fields.get("description") ?? "").trim();
    const description = described === "" ? null : described;
    skills.push({
      name,
      path,
      description,
      descriptionChars: description === null ? 0 : Array.from(description).length,
      when: "on_demand",
    });
  }

  // 에이전트와 명령: 본문을 싣고 필요할 때 쓴다
  const agents: AgentMaterial[] = [];
  for (const path of sortPaths(agentPaths)) {
    const read = readText(join(dir, path));
    if (!read.ok) {
      diagnostics.push(readFailure(path, read.error));
      continue;
    }
    agents.push({ name: mdName(path), path, text: read.value.text, when: "on_demand" });
  }
  const commands: CommandMaterial[] = [];
  for (const path of sortPaths(commandPaths)) {
    const read = readText(join(dir, path));
    if (!read.ok) {
      diagnostics.push(readFailure(path, read.error));
      continue;
    }
    commands.push({ name: mdName(path), path, text: read.value.text, when: "on_demand" });
  }

  // MCP 서버: 선언이 있으면 그 경로, 없으면 루트 mcp.json
  let mcpServers: McpMaterial[] = [];
  const mcpPath =
    declared?.mcpServers !== undefined
      ? normalizeDeclared(declared.mcpServers, diagnostics)
      : convention.mcp
        ? MCP_FILE
        : undefined;
  if (mcpPath !== undefined) {
    if (!present.has(mcpPath)) {
      diagnostics.push(diagnostic("error", "component_missing", mcpPath, "mcp file not found"));
    } else {
      const read = readText(join(dir, mcpPath));
      if (!read.ok) diagnostics.push(readFailure(mcpPath, read.error));
      else mcpServers = readMcpServers(read.value.text, mcpPath, diagnostics);
    }
  }

  // 코드: 매니페스트의 entry가 있으면 코드 플러그인이다. 파일이 있어도 entry가 없으면 실행하지 않는다
  if (manifest !== undefined) {
    if (manifest.entry !== undefined) {
      const entry = normalizeDeclared(manifest.entry, diagnostics);
      if (entry !== undefined && !present.has(entry)) {
        diagnostics.push(diagnostic("error", "entry_missing", entry, "entry file not found"));
      }
    } else if (convention.code !== undefined) {
      diagnostics.push(
        diagnostic(
          "warning",
          "code_not_declared",
          convention.code,
          "code file exists but manifest has no entry",
        ),
      );
    }
  }

  const materials: PluginMaterials = {
    instructions,
    skills,
    mcpServers,
    agents,
    commands,
  };
  if (diagnostics.some((item) => item.severity === "error")) {
    return reject("material_invalid", diagnostics);
  }
  const finalManifest = manifest ?? inferManifest(folderName, contentHash, skills);
  return ok({
    name: finalManifest.name,
    origin: options.origin,
    manifest: finalManifest,
    inferred: manifest === undefined,
    materials,
    files,
    contentHash,
    diagnostics,
  });
}

import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { attempt, err, ok, type Result } from "@xeon/contracts";
import type { FsEntry, KnowledgeFs } from "../fs/port.ts";
import { utf8DecodeStrict } from "../hash.ts";

// pi `packages/coding-agent/src/core/skills.ts`(커밋 cdaf6c2, MIT)의 포크다. 탐색 규칙, 이름·설명 검증, 이름 충돌 진단은
// 원본 그대로이고 바꾼 줄에는 `XEON-PATCH` 표지와 패치 id를 단다. 패치 목록은 PATCHES.md, 근거는 L2.knowledge.plan §4.1이다.

/** Max name length per spec */
const MAX_NAME_LENGTH = 64;

/** Max description length per spec */
const MAX_DESCRIPTION_LENGTH = 1024;

/** 프론트매터 중첩 깊이 상한. 별칭이 만든 깊은 구조를 순환과 같게 거부한다 */
const MAX_FRONTMATTER_DEPTH = 64;

/** 디렉터리 재귀 깊이 상한(심볼릭 링크 순환 말고도 병적으로 깊은 트리를 막는다) */
const MAX_DISCOVERY_DEPTH = 16;

// XEON-PATCH: KN-05
type SkillSourceScope = "project" | "user" | "extension" | "path";

// XEON-PATCH: KN-05
export interface SkillSource {
  readonly scope: SkillSourceScope;
  /** 이 스킬을 찾은 스킬 루트(디렉터리 또는 `paths`로 준 파일) */
  readonly root: string;
  /** scope가 extension일 때 스킬 경로를 더한 확장 이름 */
  readonly extension?: string;
}

// XEON-PATCH: KN-05
export interface SkillDiagnostic {
  readonly type: "warning" | "collision";
  readonly message: string;
  readonly path: string;
}

type SkillFrontmatter = Readonly<Record<string, unknown>>;

export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  // XEON-PATCH: KN-05
  /** dir: `SKILL.md`를 가진 디렉터리. file: 루트 바로 아래의 단일 `.md` 파일 */
  layout: "dir" | "file";
  // XEON-PATCH: KN-05
  source: SkillSource;
  disableModelInvocation: boolean;
}

export interface LoadSkillsResult {
  skills: Skill[];
  diagnostics: SkillDiagnostic[];
}

// XEON-PATCH: KN-01
/** 스킬 루트 넷. 경로는 `skills/roots.ts`가 `xeon.os`와 설정에서 만든다 */
export interface SkillRoots {
  readonly project?: string;
  readonly user: string;
  readonly extension: readonly { readonly dir: string; readonly extension: string }[];
  readonly paths: readonly string[];
}

// XEON-PATCH: KN-02
export type FrontmatterError =
  | { readonly kind: "frontmatter_yaml"; readonly message: string }
  | { readonly kind: "frontmatter_not_object" }
  | { readonly kind: "frontmatter_cyclic" };

export interface ParsedFrontmatter {
  readonly frontmatter: SkillFrontmatter;
  readonly body: string;
}

// XEON-PATCH: KN-02
const normalizeNewlines = (value: string): string =>
  value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

// XEON-PATCH: KN-02
const BOM = String.fromCodePoint(0xfeff);

const stripBom = (value: string): string => (value.startsWith(BOM) ? value.slice(1) : value);

// XEON-PATCH: KN-02
const extractFrontmatter = (content: string): { yamlString: string | null; body: string } => {
  const normalized = normalizeNewlines(stripBom(content));

  if (!normalized.startsWith("---")) {
    return { yamlString: null, body: normalized };
  }

  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { yamlString: null, body: normalized };
  }

  return {
    yamlString: normalized.slice(4, endIndex),
    body: normalized.slice(endIndex + 4).trim(),
  };
};

// XEON-PATCH: KN-02
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// XEON-PATCH: KN-02
/** YAML 별칭은 순환 객체를 만들 수 있다. 순환이거나 너무 깊으면 참이다. 방문을 끝낸 노드는 다시 보지 않는다 */
function containsCycle(
  value: unknown,
  state: Map<object, "open" | "done">,
  depth: number,
): boolean {
  if (typeof value !== "object" || value === null) return false;
  const seen = state.get(value);
  if (seen === "open") return true;
  if (seen === "done") return false;
  if (depth > MAX_FRONTMATTER_DEPTH) return true;
  state.set(value, "open");
  const children: unknown[] = Array.isArray(value) ? value : Object.values(value);
  const cyclic = children.some((child) => containsCycle(child, state, depth + 1));
  state.set(value, "done");
  return cyclic;
}

// XEON-PATCH: KN-02
export const parseFrontmatter = (content: string): Result<ParsedFrontmatter, FrontmatterError> => {
  const { yamlString, body } = extractFrontmatter(content);
  if (!yamlString) {
    return ok({ frontmatter: {}, body });
  }
  const yaml = attempt((): unknown => Bun.YAML.parse(yamlString));
  if (!yaml.ok) {
    const cause = yaml.error.cause;
    return err({
      kind: "frontmatter_yaml",
      message: cause instanceof Error ? cause.message : "invalid YAML",
    });
  }
  const parsed = yaml.value;
  if (parsed === null || parsed === undefined) return ok({ frontmatter: {}, body });
  if (!isRecord(parsed)) return err({ kind: "frontmatter_not_object" });
  if (containsCycle(parsed, new Map(), 0)) return err({ kind: "frontmatter_cyclic" });
  return ok({ frontmatter: parsed, body });
};

/**
 * Validate skill name per Agent Skills spec.
 * Returns array of validation error messages (empty if valid).
 */
function validateName(name: string): string[] {
  const errors: string[] = [];

  if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push(`name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)`);
  }

  if (name.startsWith("-") || name.endsWith("-")) {
    errors.push(`name must not start or end with a hyphen`);
  }

  if (name.includes("--")) {
    errors.push(`name must not contain consecutive hyphens`);
  }

  return errors;
}

/**
 * Validate description per Agent Skills spec.
 */
function validateDescription(description: unknown): string[] {
  const errors: string[] = [];

  if (typeof description !== "string" || description.trim() === "") {
    errors.push("description is required");
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`);
  }

  return errors;
}

// XEON-PATCH: KN-04
// pi의 `.gitignore` 계열 규칙(`ignore` 패키지, `addIgnoreRules`, `prefixIgnorePattern`)은 옮기지 않았다. 스킬 루트에는 무시 규칙을 적용하지 않는다.

// XEON-PATCH: KN-06
// pi의 `formatSkillsForPrompt`와 `escapeXml`은 옮기지 않았다. 인덱스 블록은 `skills/prompt-block.ts`가 만든다(예산, `skill_view` 안내, `<location>` 없음).

// XEON-PATCH: KN-03
/** 탐색 한 번이 공유하는 파일 포트. 동기 fs 호출이 모두 이 포트의 비동기 호출로 바뀌었다 */
interface DiscoveryContext {
  readonly fs: KnowledgeFs;
}

// XEON-PATCH: KN-03
/** 심볼릭 링크는 가리키는 종류로 본다. 깨진 링크는 undefined */
async function resolvedKind(
  ctx: DiscoveryContext,
  fullPath: string,
  entry: FsEntry,
): Promise<"file" | "directory" | "other" | undefined> {
  if (entry.kind !== "symlink") return entry.kind;
  const stats = await ctx.fs.stat(fullPath);
  return stats.ok ? stats.value.kind : undefined;
}

/**
 * Load skills from a directory.
 *
 * Discovery rules:
 * - if a directory contains SKILL.md, treat it as a skill root and do not recurse further
 * - otherwise, load direct .md children in the root
 * - recurse into subdirectories to find SKILL.md
 */
// XEON-PATCH: KN-03
export async function loadSkillsFromDir(
  fs: KnowledgeFs,
  dir: string,
  source: SkillSource,
): Promise<LoadSkillsResult> {
  const ctx: DiscoveryContext = { fs };
  const real = await fs.realpath(dir);
  return loadSkillsFromDirInternal(ctx, dir, source, true, new Set(real.ok ? [real.value] : []), 0);
}

// XEON-PATCH: KN-03
async function loadSkillsFromDirInternal(
  ctx: DiscoveryContext,
  dir: string,
  source: SkillSource,
  includeRootFiles: boolean,
  // XEON-PATCH: KN-09
  ancestors: ReadonlySet<string>,
  depth: number,
): Promise<LoadSkillsResult> {
  const skills: Skill[] = [];
  const diagnostics: SkillDiagnostic[] = [];

  const listed = await ctx.fs.list(dir);
  if (!listed.ok) {
    if (listed.error.kind !== "not_found") {
      diagnostics.push({
        type: "warning",
        message: `cannot read directory (${listed.error.code || listed.error.kind})`,
        path: dir,
      });
    }
    return { skills, diagnostics };
  }
  const entries = listed.value;

  const declared = entries.find((entry) => entry.name === "SKILL.md");
  if (declared !== undefined) {
    const fullPath = join(dir, declared.name);
    const kind = await resolvedKind(ctx, fullPath, declared);
    if (kind === "file") {
      const result = await loadSkillFromFile(ctx, fullPath, source);
      if (result.skill) {
        skills.push(result.skill);
      }
      diagnostics.push(...result.diagnostics);
      return { skills, diagnostics };
    }
  }

  // XEON-PATCH: KN-08
  // 항목마다 병렬로 처리하되 결과는 항목 순서(이름 바이트 순)로 이어 붙인다. 순서가 실행 순서에 달리지 않는다
  const parts = await Promise.all(
    entries.map(async (entry): Promise<LoadSkillsResult> => {
      const empty: LoadSkillsResult = { skills: [], diagnostics: [] };
      if (entry.name.startsWith(".")) {
        return empty;
      }

      // Skip node_modules to avoid scanning dependencies
      if (entry.name === "node_modules") {
        return empty;
      }

      const fullPath = join(dir, entry.name);

      // For symlinks, check if they point to a directory and follow them
      const kind = await resolvedKind(ctx, fullPath, entry);
      // Broken symlink, skip it
      if (kind === undefined) {
        return empty;
      }

      if (kind === "directory") {
        // XEON-PATCH: KN-09
        if (depth >= MAX_DISCOVERY_DEPTH) {
          return {
            skills: [],
            diagnostics: [
              { type: "warning", message: "directory is nested too deeply", path: fullPath },
            ],
          };
        }
        const real = await ctx.fs.realpath(fullPath);
        const realPath = real.ok ? real.value : undefined;
        if (realPath !== undefined && ancestors.has(realPath)) {
          return {
            skills: [],
            diagnostics: [{ type: "warning", message: "symlink loop skipped", path: fullPath }],
          };
        }
        const nextAncestors =
          realPath === undefined ? ancestors : new Set([...ancestors, realPath]);
        return loadSkillsFromDirInternal(ctx, fullPath, source, false, nextAncestors, depth + 1);
      }

      if (kind !== "file" || !includeRootFiles || !entry.name.endsWith(".md")) {
        return empty;
      }

      const result = await loadSkillFromFile(ctx, fullPath, source);
      return {
        skills: result.skill ? [result.skill] : [],
        diagnostics: result.diagnostics,
      };
    }),
  );
  for (const part of parts) {
    skills.push(...part.skills);
    diagnostics.push(...part.diagnostics);
  }

  return { skills, diagnostics };
}

// XEON-PATCH: KN-03
async function loadSkillFromFile(
  ctx: DiscoveryContext,
  filePath: string,
  source: SkillSource,
): Promise<{ skill: Skill | null; diagnostics: SkillDiagnostic[] }> {
  const diagnostics: SkillDiagnostic[] = [];
  const isDeclaredSkill = basename(filePath) === "SKILL.md";

  const read = await ctx.fs.readFile(filePath);
  if (!read.ok) {
    const message = `failed to read skill file (${read.error.code || read.error.kind})`;
    diagnostics.push({ type: "warning", message, path: filePath });
    return { skill: null, diagnostics };
  }
  // XEON-PATCH: KN-03
  const rawContent = utf8DecodeStrict(read.value);
  if (rawContent === undefined) {
    diagnostics.push({ type: "warning", message: "skill file is not valid UTF-8", path: filePath });
    return { skill: null, diagnostics };
  }

  const parsed = parseFrontmatter(rawContent);
  if (!parsed.ok) {
    if (isDeclaredSkill) {
      const message =
        parsed.error.kind === "frontmatter_yaml"
          ? parsed.error.message
          : parsed.error.kind === "frontmatter_cyclic"
            ? "frontmatter contains a cyclic or too deeply nested structure"
            : "frontmatter is not a mapping";
      diagnostics.push({ type: "warning", message, path: filePath });
    }
    return { skill: null, diagnostics };
  }
  const { frontmatter } = parsed.value;

  const description = frontmatter["description"];
  const hasDescription = typeof description === "string" && description.trim() !== "";
  if (!isDeclaredSkill && !hasDescription) {
    return { skill: null, diagnostics };
  }

  const skillDir = dirname(filePath);
  const parentDirName = basename(skillDir);

  // Validate description
  const descErrors = validateDescription(description);
  for (const error of descErrors) {
    diagnostics.push({ type: "warning", message: error, path: filePath });
  }

  // Use name from frontmatter, or fall back to parent directory name
  const frontmatterName = typeof frontmatter["name"] === "string" ? frontmatter["name"] : undefined;
  const name = frontmatterName || parentDirName;

  // Validate name
  const nameErrors = validateName(name);
  for (const error of nameErrors) {
    diagnostics.push({ type: "warning", message: error, path: filePath });
  }

  // Still load the skill even with warnings, unless description is missing or empty.
  if (!hasDescription) {
    return { skill: null, diagnostics };
  }

  return {
    skill: {
      name,
      description,
      filePath,
      baseDir: skillDir,
      layout: isDeclaredSkill ? "dir" : "file",
      source,
      disableModelInvocation: frontmatter["disable-model-invocation"] === true,
    },
    diagnostics,
  };
}

// XEON-PATCH: KN-03
async function canonicalize(fs: KnowledgeFs, path: string): Promise<string> {
  const real = await fs.realpath(path);
  return real.ok ? real.value : path;
}

/**
 * Load skills from all configured locations.
 * Returns skills and any validation diagnostics.
 */
// XEON-PATCH: KN-01
export async function loadSkills(fs: KnowledgeFs, roots: SkillRoots): Promise<LoadSkillsResult> {
  const skillMap = new Map<string, Skill>();
  const realPathSet = new Set<string>();
  const allDiagnostics: SkillDiagnostic[] = [];
  const collisionDiagnostics: SkillDiagnostic[] = [];

  function addSkills(result: LoadSkillsResult, realPaths: readonly string[]): void {
    allDiagnostics.push(...result.diagnostics);
    result.skills.forEach((skill, index) => {
      const realPath = realPaths[index] ?? skill.filePath;

      // Skip silently if we've already loaded this exact file (via symlink)
      if (realPathSet.has(realPath)) {
        return;
      }

      const existing = skillMap.get(skill.name);
      if (existing) {
        collisionDiagnostics.push({
          type: "collision",
          message: `name "${skill.name}" collision, kept ${existing.filePath}`,
          path: skill.filePath,
        });
      } else {
        skillMap.set(skill.name, skill);
        realPathSet.add(realPath);
      }
    });
  }

  // XEON-PATCH: KN-07
  // 프로젝트 → 사용자 → 확장 제공 → 설정 경로 순이다(pi는 사용자 → 프로젝트). 앞 루트가 이름 충돌에서 이긴다
  const sources: { readonly dir: string; readonly source: SkillSource }[] = [];
  if (roots.project !== undefined) {
    sources.push({ dir: roots.project, source: { scope: "project", root: roots.project } });
  }
  sources.push({ dir: roots.user, source: { scope: "user", root: roots.user } });
  for (const extension of roots.extension) {
    sources.push({
      dir: extension.dir,
      source: { scope: "extension", root: extension.dir, extension: extension.extension },
    });
  }
  const loaded = await Promise.all(
    sources.map((entry) => loadSkillsFromDir(fs, entry.dir, entry.source)),
  );
  const pathResults = await Promise.all(roots.paths.map((rawPath) => loadSkillPath(fs, rawPath)));
  const results = [...loaded, ...pathResults];
  // Resolve symlinks to detect duplicate files
  const realPaths = await Promise.all(
    results.map((result) =>
      Promise.all(result.skills.map((skill) => canonicalize(fs, skill.filePath))),
    ),
  );
  results.forEach((result, index) => {
    addSkills(result, realPaths[index] ?? []);
  });

  return {
    skills: Array.from(skillMap.values()),
    diagnostics: [...allDiagnostics, ...collisionDiagnostics],
  };
}

// XEON-PATCH: KN-01
/** 설정 경로(`l2.knowledge.skills.paths`) 하나: 디렉터리 또는 `.md` 파일 */
async function loadSkillPath(fs: KnowledgeFs, rawPath: string): Promise<LoadSkillsResult> {
  const skills: Skill[] = [];
  if (!isAbsolute(rawPath.trim())) {
    return {
      skills,
      diagnostics: [{ type: "warning", message: "skill path must be absolute", path: rawPath }],
    };
  }
  const resolvedPath = resolve(rawPath.trim());
  const source: SkillSource = { scope: "path", root: resolvedPath };
  const stats = await fs.stat(resolvedPath);
  if (!stats.ok) {
    const message =
      stats.error.kind === "not_found"
        ? "skill path does not exist"
        : `failed to read skill path (${stats.error.code || stats.error.kind})`;
    return { skills, diagnostics: [{ type: "warning", message, path: resolvedPath }] };
  }
  if (stats.value.kind === "directory") {
    return loadSkillsFromDir(fs, resolvedPath, source);
  }
  if (stats.value.kind === "file" && resolvedPath.endsWith(".md")) {
    const result = await loadSkillFromFile({ fs }, resolvedPath, source);
    return { skills: result.skill ? [result.skill] : [], diagnostics: result.diagnostics };
  }
  return {
    skills,
    diagnostics: [
      { type: "warning", message: "skill path is not a markdown file", path: resolvedPath },
    ],
  };
}

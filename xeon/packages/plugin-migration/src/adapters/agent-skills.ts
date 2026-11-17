// Agent Skills 형식의 스킬 폴더(`<부모>/<이름>/SKILL.md`)를 읽기 전용으로 훑어 SourceItem으로 만든다.
// 실행하지 않는다: 본문의 `` !`cmd` ``와 치환은 세기만 하고 어느 것도 펼치지 않는다.
// 설계: docs/xeon/review/m5/migration.md §3.1(사양), §4.3.3(매핑), §5.1(약속), §10 수용 기준 1·3·9.
import { eachAsync, err, ok, type Result } from "@fresnel/contracts";
import { parseDocument, type FrontmatterValue } from "../frontmatter.ts";
import { itemIdOf, sha256Hex } from "../hash.ts";
import { displayPath, joinPath } from "../paths.ts";
import { looksLikeSecretName, looksLikeSecretValue } from "../secrets.ts";
import type {
  HarnessId,
  IrField,
  IrSkill,
  ScanContext,
  ScanDiagnostic,
  ScanFs,
  ScanLimits,
  SourceAdapter,
  SourceItem,
} from "../types.ts";

const HARNESS: HarnessId = "agent-skills";
const SKILL_FILE = "SKILL.md";
const SUMMARY_MAX_CHARS = 80;

/** 복사본에 그대로 실려 처리가 필요 없는 머리말 키. 항목을 만들지 않는다(§4.3.3). `name`과 `description`은 IR이 싣는다 */
const PASS_THROUGH_KEYS: ReadonlySet<string> = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "disable-model-invocation",
]);

/** 본문 치환 종류. 코드 펜스 밖에서만 센다. 종류마다 항목 하나다 */
const BODY_PATTERNS: readonly { readonly key: string; readonly pattern: RegExp }[] = [
  { key: "shell-injection", pattern: /!`[^`\n]+`/g },
  { key: "skill-dir-var", pattern: /\$\{CLAUDE_SKILL_DIR\}/g },
  {
    key: "argument-substitution",
    pattern: /\$ARGUMENTS|\$[1-9](?!\d)|\$\{CLAUDE_SESSION_ID\}|\$\{CLAUDE_PROJECT_DIR\}/g,
  },
];

interface SkillFile {
  /** 스킬 폴더 기준 상대 경로(`/` 구분) */
  readonly path: string;
  readonly bytes: Uint8Array;
  /** SKILL.md를 텍스트로 읽었을 때만 든다(머리말을 읽으려고) */
  readonly text: string | undefined;
}

interface WalkState {
  readonly fs: ScanFs;
  readonly limits: ScanLimits;
  readonly homeDir: string;
  /** 진단에 쓰는 스킬 폴더의 표시 경로 */
  readonly skillPath: string;
  readonly files: SkillFile[];
  /** 건너뛴 항목(symlink 등). 스킬은 그대로 나간다 */
  readonly skipped: ScanDiagnostic[];
  total: number;
}

interface SkillBuildInput {
  readonly folderName: string;
  readonly folderPath: string;
  readonly mainPath: string;
  readonly files: readonly SkillFile[];
  readonly main: SkillFile;
  readonly scope: "user" | "project";
  readonly harness: HarnessId;
  readonly rootLabel: string;
}

interface FieldInput {
  readonly harness: HarnessId;
  readonly scope: "user" | "project";
  readonly rootLabel: string;
  readonly mainPath: string;
  readonly keyPath: string;
  readonly ir: IrField;
  /** 내용 해시와 바이트의 원천. 머리말 값 또는 본문 치환 목록의 JSON */
  readonly digest: string;
}

function diag(code: ScanDiagnostic["code"], path: string, message: string): ScanDiagnostic {
  return { code, path, message };
}

function scalarText(value: FrontmatterValue | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/** 필드 값 요약. 짧은 문자열·불리언·숫자만 싣고, 목록·맵·긴 값·시크릿 모양은 싣지 않는다 */
function summaryOf(key: string, value: FrontmatterValue): string | undefined {
  if (looksLikeSecretName(key)) return undefined;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value !== "string") return undefined;
  if (looksLikeSecretValue(value)) return undefined;
  // UTF-16 단위로 센다. 한글과 ASCII는 글자 수와 같고, 상한은 요약을 짧게 두려는 값이라 정확한 글자 수는 필요 없다
  return value.length <= SUMMARY_MAX_CHARS ? value : undefined;
}

/** 코드 펜스(```) 안을 뺀 본문. 펜스 줄 자체도 뺀다 */
function outsideFences(body: string): string {
  const kept: string[] = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) kept.push(line);
  }
  return kept.join("\n");
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** 파일 경로 순(이미 정렬됨)으로 `경로\0길이\0바이트`를 이어 붙여 해시한다. 같은 내용이면 같은 값 */
function skillDigest(files: readonly SkillFile[]): string {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const file of files) {
    parts.push(encoder.encode(`${file.path}\u0000${file.bytes.length}\u0000`), file.bytes);
  }
  return sha256Hex(concatBytes(parts));
}

function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function fieldItem(input: FieldInput): SourceItem {
  return {
    itemId: itemIdOf([input.harness, "field", input.scope, input.mainPath, input.keyPath]),
    harness: input.harness,
    kind: "field",
    scope: input.scope,
    rootLabel: input.rootLabel,
    path: input.mainPath,
    keyPath: input.keyPath,
    sha256: sha256Hex(input.digest),
    bytes: new TextEncoder().encode(input.digest).length,
    ir: input.ir,
    secrets: [],
    warnings: [],
  };
}

/** 디렉터리 하나의 항목을 이름 순으로 차례로 읽는다(결과가 순서에 달려 있으므로 병렬로 읽지 않는다) */
async function walkDir(
  state: WalkState,
  absDir: string,
  relDir: string,
  depth: number,
): Promise<Result<true, ScanDiagnostic>> {
  const names = (await state.fs.listDir(absDir)).toSorted(byCodeUnit);
  const stopped = await eachAsync(names, async (name) => {
    const failure = await walkEntry(state, absDir, relDir, depth, name);
    return failure === undefined ? undefined : { value: failure };
  });
  return stopped === undefined ? ok(true) : err(stopped.value);
}

/** 항목 하나. 상한이나 읽기 실패면 스킬을 건너뛸 진단을, 그 밖이면 undefined를 돌려준다 */
async function walkEntry(
  state: WalkState,
  absDir: string,
  relDir: string,
  depth: number,
  name: string,
): Promise<ScanDiagnostic | undefined> {
  const absPath = joinPath(absDir, name);
  const relPath = relDir === "" ? name : `${relDir}/${name}`;
  const pathShown = displayPath(absPath, state.homeDir);
  const stat = await state.fs.lstat(absPath);
  if (stat === null) {
    state.skipped.push(diag("unreadable", pathShown, "훑는 중에 사라졌다. 이 항목은 건너뛰었다"));
    return undefined;
  }
  if (stat.kind === "symlink") {
    state.skipped.push(diag("unreadable", pathShown, "심볼릭 링크라 따라가지 않았다"));
    return undefined;
  }
  if (stat.kind === "other") {
    state.skipped.push(diag("unreadable", pathShown, "일반 파일이나 폴더가 아니라 읽지 않았다"));
    return undefined;
  }
  if (stat.kind === "dir") {
    if (depth + 1 > state.limits.maxDepth) {
      return diag(
        "limit",
        state.skillPath,
        `폴더 깊이 상한(${state.limits.maxDepth})을 넘어 이 스킬을 건너뛰었다`,
      );
    }
    const sub = await walkDir(state, absPath, relPath, depth + 1);
    return sub.ok ? undefined : sub.error;
  }
  if (state.files.length + 1 > state.limits.maxSkillFiles) {
    return diag(
      "limit",
      state.skillPath,
      `파일 수 상한(${state.limits.maxSkillFiles})을 넘어 이 스킬을 건너뛰었다`,
    );
  }
  const read = await state.fs.readBounded(absPath, state.limits.maxFileBytes);
  if (read.kind === "too_large") {
    return diag(
      "too_large",
      pathShown,
      `파일이 파일당 상한(${state.limits.maxFileBytes} 바이트)을 넘어 이 스킬을 건너뛰었다`,
    );
  }
  if (read.kind === "unreadable") {
    return diag("unreadable", pathShown, "읽을 수 없어 이 스킬을 건너뛰었다");
  }
  const bytes = read.kind === "text" ? new TextEncoder().encode(read.text) : read.bytes;
  state.total += bytes.length;
  if (state.total > state.limits.maxSkillBytes) {
    return diag(
      "limit",
      state.skillPath,
      `합계 바이트 상한(${state.limits.maxSkillBytes})을 넘어 이 스킬을 건너뛰었다`,
    );
  }
  state.files.push({
    path: relPath,
    bytes,
    text: relPath === SKILL_FILE && read.kind === "text" ? read.text : undefined,
  });
  return undefined;
}

/** 스킬 폴더 하나를 재귀로 읽는다. 상한이나 읽기 실패면 스킬 전체를 건너뛸 진단을 돌려준다 */
async function readSkillFolder(input: {
  readonly fs: ScanFs;
  readonly folder: string;
  readonly limits: ScanLimits;
  readonly homeDir: string;
}): Promise<
  Result<
    { readonly files: readonly SkillFile[]; readonly skipped: readonly ScanDiagnostic[] },
    ScanDiagnostic
  >
> {
  const state: WalkState = {
    fs: input.fs,
    limits: input.limits,
    homeDir: input.homeDir,
    skillPath: displayPath(input.folder, input.homeDir),
    files: [],
    skipped: [],
    total: 0,
  };
  const walked = await walkDir(state, input.folder, "", 0);
  if (!walked.ok) return walked;
  const files = state.files.toSorted((a, b) => byCodeUnit(a.path, b.path));
  return ok({ files, skipped: state.skipped });
}

/** 머리말을 읽는다. 깨졌으면 진단을 더하고 name·description을 비운다. 본문은 가능하면 남긴다 */
function readHead(
  main: SkillFile,
  mainPath: string,
  diagnostics: ScanDiagnostic[],
): {
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly fields: ReadonlyMap<string, FrontmatterValue> | undefined;
  readonly body: string | undefined;
} {
  if (main.text === undefined) {
    diagnostics.push(
      diag(
        "invalid_frontmatter",
        mainPath,
        "SKILL.md가 UTF-8 텍스트가 아니라 머리말을 읽지 못했다",
      ),
    );
    return { name: undefined, description: undefined, fields: undefined, body: undefined };
  }
  const parsed = parseDocument(main.text);
  if (!parsed.ok) {
    // parseDocument의 오류 문장에는 원문 줄이 들어 있으므로 그대로 싣지 않는다
    diagnostics.push(
      diag(
        "invalid_frontmatter",
        mainPath,
        "머리말을 읽지 못했다. 이 도구가 다루지 않는 YAML 모양이다(내용은 적지 않는다)",
      ),
    );
    // 머리말을 알 수 없으므로 본문 치환은 원문 전체에서 보수적으로 센다
    return { name: undefined, description: undefined, fields: undefined, body: main.text };
  }
  if (!parsed.value.hasFrontmatter) {
    diagnostics.push(
      diag("invalid_frontmatter", mainPath, "머리말이 없다. SKILL.md는 머리말이 필요하다"),
    );
    return { name: undefined, description: undefined, fields: undefined, body: parsed.value.body };
  }
  return {
    name: scalarText(parsed.value.frontmatter.get("name")),
    description: scalarText(parsed.value.frontmatter.get("description")),
    fields: parsed.value.frontmatter,
    body: parsed.value.body,
  };
}

function buildSkill(input: SkillBuildInput): {
  readonly items: SourceItem[];
  readonly diagnostics: ScanDiagnostic[];
} {
  const diagnostics: ScanDiagnostic[] = [];
  const head = readHead(input.main, input.mainPath, diagnostics);
  const bytes = input.files.reduce((sum, file) => sum + file.bytes.length, 0);
  const ir: IrSkill = {
    kind: "skill",
    dirName: input.folderName,
    name: head.name,
    description: head.description,
    files: input.files.map((file) => ({ path: file.path, bytes: file.bytes })),
  };
  const items: SourceItem[] = [
    {
      itemId: itemIdOf([input.harness, "skill", input.scope, input.folderPath]),
      harness: input.harness,
      kind: "skill",
      scope: input.scope,
      rootLabel: input.rootLabel,
      path: input.folderPath,
      keyPath: input.folderName,
      sha256: skillDigest(input.files),
      bytes,
      ir,
      secrets: [],
      warnings: [],
    },
  ];

  const base = {
    harness: input.harness,
    scope: input.scope,
    rootLabel: input.rootLabel,
    mainPath: input.mainPath,
  };
  const entries: readonly (readonly [string, FrontmatterValue])[] =
    head.fields === undefined ? [] : [...head.fields.entries()];
  for (const [key, value] of entries) {
    if (PASS_THROUGH_KEYS.has(key)) continue;
    items.push(
      fieldItem({
        ...base,
        keyPath: `${input.folderName}.frontmatter.${key}`,
        ir: { kind: "field", container: "skill", key, summary: summaryOf(key, value) },
        digest: JSON.stringify([key, value]),
      }),
    );
  }

  if (head.body !== undefined) {
    const text = outsideFences(head.body);
    for (const { key, pattern } of BODY_PATTERNS) {
      const matches = [...text.matchAll(pattern)].map((match) => match[0]);
      if (matches.length === 0) continue;
      items.push(
        fieldItem({
          ...base,
          keyPath: `${input.folderName}.body.${key}`,
          ir: { kind: "field", container: "skill-body", key, summary: undefined },
          digest: JSON.stringify([key, matches]),
        }),
      );
    }
  }
  return { items, diagnostics };
}

interface Found {
  readonly items: SourceItem[];
  readonly diagnostics: ScanDiagnostic[];
}

/** 하위 폴더 하나. `SKILL.md`가 있는 폴더만 스킬로 읽고, 그 밖은 진단 없이 빈 결과를 돌려준다 */
async function scanFolder(input: {
  readonly fs: ScanFs;
  readonly folder: string;
  readonly name: string;
  readonly scope: "user" | "project";
  readonly harness: HarnessId;
  readonly rootLabel: string;
  readonly limits: ScanLimits;
  readonly homeDir: string;
}): Promise<Found> {
  const { fs, folder, name, scope, harness, rootLabel, limits, homeDir } = input;
  const folderPath = displayPath(folder, homeDir);
  const stat = await fs.lstat(folder);
  if (stat === null || stat.kind === "symlink") {
    const message = stat === null ? "훑는 중에 사라졌다" : "심볼릭 링크라 따라가지 않았다";
    return { items: [], diagnostics: [diag("unreadable", folderPath, message)] };
  }
  if (stat.kind !== "dir") return { items: [], diagnostics: [] };

  const mainAbs = joinPath(folder, SKILL_FILE);
  const mainPath = displayPath(mainAbs, homeDir);
  const mainStat = await fs.lstat(mainAbs);
  // SKILL.md가 없는 하위 폴더는 스킬이 아니므로 진단 없이 넘어간다
  if (mainStat === null || mainStat.kind === "dir" || mainStat.kind === "other") {
    return { items: [], diagnostics: [] };
  }
  if (mainStat.kind === "symlink") {
    const message = "SKILL.md가 심볼릭 링크라 따라가지 않았다. 이 스킬을 건너뛰었다";
    return { items: [], diagnostics: [diag("unreadable", mainPath, message)] };
  }

  const walked = await readSkillFolder({ fs, folder, limits, homeDir });
  if (!walked.ok) return { items: [], diagnostics: [walked.error] };
  const main = walked.value.files.find((file) => file.path === SKILL_FILE);
  if (main === undefined) {
    const message = "SKILL.md를 읽지 못했다. 이 스킬을 건너뛰었다";
    return {
      items: [],
      diagnostics: [...walked.value.skipped, diag("unreadable", folderPath, message)],
    };
  }
  const built = buildSkill({
    folderName: name,
    folderPath,
    mainPath,
    files: walked.value.files,
    main,
    scope,
    harness,
    rootLabel,
  });
  return { items: built.items, diagnostics: [...walked.value.skipped, ...built.diagnostics] };
}

/**
 * `dir`의 하위 폴더 가운데 `SKILL.md`가 있는 것을 스킬로 읽는다. 읽기 전용이고 아무것도 실행하지 않는다.
 * `dir`이 없으면 항목 0개이고 `scanned`에도 넣지 않는다. Claude Code의 `.claude/skills`도 이 함수를 쓴다.
 */
export async function scanSkillsDir(input: {
  fs: ScanFs;
  dir: string;
  scope: "user" | "project";
  harness: HarnessId;
  rootLabel: string;
  limits: ScanLimits;
  ctx: ScanContext;
}): Promise<{ items: SourceItem[]; diagnostics: ScanDiagnostic[]; scanned: string[] }> {
  const { fs, dir, scope, harness, rootLabel, limits, ctx } = input;
  const homeDir = ctx.homeDir;
  const dirStat = await fs.lstat(dir);
  if (dirStat === null) return { items: [], diagnostics: [], scanned: [] };
  if (dirStat.kind !== "dir") {
    const message =
      dirStat.kind === "symlink"
        ? "스킬 폴더가 심볼릭 링크라 따라가지 않았다"
        : "스킬 폴더가 폴더가 아니다";
    return {
      items: [],
      diagnostics: [diag("unreadable", displayPath(dir, homeDir), message)],
      scanned: [],
    };
  }

  const found: Found = { items: [], diagnostics: [] };
  await eachAsync((await fs.listDir(dir)).toSorted(byCodeUnit), async (name) => {
    const part = await scanFolder({
      fs,
      folder: joinPath(dir, name),
      name,
      scope,
      harness,
      rootLabel,
      limits,
      homeDir,
    });
    found.items.push(...part.items);
    found.diagnostics.push(...part.diagnostics);
    return undefined;
  });
  return {
    items: found.items,
    diagnostics: found.diagnostics,
    scanned: [displayPath(dir, homeDir)],
  };
}

/** Agent Skills 어댑터. 프로젝트나 홈 루트의 `.agents/skills`를 훑는다 */
export const agentSkillsAdapter: SourceAdapter = {
  harness: HARNESS,
  rulesVersion: "2026-11-17",
  scan(root, fs, limits, ctx) {
    return scanSkillsDir({
      fs,
      dir: joinPath(root.path, ".agents", "skills"),
      scope: root.scope,
      harness: HARNESS,
      rootLabel: root.label,
      limits,
      ctx,
    });
  },
};

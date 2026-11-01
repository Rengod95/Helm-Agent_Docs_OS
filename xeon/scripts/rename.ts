#!/usr/bin/env bun
// 이름 변경 스크립트(rename-plan 커밋 0). 치환 표를 데이터로 두고 추적 파일에만 적용한다.
//
//   bun scripts/rename.ts                         dry-run(기본): 파일별 치환 개수만 출력한다
//   bun scripts/rename.ts --apply                 실제로 쓴다
//   bun scripts/rename.ts --category A,B          묶음을 고른다(--list로 목록). 생략하면 모든 묶음
//   bun scripts/rename.ts --layer F,X             층별 경로로 좁힌다(F X L0 L1 L2 L3 L4 scripts docs misc)
//   bun scripts/rename.ts --paths xeon/packages/contracts,docs/xeon/F
//   bun scripts/rename.ts --files                 파일 이름 변경 목록도 출력한다(--apply이면 git mv)
//   bun scripts/rename.ts --verbose               치환마다 줄을 출력한다(위치 확인용)
//
// 종료코드: 0 통과, 1 고칠 것이 있음(인자 오류), 2 환경 문제(git 실패 등).
// 제외: 외부 코드(xeon/vendor, xeon/external), 연구 기록(docs/xeon/_research), ADR-0022 원문, 이 스크립트와 시험, 이전 스크립트.
// 지금은 바꾸지 않는 것: 저장소 경로 `xeon/…`, `docs/xeon`, 브랜치 `xeon/foundation`, 작업 폴더 `xeon-wt`(디렉터리 이동은 M4 마감 뒤).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Rule {
  readonly pattern: RegExp;
  readonly replace: string | ((substring: string, ...groups: string[]) => string);
  /** 이 경로 접두(저장소 루트 기준)에만 적용. 생략하면 묶음 범위 전체 */
  readonly only?: readonly string[];
}

export interface Category {
  readonly id: string;
  readonly title: string;
  readonly rules: readonly Rule[];
  /** 파일 이름 변경(저장소 루트 기준 경로 → 새 경로). 경로 문자열에 정규식을 적용한다 */
  readonly pathRules?: readonly { readonly pattern: RegExp; readonly replace: string }[];
  /** true이면 일반 단어 치환이라 저장소 경로를 보호한다 */
  readonly protectPaths?: boolean;
}

/** 정적 검사 규칙 id(`xeon/<rule>`). 경로와 구분하려고 목록으로 둔다 */
export const RULE_IDS = [
  "as-location",
  "bug-for-expected",
  "catch-swallow",
  "clientTime",
  "directive-format",
  "error-discriminant",
  "hardcoded-korean",
  "iso.dispose",
  "no-ambient-time",
  "no-class",
  "no-declare-enum",
  "no-void-promise",
  "reflect-get",
  "switch-default-never",
  "throw-only-bug",
  "type-unsafe",
] as const;

/** Cordis 서비스 이름 `xeon.<svc>` */
export const SERVICE_NAMES = [
  "agents",
  "approvals",
  "artifacts",
  "clock",
  "context",
  "devkit",
  "dialog",
  "exec",
  "ext",
  "extension",
  "groups",
  "knowledge",
  "loop",
  "mcp",
  "models",
  "os",
  "process",
  "routing",
  "sandbox",
  "schedule",
  "secretAdmin",
  "secrets",
  "session",
  "settings",
  "store",
  "tasks",
  "templates",
  "tools",
  "web",
  "work",
  "workspace",
] as const;

const RULE_ALT = RULE_IDS.map((id) => id.replace(".", "\\.")).join("|");
const SERVICE_ALT = SERVICE_NAMES.join("|");

/** 저장소 경로로 남기는 `xeon/` 뒤 이름(디렉터리 이동 전까지) */
const REPO_PATH_TAIL =
  "(?:packages|apps|plugins|scripts|vendor|external|justfile|package\\.json|tsconfig|turbo\\.json|knip\\.json|bun\\.lock|bunfig\\.toml|mise\\.toml|lefthook\\.yml|\\.oxlintrc|\\.oxfmtrc|\\.dependency-cruiser|\\.env\\.example|\\.gitignore|AGENTS\\.md|CLAUDE\\.md|node_modules|foundation|m4-|\\*|\\.(?![A-Za-z])|[\\s`'\"),;:\\]]|$)";

/** 일반 단어 치환에서 건드리지 않는 곳: 저장소 경로, 브랜치, 작업 폴더 */
export const PROTECTED: readonly RegExp[] = [
  /docs\/xeon(?![A-Za-z0-9_-])/g,
  /xeon-wt/g,
  /(?<=\bcd )xeon(?![A-Za-z0-9_-])/g,
  // 사용자 데이터 경로 `.config/xeon/…`, `/tmp/xeon/…` 등은 보호하지 않는다. 저장소 경로만 보호한다
  new RegExp(
    `(?<![A-Za-z0-9_@.$-])(?<!config/)(?<!share/)(?<!state/)(?<!cache/)(?<!Support/)(?<!Caches/)(?<!tmp/)(?<!TMPDIR/)(?<!XDG_RUNTIME_DIR/)(?<!/etc/)(?<!/opt/)(?<!/home/u/)xeon\\/(?!(?:${RULE_ALT})(?![A-Za-z0-9_-]))(?=${REPO_PATH_TAIL})`,
    "g",
  ),
];

const PH_OPEN = "";
const PH_CLOSE = "";

/** 일반 단어 치환은 다른 묶음이 맡은 말(@xeon, xeon.<svc>, xeon/<rule>, XEON_, .xeon 등)도 건드리지 않는다. 묶음 순서와 상관없이 쓸 수 있다 */
function otherCategoryPatterns(): RegExp[] {
  return CATEGORIES.filter((c) => c.id !== "W" && c.id !== "X").flatMap((c) =>
    c.rules.map((r) => r.pattern),
  );
}

function protect(text: string): { text: string; stash: string[] } {
  const stash: string[] = [];
  let out = text;
  for (const pattern of [...PROTECTED, ...otherCategoryPatterns()]) {
    out = out.replace(pattern, (m) => {
      stash.push(m);
      return `${PH_OPEN}${String(stash.length - 1)}${PH_CLOSE}`;
    });
  }
  return { text: out, stash };
}

function restore(text: string, stash: readonly string[]): string {
  const pattern = new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, "g");
  let out = text;
  // 보호 조각 안에 보호 표식이 중첩되지 않으므로 한 번에 풀린다
  out = out.replace(pattern, (_m, index: string) => stash[Number(index)] ?? "");
  return out;
}

const simple = (from: string, to: string): Rule => ({
  pattern: new RegExp(from, "g"),
  replace: to,
});

export const CATEGORIES: readonly Category[] = [
  {
    id: "A",
    title: '패키지 범위 @xeon/* → @fresnel/*, package.json의 "xeon" 키, xeon.layer·xeon.domain',
    rules: [
      simple("@xeon(?![A-Za-z0-9_])", "@fresnel"),
      {
        pattern: /^(\s*)"xeon": \{/gm,
        replace: '$1"fresnel": {',
        only: [
          "xeon/packages",
          "xeon/apps",
          "xeon/plugins",
          "xeon/vendor",
          "xeon/package.json",
          "xeon/scripts",
        ],
      },
      simple("\\bxeon\\.(layer|domain)\\b", "fresnel.$1"),
    ],
  },
  {
    id: "B",
    title:
      "Cordis 서비스 이름 xeon.<svc> → fresnel.<svc>, 페이로드 버전 xeon.hook.v1·xeon.model-tape.v1",
    rules: [
      simple(`(?<![A-Za-z0-9_@/-])xeon\\.(${SERVICE_ALT})(?![A-Za-z0-9_-])`, "fresnel.$1"),
      simple("(?<![A-Za-z0-9_@/-])xeon\\.(hook|model-tape)\\.v1", "fresnel.$1.v1"),
    ],
  },
  {
    id: "E",
    title: "정적 검사 규칙 id xeon/<rule> → fresnel/<rule>",
    rules: [
      simple(`(?<![A-Za-z0-9_@.-])xeon(\\\\?/)(${RULE_ALT})(?![A-Za-z0-9_-])`, "fresnel$1$2"),
      simple("<xeon/rule>", "<fresnel/rule>"),
      simple("`xeon/<rule>`", "`fresnel/<rule>`"),
      simple("xeon/<rule>", "fresnel/<rule>"),
    ],
  },
  {
    id: "F",
    title: "검사 예외 주석 xeon-disable-next-line → fresnel-disable-next-line",
    rules: [simple("xeon-disable-next-line", "fresnel-disable-next-line")],
  },
  {
    id: "G",
    title: "환경 변수·표지 XEON_* → FRESNEL_*, XEON-PATCH → FRESNEL-PATCH (옛 이름 읽기 없음)",
    rules: [
      simple("(?<![A-Za-z0-9])XEON_", "FRESNEL_"),
      simple("__XEON_", "__FRESNEL_"),
      simple("XEON-PATCH", "FRESNEL-PATCH"),
    ],
  },
  {
    id: "H",
    title: "프로젝트 폴더 .xeon/ → .fresnel/ (옛 폴더 읽기 없음)",
    rules: [simple("(?<![A-Za-z0-9_-])\\.xeon(?![A-Za-z0-9_-])", ".fresnel")],
  },
  {
    id: "I",
    title: "플러그인 폴더 .xeon-plugin/ → .fresnel-plugin/ (옛 폴더 읽기 없음)",
    rules: [simple("\\.xeon-plugin", ".fresnel-plugin")],
    pathRules: [{ pattern: /\.xeon-plugin\//g, replace: ".fresnel-plugin/" }],
  },
  {
    id: "L",
    title: "데스크톱 묶음 identifier dev.helm.xeon → dev.fresnel.desktop",
    rules: [simple("dev\\.helm\\.xeon", "dev.fresnel.desktop")],
  },
  {
    id: "P",
    title: "CI·스킬 파일 이름 xeon-*.yml, .claude/skills/xeon-* → fresnel-*",
    rules: [],
    pathRules: [
      { pattern: /^\.github\/workflows\/xeon-/, replace: ".github/workflows/fresnel-" },
      { pattern: /^\.claude\/skills\/xeon-/, replace: ".claude/skills/fresnel-" },
    ],
  },
  {
    id: "W",
    title:
      "남은 단어 xeon/Xeon/XEON → fresnel/Fresnel/FRESNEL (저장소 경로·브랜치·작업 폴더는 보호)",
    protectPaths: true,
    rules: [
      simple("(?<![A-Za-z])Xeon(?![a-z])", "Fresnel"),
      simple("(?<![A-Za-z])xeon", "fresnel"),
      simple("(?<![A-Za-z])XEON(?![A-Z])", "FRESNEL"),
      simple("(?<=[a-z])Xeon", "Fresnel"),
      simple("(?<=[a-z])xeon(?![a-z])", "fresnel"),
    ],
  },
  {
    id: "X",
    title: "측정 bench → benchmark (단어 경계, workbench·Workbench는 건드리지 않는다)",
    rules: [
      {
        pattern: /(?<![A-Za-z0-9_])bench(?![A-Za-z0-9])(?!mark)/g,
        replace: "benchmark",
        only: [
          "xeon/scripts",
          "xeon/justfile",
          "justfile",
          "xeon/knip.json",
          "xeon/packages",
          "xeon/apps/cli",
          "xeon/apps/host",
          "docs/xeon",
        ],
      },
    ],
    pathRules: [
      {
        pattern: /^xeon\/scripts\/bench(-gate|-server)?(\.test)?\.ts$/,
        replace: "xeon/scripts/benchmark$1$2.ts",
      },
    ],
  },
];

const ROOTS = [
  "xeon",
  "docs/xeon",
  "justfile",
  ".github",
  ".claude",
  ".env.example",
  ".gitleaksignore",
  "lefthook.yml",
  "scripts",
] as const;

const EXCLUDED_PREFIXES = [
  "xeon/vendor/",
  "xeon/external/",
  "docs/xeon/_research/",
  "docs/xeon/decisions/ADR-0022-plugin-group-and-terms.md",
  "xeon/scripts/rename.ts",
  "xeon/scripts/rename.test.ts",
  "xeon/scripts/migrate-dev-machine.ts",
  "xeon/scripts/migrate-dev-machine.test.ts",
  // 용어 원본: 옛 이름 금지 목록과 코드 id가 옛 말 그대로 적혀 있어야 한다
  "xeon/packages/client/src/i18n/terms.ts",
  "xeon/packages/client/src/i18n/terms.json",
  "xeon/scripts/terms.ts",
  "xeon/scripts/terms.test.ts",
];

/** 파일 단위 예외: 이 묶음에서 건드리는 예외 파일(외부 코드의 package.json은 패키지 이름이므로 A만) */
const CATEGORY_EXTRA_FILES: Readonly<Record<string, readonly string[]>> = {
  A: ["xeon/vendor/cordis/package.json", "xeon/bun.lock"],
};

export const LAYER_PATHS: Readonly<Record<string, readonly string[]>> = {
  F: ["xeon/packages/contracts", "docs/xeon/F/"],
  X: ["xeon/packages/ext-host", "docs/xeon/X/"],
  L0: ["xeon/packages/platform-", "docs/xeon/L0/"],
  L1: ["xeon/packages/core-", "xeon/plugins/", "docs/xeon/L1/"],
  L2: ["xeon/packages/cap-", "docs/xeon/L2/"],
  L3: ["xeon/packages/group-", "docs/xeon/L3/"],
  L4: ["xeon/apps/", "xeon/packages/client", "docs/xeon/L4/"],
  scripts: [
    "xeon/scripts/",
    "xeon/justfile",
    "justfile",
    "xeon/package.json",
    "xeon/knip.json",
    "xeon/turbo.json",
    "xeon/.oxlintrc",
    "xeon/.dependency-cruiser.cjs",
    "xeon/lefthook.yml",
    "xeon/mise.toml",
    "xeon/.env.example",
    ".github/",
    ".claude/",
    ".env.example",
    ".gitleaksignore",
    "lefthook.yml",
    "scripts/",
  ],
  docs: ["docs/xeon/"],
  misc: [
    "xeon/AGENTS.md",
    "xeon/CLAUDE.md",
    "xeon/tsconfig",
    "xeon/bunfig.toml",
    "xeon/.gitignore",
    "xeon/.oxfmtrc.json",
  ],
};

export interface Change {
  readonly file: string;
  readonly category: string;
  readonly count: number;
  readonly samples: readonly { line: number; before: string; after: string }[];
}

/** 한 묶음의 규칙을 텍스트에 적용한다. 순수 함수 */
export function transform(
  text: string,
  category: Category,
  file: string,
): { text: string; count: number; samples: { line: number; before: string; after: string }[] } {
  let working = text;
  let stash: string[] = [];
  if (category.protectPaths === true) {
    const protectedText = protect(working);
    working = protectedText.text;
    stash = protectedText.stash;
  }
  let count = 0;
  for (const rule of category.rules) {
    if (rule.only !== undefined && !rule.only.some((prefix) => file.startsWith(prefix))) continue;
    working = working.replace(rule.pattern, (...args: unknown[]) => {
      count += 1;
      const matched = String(args[0]);
      if (typeof rule.replace === "string") {
        return rule.replace.replace(/\$(\d)/g, (_m, n: string) => {
          const group = args[Number(n)];
          return typeof group === "string" ? group : "";
        });
      }
      const groups = args.slice(1, -2).map(String);
      return rule.replace(matched, ...groups);
    });
  }
  const out = category.protectPaths === true ? restore(working, stash) : working;
  const samples: { line: number; before: string; after: string }[] = [];
  if (out !== text) {
    const before = text.split("\n");
    const after = out.split("\n");
    for (let i = 0; i < before.length && samples.length < 3; i += 1) {
      if (before[i] !== after[i])
        samples.push({ line: i + 1, before: before[i] ?? "", after: after[i] ?? "" });
    }
  }
  return { text: out, count, samples };
}

/** 경로 변경 규칙. 바뀌지 않으면 undefined */
export function renamePath(path: string, category: Category): string | undefined {
  let next = path;
  for (const rule of category.pathRules ?? []) next = next.replace(rule.pattern, rule.replace);
  return next === path ? undefined : next;
}

function inScope(file: string, only: readonly string[] | undefined): boolean {
  return only === undefined || only.some((prefix) => file.startsWith(prefix));
}

function isIncluded(file: string, categoryId: string): boolean {
  if ((CATEGORY_EXTRA_FILES[categoryId] ?? []).includes(file)) return true;
  if (EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix))) return false;
  if (file === "xeon/bun.lock") return false;
  return ROOTS.some((root) => file === root || file.startsWith(`${root}/`));
}

function isText(buffer: Buffer): boolean {
  return !buffer.subarray(0, 8192).includes(0);
}

export interface RunOptions {
  readonly root: string;
  readonly apply: boolean;
  readonly categories: readonly string[];
  readonly only: readonly string[] | undefined;
  readonly verbose: boolean;
  readonly files: boolean;
}

export interface RunResult {
  readonly changes: readonly Change[];
  readonly renames: readonly { from: string; to: string }[];
}

function listFiles(root: string): string[] {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 1 << 28 });
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr.toString()}`);
  return result.stdout
    .toString()
    .split("\0")
    .filter((name) => name !== "");
}

export function run(options: RunOptions): RunResult {
  const files = listFiles(options.root);
  const selected = CATEGORIES.filter(
    (c) => options.categories.length === 0 || options.categories.includes(c.id),
  );
  const changes: Change[] = [];
  const renames: { from: string; to: string }[] = [];
  for (const file of files) {
    if (!inScope(file, options.only)) continue;
    const absolute = join(options.root, file);
    let buffer: Buffer | undefined;
    for (const category of selected) {
      if (!isIncluded(file, category.id)) continue;
      if (category.id !== "A" && file === "xeon/vendor/cordis/package.json") continue;
      if (category.rules.length > 0) {
        buffer ??= readFileSync(absolute);
        if (!isText(buffer)) continue;
        const original = buffer.toString("utf8");
        const result = transform(original, category, file);
        if (result.count > 0 && result.text !== original) {
          changes.push({
            file,
            category: category.id,
            count: result.count,
            samples: result.samples,
          });
          if (options.apply) {
            writeFileSync(absolute, result.text);
            buffer = Buffer.from(result.text, "utf8");
          }
        }
      }
    }
    if (options.files) {
      for (const category of selected) {
        if (
          !isIncluded(file, category.id) &&
          !file.startsWith(".github/") &&
          !file.startsWith(".claude/")
        )
          continue;
        const to = renamePath(file, category);
        if (to !== undefined) renames.push({ from: file, to });
      }
    }
  }
  if (options.apply) {
    for (const rename of renames) {
      const result = spawnSync("git", ["mv", "-k", rename.from, rename.to], { cwd: options.root });
      if (result.status !== 0)
        throw new Error(`git mv ${rename.from} failed: ${result.stderr.toString()}`);
    }
  }
  return { changes, renames };
}

function parseList(value: string | undefined): string[] {
  return value === undefined || value === "" ? [] : value.split(",").map((s) => s.trim());
}

function main(argv: readonly string[]): number {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      console.error(`unknown argument ${arg}`);
      return 1;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (["category", "layer", "paths"].includes(name)) {
      if (next === undefined) {
        console.error(`--${name} needs a value`);
        return 1;
      }
      flags.set(name, next);
      i += 1;
    } else {
      flags.set(name, true);
    }
  }
  if (flags.has("list")) {
    for (const c of CATEGORIES) console.log(`${c.id}  ${c.title}`);
    return 0;
  }
  const known = new Set(CATEGORIES.map((c) => c.id));
  const categories = parseList(
    typeof flags.get("category") === "string" ? String(flags.get("category")) : undefined,
  );
  const unknownCategory = categories.find((id) => !known.has(id));
  if (unknownCategory !== undefined) {
    console.error(`unknown category ${unknownCategory}`);
    return 1;
  }
  const only: string[] = [];
  for (const layer of parseList(
    typeof flags.get("layer") === "string" ? String(flags.get("layer")) : undefined,
  )) {
    const paths = LAYER_PATHS[layer];
    if (paths === undefined) {
      console.error(`unknown layer ${layer}`);
      return 1;
    }
    only.push(...paths);
  }
  only.push(
    ...parseList(typeof flags.get("paths") === "string" ? String(flags.get("paths")) : undefined),
  );
  const root = join(dirname(import.meta.path), "..", "..");
  const apply = flags.has("apply");
  let result: RunResult;
  try {
    result = run({
      root,
      apply,
      categories,
      only: only.length === 0 ? undefined : only,
      verbose: flags.has("verbose"),
      files: flags.has("files"),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const perCategory = new Map<string, { files: number; count: number }>();
  for (const change of result.changes) {
    const entry = perCategory.get(change.category) ?? { files: 0, count: 0 };
    entry.files += 1;
    entry.count += change.count;
    perCategory.set(change.category, entry);
    if (flags.has("verbose")) {
      console.log(`${change.category} ${change.file} ${String(change.count)}`);
      for (const s of change.samples)
        console.log(
          `    ${String(s.line)}: ${s.before.trim().slice(0, 120)}\n    ${" ".repeat(String(s.line).length)}  → ${s.after.trim().slice(0, 120)}`,
        );
    } else {
      console.log(`${change.category} ${String(change.count).padStart(5)} ${change.file}`);
    }
  }
  for (const rename of result.renames) console.log(`mv ${rename.from} -> ${rename.to}`);
  console.log(apply ? "applied" : "dry-run (use --apply to write)");
  for (const [id, entry] of [...perCategory].toSorted(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${id}: ${String(entry.count)} replacements in ${String(entry.files)} files`);
  }
  console.log(`  renames: ${String(result.renames.length)}`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));

#!/usr/bin/env bun
// 용어 검사 0단계(i18n-term-lint 설계 §9): 원본 packages/client/src/i18n/terms.ts에서 파생물을 만들고(gen) 검사한다(check).
//   T-01 라벨 중복 없음  T-02 forbid가 다른 개념의 정식 이름이 아님  T-03 ui.ko는 명사구, ui.en에 한글 없음
//   T-04 chat 노출 라벨에 내부 전용 말 없음  T-05 sources의 문서 id가 실제로 있음
//   C-01 ko·en 키 집합이 같음  C-02 ICU 문법이 맞고 ko·en 인자 이름·종류가 같음
//   C-03 `term.*` 키가 원본에서 생성한 값과 같음  C-06 en 문자열에 한글 없음
//   M-01 목업 용어 파생물(mockups/_shell/terms.generated.ts)이 있으면 원본과 같음
//   D-03 용어집의 생성 구역(<!-- terms:begin --> … <!-- terms:end -->)이 있으면 원본과 같음
// 사용:
//   bun scripts/terms.ts gen [--mockups]      카탈로그 term.* 키를 갱신한다. --mockups는 목업 파생물도 쓴다(목업 트랙이 켠다)
//   bun scripts/terms.ts check [--json]       전부 검사한다
// 종료코드: 0 통과, 1 고칠 것이 있음, 2 환경 문제(원본·카탈로그를 읽지 못함). 단계 도입 전이라 경고 수준 규칙은 없다.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { loadShippedTerms, type TermDecl } from "../packages/client/src/i18n/terms.ts";

const ROOT = join(import.meta.dir, "..");
const LOCALES_DIR = join(ROOT, "packages/client/src/i18n/locales");
const DOCS_DIR = join(ROOT, "..", "docs/xeon");
const GLOSSARY_FILE = join(DOCS_DIR, "engineering/operations/glossary.md");
const GLOSSARY_BEGIN = "<!-- terms:begin -->";
const GLOSSARY_END = "<!-- terms:end -->";
const MOCKUP_FILE = join(ROOT, "apps/desktop/mockups/_shell/terms.generated.ts");

export interface Violation {
  readonly rule: string;
  readonly where: string;
  readonly message: string;
  /** 고치는 방법 */
  readonly fix: string;
}

export type Catalog = Readonly<Record<string, string>>;
const HANGUL = /[ㄱ-ㆎ가-힣]/;
/** 화면(chat) 문자열에 나오면 안 되는 내부 전용 말(설계 §5 C-04 목록) */
export const CHAT_INTERNAL_WORDS: readonly string[] = [
  "루프",
  "코어",
  "소켓",
  "tier",
  "scope",
  "well",
  "fold",
  "spawn",
  "사이드카",
  "컴팩션",
  "단계 경계",
];

export function termKey(id: string): string {
  return `term.${id}`;
}

/** 원본에서 카탈로그의 term.* 키를 만든다 */
export function generateTermKeys(terms: Readonly<Record<string, TermDecl>>): {
  ko: Catalog;
  en: Catalog;
} {
  const ko: Record<string, string> = {};
  const en: Record<string, string> = {};
  for (const id of Object.keys(terms).toSorted()) {
    const term = terms[id];
    if (term === undefined) continue;
    if (term.ui !== null) {
      ko[termKey(id)] = term.ui.ko;
      en[termKey(id)] = term.ui.en;
    }
    if (term.help !== undefined) {
      ko[`${termKey(id)}.help`] = term.help.ko;
      en[`${termKey(id)}.help`] = term.help.en;
    }
  }
  return { ko, en };
}

/** 카탈로그에서 term.* 키를 빼고 생성 키를 뒤에 붙인다(다른 키의 순서는 그대로) */
export function mergeTermKeys(catalog: Catalog, generated: Catalog): Catalog {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(catalog)) {
    if (!key.startsWith("term.")) out[key] = value;
  }
  for (const key of Object.keys(generated).toSorted()) out[key] = generated[key] ?? "";
  return out;
}

// --- 원본 검사 T ---------------------------------------------------------------------------------------------

export function checkTermSource(
  terms: Readonly<Record<string, TermDecl>>,
  docIds: ReadonlySet<string>,
): Violation[] {
  const out: Violation[] = [];
  const ids = Object.keys(terms);
  const labelOwners = new Map<string, string[]>();
  const claim = (label: string, owner: string): void => {
    labelOwners.set(label, [...(labelOwners.get(label) ?? []), owner]);
  };
  for (const id of ids) {
    const term = terms[id];
    if (term === undefined) continue;
    claim(`doc.ko:${term.doc.ko}`, id);
    if (term.ui !== null) {
      claim(`ui.ko:${term.ui.ko}`, id);
      claim(`ui.en:${term.ui.en}`, id);
    }
  }
  for (const [label, owners] of labelOwners) {
    if (owners.length < 2) continue;
    const declared = owners.every((owner) => {
      const others = owners.filter((other) => other !== owner);
      const shares = terms[owner]?.sharesLabelWith ?? [];
      return others.every((other) => shares.includes(other));
    });
    if (declared) continue;
    out.push({
      rule: "T-01",
      where: `terms.ts ${owners.join(", ")}`,
      message: `label ${label} is used by more than one concept`,
      fix: "give each concept its own label, or declare sharesLabelWith on both",
    });
  }
  const canonical = new Set<string>();
  for (const id of ids) {
    const term = terms[id];
    if (term === undefined) continue;
    canonical.add(term.doc.ko);
    canonical.add(term.doc.en);
    if (term.ui !== null) {
      canonical.add(term.ui.ko);
      canonical.add(term.ui.en);
    }
  }
  for (const id of ids) {
    const term = terms[id];
    if (term === undefined) continue;
    for (const alias of [...(term.forbid?.ui ?? []), ...(term.forbid?.docs ?? [])]) {
      if (canonical.has(alias)) {
        out.push({
          rule: "T-02",
          where: `terms.ts ${id}`,
          message: `forbidden alias "${alias}" is the canonical name of another concept`,
          fix: "remove the alias from forbid or rename the other concept",
        });
      }
    }
    if (term.ui !== null) {
      if (/(요|니다)[.!?]?$/.test(term.ui.ko)) {
        out.push({
          rule: "T-03",
          where: `terms.ts ${id}`,
          message: `ui.ko "${term.ui.ko}" ends like a sentence`,
          fix: "write a noun phrase",
        });
      }
      if (HANGUL.test(term.ui.en)) {
        out.push({
          rule: "T-03",
          where: `terms.ts ${id}`,
          message: `ui.en "${term.ui.en}" contains Hangul`,
          fix: "write the English label",
        });
      }
      if (term.surfaces.includes("chat")) {
        for (const word of CHAT_INTERNAL_WORDS) {
          if (term.ui.ko.includes(word)) {
            out.push({
              rule: "T-04",
              where: `terms.ts ${id}`,
              message: `chat label "${term.ui.ko}" contains the internal word "${word}"`,
              fix: "use a label without internal words or drop chat from surfaces",
            });
          }
        }
      }
    } else if (term.surfaces.some((surface) => surface !== "none")) {
      out.push({
        rule: "T-03",
        where: `terms.ts ${id}`,
        message: "ui is null but surfaces is not [none]",
        fix: 'set surfaces to ["none"]',
      });
    }
    for (const source of term.sources) {
      const docId = source.split(" ")[0] ?? source;
      if (!docIds.has(docId)) {
        out.push({
          rule: "T-05",
          where: `terms.ts ${id}`,
          message: `source ${docId} is not a document id`,
          fix: "use an id from docs-route",
        });
      }
    }
  }
  return out;
}

// --- 카탈로그 검사 C -----------------------------------------------------------------------------------------

export type IcuResult =
  | { readonly ok: true; readonly args: ReadonlyMap<string, string> }
  | { readonly ok: false; readonly error: string };

/** ICU 부분집합(`{name}`, `{n, number}`, `{n, plural, one{..} other{..}}`, `{x, select, ..}`)을 훑어 인자 이름과 종류를 모은다 */
export function icuArgs(message: string): IcuResult {
  const args = new Map<string, string>();
  const state = { at: 0 };

  const readUntil = (stops: string): string => {
    let text = "";
    while (state.at < message.length && !stops.includes(message.charAt(state.at))) {
      text += message.charAt(state.at);
      state.at += 1;
    }
    return text;
  };

  // 본문을 `closing`까지 읽는다. 오류 문자열 또는 undefined
  const body = (closing: boolean): string | undefined => {
    while (state.at < message.length) {
      const ch = message.charAt(state.at);
      if (ch === "'") {
        const next = message.charAt(state.at + 1);
        if (next === "'") state.at += 2;
        else if (next === "{" || next === "}") {
          state.at += 1;
          while (state.at < message.length && message.charAt(state.at) !== "'") state.at += 1;
          state.at += 1;
        } else state.at += 1;
      } else if (ch === "{") {
        state.at += 1;
        const error = argument();
        if (error !== undefined) return error;
      } else if (ch === "}") {
        if (closing) return undefined;
        return `unbalanced "}" at ${String(state.at)}`;
      } else state.at += 1;
    }
    return closing ? "missing closing brace" : undefined;
  };

  const argument = (): string | undefined => {
    const name = readUntil(",}").trim();
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) return `bad argument name "${name}"`;
    if (message.charAt(state.at) === "}") {
      state.at += 1;
      args.set(name, "arg");
      return undefined;
    }
    state.at += 1;
    const type = readUntil(",}").trim();
    if (type === "number" || type === "date" || type === "time") {
      args.set(name, type);
      if (message.charAt(state.at) === ",") {
        state.at += 1;
        readUntil("}");
      }
      if (message.charAt(state.at) !== "}") return `missing "}" after ${type}`;
      state.at += 1;
      return undefined;
    }
    if (type !== "plural" && type !== "select" && type !== "selectordinal")
      return `unknown argument type "${type}"`;
    args.set(name, type);
    if (message.charAt(state.at) !== ",") return `missing cases after ${type}`;
    state.at += 1;
    for (;;) {
      const selector = readUntil("{}").trim();
      if (state.at >= message.length) return "missing closing brace";
      if (message.charAt(state.at) === "}") {
        if (selector !== "") return `bad case "${selector}" in ${type}`;
        state.at += 1;
        return undefined;
      }
      if (selector === "") return `case without selector in ${type}`;
      state.at += 1;
      const error = body(true);
      if (error !== undefined) return error;
      state.at += 1;
    }
  };

  const error = body(false);
  return error === undefined ? { ok: true, args } : { ok: false, error };
}

function signature(args: ReadonlyMap<string, string>): string {
  return [...args]
    .map(([name, kind]) => `${name}:${kind}`)
    .toSorted()
    .join(",");
}

/** ko는 복수형이 없어 en의 plural 자리에 평범한 `{n}`을 쓸 수 있다. 그 밖의 종류 차이는 어긋남이다 */
function sameArguments(ko: ReadonlyMap<string, string>, en: ReadonlyMap<string, string>): boolean {
  if (ko.size !== en.size) return false;
  for (const [name, enKind] of en) {
    const koKind = ko.get(name);
    if (koKind === undefined) return false;
    if (koKind !== enKind && !(koKind === "arg" && enKind === "plural")) return false;
  }
  return true;
}

export function checkCatalogs(
  ko: Catalog,
  en: Catalog,
  terms: Readonly<Record<string, TermDecl>>,
): Violation[] {
  const out: Violation[] = [];
  const koKeys = new Set(Object.keys(ko));
  const enKeys = new Set(Object.keys(en));
  for (const key of koKeys) {
    if (!enKeys.has(key)) {
      out.push({
        rule: "C-01",
        where: `locales/en.json ${key}`,
        message: "key is missing in en",
        fix: "add the key to en.json",
      });
    }
  }
  for (const key of enKeys) {
    if (!koKeys.has(key)) {
      out.push({
        rule: "C-01",
        where: `locales/ko.json ${key}`,
        message: "key is missing in ko",
        fix: "add the key to ko.json",
      });
    }
  }
  for (const key of Object.keys(en)) {
    const enText = en[key] ?? "";
    const koText = ko[key];
    const enArgs = icuArgs(enText);
    if (!enArgs.ok) {
      out.push({
        rule: "C-02",
        where: `locales/en.json ${key}`,
        message: `ICU syntax: ${enArgs.error}`,
        fix: "fix the braces",
      });
    }
    if (koText !== undefined) {
      const koArgs = icuArgs(koText);
      if (!koArgs.ok) {
        out.push({
          rule: "C-02",
          where: `locales/ko.json ${key}`,
          message: `ICU syntax: ${koArgs.error}`,
          fix: "fix the braces",
        });
      } else if (enArgs.ok && !sameArguments(koArgs.args, enArgs.args)) {
        out.push({
          rule: "C-02",
          where: key,
          message: `ko arguments (${signature(koArgs.args)}) differ from en (${signature(enArgs.args)})`,
          fix: "use the same argument names and kinds in ko and en",
        });
      }
    }
    if (HANGUL.test(enText)) {
      out.push({
        rule: "C-06",
        where: `locales/en.json ${key}`,
        message: "en string contains Hangul",
        fix: "write English",
      });
    }
  }
  const generated = generateTermKeys(terms);
  for (const [locale, catalog, expected] of [
    ["ko", ko, generated.ko],
    ["en", en, generated.en],
  ] as const) {
    const actual = Object.fromEntries(
      Object.entries(catalog).filter(([key]) => key.startsWith("term.")),
    );
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      if (expected[key] !== actual[key]) {
        out.push({
          rule: "C-03",
          where: `locales/${locale}.json ${key}`,
          message:
            expected[key] === undefined
              ? "term key has no source entry"
              : "term key differs from the generated value",
          fix: "run `just terms gen`",
        });
      }
    }
  }
  return out;
}

// --- 용어집 생성 구역 D-03 -----------------------------------------------------------------------------------

/** 용어집의 생성 구역(표지 줄 두 개 사이)에 들어갈 표. 문서 용어, 화면 라벨 ko·en, 함께 보이는 기계 id */
export function generateGlossaryZone(terms: Readonly<Record<string, TermDecl>>): string {
  const rows = Object.keys(terms)
    .toSorted()
    .flatMap((id) => {
      const term = terms[id];
      if (term === undefined) return [];
      const ui = term.ui === null ? ["—", "—"] : [term.ui.ko, term.ui.en];
      const ids = (term.ids ?? []).map((value) => `\`${value}\``).join(", ");
      return [
        `| ${term.doc.ko} | ${ui[0] ?? "—"} | ${ui[1] ?? "—"} | ${ids === "" ? "—" : ids} | ${term.status} |`,
      ];
    });
  return [
    GLOSSARY_BEGIN,
    "| 문서 용어 | 화면 라벨 ko | 화면 라벨 en | 기계 id | 상태 |",
    "|---|---|---|---|---|",
    ...rows,
    GLOSSARY_END,
  ].join("\n");
}

/** 구역을 새 표로 바꾼다. 표지가 없으면 undefined */
export function replaceGlossaryZone(text: string, zone: string): string | undefined {
  const begin = text.indexOf(GLOSSARY_BEGIN);
  const end = text.indexOf(GLOSSARY_END);
  if (begin < 0 || end < begin) return undefined;
  return `${text.slice(0, begin)}${zone}${text.slice(end + GLOSSARY_END.length)}`;
}

export function checkGlossary(
  terms: Readonly<Record<string, TermDecl>>,
  text: string | undefined,
): Violation[] {
  if (text === undefined) return [];
  const replaced = replaceGlossaryZone(text, generateGlossaryZone(terms));
  if (replaced === undefined || replaced === text) return [];
  return [
    {
      rule: "D-03",
      where: "docs/xeon/engineering/operations/glossary.md",
      message: "the generated term table differs from the source",
      fix: "run `just terms gen`",
    },
  ];
}

// --- 목업 파생물 M-01 ---------------------------------------------------------------------------------------

export function generateMockupTerms(terms: Readonly<Record<string, TermDecl>>): string {
  const rows = (locale: "ko" | "en"): string =>
    Object.keys(terms)
      .toSorted()
      .flatMap((id) => {
        const term = terms[id];
        return term === undefined || term.ui === null
          ? []
          : [`  ${id}: ${JSON.stringify(term.ui[locale])},`];
      })
      .join("\n");
  return [
    "// 생성 파일: `just terms gen --mockups`. 고치지 않는다(원본: packages/client/src/i18n/terms.ts).",
    "export const TERMS_KO = {",
    rows("ko"),
    "} as const;",
    "",
    "export const TERMS_EN = {",
    rows("en"),
    "} as const;",
    "",
  ].join("\n");
}

export function checkMockupTerms(
  terms: Readonly<Record<string, TermDecl>>,
  current: string | undefined,
): Violation[] {
  if (current === undefined) return [];
  if (current === generateMockupTerms(terms)) return [];
  return [
    {
      rule: "M-01",
      where: "apps/desktop/mockups/_shell/terms.generated.ts",
      message: "mockup terms differ from the source",
      fix: "run `just terms gen --mockups`",
    },
  ];
}

// --- 입출력 ---------------------------------------------------------------------------------------------------

export function collectDocIds(dir: string): Set<string> {
  const ids = new Set<string>();
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "_research") walk(path);
      } else if (entry.name.endsWith(".md")) {
        const head = readFileSync(path, "utf8").slice(0, 600);
        const match = /^---\n[\s\S]*?^id: (\S+)$/m.exec(head);
        if (match?.[1] !== undefined) ids.add(match[1]);
      }
    }
  };
  walk(dir);
  return ids;
}

export function readCatalog(locale: "ko" | "en"): Catalog | undefined {
  const parsed: unknown = JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") return undefined;
    out[key] = value;
  }
  return out;
}

function writeCatalog(locale: "ko" | "en", catalog: Catalog): void {
  writeFileSync(join(LOCALES_DIR, `${locale}.json`), `${JSON.stringify(catalog, null, 2)}\n`);
}

function main(argv: readonly string[]): number {
  const [command, ...flags] = argv;
  const ko = readCatalog("ko");
  const en = readCatalog("en");
  if (ko === undefined || en === undefined) {
    console.error("terms: locales/ko.json and en.json must be flat string maps");
    return 2;
  }
  const loaded = loadShippedTerms();
  if (!loaded.ok) {
    console.error(
      `terms: terms.json does not match the term schema: ${JSON.stringify(loaded.error.issues)}`,
    );
    return 2;
  }
  const TERMS = loaded.value;
  if (command === "gen") {
    const generated = generateTermKeys(TERMS);
    writeCatalog("ko", mergeTermKeys(ko, generated.ko));
    writeCatalog("en", mergeTermKeys(en, generated.en));
    if (flags.includes("--mockups")) writeFileSync(MOCKUP_FILE, generateMockupTerms(TERMS));
    if (existsSync(GLOSSARY_FILE)) {
      const glossary = readFileSync(GLOSSARY_FILE, "utf8");
      const replaced = replaceGlossaryZone(glossary, generateGlossaryZone(TERMS));
      if (replaced !== undefined && replaced !== glossary) writeFileSync(GLOSSARY_FILE, replaced);
    }
    console.log(`terms gen: ${String(Object.keys(generated.en).length)} term keys`);
    return 0;
  }
  if (command === "check") {
    if (!existsSync(DOCS_DIR)) {
      console.error(`terms: ${relative(ROOT, DOCS_DIR)} not found`);
      return 2;
    }
    const mockup = existsSync(MOCKUP_FILE) ? readFileSync(MOCKUP_FILE, "utf8") : undefined;
    const violations = [
      ...checkTermSource(TERMS, collectDocIds(DOCS_DIR)),
      ...checkCatalogs(ko, en, TERMS),
      ...checkMockupTerms(TERMS, mockup),
      ...checkGlossary(
        TERMS,
        existsSync(GLOSSARY_FILE) ? readFileSync(GLOSSARY_FILE, "utf8") : undefined,
      ),
    ];
    if (flags.includes("--json")) console.log(JSON.stringify(violations, null, 2));
    else
      for (const v of violations) console.log(`FAIL ${v.rule} ${v.where}: ${v.message} → ${v.fix}`);
    console.log(
      `terms check: ${String(Object.keys(TERMS).length)} terms, ${String(Object.keys(en).length)} keys, ${String(violations.length)} violations`,
    );
    return violations.length === 0 ? 0 : 1;
  }
  console.error("usage: bun scripts/terms.ts gen [--mockups] | check [--json]");
  return 2;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));

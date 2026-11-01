// 용어 검사 1단계 규칙(i18n-term-lint 설계 §5, §7, §8): C-04·C-05·C-08(카탈로그 문장), S-02·S-03(화면 소스), D-01·D-02(문서).
// 이 파일은 읽은 내용을 받아 위반 목록만 돌려준다. 파일을 읽는 일과 출력은 terms.ts가 한다.
// 검사 대상에서 빼는 것: `cli.*` 키와 CLI 코드(CLI는 내부 개발 도구), 생성물 `term.*` 키, 시험 파일, 문서 기록(_research, decisions, review).
import type { TermDecl } from "../packages/client/src/i18n/terms.ts";
import type { Catalog, Violation } from "./terms.ts";

type Terms = Readonly<Record<string, TermDecl>>;

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

export type Exposure = "chat" | "settings" | "workbench" | "skip";

/** 키 이름공간으로 노출 위치를 정한다. `cli.*`와 `term.*`는 검사 대상이 아니다 */
export function exposureOf(key: string): Exposure {
  if (key.startsWith("cli.") || key.startsWith("term.")) return "skip";
  if (
    key.startsWith("settings.") ||
    key.startsWith("client.settings.") ||
    key.startsWith("client.accounts.")
  ) {
    return "settings";
  }
  if (/^desktop\.(bench|canvas|compose)\./.test(key)) return "workbench";
  return "chat";
}

function isLatin(word: string): boolean {
  return /^[\x20-\x7e]+$/.test(word);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 문장에서 말이 나오는지 본다. 라틴 문자는 단어 경계와 대소문자 무시, 한글은 부분 문자열이다 */
export function mentions(text: string, word: string): boolean {
  if (!isLatin(word)) return text.includes(word);
  return new RegExp(`(?<![A-Za-z])${escapeRegExp(word)}(?![A-Za-z])`, "i").test(text);
}

/** 백틱으로 감싼 id와 `{인자}`는 문장이 아니라 기계 값이라 뺀다 */
function proseOf(text: string): string {
  return text.replace(/`[^`]*`/g, " ").replace(/\{[A-Za-z][A-Za-z0-9]*\}/g, " ");
}

/** 별칭이 함께 쓰이는 더 긴 정식 말의 일부일 때만 나오는 경우(예: 비밀 → 비밀번호)를 거른다 */
const ALIAS_COMPOUNDS: Readonly<Record<string, readonly string[]>> = {
  비밀: ["비밀번호"],
};

function mentionsAlias(text: string, alias: string): boolean {
  let rest = text;
  for (const compound of ALIAS_COMPOUNDS[alias] ?? []) rest = rest.split(compound).join(" ");
  return mentions(rest, alias);
}

interface Alias {
  readonly word: string;
  /** 정식 이름으로 안내할 개념 id */
  readonly concept: string;
  readonly canonical: string;
  /** 있으면 이 폴더(docs/xeon 기준) 아래 문서에서만 금지한다 */
  readonly under?: readonly string[];
}

function aliasesOf(terms: Terms, kind: "ui" | "docs"): Alias[] {
  const out: Alias[] = [];
  for (const id of Object.keys(terms).toSorted()) {
    const term = terms[id];
    if (term === undefined) continue;
    const canonical = term.ui?.ko ?? term.doc.ko;
    for (const word of term.forbid?.[kind] ?? []) out.push({ word, concept: id, canonical });
    if (kind === "docs") {
      for (const scoped of term.forbid?.docsIn ?? []) {
        out.push({ word: scoped.word, concept: id, canonical, under: scoped.under });
      }
    }
  }
  return out;
}

// --- 카탈로그 문장 C-04, C-05, C-08 ------------------------------------------------------------------------------

const NOUN_SUFFIXES: ReadonlySet<string> = new Set(["label", "title", "button", "badge", "tab"]);
/** 문장 끝의 종결어미(해요체 `요`, 합쇼체·해라체 `다`)와 뒤따르는 문장부호 */
const SENTENCE_END = /(요|다)[.!?]*$/;
const POLITE_END = /요[.!?]*$/;

/** 문자열 끝에서 ICU 인자나 닫는 괄호를 건너뛴 본문 */
function trimmedProse(text: string): string {
  return text.replace(/[\s)\]}"'’”]+$/g, "").replace(/\s*\{[A-Za-z][A-Za-z0-9]*\}\s*$/, "");
}

export function checkCatalogStyle(ko: Catalog, en: Catalog, terms: Terms): Violation[] {
  const out: Violation[] = [];
  const forbidden = aliasesOf(terms, "ui");
  const locales = [
    ["ko", ko],
    ["en", en],
  ] as const;
  for (const [locale, catalog] of locales) {
    for (const key of Object.keys(catalog).toSorted()) {
      const exposure = exposureOf(key);
      if (exposure === "skip") continue;
      const text = proseOf(catalog[key] ?? "");
      const where = `locales/${locale}.json ${key}`;
      if (exposure === "chat") {
        for (const word of CHAT_INTERNAL_WORDS) {
          if (mentions(text, word)) {
            out.push({
              rule: "C-04",
              where,
              message: `chat string contains the internal word "${word}"`,
              fix: "write the user-facing label from terms.json instead",
            });
          }
        }
      }
      for (const alias of forbidden) {
        if (!mentionsAlias(text, alias.word)) continue;
        out.push({
          rule: exposure === "chat" ? "C-04" : "C-05",
          where,
          message: `forbidden alias "${alias.word}" of ${alias.concept}`,
          fix: `use the label "${alias.canonical}" (terms.json ${alias.concept})`,
        });
      }
    }
  }
  for (const key of Object.keys(ko).toSorted()) {
    if (exposureOf(key) === "skip") continue;
    const text = trimmedProse(ko[key] ?? "");
    const last = key.split(".").pop() ?? key;
    const sentence = SENTENCE_END.test(text);
    if (NOUN_SUFFIXES.has(last)) {
      if (sentence) {
        out.push({
          rule: "C-08",
          where: `locales/ko.json ${key}`,
          message: "a label must be a noun phrase, but this ends like a sentence",
          fix: "write a noun phrase",
        });
      }
    } else if (sentence && !POLITE_END.test(text)) {
      out.push({
        rule: "C-08",
        where: `locales/ko.json ${key}`,
        message: "sentences use the 해요체 (~요), but this ends with ~다",
        fix: "rewrite the sentence in 해요체",
      });
    }
  }
  return out;
}

// --- 화면 소스 S-02, S-03 ------------------------------------------------------------------------------------------

export interface SourceText {
  /** xeon 루트 기준 경로, 슬래시 */
  readonly path: string;
  readonly text: string;
}

/** 화면 문자열을 담는 소스: L4 desktop·client의 `src`. 시험, 카탈로그와 원본(`i18n/`), 목업은 뺀다 */
export function isScreenSource(path: string): boolean {
  return (
    /^(apps\/desktop|packages\/client)\/src\//.test(path) &&
    /\.tsx?$/.test(path) &&
    !path.startsWith("packages/client/src/i18n/") &&
    !/(^|\/)(test|testing|mockups)\//.test(path) &&
    !path.endsWith(".d.ts")
  );
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let at = 0; at < index; at += 1) if (text.charCodeAt(at) === 10) line += 1;
  return line;
}

/** 주석을 같은 길이의 공백으로 바꾼다(줄 번호를 지키려고 줄바꿈은 둔다). 문자열 안의 `//`는 건드리지 않는다 */
export function blankComments(text: string): string {
  let out = "";
  let at = 0;
  while (at < text.length) {
    const ch = text.charAt(at);
    const next = text.charAt(at + 1);
    if (ch === "/" && next === "/") {
      while (at < text.length && text.charAt(at) !== "\n") {
        out += " ";
        at += 1;
      }
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", at + 2);
      const stop = end < 0 ? text.length : end + 2;
      for (; at < stop; at += 1) out += text.charAt(at) === "\n" ? "\n" : " ";
    } else if (ch === '"' || ch === "'" || ch === "`") {
      out += ch;
      at += 1;
      while (at < text.length && text.charAt(at) !== ch) {
        if (text.charAt(at) === "\\") {
          out += text.charAt(at);
          at += 1;
        }
        if (ch !== "`" && text.charAt(at) === "\n") break;
        out += text.charAt(at);
        at += 1;
      }
      if (at < text.length) {
        out += text.charAt(at);
        at += 1;
      }
    } else {
      out += ch;
      at += 1;
    }
  }
  return out;
}

const SCREEN_ATTRIBUTES =
  /\b(?:aria-label|title|placeholder|alt|label)\s*=\s*(?:"([^"\n]*)"|\{\s*(?:"([^"\n]*)"|'([^'\n]*)')\s*\})/g;
/** 여는 태그 바로 뒤의 글자 노드. 제네릭(`useState<T>(`)이 아니도록 `<` 앞은 식별자·괄호가 아니어야 한다 */
const JSX_TEXT = /(?<![\w$)\]])<([A-Za-z][\w.]*)(?:\s[^<>]*)?>([^<>{}]+)(?=<)/g;
/** 기계 이름을 보이는 태그 */
const MACHINE_TAGS: ReadonlySet<string> = new Set(["code", "kbd", "pre", "samp", "var"]);
const UNIT = /^(?:[0-9.,\s]*(?:ms|s|m|h|d|kb|mb|gb|kib|mib|gib|b|px|%|x))+$/i;

/** 영어 단어 문자열인가: 영어 단어(3자 이상)가 있고, 기계 이름(a.b.c, kebab, snake, camelCase)이나 단위가 아니다 */
export function isUiEnglish(raw: string): boolean {
  const text = raw.trim();
  if (!/[A-Za-z]{3,}/.test(text)) return false;
  if (/[;()=?|&]/.test(text)) return false;
  if (UNIT.test(text)) return false;
  if (/[가-힣]/.test(text)) return false;
  if (!/\s/.test(text)) {
    if (/[._\-/:@#]/.test(text)) return false;
    if (/[a-z][A-Z]/.test(text)) return false;
  }
  return true;
}

export function checkScreenSource(files: readonly SourceText[], terms: Terms): Violation[] {
  const out: Violation[] = [];
  const labels = new Map<string, string>();
  for (const id of Object.keys(terms).toSorted()) {
    const ui = terms[id]?.ui;
    if (ui === undefined || ui === null) continue;
    for (const label of [ui.ko, ui.en]) if (!labels.has(label)) labels.set(label, id);
  }
  for (const file of files) {
    if (!isScreenSource(file.path)) continue;
    const code = blankComments(file.text);
    if (file.path.endsWith(".tsx")) {
      for (const match of code.matchAll(SCREEN_ATTRIBUTES)) {
        const value = match[1] ?? match[2] ?? match[3] ?? "";
        if (!isUiEnglish(value)) continue;
        out.push({
          rule: "S-02",
          where: `${file.path}:${String(lineOf(code, match.index))}`,
          message: `English UI string "${value.trim().slice(0, 40)}" in a screen attribute`,
          fix: "add a catalog key and use t()",
        });
      }
      for (const match of code.matchAll(JSX_TEXT)) {
        const tag = match[1] ?? "";
        const value = match[2] ?? "";
        if (MACHINE_TAGS.has(tag) || !isUiEnglish(value)) continue;
        out.push({
          rule: "S-02",
          where: `${file.path}:${String(lineOf(code, match.index + match[0].indexOf(value)))}`,
          message: `English UI string "${value.trim().slice(0, 40)}" in JSX text`,
          fix: "add a catalog key and use t()",
        });
      }
    }
    for (const match of code.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
      const value = match[2] ?? "";
      const concept = labels.get(value);
      if (concept === undefined) continue;
      out.push({
        rule: "S-03",
        where: `${file.path}:${String(lineOf(code, match.index))}`,
        message: `the label "${value}" of ${concept} is written as a string`,
        fix: `use the catalog key term.${concept}`,
      });
    }
  }
  return out;
}

// --- 문서 D-01, D-02 -----------------------------------------------------------------------------------------------

export interface DocText {
  /** docs/xeon 기준 경로, 슬래시 */
  readonly path: string;
  /** 프런트매터의 id. 없으면 undefined */
  readonly id: string | undefined;
  /** 프런트매터를 뺀 본문 */
  readonly body: string;
  /** 본문이 시작하는 줄 번호 - 1 */
  readonly bodyOffset: number;
}

/** 기록 문서(검사하지 않는다): 조사 자료, 결정 기록, 검토 기록, 서식 */
export function isRecordDoc(path: string): boolean {
  return /^(_research|decisions|review|_templates)\//.test(path);
}

function termKeys(term: TermDecl): string[] {
  const out = [term.doc.ko, term.doc.en, ...(term.ids ?? [])];
  if (term.ui !== null) out.push(term.ui.ko, term.ui.en);
  return out;
}

function normalizeTerm(cell: string): string {
  return cell.replace(/`/g, "").trim().toLowerCase();
}

/** 용어표 첫 칸을 원본의 이름(문서 용어, 화면 라벨, 기계 id)이나 문서 전용 목록과 맞춘다. 칸 안의 `/`·`,`·`·`로 나눈 조각도 본다 */
function knownTerm(cell: string, known: ReadonlySet<string>): boolean {
  const whole = normalizeTerm(cell);
  if (known.has(whole)) return true;
  const base = whole.replace(/\s*[(（].*$/, "").trim();
  if (known.has(base)) return true;
  const parts = whole.split(/\s*[/,·]\s*/).filter((part) => part !== "");
  return parts.length > 1 && parts.every((part) => known.has(part.replace(/\s*[(（].*$/, "")));
}

/** `## 2. 용어` 절 바로 아래 표의 첫 칸 목록(`###` 아래 표는 보지 않는다) */
export function specTermCells(body: string): { cell: string; line: number }[] {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => /^##\s+2\.\s*용어/.test(line));
  if (start < 0) return [];
  const out: { cell: string; line: number }[] = [];
  let header = true;
  for (let at = start + 1; at < lines.length; at += 1) {
    const line = lines[at] ?? "";
    if (/^#{2,3}\s/.test(line)) break;
    if (!line.startsWith("|")) {
      if (out.length > 0 || !header) header = true;
      continue;
    }
    if (/^\|\s*:?-{2,}/.test(line)) continue;
    if (header) {
      header = false;
      continue;
    }
    const cell = (line.split("|")[1] ?? "").trim();
    if (cell !== "") out.push({ cell, line: at + 1 });
  }
  return out;
}

/** 문서 본문에서 검사에 쓰지 않는 자리(코드 블록, 인용 줄, 인라인 코드, 따옴표로 묶은 말)를 공백으로 바꾼다. 줄 수는 그대로다 */
export function proseOfDoc(body: string): string[] {
  const lines = body.split("\n");
  let fenced = false;
  return lines.map((raw) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      return "";
    }
    if (fenced || /^\s*>/.test(raw)) return "";
    return raw
      .replace(/`[^`]*`/g, " ")
      .replace(/"[^"]*"/g, " ")
      .replace(/“[^”]*”/g, " ")
      .replace(/‘[^’]*’/g, " ")
      .replace(/「[^」]*」/g, " ");
  });
}

export function checkDocs(
  docs: readonly DocText[],
  terms: Terms,
  docOnly: readonly string[],
): Violation[] {
  const out: Violation[] = [];
  const known = new Set<string>(docOnly.map(normalizeTerm));
  for (const id of Object.keys(terms)) {
    const term = terms[id];
    if (term === undefined) continue;
    for (const key of termKeys(term)) known.add(normalizeTerm(key));
  }
  const aliases = aliasesOf(terms, "docs");
  for (const doc of docs) {
    if (isRecordDoc(doc.path)) continue;
    for (const { cell, line } of specTermCells(doc.body)) {
      if (knownTerm(cell, known)) continue;
      out.push({
        rule: "D-01",
        where: `docs/xeon/${doc.path}:${String(line + doc.bodyOffset)}`,
        message: `term "${cell.replace(/`/g, "").slice(0, 40)}" in the §2 term table is neither in terms.json nor in the doc-only list`,
        fix: "add the concept to terms.json or the name to terms.doc-only.json",
      });
    }
    const prose = proseOfDoc(doc.body);
    prose.forEach((text, index) => {
      for (const alias of aliases) {
        if (alias.under !== undefined && !alias.under.some((dir) => doc.path.startsWith(dir)))
          continue;
        if (!mentionsAlias(text, alias.word)) continue;
        out.push({
          rule: "D-02",
          where: `docs/xeon/${doc.path}:${String(index + 1 + doc.bodyOffset)}`,
          message: `forbidden alias "${alias.word}" of ${alias.concept}`,
          fix: `write "${alias.canonical}" (terms.json ${alias.concept})`,
        });
      }
    });
  }
  return out;
}

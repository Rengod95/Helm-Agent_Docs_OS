// 용어 검사 3단계(i18n-term-lint 설계 §5, §8): C-09 안 쓰는 키, C-10 길이 예산(영어 화면 길이 포함), D-04 화면 문구 인용의 금지어.
// 셋 모두 경고(`level: "warn"`)다: 알리기만 하고 종료코드를 바꾸지 않는다. D-03(용어집 생성 구역)은 terms.ts의 `checkGlossary`가 오류로 본다.
// 읽은 내용을 받아 위반 목록만 돌려준다. 파일을 읽는 일과 출력은 terms.ts가 한다.
import type { TermDecl } from "../packages/client/src/i18n/terms.ts";
import { aliasesOf, exposureOf, mentionsAlias, type SourceText } from "./terms-rules.ts";
import type { Catalog, Violation } from "./terms.ts";

type Terms = Readonly<Record<string, TermDecl>>;

// --- C-09 안 쓰는 키 -------------------------------------------------------------------------------------------

/** 소스에서 쓰지 않아도 되는 이름공간: CLI 키(검사 밖), 생성물, 런타임에 호스트가 정하는 키(`settings.*` 라벨, `host.*` 오류) */
const RUNTIME_KEY_PREFIXES: readonly string[] = ["cli.", "term.", "settings.", "host."];

const KEY_LITERAL = /(["'`])([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)\1/g;
/** 템플릿 문자열(`` `a.b.${x}` ``)이나 `"a.b." + x`처럼 뒤를 런타임에 잇는 키의 앞부분 */
const KEY_PREFIX = /(?:`|(["']))([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*\.)(?:\$\{|\1\s*\+)/g;

/** 소스 문자열에서 카탈로그 키로 쓰인 것(정확히 같은 글자)과 동적 키의 앞부분을 모은다 */
export function keyUsesOf(sources: readonly SourceText[]): {
  readonly exact: ReadonlySet<string>;
  readonly prefixes: readonly string[];
} {
  const exact = new Set<string>();
  const prefixes = new Set<string>();
  for (const source of sources) {
    for (const match of source.text.matchAll(KEY_LITERAL)) {
      if (match[2] !== undefined) exact.add(match[2]);
    }
    for (const match of source.text.matchAll(KEY_PREFIX)) {
      if (match[2] !== undefined) prefixes.add(match[2]);
    }
  }
  return { exact, prefixes: [...prefixes] };
}

export function checkUnusedKeys(en: Catalog, sources: readonly SourceText[]): Violation[] {
  const uses = keyUsesOf(sources);
  const out: Violation[] = [];
  for (const key of Object.keys(en).toSorted()) {
    if (RUNTIME_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    if (uses.exact.has(key) || uses.prefixes.some((prefix) => key.startsWith(prefix))) continue;
    out.push({
      rule: "C-09",
      where: `locales/en.json ${key}`,
      message:
        "the key is not used by any t(), tKey(), <Msg id> or dynamic key prefix in the sources",
      fix: "delete the key from both catalogs, or use it",
      level: "warn",
    });
  }
  return out;
}

// --- C-10 길이 예산 --------------------------------------------------------------------------------------------

const BUDGET_SUFFIXES: ReadonlySet<string> = new Set(["label", "button", "tab"]);
export const KO_BUDGET = 12;
export const EN_BUDGET = 24;
export const EN_OVER_KO = 2.5;

/** ICU 인자 `{name}`는 화면에서 값으로 바뀌므로 한 글자로 센다 */
function shownLength(text: string): number {
  return Array.from(text.replace(/\{[^{}]*\}/g, "x")).length;
}

/** `.label`, `.button`, `.tab` 키가 ko 12자, en 24자를 넘거나 en이 ko의 2.5배를 넘으면 알린다. 설정 라벨은 폼 안에 있어 뺀다 */
export function checkLengthBudget(ko: Catalog, en: Catalog): Violation[] {
  const out: Violation[] = [];
  for (const key of Object.keys(en).toSorted()) {
    const suffix = key.slice(key.lastIndexOf(".") + 1);
    if (!BUDGET_SUFFIXES.has(suffix) || exposureOf(key) === "skip") continue;
    if (key.startsWith("settings.") || key.startsWith("client.settings.")) continue;
    const koText = ko[key];
    const enText = en[key];
    if (koText === undefined || enText === undefined) continue;
    const koLength = shownLength(koText);
    const enLength = shownLength(enText);
    const reasons: string[] = [];
    if (koLength > KO_BUDGET)
      reasons.push(`ko has ${String(koLength)} characters (budget ${String(KO_BUDGET)})`);
    if (enLength > EN_BUDGET)
      reasons.push(`en has ${String(enLength)} characters (budget ${String(EN_BUDGET)})`);
    if (koLength > 0 && enLength > koLength * EN_OVER_KO) {
      reasons.push(
        `en is ${(enLength / koLength).toFixed(1)}x the ko length (limit ${String(EN_OVER_KO)}x)`,
      );
    }
    if (reasons.length === 0) continue;
    out.push({
      rule: "C-10",
      where: `locales/en.json ${key}`,
      message: reasons.join("; "),
      fix: "shorten the label so the English screen does not break",
      level: "warn",
    });
  }
  return out;
}

// --- D-04 화면 문구 인용의 금지어 --------------------------------------------------------------------------------

const UX_SPEC = "L4/desktop-ux/spec.md";
const QUOTE = /“([^”\n]*)”|"([^"\n]*)"/g;

export interface QuotedDoc {
  readonly path: string;
  readonly body: string;
  readonly bodyOffset: number;
}

/** desktop-ux spec가 큰따옴표로 인용한 화면 문구에 원본의 화면 금지 별칭(`forbid.ui`)이 있으면 알린다. 코드 블록은 보지 않는다 */
export function checkUiQuotes(docs: readonly QuotedDoc[], terms: Terms): Violation[] {
  const doc = docs.find((candidate) => candidate.path === UX_SPEC);
  if (doc === undefined) return [];
  const aliases = aliasesOf(terms, "ui");
  const out: Violation[] = [];
  let fenced = false;
  doc.body.split("\n").forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    for (const match of line.matchAll(QUOTE)) {
      const quoted = (match[1] ?? match[2] ?? "").replace(/`[^`]*`/g, " ");
      for (const alias of aliases) {
        if (!mentionsAlias(quoted, alias.word)) continue;
        out.push({
          rule: "D-04",
          where: `docs/xeon/${doc.path}:${String(index + 1 + doc.bodyOffset)}`,
          message: `the quoted screen text "${quoted}" uses the forbidden alias "${alias.word}" of ${alias.concept}`,
          fix: `write "${alias.canonical}" (terms.json ${alias.concept})`,
          level: "warn",
        });
      }
    }
  });
  return out;
}

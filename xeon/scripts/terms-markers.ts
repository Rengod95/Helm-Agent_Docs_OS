// 용어 끼워 넣기(i18n-term-lint 설계 §6, 용어 검사 2단계): 문장 안의 `[[개념id]]` 표식을 용어 라벨로, `[[을/를]]` 같은 조사 표식을 앞말의
// 받침에 맞는 조사로 바꾼다. 표식이 든 문장은 `locales/ko.src.json`, `en.src.json`(덧씌움 원본)에 적고, `just terms gen`이 풀어서
// `locales/ko.json`, `en.json`의 같은 키에 쓴다. 표식이 없는 문장은 그대로 `ko.json`, `en.json`을 고친다.
// 검사: C-12 표식의 개념 id가 원본에 있고 en에는 조사 표식이 없음, C-13 조사 표식은 라벨 표식이나 ICU 인자 바로 뒤에 붙음,
// C-14 `ko.json`, `en.json`의 값이 덧씌움 원본을 푼 결과와 같음.
// 조사: 앞말이 한글이면 받침으로 고른다(`으로/로`는 ㄹ 받침을 받침 없음으로 본다). 앞말이 ICU 인자(`{name}`)이거나 라틴 문자로 끝나
// 받침을 알 수 없으면 괄호 꼴(`을(를)`)로 쓴다.
import type { TermDecl } from "../packages/client/src/i18n/terms.ts";
import type { Catalog, Violation } from "./terms.ts";

type Terms = Readonly<Record<string, TermDecl>>;
export type Locale = "ko" | "en";

const JOSA_PAIRS: ReadonlyMap<string, { readonly withFinal: string; readonly without: string }> =
  new Map([
    ["을/를", { withFinal: "을", without: "를" }],
    ["이/가", { withFinal: "이", without: "가" }],
    ["은/는", { withFinal: "은", without: "는" }],
    ["과/와", { withFinal: "과", without: "와" }],
    ["으로/로", { withFinal: "으로", without: "로" }],
  ]);

const MARKER = /\[\[([^\]]+)\]\]/g;
const ICU_ARG = /\{[A-Za-z][A-Za-z0-9]*\}$/;

/** 마지막 글자의 받침 여부. 한글이 아니면 undefined */
export function hasFinalConsonant(text: string): boolean | undefined {
  const last = text.trimEnd().slice(-1);
  if (last < "가" || last > "힣") return undefined;
  return (last.charCodeAt(0) - 0xac00) % 28 !== 0;
}

function isRieul(text: string): boolean {
  const last = text.trimEnd().slice(-1);
  return last >= "가" && last <= "힣" && (last.charCodeAt(0) - 0xac00) % 28 === 8;
}

/** 조사 표식 하나를 앞말에 맞게 푼다. 받침을 알 수 없으면 괄호 꼴이다 */
export function pickJosa(pair: string, before: string): string | undefined {
  const forms = JOSA_PAIRS.get(pair);
  if (forms === undefined) return undefined;
  const final = hasFinalConsonant(before);
  if (final === undefined) return `${forms.withFinal}(${forms.without})`;
  if (pair === "으로/로" && isRieul(before)) return forms.without;
  return final ? forms.withFinal : forms.without;
}

export function labelOf(term: TermDecl, locale: Locale): string {
  return term.ui === null ? term.doc[locale] : term.ui[locale];
}

export type ExpandResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly errors: readonly string[] };

/** 표식이 든 문장을 푼다. 알 수 없는 표식과 어긋난 조사 표식은 오류 문자열로 모은다 */
export function expandMarkers(source: string, terms: Terms, locale: Locale): ExpandResult {
  const errors: string[] = [];
  let out = "";
  let at = 0;
  /** 바로 앞 토큰이 라벨 표식이었는가(그 사이에 글자가 없었는가) */
  let afterLabel = false;
  for (const match of source.matchAll(MARKER)) {
    const body = match[1] ?? "";
    const text = source.slice(at, match.index);
    out += text;
    at = match.index + match[0].length;
    if (text !== "") afterLabel = false;
    if (JOSA_PAIRS.has(body)) {
      if (locale === "en") {
        errors.push(`josa marker [[${body}]] in an en sentence`);
      } else if (!afterLabel && !ICU_ARG.test(out)) {
        errors.push(`josa marker [[${body}]] does not follow a label marker or an ICU argument`);
      } else {
        out += pickJosa(body, out) ?? "";
      }
      afterLabel = false;
      continue;
    }
    const term = terms[body];
    if (term === undefined) {
      errors.push(`unknown concept id [[${body}]]`);
      continue;
    }
    out += labelOf(term, locale);
    afterLabel = true;
  }
  out += source.slice(at);
  return errors.length === 0 ? { ok: true, text: out } : { ok: false, errors };
}

/** 덧씌움 원본을 풀어 키별 문장을 만든다(오류가 있는 키는 건너뛰고 위반으로 돌려준다) */
export function expandOverlay(
  overlay: Catalog,
  terms: Terms,
  locale: Locale,
): { readonly expanded: Catalog; readonly violations: Violation[] } {
  const expanded: Record<string, string> = {};
  const violations: Violation[] = [];
  for (const key of Object.keys(overlay).toSorted()) {
    const result = expandMarkers(overlay[key] ?? "", terms, locale);
    if (result.ok) {
      expanded[key] = result.text;
      continue;
    }
    for (const error of result.errors) {
      violations.push({
        rule: error.startsWith("unknown concept") ? "C-12" : "C-13",
        where: `locales/${locale}.src.json ${key}`,
        message: error,
        fix: error.startsWith("unknown concept")
          ? "use a concept id from terms.json"
          : "attach the josa marker to a label marker or an ICU argument (ko only)",
      });
    }
  }
  return { expanded, violations };
}

/** 덧씌움 원본이 있는 키는 카탈로그의 값을 푼 결과로 바꾼다(없는 키는 새로 더한다) */
export function applyOverlay(catalog: Catalog, expanded: Catalog): Catalog {
  const out: Record<string, string> = { ...catalog };
  for (const [key, value] of Object.entries(expanded)) out[key] = value;
  return out;
}

export function checkOverlay(
  overlayKo: Catalog,
  overlayEn: Catalog,
  ko: Catalog,
  en: Catalog,
  terms: Terms,
): Violation[] {
  const koResult = expandOverlay(overlayKo, terms, "ko");
  const enResult = expandOverlay(overlayEn, terms, "en");
  const out: Violation[] = [...koResult.violations, ...enResult.violations];
  for (const key of Object.keys(overlayKo)) {
    if (overlayEn[key] === undefined) {
      out.push({
        rule: "C-01",
        where: `locales/en.src.json ${key}`,
        message: "key is missing in en.src.json",
        fix: "add the key to en.src.json, or write the sentence in en.json without markers",
      });
    }
  }
  for (const key of Object.keys(overlayEn)) {
    if (overlayKo[key] === undefined) {
      out.push({
        rule: "C-01",
        where: `locales/ko.src.json ${key}`,
        message: "key is missing in ko.src.json",
        fix: "add the key to ko.src.json, or write the sentence in ko.json without markers",
      });
    }
  }
  for (const [locale, expanded, actual] of [
    ["ko", koResult.expanded, ko],
    ["en", enResult.expanded, en],
  ] as const) {
    for (const key of Object.keys(expanded)) {
      if (actual[key] !== expanded[key]) {
        out.push({
          rule: "C-14",
          where: `locales/${locale}.json ${key}`,
          message: "the sentence differs from the expansion of its .src.json source",
          fix: "run `just terms gen` (edit the sentence in the .src.json file, not in the catalog)",
        });
      }
    }
  }
  return out;
}

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJson } from "@fresnel/contracts";

// 화면 어디에도 가운뎃점을 구분자로 쓰지 않는다(lcDot, 사용자 2026-11-22 "가운뎃점 절대 쓰지마 … 모든 디자인에대해 싹다 절대 지침으로",
// L4 desktop-ux spec §13.0 DP-226). 항목은 따로 선 요소와 간격 토큰으로 나눈다. 다른 구분 글자로 바꾸는 것도 이 규칙을 피한 것이라
// 비슷한 글자(•, ‧, ・, ㆍ)도 함께 막는다. 주석은 대상이 아니다. 예외는 아래 `ALLOWED`에 까닭과 함께 둔다.

/** U+00B7 가운뎃점, U+2022 글머리 점, U+2027 하이픈 점, U+30FB 가타카나 가운뎃점, U+318D 아래아 */
const DOTS = /[·•‧・ㆍ]/gu;

/** 넷 이상 이어진 글머리 점은 시크릿 가림(`••••`)이다. 구분자가 아니다 */
const MASK = /•{4,}/gu;

const XEON = join(import.meta.dir, "..", "..", "..", "..");
const LOCALES = join(XEON, "packages", "client", "src", "i18n", "locales");

/** 화면에 나오지 않는 카탈로그 묶음: 배포하지 않는 CLI의 도움말, 비용 표, 진단 출력(데스크톱 소스가 쓰지 않는다) */
const CLI_ONLY = /^cli\.(help|cost|doctor)\./u;

/**
 * 소스의 예외(화면 소스 기준 상대 경로). 가운뎃점을 화면에 그리지 않는 자리뿐이다:
 * - `views/convo/citation-model.ts`: 모델이 쓴 인용 줄의 구분자(`·`)를 읽어 걷어 내는 정규식이다(사용자 글을 읽는 쪽)
 */
const ALLOWED: readonly string[] = ["apps/desktop/src/views/convo/citation-model.ts"];

/** 글에서 구분자로 쓰인 점들. 시크릿 가림은 뺀다 */
function dotsIn(text: string): string[] {
  return [...text.replace(MASK, "").matchAll(DOTS)].map((match) => match[0]);
}

function catalogOf(locale: string): Record<string, unknown> {
  const parsed = parseJson(readFileSync(join(LOCALES, `${locale}.json`), "utf8"));
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
    throw new Error(`${locale}.json does not parse`);
  }
  return Object.fromEntries(Object.entries(parsed.value));
}

function filesUnder(root: string, extensions: readonly string[]): string[] {
  return readdirSync(join(XEON, root), { recursive: true, encoding: "utf8" })
    .filter((name) => extensions.some((ext) => name.endsWith(ext)))
    .filter((name) => !name.split("/").includes("node_modules"))
    .map((name) => `${root}/${name}`)
    .toSorted();
}

// 주석과 문자열을 왼쪽부터 한 번에 읽는다(source-scan.ts와 같은 문법). 주석은 지우고 문자열은 남긴다
const LEXEME =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/gu;

/** 주석을 뺀 소스(줄 수는 그대로): 문자열, 템플릿, JSX 글이 모두 남는다. JSX의 중괄호 주석도 빠진다 */
function withoutComments(source: string): string {
  return source.replace(LEXEME, (lexeme) =>
    lexeme.startsWith("/") ? lexeme.replace(/[^\n]/gu, "") : lexeme,
  );
}

/** 줄마다 점이 든 줄을 "파일:줄: 글"로 */
function linesWithDots(file: string, text: string): string[] {
  return text
    .split("\n")
    .flatMap((line, index) =>
      dotsIn(line).length === 0
        ? []
        : [`${file}:${String(index + 1)}: ${line.trim().slice(0, 100)}`],
    );
}

test("the detector finds separators and skips secret masks", () => {
  expect([
    dotsIn("Driving by authoring · 0/4턴"),
    dotsIn("a • b ‧ c ・ d ㆍ e"),
    dotsIn("sk-••••••••"),
    dotsIn("0/4턴"),
    withoutComments('// a · b\nconst x = "c · d"; /* e · f */'),
  ]).toEqual([["·"], ["•", "‧", "・", "ㆍ"], [], [], '\nconst x = "c · d"; ']);
});

test("no catalog value on a desktop screen carries a middle dot", () => {
  const found = ["ko", "en"].flatMap((locale) =>
    Object.entries(catalogOf(locale))
      .filter(([key]) => !CLI_ONLY.test(key))
      .flatMap(([key, value]) =>
        typeof value === "string" && dotsIn(value).length > 0 ? [`${locale} ${key}: ${value}`] : [],
      ),
  );
  expect(found).toEqual([]);
});

test("no desktop source string, template or JSX text carries a middle dot", () => {
  const files = [
    ...filesUnder("apps/desktop/src", [".ts", ".tsx"]),
    ...filesUnder("packages/client/src", [".ts", ".tsx"]),
    ...filesUnder("apps/desktop-shell/src", [".ts", ".tsx"]),
  ].filter((file) => !ALLOWED.includes(file));
  const found = files.flatMap((file) =>
    linesWithDots(file, withoutComments(readFileSync(join(XEON, file), "utf8"))),
  );
  expect(found).toEqual([]);
});

test("no desktop stylesheet draws a middle dot with `content`", () => {
  const found = filesUnder("apps/desktop/src", [".css"]).flatMap((file) =>
    linesWithDots(
      file,
      readFileSync(join(XEON, file), "utf8").replace(/\/\*[\s\S]*?\*\//gu, (c) =>
        c.replace(/[^\n]/gu, " "),
      ),
    ),
  );
  expect(found).toEqual([]);
});

test("every exception still exists, so the list does not hide a new file", () => {
  expect(ALLOWED.map((file) => readFileSync(join(XEON, file), "utf8").length > 0)).toEqual(
    ALLOWED.map(() => true),
  );
});

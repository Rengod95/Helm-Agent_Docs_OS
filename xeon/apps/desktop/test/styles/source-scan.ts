import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// 화면 소스(src)를 읽어 문자열과 템플릿 조각을 뽑는 시험 보조. 스타일 검사들이 함께 쓴다.

export const SRC: string = join(import.meta.dir, "..", "..", "src");

export function sourceFiles(extensions: readonly string[]): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((name) => extensions.some((ext) => name.endsWith(ext)))
    .map((name) => join(SRC, name))
    .toSorted();
}

export function read(file: string): string {
  return readFileSync(file, "utf8");
}

export function relative(file: string): string {
  return file.slice(SRC.length + 1);
}

// 주석과 문자열을 왼쪽부터 한 번에 읽는다(문자열 안의 `//`와 주석 안의 따옴표를 헷갈리지 않는다)
const LEXEME =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g;

export interface Literal {
  readonly file: string;
  readonly text: string;
}

/** 소스의 문자열 리터럴 안쪽 글. 템플릿의 `${…}` 자리는 공백으로 바꾼다 */
function literalsOf(file: string): Literal[] {
  const literals: Literal[] = [];
  for (const match of read(file).matchAll(LEXEME)) {
    const lexeme = match[0];
    const first = lexeme.charAt(0);
    if (first === "/") continue;
    const inner = lexeme.slice(1, -1);
    literals.push({ file, text: first === "`" ? inner.replace(/\$\{[^}]*\}/g, " ") : inner });
  }
  return literals;
}

export function allLiterals(): Literal[] {
  return sourceFiles([".ts", ".tsx"]).flatMap(literalsOf);
}

import { expect, test } from "bun:test";
import { join } from "node:path";
import { buildCss } from "./built-css.ts";
import { read, SRC } from "./source-scan.ts";

// src/styles.css의 무층(unlayered) 규칙은 특이도와 상관없이 caustic의 base·components·utilities 층을 이긴다.
// 그래서 옛 화면 규칙이 caustic 부품과 토큰 위에 덮이지 않도록, 무층으로는 `:root` 변수 선언만 허용한다.

interface Block {
  readonly prelude: string;
  readonly body: string;
}

/** 중괄호 한 단계의 블록들. `@import …;` 같은 문장은 건너뛴다 */
function blocksOf(css: string): Block[] {
  const blocks: Block[] = [];
  let depth = 0;
  let preludeStart = 0;
  let bodyStart = 0;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css.charAt(i);
    if (ch === "{") {
      if (depth === 0) {
        bodyStart = i + 1;
      }
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const head = css.slice(preludeStart, bodyStart - 1);
        blocks.push({
          prelude: head.slice(head.lastIndexOf(";") + 1).trim(),
          body: css.slice(bodyStart, i),
        });
        preludeStart = i + 1;
      }
    }
  }
  return blocks;
}

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 층 밖에서 `:root` 변수 선언이 아닌 스타일 규칙의 선택자 */
function unlayeredStyleRules(css: string): string[] {
  const violations: string[] = [];
  for (const { prelude, body } of blocksOf(css)) {
    if (prelude.startsWith("@layer")) continue;
    if (prelude.startsWith("@media") || prelude.startsWith("@supports")) {
      violations.push(...unlayeredStyleRules(body));
      continue;
    }
    if (prelude.startsWith("@")) {
      violations.push(prelude); // @font-face, @keyframes 등은 이 파일에 두지 않는다(CSS 파일로 나눈다)
      continue;
    }
    const declarations = body
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    const onlyVariables = declarations.every((part) => part.startsWith("--"));
    if (prelude !== ":root" || !onlyVariables) violations.push(prelude);
  }
  return violations;
}

const STYLES = withoutComments(read(join(SRC, "styles.css")));

test("styles.css keeps nothing unlayered except :root variable declarations", () => {
  expect(unlayeredStyleRules(STYLES)).toEqual([]);
});

test("the checker flags an unlayered element rule and a :root font override", () => {
  const sample =
    "button { color: red; } :root { font-size: 14px; } @media (x) { .a { top: 0; } } :root { --a: 1; }";
  expect(unlayeredStyleRules(sample)).toEqual(["button", ":root", ".a"]);
});

test("old element rules sit in the base layer at specificity zero and skip caustic parts", () => {
  const base = blocksOf(STYLES).find((block) => block.prelude === "@layer base");
  expect(base).toBeDefined();
  const selectors = blocksOf(base?.body ?? "")
    .map((block) => block.prelude)
    .filter((selector) => /\b(?:button|textarea|input)\b/.test(selector));
  expect(selectors.length).toBeGreaterThan(0);
  for (const selector of selectors) {
    for (const part of selector.split(",").map((piece) => piece.trim())) {
      expect(part).toMatch(/^:where\(.+\[data-slot\].*\)$/);
    }
  }
});

test("the built CSS carries the local SUIT font-face and nothing remote", async () => {
  const css = await buildCss();
  expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*"?SUIT Variable"?/);
  expect(css).toMatch(/url\([^)]*SUIT-Variable[^)]*\.woff2/);
  expect(css).not.toMatch(/@import\s+(?:url\()?["']?https?:/);
  expect(css).not.toMatch(/url\(\s*["']?https?:/);
}, 60_000);

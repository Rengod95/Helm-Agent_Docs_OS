import { expect, test } from "bun:test";
import { allLiterals, read, relative, sourceFiles } from "./source-scan.ts";

// 화면 소스에 두 가지 함정이 다시 생기지 않게 한다.

test("no underscore token inside a Tailwind arbitrary value", () => {
  // Tailwind는 임의 값 안의 `_`를 공백으로 바꾼다. `var(--cs-space-0_75)`는 `var(--cs-space-0 75)`가 되어 선언이 깨진다(caustic
  // agent-work-area.variants.ts의 밑줄 버그와 같은 모양). 토큰 이름에 밑줄이 있으면 CSS 파일이나 style 속성으로 쓴다.
  const found = allLiterals()
    .filter(({ text }) => /\[[^\]]*var\(--[\w-]*_[\w-]*/.test(text))
    .map(({ file, text }) => `${relative(file)}: ${text.trim().slice(0, 80)}`);
  expect(found).toEqual([]);
});

test("no inline <style> element in a view", () => {
  // Tauri CSP(`default-src 'self'`)는 인라인 <style>을 막는다. 웹에서만 되고 데스크톱에서 스타일이 사라진다. CSS 파일로 두고
  // src/styles.css에서 가져온다.
  const found = sourceFiles([".tsx"])
    .filter((file) => /<style[\s>]/.test(read(file)))
    .map(relative);
  expect(found).toEqual([]);
});

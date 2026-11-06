import { expect, test } from "bun:test";
import { buildCss, classNamesIn } from "./built-css.ts";
import { allLiterals, relative } from "./source-scan.ts";

// Tailwind 유틸리티처럼 생긴 클래스가 빌드된 CSS에 실제로 있는지 본다.
// caustic 테마는 Tailwind 기본 눈금(sm:, text-sm, text-xs, rounded, max-w-xl, tracking-widest, text-muted-foreground …)을
// `initial`로 지워서, 기본 이름을 쓰면 오류 없이 CSS가 만들어지지 않는다. 그 조용한 누락을 여기서 잡는다.
// 눈금은 caustic 이름(compact:/medium:/wide:, text-ui, text-text-secondary …)으로 쓴다.

const UTILITY_ROOT = new RegExp(
  "^-?(?:text|bg|border|border-[xytblrse]|p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|w|h|min-w|min-h|max-w|max-h|" +
    "gap|gap-x|gap-y|space-x|space-y|grid-cols|grid-rows|col-span|row-span|col-start|col-end|items|justify|self|font|leading|tracking|" +
    "rounded|rounded-[tblrse]{1,2}|shadow|ring|outline|opacity|z|top|left|right|bottom|inset|inset-x|inset-y|size|fill|stroke|divide|" +
    "order|basis|grow|shrink|duration|ease|animate|line-clamp|aspect|place-items|place-content|content|columns|translate-x|translate-y|scale|rotate)" +
    "-[\\w[]",
);

// 의도한 비-Tailwind 이름. 이유를 적는다.
const NOT_TAILWIND: ReadonlyMap<string, string> = new Map<string, string>([]);

// 아직 고치지 않은 누락. 파일 주인이 고치면 항목을 지운다(항목이 남아 있는데 누락이 없으면 시험이 실패한다).
const PENDING: ReadonlyMap<string, string> = new Map<string, string>([]);

function splitVariants(token: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i += 1) {
    const ch = token.charAt(i);
    if (ch === "[") depth += 1;
    else if (ch === "]") depth -= 1;
    else if (ch === ":" && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!/, "");
}

function looksLikeUtility(token: string): boolean {
  if (/[.](?![0-9])/.test(token.replace(/\[[^\]]*\]/g, ""))) return false; // 키 이름(desktop.x)이나 확장자
  if (/[{}(),;="<>]/.test(token.replace(/\[[^\]]*\]/g, ""))) return false;
  return UTILITY_ROOT.test(splitVariants(token));
}

test("every utility-shaped class in src exists in the built CSS", async () => {
  const generated = classNamesIn(await buildCss());
  const missing = new Map<string, Set<string>>();
  const stillPending = new Set<string>();
  for (const { file, text } of allLiterals()) {
    for (const token of text.split(/\s+/)) {
      if (token === "" || !looksLikeUtility(token)) continue;
      if (generated.has(token) || NOT_TAILWIND.has(token)) continue;
      if (PENDING.has(`${relative(file)} ${token}`)) {
        stillPending.add(`${relative(file)} ${token}`);
        continue;
      }
      const files = missing.get(token) ?? new Set<string>();
      files.add(relative(file));
      missing.set(token, files);
    }
  }
  const report = [...missing].map(([token, files]) => `${token}  (${[...files].join(", ")})`);
  expect(report).toEqual([]);
  expect([...PENDING.keys()].filter((key) => !stillPending.has(key))).toEqual([]);
}, 60_000);

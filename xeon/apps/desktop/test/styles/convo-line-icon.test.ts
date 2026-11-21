import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// lcM6i(사용자 2026-11-21 "생각하는 중 텍스트랑 좌측 아이콘이 align center가 안 맞아"). jsdom에는 배치가 없어 화소 정렬은 잴 수 없다.
// 정렬을 만드는 규칙이 convo.css에 그대로 있는지를 값으로 본다. 묶인 앱의 실제 값(8배 실측: 구슬 칸 가운데 14, 한글 글 가운데 13.75,
// 영어 14.25)은 `_notes/design/lc/lcM6i-shots/think-align-zoom8.png`에 있다. 아이콘 칸 자체는 옮기지 않는다(도구 줄과 같은 자리).

const STYLES = join(import.meta.dir, "..", "..", "src", "views");

function cssOf(file: string): string {
  return readFileSync(join(STYLES, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 선택자 목록에 `selector`가 든 규칙들의 선언을 모아 속성 → 값으로 돌려준다(뒤의 규칙이 이긴다) */
function declarationsOf(css: string, selector: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const line of (match[2] ?? "").split(";")) {
      const at = line.indexOf(":");
      if (at < 0) continue;
      out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  return out;
}

test("the thinking orb stays a block inside the icon cell, even though the caustic ring guard matches its slot", () => {
  // 안전망 `[data-slot$="-orb"]`은 `dot-orb` 슬롯에도 걸려 inline-grid로 바꾼다. 대화 줄 칸 안에서는 블록으로 되돌리고,
  // 되돌리는 선택자가 안전망보다 구체적이어야 한다(클래스 셋 > 의사 클래스 하나와 속성 하나)
  const guard = declarationsOf(cssOf("effects/attention.css"), ':root [data-slot$="-orb"]');
  const row = declarationsOf(
    cssOf("convo/convo.css"),
    ".convo-line > .convo-line-icon > .thinking-indicator",
  );
  expect([guard["display"], row["display"]]).toEqual(["inline-grid", "block"]);
  expect(declarationsOf(cssOf("convo/convo.css"), ".convo-line > .convo-line-icon")).toEqual({});
});

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
  // 셸 CSP(`default-src 'self'`)는 인라인 <style>을 막는다. 웹에서만 되고 데스크톱에서 스타일이 사라진다. CSS 파일로 두고
  // src/styles.css에서 가져온다.
  const found = sourceFiles([".tsx"])
    .filter((file) => /<style[\s>]/.test(read(file)))
    .map(relative);
  expect(found).toEqual([]);
});

/** 폼 조작부 caustic 부품 이름 */
const FORM_CONTROLS =
  /<(Button|IconButton|Input|Select|NumberField|TagInput|LocalizedTagInput|SegmentedControl|Switch|Textarea|PickerTrigger)\b/g;

/** 여는 태그 끝(중괄호 밖의 첫 `>`)까지의 글. 속성 안의 JSX(`suffix={<span …>}`)는 건너뛴다 */
function openTagFrom(source: string, start: number): string {
  let depth = 0;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return source.slice(start, index + 1);
  }
  return source.slice(start);
}

/** 여는 태그의 className·containerClassName 글. 속성 안 JSX(`suffix={<span className=…>}`)의 것은 빼고 본다 */
function classAttrsOf(tag: string): string[] {
  const top = tag.replace(/=\{\s*<[\s\S]*?>\s*\}/g, "={}");
  return [
    ...top.matchAll(
      /\b(?:className|containerClassName)=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g,
    ),
  ].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

/** 조작부 높이·패딩·글자 크기를 덮는 클래스와 세 단계 밖의 고정 폭(DP-76, DP-77) */
const SIZE_OVERRIDE =
  /^!?(h|min-h|max-h|p|px|py|pl|pr|ps|pe|pt|pb|size|leading)-|^!?text-(ui|footnote|caption|body|title)|^!?w-(?!24$|56$|full$)/;

test("settings and connection form controls take size and FIELD_WIDTH, not className overrides", () => {
  // 설정·연결 화면의 조작부 높이는 size prop(FORM_CONTROL_SIZE), 폭은 FIELD_WIDTH 세 단계다(DP-76, DP-77).
  // 코드 글꼴(`text-mono-*`), `min-w-0`, `max-w-full`, 글 정렬은 허용한다.
  const found: string[] = [];
  for (const file of sourceFiles([".tsx"])) {
    const name = relative(file);
    if (!name.startsWith("views/pages/settings/") && !name.startsWith("views/pages/connection/")) {
      continue;
    }
    const source = read(file);
    for (const match of source.matchAll(FORM_CONTROLS)) {
      const tag = openTagFrom(source, match.index);
      const bad = classAttrsOf(tag)
        .flatMap((value) => value.split(/\s+/))
        .filter((token) => SIZE_OVERRIDE.test(token));
      if (bad.length > 0) found.push(`${name} <${match[1] ?? ""}> ${bad.join(" ")}`);
    }
  }
  expect(found).toEqual([]);
});

/** `<Alert`의 범위: 스스로 닫히면 여는 태그(동작 prop 포함)까지, 아니면 짝인 `</Alert>`까지 */
function alertSpansOf(source: string): string[] {
  const spans: string[] = [];
  for (const match of source.matchAll(/<Alert\b/g)) {
    const open = openTagFrom(source, match.index);
    if (open.endsWith("/>")) {
      spans.push(open);
      continue;
    }
    const close = source.indexOf("</Alert>", match.index);
    spans.push(close < 0 ? open : source.slice(match.index, close));
  }
  return spans;
}

test("buttons inside an Alert take the alert tone, not their own", () => {
  // DP-121: 띠(Alert) 안의 Button·IconButton은 tone을 주지 않는다. caustic Alert이 tone scope로 띠의 톤을 물려준다
  // (danger 띠의 동작은 danger 단추). 색을 className으로 덮는 것도 막는다. variant(solid·soft·outline·ghost)는 고를 수 있다.
  const found: string[] = [];
  for (const file of sourceFiles([".tsx"])) {
    const source = read(file);
    for (const span of alertSpansOf(source)) {
      for (const button of span.matchAll(/<(Button|IconButton)\b/g)) {
        const tag = openTagFrom(span, button.index);
        const colored = classAttrsOf(tag).some((value) =>
          /(^|\s)!?(bg|text|border)-(neutral|accent|info|success|warning|danger|agent)-/.test(
            value,
          ),
        );
        if (/\btone=/.test(tag) || colored) {
          found.push(`${relative(file)}: ${tag.replace(/\s+/g, " ").slice(0, 90)}`);
        }
      }
    }
  }
  expect(found).toEqual([]);
});

test("alertSpansOf covers the action prop and the children", () => {
  const sample = `<Alert tone="danger" action={<Button tone="neutral">a</Button>}>x <Button>b</Button></Alert><Button tone="danger">c</Button><Alert action={<IconButton label="i" />} />`;
  const spans = alertSpansOf(sample);
  expect(
    spans.map((span) => [...span.matchAll(/<(Button|IconButton)\b[^>]*/g)].map((m) => m[0])),
  ).toEqual([['<Button tone="neutral"', "<Button"], ['<IconButton label="i" /']]);
});

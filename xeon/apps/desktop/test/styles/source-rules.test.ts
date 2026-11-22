import { expect, test } from "bun:test";
import { join } from "node:path";
import { allLiterals, read, relative, sourceFiles, SRC } from "./source-scan.ts";

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

/** 주석을 지운 소스(주석 안의 설명은 걸리지 않게) */
function codeOf(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

test("no caustic spectrum ring (orb) in the app (DP-188)", () => {
  // 사용자 결정(2026-11-13, 영구): 파랑 → 보라 그라데이션 고리(caustic `orb` 유틸리티: conic 스펙트럼 + 가운데 구멍 + 회전)는 어디에도 쓰지 않는다.
  // 그 고리로 가는 길을 막는다. 주의는 요청 그림(RequestArt, 선 그림), 진행은 ProgressOrb(views/effects, 점 구슬)를 쓴다.
  const ANYWHERE: readonly (readonly [string, RegExp])[] = [
    ["orb class", /["'`\s]orb(-sm|-lg|-dot)?["'`\s]/],
    ["CardOrb", /\bCardOrb\b/],
    ["AgentRequest proposal/review", /<AgentRequest\b(?![^>]*\bkind="(permission|question)")/],
    ["agent tone or variant", /\b(tone|variant)=["']agent["']/],
    ["EmptyState orb", /\bmark=["']orb["']|\bpreset=["']agent["']/],
  ];
  // 진행 상태는 그 부품을 쓰는 파일에서만 본다(다른 곳의 status: "running"은 제 모델의 값이다)
  const LIST_STATUS = /\bstatus(=|:\s*)["'](running|working)["']/;
  const found = sourceFiles([".tsx"]).flatMap((file) => {
    const code = codeOf(file);
    const hits = ANYWHERE.filter(([, re]) => re.test(code)).map(([name]) => name);
    if (/<(ListNavigationItem|ListItem)\b/.test(code) && LIST_STATUS.test(code))
      hits.push("list running status");
    return hits.map((name) => `${relative(file)}: ${name}`);
  });
  expect(found).toEqual([]);
});

test("status marks are dotted orbs, never stars or solid dots (DP-189)", () => {
  // 사용자 결정(2026-11-13 밤, 영구): 네 꼭지 별·반짝임, 단색 점(LiveDot), 불씨 원, 느낌표 글리프를 표시로 쓰지 않는다.
  // 진행 표시는 생각 구슬과 같은 점 구슬(dot-orb.tsx: ProgressOrb)이고, 확인 필요 표시는 크리스탈(CrystalMark, DP-223)이다.
  const TSX: readonly (readonly [string, RegExp])[] = [
    ["LiveDot", /\bLiveDot\b|live-dot\.tsx/],
    ["solid dot class", /["'`\s]fx-dot(-core)?["'`\s]/],
    ["star glint", /\bGLINT|fx-attend-(glint|halo)\b/],
    ["dot badge", /<Badge\b[^>]*\sdot[\s=/>]/],
  ];
  const CSS: readonly (readonly [string, RegExp])[] = [
    ["solid dot rule", /\.fx-dot(-core)?\b(?!-orb)|fx-dot-breathe/],
    ["star glint rule", /\.fx-attend-(glint|halo)\b|fx-attend-twinkle/],
  ];
  const found = [
    ...sourceFiles([".tsx", ".ts"]).flatMap((file) => {
      const code = codeOf(file);
      return TSX.filter(([, re]) => re.test(code)).map(([name]) => `${relative(file)}: ${name}`);
    }),
    ...sourceFiles([".css"]).flatMap((file) => {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
      return CSS.filter(([, re]) => re.test(code)).map(([name]) => `${relative(file)}: ${name}`);
    }),
  ];
  expect(found).toEqual([]);
  // 진행 표시는 점 구슬을 그린다(벡터 모양으로 돌아가지 않는다)
  const progress = codeOf(join(SRC, "views/effects/progress-orb.tsx"));
  expect([/<DotOrb\b/.test(progress), /<(svg|path|circle)\b/.test(progress)]).toEqual([
    true,
    false,
  ]);
  // 요청 그림은 페이지 그림과 같은 선 그림이다(DP-210): 선(path)만 있고 점 구슬·원 점(circle)이 없다
  const request = codeOf(join(SRC, "views/illustrations/request-art.tsx"));
  expect([/<path\b/.test(request), /<DotOrb\b/.test(request), /<circle\b/.test(request)]).toEqual([
    true,
    false,
    false,
  ]);
  // 확인 필요 표시는 크리스탈(DP-223): 미리 렌더링해 구운 유리 판(crystal-*.png)을 canvas에 겹쳐 그린다. 점 구슬·원·벡터 선 그림이 아니다(lcMk3).
  // 쓰는 곳은 요청 카드와 제안 내비 줄뿐이고, 대화 줄에는 표시 없이 둥근 면의 수만 둔다(DP-189 [결정: 2026-11-18 사용자 "일반 대화 row 우측에는 아이콘 없어야 할듯함"])
  const crystal = codeOf(join(SRC, "views/effects/crystal-mark.tsx"));
  expect([
    /<canvas\b/.test(crystal),
    /\bdrawImage\(/.test(crystal),
    /crystal-(dark|light)\.png/.test(crystal),
    /<DotOrb\b|\barc\(|\blineTo\(/.test(crystal),
    /<(svg|path|circle)\b/.test(crystal),
  ]).toEqual([true, true, true, false, false]);
  const users = [
    "views/pages/shared/request-card.tsx",
    "views/thread-list.tsx",
    "views/desktop-registry.tsx",
  ].filter((file) => /<CrystalMark\b/.test(codeOf(join(SRC, file))));
  expect(users).toEqual(["views/pages/shared/request-card.tsx", "views/desktop-registry.tsx"]);
  // 호박 주의 구슬(AttentionMark)은 없앴다(DP-211). 수 옆에 색 표시를 다시 붙이지 않는다
  const marks = sourceFiles([".tsx", ".ts"]).filter((file) =>
    /\bAttentionMark\b/.test(codeOf(file)),
  );
  expect(marks.map(relative)).toEqual([]);
});

/** CSS 글의 oklch(L C H) 색상각들 */
const hues = (text: string): number[] =>
  [...text.matchAll(/oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s*\)/g)].map((m) => Number(m[1]));

test("attention counts are caustic badges without a gradient, urgent is an inverted colourless badge, attention rows join into one near-neutral squircle wash, and each card kind has its own aurora around its tile hue (DP-189, DP-190)", () => {
  // 사용자 결정(2026-11-18, lcMk2): "숫자 무채색 바꿔. 호박색 쓰지말고". lcMk3: "숫자의 백그라운드에 동그란 surface". 줄 물듦은 수 면과 겹쳐 과해 뺐다(lcMk3).
  // lcMk4(2026-11-19): "일반적인 경우는 배경색에 그라데이션이 아닌 caustic 랭귀지에 맞춰서", "더 채도높은 색을 쓰던지 마이크로 모션",
  // "변경검토나 단순 질문이나, 가드 각각 다른 색이 중심인데, 각 중심색에 맞게 오로라의 색조합들도 각각 다르게"
  // lcMk5(2026-11-19): "3색없는 버전으로 4.나 가 좋은데, 얘는 border radius를 없애던가 해서, 연속적인 두 row가 확인이 필요할 때 … 이어지게"
  const css = read(join(SRC, "views/effects/attention.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
  };
  const count = rule(".fx-attend-count");
  const pill = rule(".fx-attend-pill");
  const urgent = rule(".fx-attend-pill[data-urgent]");
  const cue = css.slice(
    css.indexOf("@keyframes fx-attend-urgent"),
    css.indexOf("@media", css.indexOf("@keyframes fx-attend-urgent")),
  );
  const wash = rule('[data-slot="list-navigation-item"]:has(> [data-attention])::before');
  // 물듦 잉크의 다크·라이트 [채도, 불투명도]
  const washInk = [
    ...(css.match(/--fx-row-wash:\s*light-dark\(([^;]*)\);/)?.[1] ?? "").matchAll(
      /oklch\(\s*[\d.]+\s+([\d.]+)\s+[\d.]+\s*\/\s*([\d.]+)\s*\)/g,
    ),
  ].map((m) => [Number(m[1]), Number(m[2])] as const);
  const list = codeOf(join(SRC, "views/thread-list.tsx"));
  const kinds = ["review", "question", "tool"].map((kind) =>
    rule(`.fx-attend-glow[data-kind="${kind}"]`),
  );
  // 종류마다 중심색(a)과 이웃 색(b·c)이 있고, 따뜻한 색상각(40~100)은 호박 칸인 도구에만 있다. 위험(33) 근처(21~45)는 어디에도 없다
  const centre = (block: string): number[] => hues(block.slice(0, block.indexOf("--fx-attend-b")));
  expect([
    /color:\s*var\(--cs-color-text-secondary\)/.test(count),
    /oklch|--fx-attend-a|--fx-attend-b/.test(count),
    /\.fx-attend-row\b/.test(css) || /fx-attend-row/.test(list),
    /gradient|background/.test(pill),
    /min-width:\s*var\(--cs-control-compact-2xs\)/.test(pill),
    kinds.map((block) => ["a", "b", "c"].every((k) => block.includes(`--fx-attend-${k}:`))),
    kinds.map((block) => centre(block).every((h) => h >= 40 && h <= 100)),
    kinds.map(centre),
    hues(css).filter((h) => h > 21 && h < 45),
    // 급함: 무채색 안에서 뒤집힌 면(글자색 면, 바탕색 숫자)이고 빛깔(info·oklch)이 없다. 한 번의 움직임은 크기만이다
    /<Badge\b[^>]*className="fx-attend-pill"[^>]*data-urgent=\{props\.urgent \? "" : undefined\}/.test(
      list,
    ),
    [
      /background-color:\s*var\(--cs-color-text-primary\)/.test(urgent),
      /color:\s*var\(--cs-color-bg-app\)/.test(urgent),
      /info|oklch|hsl|rgb/.test(urgent + list.slice(list.indexOf("function ApprovalCount"))),
      /filter|color|opacity/.test(cue),
    ],
    // 확인이 필요한 줄은 물들고(data-attention), 연달아 있으면 아래로 틈을 덮고 맞닿은 모서리를 편다.
    // 물듦은 거의 무채색 잉크(--fx-row-wash)이고 줄 단추와 같은 반경(lg)·squircle이다(lcMk7: "거의 뉴트럴", "radius가 좀 높은거같아. squircle 적용도")
    [
      /data-attention=\{attention \? "" : undefined\}/.test(list),
      /var\(--fx-row-wash\)/.test(wash),
      /--fx-crystal/.test(wash),
      /border-radius:\s*var\(--cs-radius-lg\);\s*corner-shape:\s*squircle;/.test(wash),
      washInk.map(([chroma, alpha]) => chroma <= 0.08 && alpha <= 0.05),
      /bottom:\s*calc\(var\(--cs-space-0_5\) \* -1\);\s*border-end-start-radius:\s*0;\s*border-end-end-radius:\s*0/.test(
        css,
      ),
      /\+ \[data-row-menu\]\s*\+ \[data-slot="list-navigation-item"\]:has\(> \[data-attention\]\)::before \{\s*border-start-start-radius:\s*0;\s*border-start-end-radius:\s*0/.test(
        css,
      ),
    ],
    css.match(/\.fx-attend-count\b/g)?.length,
  ]).toEqual([
    true,
    false,
    false,
    false,
    true,
    [true, true, true],
    [false, false, true],
    [
      [290, 290],
      [240, 238],
      [80, 86],
    ],
    [],
    true,
    [true, true, false, false],
    [true, true, false, true, [true, true], true, true],
    1,
  ]);
});

test("the card's top-edge light never reaches the bottom edge of a low card, and tall cards keep the 72px reach (DP-190)", () => {
  // lcMk7: 받은 요청 맨 위의 낮은 카드(52px)는 세로 72px 빛이 아래 변에 옅은 빛깔 선을 그었다. 빛의 칸을 min(72px, 카드 높이의 70%)로 둔다.
  // 타원 크기에 길이와 백분율을 섞은 min()을 바로 쓰면 Chromium이 마스크 전체를 버리므로 칸 크기(mask-size)로 준다
  const css = read(join(SRC, "views/effects/attention.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  const at = css.indexOf(".fx-attend-edge {");
  const edge = css.slice(at, css.indexOf("}", at));
  expect([
    edge.match(
      /radial-gradient\(48% 100% at 50% 0, #000 0, #000 24%, transparent 100%\) 0 0 \/ 100% min\(72px, 70%\)\s+no-repeat,/g,
    )?.length,
    /radial-gradient\([^)]*min\(/.test(edge),
    /48% 72px/.test(edge),
  ]).toEqual([2, false, false]);
});

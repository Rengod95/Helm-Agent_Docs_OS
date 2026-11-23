import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// DP-180 대화 열은 가로로 넘치지 않는다. 화면 폭 측정은 jsdom으로 할 수 없어(배치가 없다) 넘침을 막는 규칙이 convo.css에 그대로
// 있는지를 값으로 본다. 실제 폭 측정은 대화 줄 전시 화면 `?set=long`(test/showcase/transcript)을 브라우저로 열어 한다.

const CSS = readFileSync(
  join(import.meta.dir, "..", "..", "src", "views", "convo", "convo.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** 선택자 목록에 `selector`가 든 규칙들의 선언을 모아 속성 → 값으로 돌려준다(뒤의 규칙이 이긴다) */
function declarationsOf(selector: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const match of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
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

test("one-column grids inside a transcript row clamp their column to the row width", () => {
  for (const selector of [
    '.convo-row [data-slot="message"][data-author="agent"]',
    ".convo-card",
    ".convo-detail",
    ".convo-group-body",
  ]) {
    const d = declarationsOf(selector);
    expect({ selector, columns: d["grid-template-columns"], minWidth: d["min-width"] }).toEqual({
      selector,
      columns: "minmax(0, 1fr)",
      minWidth: "0",
    });
  }
});

test("prose breaks long unspaced runs anywhere, while code blocks keep one line and scroll", () => {
  expect(declarationsOf(".convo-prose")["overflow-wrap"]).toBe("anywhere");
  expect(declarationsOf(".convo-thinking-body")["overflow-wrap"]).toBe("anywhere");
  expect(declarationsOf(".convo-code-body")).toMatchObject({
    "white-space": "pre",
    overflow: "auto",
    "overflow-wrap": "normal",
  });
  expect(declarationsOf(".convo-table")["overflow-x"]).toBe("auto");
  expect(declarationsOf(".convo-output")).toMatchObject({
    overflow: "auto",
    "overflow-wrap": "anywhere",
  });
});

test("diff boxes, attachment chips and group meta shrink to the column", () => {
  expect(declarationsOf(".convo-diff")).toMatchObject({ "min-width": "0", "max-width": "100%" });
  expect(declarationsOf('.convo-attachments [data-slot="chip"]')).toMatchObject({
    "min-width": "0",
    "max-width": "100%",
  });
  expect(declarationsOf('[data-slot="convo-group-meta"]')).toMatchObject({
    "min-width": "0",
    "text-overflow": "ellipsis",
  });
});

// chatQa(2026-11-23): 입력창 위 알림 카드(같은 폴더, 승인 전 플러그인)의 동작 칸이 `shrink-0`이라 접히지 않았다. 900폭에서 대화 넷이
// 같은 폴더에서 돌면 단추 줄이 최대 내용 폭으로 서서 글 칸이 글자 하나 폭이 되고(제목이 세로로 한 글자씩) 카드가 대화 열 밖으로 47px 넘쳤다.
// 동작 칸은 줄어들며 안에서 접히고, 글과 동작을 담은 칸이 줄을 바꿀 수 있어야 한다. 글 칸은 basis 60보다 좁아지지 않는다.
const NOTICES = readFileSync(
  join(import.meta.dir, "..", "..", "src", "views", "project", "project-notices.tsx"),
  "utf8",
);

/** `data-slot="<slot>"`을 단 요소의 className 토큰 */
function classesOfSlot(source: string, slot: string): readonly string[] {
  const found = new RegExp(
    `className="([^"]*)"\\s*data-slot="${slot}"|data-slot="${slot}"[^>]*?className="([^"]*)"`,
  ).exec(source);
  return (found?.[1] ?? found?.[2] ?? "")
    .split(/\s+/)
    .filter((c) => c !== "")
    .toSorted();
}

test("notice cards above the composer wrap their actions instead of pushing the column wide", () => {
  expect(classesOfSlot(NOTICES, "notice-main")).toEqual(
    ["flex", "flex-1", "flex-wrap", "gap-3", "items-center", "min-w-0"].toSorted(),
  );
  expect(classesOfSlot(NOTICES, "notice-actions")).toEqual(
    [
      "flex",
      "flex-wrap",
      "gap-2",
      "items-center",
      "justify-end",
      "max-w-full",
      "min-w-0",
    ].toSorted(),
  );
  expect(NOTICES.includes("grid min-w-0 flex-1 basis-60 gap-1")).toBe(true);
});

// chatQa(2026-11-23): 무대가 840px보다 좁으면(DP-135) 대화 기록만 오른쪽 막대 자리를 비우고 입력창 묶음(승인 카드, 알림, 입력창)은
// 비우지 않아, 900폭에서 질문 카드의 "다음" 단추와 글이 막대 밑에 가려졌다(겹친 요소 11개). 두 칸이 같은 표지로 같은 여백을 받는다.
test("in a narrow stage both the transcript and the composer stack keep clear of the floating rail", () => {
  const styles = readFileSync(
    join(import.meta.dir, "..", "..", "src", "styles.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const narrow =
    /@container stage \(max-width: 840px\) \{([\s\S]*?)\n {2}\}/.exec(styles)?.[1] ?? "";
  const rule = /([^{}]+)\{([^{}]*)\}/.exec(narrow);
  expect({
    selectors: (rule?.[1] ?? "").replace(/\s+/g, " ").trim(),
    body: (rule?.[2] ?? "").trim(),
  }).toEqual({
    selectors:
      ":is(.shell-header[data-flush], :has(> .shell-header[data-flush])) + *, [data-chat-rail-gap]",
    body: "padding-inline-end: calc(var(--stage-rail, 0px) + var(--cs-space-3));",
  });
  const registry = readFileSync(
    join(import.meta.dir, "..", "..", "src", "views", "desktop-registry.tsx"),
    "utf8",
  );
  expect(registry.match(/<div[^>]*data-chat-rail-gap=""[^>]*>/g)).toEqual([
    '<div data-chat-rail-gap="" className="flex min-h-32 flex-1 flex-col">',
    '<div data-toast-avoid data-chat-rail-gap="" className="flex min-h-0 flex-col">',
  ]);
});

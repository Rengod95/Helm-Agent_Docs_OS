import { expect, test } from "bun:test";
import { defineTerms, type TermDecl } from "../packages/client/src/i18n/terms.ts";
import {
  blankComments,
  checkCatalogStyle,
  checkDocs,
  checkScreenSource,
  exposureOf,
  isUiEnglish,
  mentions,
  proseOfDoc,
  specTermCells,
  type DocText,
} from "./terms-rules.ts";

function term(overrides: Partial<TermDecl> = {}): TermDecl {
  return {
    kind: "concept",
    doc: { ko: "A", en: "A" },
    ui: { ko: "가", en: "a" },
    surfaces: ["chat"],
    sources: ["adr.0022"],
    status: "decided",
    ...overrides,
  };
}

const TERMS = defineTerms({
  thread: term({
    doc: { ko: "Thread", en: "Thread" },
    ui: { ko: "대화", en: "Conversation" },
    ids: ["ThreadId"],
    forbid: { ui: ["세션"], docs: ["세션"] },
  }),
  driver: term({
    doc: { ko: "Driver / drive lock", en: "Driver" },
    ui: { ko: "주도", en: "Lead" },
    forbid: { ui: ["임대"], docs: ["임대"] },
  }),
  schedule: term({
    doc: { ko: "Schedule", en: "Schedule" },
    ui: { ko: "예약", en: "Schedule" },
    forbid: { docsIn: [{ word: "루프", under: ["L2/schedule/"] }] },
  }),
  secret: term({
    doc: { ko: "Secret", en: "Secret" },
    ui: { ko: "시크릿", en: "Secret" },
    forbid: { ui: ["비밀"] },
  }),
});

function doc(path: string, body: string): DocText {
  return { path, id: undefined, body, bodyOffset: 0 };
}

function summary(violations: readonly { rule: string; where: string }[]): string[] {
  return violations.map((v) => `${v.rule} ${v.where}`);
}

test("exposureOf maps key namespaces and leaves cli and generated keys out", () => {
  expect(exposureOf("cli.chat.x")).toBe("skip");
  expect(exposureOf("term.thread")).toBe("skip");
  expect(exposureOf("client.settings.key.empty")).toBe("settings");
  expect(exposureOf("settings.l4.ui.locale.label")).toBe("settings");
  expect(exposureOf("desktop.compose.x")).toBe("workbench");
  expect(exposureOf("desktop.composer.disabled.engineOff")).toBe("chat");
  expect(exposureOf("client.web.note.ok")).toBe("chat");
});

test("mentions matches Hangul as substring and Latin as a whole word, ignoring case", () => {
  expect(mentions("이 세션은 끝났어요", "세션")).toBe(true);
  expect(mentions("Scope is wide", "scope")).toBe(true);
  expect(mentions("the scoped value", "scope")).toBe(false);
  expect(mentions("as well as", "well")).toBe(true);
  expect(mentions("farewell", "well")).toBe(false);
});

test("C-04 flags internal words and forbidden aliases in chat strings, C-05 aliases elsewhere", () => {
  const ko = {
    "desktop.chat.a": "루프가 돌고 있어요",
    "desktop.chat.b": "세션을 열었어요",
    "client.settings.tabs.c": "세션과 컨텍스트",
    "client.settings.tabs.d": "비밀번호를 바꿔요",
    "client.settings.tabs.e": "비밀을 바꿔요",
    "desktop.chat.f": "`session` 값이에요",
    "cli.chat.g": "세션을 열었다",
  };
  const en = {
    "desktop.chat.a": "The loop runs",
    "desktop.chat.b": "Opened a scope",
    "client.settings.tabs.c": "Sessions",
    "client.settings.tabs.d": "Change the password",
    "client.settings.tabs.e": "Change the secret",
    "desktop.chat.f": "The `scope` value",
    "cli.chat.g": "Opened a session",
  };
  const found = checkCatalogStyle(ko, en, TERMS).filter((v) => v.rule !== "C-08");
  expect(summary(found)).toEqual([
    "C-05 locales/ko.json client.settings.tabs.c",
    "C-05 locales/ko.json client.settings.tabs.e",
    "C-04 locales/ko.json desktop.chat.a",
    "C-04 locales/ko.json desktop.chat.b",
    "C-04 locales/en.json desktop.chat.b",
  ]);
});

test("C-04 and C-05 tell the user which label to write", () => {
  const found = checkCatalogStyle({ "desktop.chat.b": "세션을 열었어요" }, {}, TERMS);
  expect(found[0]?.fix).toBe('use the label "대화" (terms.json thread)');
});

test("C-08 wants noun phrases for labels and 해요체 for sentences", () => {
  const ko = {
    "x.title": "대화를 엽니다",
    "x.label": "대화 목록",
    "x.body": "대화를 열었어요.",
    "x.hint": "대화를 연다.",
    "x.desc": "대화를 엽니다",
    "x.toast": "연결을 맞추는 중이에요 {count}",
    "x.error": "열지 못했어요 (코드 {code})",
  };
  const found = checkCatalogStyle(ko, {}, TERMS).filter((v) => v.rule === "C-08");
  expect(summary(found)).toEqual([
    "C-08 locales/ko.json x.desc",
    "C-08 locales/ko.json x.hint",
    "C-08 locales/ko.json x.title",
  ]);
});

test("S-02 flags English words in JSX text and screen attributes, not ids, units or code", () => {
  const source = [
    'import { useState } from "react";',
    "export function View() {",
    "  const [open, setOpen] = useState<boolean | null>(null);",
    "  return (",
    "    <div>",
    '      <span title="Open the file">x</span>',
    '      <input placeholder="a.b.c" aria-label={"kebab-case"} />',
    "      <span>provider</span>",
    "      <span>120 ms</span>",
    "      <code>fresnel doctor</code>",
    "      {/* Comment about the view */}",
    "    </div>",
    "  );",
    "}",
  ].join("\n");
  const found = checkScreenSource(
    [{ path: "apps/desktop/src/views/view.tsx", text: source }],
    TERMS,
  );
  expect(summary(found)).toEqual([
    "S-02 apps/desktop/src/views/view.tsx:6",
    "S-02 apps/desktop/src/views/view.tsx:8",
  ]);
});

test("isUiEnglish skips machine names, units and Korean", () => {
  expect(isUiEnglish("Open file")).toBe(true);
  expect(isUiEnglish("provider")).toBe(true);
  expect(isUiEnglish("a.b.c")).toBe(false);
  expect(isUiEnglish("kebab-case")).toBe(false);
  expect(isUiEnglish("camelCase")).toBe(false);
  expect(isUiEnglish("120 ms")).toBe(false);
  expect(isUiEnglish("모델 key")).toBe(false);
  expect(isUiEnglish("ok")).toBe(false);
});

test("S-03 flags a source string equal to a term label, only in screen sources", () => {
  const text = 'const a = "대화";\nconst b = "Conversation";\n// "대화"\nconst c = "대화방";\n';
  const found = checkScreenSource(
    [
      { path: "apps/desktop/src/views/a.ts", text },
      { path: "apps/desktop/test/views/a.test.ts", text },
      { path: "packages/client/src/i18n/terms.ts", text },
    ],
    TERMS,
  );
  expect(summary(found)).toEqual([
    "S-03 apps/desktop/src/views/a.ts:1",
    "S-03 apps/desktop/src/views/a.ts:2",
  ]);
});

test("blankComments keeps line numbers and string contents", () => {
  const text = 'a // x\n/* y\nz */ "http://q" // w\n';
  expect(blankComments(text)).toBe('a     \n    \n     "http://q"     \n');
});

test("specTermCells reads only the table directly under the §2 heading", () => {
  const body = [
    "## 1. 범위",
    "| 용어 | 뜻 |",
    "|---|---|",
    "| 밖 | x |",
    "## 2. 용어",
    "",
    "| 용어 | 뜻 |",
    "|---|---|",
    "| thread | 대화 |",
    "| `ThreadId` | id |",
    "",
    "### 2.1 하위",
    "| 하위 | y |",
    "## 3. 인터페이스",
  ].join("\n");
  expect(specTermCells(body)).toEqual([
    { cell: "thread", line: 9 },
    { cell: "`ThreadId`", line: 10 },
  ]);
});

test("D-01 matches §2 first cells against names, ids and the doc-only list", () => {
  const body = [
    "## 2. 용어",
    "| 용어 | 뜻 |",
    "|---|---|",
    "| Thread | a |",
    "| `ThreadId` | b |",
    "| 대화 | c |",
    "| 투영 | d |",
    "| 층 | e |",
    "| 쓰기 소유자 (owner) | f |",
  ].join("\n");
  const found = checkDocs([doc("F/x/spec.md", body)], TERMS, ["투영", "쓰기 소유자"]);
  expect(summary(found)).toEqual(["D-01 docs/xeon/F/x/spec.md:8"]);
});

test("proseOfDoc blanks code blocks, quotes, inline code and quoted words", () => {
  const body = ["본문 세션", "```", "세션", "```", "> 세션", '`세션` "세션" “세션” 끝'].join("\n");
  expect(proseOfDoc(body).map((line) => line.trim())).toEqual(["본문 세션", "", "", "", "", "끝"]);
});

test("D-02 flags forbidden aliases in prose, honours docsIn folders and skips record docs", () => {
  const body = "drive 임대를 준다.\n루프가 돈다.\n`임대` 는 코드다.\n";
  const found = checkDocs(
    [
      doc("L1/loop/spec.md", body),
      doc("L2/schedule/spec.md", body),
      doc("decisions/ADR-1.md", body),
      doc("review/x.md", body),
      doc("_research/x.md", body),
    ],
    TERMS,
    [],
  );
  expect(summary(found)).toEqual([
    "D-02 docs/xeon/L1/loop/spec.md:1",
    "D-02 docs/xeon/L2/schedule/spec.md:1",
    "D-02 docs/xeon/L2/schedule/spec.md:2",
  ]);
});

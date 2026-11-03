import { expect, test } from "bun:test";
import { defineTerms, type TermDecl } from "../packages/client/src/i18n/terms.ts";
import { checkLengthBudget, checkUiQuotes, checkUnusedKeys, keyUsesOf } from "./terms-stage3.ts";

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
  driver: term({
    doc: { ko: "Driver", en: "Driver" },
    ui: { ko: "주도", en: "Drive" },
    forbid: { ui: ["임대"] },
  }),
});

test("C-09 reports keys no source uses and honors exact, template and concatenated key prefixes", () => {
  const sources = [
    {
      path: "apps/desktop/src/a.tsx",
      text: 't("desktop.used.exact"); t(`desktop.dyn.${kind}.label`); tKey("desktop.cat." + id, "x");',
    },
  ];
  const en = {
    "desktop.used.exact": "a",
    "desktop.dyn.one.label": "b",
    "desktop.cat.two": "c",
    "desktop.unused.key": "d",
    "cli.unused": "e",
    "term.unused": "f",
    "settings.l2.x.label": "g",
    "host.error.x": "h",
  };
  expect(checkUnusedKeys(en, sources)).toEqual([
    {
      rule: "C-09",
      where: "locales/en.json desktop.unused.key",
      message:
        "the key is not used by any t(), tKey(), <Msg id> or dynamic key prefix in the sources",
      fix: "delete the key from both catalogs, or use it",
      level: "warn",
    },
  ]);
  expect(keyUsesOf(sources).prefixes.toSorted()).toEqual(["desktop.cat.", "desktop.dyn."]);
});

test("C-10 flags labels over the ko and en budgets or an en that is over 2.5x the ko, and skips settings and cli keys", () => {
  const ko = {
    "desktop.a.button": "저장",
    "desktop.b.label": "열두글자를넘는아주긴라벨이다",
    "desktop.c.tab": "대화",
    "desktop.d.button": "삭제하기",
    "settings.l2.x.label": "아주긴설정라벨이라서열두글자를넘는다",
    "cli.x.label": "아주긴아주긴아주긴아주긴아주긴",
    "desktop.e.body": "본문은 길이를 보지 않는다 본문은 길이를 보지 않는다",
  };
  const en = {
    "desktop.a.button": "Save",
    "desktop.b.label": "A label that is far too long for the screen",
    "desktop.c.tab": "Conversation list tab",
    "desktop.d.button": "Delete",
    "settings.l2.x.label": "A very long setting label that exceeds the budget",
    "cli.x.label": "A very long cli label that exceeds the budget",
    "desktop.e.body": "Body text is not measured here, however long it gets.",
  };
  expect(checkLengthBudget(ko, en).map((v) => [v.where, v.message, v.level])).toEqual([
    [
      "locales/en.json desktop.b.label",
      "ko has 14 characters (budget 12); en has 43 characters (budget 24); en is 3.1x the ko length (limit 2.5x)",
      "warn",
    ],
    ["locales/en.json desktop.c.tab", "en is 10.5x the ko length (limit 2.5x)", "warn"],
  ]);
});

test("C-10 counts an ICU argument as one character", () => {
  expect(
    checkLengthBudget({ "desktop.x.label": "{name} 보기" }, { "desktop.x.label": "View {name}" }),
  ).toEqual([]);
});

test("D-04 warns on a forbidden alias inside a quoted screen text of the desktop-ux spec only", () => {
  const body = [
    '화면 문구는 "임대 받음"이다.',
    "```",
    '"임대 코드"',
    "```",
    "“주도 중”은 괜찮다.",
  ].join("\n");
  const docs = [
    { path: "L4/desktop-ux/spec.md", body, bodyOffset: 10 },
    { path: "L4/other/spec.md", body: '"임대"', bodyOffset: 0 },
  ];
  expect(checkUiQuotes(docs, TERMS)).toEqual([
    {
      rule: "D-04",
      where: "docs/xeon/L4/desktop-ux/spec.md:11",
      message: 'the quoted screen text "임대 받음" uses the forbidden alias "임대" of driver',
      fix: 'write "주도" (terms.json driver)',
      level: "warn",
    },
  ]);
});

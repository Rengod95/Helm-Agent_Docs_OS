import { expect, test } from "bun:test";
import { defineTerms, type TermDecl } from "../packages/client/src/i18n/terms.ts";
import {
  applyOverlay,
  checkOverlay,
  expandMarkers,
  expandOverlay,
  hasFinalConsonant,
  pickJosa,
} from "./terms-markers.ts";

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
  thread: term({ ui: { ko: "대화", en: "Conversation" } }),
  driver: term({ ui: { ko: "주도", en: "Lead" } }),
  turn: term({ ui: { ko: "턴", en: "Turn" } }),
  plugin: term({ ui: { ko: "플러그인", en: "Plugin" } }),
  trace: term({ ui: { ko: "트레이스", en: "Trace" } }),
  helm: term({ ui: { ko: "Helm", en: "Helm" } }),
  hidden: term({ doc: { ko: "프로세스 락", en: "Process lock" }, ui: null, surfaces: ["none"] }),
  path: term({ ui: { ko: "경로", en: "Path" } }),
  moon: term({ ui: { ko: "달", en: "Moon" } }),
});

function ok(source: string, locale: "ko" | "en" = "ko"): string {
  const result = expandMarkers(source, TERMS, locale);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.text;
}

test("hasFinalConsonant reads the last Hangul syllable and says nothing for other text", () => {
  expect(hasFinalConsonant("대화")).toBe(false);
  expect(hasFinalConsonant("턴")).toBe(true);
  expect(hasFinalConsonant("플러그인 ")).toBe(true);
  expect(hasFinalConsonant("Helm")).toBeUndefined();
  expect(hasFinalConsonant("{name}")).toBeUndefined();
});

test("pickJosa chooses the form by final consonant, treats ㄹ as none for 으로/로, and falls back to parentheses", () => {
  expect(pickJosa("을/를", "대화")).toBe("를");
  expect(pickJosa("을/를", "턴")).toBe("을");
  expect(pickJosa("이/가", "대화")).toBe("가");
  expect(pickJosa("이/가", "턴")).toBe("이");
  expect(pickJosa("은/는", "턴")).toBe("은");
  expect(pickJosa("과/와", "대화")).toBe("와");
  expect(pickJosa("과/와", "플러그인")).toBe("과");
  expect(pickJosa("으로/로", "턴")).toBe("으로");
  expect(pickJosa("으로/로", "달")).toBe("로");
  expect(pickJosa("으로/로", "대화")).toBe("로");
  expect(pickJosa("을/를", "Helm")).toBe("을(를)");
  expect(pickJosa("이/가", "{name}")).toBe("이(가)");
  expect(pickJosa("없는/표식", "대화")).toBeUndefined();
});

test("expandMarkers puts the ui label of a concept in the sentence and fixes the josa after it", () => {
  expect(ok("[[thread]][[을/를]] 열었어요")).toBe("대화를 열었어요");
  expect(ok("[[turn]][[이/가]] 끝났어요")).toBe("턴이 끝났어요");
  expect(ok("[[plugin]][[과/와]] [[thread]][[으로/로]] 묶어요")).toBe("플러그인과 대화로 묶어요");
  expect(ok("[[moon]][[으로/로]] 가요")).toBe("달로 가요");
  expect(ok("[[helm]][[은/는]] 켜졌어요")).toBe("Helm은(는) 켜졌어요");
  expect(ok("{name}[[이/가]] [[thread]]에 들어갔어요")).toBe("{name}이(가) 대화에 들어갔어요");
  expect(ok("[[path]]")).toBe("경로");
});

test("expandMarkers uses the doc name when a concept has no screen label, and the en label in en", () => {
  expect(ok("[[hidden]][[을/를]] 쥐어요")).toBe("프로세스 락을 쥐어요");
  expect(ok("Open the [[thread]] and [[driver]]", "en")).toBe("Open the Conversation and Lead");
  expect(ok("[[thread]]s and context", "en")).toBe("Conversations and context");
});

test("expandMarkers reports unknown concepts, loose josa markers and josa in en", () => {
  const unknown = expandMarkers("[[nothing]] 열기", TERMS, "ko");
  expect(unknown).toEqual({ ok: false, errors: ["unknown concept id [[nothing]]"] });
  const loose = expandMarkers("열기 [[을/를]] 눌러요", TERMS, "ko");
  expect(loose).toEqual({
    ok: false,
    errors: ["josa marker [[을/를]] does not follow a label marker or an ICU argument"],
  });
  const afterText = expandMarkers("[[thread]]를 [[을/를]]", TERMS, "ko");
  expect(afterText.ok).toBe(false);
  const inEn = expandMarkers("[[thread]][[을/를]]", TERMS, "en");
  expect(inEn).toEqual({ ok: false, errors: ["josa marker [[을/를]] in an en sentence"] });
});

test("expandOverlay maps rule ids, and applyOverlay replaces or adds keys", () => {
  const { expanded, violations } = expandOverlay(
    { "a.one": "[[thread]][[이/가]] 있어요", "a.two": "[[nothing]]", "a.three": "x [[을/를]]" },
    TERMS,
    "ko",
  );
  expect(expanded).toEqual({ "a.one": "대화가 있어요" });
  expect(violations.map((v) => `${v.rule} ${v.where}`)).toEqual([
    "C-13 locales/ko.src.json a.three",
    "C-12 locales/ko.src.json a.two",
  ]);
  expect(
    applyOverlay({ "a.one": "옛 문장", "b.two": "그대로" }, { "a.one": "새", "c.three": "더함" }),
  ).toEqual({
    "a.one": "새",
    "b.two": "그대로",
    "c.three": "더함",
  });
});

test("checkOverlay flags a catalog sentence that differs from its source and key sets that differ", () => {
  const overlayKo = { "a.one": "[[thread]][[을/를]] 열어요", "a.only": "[[turn]]" };
  const overlayEn = { "a.one": "Open [[thread]]", "a.enOnly": "[[turn]]" };
  const ko = { "a.one": "대화를 열어요", "a.only": "턴" };
  const en = { "a.one": "Open the conversation", "a.enOnly": "Turn" };
  const found = checkOverlay(overlayKo, overlayEn, ko, en, TERMS).map(
    (v) => `${v.rule} ${v.where}`,
  );
  expect(found).toEqual([
    "C-01 locales/en.src.json a.only",
    "C-01 locales/ko.src.json a.enOnly",
    "C-14 locales/en.json a.one",
  ]);
  const fine = checkOverlay(
    { "a.one": "[[thread]][[을/를]] 열어요" },
    { "a.one": "Open [[thread]]" },
    { "a.one": "대화를 열어요" },
    { "a.one": "Open Conversation" },
    TERMS,
  );
  expect(fine).toEqual([]);
});

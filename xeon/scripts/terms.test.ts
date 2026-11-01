import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  defineTerms,
  loadShippedTerms,
  loadTerms,
  type TermDecl,
} from "../packages/client/src/i18n/terms.ts";
import {
  checkCatalogs,
  checkMockupTerms,
  checkTermSource,
  collectDocIds,
  generateMockupTerms,
  generateTermKeys,
  icuArgs,
  mergeTermKeys,
  readCatalog,
} from "./terms.ts";

const shipped = loadShippedTerms();
if (!shipped.ok) throw new Error("terms.json does not match the term schema");
const TERMS = shipped.value;

const DOC_IDS = new Set(["adr.0022", "F.extensions.spec"]);

function term(overrides: Partial<TermDecl> = {}): TermDecl {
  return {
    kind: "concept",
    doc: { ko: "A", en: "A" },
    ui: { ko: "가", en: "a" },
    surfaces: ["workbench"],
    sources: ["adr.0022"],
    status: "proposed",
    ...overrides,
  };
}

function rules(violations: readonly { rule: string }[]): string[] {
  return violations.map((v) => v.rule);
}

test("the real source passes the source checks and the catalogs match the generated keys", () => {
  const docIds = collectDocIds(join(import.meta.dir, "..", "..", "docs", "xeon"));
  expect(checkTermSource(TERMS, docIds)).toEqual([]);
  const ko = readCatalog("ko") ?? {};
  const en = readCatalog("en") ?? {};
  expect(checkCatalogs(ko, en, TERMS)).toEqual([]);
});

test("T-01 flags a label used by two concepts unless both declare the share", () => {
  const clash = defineTerms({
    one: term({ doc: { ko: "하나", en: "One" }, ui: { ko: "같다", en: "one" } }),
    two: term({ doc: { ko: "둘", en: "Two" }, ui: { ko: "같다", en: "two" } }),
  });
  expect(rules(checkTermSource(clash, DOC_IDS))).toEqual(["T-01"]);
  const shared = defineTerms({
    one: term({
      doc: { ko: "하나", en: "One" },
      ui: { ko: "같다", en: "one" },
      sharesLabelWith: ["two"],
    }),
    two: term({
      doc: { ko: "둘", en: "Two" },
      ui: { ko: "같다", en: "two" },
      sharesLabelWith: ["one"],
    }),
  });
  expect(checkTermSource(shared, DOC_IDS)).toEqual([]);
  const oneSided = defineTerms({
    one: term({
      doc: { ko: "하나", en: "One" },
      ui: { ko: "같다", en: "one" },
      sharesLabelWith: ["two"],
    }),
    two: term({ doc: { ko: "둘", en: "Two" }, ui: { ko: "같다", en: "two" } }),
  });
  expect(rules(checkTermSource(oneSided, DOC_IDS))).toEqual(["T-01"]);
});

test("T-02 flags a forbidden alias that is another concept's name", () => {
  const terms = defineTerms({
    one: term({
      doc: { ko: "하나", en: "One" },
      ui: { ko: "하나", en: "one" },
      forbid: { ui: ["둘"] },
    }),
    two: term({ doc: { ko: "둘", en: "Two" }, ui: { ko: "둘", en: "two" } }),
  });
  expect(rules(checkTermSource(terms, DOC_IDS))).toEqual(["T-02"]);
});

test("T-03 flags sentence endings, Hangul in en and a null ui with surfaces", () => {
  const terms = defineTerms({
    a: term({ doc: { ko: "가", en: "A" }, ui: { ko: "넘겼어요", en: "a" } }),
    b: term({ doc: { ko: "나", en: "B" }, ui: { ko: "나", en: "비" } }),
    c: term({ doc: { ko: "다", en: "C" }, ui: null, surfaces: ["chat"] }),
  });
  expect(rules(checkTermSource(terms, DOC_IDS))).toEqual(["T-03", "T-03", "T-03"]);
});

test("T-04 flags internal words in chat labels only", () => {
  const terms = defineTerms({
    a: term({
      doc: { ko: "가", en: "A" },
      ui: { ko: "사이드카 연결", en: "a" },
      surfaces: ["chat"],
    }),
    b: term({
      doc: { ko: "나", en: "B" },
      ui: { ko: "사이드카 연결 설정", en: "b" },
      surfaces: ["workbench"],
    }),
  });
  expect(checkTermSource(terms, DOC_IDS).map((v) => `${v.rule} ${v.where}`)).toEqual([
    "T-04 terms.ts a",
  ]);
});

test("T-05 flags a source that is not a document id", () => {
  const terms = defineTerms({ a: term({ sources: ["F.extensions.spec §2", "adr.9999"] }) });
  expect(checkTermSource(terms, DOC_IDS).map((v) => v.message)).toEqual([
    "source adr.9999 is not a document id",
  ]);
});

test("icuArgs reads names and kinds and rejects broken braces", () => {
  expect(
    icuArgs("{a} and {b, number, integer} {n, plural, =0{none} one{# item} other{# items {who}}}"),
  ).toEqual({
    ok: true,
    args: new Map([
      ["a", "arg"],
      ["b", "number"],
      ["n", "plural"],
      ["who", "arg"],
    ]),
  });
  expect(icuArgs("it''s '{'literal'}' {x}")).toEqual({ ok: true, args: new Map([["x", "arg"]]) });
  expect(icuArgs("{a").ok).toBe(false);
  expect(icuArgs("a }").ok).toBe(false);
  expect(icuArgs("{n, plural, one{x}").ok).toBe(false);
  expect(icuArgs("{n, weird, a{x}}").ok).toBe(false);
});

test("C-01, C-02 and C-06 report key sets, arguments and Hangul in en", () => {
  const terms = defineTerms({});
  const ko = { "a.b": "{n}개", "a.only": "x", "a.c": "{n}개 {who}" };
  const en = {
    "a.b": "{n, plural, one{# item} other{# items}}",
    "a.extra": "x",
    "a.c": "{n} items",
    "a.h": "한글",
  };
  const found = checkCatalogs(ko, en, terms).map((v) => `${v.rule} ${v.where}`);
  expect(found.toSorted()).toEqual(
    [
      "C-01 locales/ko.json a.extra",
      "C-01 locales/ko.json a.h",
      "C-01 locales/en.json a.only",
      "C-02 a.c",
      "C-06 locales/en.json a.h",
    ].toSorted(),
  );
});

test("C-03 flags a term key that differs, is missing, or has no source", () => {
  const terms = defineTerms({ a: term({ ui: { ko: "가", en: "a" } }) });
  const generated = generateTermKeys(terms);
  expect(generated.ko).toEqual({ "term.a": "가" });
  const ok = checkCatalogs({ "x.y": "1", ...generated.ko }, { "x.y": "1", ...generated.en }, terms);
  expect(ok).toEqual([]);
  const stale = checkCatalogs(
    { "term.a": "나", "term.z": "z" },
    { "term.a": "a", "term.z": "z" },
    terms,
  );
  expect(stale.map((v) => `${v.rule} ${v.where}`)).toEqual([
    "C-03 locales/ko.json term.a",
    "C-03 locales/ko.json term.z",
    "C-03 locales/en.json term.z",
  ]);
});

test("mergeTermKeys keeps other keys in order and replaces the term block", () => {
  expect(
    Object.keys(
      mergeTermKeys(
        { "b.x": "1", "term.old": "o", "a.y": "2" },
        { "term.new": "n", "term.a": "a" },
      ),
    ),
  ).toEqual(["b.x", "a.y", "term.a", "term.new"]);
});

test("M-01 passes without a mockup file and compares an existing one", () => {
  const terms = defineTerms({
    a: term({ ui: { ko: "가", en: "a" } }),
    b: term({ ui: null, surfaces: ["none"] }),
  });
  expect(checkMockupTerms(terms, undefined)).toEqual([]);
  const text = generateMockupTerms(terms);
  expect(text).toContain('a: "가",');
  expect(text).not.toContain("b:");
  expect(checkMockupTerms(terms, text)).toEqual([]);
  expect(rules(checkMockupTerms(terms, `${text}// edited`))).toEqual(["M-01"]);
});

test("loadTerms accepts the shipped source and rejects a malformed entry", () => {
  expect(loadTerms(TERMS).ok).toBe(true);
  expect(loadTerms({ a: { kind: "concept" } }).ok).toBe(false);
  expect(loadTerms({ a: { ...term(), status: "final" } }).ok).toBe(false);
});

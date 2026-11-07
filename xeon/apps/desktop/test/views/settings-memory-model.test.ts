import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import {
  filterEntries,
  findEntriesOf,
  labelOnlyOf,
  matchesQuery,
  previewOf,
  sortEntries,
  tokensOf,
} from "../../src/views/pages/settings/settings-memory-model.ts";
import { DEPLOY_INDEX, ENTRY_TEXTS, storeOf } from "./memory-fixtures.ts";

// 설정 기억 구역의 순수 모델. 찾기, 정렬, 문맥 토큰 어림, 설정 찾기가 구역을 고르는지를 값으로 본다.
// 시험 항목은 55개 표이고, "배포"를 찾으면 한 개만 남는다.

const LABEL = t("desktop.memory.label");
const entries = storeOf("user", ENTRY_TEXTS).entries;
const idOf = (index: number): string => index.toString(16).padStart(12, "0");
const idsOf = (list: readonly { readonly id: string }[]): readonly string[] =>
  list.map((entry) => entry.id);

describe("filterEntries", () => {
  test("a query for 배포 narrows the 55 entries to the one deploy entry", () => {
    expect(entries).toHaveLength(55);
    expect(idsOf(filterEntries(entries, "배포"))).toEqual([idOf(DEPLOY_INDEX)]);
    expect(filterEntries(entries, "배포").map((entry) => entry.text)).toEqual([
      "금요일에는 배포를 하지 않아요",
    ]);
  });

  test("the match ignores case and the spacing inside the text, and keeps file order", () => {
    const env = storeOf("env", [
      "Deploy  on\nFriday",
      "배포 는   금요일",
      "unrelated",
      "deploy later",
    ]).entries;
    expect(idsOf(filterEntries(env, "DEPLOY on friday"))).toEqual([idOf(0)]);
    expect(idsOf(filterEntries(env, "배포   는"))).toEqual([idOf(1)]);
    expect(idsOf(filterEntries(env, "deploy"))).toEqual([idOf(0), idOf(3)]);
  });

  test("a blank query keeps every entry, and a query with no hit keeps none", () => {
    expect(idsOf(filterEntries(entries, "   "))).toEqual(idsOf(entries));
    expect(filterEntries(entries, "zzzz")).toEqual([]);
  });
});

describe("sortEntries", () => {
  test("recent is the file order reversed, so the newest entry comes first", () => {
    const sorted = sortEntries(entries, "recent", "ko");
    expect(idsOf(sorted.slice(0, 2))).toEqual([idOf(54), idOf(53)]);
    expect(idsOf(sorted)).toEqual(idsOf(entries).toReversed());
  });

  test("recent does not change the order of the entries it was given", () => {
    sortEntries(entries, "recent", "ko");
    expect(idsOf(entries.slice(0, 2))).toEqual([idOf(0), idOf(1)]);
  });

  test("name orders by the Korean collation of the text, and equal names keep file order", () => {
    const env = storeOf("env", ["다 글", "가 글", "나 글", "가 글"]).entries;
    expect(idsOf(sortEntries(env, "name", "ko"))).toEqual([idOf(1), idOf(3), idOf(2), idOf(0)]);
    expect(sortEntries(env, "name", "ko").map((entry) => entry.text)).toEqual([
      "가 글",
      "가 글",
      "나 글",
      "다 글",
    ]);
  });

  test("name uses the one-line preview, so a line break does not change the order", () => {
    const env = storeOf("env", ["나\n글", "가  글"]).entries;
    expect(idsOf(sortEntries(env, "name", "ko"))).toEqual([idOf(1), idOf(0)]);
  });
});

describe("tokensOf", () => {
  test("the estimate is both stores' characters over four, rounded up", () => {
    expect(tokensOf([{ usedChars: 10 }, { usedChars: 7 }])).toEqual(5);
    expect(tokensOf([{ usedChars: 8 }, { usedChars: 0 }])).toEqual(2);
    expect(tokensOf([{ usedChars: 9 }])).toEqual(3);
    expect(tokensOf([{ usedChars: 1375 }, { usedChars: 0 }])).toEqual(344);
    expect(tokensOf([])).toEqual(0);
  });
});

describe("previewOf", () => {
  test("line breaks and runs of spaces become one space, and the ends are trimmed", () => {
    expect(previewOf("  가 \n 나\t다  ")).toEqual("가 나 다");
  });
});

describe("matchesQuery", () => {
  const empty = [storeOf("user", []), storeOf("env", [])];

  test("the section name and the English word memory match, and an unrelated word does not", () => {
    expect(matchesQuery("기억", { label: LABEL, stores: empty })).toEqual(true);
    expect(matchesQuery("MEMORY", { label: LABEL, stores: empty })).toEqual(true);
    expect(matchesQuery("배포", { label: LABEL, stores: empty })).toEqual(false);
  });

  test("an entry text that contains the query matches the section", () => {
    const stores = [storeOf("user", ENTRY_TEXTS), storeOf("env", [])];
    expect(matchesQuery("배포", { label: LABEL, stores })).toEqual(true);
    expect(matchesQuery("zzzz", { label: LABEL, stores })).toEqual(false);
  });

  test("while the memory is not read yet the section does not match", () => {
    expect(matchesQuery("기억", { label: LABEL, stores: null })).toEqual(false);
    expect(matchesQuery("배포", { label: LABEL, stores: null })).toEqual(false);
  });
});

describe("labelOnlyOf and findEntriesOf", () => {
  test("the query only names the section when no entry holds it, and then every entry is shown", () => {
    const stores = [storeOf("user", ENTRY_TEXTS), storeOf("env", [])];
    expect(labelOnlyOf(stores, "기억", LABEL)).toEqual(true);
    expect(labelOnlyOf(stores, "배포", LABEL)).toEqual(false);
    expect(findEntriesOf(entries, "기억", true)).toEqual(entries);
  });

  test("when an entry holds the query, only the matching entries are shown", () => {
    const stores = [storeOf("user", ["기억 한 줄", "다른 글"]), storeOf("env", [])];
    expect(labelOnlyOf(stores, "기억", LABEL)).toEqual(false);
    expect(idsOf(findEntriesOf(entries, "배포", false))).toEqual([idOf(DEPLOY_INDEX)]);
  });
});

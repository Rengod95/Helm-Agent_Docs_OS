import { expect, test } from "bun:test";
import { MESSAGE_KEY_PATTERN } from "@xeon/contracts/settings";
import { catalogOf } from "../../src/i18n/index.ts";

const en = catalogOf("en");
const ko = catalogOf("ko");

test("ko and en have the same ids", () => {
  expect(Object.keys(ko).toSorted()).toEqual(Object.keys(en).toSorted());
});

test("every id is a dotted camelCase message key", () => {
  const pattern = new RegExp(MESSAGE_KEY_PATTERN);
  expect(Object.keys(en).filter((id) => !pattern.test(id))).toEqual([]);
});

/** `{name` 다음의 인자 이름(plural·select 안의 중첩 포함) */
function argNames(message: string): string[] {
  return [
    ...new Set([...message.matchAll(/\{\s*([A-Za-z][A-Za-z0-9]*)\s*[,}]/g)].map((m) => m[1] ?? "")),
  ].toSorted();
}

test("ko and en messages use the same argument names", () => {
  const mismatched = Object.keys(en).filter((id) => {
    return JSON.stringify(argNames(en[id] ?? "")) !== JSON.stringify(argNames(ko[id] ?? ""));
  });
  expect(mismatched).toEqual([]);
});

test("en messages are not copies of ko messages and contain no Hangul", () => {
  const hangul = /[ㄱ-ㆎ가-힣]/;
  expect(
    Object.entries(en)
      .filter(([, text]) => hangul.test(text))
      .map(([id]) => id),
  ).toEqual([]);
});

import { describe, expect, test } from "bun:test";
import { isSensitiveTarget } from "../src/browse/confirm.ts";

// 사람 확인이 필요한 요소 어휘(L2.web.spec §4.10.3). 어휘는 보수적이다: 결제·주문·송금·게시·삭제·약관 동의 단어가 들어가면
// 탐색용 링크 이름이라도 확인을 요구한다("Order history"도 해당한다).

interface Row {
  readonly name: string | undefined;
  readonly sensitive: boolean;
}

const ROWS: readonly Row[] = [
  { name: "Pay now", sensitive: true },
  { name: "Place order", sensitive: true },
  { name: "Delete account", sensitive: true },
  { name: "Accept terms", sensitive: true },
  { name: "Transfer funds", sensitive: true },
  { name: "Order history", sensitive: true },
  { name: "결제하기", sensitive: true },
  { name: "송금", sensitive: true },
  { name: "약관 동의", sensitive: true },
  { name: "Next", sensitive: false },
  { name: "Search", sensitive: false },
  { name: "Sign in", sensitive: false },
  { name: "다음", sensitive: false },
  { name: "검색", sensitive: false },
  { name: "로그인", sensitive: false },
  { name: undefined, sensitive: false },
];

describe("isSensitiveTarget", () => {
  test("value table: payment, ordering, transfer, deletion and terms words in English and Korean", () => {
    const actual = ROWS.map((row) => ({
      name: row.name,
      sensitive: isSensitiveTarget({
        role: "button",
        ...(row.name === undefined ? {} : { name: row.name }),
      }),
    }));
    expect(actual).toEqual(ROWS.map((row) => ({ name: row.name, sensitive: row.sensitive })));
  });

  test("the role alone does not make a target sensitive", () => {
    expect(isSensitiveTarget({ role: "button" })).toBe(false);
    expect(isSensitiveTarget({ role: "link", name: "Pay now" })).toBe(true);
  });
});

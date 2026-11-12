import { expect, test } from "bun:test";
import { pairLinkOf } from "../src/service/pair-link.ts";

// 연결 링크(L4.remote §8.8 1). 데스크톱 셸의 `pairLinkOf`(apps/desktop-shell/src/web/static/pair-link.ts)와 같은 값을 내야 한다.
// 앱끼리 import하지 않으므로 같은 입력에 대한 같은 출력을 값으로 맞춘다.

test("the link is the base's /login with the code in the fragment, the same value the desktop shell makes", () => {
  expect(pairLinkOf("https://my-mac.tail1234.ts.net:8443", "ABCDE12345")).toBe(
    "https://my-mac.tail1234.ts.net:8443/login#code=ABCDE12345",
  );
});

test("a loopback base gives the loopback link, and a path on the base is replaced by /login", () => {
  expect(pairLinkOf("http://127.0.0.1:8480", "ABCDE12345")).toBe(
    "http://127.0.0.1:8480/login#code=ABCDE12345",
  );
  expect(pairLinkOf("https://my-mac.tail1234.ts.net:8443/old/path", "ABCDE12345")).toBe(
    "https://my-mac.tail1234.ts.net:8443/login#code=ABCDE12345",
  );
});

test("the code is not in the query, and a base that is not a URL gives no link", () => {
  const link = pairLinkOf("https://my-mac.tail1234.ts.net:8443", "ABCDE12345");
  expect(link === null ? "" : new URL(link).search).toBe("");
  expect(link === null ? "" : new URL(link).hash).toBe("#code=ABCDE12345");
  expect(pairLinkOf("my-mac", "ABCDE12345")).toBeNull();
});

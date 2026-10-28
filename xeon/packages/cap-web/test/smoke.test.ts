import { expect, test } from "bun:test";
import * as entry from "../src/index.ts";

test("cap-web entry loads", () => {
  expect(typeof entry).toBe("object");
});

// guarded-fetch 0.1.6은 import만 확인한다. 소스 읽기 결과는 L2.web.plan §7에 있고, 네트워크 동작은 시험하지 않는다
test("the production transport and resolver are constructible without a network", () => {
  expect(typeof entry.createHttpTransport().send).toBe("function");
  expect(typeof entry.createSystemResolver().resolve).toBe("function");
});

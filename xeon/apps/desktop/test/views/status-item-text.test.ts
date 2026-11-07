import { afterEach, describe, expect, test } from "bun:test";
import { setActiveLocale } from "@fresnel/client/i18n";
import { statusItemText } from "../../src/views/status-item-text.ts";

afterEach(() => {
  setActiveLocale("ko");
});

const TURN = { id: "core.turn", text: "실행 중", textKey: "desktop.status.core.turn.running" };
const USAGE = {
  id: "core.usage",
  text: "턴 합계 13.1k 토큰 · $0.0017",
  textKey: "desktop.status.core.usage",
  textArgs: { tokens: 13_100, usd: 0.0017 },
};

describe("statusItemText", () => {
  test("영어 로케일은 키를 영어로 풀고 숫자와 비용을 Intl로 적는다", () => {
    setActiveLocale("en");
    expect(statusItemText(TURN)).toBe("Running");
    expect(statusItemText(USAGE)).toBe("Turn total 13.1K tokens · $0.0017");
  });

  test("한국어 로케일은 한국어로 푼다", () => {
    setActiveLocale("ko");
    expect(statusItemText(TURN)).toBe("실행 중");
    expect(statusItemText(USAGE)).toBe("턴 합계 1.3만 토큰 · $0.0017");
  });

  test("키가 없거나 카탈로그에 없으면 보낸 text 그대로다", () => {
    setActiveLocale("en");
    expect(statusItemText({ id: "helm.phase", text: "검토 대기" })).toBe("검토 대기");
    expect(statusItemText({ id: "x.y", text: "plain", textKey: "no.such.key" })).toBe("plain");
  });
});

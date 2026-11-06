import { describe, expect, test } from "bun:test";
import { LEDGER_FAILURES } from "@fresnel/client/views/ledger";
import { frameReasonText } from "../../../src/views/plugin/frame-reason.ts";

describe("프레임이 닫힌 이유 문장", () => {
  test("이유가 없으면 기본 문장이고 풀이는 없다", () => {
    expect(frameReasonText(null)).toEqual({
      line: "이 화면이 꺼졌어요. 다시 켜면 처음부터 다시 불러와요.",
      info: null,
    });
  });

  test("준비 신호가 없거나 규약과 다르면 그 이유를 한 줄로 말하고 nonce를 풀이에 적는다", () => {
    expect(frameReasonText("ready_timeout").line).toBe("준비 신호가 오지 않아 닫혔어요");
    expect(frameReasonText("bridge_format").line).toBe("준비 신호의 모양이 규약과 달라 닫혔어요");
    expect(frameReasonText("bridge_format").info).toContain("#n=<nonce>");
  });

  test("장부의 모든 실패 이름이 서로 다른 한 줄과 풀이를 가진다", () => {
    const lines = LEDGER_FAILURES.map((name) => frameReasonText(name).line);
    expect(new Set(lines).size).toBe(LEDGER_FAILURES.length);
    for (const name of LEDGER_FAILURES) {
      expect(frameReasonText(name).info).not.toBeNull();
    }
  });
});

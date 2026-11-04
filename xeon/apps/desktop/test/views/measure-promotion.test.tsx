import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { PromotionBody, PromotionView } from "../../src/views/measure/promotion-view.tsx";
import { engineFake, makeApp, until } from "../app/support.ts";
import { summary, thr } from "../state/helpers.ts";

// 승격 보고(U-04): 명령이 보내는 인자와 표의 값, 빈 상태와 읽기 상태.

const REPORT = {
  throughSeq: 42,
  threads: 2,
  candidates: [{ tool: "web.fetch", owner: "acme", consumers: ["beta", "gamma"], userCalls: 7 }],
};

describe("promotion report", () => {
  test("the table shows tool, owner, consumers and direct calls from the host's values", () => {
    const out = renderToString(<PromotionBody report={REPORT} />);
    expect(out).toContain("web.fetch");
    expect(out).toContain("acme");
    expect(out).toContain("beta, gamma");
    expect(out).toContain(">7<");
    expect(out).toContain("대화 2개, 이벤트 42번까지");
  });

  test("no candidates says so, and an offline read shows the offline line", () => {
    expect(
      renderToString(<PromotionBody report={{ throughSeq: 0, threads: 0, candidates: [] }} />),
    ).toContain("아직 승격할 후보가 없어요");
    expect(renderToString(<PromotionView read={{ kind: "offline" }} />)).toContain("승격 보고");
    expect(renderToString(<PromotionView read={{ kind: "error" }} />)).toContain("읽지 못했어요");
  });

  test("the command sends the thread id, or no argument without a thread", async () => {
    const engine = engineFake([summary(thr(1))], undefined, {
      results: { "group.promotion": REPORT },
    });
    const app = makeApp(engine.fake);
    await until(() => app.engine.read.getState().link.phase === "live", "live link");
    expect(await app.commands.measure.promotion("thr_1")).toEqual({ ok: true, value: REPORT });
    expect(await app.commands.measure.promotion(null)).toEqual({ ok: true, value: REPORT });
    const sent = engine.params.filter((entry) => entry.method === "group.promotion");
    expect(sent.map((entry) => entry.params)).toEqual([{ threadIds: ["thr_1"] }, {}]);
    await app.stop();
  });
});

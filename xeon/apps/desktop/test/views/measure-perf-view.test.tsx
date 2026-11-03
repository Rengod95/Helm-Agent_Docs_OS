import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { err, ok } from "@fresnel/contracts";
import type { MeasureRow } from "@fresnel/contracts/wire";
import { loadPerf, type PerfInput } from "../../src/views/measure/perf-read.ts";
import { PerfView } from "../../src/views/measure/perf-view.tsx";
import { fakeCommands } from "./fake-commands.ts";

const hook = (reg: string, ms: number, result: string): MeasureRow => ({
  at: 1,
  kind: "hook",
  metrics: { ms, seq: 1, step: 0 },
  tags: { hook: "context", registrationId: reg, result },
});

const input: PerfInput = {
  series: [
    {
      kind: "turn",
      metric: "totalTokens",
      days: [
        { day: "2026-11-03", count: 1, sum: 100, min: 100, max: 100 },
        { day: "2026-11-04", count: 1, sum: 300, min: 300, max: 300 },
      ],
    },
  ],
  turns: [{ turnId: "trn_a", result: { enabled: true, rows: [hook("acme", 900, "over_budget")] } }],
  capped: true,
};
const noop = (): void => {};

describe("PerfView", () => {
  test("ready: change line, signal, plugin row with unknown cost, capped note", () => {
    const out = renderToString(
      <PerfView read={{ kind: "ready", value: input, stale: false }} onOpenTurn={noop} />,
    );
    expect(out).toContain("Turn당 토큰 하루 평균 300, 앞선 날들 100 (올랐어요)");
    expect(out).toContain("Turn 1: 실패나 예산 초과 핸들러 1");
    expect(out).toContain("acme");
    expect(out).toContain("900ms");
    expect(out).toContain("1개 Turn만 읽었어요");
  });
  test("off and empty", () => {
    const off = {
      series: [],
      turns: [{ turnId: "a", result: { enabled: false, rows: [] } }],
      capped: false,
    };
    expect(
      renderToString(
        <PerfView read={{ kind: "ready", value: off, stale: false }} onOpenTurn={noop} />,
      ),
    ).toContain("꺼져 있어");
    const empty = { series: [], turns: [], capped: false };
    expect(
      renderToString(
        <PerfView read={{ kind: "ready", value: empty, stale: false }} onOpenTurn={noop} />,
      ),
    ).toContain("읽어 볼 Turn이 아직 없어요");
  });
  test("loading, offline, error", () => {
    expect(renderToString(<PerfView read={{ kind: "error" }} onOpenTurn={noop} />)).toContain(
      "alert",
    );
  });
});

describe("loadPerf", () => {
  test("reads the newest turns only and keeps what succeeded", async () => {
    const asked: string[] = [];
    const commands = fakeCommands({
      measure: {
        turn: (_thread, turnId) => {
          asked.push(turnId);
          return Promise.resolve(
            turnId === "t1" ? err({ kind: "offline" }) : ok({ enabled: true, rows: [] }),
          );
        },
        daily: (_kind, metric) =>
          Promise.resolve(
            metric === "usd" ? err({ kind: "offline" }) : ok({ enabled: true, days: [] }),
          ),
      },
    });
    const ids = Array.from({ length: 25 }, (_, i) => `t${i}`);
    const got = await loadPerf(commands, "thr_1", ids);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(asked).toEqual(ids.slice(-20));
    expect(got.value.turns.map((t) => t.turnId)).toEqual(ids.slice(-20));
    expect(got.value.series.map((s) => s.metric)).toEqual([
      "totalTokens",
      "firstTokenMs",
      "durationMs",
    ]);
    expect(got.value.capped).toBe(true);
  });
  test("all failed is an error", async () => {
    const commands = fakeCommands();
    const got = await loadPerf(commands, null, []);
    expect(got).toEqual(err({ kind: "unsupported" }));
  });
});

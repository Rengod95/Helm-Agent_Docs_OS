import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { TabRead } from "@fresnel/client/workbench";
import type { MeasureTurnResult } from "@fresnel/contracts/wire";
import { TurnView } from "../../src/views/measure/turn-view.tsx";

const result: MeasureTurnResult = {
  enabled: true,
  rows: [
    {
      at: 1,
      kind: "hook",
      metrics: { ms: 812, seq: 1, step: 0 },
      tags: { hook: "context", registrationId: "acme", result: "failed" },
    },
    {
      at: 1,
      kind: "hook",
      metrics: { ms: 3, seq: 2, step: 0 },
      tags: { hook: "context", registrationId: "helm", result: "brand_new" },
    },
    {
      at: 1,
      kind: "cache",
      metrics: { step: 0, at: 9 },
      tags: { code: "cache_prefix_reset", owner: "context-hook" },
    },
  ],
};
const html = (read: TabRead<MeasureTurnResult>): string => renderToString(<TurnView read={read} />);

describe("TurnView", () => {
  test("ready: shows plugin, outcome text, raw unknown outcome and cache cause", () => {
    const out = html({ kind: "ready", value: result, stale: false });
    expect(out).toContain("acme");
    expect(out).toContain("812ms");
    expect(out).toContain("실패");
    expect(out).toContain("brand_new");
    expect(out).toContain("캐시 접두가 바뀜");
    expect(out).toContain("합치기 훅");
    expect(out).toContain("위치 9");
  });
  test("off, empty, error, offline, loading, stale", () => {
    expect(html({ kind: "ready", value: { enabled: false, rows: [] }, stale: false })).toContain(
      "꺼져 있어",
    );
    expect(html({ kind: "ready", value: { enabled: true, rows: [] }, stale: false })).toContain(
      "측정 기록이 없어요",
    );
    expect(html({ kind: "error" })).toContain('role="alert"');
    expect(html({ kind: "offline" })).toBe(html({ kind: "offline" }));
    expect(html({ kind: "ready", value: result, stale: true })).toContain("acme");
  });
});

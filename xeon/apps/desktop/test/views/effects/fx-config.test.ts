import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import {
  AURORA_SITE,
  GLOW_TUNE,
  ORB_STATE,
  WAVE_DONE_GAP_MS,
  auroraOn,
  schemeOf,
  waveDueOnDone,
} from "../../../src/views/effects/fx-config.ts";

// 이펙트 설정(dzU 시안, DP-126·160~162)

describe("auroraOn", () => {
  test("제품 기본은 끔: 입력창은 테두리 빛 하나로 말한다", () => {
    expect(AURORA_SITE).toBe("off");
    expect(auroraOn("strip", "off")).toBe(false);
    expect(auroraOn("strip", "strip")).toBe(true);
  });
});

function rootWith(theme: string | null): HTMLElement {
  const { document } = parseHTML("<html><body></body></html>");
  if (theme !== null) document.documentElement.setAttribute("data-theme", theme);
  return document.documentElement;
}

describe("schemeOf", () => {
  test("앱이 정한 테마가 운영체제 설정보다 먼저다", () => {
    expect([schemeOf(rootWith("light"), true), schemeOf(rootWith("dark"), false)]).toEqual([
      "light",
      "dark",
    ]);
  });

  test("앱이 정하지 않았으면 운영체제 설정", () => {
    expect([schemeOf(rootWith(null), true), schemeOf(rootWith(null), false)]).toEqual([
      "dark",
      "light",
    ]);
  });
});

describe("waveDueOnDone", () => {
  const tool = { endKind: "completed", steps: 3, durationMs: 4_000 } as const;

  test("도구를 쓴 턴이 정상으로 끝나면 띄운다", () => {
    expect(waveDueOnDone(tool, null)).toBe(true);
  });

  test("멈춤·실패·한도로 끝난 턴에는 띄우지 않는다", () => {
    expect(
      (["interrupted", "failed", "limit"] as const).map((endKind) =>
        waveDueOnDone({ ...tool, endKind }, null),
      ),
    ).toEqual([false, false, false]);
  });

  test("짧은 문답(한 단계, 20초 미만)에는 띄우지 않고 긴 답 하나에는 띄운다", () => {
    expect(waveDueOnDone({ endKind: "completed", steps: 1, durationMs: 3_000 }, null)).toBe(false);
    expect(waveDueOnDone({ endKind: "completed", steps: 1, durationMs: null }, null)).toBe(false);
    expect(waveDueOnDone({ endKind: "completed", steps: 1, durationMs: 25_000 }, null)).toBe(true);
  });

  test("앞 물결에서 간격 안이면 건너뛴다", () => {
    expect(waveDueOnDone(tool, WAVE_DONE_GAP_MS - 1)).toBe(false);
    expect(waveDueOnDone(tool, WAVE_DONE_GAP_MS)).toBe(true);
  });
});

test("생각 orb는 사용자가 짚은 미리보기 칸의 상태다", () => {
  expect(ORB_STATE).toBe("connecting");
});

test("아래 변 빛: 이웃한 알갱이는 숨의 위상이 달라 폭 전체가 한 번에 같이 숨 쉬지 않는다", () => {
  for (const tune of Object.values(GLOW_TUNE)) {
    for (const sparks of [tune.line, tune.bloom]) {
      const phases = sparks.map((spark) => spark.phase);
      expect(phases.every((phase, i) => i === 0 || phase !== phases[i - 1])).toBe(true);
    }
  }
  expect(GLOW_TUNE.field.line.map((spark) => spark.phase)).toEqual([0, 2, 1, 3, 0, 2, 1]);
});

import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import {
  CheckInline,
  CheckSteps,
  elapsedText,
  overallOf,
  type CheckStep,
} from "../../src/views/pages/shared/check-steps.tsx";

// 공용 점검 줄(DP-85). 순수 표시 부품이라 props만 바꿔 그린다. 상태 글은 낭독기용 숨은 글로도 든다.

const NOOP = (): void => {};

const STEPS: readonly CheckStep[] = [
  { id: "a", label: "키 저장", state: "passed", detail: "41바이트", elapsedMs: 12 },
  {
    id: "b",
    label: "제공자 연결",
    state: "failed",
    detail: "꺼져 있어요",
    fix: "제공자를 켜 주세요.",
    action: { label: "켜기", onAction: NOOP },
    elapsedMs: 1530,
  },
  { id: "c", label: "모델 목록", state: "skipped" },
];

describe("overallOf", () => {
  test("running wins, then failed, then all passed or skipped", () => {
    expect(overallOf(STEPS)).toBe("failed");
    expect(overallOf([{ id: "a", label: "a", state: "running" }, ...STEPS])).toBe("running");
    expect(
      overallOf([
        { id: "a", label: "a", state: "passed" },
        { id: "b", label: "b", state: "skipped" },
      ]),
    ).toBe("passed");
    expect(overallOf([{ id: "a", label: "a", state: "waiting" }])).toBe("waiting");
    expect(overallOf([])).toBe("waiting");
  });
});

describe("elapsedText", () => {
  test("milliseconds under a second, one decimal second above", () => {
    expect([elapsedText(12), elapsedText(999.6), elapsedText(1530)]).toEqual([
      "12ms",
      "1000ms",
      "1.5s",
    ]);
  });
});

describe("CheckSteps", () => {
  test("each step shows its state, detail and time; a failed one adds the fix and its action", () => {
    const html = renderToString(<CheckSteps label="시험" steps={STEPS} onRetry={NOOP} />);
    expect(html).toContain('data-state="failed"');
    expect(html).toContain("41바이트");
    expect(html).toContain("12ms");
    expect(html).toContain("1.5s");
    expect(html).toContain("제공자를 켜 주세요.");
    expect(html).toContain("켜기");
    expect(html).toContain(t("desktop.check.state.skipped"));
    expect(html).toContain(t("desktop.check.summary.done", { passed: 1, total: 3 }));
    expect(html).toContain(t("desktop.check.retry"));
  });

  test("without a retry handler there is no head", () => {
    const html = renderToString(<CheckSteps label="시험" steps={STEPS} />);
    expect(html).not.toContain(t("desktop.check.retry"));
  });
});

describe("CheckInline", () => {
  test("before a run it is only the button; after a failure it shows the line and the fix", () => {
    expect(renderToString(<CheckInline result={null} onRun={NOOP} />)).toContain(
      t("desktop.check.run"),
    );
    const html = renderToString(<CheckInline result={STEPS[1] ?? null} onRun={NOOP} />);
    expect(html).toContain("꺼져 있어요");
    expect(html).toContain("제공자를 켜 주세요.");
    expect(html).toContain('data-state="failed"');
  });
});

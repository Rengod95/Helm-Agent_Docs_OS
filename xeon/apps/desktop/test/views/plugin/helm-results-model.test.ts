import { describe, expect, test } from "bun:test";
import {
  captionOf,
  findingsOf,
  helmResultsLabelsOf,
  inquiriesOf,
  markdownOf,
  sourceTextOf,
  type HelmFindingView,
  type InquirySummary,
} from "../../../src/views/plugin/helm-results-model.ts";

// 탐구 결과 모델을 값으로 본다. 파서는 맞는 모양은 값을 주고 어긋나면 null을 준다. Markdown은 글자 그대로 비교한다.
// 시험 프로세스는 ko 로케일이라(test-preload) 라벨이 한국어다.

const RUNNING: InquirySummary = {
  inquiryId: "inq-run",
  topic: "재시도 간격",
  status: "running",
  outcome: null,
  findingCount: 1,
};

const FINISHED: InquirySummary = {
  inquiryId: "inq-done",
  topic: "캐시 무효화",
  status: "finished",
  outcome: "applied",
  findingCount: 2,
};

const WEB_FINDING: HelmFindingView = {
  id: "basic-1",
  lensId: "basic",
  claim: "만료 비교 단위가 섞임",
  sources: [{ origin: "web", ref: "https://example.com/ttl", title: "TTL 문서" }],
  confidence: "high",
};

const SESSION_FINDING: HelmFindingView = {
  id: "failure-1",
  lensId: "failure",
  claim: "TTL 캐시 경계 시각 버그",
  sources: [{ origin: "session", ref: "turn-3" }],
  confidence: "medium",
};

describe("탐구 결과 파서: inquiriesOf", () => {
  test("맞는 목록은 그대로 준다. 진행 중 탐구는 결과가 null이다", () => {
    expect(inquiriesOf({ inquiries: [RUNNING, FINISHED] })).toEqual({
      inquiries: [RUNNING, FINISHED],
    });
  });

  test("빈 목록은 빈 목록이다", () => {
    expect(inquiriesOf({ inquiries: [] })).toEqual({ inquiries: [] });
  });

  test("모양이 어긋나면 null이다: 모르는 결과, 모르는 상태, 음수 발견 수, 필드 빠짐", () => {
    expect(inquiriesOf({ inquiries: [{ ...FINISHED, outcome: "unknown" }] })).toBeNull();
    expect(inquiriesOf({ inquiries: [{ ...FINISHED, status: "done" }] })).toBeNull();
    expect(inquiriesOf({ inquiries: [{ ...FINISHED, findingCount: -1 }] })).toBeNull();
    expect(inquiriesOf({ inquiries: [{ inquiryId: "inq-x", topic: "x" }] })).toBeNull();
    expect(inquiriesOf({ items: [] })).toBeNull();
  });

  test("값이 객체가 아니면 null이다", () => {
    expect(inquiriesOf(null)).toBeNull();
    expect(inquiriesOf("inquiries")).toBeNull();
    expect(inquiriesOf(undefined)).toBeNull();
  });
});

describe("탐구 결과 파서: findingsOf", () => {
  test("출처가 있거나 없는 발견을 그대로 준다", () => {
    expect(findingsOf({ inquiryId: "inq-done", findings: [WEB_FINDING, SESSION_FINDING] })).toEqual(
      { inquiryId: "inq-done", findings: [WEB_FINDING, SESSION_FINDING] },
    );
  });

  test("모르는 탐구는 빈 발견 목록이다", () => {
    expect(findingsOf({ inquiryId: "inq-none", findings: [] })).toEqual({
      inquiryId: "inq-none",
      findings: [],
    });
  });

  test("모양이 어긋나면 null이다: 모르는 신뢰도, 모르는 출처 종류, 주장 빠짐", () => {
    expect(
      findingsOf({
        inquiryId: "inq-done",
        findings: [{ ...WEB_FINDING, confidence: "certain" }],
      }),
    ).toBeNull();
    expect(
      findingsOf({
        inquiryId: "inq-done",
        findings: [{ ...WEB_FINDING, sources: [{ origin: "email", ref: "x" }] }],
      }),
    ).toBeNull();
    expect(
      findingsOf({
        inquiryId: "inq-done",
        findings: [{ id: "basic-1", lensId: "basic", sources: [], confidence: "high" }],
      }),
    ).toBeNull();
    expect(findingsOf({ findings: [] })).toBeNull();
    expect(findingsOf(undefined)).toBeNull();
  });
});

describe("탐구 결과 Markdown: markdownOf", () => {
  test("끝난 탐구는 주제, 결과, 발견 수, 발견마다 주장·신뢰도·출처를 적는다", () => {
    expect(markdownOf(FINISHED, [WEB_FINDING, SESSION_FINDING])).toBe(
      [
        "# 캐시 무효화",
        "",
        "- 결과: 적용됨",
        "- 발견: 2개",
        "",
        "## 발견",
        "",
        "1. 만료 비교 단위가 섞임 (신뢰도: 높음)",
        "   - 출처: [웹] TTL 문서 (https://example.com/ttl)",
        "2. TTL 캐시 경계 시각 버그 (신뢰도: 보통)",
        "   - 출처: [이 대화] turn-3",
      ].join("\n"),
    );
  });

  test("발견이 없으면 발견이 없다는 한 줄을 적고, 결과는 발견 없음이다", () => {
    const empty: InquirySummary = { ...FINISHED, outcome: "empty", findingCount: 0 };
    expect(markdownOf(empty, [])).toBe(
      [
        "# 캐시 무효화",
        "",
        "- 결과: 발견 없음",
        "- 발견: 0개",
        "",
        "## 발견",
        "",
        "발견이 없어요.",
      ].join("\n"),
    );
  });

  test("진행 중 탐구는 결과 대신 상태를 적는다. 주제가 비면 주제 없음이다", () => {
    const untitled: InquirySummary = { ...RUNNING, topic: "" };
    expect(markdownOf(untitled, [WEB_FINDING])).toBe(
      [
        "# 주제 없음",
        "",
        "- 결과: 진행 중",
        "- 발견: 1개",
        "",
        "## 발견",
        "",
        "1. 만료 비교 단위가 섞임 (신뢰도: 높음)",
        "   - 출처: [웹] TTL 문서 (https://example.com/ttl)",
      ].join("\n"),
    );
  });

  test("줄바꿈은 공백으로 펴고, 출처가 없는 발견은 출처 줄이 없다", () => {
    const topic: InquirySummary = { ...FINISHED, topic: "  캐시\n무효화  " };
    const bare: HelmFindingView = {
      id: "basic-2",
      lensId: "basic",
      claim: "첫 줄\n둘째 줄",
      sources: [],
      confidence: "low",
    };
    expect(markdownOf(topic, [bare])).toBe(
      [
        "# 캐시 무효화",
        "",
        "- 결과: 적용됨",
        "- 발견: 1개",
        "",
        "## 발견",
        "",
        "1. 첫 줄 둘째 줄 (신뢰도: 낮음)",
      ].join("\n"),
    );
  });
});

describe("탐구 결과 글: 출처와 목록 캡션", () => {
  test("출처는 종류를 대괄호에 두고, 제목이 있으면 제목과 참조를 적는다", () => {
    const labels = helmResultsLabelsOf();
    expect(sourceTextOf({ origin: "web", ref: "https://example.com", title: "예" }, labels)).toBe(
      "[웹] 예 (https://example.com)",
    );
    expect(sourceTextOf({ origin: "knowledge", ref: "l2/cache-note" }, labels)).toBe(
      "[지식] l2/cache-note",
    );
  });

  test("목록 캡션: 끝난 탐구는 결과와 발견 수, 진행 중 탐구는 발견 수만 보인다", () => {
    const labels = helmResultsLabelsOf();
    expect(captionOf(FINISHED, labels)).toBe("적용됨 · 발견 2개");
    expect(captionOf(RUNNING, labels)).toBe("발견 1개");
  });
});

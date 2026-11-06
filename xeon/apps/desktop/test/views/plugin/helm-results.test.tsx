import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { Skeleton } from "@caustic/react";
import { renderToString } from "react-dom/server";
import type { InquirySummary } from "../../../src/views/plugin/helm-results-model.ts";
import {
  HelmResultsBody,
  type FindingsLoad,
  type HelmResultsBodyProps,
  type HelmResultsLoad,
} from "../../../src/views/plugin/helm-results.tsx";

// "탐구 결과" 구역의 그림을 값으로 본다(서버 렌더, 효과를 돌리지 않는다). 읽기와 복사는 구역 상태가 맡고 여기서는 그림만 본다.
// 시험 프로세스는 ko 로케일이다(test-preload).

/** 태그와 주석을 뺀 글 */
const textOf = (html: string): string =>
  html.replaceAll(/<!--.*?-->/g, "").replaceAll(/<[^>]*>/g, "");

/** 탐구 행(li)의 시작 표지. 발견과 출처의 li와 구별하려고 행의 클래스 앞머리를 쓴다 */
const ROW_START = '<li class="grid gap-1.5';

/** 행 하나의 마크업. 주제가 든 행을 고른다 */
function rowOf(html: string, topic: string): string {
  return html.split(ROW_START).find((part) => part.includes(topic)) ?? "";
}

/** 펼쳐진 단추 개수 */
const countExpanded = (html: string): number => html.split('aria-expanded="true"').length - 1;

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

const READY_LIST: HelmResultsLoad = { kind: "ready", inquiries: [RUNNING, FINISHED] };

const FINDINGS: FindingsLoad = {
  kind: "ready",
  findings: [
    {
      id: "basic-1",
      lensId: "basic",
      claim: "만료 비교 단위가 섞임",
      sources: [{ origin: "web", ref: "https://example.com/ttl", title: "TTL 문서" }],
      confidence: "high",
    },
    {
      id: "failure-1",
      lensId: "failure",
      claim: "TTL 캐시 경계 시각 버그",
      sources: [{ origin: "session", ref: "turn-3" }],
      confidence: "medium",
    },
  ],
};

function body(over: Partial<HelmResultsBodyProps> = {}): string {
  return renderToString(
    <HelmResultsBody
      threadOpen
      link="live"
      list={READY_LIST}
      expandedId={null}
      findings={{}}
      copied={null}
      onToggle={() => {}}
      onRetryFindings={() => {}}
      onCopy={() => {}}
      onReload={() => {}}
      {...over}
    />,
  );
}

describe("탐구 결과 구역: 열린 대화와 연결", () => {
  test("대화가 없으면 안내 한 줄이고 목록과 다시 읽기는 없다", () => {
    const html = body({ threadOpen: false });
    expect(textOf(html)).toContain("대화를 열면 이 대화의 탐구 결과가 보여요.");
    expect(html).not.toContain(t("desktop.helm.results.retry"));
    expect(html).not.toContain("aria-expanded");
  });

  test("연결이 끊기면 끊김 글 한 줄이고 목록은 그리지 않는다", () => {
    const html = body({ link: "offline" });
    expect(textOf(html)).toContain(t("desktop.runtime.offline"));
    expect(textOf(html)).not.toContain("재시도 간격");
  });

  test("구역 제목은 항상 보이고, 설명은 아이콘 뒤의 글이다", () => {
    const html = body({ threadOpen: false });
    expect(textOf(html)).toContain("탐구 결과");
    expect(html).toContain(t("desktop.helm.results.intro"));
  });
});

describe("탐구 결과 구역: 목록 읽기 상태", () => {
  test("읽는 중이면 Skeleton 하나이고 목록과 오류는 없다", () => {
    const html = body({ list: { kind: "loading" } });
    expect(html).toContain(renderToString(<Skeleton height={24} />));
    expect(html).not.toContain("aria-expanded");
    expect(textOf(html)).not.toContain(t("desktop.helm.results.loadFailed"));
  });

  test("읽지 못하면 오류 한 줄과 다시 읽기 단추를 보인다", () => {
    const text = textOf(body({ list: { kind: "error" } }));
    expect(text).toContain("결과를 읽지 못했어요");
    expect(text).toContain("다시 읽기");
    expect(text).not.toContain("재시도 간격");
  });

  test("끝난 탐구가 없으면 빈 글 한 줄이다", () => {
    const html = body({ list: { kind: "ready", inquiries: [] } });
    expect(textOf(html)).toContain("이 대화에서 아직 탐구가 없어요.");
    expect(html).not.toContain("aria-expanded");
  });
});

describe("탐구 결과 구역: 목록 줄", () => {
  test("탐구마다 주제, 상태, 결과와 발견 수를 보이고 접힌 채 펼침 단추를 가진다", () => {
    const html = body();
    expect(countExpanded(html)).toBe(0);
    expect(html.split('aria-expanded="false"').length - 1).toBe(2);
    const running = textOf(rowOf(html, "재시도 간격"));
    expect(running).toContain("진행 중");
    expect(running).toContain("발견 1개");
    expect(running).not.toContain("적용됨");
    const finished = textOf(rowOf(html, "캐시 무효화"));
    expect(finished).toContain("끝남");
    expect(finished).toContain("적용됨 · 발견 2개");
  });

  test("주제가 빈 탐구는 주제 없음으로 보인다", () => {
    const html = body({
      list: { kind: "ready", inquiries: [{ ...RUNNING, topic: "" }] },
    });
    expect(textOf(html)).toContain("주제 없음");
  });
});

describe("탐구 결과 구역: 펼친 탐구", () => {
  test("펼치기 전에는 발견 글과 복사 단추가 없다", () => {
    const html = body({ findings: { "inq-done": FINDINGS } });
    expect(countExpanded(html)).toBe(0);
    expect(html).not.toContain(t("desktop.helm.results.copy"));
  });

  test("발견을 읽는 동안은 Skeleton이고 복사 단추는 아직 없다", () => {
    const html = body({ expandedId: "inq-done", findings: { "inq-done": { kind: "loading" } } });
    expect(countExpanded(html)).toBe(1);
    expect(html).toContain(renderToString(<Skeleton height={24} />));
    expect(html).not.toContain(t("desktop.helm.results.copy"));
  });

  test("발견을 읽지 못하면 오류와 다시 읽기를 보이고 목록 줄은 그대로다", () => {
    const html = body({ expandedId: "inq-done", findings: { "inq-done": { kind: "error" } } });
    const text = textOf(rowOf(html, "캐시 무효화"));
    expect(text).toContain("결과를 읽지 못했어요");
    expect(text).toContain("다시 읽기");
    expect(textOf(rowOf(html, "재시도 간격"))).not.toContain("결과를 읽지 못했어요");
  });

  test("발견 목록은 주장, 신뢰도, 출처를 보이고 Markdown으로 복사 단추를 둔다", () => {
    const html = body({ expandedId: "inq-done", findings: { "inq-done": FINDINGS } });
    const text = textOf(rowOf(html, "캐시 무효화"));
    expect(text.indexOf("만료 비교 단위가 섞임")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("만료 비교 단위가 섞임")).toBeLessThan(
      text.indexOf("TTL 캐시 경계 시각 버그"),
    );
    expect(text).toContain("신뢰도: 높음");
    expect(text).toContain("신뢰도: 보통");
    expect(text).toContain("[웹] TTL 문서 (https://example.com/ttl)");
    expect(text).toContain("[이 대화] turn-3");
    expect(text).toContain("Markdown으로 복사");
    expect(text).not.toContain("재시도 간격");
  });

  test("발견이 없으면 발견이 없다는 글과 복사 단추를 보인다", () => {
    const html = body({
      expandedId: "inq-done",
      findings: { "inq-done": { kind: "ready", findings: [] } },
    });
    const text = textOf(rowOf(html, "캐시 무효화"));
    expect(text).toContain("발견이 없어요.");
    expect(text).toContain("Markdown으로 복사");
  });

  test("복사 결과는 펼친 탐구 아래에 한 줄로 보인다. 다른 탐구의 결과는 보이지 않는다", () => {
    const copiedOk = body({
      expandedId: "inq-done",
      findings: { "inq-done": FINDINGS },
      copied: { inquiryId: "inq-done", copied: true },
    });
    expect(textOf(rowOf(copiedOk, "캐시 무효화"))).toContain("복사했어요");

    const copyFailed = body({
      expandedId: "inq-done",
      findings: { "inq-done": FINDINGS },
      copied: { inquiryId: "inq-done", copied: false },
    });
    expect(textOf(rowOf(copyFailed, "캐시 무효화"))).toContain("복사하지 못했어요");

    const other = body({
      expandedId: "inq-done",
      findings: { "inq-done": FINDINGS },
      copied: { inquiryId: "inq-run", copied: true },
    });
    expect(other).not.toContain("복사했어요");
  });
});

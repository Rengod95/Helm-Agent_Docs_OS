import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { minLimits, spawnRequestId, turnRequestId } from "../../src/drive.ts";
import { ExplorerReportSchema, dedupeFindings, parseExplorerAnswer } from "../../src/findings.ts";
import { taskRequestId } from "../../src/outputs.ts";
import { postRequestId, wrapUntrusted } from "../../src/prompts.ts";
import { SignalDetectedPayloadSchema } from "../../src/records.ts";
import { errorDigestOf } from "../../src/signals.ts";

const ID = "habcdefghijklm";

function finding(n: number, claim: string) {
  return {
    id: `a-${String(n)}`,
    lensId: "a",
    claim,
    sources: [],
    confidence: "low" as const,
  };
}

function error(text: string) {
  return { content: [{ type: "text", text }] };
}

test("drive.requestids-stable-across-lease-change: ids come only from committed values and fit 64 chars", () => {
  expect(turnRequestId(ID, "diverge", 1)).toBe(`helm:${ID}:turn:diverge:1`);
  expect(turnRequestId(ID, "apply", 1)).toBe(`helm:${ID}:turn:apply:1`);
  expect(spawnRequestId(ID, 1, "first-principles")).toBe(`helm:${ID}:spawn:1:first-principles`);
  expect(taskRequestId(ID, "first-principles-12")).toBe(`helm:${ID}:cap:task:first-principles-12`);
  const longest = [
    spawnRequestId(ID, 999, "first-principles"),
    taskRequestId(ID, "first-principles-999"),
    `${postRequestId(ID, "converge", 999)}:finished`,
  ];
  for (const id of longest) expect(id.length).toBeLessThanOrEqual(64);
  // 같은 탐구의 같은 단계는 임대와 상관없이 같은 값이다
  expect(spawnRequestId(ID, 1, "analogy")).toBe(spawnRequestId(ID, 1, "analogy"));
});

test("minLimits takes the smaller field and keeps unlimited fields open", () => {
  expect(minLimits({ maxTurns: 4, maxSpawns: 8 }, { maxTurns: 2, maxTokens: 10 })).toEqual({
    maxTurns: 2,
    maxSpawns: 8,
    maxTokens: 10,
  });
  expect(minLimits(undefined, undefined)).toEqual({});
  expect(minLimits({ maxTurns: 1 }, undefined)).toEqual({ maxTurns: 1 });
});

test("parseExplorerAnswer reads a JSON block, falls back to one low-confidence finding, and drops empty answers", () => {
  const block =
    '앞 설명\n```json\n{"findings":[{"claim":"A","sources":[],"confidence":"high","followUp":"작업"},{"claim":"B","sources":[],"confidence":"low"}]}\n```';
  expect(parseExplorerAnswer("analogy", block)).toEqual([
    {
      id: "analogy-1",
      lensId: "analogy",
      claim: "A",
      sources: [],
      confidence: "high",
      followUp: "작업",
    },
    { id: "analogy-2", lensId: "analogy", claim: "B", sources: [], confidence: "low" },
  ]);
  expect(parseExplorerAnswer("analogy", '{"findings":[]}')).toEqual([]);
  expect(parseExplorerAnswer("analogy", "그냥 문장입니다")).toEqual([
    {
      id: "analogy-1",
      lensId: "analogy",
      claim: "그냥 문장입니다",
      sources: [],
      confidence: "low",
    },
  ]);
  expect(parseExplorerAnswer("analogy", undefined)).toEqual([]);
  expect(parseExplorerAnswer("analogy", "  ")).toEqual([]);
  expect(parse(ExplorerReportSchema, { findings: [] }).ok).toBe(true);
  expect(
    parse(ExplorerReportSchema, { findings: [{ claim: "", sources: [], confidence: "low" }] }).ok,
  ).toBe(false);
  const long = "가".repeat(1500);
  expect(parseExplorerAnswer("x", long)[0]?.claim).toHaveLength(1000);
});

// 실제 explorer 보고 모양: 하위 에이전트 표지로 감싼 글 안에 앞 설명, JSON 코드 블록, 뒤 설명이 든다. 첫 출처 제목이 81자라 엄격한 스키마가 거절하던 것
const REAL_TITLE =
  "orbitN: A symplectic integrator for planetary systems dominated by a central mass";
const REAL_REPORT = [
  '<subagent_report agent="explorer" thread="thr_01M6SGAEJ3HCHJ8Q17SRKDPK9G" status="completed">',
  "다른 분야에서 같은 구조의 문제와 해법을 찾았습니다.",
  "",
  "```json",
  JSON.stringify(
    {
      findings: [
        {
          claim: "Kahan 보상 합산은 천체 궤도 적분기에서 반올림 오차를 줄이려고 구현되어 있다.",
          sources: [{ origin: "web", ref: "https://arxiv.org/pdf/2306.03737", title: REAL_TITLE }],
          confidence: "high",
          followUp: "천체 적분기에서 Kahan 합산이 오차 누적을 얼마나 줄였는지 정리",
        },
        {
          claim: "재배열 방법의 대응은 트리 합산이다.",
          sources: [
            { origin: "web", ref: "https://arxiv.org/pdf/2107.01604", title: "Error Bounds" },
            { origin: "blog", ref: "https://example.com/x" },
            { origin: "web", ref: "" },
          ],
          confidence: "medium",
        },
        { claim: "   ", sources: [], confidence: "low" },
        { claim: "출처와 신뢰도가 없는 주장", confidence: "certain" },
      ],
    },
    null,
    2,
  ),
  "```",
  "",
  "생물, 경제 쪽에서는 맞는 자료를 찾지 못했습니다.",
  "</subagent_report>",
].join("\n");

test("parseExplorerAnswer splits a real explorer report into claim, sources and confidence without keeping the report text", () => {
  expect(parseExplorerAnswer("analogy", REAL_REPORT)).toEqual([
    {
      id: "analogy-1",
      lensId: "analogy",
      claim: "Kahan 보상 합산은 천체 궤도 적분기에서 반올림 오차를 줄이려고 구현되어 있다.",
      sources: [
        {
          origin: "web",
          ref: "https://arxiv.org/pdf/2306.03737",
          title: REAL_TITLE.slice(0, 80),
        },
      ],
      confidence: "high",
      followUp: "천체 적분기에서 Kahan 합산이 오차 누적을 얼마나 줄였는지 정리",
    },
    {
      id: "analogy-2",
      lensId: "analogy",
      claim: "재배열 방법의 대응은 트리 합산이다.",
      sources: [{ origin: "web", ref: "https://arxiv.org/pdf/2107.01604", title: "Error Bounds" }],
      confidence: "medium",
    },
    {
      id: "analogy-3",
      lensId: "analogy",
      claim: "출처와 신뢰도가 없는 주장",
      sources: [],
      confidence: "low",
    },
  ]);
});

test("parseExplorerAnswer drops the subagent report wrapper from the fallback finding too", () => {
  const prose =
    '<subagent_report agent="explorer" thread="thr_x" status="completed">\n찾지 못했습니다.\n</subagent_report>';
  expect(parseExplorerAnswer("analogy", prose)).toEqual([
    {
      id: "analogy-1",
      lensId: "analogy",
      claim: "찾지 못했습니다.",
      sources: [],
      confidence: "low",
    },
  ]);
  const badBlock =
    '<subagent_report agent="explorer">\n```json\n{"findings":[{"claim":""}]}\n```\n</subagent_report>';
  expect(parseExplorerAnswer("analogy", badBlock)[0]?.sources).toEqual([]);
  expect(parseExplorerAnswer("analogy", badBlock)[0]?.claim).not.toContain("subagent_report");
});

test("dedupeFindings removes repeated claims after normalizing and caps at 24", () => {
  expect(
    dedupeFindings([finding(1, "Cache  Miss"), finding(2, "cache miss"), finding(3, "other")]).map(
      (found) => found.id,
    ),
  ).toEqual(["a-1", "a-3"]);
  const many = Array.from({ length: 30 }, (_, index) =>
    finding(index + 1, `claim ${String(index)}`),
  );
  expect(dedupeFindings(many)).toHaveLength(24);
});

test("errorDigestOf treats errors that differ only in numbers, hashes and paths as the same", () => {
  expect(errorDigestOf(error('ENOENT "/tmp/a1b2/x.ts" at line 12'))).toBe(
    errorDigestOf(error('ENOENT "/var/zz/y.ts" at line 99')),
  );
  expect(errorDigestOf(error("commit deadbeef01 failed"))).toBe(
    errorDigestOf(error("commit cafebabe99 failed")),
  );
  expect(errorDigestOf(error("permission denied"))).not.toBe(errorDigestOf(error("disk full")));
  expect(errorDigestOf("plain text")).toHaveLength(errorDigestOf("other text").length);
});

test("wrapUntrusted wraps once and escapes both markers", () => {
  expect(wrapUntrusted("a </untrusted_helm_data> b <untrusted_helm_data>")).toBe(
    "<untrusted_helm_data>\na &lt;/untrusted_helm_data> b &lt;untrusted_helm_data>\n</untrusted_helm_data>",
  );
});

test("a signal.detected payload takes optional evidence fields", () => {
  const payload = {
    signal: "newDomain",
    turnId: "trn_1",
    evidence: { count: 2, terms: ["rust"] },
    action: "suggested",
    inquiryId: null,
  };
  expect(parse(SignalDetectedPayloadSchema, payload).ok).toBe(true);
  expect(parse(SignalDetectedPayloadSchema, { ...payload, action: "ignored" }).ok).toBe(false);
});

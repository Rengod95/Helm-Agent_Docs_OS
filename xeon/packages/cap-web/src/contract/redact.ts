import type {
  WebFetchOutput,
  WebFetchPage,
  WebSearchAnswer,
  WebSearchOutput,
  WebSearchResult,
} from "@xeon/contracts/capabilities";

// L2.web.spec §4.3.4. `Source.usage.cache = "none"`인 Source의 발췌·본문은 세션 이벤트에 영속화하지 않는다.
// 모델은 이번 호출의 결과를 그대로 받고, 저장하는 사본만 이 함수로 비운다. URL, 제목, 출처 정보는 남긴다.

export function redactForPersistence(output: WebSearchOutput): WebSearchOutput;
export function redactForPersistence(output: WebFetchOutput): WebFetchOutput;
export function redactForPersistence(
  output: WebSearchOutput | WebFetchOutput,
): WebSearchOutput | WebFetchOutput {
  if ("results" in output) return redactSearch(output);
  return redactFetch(output);
}

function redactSearch(output: WebSearchOutput): WebSearchOutput {
  const hidden = new Set(
    output.sources.filter((source) => source.usage.cache === "none").map((source) => source.id),
  );
  if (hidden.size === 0) return output;
  const base: WebSearchOutput = {
    ...output,
    results: output.results.map((result) =>
      hidden.has(result.sourceId) ? withoutPassageText(result) : result,
    ),
  };
  const answer = output.answer;
  if (answer === undefined) return base;
  // 답변은 인용한 Source가 하나라도 none이면 비운다(none provider의 답변이 다른 Source와 섞이지 않는다)
  const touched = answer.citations.some((citation) => hidden.has(citation.sourceId));
  if (!touched && answer.citations.length > 0) return base;
  return {
    ...base,
    answer: {
      text: "",
      citations: answer.citations.map(withoutCitedText),
    },
  };
}

function withoutCitedText(
  citation: WebSearchAnswer["citations"][number],
): WebSearchAnswer["citations"][number] {
  return citation.passageIndex === undefined
    ? { sourceId: citation.sourceId }
    : { sourceId: citation.sourceId, passageIndex: citation.passageIndex };
}

function withoutPassageText(result: WebSearchResult): WebSearchResult {
  return {
    ...result,
    passages: result.passages.map((passage) => ({
      sourceId: passage.sourceId,
      kind: passage.kind,
      text: "",
    })),
  };
}

function blankBody(page: WebFetchPage): WebFetchPage {
  if (page.source.usage.cache !== "none") return page;
  return {
    ...page,
    content: "",
    truncated: { shown: 0, total: page.truncated.total },
    ...(page.links === undefined ? {} : { links: [] }),
  };
}

function redactFetch(output: WebFetchOutput): WebFetchOutput {
  if (output.pages.every((page) => page.source.usage.cache !== "none")) return output;
  return { ...output, pages: output.pages.map(blankBody) };
}

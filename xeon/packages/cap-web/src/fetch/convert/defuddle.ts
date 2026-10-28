import Defuddle from "defuddle";
import type { Extracted } from "./readability.ts";

// 선택 추출기(`l2.web.fetch.extractor = "defuddle"`). 동기 `parse()`만 쓴다. 비동기 추출기(YouTube 등)는 제3자 API를
// 부르므로 `parseAsync`와 `useAsync`는 쓰지 않는다(WEB-R16).

export function extractWithDefuddle(doc: Document, baseUrl: string): Extracted | undefined {
  const response = new Defuddle(doc, { url: baseUrl, useAsync: false }).parse();
  const html = response.content;
  if (html.trim() === "") return undefined;
  const title = response.title.trim();
  const published = response.published.trim();
  return {
    title: title === "" ? undefined : title,
    html,
    publishedAt: published === "" ? undefined : published,
  };
}

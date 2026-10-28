import { Readability } from "@mozilla/readability";

// 기본 추출기(L2.web.spec §4.9.1 5단계). Readability가 문서를 바꾸므로 호출자가 넘기는 문서는 한 번만 쓴다.

export interface Extracted {
  readonly title: string | undefined;
  /** 본문 HTML */
  readonly html: string;
  readonly publishedAt: string | undefined;
}

export function extractWithReadability(doc: Document): Extracted | undefined {
  const article = new Readability(doc, { keepClasses: false }).parse();
  if (article === null) return undefined;
  const html = article.content ?? "";
  if (html.trim() === "") return undefined;
  const title = article.title?.trim();
  return {
    title: title === undefined || title === "" ? undefined : title,
    html,
    publishedAt: undefined,
  };
}

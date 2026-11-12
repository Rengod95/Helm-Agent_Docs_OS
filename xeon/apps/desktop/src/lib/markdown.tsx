import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export type MarkdownOptions = {
  /** 요소별 렌더러. 코드 강조는 highlight.ts가 주는 토큰을 여기서 쓴다. */
  readonly components?: Components;
};

const remarkPlugins = [remarkGfm];

/**
 * 마크다운을 React 노드로 바꾼다. 표와 체크 목록(GFM)을 지원한다.
 * 원시 HTML은 그리지 않는다(`skipHtml`, rehype-raw를 쓰지 않는다). 링크와 이미지 주소는 react-markdown 기본
 * urlTransform이 `javascript:` 같은 위험 스킴을 걸러낸다. 코드 블록은 `language-xxx` 클래스만 남기고 색은 입히지 않는다.
 */
export function renderMarkdown(source: string, options?: MarkdownOptions): ReactNode {
  return (
    <Markdown remarkPlugins={remarkPlugins} skipHtml components={options?.components}>
      {source}
    </Markdown>
  );
}

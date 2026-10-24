import TurndownService from "turndown";

// HTML → Markdown. 서비스 인스턴스는 설정이 고정이라 하나를 재사용한다.

const service = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
  hr: "---",
});
service.remove(["script", "style", "noscript", "iframe"]);

// 목록 항목: 표지 뒤 공백을 하나로 줄이고 이어지는 줄은 네 칸 들여쓴다(모델에 가는 토큰을 줄인다)
service.addRule("compactListItem", {
  filter: "li",
  replacement(content, node, options) {
    const body = content.replace(/^\n+/, "").replace(/\n+$/, "\n").replaceAll("\n", "\n    ");
    const parent = node.parentElement;
    let prefix = `${options.bulletListMarker} `;
    if (parent !== null && parent.nodeName === "OL") {
      const start = parent.getAttribute("start");
      let index = 0;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === node) break;
        index += 1;
      }
      prefix = `${start === null ? index + 1 : Number(start) + index}. `;
    }
    const hasNext = node.nextSibling !== null && !body.endsWith("\n");
    return `${prefix}${body}${hasNext ? "\n" : ""}`;
  },
});

export function htmlToMarkdown(html: string): string {
  return service
    .turndown(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

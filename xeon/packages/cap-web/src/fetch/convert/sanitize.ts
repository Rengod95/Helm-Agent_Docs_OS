// L2.web.spec §4.9.3 DOM 설정. 외부 리소스를 읽는 요소와 숨은 내용을 텍스트 추출 전에 지운다.
// linkedom 문서는 리소스를 읽지 않지만, 추출기가 속성(src, href)을 따라 무언가를 하지 않도록 요소 자체를 지운다.

const REMOVED_SELECTORS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "img",
  "link",
  "object",
  "embed",
  "template",
  "svg",
  "canvas",
  "video",
  "audio",
  "source",
  "[hidden]",
  '[aria-hidden="true"]',
].join(",");

const HIDDEN_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden/i;
const JAVASCRIPT_NOTICE = /javascript/i;
const COMMENT_NODE = 8;

export interface SanitizeReport {
  /** `<noscript>`가 JavaScript를 요구한다고 안내함 */
  readonly noscriptNeedsJavascript: boolean;
}

function stripComments(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === COMMENT_NODE) child.parentNode?.removeChild(child);
    else stripComments(child);
  }
}

export function sanitizeDocument(doc: Document): SanitizeReport {
  // noscript 안내는 지우기 전에 읽는다(SPA 징후 판정에 쓴다)
  let noscriptNeedsJavascript = false;
  for (const element of doc.querySelectorAll("noscript")) {
    if (JAVASCRIPT_NOTICE.test(element.textContent)) noscriptNeedsJavascript = true;
  }
  stripComments(doc);
  for (const element of doc.querySelectorAll("[style]")) {
    if (HIDDEN_STYLE.test(element.getAttribute("style") ?? "")) element.remove();
  }
  for (const element of doc.querySelectorAll(REMOVED_SELECTORS)) element.remove();
  return { noscriptNeedsJavascript };
}

import { attempt } from "@xeon/contracts";
import { parseHTML } from "linkedom";
import { extractWithDefuddle } from "./defuddle.ts";
import { extractWithReadability, type Extracted } from "./readability.ts";
import { sanitizeDocument } from "./sanitize.ts";
import { htmlToMarkdown } from "./turndown.ts";

// L2.web.spec §4.9.3 WEB-R16. `convert`는 동기 순수 함수다: 같은 입력에 같은 출력이고, 시각·난수·I/O·네트워크를 쓰지 않는다.
// 이 디렉터리는 네트워크 import와 전역(fetch, WebSocket, Bun)을 쓰지 않는다(oxlint override와 check-layers 패턴이 막는다).

export type Extractor = "readability" | "defuddle";

export interface ConvertInput {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  /** 상대 링크를 절대 URL로 바꿀 기준 */
  readonly baseUrl: string;
  readonly extractor: Extractor;
}

interface ConvertedLink {
  readonly href: string;
  readonly text: string;
}

export type ConvertResult =
  | {
      readonly kind: "converted";
      readonly method: "readability" | "defuddle" | "plain" | "negotiated-md";
      readonly markdown: string;
      readonly title: string | undefined;
      readonly publishedAt: string | undefined;
      readonly links: readonly ConvertedLink[];
      /** `<noscript>`가 JavaScript를 요구하거나 루트 요소 하나만 있는 SPA 징후 */
      readonly spaSuspected: boolean;
    }
  | { readonly kind: "unsupported"; readonly mediaType: string };

const MAX_LINKS = 200;
const MAX_LINK_TEXT = 256;
const MARKDOWN_TYPES: ReadonlySet<string> = new Set(["text/markdown", "text/x-markdown"]);
const HTML_TYPES: ReadonlySet<string> = new Set(["text/html", "application/xhtml+xml"]);
const PLAIN_TYPES: ReadonlySet<string> = new Set(["text/plain", "application/json"]);
const PUBLISHED_META = [
  'meta[property="article:published_time"]',
  'meta[itemprop="datePublished"]',
  'meta[name="date"]',
  'meta[name="pubdate"]',
].join(",");

function mediaTypeOf(contentType: string): string {
  return (contentType.split(";")[0] ?? "").trim().toLowerCase();
}

function charsetOf(contentType: string): string {
  const match = /charset\s*=\s*"?([A-Za-z0-9_.:-]+)"?/i.exec(contentType);
  return match?.[1] ?? "utf-8";
}

/** Content-Type의 charset으로 푼다. 모르는 이름이면 UTF-8로 푼다 */
export function decodeBody(bytes: Uint8Array, contentType: string): string {
  const decoder = attempt(() => new TextDecoder(charsetOf(contentType)));
  const used = decoder.ok ? decoder.value : new TextDecoder("utf-8");
  return used.decode(bytes);
}

function absoluteLinks(root: ParentNode, baseUrl: string): ConvertedLink[] {
  const seen = new Set<string>();
  const links: ConvertedLink[] = [];
  for (const anchor of root.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    const resolved = attempt(() => new URL(href, baseUrl));
    if (!resolved.ok) continue;
    if (resolved.value.protocol !== "http:" && resolved.value.protocol !== "https:") continue;
    const absolute = resolved.value.href;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    links.push({
      href: absolute,
      text: anchor.textContent.replace(/\s+/g, " ").trim().slice(0, MAX_LINK_TEXT),
    });
    if (links.length === MAX_LINKS) break;
  }
  return links;
}

function markdownLinks(markdown: string, baseUrl: string): ConvertedLink[] {
  const links: ConvertedLink[] = [];
  const seen = new Set<string>();
  for (const match of markdown.matchAll(/\[([^\]]{0,256})\]\(([^)\s]+)[^)]*\)/g)) {
    const resolved = attempt(() => new URL(match[2] ?? "", baseUrl));
    if (!resolved.ok) continue;
    if (resolved.value.protocol !== "http:" && resolved.value.protocol !== "https:") continue;
    if (seen.has(resolved.value.href)) continue;
    seen.add(resolved.value.href);
    links.push({ href: resolved.value.href, text: (match[1] ?? "").trim() });
    if (links.length === MAX_LINKS) break;
  }
  return links;
}

function singleEmptyRoot(doc: Document): boolean {
  const body = doc.body;
  const children = [...body.children].filter((child) => child.tagName !== "SCRIPT");
  return children.length === 1 && (children[0]?.textContent ?? "").trim() === "";
}

function convertHtml(html: string, input: ConvertInput): ConvertResult {
  const doc = parseHTML(html).document;
  const publishedMeta = doc.querySelector(PUBLISHED_META)?.getAttribute("content")?.trim();
  const documentTitle = doc.title.trim();
  const report = sanitizeDocument(doc);
  const emptyRoot = singleEmptyRoot(doc);
  const extracted: Extracted | undefined =
    input.extractor === "defuddle"
      ? extractWithDefuddle(doc, input.baseUrl)
      : extractWithReadability(doc);
  let contentRoot: ParentNode;
  let markdown: string;
  if (extracted === undefined) {
    // 추출기가 본문을 못 찾으면 정리한 body 전체를 쓴다
    markdown = htmlToMarkdown(doc.body.innerHTML);
    contentRoot = doc.body;
  } else {
    markdown = htmlToMarkdown(extracted.html);
    contentRoot = parseHTML(extracted.html).document;
  }
  const title = extracted?.title ?? (documentTitle === "" ? undefined : documentTitle);
  const publishedAt =
    extracted?.publishedAt ??
    (publishedMeta === undefined || publishedMeta === "" ? undefined : publishedMeta);
  const thin = markdown.replace(/\s/g, "").length < 200;
  return {
    kind: "converted",
    method: input.extractor,
    markdown,
    title,
    publishedAt,
    links: absoluteLinks(contentRoot, input.baseUrl),
    spaSuspected: thin && (report.noscriptNeedsJavascript || emptyRoot),
  };
}

/** 서버가 Markdown으로 응답했는가(협상 Markdown). 이 경로는 파서를 거치지 않는다 */
export function isNegotiatedMarkdown(contentType: string): boolean {
  return MARKDOWN_TYPES.has(mediaTypeOf(contentType));
}

/** 협상 Markdown 통과. 본문을 그대로 쓰고 링크만 뽑는다 */
export function passMarkdown(input: Omit<ConvertInput, "extractor">): ConvertResult {
  const markdown = decodeBody(input.bytes, input.contentType);
  return {
    kind: "converted",
    method: "negotiated-md",
    markdown,
    title: undefined,
    publishedAt: undefined,
    links: markdownLinks(markdown, input.baseUrl),
    spaSuspected: false,
  };
}

export function convert(input: ConvertInput): ConvertResult {
  const mediaType = mediaTypeOf(input.contentType);
  if (MARKDOWN_TYPES.has(mediaType)) return passMarkdown(input);
  if (HTML_TYPES.has(mediaType))
    return convertHtml(decodeBody(input.bytes, input.contentType), input);
  if (PLAIN_TYPES.has(mediaType)) {
    return {
      kind: "converted",
      method: "plain",
      markdown: decodeBody(input.bytes, input.contentType),
      title: undefined,
      publishedAt: undefined,
      links: [],
      spaSuspected: false,
    };
  }
  return { kind: "unsupported", mediaType };
}

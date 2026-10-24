import { parse, type Result } from "@xeon/contracts";
import type { McpContent } from "@xeon/contracts/capabilities";
import type { JsonObject, JsonValue } from "@xeon/contracts/conversation";
import type { BlobError, BlobRef } from "@xeon/contracts/records";
import { Type } from "typebox";
import { asJsonObject, stringOf } from "../json.ts";

// L2.mcp.spec §4.5 5~6번. 서버 결과의 내용 블록을 Xeon 쪽 모양(McpContent)으로 바꾸고 크기 한도를 적용한다.
// 입력은 어댑터가 JSON으로 옮긴 블록이라 SDK 타입을 보지 않는다.

/** blob 저장 포트(`xeon.store.putBlob`의 부분형). 없으면 이미지·바이너리는 지원하지 않는 내용으로 둔다 */
export type BlobPutter = (
  bytes: Uint8Array,
  mediaType: string | null,
) => Result<BlobRef, BlobError>;

const Base64Schema = Type.String({ pattern: "^[A-Za-z0-9+/]*={0,2}$" });

function decodeBase64(data: unknown): Uint8Array | undefined {
  const parsed = parse(Base64Schema, data);
  return parsed.ok ? Uint8Array.from(Buffer.from(parsed.value, "base64")) : undefined;
}

function blobOf(
  data: unknown,
  mediaType: string | null,
  put: BlobPutter | undefined,
): BlobRef | undefined {
  if (put === undefined) return undefined;
  const bytes = decodeBase64(data);
  if (bytes === undefined) return undefined;
  const stored = put(bytes, mediaType);
  return stored.ok ? stored.value : undefined;
}

function resourceContent(value: JsonValue, put: BlobPutter | undefined): McpContent {
  const resource = asJsonObject(value);
  const uri = stringOf(resource?.["uri"]);
  if (resource === undefined || uri === undefined)
    return { type: "unsupported", originalType: "resource" };
  const mimeType = stringOf(resource["mimeType"]);
  const text = stringOf(resource["text"]);
  const base = { type: "resource" as const, uri, ...(mimeType === undefined ? {} : { mimeType }) };
  if (text !== undefined) return { ...base, text };
  const blob = blobOf(resource["blob"], mimeType ?? null, put);
  return blob === undefined ? base : { ...base, blob };
}

/** 서버가 준 내용 블록 하나를 바꾼다. 모르는 종류는 `unsupported`다 */
function textBlock(object: JsonObject): McpContent {
  const text = stringOf(object["text"]);
  return text === undefined
    ? { type: "unsupported", originalType: "text" }
    : { type: "text", text };
}

function imageBlock(object: JsonObject, put: BlobPutter | undefined): McpContent {
  const mimeType = stringOf(object["mimeType"]) ?? "application/octet-stream";
  const blob = blobOf(object["data"], mimeType, put);
  return blob === undefined
    ? { type: "unsupported", originalType: "image" }
    : { type: "image", blob, mimeType };
}

function resourceLinkBlock(object: JsonObject): McpContent {
  const uri = stringOf(object["uri"]);
  if (uri === undefined) return { type: "unsupported", originalType: "resource_link" };
  const name = stringOf(object["name"]);
  const mimeType = stringOf(object["mimeType"]);
  return {
    type: "resource_link",
    uri,
    ...(name === undefined ? {} : { name }),
    ...(mimeType === undefined ? {} : { mimeType }),
  };
}

/** 서버가 준 내용 블록 하나를 바꾼다. 모르는 종류는 `unsupported`다 */
export function convertBlock(block: JsonValue, put: BlobPutter | undefined): McpContent {
  const object = asJsonObject(block);
  const type = stringOf(object?.["type"]);
  if (object === undefined || type === undefined) {
    return { type: "unsupported", originalType: "unknown" };
  }
  if (type === "text") return textBlock(object);
  if (type === "image") return imageBlock(object, put);
  if (type === "resource_link") return resourceLinkBlock(object);
  if (type === "resource") return resourceContent(object["resource"] ?? null, put);
  return { type: "unsupported", originalType: type };
}

export function convertBlocks(
  blocks: readonly JsonValue[],
  put: BlobPutter | undefined,
): McpContent[] {
  return blocks.map((block) => convertBlock(block, put));
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

/** UTF-8 경계를 깨지 않고 앞에서 maxBytes까지 남긴다 */
function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  // 연속 바이트(10xxxxxx)에서 멈췄으면 문자 시작까지 물러난다
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return decoder.decode(bytes.subarray(0, end));
}

function textBytes(content: McpContent): number {
  if (content.type === "text") return encoder.encode(content.text).length;
  if (content.type === "resource" && content.text !== undefined) {
    return encoder.encode(content.text).length;
  }
  return 0;
}

export interface LimitedContent {
  readonly content: McpContent[];
  readonly truncated: { readonly shownBytes: number; readonly totalBytes: number } | undefined;
}

/**
 * 텍스트 합이 `maxBytes`를 넘으면 앞부분만 남긴다(§4.5 6번). 한도를 넘은 뒤의 텍스트 블록은 버리고 이미지 같은
 * 비텍스트 블록은 남긴다. L1.tools 결과 경계화가 그 뒤에 한 번 더 적용된다.
 */
export function limitContent(content: readonly McpContent[], maxBytes: number): LimitedContent {
  const total = content.reduce((sum, block) => sum + textBytes(block), 0);
  if (total <= maxBytes) return { content: [...content], truncated: undefined };
  const kept: McpContent[] = [];
  let used = 0;
  for (const block of content) {
    const size = textBytes(block);
    if (size === 0) {
      kept.push(block);
      continue;
    }
    const remaining = maxBytes - used;
    if (remaining <= 0) continue;
    if (size <= remaining) {
      kept.push(block);
      used += size;
      continue;
    }
    if (block.type === "text")
      kept.push({ type: "text", text: truncateUtf8(block.text, remaining) });
    else if (block.type === "resource" && block.text !== undefined) {
      kept.push({ ...block, text: truncateUtf8(block.text, remaining) });
    }
    used = maxBytes;
  }
  return { content: kept, truncated: { shownBytes: Math.min(used, maxBytes), totalBytes: total } };
}

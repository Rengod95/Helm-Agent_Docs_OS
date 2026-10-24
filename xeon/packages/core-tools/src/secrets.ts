import type { RedactionHit } from "@xeon/contracts/capabilities";
import type { ImageContent, JsonValue, TextContent } from "@xeon/contracts/conversation";
import type { Redactor } from "@xeon/contracts/services";
import type { RawToolResult } from "./types.ts";

// L1.tools.spec §4.12 도구 결과 2계층 마스킹(tool-result 층). 값, 값의 일부, 값의 해시를 어디에도 남기지 않는다.

export interface MaskedResult {
  readonly result: RawToolResult;
  readonly hits: readonly RedactionHit[];
}

/** content 텍스트, details, structuredContent, 오류 문장을 모두 가린다. 이미지 파트는 건드리지 않는다 */
export function maskResult(redactor: Redactor, result: RawToolResult): MaskedResult {
  const hits: RedactionHit[] = [];
  const content: (TextContent | ImageContent)[] = result.content.map((part) => {
    if (part.type !== "text") return part;
    const masked = redactor.mask(part.text);
    hits.push(...masked.hits);
    return { ...part, text: masked.text };
  });
  let details: unknown = result.details;
  if (details !== undefined && details !== null) {
    const masked = redactor.maskDeep(details);
    details = masked.value;
    hits.push(...masked.hits);
  }
  let structured: JsonValue | undefined = result.structuredContent;
  if (structured !== undefined) {
    const masked = redactor.maskDeep(structured);
    structured = masked.value;
    hits.push(...masked.hits);
  }
  return {
    result: {
      ...result,
      content,
      details,
      ...(structured === undefined ? {} : { structuredContent: structured }),
    },
    hits,
  };
}

/** kind별 횟수로 합친다 */
export function addHits(into: Map<string, number>, hits: readonly RedactionHit[]): void {
  for (const hit of hits) into.set(hit.kind, (into.get(hit.kind) ?? 0) + hit.count);
}

/** secret.masked payload의 hits. 최대 64종 */
export function hitsPayload(
  counts: ReadonlyMap<string, number>,
): { kind: string; count: number }[] {
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .slice(0, 64)
    .map(([kind, count]) => ({ kind, count }));
}

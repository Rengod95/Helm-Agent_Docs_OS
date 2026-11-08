import { parse } from "@fresnel/contracts";
import { SandboxBlockSchema, type SandboxBlock } from "@fresnel/contracts/capabilities";
import type { JsonObject, JsonValue, TextContent } from "@fresnel/contracts/conversation";
import { isJsonObject } from "./util.ts";

// L1.tools.spec §4.12.3. 샌드박스가 막은 것을 도구 결과에 싣는다.
// 모델에 가는 글은 영어 줄이고(엔진 문자열은 로케일을 따르지 않는다), 화면용 details는 code와 대상을 싣는다.

/** 글에 나열하는 대상 수. 넘는 것은 "(and N more)"로 줄인다 */
const LIST_LIMIT = 5;

/** 결과 구조(structuredContent 또는 오류 detail)의 `sandboxBlocks`를 읽는다. 없거나 모양이 틀린 항목은 버린다 */
export function sandboxBlocksOf(value: JsonValue | undefined): readonly SandboxBlock[] {
  if (!isJsonObject(value)) return [];
  const raw = value["sandboxBlocks"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: JsonValue) => {
    const checked = parse(SandboxBlockSchema, item);
    return checked.ok ? [checked.value] : [];
  });
}

function listOf(items: readonly string[]): string {
  const shown = items.slice(0, LIST_LIMIT).join(", ");
  const rest = items.length - LIST_LIMIT;
  return rest > 0 ? `${shown} (and ${rest} more)` : shown;
}

/** 막은 종류마다 영어 한 줄. 막은 것이 없으면 빈 목록이다 */
export function sandboxBlockLines(blocks: readonly SandboxBlock[]): readonly string[] {
  const domains = new Set(
    blocks.flatMap((block) => (block.code === "sandbox.network_blocked" ? [block.domain] : [])),
  );
  const writes = new Set(
    blocks.flatMap((block) => (block.code === "sandbox.write_blocked" ? [block.path] : [])),
  );
  const reads = new Set(
    blocks.flatMap((block) => (block.code === "sandbox.read_blocked" ? [block.path] : [])),
  );
  const lines: string[] = [];
  if (domains.size > 0) {
    const verb = domains.size === 1 ? "is" : "are";
    lines.push(`Blocked by network policy: ${listOf([...domains])} ${verb} in blockedDomains.`);
  }
  if (writes.size > 0) {
    lines.push(
      `Blocked by sandbox: writing outside the workspace or to a protected path is not allowed: ${listOf([...writes])}`,
    );
  }
  if (reads.size > 0) {
    lines.push(
      `Blocked by sandbox: reading a protected path is not allowed: ${listOf([...reads])}`,
    );
  }
  return lines;
}

/** 모델 글에 붙이는 본문 조각. 막은 것이 없으면 없다 */
export function sandboxBlockContent(blocks: readonly SandboxBlock[]): TextContent | undefined {
  const lines = sandboxBlockLines(blocks);
  return lines.length === 0 ? undefined : { type: "text", text: lines.join("\n") };
}

function blockJson(block: SandboxBlock): JsonObject {
  return block.code === "sandbox.network_blocked"
    ? { code: block.code, domain: block.domain }
    : { code: block.code, path: block.path };
}

/**
 * 화면용 details. `code`는 첫 번째 막은 것의 종류이고, 그 대상을 `domain`이나 `path`로 싣는다.
 * 모든 막은 것은 `blocks`에 있다. 막은 것이 없으면 undefined다.
 */
export function sandboxBlockDetails(blocks: readonly SandboxBlock[]): JsonObject | undefined {
  const [first] = blocks;
  if (first === undefined) return undefined;
  return {
    code: first.code,
    ...(first.code === "sandbox.network_blocked" ? { domain: first.domain } : { path: first.path }),
    blocks: blocks.map(blockJson),
  };
}

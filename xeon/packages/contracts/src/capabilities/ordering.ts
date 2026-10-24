import { Bug, canonicalJson } from "../base/index.ts";
import type { AnyCapabilityDef } from "./capability.ts";
import type { OrderedTool, ToolRef, ToolReference, ToolWire } from "./tool-spec.ts";
import { toJsonSchema } from "./validate.ts";

/** 한 도구 집합의 최대 도구 수. 거부는 L1.tools가 한다. F는 상수만 둔다. */
export const MAX_TOOLS_PER_REQUEST: number = 128;

function compareBytes(a: string, b: string): -1 | 0 | 1 {
  // 도구 이름과 능력 ID는 ASCII로 제한되므로 코드 단위 비교는 UTF-8 바이트 순과 같다. localeCompare는 쓰지 않는다.
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 도구 순서 비교 함수. 능력 ID, 그다음 도구 name을 바이트 순으로 비교한다 */
export function toolOrderKey(a: ToolRef, b: ToolRef): -1 | 0 | 1 {
  const byCapability = compareBytes(a.capability, b.capability);
  return byCapability !== 0 ? byCapability : compareBytes(a.name, b.name);
}

/**
 * 정의 집합에서 모델에게 광고할 도구 목록을 만든다. 입력 순서와 무관하게 같은 결과를 낸다.
 * 같은 (capability, name)이 두 번 나오면 Bug다. validateCapabilitySet으로 먼저 걸러야 한다.
 */
export function orderTools(defs: readonly AnyCapabilityDef[]): readonly OrderedTool[] {
  const tools: OrderedTool[] = [];
  for (const def of defs) {
    for (const tool of def.tools) {
      tools.push({
        capability: def.id,
        name: tool.name,
        wire: { name: tool.name, description: tool.description, parameters: tool.parameters },
      });
    }
  }
  tools.sort(toolOrderKey);
  for (let i = 1; i < tools.length; i += 1) {
    const prev = tools[i - 1];
    const current = tools[i];
    if (prev !== undefined && current !== undefined && toolOrderKey(prev, current) === 0) {
      throw new Bug(`orderTools: duplicate tool ${current.capability}/${current.name}`);
    }
  }
  return tools;
}

/** 모델에게 보이는 부분만 늘어놓는다. label, hints, replay, version은 포함하지 않는다. */
function exposure(tool: OrderedTool): { name: string; description: string; parameters: unknown } {
  return {
    name: tool.wire.name,
    description: tool.wire.description,
    parameters: toJsonSchema(tool.wire.parameters),
  };
}

/** fingerprint 입력 문자열. 키 정렬 JSON(공백 없음). 테스트와 디버깅용으로 공개한다 */
export function canonicalToolset(tools: readonly OrderedTool[]): string {
  return canonicalJson(tools.map(exposure));
}

export type ToolsetFingerprint = `sha256:${string}`;

/** canonicalToolset의 SHA-256. Web Crypto(globalThis.crypto.subtle)를 쓴다 */
export async function toolsetFingerprint(
  tools: readonly OrderedTool[],
): Promise<ToolsetFingerprint> {
  const bytes = new TextEncoder().encode(canonicalToolset(tools));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

export interface ToolsetDiff {
  /** 새로 광고할 도구. toolOrderKey 순 */
  readonly added: readonly ToolWire[];
  /** 광고를 멈출 도구 */
  readonly removed: readonly ToolReference[];
  /** prev와 next를 정렬 목록으로 비교했을 때 처음 달라지는 위치. 같으면 null */
  readonly firstChangedIndex: number | null;
}

function sameTool(a: OrderedTool, b: OrderedTool): boolean {
  return toolOrderKey(a, b) === 0 && canonicalJson(exposure(a)) === canonicalJson(exposure(b));
}

/** 두 도구 집합의 차이. 같은 name에 정의가 바뀐 도구는 added에만 넣는다(재정의) */
export function diffToolsets(
  prev: readonly OrderedTool[],
  next: readonly OrderedTool[],
): ToolsetDiff {
  const prevByName = new Map<string, string>();
  for (const tool of prev) prevByName.set(tool.name, canonicalJson(exposure(tool)));
  const nextNames = new Set<string>();
  const added: ToolWire[] = [];
  for (const tool of next) {
    nextNames.add(tool.name);
    if (prevByName.get(tool.name) !== canonicalJson(exposure(tool))) added.push(tool.wire);
  }
  const removed: ToolReference[] = [];
  for (const tool of prev) if (!nextNames.has(tool.name)) removed.push({ name: tool.name });

  let firstChangedIndex: number | null = null;
  const shared = Math.min(prev.length, next.length);
  for (let i = 0; i < shared; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (a === undefined || b === undefined || !sameTool(a, b)) {
      firstChangedIndex = i;
      break;
    }
  }
  if (firstChangedIndex === null && prev.length !== next.length) firstChangedIndex = shared;
  return { added, removed, firstChangedIndex };
}

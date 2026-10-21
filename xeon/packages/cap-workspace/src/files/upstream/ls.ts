// XEON-PATCH: P7
import type { CancelScope as Context, ExecutionEnv, FileKind } from "@xeon/contracts/services";
// XEON-PATCH: P2
import { getOrThrow } from "../../upstream/get-or-throw.ts";
// XEON-PATCH: P2
import { DEFAULT_MAX_BYTES, utf8ByteLength } from "../../truncate/upstream/truncate.ts";

// XEON-PATCH: P7
/**
 * 원본 `createLsToolDefinition`의 본문에서 도구 껍데기(`ToolDefinition`, 렌더러, `LsOperations`)를 걷어 냈다.
 * 파일 접근은 모두 `ExecutionEnv`(`listDir`)이고, 정렬은 코드 단위가 아니라 UTF-8 바이트 순이다(`localeCompare` 제거).
 */

interface ListedEntry {
  readonly name: string;
  readonly kind: FileKind;
}

export interface ListResult {
  /** 이름 바이트 순. 점 파일 포함. 항목 수 한도와 바이트 한도 안의 앞부분 */
  readonly entries: readonly ListedEntry[];
  /** 한도에 걸렸을 때 어느 쪽인가. 걸리지 않았으면 undefined */
  readonly cutBy?: "entries" | "bytes";
  /** 디렉터리 항목 전체 수 */
  readonly total: number;
}

const encoder = new TextEncoder();

// XEON-PATCH: P7
/** UTF-8 바이트 순 비교 */
function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const common = Math.min(left.length, right.length);
  for (let index = 0; index < common; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

/** 목록에서 한 줄로 보이는 모양. 디렉터리는 끝에 `/`다(`renderList`와 같다) */
function displayName(entry: ListedEntry): string {
  return entry.kind === "directory" ? `${entry.name}/` : entry.name;
}

// XEON-PATCH: P7
export async function listDirectory(
  env: Pick<ExecutionEnv, "listDir">,
  absolutePath: string,
  limit: number,
  context: Context,
): Promise<ListResult> {
  const infos = getOrThrow(await env.listDir(absolutePath, context));
  const sorted = infos
    .map((info) => ({
      entry: { name: info.name, kind: info.kind },
      key: encoder.encode(info.name),
    }))
    .toSorted((a, b) => compareBytes(a.key, b.key))
    .map((keyed): ListedEntry => keyed.entry);
  const limited = sorted.slice(0, limit);
  // Apply byte truncation. There is no separate line limit because entry count is already capped.
  const shown: ListedEntry[] = [];
  let bytes = 0;
  let cutBy: "entries" | "bytes" | undefined = sorted.length > limit ? "entries" : undefined;
  for (const entry of limited) {
    const lineBytes = utf8ByteLength(displayName(entry)) + (shown.length > 0 ? 1 : 0);
    if (bytes + lineBytes > DEFAULT_MAX_BYTES) {
      cutBy = "bytes";
      break;
    }
    bytes += lineBytes;
    shown.push(entry);
  }
  return { entries: shown, ...(cutBy === undefined ? {} : { cutBy }), total: sorted.length };
}

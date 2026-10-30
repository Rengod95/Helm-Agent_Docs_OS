import type { TruncationInfo } from "@xeon/contracts/capabilities";
import type { ReadSlice } from "../files/upstream/read.ts";

// L2.workspace.spec §4.5. `read`의 이어 읽기 계산(offset, nextOffset, TruncationInfo 조립)만 둔다.
// 절단 함수 자체는 platform-exec가 소유하고 xeon.exec(ExecService)로 부른다(review.decisions-2 D-08, B-04).

/** `ReadOutput`의 text 변형에서 `kind`를 뺀 값 */
export interface ReadPage {
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
  readonly truncated?: TruncationInfo;
}

/**
 * 읽은 구간을 도구 결과로 바꾼다. 끝까지 읽지 못했으면(남은 줄이 있거나 첫 줄이 잘렸으면) `truncated`를 싣고
 * `nextOffset`은 항상 `endLine + 1`이다. 다시 그 값으로 읽으면 이어지는 줄부터 나온다.
 */
export function pageRead(slice: ReadSlice): ReadPage {
  const endLine =
    slice.shownLines === 0 ? slice.startLine - 1 : slice.startLine + slice.shownLines - 1;
  const incomplete = slice.firstLineCut || endLine < slice.fileLines;
  const base = {
    text: slice.text,
    startLine: slice.startLine,
    endLine,
    totalLines: slice.fileLines,
  };
  if (!incomplete) return base;
  return {
    ...base,
    truncated: {
      by: slice.cutBy ?? "lines",
      shown: slice.shownLines,
      total: slice.fileLines,
      nextOffset: endLine + 1,
    },
  };
}

/** 항목 수 한도(ls, grep, find)의 절단 정보. 끝까지 센 항목 수를 `total`로 싣는다 */
export function pageEntries(
  by: "entries" | "bytes",
  shown: number,
  total: number | undefined,
): TruncationInfo {
  return { by, shown, ...(total === undefined ? {} : { total }) };
}

export interface CappedEntries<T> {
  /** 앞에서부터 남긴 항목 */
  readonly kept: readonly T[];
  /** 먼저 걸린 한도. 자르지 않았으면 undefined */
  readonly cutBy: "entries" | "bytes" | undefined;
  /** 세는 항목 전체 수(`counts`가 참인 항목) */
  readonly total: number;
  /** 남긴 항목 가운데 세는 항목 수 */
  readonly shown: number;
}

/**
 * 항목을 앞에서부터 남긴다. 세는 항목(`counts`)이 `limit`개를 넘으면 `entries`, 남긴 바이트 합이 `maxBytes`를 넘으면
 * `bytes`로 자른다. 세지 않는 항목(문맥 줄 등)은 한도를 세지 않지만 바이트는 센다.
 */
export function capEntries<T>(
  items: readonly T[],
  options: {
    readonly limit: number;
    readonly maxBytes: number;
    readonly counts: (item: T) => boolean;
    readonly bytesOf: (item: T) => number;
  },
): CappedEntries<T> {
  const kept: T[] = [];
  let counted = 0;
  let bytes = 0;
  let cutBy: "entries" | "bytes" | undefined;
  for (const item of items) {
    const isCounted = options.counts(item);
    if (isCounted && counted === options.limit) {
      cutBy = "entries";
      break;
    }
    const size = options.bytesOf(item);
    if (bytes + size > options.maxBytes) {
      cutBy = "bytes";
      break;
    }
    bytes += size;
    if (isCounted) counted++;
    kept.push(item);
  }
  return {
    kept,
    cutBy,
    total: items.filter(options.counts).length,
    shown: counted,
  };
}

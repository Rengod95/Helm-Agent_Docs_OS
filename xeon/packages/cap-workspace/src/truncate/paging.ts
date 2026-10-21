import type { TruncationInfo } from "@xeon/contracts/capabilities";
import type { ReadSlice } from "../files/upstream/read.ts";

// L2.workspace.spec §4.5. `read`의 이어 읽기 계산(offset, nextOffset, TruncationInfo 조립)만 둔다.
// 절단 함수 자체는 truncate/upstream/truncate.ts에 있다(plan §7 대체 위치, review.decisions-2 D-08 미결).

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

/** 항목 수 한도(ls, 2차 grep·find)의 절단 정보. 끝까지 센 항목 수를 `total`로 싣는다 */
export function pageEntries(
  by: "entries" | "bytes",
  shown: number,
  total: number | undefined,
): TruncationInfo {
  return { by, shown, ...(total === undefined ? {} : { total }) };
}

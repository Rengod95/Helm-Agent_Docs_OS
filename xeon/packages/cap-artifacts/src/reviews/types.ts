// L2.artifacts.spec §4.2. 리뷰가 다루는 diff의 순수 모양. 해석·정규화·되돌림·전달 문안 모듈이 함께 쓴다.

export type FileChangeKind = "added" | "modified" | "deleted" | "renamed";

/** 통합 diff의 hunk 하나. `lines`는 접두(` `, `+`, `-`, `\`)가 붙은 본문 줄이고 줄바꿈은 없다 */
export interface DiffHunk {
  /** `@@ -a,b +c,d @@ …` 줄 전체 */
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly string[];
}

/** 파일 블록 하나. `path`는 `b/` 접두를 뗀 경로(삭제면 `a/` 접두를 뗀 경로)이고 `oldPath`는 새 파일이면 null이다 */
export interface DiffFile {
  readonly path: string;
  readonly oldPath: string | null;
  readonly change: FileChangeKind;
  readonly binary: boolean;
  readonly hunks: readonly DiffHunk[];
}

/** 정규화한 hunk. `hunkId`는 `f<파일 순번>h<hunk 순번>`이고 `patchSha256`은 hunk 본문(헤더 줄과 본문 줄을 `\n`으로 이은 바이트)의 해시다 */
export interface ReviewHunk extends DiffHunk {
  readonly hunkId: string;
  readonly patchSha256: string;
}

export interface ReviewFile {
  readonly fileIndex: number;
  readonly path: string;
  readonly oldPath: string | null;
  readonly change: FileChangeKind;
  readonly binary: boolean;
  readonly hunks: readonly ReviewHunk[];
}

export type DiffParseError = { readonly kind: "diff_unparsable"; readonly line: number };
export type ReviewTooLarge = { readonly kind: "review_too_large" };

export type HunkDecision = "pending" | "approved" | "rejected";
export type HunkApplied = "none" | "reverted" | "conflict";

/** 제출 때 에이전트에 보내는 글의 재료 */
export interface DeliveryInput {
  readonly reviewId: string;
  readonly round: number;
  readonly files: readonly {
    readonly path: string;
    readonly hunks: readonly {
      readonly hunkId: string;
      readonly decision: HunkDecision;
      readonly applied: HunkApplied;
    }[];
  }[];
  readonly comments: readonly {
    readonly target:
      | {
          readonly type: "hunk";
          readonly hunkId: string;
          readonly line?: { readonly side: "old" | "new"; readonly number: number };
        }
      | { readonly type: "file"; readonly path: string }
      | { readonly type: "review" };
    readonly body: string;
  }[];
}

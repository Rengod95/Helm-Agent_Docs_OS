import type { Result } from "../base/index.ts";
import type { EventId, ItemId, ThreadId, TurnId } from "../conversation/index.ts";
import type { PortKey } from "../extensions/index.ts";
import type {
  RewindFileResult,
  RewindId,
  RewindScope,
  UnrestorableReason,
} from "../records/index.ts";

// 파일 되감기 서비스(design.md "서비스" 절, F.wire-settings.spec §3.3.1 파일 되감기 메서드, L2.workspace.spec §4.8).
// 구현은 cap-workspace다. 호스트는 `FileRewindPortKey`로 포트를 받아 `thread.rewind*`·`thread.turnFiles` 처리기에서 부른다.
// 대화 쪽 되감기(leaf 이동)는 호스트가 `thread.revert`와 같은 경로로 한다. 이 서비스는 파일만 다룬다.
// `capture`(편집 도구가 쓰기 전에 원본을 저장하는 일)는 cap-workspace 안쪽 함수라 여기 두지 않는다.
// 파일 내용은 이 타입 어디에도 싣지 않는다. 경로와 해시, 크기, 상태 사유만 싣는다.

/** 포트 키 이름은 `fresnel.file-rewind`다. 제공 cap-workspace(`host.provide`), 소비 호스트(`ext.ports.get`). */
export const FileRewindPortKey: PortKey<FileRewindService> = { name: "fresnel.file-rewind" };

export type FileRewindError =
  | { readonly kind: "thread_not_found"; readonly threadId: ThreadId }
  | { readonly kind: "target_not_found"; readonly to: ItemId }
  | { readonly kind: "target_not_on_branch"; readonly to: ItemId }
  | { readonly kind: "rewind_not_found"; readonly rewindId: RewindId }
  | { readonly kind: "store_failed"; readonly cause: string }
  | { readonly kind: "cancelled" };

/** 미리보기에서 파일이 어떻게 되는지. keep은 밖에서 바뀌어 건드리지 않는다, skip은 복원할 원본이 없다 */
export type RewindPreviewAction = "restore" | "delete" | "keep" | "skip";

export type RewindPreviewReason =
  | "changed_outside"
  | "deleted_outside"
  | "too_large"
  | "quota"
  | "unreadable"
  | "already_original";

export interface RewindPreviewFile {
  readonly path: string;
  readonly action: RewindPreviewAction;
  readonly reason: RewindPreviewReason | null;
  readonly turnId: TurnId;
}

/** 범위 안의 턴에서 한 추적 밖 효과. 셸 명령(`bash`)과 서브에이전트 생성(`agent.spawned`)이다 */
export interface UntrackedEffect {
  readonly turnId: TurnId;
  readonly kind: "shell" | "agent";
  readonly toolCallId: string | null;
}

/** 시작만 있고 적용이 없는 되감기(반만 되돌린 상태) */
export interface IncompleteRewind {
  readonly rewindId: RewindId;
  readonly scope: RewindScope;
  readonly targetItemId: ItemId;
  readonly targetEventId: EventId;
}

export interface RewindPreview {
  readonly toEventId: EventId;
  readonly files: readonly RewindPreviewFile[];
  readonly untracked: readonly UntrackedEffect[];
  readonly incomplete: readonly IncompleteRewind[];
}

/** 밖에서 바뀌어 건드리지 않은 파일. 덮어쓰기 대상으로 다시 고를 수 있다 */
export interface KeptFile {
  readonly path: string;
  readonly reason: "changed_outside" | "deleted_outside";
}

export interface RewindApplyInput {
  readonly threadId: ThreadId;
  readonly to: ItemId;
  readonly scope: RewindScope;
  /** 밖에서 바뀌었어도 덮어쓰기로 고른 경로 */
  readonly overwrite: readonly string[];
  readonly rewindId: RewindId;
  /** 되감기 직전 leaf. 되돌리기에서 대화를 되돌릴 때 쓴다 */
  readonly oldLeafEventId: EventId | null;
}

/** apply와 overwrite가 같이 돌려준다. overwrite 뒤의 되감기 상태다 */
export interface RewindApplyResult {
  readonly rewindId: RewindId;
  readonly files: readonly RewindFileResult[];
  readonly kept: readonly KeptFile[];
  readonly untracked: readonly UntrackedEffect[];
}

/** 대화 쪽 상태(conversation)는 호스트가 leaf를 보고 붙인다. 이 결과는 파일만 담는다 */
export interface RewindUndoResult {
  readonly rewindId: RewindId;
  readonly files: readonly RewindFileResult[];
}

export interface TurnFile {
  readonly path: string;
  /** 턴 시작 때 파일이 있었는지. 원본이 저장되지 않았으면 null이다 */
  readonly existedBefore: boolean | null;
  readonly restorable: boolean;
  readonly unrestorableReason: UnrestorableReason | null;
  /** 이 턴에서 그 경로를 쓴 횟수 */
  readonly touches: number;
}

export interface TurnFiles {
  readonly turnId: TurnId;
  readonly files: readonly TurnFile[];
}

/** 턴마다 만진 파일. 활성 가지 전체 또는 한 턴이다 */
export interface TurnFilesView {
  readonly turns: readonly TurnFiles[];
}

/** 파일 되감기 서비스 전체 모양. 구현 cap-workspace */
export interface FileRewindService {
  /** 되감기 미리보기. `to` 뒤의 `workspace.files_captured`만 범위다(활성 가지에서) */
  preview(input: {
    readonly threadId: ThreadId;
    readonly to: ItemId;
  }): Promise<Result<RewindPreview, FileRewindError>>;
  /** 되감기 시작 커밋, 파일 쓰기, 적용 커밋을 한다. 실패하면 시작만 남아 `incomplete`로 보인다 */
  apply(input: RewindApplyInput): Promise<Result<RewindApplyResult, FileRewindError>>;
  /** 밖에서 바뀐 파일을 사용자가 덮어쓰기로 고른 뒤 그 경로만 복원한다 */
  overwrite(input: {
    readonly threadId: ThreadId;
    readonly rewindId: RewindId;
    readonly paths: readonly string[];
  }): Promise<Result<RewindApplyResult, FileRewindError>>;
  /** 되감기로 바뀐 파일을 되돌린다. 현재 내용이 되감기가 쓴 내용과 같은 파일만 건드린다 */
  undoFiles(input: {
    readonly threadId: ThreadId;
    readonly rewindId: RewindId;
  }): Promise<Result<RewindUndoResult, FileRewindError>>;
  /** 턴마다 만진 파일. `turnId`가 null이면 활성 가지 전체다 */
  turnFiles(input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId | null;
  }): Promise<Result<TurnFilesView, FileRewindError>>;
  /** 시작만 있고 적용이 없는 되감기를 돌려준다 */
  incomplete(input: {
    readonly threadId: ThreadId;
  }): Promise<Result<readonly IncompleteRewind[], FileRewindError>>;
}

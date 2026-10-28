// src/state/engine/diagnostics.ts
import type { JournalEntry } from "../shared/journal.ts";
import type { ApplyNote } from "./reduce.ts";
import type { EngineMirror } from "./state.ts";

export type AppVersions = { readonly app: string; readonly engine: string | null };

/** JSON으로 직렬화되는 고정 필드만 가진다. 대화 내용, 경로, 설정 값, 도구 인자는 들어가지 않는다(FS-13) */
export type Diagnostics = {
  readonly engine: string | null;
  readonly link: string;
  readonly linkReason: string | null;
  readonly cursorSeq: number | null;
  readonly sizes: {
    readonly threads: number;
    readonly transcriptItems: number;
    readonly streamingItems: number;
    readonly approvals: number;
  };
  readonly versions: AppVersions;
  readonly journal: readonly JournalEntry<ApplyNote>[];
};

/** 진단 내보내기 묶음. state나 engine을 통째로 펼치지 않고 고른 필드만 복사한다 */
export function buildDiagnostics(
  state: EngineMirror,
  journal: readonly JournalEntry<ApplyNote>[],
  versions: AppVersions,
): Diagnostics {
  const link = state.link;
  const linkReason =
    link.phase === "resync" || link.phase === "reset" || link.phase === "failed"
      ? link.reason
      : null;
  return {
    engine: state.engine?.kind ?? null,
    link: link.phase,
    linkReason,
    cursorSeq: state.cursor?.seq ?? null,
    sizes: {
      threads: state.threads.ids.length,
      transcriptItems: state.transcript?.status === "ready" ? state.transcript.itemIds.length : 0,
      streamingItems: state.streaming.itemIds.length,
      approvals: state.approvals.ids.length,
    },
    versions,
    journal,
  };
}

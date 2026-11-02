// caustic 빈틈 C-08(hunk 단위 diff 검토): CodeDiff는 diff 하나에 Reject/Accept 하나라 hunk 머리, hunk별 결정, 줄 의견이 없다.
// 그래서 caustic CodeDiffLine(줄 번호·기호·색)과 codeDiffVariants(카드 겉모양)를 그대로 쓰고, 그 위에 hunk 머리
// (헤더 줄, 결정 배지, 승인·거절·의견)와 줄 사이 의견 칸만 이 폴더에서 짠다.
// caustic에 넣을 때의 모양 제안: <CodeDiff> 안 <CodeDiffHunk header decision onDecide> 와 줄 다음 <CodeDiffComment>.
// 줄 몸통은 <pre>라 블록 요소(의견 칸)를 끼울 수 없어, 의견 자리에서 <pre>를 나눈다.
import { Button, CodeDiffLine, codeDiffVariants, Textarea } from "@caustic/react";
import { Fragment, type ReactNode } from "react";
import type { Comment, Hunk, HunkDecision, Line } from "../fixtures";

const DECISION_WORD: Record<HunkDecision, string> = {
  pending: "대기",
  approved: "승인함",
  rejected: "거절함",
};

function Lines({ lines, dim }: { lines: Line[]; dim: boolean }) {
  if (lines.length === 0) return null;
  return (
    <pre className={`m-0 overflow-x-auto py-1 ${dim ? "opacity-55" : ""}`}>
      {lines.map((l, i) => (
        <CodeDiffLine
          key={i}
          kind={l.kind}
          number={l.n}
          aria-label={`${l.kind === "add" ? "추가된" : l.kind === "remove" ? "지운" : ""} 줄 ${l.n}`}
        >
          {l.text}
        </CodeDiffLine>
      ))}
    </pre>
  );
}

export function CommentBox({
  comment,
  editing,
  onEdit,
  onDone,
}: {
  comment: Comment | null;
  editing: boolean;
  onEdit?: () => void;
  onDone?: () => void;
}) {
  // 줄 번호 열(34px) + 기호 열(16px)만큼 들여 의견이 그 줄에 붙어 보이게 한다.
  return (
    <div className="ms-12.5 me-3 my-1.5 grid gap-1.5 font-ui">
      {editing ? (
        <>
          <Textarea
            size="sm"
            rows={2}
            autoFocus
            aria-label="의견"
            defaultValue={comment?.text ?? ""}
            placeholder="이 줄에 남길 의견"
          />
          <div className="flex justify-end gap-1">
            <Button size="xs" tone="neutral" variant="ghost" onClick={onDone}>
              취소
            </Button>
            <Button size="xs" tone="neutral" variant="solid" onClick={onDone}>
              의견 남기기
            </Button>
          </div>
        </>
      ) : (
        comment !== null && (
          <div className="flex min-w-0 items-start gap-2 rounded-lg bg-neutral-track px-2.5 py-1.5">
            <p className="m-0 min-w-0 flex-1 text-ui-sm text-text-primary">{comment.text}</p>
            <Button size="xs" tone="neutral" variant="ghost" onClick={onEdit}>
              고치기
            </Button>
            <Button size="xs" tone="neutral" variant="ghost">
              지우기
            </Button>
          </div>
        )
      )}
    </div>
  );
}

export interface HunkReviewProps {
  hunk: Hunk;
  decision: HunkDecision;
  onDecide: (d: HunkDecision) => void;
  comments: Comment[];
  /** 이 hunk에서 지금 쓰고 있는 의견(줄 번호, 없으면 hunk 의견) */
  draftAt?: number | "hunk" | undefined;
  onComment: () => void;
  onDraftDone: () => void;
  locked?: boolean;
  /** 지난 라운드에서 전달된 의견(접힌 줄) */
  delivered?: ReactNode;
}

export function HunkReview({
  hunk,
  decision,
  onDecide,
  comments,
  draftAt,
  onComment,
  onDraftDone,
  locked = false,
  delivered,
}: HunkReviewProps) {
  // 의견이 붙는 줄 번호에서 줄 목록을 나눈다.
  const anchors = new Set<number>(
    comments.flatMap((c) => (c.afterLine !== undefined ? [c.afterLine] : [])),
  );
  if (typeof draftAt === "number") anchors.add(draftAt);
  const segments: { lines: Line[]; after?: number }[] = [];
  let cur: Line[] = [];
  for (const l of hunk.lines) {
    cur.push(l);
    if (l.kind !== "remove" && anchors.has(l.n)) {
      segments.push({ lines: cur, after: l.n });
      cur = [];
    }
  }
  segments.push({ lines: cur });

  return (
    <article
      aria-label={`${hunk.header}, ${DECISION_WORD[decision]}`}
      className={codeDiffVariants({ variant: "outline", size: "md", className: "rounded-xl" })}
    >
      <div className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-subtle bg-surface-raised py-1 ps-3 pe-1.5 font-ui">
        <h3 className="m-0 min-w-0 flex-1 truncate font-mono text-mono-sm font-normal text-text-secondary">
          {hunk.header}
        </h3>
        <span className="flex items-center gap-0.5">
          <Button
            size="xs"
            tone="neutral"
            variant={decision === "approved" ? "soft" : "ghost"}
            aria-pressed={decision === "approved"}
            disabled={locked}
            onClick={() => onDecide(decision === "approved" ? "pending" : "approved")}
          >
            승인
          </Button>
          <Button
            size="xs"
            tone="neutral"
            variant={decision === "rejected" ? "soft" : "ghost"}
            aria-pressed={decision === "rejected"}
            disabled={locked}
            onClick={() => onDecide(decision === "rejected" ? "pending" : "rejected")}
          >
            거절
          </Button>
          <Button size="xs" tone="neutral" variant="ghost" disabled={locked} onClick={onComment}>
            의견
          </Button>
        </span>
      </div>
      {delivered}
      {segments.map((s, i) => (
        <Fragment key={i}>
          <Lines lines={s.lines} dim={decision === "rejected"} />
          {s.after !== undefined && (
            <>
              {comments
                .filter((c) => c.afterLine === s.after)
                .map((c) => (
                  <CommentBox
                    key={c.id}
                    comment={c}
                    editing={draftAt === s.after}
                    onEdit={onComment}
                    onDone={onDraftDone}
                  />
                ))}
              {draftAt === s.after && !comments.some((c) => c.afterLine === s.after) && (
                <CommentBox comment={null} editing onDone={onDraftDone} />
              )}
            </>
          )}
        </Fragment>
      ))}
      {draftAt === "hunk" && <CommentBox comment={null} editing onDone={onDraftDone} />}
    </article>
  );
}

// 작업대 오른쪽 "대화" 탭(§4.9.4): 맥락 대화의 트랜스크립트 끝 부분(읽기 전용)과 "대화로 가기".
// 런타임 행은 대화 안과 같은 한 줄 모양(DP-19: muted 아이콘, secondary 글자).
import { Button, EmptyState } from "@caustic/react";
import { Layers, MessageSquare } from "../icons";
import { threads } from "../fixtures";
import { useShell } from "../state";
import { threadTail } from "../workbench-fixtures";

export function ThreadTail({ onGoToThread }: { onGoToThread?: (() => void) | undefined }) {
  const m = useShell();
  const t = threads.find((x) => x.id === m.contextThreadId);
  if (t === undefined)
    return (
      <EmptyState
        size="sm"
        surface="none"
        icon={<MessageSquare />}
        title="맥락 대화를 고르면 여기 보여요"
      />
    );
  return (
    <div className="grid gap-3">
      <p className="m-0 truncate text-ui-xs text-text-tertiary">{t.title} · 끝 부분</p>
      <ol aria-label={`${t.title} 끝 부분`} className="m-0 grid list-none gap-2.5 p-0">
        {threadTail.map((r, i) =>
          r.who === "runtime" ? (
            <li key={i} className="flex items-center gap-1.5 text-ui-xs text-text-secondary">
              <Layers emphasis="muted" aria-hidden className="size-icon-xs text-text-tertiary" />
              {r.text}
            </li>
          ) : (
            <li key={i} className="grid gap-0.5">
              <span className="text-ui-xs text-text-tertiary">
                {r.who === "user" ? "나" : "어시스턴트"}
              </span>
              <span className="text-ui-sm text-text-primary">{r.text}</span>
            </li>
          ),
        )}
      </ol>
      <div>
        <Button size="xs" tone="neutral" variant="outline" onClick={onGoToThread}>
          대화로 가기
        </Button>
      </div>
    </div>
  );
}

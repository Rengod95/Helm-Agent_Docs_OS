// caustic 빈틈: Composer에는 "다른 소유자가 쓰는 중이라 관찰만 하는" 잠금 상태가 없다(disabled는 이유를 말하지 않는다).
// 입력창 자리에 같은 모서리(2xl)·높이 감의 띠를 두고, 이유 한 줄과 "쓰기 다시 시도" 버튼을 둔다.
// 바탕은 neutral-well(잠긴 입력의 흐린 바탕), 헤어라인은 border-subtle, 버튼은 caustic Button이다.
import { Button } from "@caustic/react";
import { Eye } from "../icons";

export function ObserveBand({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      data-slot="observe-band"
      className="flex min-h-14 items-center gap-3 rounded-2xl bg-neutral-well px-4 py-3 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
    >
      <Eye aria-hidden className="size-icon-md shrink-0 text-text-tertiary" />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-ui-strong text-text-primary">관찰 중이에요</p>
        <p className="m-0 text-ui-sm text-text-secondary">
          터미널(xeon CLI)이 이 대화를 쓰는 동안은 읽기만 해요.
        </p>
      </div>
      <Button size="sm" tone="neutral" variant="outline" onClick={onRetry}>
        쓰기 다시 시도
      </Button>
    </div>
  );
}

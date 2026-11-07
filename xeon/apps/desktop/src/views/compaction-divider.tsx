import { Button } from "@caustic/react";
import { ChevronRight } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { useState, type ReactNode } from "react";
import type { CompactionRecord } from "../state/engine/state.ts";
import { compactionViewOf } from "./compaction-model.ts";

// 대화 요약 구분선(L4 desktop-ux §6.6). 요약한 자리에 가운데 선과 "여기까지 요약했어요"를 두고, "요약 보기"로 요약 본문을 편다.
// 요약 본문은 읽기 폭 안에서 줄바꿈하고 길면 안쪽에서 스크롤한다. 글은 트랜스크립트의 끊김 표시(CutMarker)와 같은 크기와 빛깔이다.

/** 구분선. 상태(펼침)는 부모가 쥔다. 서버 렌더 시험이 펼친 모양을 값으로 비교하려고 나눴다 */
export function CompactionDividerView(props: {
  readonly record: CompactionRecord;
  readonly open: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  const { record, open, onToggle } = props;
  const view = compactionViewOf(record);
  return (
    <div data-compaction-divider className="mx-auto w-full min-w-0 max-w-184 px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden className="h-px min-w-6 flex-1 bg-border-subtle" />
        <p className="m-0 flex min-w-0 flex-wrap items-baseline justify-center gap-x-2 text-center text-ui-sm text-text-tertiary">
          <span>{t("desktop.compaction.divider")}</span>
          {view.reason === null ? null : <span className="text-ui-xs">{t(view.reason)}</span>}
        </p>
        <span aria-hidden className="h-px min-w-6 flex-1 bg-border-subtle" />
        <Button size="xs" variant="ghost" aria-expanded={open} onClick={onToggle}>
          <ChevronRight
            aria-hidden
            className={
              open
                ? "rotate-90 transition-transform duration-quick"
                : "transition-transform duration-quick"
            }
          />
          {open ? t("desktop.compaction.hide") : t("desktop.compaction.show")}
        </Button>
      </div>
      {view.tokensAfter === null ? null : (
        <p className="m-0 mt-0.5 text-center text-ui-xs text-text-tertiary">
          {t("desktop.compaction.tokensAfter", { tokens: view.tokensAfter })}
        </p>
      )}
      {open ? (
        <div
          role="region"
          tabIndex={0}
          aria-label={t("desktop.compaction.summaryLabel")}
          className="mt-2 max-h-80 overflow-y-auto rounded-2xl bg-neutral-well px-4 py-3 whitespace-pre-wrap [overflow-wrap:anywhere] text-ui-sm text-text-secondary"
        >
          {record.summary}
        </div>
      ) : null}
    </div>
  );
}

/** 구분선. 펼침 상태를 든다 */
export function CompactionDivider(props: { readonly record: CompactionRecord }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <CompactionDividerView
      record={props.record}
      open={open}
      onToggle={() => {
        setOpen((value) => !value);
      }}
    />
  );
}

import { Button } from "@caustic/react";
import { ChevronRight } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { useState, type ReactNode } from "react";
import type { CompactionRecord } from "../state/engine/state.ts";
import { compactionViewOf } from "./compaction-model.ts";
import { Reveal } from "./convo/tool-line.tsx";

// 대화 요약 구분선(L4 desktop-ux §6.6, dzT2a 시안 10절). 변화 표지와 같은 구분 줄(`.convo-divider`)에 "여기까지 요약했어요", 사유, 남은 토큰과
// "요약 보기"를 한 줄로 두고, 펼치면 요약 본문이 아래에 붙는다(길면 안쪽에서 스크롤). 줄 폭과 여백은 대화 줄 틀이 준다.
// 새로 생길 때는 선이 그어지고 빛이 한 번 지나간다(`.convo-compact-sweep`, dzM2 시안 §6). 요약 보기는 높이를 잇는다(`Reveal`).

/** 구분선. 상태(펼침)는 부모가 쥔다. 서버 렌더 시험이 펼친 모양을 값으로 비교하려고 나눴다 */
export function CompactionDividerView(props: {
  readonly record: CompactionRecord;
  readonly open: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  const { record, open, onToggle } = props;
  const view = compactionViewOf(record);
  return (
    <div data-compaction-divider className="grid min-w-0">
      <div className="convo-divider convo-compact-line">
        <span aria-hidden className="convo-compact-sweep" />
        <span className="flex min-w-0 flex-wrap items-center justify-center gap-x-2">
          <span>{t("desktop.compaction.divider")}</span>
          {view.reason === null ? null : <span className="text-footnote">{t(view.reason)}</span>}
          {view.tokensAfter === null ? null : (
            <span className="text-footnote">
              {t("desktop.compaction.tokensAfter", { tokens: view.tokensAfter })}
            </span>
          )}
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
        </span>
      </div>
      <Reveal open={open}>
        <div
          role="region"
          tabIndex={0}
          aria-label={t("desktop.compaction.summaryLabel")}
          className="mt-1 max-h-80 overflow-y-auto rounded-lg bg-neutral-well px-3.5 py-2.5 whitespace-pre-wrap [overflow-wrap:anywhere] text-ui-relaxed text-text-secondary"
        >
          {record.summary}
        </div>
      </Reveal>
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

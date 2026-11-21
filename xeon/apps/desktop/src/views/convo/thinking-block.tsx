import { ChevronRight } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { thinkingModeOf } from "../item-detail-model.ts";
import { ThinkingLive } from "../thinking-indicator.tsx";
import { useTranscriptDetail } from "../transcript-detail.ts";
import { Reveal, useDisclosure } from "./tool-line.tsx";

// 생각 블록(dzT2a 시안 3.2). 본문보다 한 단계 물러난다: 13/20 tertiary, 왼쪽 2px 레일. 펼쳐도 240px 넘으면 안쪽에서 스크롤해 답을 밀지 않는다.
// 머리 한 줄(28): chevron + "생각" + 접혀 있으면 첫 줄 미리보기. 생각하는 동안은 chevron 자리에 작은 orb(DP-168)가 돌고 "생각하는 중"이 반짝인다. 설정 "모두 보기"=펼침, "요약"=접힘, "숨김"=없음.
// 생각 표시는 대화 본문 한 곳이다(DP-212): 첫 응답을 기다리는 줄(`ThinkingPending`)과 생각하는 동안의 머리는 같은 줄(`data-live`)이라
// 기다림이 생각으로, 생각이 답으로 바뀌어도 같은 자리에서 잇는다. 면과 테두리 없이 구슬과 글만 둔다(2026-11-20 사용자, AGE-65).
// 입력창 위에는 생각 표시를 두지 않는다.

function previewLine(text: string): string {
  const line =
    text
      .trim()
      .split("\n")
      .find((l) => l.trim() !== "") ?? "";
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

export function ThinkingBlock(props: {
  readonly text: string;
  readonly live?: boolean;
}): ReactNode {
  const mode = thinkingModeOf(useTranscriptDetail());
  const [open, toggle] = useDisclosure(mode === "open");
  const live = props.live === true;
  if (mode === "none") return null;
  return (
    <div className="grid min-w-0">
      <div
        className="convo-line"
        data-toggle="true"
        data-open={open ? "true" : undefined}
        data-live={live ? "true" : undefined}
      >
        <button
          type="button"
          className="convo-line-hit"
          aria-expanded={open}
          aria-label={t("desktop.item.thinking")}
          onClick={toggle}
        />
        {live ? (
          <ThinkingLive label={t("desktop.convo.thinking.live")} />
        ) : (
          <ChevronRight
            aria-hidden
            className={
              open
                ? "convo-line-icon rotate-90 transition-transform duration-quick"
                : "convo-line-icon transition-transform duration-quick"
            }
          />
        )}
        {live ? null : <span className="convo-line-verb">{t("desktop.item.thinking")}</span>}
        {open ? null : <span className="convo-line-text">{previewLine(props.text)}</span>}
      </div>
      <Reveal open={open}>
        <div className="convo-thinking-body whitespace-pre-wrap text-ui-relaxed">{props.text}</div>
      </Reveal>
    </div>
  );
}

/** 첫 응답을 기다리는 줄: 답이 놓일 자리에 생각 구슬과 "생각하는 중"만 둔다(면·테두리 없음, DP-212). 목록의 마지막 줄(`pending`)이 그린다 */
export function ThinkingPending(): ReactNode {
  return (
    <div role="status" className="convo-line" data-live="true">
      <ThinkingLive label={t("desktop.convo.thinking.live")} />
    </div>
  );
}

import { useId, type ReactNode } from "react";
import { InfoTip } from "../craft/info-tip.tsx";

// 오른쪽 막대 탭 안의 구역 머리와 빈 상태(DP-198, DP-201). 변경 탭과 컨텍스트 탭이 같이 쓴다.
// 구역 머리: 제목 13/500 + 정보 아이콘(사이 4) + 수 12 tertiary, 오른쪽 끝에 보조 글이나 동작. 높이 28, 내용과 사이 4.

export function PanelSection(props: {
  readonly title: string;
  readonly info?: string | readonly string[];
  readonly count?: number;
  /** 머리 오른쪽 끝(보조 글, xs·sm 단추) */
  readonly end?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid grid-cols-1 min-w-0 gap-1">
      <div className="flex h-7 min-w-0 items-center gap-2">
        <h3
          id={id}
          className="m-0 flex min-w-0 items-center gap-1 text-ui-strong text-text-primary"
        >
          <span className="truncate">{props.title}</span>
          {props.info === undefined ? null : <InfoTip text={props.info} />}
        </h3>
        {props.count === undefined ? null : (
          <span className="text-footnote text-text-tertiary tabular-nums">{props.count}</span>
        )}
        <span className="flex-1" />
        {props.end}
      </div>
      {props.children}
    </section>
  );
}

/** 탭의 빈 상태: 이 탭이 무엇을 보일지(제목)와 시작하는 법(본문) */
export function PanelEmpty(props: { readonly title: string; readonly body?: string }): ReactNode {
  return (
    <div data-panel-empty className="grid grid-cols-1 min-w-0 gap-1 px-1 py-6 text-center">
      <p className="m-0 text-ui-strong text-text-primary">{props.title}</p>
      {props.body === undefined ? null : (
        <p className="m-0 text-ui text-text-secondary">{props.body}</p>
      )}
    </div>
  );
}

import { ChevronRight } from "@caustic/react/icons";
import { useId, type ReactNode } from "react";

// 오른쪽 well 패널의 공용 부품(DP-193). 작업·실행 중·변경·컨텍스트 탭이 같은 묶음 머리와 빈 상태를 쓴다.
// 묶음 머리: 높이 28, 이름 12/500 tertiary + 수 12/400 tertiary(tabular), 끝 칸. 접을 수 있으면 머리 전체가 단추이고 꺾쇠 14가 돈다.
// 빈 상태: 장식 아이콘 없이 제목 13/500 primary + 설명 12/400 tertiary(두 줄까지) + 동작. 왼쪽 정렬(좁은 well에서 가운데 정렬은 눈이 튄다).

export function WellGroup(props: {
  readonly title: string;
  readonly count?: number;
  /** 머리 끝 칸(단추, 요약 글) */
  readonly end?: ReactNode;
  /** 주면 접을 수 있다. `open`이 거짓이면 내용을 그리지 않는다 */
  readonly fold?: { readonly open: boolean; readonly onToggle: () => void };
  readonly children: ReactNode;
}): ReactNode {
  const id = useId();
  const label = (
    <>
      <span className="truncate">{props.title}</span>
      {props.count === undefined ? null : (
        <span className="font-normal tabular-nums">{props.count}</span>
      )}
    </>
  );
  const open = props.fold?.open ?? true;
  return (
    <section aria-labelledby={id} className="grid min-w-0">
      <div className="flex h-7 min-w-0 items-center gap-1.5">
        {props.fold === undefined ? (
          <h3
            id={id}
            className="m-0 flex min-w-0 items-center gap-1.5 text-ui-sm text-text-tertiary"
          >
            {label}
          </h3>
        ) : (
          <h3 className="m-0 flex min-w-0">
            <button
              id={id}
              type="button"
              aria-expanded={open}
              onClick={props.fold.onToggle}
              className="-ms-0.5 flex h-6 min-w-0 cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent ps-0.5 pe-1.5 text-ui-sm text-text-tertiary outline-none transition-colors hover:text-text-secondary focus-visible:shadow-focus"
            >
              <ChevronRight
                aria-hidden
                className={`size-icon-xs flex-none transition-transform duration-quick ${open ? "rotate-90" : ""}`}
              />
              {label}
            </button>
          </h3>
        )}
        <span className="flex-1" />
        {props.end}
      </div>
      {open ? props.children : null}
    </section>
  );
}

export function WellEmpty(props: {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}): ReactNode {
  return (
    <div data-slot="well-empty" className="grid justify-items-start gap-1 px-0.5 py-2">
      <p className="m-0 text-ui font-medium text-text-primary">{props.title}</p>
      {props.description === undefined ? null : (
        <p className="m-0 text-ui-sm font-normal text-text-tertiary">{props.description}</p>
      )}
      {props.action === undefined ? null : <div className="mt-2">{props.action}</div>}
    </div>
  );
}

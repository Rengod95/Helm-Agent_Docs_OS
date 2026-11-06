import { useId, type ReactNode } from "react";

// 설정 구역 하나(P-09 `_settings/row.tsx`의 SettingSection). 머리는 표면 없는 작은 글(제목과 끝 동작)이고, 그 아래 줄 전부를
// 표면 카드 하나에 담는다(bg-surface-base + border-subtle 헤어라인, 줄 사이는 border-subtle 구분선). 카드 안에 카드를 두지 않는다.
// 카드 첫 줄 위와 끝 줄 아래 여백은 카드가 한 번만 준다(py-3). 목록(ListDescription, ul)은 행마다 자기 위아래 여백을 그려
// 카드 여백과 겹치므로 카드 첫·끝 자식일 때만 음수 마진으로 걷는다. 시안 `_settings/row.tsx`의 OWN_PAD와 같다.
const OWN_PAD =
  "[&>[data-slot=setting-row]:first-child]:pt-0 [&>[data-slot=setting-row]:last-child]:pb-0 [&>[data-slot=list]:first-child]:-mt-1.5 [&>[data-slot=list]:last-child]:-mb-1.5 [&>[data-slot=list-description]:first-child]:-mt-1 [&>[data-slot=list-description]:last-child]:-mb-1 [&>ul:first-child]:-mt-1 [&>ul:last-child]:-mb-1 [&>[data-slot=empty-state]:only-child]:-my-3";

export interface SettingSectionProps {
  readonly title?: ReactNode | undefined;
  readonly label?: string | undefined;
  readonly end?: ReactNode | undefined;
  readonly children: ReactNode;
}

export function SettingSection(props: SettingSectionProps): ReactNode {
  const id = useId();
  return (
    <section
      aria-labelledby={props.title === undefined ? undefined : id}
      aria-label={props.title === undefined ? props.label : undefined}
      className="pt-6 first:pt-0"
    >
      {props.title === undefined ? null : (
        <div className="sticky top-0 z-[5] flex h-8 items-center gap-2 bg-bg-app">
          <h2 id={id} className="m-0 flex-1 text-title-2 text-text-primary">
            {props.title}
          </h2>
          {props.end}
        </div>
      )}
      <div
        className={`mt-1 grid divide-y divide-border-subtle rounded-2xl bg-surface-base px-4 py-3 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)] [&>:first-child]:pt-0 [&>:last-child]:pb-0 ${OWN_PAD}`}
      >
        {props.children}
      </div>
    </section>
  );
}

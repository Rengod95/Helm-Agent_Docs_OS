// 오른쪽 맥락 패널(DP-10). 접으면 아이콘만 있는 세로 떠 있는 막대(caustic FloatingBar vertical).
// 펼치면 누른 아이콘 옆에서 두 단계로 펼친다: 바깥 well(Card variant="well") 안에 내용 카드(CardPanel).
// 넓은 폭에서는 대화 영역을 밀고(헤어라인), 1100px 이하에서는 대화 위에 떠서 그림자 하나만 가진다.
// 탭(아이콘, 이름, 배지, 내용)은 페이지가 준다. 기본 세 탭은 standardRightTabs로 만든다.
import {
  Card,
  CardPanel,
  EmptyState,
  FloatingBar,
  FloatingBarItem,
  IconButton,
  ScrollArea,
} from "@caustic/react";
import type { ReactNode } from "react";
import { Compass, Inbox, ListChecks, X } from "./icons";
import { useShell } from "./state";

export interface RightTab {
  id: string;
  label: string;
  icon: ReactNode;
  /** 막대 아이콘의 개수 배지(닫혀 있을 때만 보인다). */
  badge?: number | undefined;
  /** well 안 내용. 없으면 "셸 목업에서는 비어 있어요". */
  content?: ReactNode;
}

/** 모든 화면에 공통인 세 탭: 받은 요청, 탐구, 작업. only로 일부만 보인다(예: 대화를 고르지 않았을 때 받은 요청만). */
export function standardRightTabs(opts: {
  inbox?: ReactNode;
  inboxBadge?: number;
  helm?: ReactNode;
  work?: ReactNode;
  only?: string[];
}): RightTab[] {
  const tabs: RightTab[] = [
    {
      id: "inbox",
      label: "받은 요청",
      icon: <Inbox />,
      badge: opts.inboxBadge,
      content: opts.inbox,
    },
    { id: "helm", label: "탐구", icon: <Compass />, content: opts.helm },
    { id: "work", label: "작업", icon: <ListChecks />, content: opts.work },
  ];
  return opts.only === undefined ? tabs : tabs.filter((t) => opts.only?.includes(t.id));
}

export function RightPanel({ tabs }: { tabs: RightTab[] }) {
  const m = useShell();
  const current = tabs.find((t) => t.id === m.endTab) ?? tabs[0];
  if (current === undefined) return null;
  const tab = current.id;
  const overlay = m.layout !== "wide";
  const open = m.endOpen;
  return (
    <aside aria-label="맥락 패널" className="relative flex flex-none items-start gap-1.5">
      {open && (
        <Card
          variant="well"
          size="sm"
          role="region"
          aria-label={current.label}
          // 아이콘 쪽(위 오른쪽)에서 펼쳐지는 느낌: 그 모서리를 원점으로 커지며 나타난다.
          className={[
            "flex w-[352px] max-w-[calc(100vw-4.5rem)] flex-col self-stretch origin-top-right animate-enter enter-scale",
            overlay ? "absolute inset-y-0 end-[calc(100%+0.375rem)] z-30 shadow-3" : "",
          ].join(" ")}
        >
          <div className="flex h-8 flex-none items-center gap-1.5 ps-2.5 pe-0.5">
            <h2 className="m-0 flex-1 truncate text-ui-sm font-semibold text-text-primary">
              {current.label}
            </h2>
            <IconButton
              size="xs"
              variant="ghost"
              label="맥락 패널 접기"
              onClick={() => m.setEndOpen(false)}
            >
              <X />
            </IconButton>
          </div>
          <CardPanel className="flex min-h-0 flex-1 flex-col gap-0 p-0">
            <ScrollArea label={current.label} className="min-h-0 flex-1">
              <div className="p-3">
                {current.content ?? (
                  <EmptyState
                    size="sm"
                    surface="none"
                    icon={current.icon}
                    title="셸 목업에서는 비어 있어요"
                  />
                )}
              </div>
            </ScrollArea>
          </CardPanel>
        </Card>
      )}
      <FloatingBar label="맥락 패널" orientation="vertical" size="sm" shadow="2">
        {tabs.map((t) => (
          <FloatingBarItem
            key={t.id}
            icon={t.icon}
            aria-label={t.badge !== undefined ? `${t.label} ${t.badge}개` : t.label}
            aria-expanded={open && tab === t.id}
            active={open && tab === t.id}
            {...(t.badge !== undefined && !(open && tab === t.id) ? { badge: t.badge } : {})}
            onClick={() => (open && tab === t.id ? m.setEndOpen(false) : m.openEnd(t.id))}
          />
        ))}
      </FloatingBar>
    </aside>
  );
}

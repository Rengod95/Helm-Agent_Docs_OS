// 오른쪽 맥락 패널(DP-10). 접으면 아이콘만 있는 세로 떠 있는 막대(caustic FloatingBar vertical).
// 펼치면 누른 아이콘 옆에서 두 단계로 펼친다: 바깥 well(Card variant="well") 안에 내용 카드(CardPanel).
// 넓은 폭에서는 대화 영역을 밀고(헤어라인), 1100px 이하에서는 대화 위에 떠서 그림자 하나만 가진다.
// 탭(아이콘, 이름, 배지, 내용)은 페이지가 준다. 탭 묶음은 영역마다(§4.9.4):
//   대화: chatRightTabs(받은 요청, 런타임, 작업, 플러그인 well 탭들). 옛 standardRightTabs(받은 요청, 탐구, 작업)도 남긴다.
//   작업대: workbenchRightTabs(받은 요청, 기록, 대화).
// well 머리는 짧은 이름 + 아이콘 둘까지("크게", 접기, DP-21). 플러그인 well이면 이름 옆에 확장 이름을 연하게(ADR-0021 슬롯 규칙).
import {
  Card,
  CardPanel,
  EmptyState,
  FloatingBar,
  FloatingBarItem,
  IconButton,
  Menu,
  MenuItem,
  ResizeHandle,
  ScrollArea,
} from "@caustic/react";
import { useState, type ReactNode } from "react";
import {
  Compass,
  Ellipsis,
  History,
  Inbox,
  Layers,
  ListChecks,
  Maximize2,
  MessageSquare,
  X,
} from "./icons";
import { RuntimeLog } from "./parts/runtime-log";
import { ThreadTail } from "./parts/thread-tail";
import { L } from "./i18n";
import { useShell } from "./state";
import { T } from "./terms";

export interface RightTab {
  id: string;
  label: string;
  icon: ReactNode;
  /** 막대 아이콘의 개수 배지(닫혀 있을 때만 보인다). */
  badge?: number | undefined;
  /** well 안 내용. 없으면 "셸 목업에서는 비어 있어요". */
  content?: ReactNode;
  /** 플러그인 well이면 기여한 확장 이름(머리에 연한 mono 글자). */
  ext?: string | undefined;
  /** 머리 "크게" 아이콘: 같은 확장의 page 기여를 작업대에서 연다(DP-24). */
  expand?: { label: string; onSelect: () => void } | undefined;
  /** well 폭(px). 플러그인 well은 320~480(ADR-0021 §3.2). 없으면 352. */
  width?: number | undefined;
  /** 참이면 넓은 폭에서 well 왼쪽 끝에 폭 손잡이(320~480)를 둔다(프레임 well의 resize 안내와 같은 범위). */
  resizable?: boolean | undefined;
}

/** 막대에 보이는 플러그인 well 탭 상한(§4.9.4 [제안]). 넘는 것은 막대 끝 "더 보기" 메뉴로 간다. */
export const MAX_PLUGIN_TABS = 6;

/** 대화 영역 탭(§4.9.4): 받은 요청, 런타임, 작업, 그리고 열린 대화에서 켜진 확장의 well 기여(plugins). */
export function chatRightTabs(opts: {
  inbox?: ReactNode;
  inboxBadge?: number;
  runtime?: ReactNode;
  /** 런타임 탭 배지: 이 대화의 확장 실패 수(0이면 숨김, DP-27). */
  runtimeBadge?: number;
  work?: ReactNode;
  /** 플러그인 well 탭. 없으면 Helm 탐구(helm/panel) 하나. 막대 칸은 MAX_PLUGIN_TABS(6)까지, 넘치면 "더 보기" 메뉴. */
  plugins?: RightTab[];
  only?: string[];
}): RightTab[] {
  const tabs: RightTab[] = [
    {
      id: "inbox",
      label: T.inbox,
      icon: <Inbox />,
      badge: opts.inboxBadge,
      content: opts.inbox,
    },
    {
      id: "runtime",
      label: T.runtime,
      icon: <Layers />,
      badge:
        opts.runtimeBadge !== undefined && opts.runtimeBadge > 0 ? opts.runtimeBadge : undefined,
      content: opts.runtime,
    },
    { id: "work", label: L("작업"), icon: <ListChecks />, content: opts.work },
    ...(opts.plugins ?? [{ id: "helm/panel", label: T.inquiry, icon: <Compass />, ext: "helm" }]),
  ];
  return opts.only === undefined ? tabs : tabs.filter((t) => opts.only?.includes(t.id));
}

/** 작업대 영역 탭(§4.9.4): 받은 요청, 기록(맥락 대화의 런타임 이벤트), 대화(맥락 대화의 끝 부분, 읽기 전용). */
export function workbenchRightTabs(opts: {
  inbox?: ReactNode;
  inboxBadge?: number;
  /** 기록 탭 내용. 없으면 공용 RuntimeLog. */
  log?: ReactNode;
  /** 대화 탭 내용. 없으면 공용 ThreadTail(onGoToThread로 "대화로 가기"). */
  thread?: ReactNode;
  onGoToThread?: () => void;
}): RightTab[] {
  return [
    {
      id: "inbox",
      label: T.inbox,
      icon: <Inbox />,
      badge: opts.inboxBadge,
      content: opts.inbox,
    },
    { id: "log", label: L("기록"), icon: <History />, content: opts.log ?? <RuntimeLog /> },
    {
      id: "thread",
      label: T.thread,
      icon: <MessageSquare />,
      content: opts.thread ?? <ThreadTail onGoToThread={opts.onGoToThread} />,
    },
  ];
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
      label: T.inbox,
      icon: <Inbox />,
      badge: opts.inboxBadge,
      content: opts.inbox,
    },
    { id: "helm", label: T.inquiry, icon: <Compass />, content: opts.helm },
    { id: "work", label: L("작업"), icon: <ListChecks />, content: opts.work },
  ];
  return opts.only === undefined ? tabs : tabs.filter((t) => opts.only?.includes(t.id));
}

export function RightPanel({ tabs }: { tabs: RightTab[] }) {
  const m = useShell();
  const [widths, setWidths] = useState<Record<string, number>>({});
  const current = tabs.find((t) => t.id === m.endTab) ?? tabs[0];
  if (current === undefined) return null;
  // 플러그인 well 탭(ext 있음)은 MAX_PLUGIN_TABS까지 막대에, 나머지는 "더 보기" 메뉴에.
  const pluginTabs = tabs.filter((t) => t.ext !== undefined);
  const overflow = pluginTabs.slice(MAX_PLUGIN_TABS);
  const barTabs = tabs.filter((t) => !overflow.includes(t));
  const wellWidth = Math.min(480, Math.max(320, widths[current.id] ?? current.width ?? 352));
  const fixedWidth = current.width === undefined && widths[current.id] === undefined;
  const tab = current.id;
  const overlay = m.layout !== "wide";
  const open = m.endOpen;
  return (
    <aside aria-label={L("맥락 패널")} className="relative flex flex-none items-start gap-1.5">
      {open && (
        <Card
          variant="well"
          size="sm"
          role="region"
          aria-label={current.label}
          // 아이콘 쪽(위 오른쪽)에서 펼쳐지는 느낌: 그 모서리를 원점으로 커지며 나타난다.
          className={[
            "relative flex max-w-[calc(100vw-4.5rem)] flex-col self-stretch origin-top-right animate-enter enter-scale",
            fixedWidth ? "w-[352px]" : "",
            overlay ? "absolute inset-y-0 end-[calc(100%+0.375rem)] z-30 shadow-3" : "",
          ].join(" ")}
          style={fixedWidth ? undefined : { width: wellWidth }}
        >
          {current.resizable === true && !overlay && (
            <ResizeHandle
              orientation="vertical"
              min={320}
              max={480}
              step={8}
              reverse
              value={wellWidth}
              label={`${current.label} 폭`}
              formatValueText={(v) => `${v}px`}
              onValueChange={(v) => setWidths((w) => ({ ...w, [current.id]: v }))}
              className="absolute inset-y-3 -start-1.5 z-10"
            />
          )}
          <div className="flex h-8 flex-none items-center gap-1.5 ps-2.5 pe-0.5">
            <h2 className="m-0 flex min-w-0 flex-1 items-baseline gap-1.5 text-ui-sm font-semibold text-text-primary">
              <span className="truncate">{current.label}</span>
              {current.ext !== undefined && (
                <span className="truncate font-mono text-mono-sm font-normal text-text-tertiary">
                  {current.ext}
                </span>
              )}
            </h2>
            {current.expand !== undefined && (
              <IconButton
                size="xs"
                variant="ghost"
                label={current.expand.label}
                onClick={current.expand.onSelect}
              >
                <Maximize2 />
              </IconButton>
            )}
            <IconButton
              size="xs"
              variant="ghost"
              label={L("맥락 패널 접기")}
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
                    title={L("셸 목업에서는 비어 있어요")}
                  />
                )}
              </div>
            </ScrollArea>
          </CardPanel>
        </Card>
      )}
      <FloatingBar label={L("맥락 패널")} orientation="vertical" size="sm" shadow="2">
        {barTabs.map((t) => (
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
        {overflow.length > 0 && (
          <Menu
            side="bottom"
            align="end"
            aria-label="다른 플러그인 패널"
            trigger={
              <FloatingBarItem
                icon={<Ellipsis />}
                aria-label={`더 보기, 플러그인 패널 ${overflow.length}개`}
                active={open && overflow.some((t) => t.id === tab)}
              />
            }
          >
            {overflow.map((t) => (
              <MenuItem
                key={t.id}
                icon={t.icon}
                selected={open && tab === t.id}
                end={<span className="font-mono text-mono-sm text-text-tertiary">{t.ext}</span>}
                onSelect={() => m.openEnd(t.id)}
              >
                {t.label}
              </MenuItem>
            ))}
          </Menu>
        )}
      </FloatingBar>
    </aside>
  );
}

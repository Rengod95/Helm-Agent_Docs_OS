// 왼쪽 패널(표면): 찾기 + 주 내비(다섯 항목) + 작업 폴더별 대화 목록 + 맨 아래 설정. 제목 띠가 없어서 찾기와 접기가 여기 머리에 온다.
// 지금 화면(activeNav)과 대화 고르기는 페이지가 props로 준다.
import {
  IconButton,
  Input,
  ListNavigation,
  ListNavigationGroup,
  ListNavigationItem,
  SidePanel,
} from "@caustic/react";
import { nav, threads, type Thread } from "./fixtures";
import {
  CalendarClock,
  Inbox,
  Lightbulb,
  Lock,
  MessageSquare,
  Plug,
  RotateCcw,
  PanelLeft,
  Search,
  Settings,
} from "./icons";
import { useShell } from "./state";

// 지금 화면(activeNav)은 라벨 굵기와 함께 아이콘도 selected(Solar bold)로 그린다(DP-17).
const NAV_ICONS = {
  chat: MessageSquare,
  inbox: Inbox,
  proposals: Lightbulb,
  schedules: CalendarClock,
  connection: Plug,
} as const;
function navIcon(id: string, active: boolean) {
  const I = NAV_ICONS[id as keyof typeof NAV_ICONS];
  return I === undefined ? undefined : <I {...(active ? { emphasis: "selected" as const } : {})} />;
}

function threadMeta(t: Thread) {
  if (t.status === "locked")
    return (
      <span className="inline-flex items-center gap-1">
        <Lock aria-hidden className="size-icon-xs" />
        잠김
      </span>
    );
  if (t.status === "resumable")
    return (
      <span className="inline-flex items-center gap-1">
        <RotateCcw aria-hidden className="size-icon-xs" />
        이어서 실행
      </span>
    );
  // 실패는 앞의 상태 점이 이미 말한다. 승인 수는 색 없는 글자 하나로 둔다(강조는 항목마다 하나).
  if (t.approvals > 0 && t.status !== "failed") return `승인 ${t.approvals}`;
  return undefined;
}

export interface ThreadListProps {
  /** 고른 대화 id. 없으면 아무 행도 올리지 않는다. */
  currentId: string | null;
  /** 저장 전 새 대화를 목록 맨 위 "새로 시작"에 올린다. */
  draft?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export interface StartPanelProps {
  floating: boolean;
  /** 지금 화면인 주 내비 항목 id(nav[].id, 설정 화면은 "settings"). */
  activeNav: string;
  onNavSelect?: ((id: string) => void) | undefined;
  threads: ThreadListProps;
}

export function StartPanel({ floating, activeNav, onNavSelect, threads: list }: StartPanelProps) {
  const m = useShell();
  const folders = [...new Set(threads.map((t) => t.folder))];

  return (
    <SidePanel
      side="start"
      preset="inspector"
      label="대화와 이동"
      scrollLabel="주 내비게이션과 대화 목록"
      resizable
      resizeLabel="대화 목록 폭"
      formatWidthText={(w) => `${w}픽셀`}
      collapsed={!m.startOpen}
      onCollapsedChange={(c) => m.setStartOpen(!c)}
      size="sm"
      // 붙박이: 창 왼쪽 끝에서 위아래 끝까지 닿는 docked 면(variant outline: 모서리 없음, 오른쪽 헤어라인 하나, DP-13).
      // 좁은 폭에서 대화 위로 뜰 때만 floating 면(solid)과 그림자 하나.
      variant={floating ? "solid" : "outline"}
      shadow={floating ? "3" : "none"}
      className="[&>[data-slot=side-panel-footer]]:px-1.5 [&>[data-slot=side-panel-header]]:px-1.5"
      // 찾기 칸이 머리 폭을 다 쓰고, 접기 버튼은 늘 보이는 자리에 둔다(caustic의 hover 때만 보이는 접기 버튼은 빈 자리를 남겨서 쓰지 않는다).
      header={
        <div className="flex min-w-0 items-center gap-1">
          <Input
            size="xs"
            variant="soft"
            readOnly
            prefix={<Search />}
            placeholder="찾기"
            aria-label="명령 또는 대화 찾기"
            aria-haspopup="dialog"
            onClick={() => m.setPaletteOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                m.setPaletteOpen(true);
              }
            }}
            containerClassName="min-w-0 flex-1"
            className="cursor-pointer"
          />
          <IconButton
            size="sm"
            variant="ghost"
            label="사이드바 닫기"
            onClick={() => m.setStartOpen(false)}
          >
            <PanelLeft />
          </IconButton>
        </div>
      }
      footer={
        <ListNavigation aria-label="설정" kind="navigation" size="sm" as="div" className="w-full">
          <ListNavigationGroup>
            {/* 설정 화면(P-09~P-13)에서는 주 내비 항목처럼 굵기와 selected 아이콘으로 지금 화면을 보인다. */}
            <ListNavigationItem
              icon={activeNav === "settings" ? <Settings emphasis="selected" /> : <Settings />}
              aria-label={activeNav === "settings" ? "설정, 지금 화면" : "설정"}
              className={
                activeNav === "settings"
                  ? "[&_[data-slot=list-navigation-label]]:font-semibold [&_[data-slot=list-navigation-label]]:text-text-primary"
                  : undefined
              }
              onSelect={() => onNavSelect?.("settings")}
            >
              설정
            </ListNavigationItem>
          </ListNavigationGroup>
        </ListNavigation>
      }
    >
      <div className="grid gap-2 px-1.5 pb-2">
        <ListNavigation aria-label="주 내비게이션" kind="navigation" size="sm">
          <ListNavigationGroup>
            {nav.map((n) => (
              <ListNavigationItem
                key={n.id}
                icon={navIcon(n.id, n.id === activeNav)}
                // 지금 화면 표시는 굵기 하나로만 한다(aria-current는 caustic이 올린 바탕을 그려서 쓰지 않고 라벨에 적는다).
                // 올린 바탕(current)은 아래 대화 목록의 고른 행 하나에만 쓴다.
                className={
                  n.id === activeNav
                    ? "[&_[data-slot=list-navigation-label]]:font-semibold [&_[data-slot=list-navigation-label]]:text-text-primary"
                    : undefined
                }
                aria-label={`${n.label}${
                  n.badge !== undefined ? `, ${n.tone === "danger" ? "실패 " : ""}${n.badge}개` : ""
                }${n.id === activeNav ? ", 지금 화면" : ""}`}
                count={
                  n.tone === "danger" ? (
                    <span className="text-danger-text">{n.badge}</span>
                  ) : (
                    n.badge
                  )
                }
                onSelect={() => (n.id === "inbox" ? m.openEnd("inbox") : onNavSelect?.(n.id))}
              >
                {n.label}
              </ListNavigationItem>
            ))}
          </ListNavigationGroup>
        </ListNavigation>

        <ListNavigation aria-label="대화 목록" kind="sessions" size="sm" as="div">
          {list.draft === true && (
            <ListNavigationGroup heading="새로 시작">
              <ListNavigationItem current meta="작성 전">
                새 대화
              </ListNavigationItem>
            </ListNavigationGroup>
          )}
          {folders.map((folder) => (
            <ListNavigationGroup
              key={folder}
              heading={
                <span className="font-mono text-mono-sm normal-case tracking-normal">{folder}</span>
              }
              addLabel={`${folder}에서 새 대화`}
              onAdd={list.onNew}
            >
              {threads
                .filter((t) => t.folder === folder)
                .map((t) => (
                  <ListNavigationItem
                    key={t.id}
                    current={list.draft !== true && list.currentId === t.id}
                    {...(t.status === "running" || t.status === "failed"
                      ? { status: t.status }
                      : {})}
                    meta={threadMeta(t)}
                    onSelect={() => list.onSelect(t.id)}
                    className={
                      t.title === ""
                        ? "[&_[data-slot=list-navigation-label]]:italic [&_[data-slot=list-navigation-label]]:text-text-tertiary"
                        : undefined
                    }
                  >
                    {t.title === "" ? "제목 없음" : t.title}
                  </ListNavigationItem>
                ))}
            </ListNavigationGroup>
          ))}
        </ListNavigation>
      </div>
    </SidePanel>
  );
}

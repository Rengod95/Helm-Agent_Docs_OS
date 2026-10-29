// 시작 영역(표면): 찾기 + 주 내비(다섯 항목) + 작업 폴더별 대화 목록 + 맨 아래 설정. 제목 띠가 없어서 찾기와 접기가 여기 머리에 온다.
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
import { useMock } from "./store";

// 지금 화면(chat)은 라벨 굵기와 함께 아이콘도 selected(Phosphor fill, Solar bold)로 그린다(DP-17).
const NAV_ICONS = {
  chat: <MessageSquare emphasis="selected" />,
  inbox: <Inbox />,
  proposals: <Lightbulb />,
  schedules: <CalendarClock />,
  connection: <Plug />,
} as const;

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

export function StartPanel({ floating }: { floating: boolean }) {
  const m = useMock();
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
            <ListNavigationItem icon={<Settings />}>설정</ListNavigationItem>
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
                icon={NAV_ICONS[n.id as keyof typeof NAV_ICONS]}
                // 지금 화면 표시는 굵기 하나로만 한다(aria-current는 caustic이 올린 바탕을 그려서 쓰지 않고 라벨에 적는다).
                // 올린 바탕(current)은 아래 대화 목록의 고른 행 하나에만 쓴다.
                className={
                  n.id === "chat"
                    ? "[&_[data-slot=list-navigation-label]]:font-semibold [&_[data-slot=list-navigation-label]]:text-text-primary"
                    : undefined
                }
                aria-label={`${n.label}${
                  n.badge !== undefined ? `, ${n.tone === "danger" ? "실패 " : ""}${n.badge}개` : ""
                }${n.id === "chat" ? ", 지금 화면" : ""}`}
                count={
                  n.tone === "danger" ? (
                    <span className="text-danger-text">{n.badge}</span>
                  ) : (
                    n.badge
                  )
                }
                {...(n.id === "inbox" ? { onSelect: () => m.openEnd("inbox") } : {})}
              >
                {n.label}
              </ListNavigationItem>
            ))}
          </ListNavigationGroup>
        </ListNavigation>

        <ListNavigation aria-label="대화 목록" kind="sessions" size="sm" as="div">
          {m.view === "empty" && (
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
              onAdd={m.newThread}
            >
              {threads
                .filter((t) => t.folder === folder)
                .map((t) => (
                  <ListNavigationItem
                    key={t.id}
                    current={m.view === "thread" && m.currentId === t.id}
                    {...(t.status === "running" || t.status === "failed"
                      ? { status: t.status }
                      : {})}
                    meta={threadMeta(t)}
                    onSelect={() => m.selectThread(t.id)}
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

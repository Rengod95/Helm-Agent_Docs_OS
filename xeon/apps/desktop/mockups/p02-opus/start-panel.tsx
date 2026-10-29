// 시작 영역: 주 내비(다섯 항목) + 작업 폴더별 대화 목록 + 맨 아래 설정.
import {
  Badge,
  Button,
  Kbd,
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
  Settings,
  SquarePen,
} from "./icons";
import { useMock } from "./store";

const NAV_ICONS = {
  chat: <MessageSquare />,
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
  if (t.status === "failed") return "실패";
  if (t.approvals > 0)
    return (
      <Badge size="xs" tone="warning">
        승인 {t.approvals}
      </Badge>
    );
  return undefined;
}

export function StartPanel({ id }: { id: string }) {
  const m = useMock();
  const folders = [...new Set(threads.map((t) => t.folder))];

  return (
    <SidePanel
      id={id}
      side="start"
      preset="inspector"
      label="대화와 이동"
      scrollLabel="주 내비게이션과 대화 목록"
      resizable
      resizeLabel="대화 목록 폭"
      formatWidthText={(w) => `${w}픽셀`}
      collapsed={!m.startOpen}
      onCollapsedChange={(c) => m.setStartOpen(!c)}
      header={
        <Button
          size="sm"
          variant="ghost"
          tone="neutral"
          iconStart={<SquarePen />}
          onClick={m.newThread}
          className="w-full justify-start px-2"
        >
          <span className="flex-1 text-left">새 대화</span>
          <Kbd size="xs">⌘N</Kbd>
        </Button>
      }
      footer={
        <ListNavigation aria-label="설정" kind="navigation" as="div" className="w-full">
          <ListNavigationGroup>
            <ListNavigationItem icon={<Settings />} meta={<Kbd size="xs">⌘,</Kbd>}>
              설정
            </ListNavigationItem>
          </ListNavigationGroup>
        </ListNavigation>
      }
    >
      <div className="grid gap-3 px-2 pb-3">
        <ListNavigation aria-label="주 내비게이션" kind="navigation">
          <ListNavigationGroup>
            {nav.map((n) => (
              <ListNavigationItem
                key={n.id}
                icon={NAV_ICONS[n.id as keyof typeof NAV_ICONS]}
                current={n.id === "chat"}
                aria-label={
                  n.badge !== undefined
                    ? `${n.label}, ${n.tone === "danger" ? "실패 " : ""}${n.badge}개`
                    : undefined
                }
                meta={
                  n.tone === "danger" ? (
                    <Badge size="xs" tone="danger" variant="solid">
                      !{n.badge}
                    </Badge>
                  ) : undefined
                }
                count={n.tone === "danger" ? undefined : n.badge}
                {...(n.id === "inbox" ? { onSelect: () => m.openEnd("inbox") } : {})}
              >
                {n.label}
              </ListNavigationItem>
            ))}
          </ListNavigationGroup>
        </ListNavigation>

        <div aria-hidden className="mx-2 h-px bg-border-subtle" />

        <ListNavigation aria-label="대화 목록" kind="sessions" as="div">
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

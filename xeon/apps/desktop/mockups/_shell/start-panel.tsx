// 왼쪽 패널(표면). 제목 띠가 없어서 찾기와 접기가 여기 머리에 온다. 머리: 찾기 + 영역 바꾸기(SegmentedControl, DP-18).
//   대화 영역: 주 내비(넷) + 작업 폴더별 대화 목록.
//   작업대 영역: 머리에 대화 맥락 칸을 더하고, 작업대 내비(일곱) + "플러그인 화면" 목록(켜진 확장의 page 기여).
// 맨 아래 설정은 두 영역 공통. 지금 화면(activeNav)과 대화 고르기는 페이지가 props로 준다.
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  ListNavigation,
  ListNavigationGroup,
  ListNavigationItem,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
  SidePanel,
} from "@caustic/react";
import {
  nav as defaultNav,
  pluginPages as defaultPluginPages,
  threads as defaultThreads,
  workbenchNav as defaultWorkbenchNav,
  type NavEntry,
  type PluginPageEntry,
  type Thread,
  type WorkbenchNavEntry,
} from "./fixtures";
import {
  CalendarClock,
  Compass,
  Plug,
  FlaskConical,
  Inbox,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  Lock,
  MessageSquare,
  Package,
  RotateCcw,
  PanelLeft,
  Search,
  Settings,
  SquarePen,
  SquareStack,
  Target,
} from "./icons";
import { useShell, type Area } from "./state";
import type { ReactNode } from "react";

// 지금 화면(activeNav)은 라벨 굵기와 함께 아이콘도 selected(Solar bold)로 그린다(DP-17).
const NAV_ICONS = {
  chat: MessageSquare,
  inbox: Inbox,
  proposals: Lightbulb,
  schedules: CalendarClock,
  // 작업대
  overview: LayoutGrid,
  extensions: Package,
  tests: FlaskConical,
  metrics: Target,
  compose: SquareStack,
  create: SquarePen,
  engine: Plug,
  // 플러그인 화면(기여 선언의 icon, ADR-0021 §3.3)
  "helm/inquiry": Compass,
  "review/queue": ListChecks,
} as const;
function navIcon(id: string, active: boolean) {
  const I = NAV_ICONS[id as keyof typeof NAV_ICONS];
  return I === undefined ? undefined : <I {...(active ? { emphasis: "selected" as const } : {})} />;
}
// 지금 화면 표시는 굵기 하나로만 한다(aria-current는 caustic이 올린 바탕을 그려서 쓰지 않고 라벨에 적는다).
const ACTIVE_LABEL =
  "[&_[data-slot=list-navigation-label]]:font-semibold [&_[data-slot=list-navigation-label]]:text-text-primary";

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
  /** 대화 목록을 바꿀 때(예: 첫 실행은 빈 배열). 없으면 공용 고정 데이터. 비면 "아직 대화가 없어요". */
  items?: Thread[];
}

export interface WorkbenchPanelProps {
  /** 작업대 내비(배지를 바꿀 때). 기본 fixtures.workbenchNav. */
  nav?: WorkbenchNavEntry[] | undefined;
  /** "플러그인 화면" 목록. 기본 fixtures.pluginPages. */
  pages?: PluginPageEntry[] | undefined;
  /** 대화 맥락 칸의 "대화로 가기"(맥락 대화의 대화 화면으로). */
  onGoToThread?: ((threadId: string) => void) | undefined;
  /** 맥락 칸을 페이지 것으로 바꿀 때(캔버스 시안: 전체·대화·프로필·시험 네 종류). 없으면 대화 맥락 칸. */
  contextField?: ReactNode | undefined;
}

export interface StartPanelProps {
  floating: boolean;
  /** 지금 화면인 내비 항목 id. 대화: nav[].id, 작업대: workbenchNav[].id 또는 플러그인 화면 id("helm/inquiry"), 설정 화면: "settings". */
  activeNav: string;
  onNavSelect?: ((id: string) => void) | undefined;
  threads: ThreadListProps;
  workbench?: WorkbenchPanelProps | undefined;
  /** 주 내비 항목(배지)을 바꿀 때. 없으면 공용 고정 데이터. */
  nav?: NavEntry[] | undefined;
}

/** 영역 바꾸기(§4.9.2, DP-18): 찾기 칸 바로 아래 SegmentedControl 하나. 고른 항목은 selected 굵기. */
function AreaSwitch() {
  const m = useShell();
  return (
    <SegmentedControl
      aria-label="영역"
      size="sm"
      value={m.area}
      onValueChange={(v) => m.setArea(v as Area)}
      className="w-full [&>[data-slot=segmented-control-item]]:flex-1 [&_[data-state=checked]]:font-semibold"
    >
      <SegmentedControlItem value="chat">대화</SegmentedControlItem>
      <SegmentedControlItem value="workbench">작업대</SegmentedControlItem>
    </SegmentedControl>
  );
}

/** 대화 맥락 칸(§4.9.3): 작업대 화면이 볼 대화. "전체" 또는 대화 하나. 옆 아이콘은 그 대화로 가기. */
function ContextPicker({ onGoToThread }: { onGoToThread?: ((id: string) => void) | undefined }) {
  const m = useShell();
  const value = m.contextThreadId ?? "all";
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Select
        size="xs"
        variant="soft"
        aria-label="대화 맥락"
        value={value}
        onValueChange={(v) => m.setContextThreadId(v === "all" ? null : v)}
        className="min-w-0 flex-1"
      >
        <SelectOption value="all">맥락 · 전체 대화</SelectOption>
        {defaultThreads
          .filter((t) => t.title !== "")
          .map((t) => (
            <SelectOption key={t.id} value={t.id}>
              맥락 · {t.title}
            </SelectOption>
          ))}
      </Select>
      {m.contextThreadId !== null && (
        // DP-30: 입력란 옆 버튼은 입력란과 같은 높이(Select xs = control-md).
        <IconButton
          size="md"
          variant="ghost"
          label="맥락 대화로 가기"
          onClick={() => m.contextThreadId !== null && onGoToThread?.(m.contextThreadId)}
        >
          <MessageSquare />
        </IconButton>
      )}
    </div>
  );
}

function WorkbenchNavList({
  activeNav,
  onNavSelect,
  workbench,
}: {
  activeNav: string;
  onNavSelect?: ((id: string) => void) | undefined;
  workbench?: WorkbenchPanelProps | undefined;
}) {
  const items = workbench?.nav ?? defaultWorkbenchNav;
  const pages = workbench?.pages ?? defaultPluginPages;
  const exts = [...new Set(pages.map((p) => p.ext))];
  return (
    <div className="grid gap-2 px-1.5 pb-2">
      <ListNavigation aria-label="작업대 내비게이션" kind="navigation" size="sm">
        <ListNavigationGroup>
          {items.map((n) => (
            <ListNavigationItem
              key={n.id}
              icon={navIcon(n.id, n.id === activeNav)}
              className={n.id === activeNav ? ACTIVE_LABEL : undefined}
              aria-label={`${n.label}${n.badgeLabel !== undefined ? `, ${n.badgeLabel}` : ""}${
                n.id === activeNav ? ", 지금 화면" : ""
              }`}
              count={
                n.badge === undefined ? undefined : (
                  <span className={n.tone === "danger" ? "text-danger-text" : undefined}>
                    {n.badge}
                  </span>
                )
              }
              onSelect={() => onNavSelect?.(n.id)}
            >
              {n.label}
            </ListNavigationItem>
          ))}
        </ListNavigationGroup>
      </ListNavigation>
      {/* 켜진 확장의 page 기여. 확장별로 묶되 묶음 제목 대신 행 meta에 확장 이름(mono, DP-39)을 둔다: 기여가 확장당 1~4개라 제목 줄이 행보다 많아진다. */}
      <ListNavigation aria-label="플러그인 화면" kind="navigation" size="sm" as="div">
        <ListNavigationGroup heading="플러그인 화면">
          {exts.flatMap((ext) =>
            pages
              .filter((p) => p.ext === ext)
              .map((p) => (
                <ListNavigationItem
                  key={p.id}
                  icon={navIcon(p.id, p.id === activeNav)}
                  className={[
                    p.id === activeNav ? ACTIVE_LABEL : "",
                    p.disabled === true
                      ? "[&_[data-slot=list-navigation-label]]:text-text-tertiary"
                      : "",
                  ].join(" ")}
                  aria-label={`${p.label}, ${p.ext}${p.disabled === true ? ", 확장 꺼짐" : ""}${
                    p.id === activeNav ? ", 지금 화면" : ""
                  }`}
                  meta={
                    <span className="font-mono text-mono-sm">
                      {p.disabled === true ? "꺼짐" : p.ext}
                    </span>
                  }
                  onSelect={() => onNavSelect?.(p.id)}
                >
                  {p.label}
                </ListNavigationItem>
              )),
          )}
        </ListNavigationGroup>
      </ListNavigation>
    </div>
  );
}

export function StartPanel({
  floating,
  activeNav,
  onNavSelect,
  threads: list,
  workbench,
  nav = defaultNav,
}: StartPanelProps) {
  const m = useShell();
  const threads = list.items ?? defaultThreads;
  const folders = [...new Set(threads.map((t) => t.folder))];
  const wb = m.area === "workbench";

  return (
    <SidePanel
      side="start"
      preset="inspector"
      label={wb ? "작업대 이동" : "대화와 이동"}
      scrollLabel={wb ? "작업대 내비게이션과 플러그인 화면" : "주 내비게이션과 대화 목록"}
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
        <div className="grid min-w-0 gap-1.5 pb-1">
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
          <AreaSwitch />
          {wb &&
            (workbench?.contextField ?? <ContextPicker onGoToThread={workbench?.onGoToThread} />)}
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
      {wb ? (
        <WorkbenchNavList activeNav={activeNav} onNavSelect={onNavSelect} workbench={workbench} />
      ) : (
        <div className="grid gap-2 px-1.5 pb-2">
          <ListNavigation aria-label="주 내비게이션" kind="navigation" size="sm">
            <ListNavigationGroup>
              {nav.map((n) => (
                <ListNavigationItem
                  key={n.id}
                  icon={navIcon(n.id, n.id === activeNav)}
                  // 올린 바탕(current)은 아래 대화 목록의 고른 행 하나에만 쓴다.
                  className={n.id === activeNav ? ACTIVE_LABEL : undefined}
                  aria-label={`${n.label}${
                    n.badge !== undefined
                      ? `, ${n.tone === "danger" ? "실패 " : ""}${n.badge}개`
                      : ""
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

          {threads.length === 0 && list.draft !== true && (
            <EmptyState
              size="sm"
              surface="none"
              title="아직 대화가 없어요"
              actions={
                <Button size="xs" tone="neutral" variant="outline" onClick={list.onNew}>
                  새 대화
                </Button>
              }
            />
          )}
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
                  <span className="font-mono text-mono-sm normal-case tracking-normal">
                    {folder}
                  </span>
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
      )}
    </SidePanel>
  );
}

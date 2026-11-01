// 왼쪽 패널(표면). 제목 띠가 없어서 찾기와 접기가 여기 머리에 온다. 머리: 찾기 + 영역 바꾸기(SegmentedControl, DP-18).
//   대화 영역: 주 내비(다섯, 연결 포함 U-3) + 작업 폴더별 대화 목록. 시험 대화는 폴더 안 "시험" 묶음으로 접힌다(§4.9.3, 계획에 없음 4).
//   작업대 영역: 머리에 보기 기준 칸(전체·대화·프로필·시험, 대화는 따라감/고정, §4.9.3)을 더하고,
//   작업대 내비(여섯, C-6) + "플러그인 화면" 목록(켜진 확장의 page 기여).
// 묶음 D: caustic ListNavigationItem has no actions slot(caustic 빈틈) — 대화 행 메뉴 ⋯는 행 뒤 높이 0인 li에 겹친다(RowMenu).
// 맨 아래 설정은 두 영역 공통. 지금 화면(activeNav)과 대화 고르기는 페이지가 props로 준다.
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  ListNavigation,
  ListNavigationGroup,
  ListNavigationItem,
  ListNavigationSubItem,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectGroup,
  SelectHeading,
  SelectOption,
  SidePanel,
  Tooltip,
} from "@caustic/react";
import { useState, type ReactNode } from "react";
import { Menu, Skeleton } from "@caustic/react";
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
  Ellipsis,
  Plug,
  FlaskConical,
  Inbox,
  LayoutGrid,
  Link,
  LockOpen,
  Lightbulb,
  ListChecks,
  Lock,
  MessageSquare,
  Package,
  RotateCcw,
  PanelLeft,
  Search,
  Settings,
  SquareStack,
  Target,
  WandSparkles,
} from "./icons";
import { useShell, type Area, type WorkbenchContext } from "./state";
import { L, LANG } from "./i18n";
import { T } from "./terms";
import { profiles } from "./workbench-fixtures";

// 지금 화면(activeNav)은 라벨 굵기와 함께 아이콘도 selected(Solar bold)로 그린다(DP-17).
const NAV_ICONS = {
  chat: MessageSquare,
  inbox: Inbox,
  proposals: Lightbulb,
  schedules: CalendarClock,
  connection: Link,
  // 작업대
  overview: LayoutGrid,
  extensions: Package,
  tests: FlaskConical,
  metrics: Target,
  compose: SquareStack,
  engine: Plug,
  // 플러그인 화면(기여 선언의 icon, ADR-0021 §3.3)
  "helm/inquiry": Compass,
  "review/queue": ListChecks,
  "authoring/session": WandSparkles,
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
        {L("잠김")}
      </span>
    );
  if (t.status === "resumable")
    return (
      <span className="inline-flex items-center gap-1">
        <RotateCcw aria-hidden className="size-icon-xs" />
        {T.resume}
      </span>
    );
  // 실패는 앞의 상태 점이 이미 말한다. 승인 수는 색 없는 글자 하나로 둔다(강조는 항목마다 하나).
  // 묶음 E(N-49): 행 meta는 짧게. 영어는 "Approvals 1"이 제목을 반 넘게 밀어 숫자 먼저 짧은 말로.
  if (t.approvals > 0 && t.status !== "failed")
    return LANG === "en" ? `${t.approvals} to approve` : `승인 ${t.approvals}`;
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
  /** "시험" 묶음을 처음부터 펼친다(지금 대화가 시험 대화면 늘 펼침). */
  trialsOpen?: boolean;
  /** "끝난 시험 지우기"(계획에 없음 4). 주면 페이지가 확인 대화 상자와 지우기를 맡는다. 없으면 셸이 목록에서만 숨긴다. */
  onClearTrials?: () => void;
  // 묶음 D(대화 영역 빈칸, m4/pg-d). 모두 선택 항목이다. 주지 않으면 목록은 예전과 같다.
  /** 대화 행 메뉴(§6.1: 이름 바꾸기, 분기, 요약, 닫기, 삭제, 내보내기). MenuItem들을 돌려준다. 주면 행에 "더 보기" 버튼이 생긴다. */
  rowMenu?: ((t: Thread) => ReactNode) | undefined;
  /** 처음부터 메뉴를 연 행 id(목업 스크린숏용). */
  menuOpenId?: string | undefined;
  /** 목록 상태(§6.1): 읽는 중이면 Skeleton 5행, 실패면 문장과 "다시 읽기". */
  listState?: "loading" | "error" | undefined;
  onRetry?: (() => void) | undefined;
  /** 50개 뒤 "더 보기"(nextCursor). */
  more?: { label: string; onMore: () => void; loading?: boolean } | undefined;
  /** 오프라인: 목록은 남기고 흐리게. */
  dimmed?: boolean | undefined;
}

export interface WorkbenchPanelProps {
  /** 작업대 내비(배지를 바꿀 때). 기본 fixtures.workbenchNav. */
  nav?: WorkbenchNavEntry[] | undefined;
  /** "플러그인 화면" 목록. 기본 fixtures.pluginPages. */
  pages?: PluginPageEntry[] | undefined;
  /** 대화 맥락 칸의 "대화로 가기"(맥락 대화의 대화 화면으로). */
  onGoToThread?: ((threadId: string) => void) | undefined;
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
      aria-label={L("영역")}
      size="sm"
      value={m.area}
      onValueChange={(v) => m.setArea(v as Area)}
      className="w-full [&>[data-slot=segmented-control-item]]:flex-1 [&_[data-state=checked]]:font-semibold"
    >
      <SegmentedControlItem value="chat">{T.thread}</SegmentedControlItem>
      <SegmentedControlItem value="workbench">{T.workbench}</SegmentedControlItem>
    </SegmentedControl>
  );
}

const TRIAL_WORD = {
  running: L("실행 중"),
  pausing: L("멈추는 중"),
  paused: L("멈춤"),
  done: L("끝남"),
} as const;

/** 보기 기준 값 <-> Select 값("all", "thread:t1", "profile:explore", "trial:t8"). */
function encodeContext(c: WorkbenchContext): string {
  if (c.kind === "all") return "all";
  if (c.kind === "profile") return `profile:${c.profileId}`;
  return `${c.kind}:${c.threadId}`;
}

/** 보기 기준의 이름(머리 "보기 기준 <이름>"에도 쓴다). */
export function contextName(c: WorkbenchContext): string {
  if (c.kind === "all") return T.contextAll;
  if (c.kind === "profile")
    return L(profiles.find((p) => p.id === c.profileId)?.title ?? c.profileId);
  const t = defaultThreads.find((x) => x.id === c.threadId);
  return t === undefined ? c.threadId : t.title === "" ? L("제목 없음") : L(t.title);
}

/** 보기 기준 칸(§4.9.3, 결정 C-3·11): 전체·대화·프로필·시험 네 묶음. 대화 기준은 기본으로 대화 영역의 열린 대화를 따라가고,
 *  "작업대에서 보기"로 오면 고정된다. 옆 자물쇠 아이콘이 고정·풀기(풀면 다시 따라감). 대화·시험 기준이면 "대화로 가기". */
function ContextPicker({ onGoToThread }: { onGoToThread?: ((id: string) => void) | undefined }) {
  const m = useShell();
  const c = m.context;
  const trials = defaultThreads.filter((t) => t.trial !== undefined);
  const plain = defaultThreads.filter((t) => t.trial === undefined && t.title !== "");
  const onValue = (v: string) => {
    const [kind, id] = v.split(":") as [string, string | undefined];
    if (kind === "all" || id === undefined) m.setContext({ kind: "all" });
    else if (kind === "profile") m.setContext({ kind: "profile", profileId: id });
    else if (kind === "trial") m.setContext({ kind: "trial", threadId: id });
    // 칸에서 대화를 직접 고르면 고정된다(따라가기는 자물쇠를 풀어서).
    else m.setContext({ kind: "thread", threadId: id, pinned: true });
  };
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Select
        size="xs"
        variant="soft"
        aria-label={T.context}
        value={encodeContext(c)}
        onValueChange={onValue}
        className="min-w-0 flex-1"
      >
        <SelectOption value="all">
          {T.context} · {T.contextAll}
        </SelectOption>
        <SelectGroup>
          <SelectHeading>{T.contextThread}</SelectHeading>
          {plain.map((t) => (
            <SelectOption key={t.id} value={`thread:${t.id}`}>
              {c.kind === "thread" && c.threadId === t.id
                ? `${T.contextThread} · ${L(t.title)}`
                : L(t.title)}
            </SelectOption>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectHeading>{T.contextProfile}</SelectHeading>
          {profiles.map((p) => (
            <SelectOption key={p.id} value={`profile:${p.id}`}>
              {c.kind === "profile" && c.profileId === p.id
                ? `${T.contextProfile} · ${L(p.title)}`
                : L(p.title)}
            </SelectOption>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectHeading>{T.contextTrial}</SelectHeading>
          {trials.map((t) => (
            <SelectOption key={t.id} value={`trial:${t.id}`}>
              {c.kind === "trial" && c.threadId === t.id
                ? `${T.contextTrial} · ${L(t.title)}`
                : L(t.title)}
            </SelectOption>
          ))}
        </SelectGroup>
      </Select>
      {c.kind === "thread" && (
        // DP-30: 입력란 옆 버튼은 입력란과 같은 높이(Select xs = control-md). 고정이면 selected 굵기(DP-17c)와 옅은 바탕 하나.
        // 토글 모양(aria-pressed)은 caustic이 잉크 면으로 칠해 조용한 칸 옆에서 너무 세다: 상태는 라벨과 툴팁으로 말한다.
        <Tooltip content={c.pinned ? T.unpin : `${T.thread}가 바뀌어도 ${T.pin}`}>
          <IconButton
            size="md"
            variant="ghost"
            label={
              c.pinned
                ? `${T.pin}됨. 누르면 ${T.unpin}: 열린 ${T.thread}를 다시 따라가요`
                : `${T.contextFollow}: 열린 ${T.thread}를 따라가요. 누르면 이 ${T.thread}로 ${T.pin}`
            }
            className={c.pinned ? "bg-fill-hover text-text-primary" : undefined}
            onClick={() => m.setContext({ ...c, pinned: !c.pinned })}
          >
            {c.pinned ? <Lock emphasis="selected" /> : <LockOpen emphasis="muted" />}
          </IconButton>
        </Tooltip>
      )}
      {(c.kind === "thread" || c.kind === "trial") && (
        <IconButton
          size="md"
          variant="ghost"
          label={`${T.contextThread}로 가기`}
          onClick={() => onGoToThread?.(c.threadId)}
        >
          <MessageSquare />
        </IconButton>
      )}
    </div>
  );
}

/** 폴더 안 "시험" 묶음(계획에 없음 4): 시험 대화를 한 행으로 접고, 펼치면 시험 대화마다 상태(실행 중·멈춤·끝남). */
function TrialFold({
  items,
  list,
  onClear,
}: {
  items: Thread[];
  list: ThreadListProps;
  onClear: () => void;
}) {
  const live = items.filter((t) => t.trial?.state === "running" || t.trial?.state === "pausing");
  const paused = items.filter((t) => t.trial?.state === "paused");
  const done = items.filter((t) => t.trial?.state === "done");
  const hasCurrent = items.some((t) => t.id === list.currentId);
  const meta = [
    live.length > 0 ? `${TRIAL_WORD.running} ${live.length}` : null,
    paused.length > 0 ? `${TRIAL_WORD.paused} ${paused.length}` : null,
  ]
    .filter((x) => x !== null)
    .join(" · ");
  return (
    <ListNavigationItem
      icon={<FlaskConical emphasis="muted" />}
      meta={meta === "" ? undefined : meta}
      count={items.length}
      defaultExpanded={hasCurrent || list.trialsOpen === true}
      aria-label={`${T.trialThread} ${items.length}개${meta === "" ? "" : `, ${meta}`}`}
      sub={
        <>
          {items.map((t) => (
            <ListNavigationSubItem
              key={t.id}
              current={list.draft !== true && list.currentId === t.id}
              onClick={() => list.onSelect(t.id)}
            >
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="min-w-0 truncate">{L(t.title)}</span>
                {t.trial !== undefined && (
                  <span
                    className={`ms-auto shrink-0 text-ui-xs ${
                      t.trial.state === "paused" || t.trial.state === "pausing"
                        ? "text-text-secondary"
                        : "text-text-tertiary"
                    }`}
                  >
                    {TRIAL_WORD[t.trial.state]}
                  </span>
                )}
              </span>
            </ListNavigationSubItem>
          ))}
          {done.length > 0 && (
            <ListNavigationSubItem onClick={onClear}>
              <span className="text-text-tertiary">
                {L("끝난 시험 지우기…").replace("시험", T.trial)} {done.length}
              </span>
            </ListNavigationSubItem>
          )}
        </>
      }
    >
      {T.trial}
    </ListNavigationItem>
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
      <ListNavigation aria-label={L("작업대 내비게이션")} kind="navigation" size="sm">
        <ListNavigationGroup>
          {items.map((n) => (
            <ListNavigationItem
              key={n.id}
              icon={navIcon(n.id, n.id === activeNav)}
              className={n.id === activeNav ? ACTIVE_LABEL : undefined}
              aria-label={`${n.label}${n.badgeLabel !== undefined ? `, ${n.badgeLabel}` : ""}${
                n.id === activeNav ? `, ${L("지금 화면")}` : ""
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
      <ListNavigation aria-label={T.pluginView} kind="navigation" size="sm" as="div">
        <ListNavigationGroup heading={T.pluginView}>
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
                      {p.disabled === true ? L("꺼짐") : p.ext}
                    </span>
                  }
                  onSelect={() => onNavSelect?.(p.id)}
                >
                  {L(p.label)}
                </ListNavigationItem>
              )),
          )}
        </ListNavigationGroup>
      </ListNavigation>
    </div>
  );
}

/** 대화 행 메뉴 버튼(묶음 D). caustic ListNavigationItem에 행 동작 자리가 없어(gap), 행 바로 뒤 높이 0인 li에 버튼을 겹친다.
 *  hover·초점·고른 행·메뉴 열림일 때만 보인다(shell.css [data-row-menu]). 버튼 안에 버튼을 넣지 않는다(접근성). */
function RowMenu({ t, list, current }: { t: Thread; list: ThreadListProps; current: boolean }) {
  const [open, setOpen] = useState(list.menuOpenId === t.id);
  if (list.rowMenu === undefined) return null;
  const name = t.title === "" ? L("제목 없음") : t.title;
  return (
    <li
      data-row-menu=""
      data-open={open ? "" : undefined}
      data-current={current ? "" : undefined}
      className="pointer-events-none relative -mt-control-sm flex h-control-sm list-none items-center justify-end pe-1"
    >
      <Menu
        size="sm"
        side="bottom"
        align="end"
        open={open}
        onOpenChange={setOpen}
        aria-label={`${name} ${L("메뉴")}`}
        trigger={
          <IconButton
            size="xs"
            variant="ghost"
            label={`${name} ${L("메뉴")}`}
            className="pointer-events-auto bg-control-raised shadow-[inset_0_0_0_1px_var(--cs-color-control-edge)]"
          >
            <Ellipsis />
          </IconButton>
        }
      >
        {list.rowMenu(t)}
      </Menu>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div aria-label="대화 목록 읽는 중" role="status" className="grid gap-1.5 px-2 pt-1">
      {[70, 55, 82, 48, 64].map((w) => (
        <Skeleton key={w} className="h-4" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export function StartPanel({
  floating,
  activeNav,
  onNavSelect,
  threads: rawList,
  workbench,
  nav = defaultNav,
}: StartPanelProps) {
  const m = useShell();
  const [cleared, setCleared] = useState(false);
  const all = rawList.items ?? defaultThreads;
  const threads = cleared ? all.filter((t) => t.trial?.state !== "done") : all;
  // 대화를 고르면 작업대 보기 기준이 따라간다(고정이 아닐 때, 결정 11).
  const list: ThreadListProps = {
    ...rawList,
    onSelect: (id) => {
      m.followThread(id);
      rawList.onSelect(id);
    },
  };
  // 페이지가 onClearTrials를 주면 확인과 지우기는 페이지가 맡는다(items로 돌려준다). 없으면 셸이 목록에서만 숨긴다.
  const clearTrials = () => {
    if (rawList.onClearTrials !== undefined) rawList.onClearTrials();
    else setCleared(true);
  };
  const folders = [...new Set(threads.map((t) => t.folder))];
  const wb = m.area === "workbench";

  return (
    <SidePanel
      side="start"
      preset="inspector"
      label={wb ? L("작업대 이동") : L("대화와 이동")}
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
              placeholder={L("찾기")}
              aria-label={L("명령 또는 대화 찾기")}
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
              label={L("사이드바 닫기")}
              onClick={() => m.setStartOpen(false)}
            >
              <PanelLeft />
            </IconButton>
          </div>
          <AreaSwitch />
          {wb && <ContextPicker onGoToThread={workbench?.onGoToThread} />}
        </div>
      }
      footer={
        <ListNavigation aria-label="설정" kind="navigation" size="sm" as="div" className="w-full">
          <ListNavigationGroup>
            {/* 설정 화면(P-09~P-13)에서는 주 내비 항목처럼 굵기와 selected 아이콘으로 지금 화면을 보인다. */}
            <ListNavigationItem
              icon={activeNav === "settings" ? <Settings emphasis="selected" /> : <Settings />}
              aria-label={activeNav === "settings" ? `${L("설정")}, ${L("지금 화면")}` : L("설정")}
              className={
                activeNav === "settings"
                  ? "[&_[data-slot=list-navigation-label]]:font-semibold [&_[data-slot=list-navigation-label]]:text-text-primary"
                  : undefined
              }
              onSelect={() => onNavSelect?.("settings")}
            >
              {L("설정")}
            </ListNavigationItem>
          </ListNavigationGroup>
        </ListNavigation>
      }
    >
      {wb ? (
        <WorkbenchNavList activeNav={activeNav} onNavSelect={onNavSelect} workbench={workbench} />
      ) : (
        <div className="grid gap-2 px-1.5 pb-2">
          <ListNavigation aria-label={L("주 내비게이션")} kind="navigation" size="sm">
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

          {list.listState === "loading" && <ListSkeleton />}
          {list.listState === "error" && (
            <EmptyState
              size="sm"
              surface="none"
              title={L("대화 목록을 읽지 못했어요")}
              actions={
                <Button size="xs" tone="neutral" variant="outline" onClick={list.onRetry}>
                  {L("다시 읽기")}
                </Button>
              }
            />
          )}
          {list.listState === undefined && threads.length === 0 && list.draft !== true && (
            <EmptyState
              size="sm"
              surface="none"
              title={L("아직 대화가 없어요")}
              actions={
                <Button size="xs" tone="neutral" variant="outline" onClick={list.onNew}>
                  {L("새 대화")}
                </Button>
              }
            />
          )}
          {list.listState === undefined && (
            <ListNavigation
              aria-label={L("대화 목록")}
              kind="sessions"
              size="sm"
              as="div"
              className={list.dimmed === true ? "opacity-60" : undefined}
            >
              {list.draft === true && (
                <ListNavigationGroup heading={L("새로 시작")}>
                  <ListNavigationItem current meta={L("작성 전")}>
                    {L("새 대화")}
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
                  addLabel={`${L("새 대화")} · ${folder}`}
                  onAdd={list.onNew}
                >
                  {threads
                    .filter((t) => t.folder === folder && t.trial === undefined)
                    .flatMap((t) => [
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
                        {t.title === "" ? L("제목 없음") : L(t.title)}
                      </ListNavigationItem>,
                      ...(list.rowMenu !== undefined
                        ? [
                            <RowMenu
                              key={`${t.id}-menu`}
                              t={t}
                              list={list}
                              current={list.draft !== true && list.currentId === t.id}
                            />,
                          ]
                        : []),
                    ])}
                  {threads.some((t) => t.folder === folder && t.trial !== undefined) && (
                    <TrialFold
                      items={threads.filter((t) => t.folder === folder && t.trial !== undefined)}
                      list={list}
                      onClear={clearTrials}
                    />
                  )}
                </ListNavigationGroup>
              ))}
            </ListNavigation>
          )}
          {list.listState === undefined && list.more !== undefined && (
            <Button
              size="xs"
              tone="neutral"
              variant="ghost"
              className="justify-self-start"
              loading={list.more.loading === true}
              onClick={list.more.onMore}
            >
              {list.more.label}
            </Button>
          )}
        </div>
      )}
    </SidePanel>
  );
}

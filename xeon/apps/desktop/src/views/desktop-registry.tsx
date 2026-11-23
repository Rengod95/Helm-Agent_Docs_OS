import {
  CalendarClock,
  CodeXml,
  Compass,
  Component,
  Inbox,
  Layers,
  LayoutGrid,
  Lightbulb,
  Link,
  ListChecks,
  MessageSquare,
  Play,
  SquarePen,
  WandSparkles,
} from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import {
  ScrollArea,
  Select,
  SelectOption,
  SegmentedControl,
  SegmentedControlItem,
} from "@caustic/react";
import { ApprovalQueue, InboxApprovals, useInboxThreads, type InboxFilter } from "./approvals.tsx";
import { INBOX_SORTS, inboxThreadOf, type InboxSort, type InboxThread } from "./inbox-model.ts";
import { useNoticeFeed } from "./notices.tsx";
import { useProposalPending } from "./proposal-pending-context.tsx";
import { ChatHeader } from "./chat-header.tsx";
import { ChatLoadError } from "./chat-load-error.tsx";
import { ProjectNotices } from "./project/project-notices.tsx";
import { NowStrip } from "./now/now-strip.tsx";
import { Composer } from "./composer.tsx";
import { ComposerBeam, ThreadLoadBeam } from "./effects/convo-beam.tsx";
import { CrystalMark } from "./effects/crystal-mark.tsx";
import { SafeModeCard } from "./safe-mode-card.tsx";
import { SetupBanner } from "./setup-banner.tsx";
import { SpawnedNotice } from "./spawned-notice.tsx";
import { StoreReplacedBanner } from "./store-replaced-banner.tsx";
import { SchedulesScreen } from "./pages/schedules/schedules-screen.tsx";
import { useFailedScheduleCount } from "./pages/schedules/schedule-badge.ts";
import { ConnectionScreen } from "./pages/connection/connection-screen.tsx";
import { FirstRunScreen } from "./pages/first-run/first-run-screen.tsx";
import { ProposalsScreen } from "./pages/proposals/proposals-screen.tsx";
import { ReviewScreen } from "./pages/review/review-screen.tsx";
import { TasksSummary, TasksTab } from "./panels/tasks/tasks-tab.tsx";
import { RunningSummary, RunningTab } from "./panels/running/running-tab.tsx";
import { SecretsPanel } from "./pages/secrets/secrets-screen.tsx";
import { TrustCard } from "./trust.tsx";
import { ThreadContextBar } from "./thread-context-bar.tsx";
import { Transcript } from "./transcript.tsx";
import {
  createShellRegistry,
  type EndTabDef,
  type ScreenDef,
  type ShellRegistry,
} from "./shell/registry.ts";
import { HEADER_SELECT_SIZE, HEADER_SEGMENTED_SIZE, ScreenHeader } from "./shell/screen-header.tsx";
import { createWorkbenchStore, WorkbenchStoreContext } from "../state/workbench/index.ts";
import {
  inspectEndTab,
  pluginPagesEndTab,
  registerWorkbench,
  runtimeEndTab,
} from "./workbench/index.tsx";
import { ChatWithRecords } from "./workbench/records-jump.tsx";
import { HelmPanelTab } from "./plugin/plugin-tabs.tsx";
import { AddonsScreen } from "./plugin/addons-screen.tsx";
import { PLAYGROUND_TAB_SCREEN } from "./plugin/playground-tab-store.ts";
import { PlaygroundTabScreen } from "./plugin/playground-tab-screen.tsx";
import { ChangesTab } from "./panels/changes/changes-tab.tsx";
import { ArtifactTab } from "./artifact/artifact-tab.tsx";
import { ContextTab } from "./panels/context/context-tab.tsx";
import { ARTIFACT_TAB_ID, CHANGES_TAB_ID, CONTEXT_TAB_ID } from "./panels/tab-ids.ts";
import {
  useApprovalCount,
  useOpenThread,
  useRunningThreadCount,
  useThreadIds,
  useTranscriptStatus,
} from "../state/engine/index.ts";
import { useState, type ReactNode } from "react";

// 지금 만들어져 있는 화면만 등록한다. 나머지 화면 id는 셸이 "아직 없어요" 빈 상태로 그린다.
// 화면 트랙은 여기에 `registerScreen`·`registerEndTab`을 더한다(shell/README.md).

/**
 * 대화 화면. 입력창 위 쌓임(DP-100 [결정: 2026-11-11 사용자]), 위에서 아래로:
 * 1. 행동 카드(신뢰 확인, 승인 대기열, 안전 모드): 사용자가 답해야 하는 것. 승인 대기열은 화면 높이의 50%까지, 넘치면 안쪽 스크롤(approvals.tsx).
 * 2. 지금 띠: 목표·할 일·하위 에이전트·주도의 한 줄. 펼치면 본문 240px까지.
 * 3. 대화 맥락 줄(DP-71): 입력창 바로 위에 붙는다.
 * 4. 입력창(그 안의 대기 입력·재시도·오류 줄은 입력창에 붙는다).
 * 1·2는 한 그릇(`data-chat-stack`)에 쌓이고 사이 간격은 그릇의 gap 하나(8px)다(DP-225 [결정: 2026-11-20 사용자, AGE-65]): 부품은 바깥 여백을
 * 갖지 않아 몇 개가 어떤 조합으로 와도 간격이 같고 서로 겹치지 않는다. 높이가 모자라면 승인 대기열만 줄고(카드 안쪽이 스크롤),
 * 대화 기록은 128px 아래로 밀리지 않는다.
 * 대화를 읽지 못했으면 대화 기록 자리에 오류 상태(`ChatLoadError`)를 그린다(DP-102)
 */
function ChatScreen(): ReactNode {
  const spawned = useOpenThread()?.spawnedBy !== undefined;
  const transcript = useTranscriptStatus();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 대화를 불러오는 동안 머리 줄 아래를 빛이 흐르고, 턴이 도는 동안 입력창 테두리를 빛이 돈다(DP-107) */}
      <ThreadLoadBeam>
        <ChatHeader />
      </ThreadLoadBeam>
      <SetupBanner />
      <StoreReplacedBanner />
      {/* 대화 기록의 바닥 높이(128px): 입력창 위 쌓임이 커져도 대화 내용이 0이 되도록 밀리지 않는다(DP-225) */}
      <div data-chat-rail-gap="" className="flex min-h-32 flex-1 flex-col">
        {transcript === "error" ? <ChatLoadError /> : <Transcript />}
      </div>
      {/* 대화 열 폭(시안 46rem)에 맞춰 입력창 위 카드들을 같은 가운데 열에 둔다. 무대가 좁으면 대화 기록처럼 오른쪽 막대 자리를 비운다(`data-chat-rail-gap`, DP-135) */}
      {/* 토스트는 이 묶음(카드와 입력창) 위에 선다. 묶음의 위쪽 끝을 알려 입력창 모델 고르기 단추를 가리지 않게 한다(shell.tsx useToastBottom) */}
      <div data-toast-avoid data-chat-rail-gap="" className="flex min-h-0 flex-col">
        <div className="mx-auto flex min-h-0 w-full max-w-184 flex-col">
          {/* 쌓임 그릇(DP-225): 부품 사이와 맥락 줄 위가 모두 8px다. 줄어드는 것은 승인 대기열 하나이고 나머지는 제 높이를 지킨다 */}
          <div
            data-chat-stack=""
            className="flex min-h-0 flex-col gap-2 px-3 pb-2 empty:hidden [&>*]:shrink-0 [&>:has(>[data-approval-band])]:shrink"
          >
            <TrustCard />
            <ApprovalQueue />
            <SafeModeCard />
            {spawned ? null : <ProjectNotices />}
            {spawned ? null : <NowStrip />}
          </div>
          {/* 대화 맥락 줄(DP-71)은 입력창 바로 위에 붙는다. 폴더가 없어졌다는 경고도 이 줄의 폴더 칸이 보인다 */}
          <ThreadContextBar />
        </div>
        <ComposerBeam>{spawned ? <SpawnedNotice /> : <Composer />}</ComposerBeam>
      </div>
    </div>
  );
}

function InboxTab(): ReactNode {
  return <InboxApprovals />;
}

/** 받은 요청 화면(시안 p03). 왼쪽 내비에서 뺐다(진입은 오른쪽 툴바 탭). 화면 등록은 남아 있다. 끝 영역 탭과 같은 목록을 그린다 */
function InboxScreen(): ReactNode {
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [thread, setThread] = useState<InboxThread>("all");
  const [sort, setSort] = useState<InboxSort>("oldest");
  // 알림 목록은 이 화면이 한 번 읽고, 대화 셀렉트와 알림 구역이 같이 쓴다
  const feed = useNoticeFeed();
  const threads = useInboxThreads(feed.entries);
  // 고른 대화가 승인도 알림도 없어졌으면 셀렉트와 목록 모두 `모든 대화`로 본다(inbox-model의 inboxThreadOf)
  const threadValue = inboxThreadOf(
    thread,
    threads.map((choice) => choice.id),
  );
  return (
    <section aria-labelledby="inbox-heading" className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        title={t("desktop.shell.nav.inbox")}
        titleId="inbox-heading"
        controls={
          <>
            <SegmentedControl
              aria-label={t("desktop.inbox.filter.label")}
              size={HEADER_SEGMENTED_SIZE}
              value={filter}
              onValueChange={(v) => {
                setFilter(v === "approvals" || v === "notices" ? v : "all");
              }}
            >
              <SegmentedControlItem value="all">
                {t("desktop.inbox.filter.all")}
              </SegmentedControlItem>
              <SegmentedControlItem value="approvals">
                {t("desktop.inbox.filter.approvals")}
              </SegmentedControlItem>
              <SegmentedControlItem value="notices">
                {t("desktop.inbox.filter.notices")}
              </SegmentedControlItem>
            </SegmentedControl>
            <Select
              size={HEADER_SELECT_SIZE}
              aria-label={t("desktop.inbox.thread.label")}
              value={threadValue}
              onValueChange={(value) => {
                if (value === "all") {
                  setThread("all");
                  return;
                }
                const next = threads.find((choice) => choice.id === value);
                if (next !== undefined) setThread(next.id);
              }}
              className="w-36"
            >
              <SelectOption value="all">{t("desktop.inbox.thread.all")}</SelectOption>
              {threads.map((choice) => (
                <SelectOption key={choice.id} value={choice.id}>
                  {choice.title ?? t("desktop.approvals.card.thread.untitled")}
                </SelectOption>
              ))}
            </Select>
            <Select
              size={HEADER_SELECT_SIZE}
              aria-label={t("desktop.inbox.sort.label")}
              value={sort}
              onValueChange={(value) => {
                const next = INBOX_SORTS.find((item) => item === value);
                if (next !== undefined) setSort(next);
              }}
              className="w-32"
            >
              <SelectOption value="oldest">{t("desktop.inbox.sort.oldest")}</SelectOption>
              <SelectOption value="newest">{t("desktop.inbox.sort.newest")}</SelectOption>
            </Select>
          </>
        }
      />
      <ScrollArea label={t("desktop.shell.nav.inbox")} className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-184 px-3 pb-4 pt-1">
          <InboxApprovals show={filter} thread={threadValue} sort={sort} feed={feed} />
        </div>
      </ScrollArea>
    </section>
  );
}

const INBOX_SCREEN: ScreenDef = {
  id: "inbox",
  area: "chat",
  label: "desktop.shell.nav.inbox",
  icon: <Inbox />,
  Badge: (p) => p.render(useApprovalCount()),
  render: () => <InboxScreen />,
};

const CHAT_SCREEN: ScreenDef = {
  id: "chat",
  area: "chat",
  label: "desktop.shell.nav.chat",
  icon: <MessageSquare />,
  Badge: (p) => p.render(useThreadIds().length),
  render: () => <ChatScreen />,
};

// 내비 배지는 마지막 실행이 실패한 예약 수다(0이면 안 보인다). 수는 `schedule-badge.ts`가 읽는다
const SCHEDULES_SCREEN: ScreenDef = {
  id: "schedules",
  area: "chat",
  label: "desktop.shell.nav.schedules",
  icon: <CalendarClock />,
  Badge: (p) => p.render(useFailedScheduleCount()),
  render: () => <SchedulesScreen />,
};

/**
 * 제안 내비 줄의 크리스탈 표시(DP-223 [결정: 2026-11-18 사용자 "내비 옆에도 괜찮을듯"]). 검토를 기다리는 제안이 있을 때만 보이고,
 * 내비에서 이 줄 하나만 표시를 단다(받은 요청은 오른쪽 막대 탭이라 내비 줄이 없다, DP-192). 낭독 이름은 기다리는 제안 수다
 */
function ProposalsMark(): ReactNode {
  const count = useProposalPending().count;
  return (
    <CrystalMark
      present={count > 0}
      count={count}
      size={14}
      label={t("desktop.attention.proposals", { count })}
    />
  );
}

// 내비 배지는 대기 제안 수다(0이면 안 보인다). 수는 `ProposalPendingProvider`가 읽는다(SC-06 1단계)
const PROPOSALS_SCREEN: ScreenDef = {
  id: "proposals",
  area: "chat",
  label: "desktop.shell.nav.proposals",
  icon: <Lightbulb />,
  Mark: ProposalsMark,
  Badge: (p) => p.render(useProposalPending().count),
  render: () => <ProposalsScreen />,
};

const CONNECTION_SCREEN: ScreenDef = {
  id: "connection",
  area: "chat",
  label: "desktop.shell.nav.connection",
  icon: <Link />,
  render: () => <ConnectionScreen />,
};

// 플레이그라운드(내비 항목 하나, 화면 id `plugins`)은 대화 영역에 산다. 확장 상세의 "플레이그라운드에서 보기"도 여기로 간다(ext-detail.tsx).
// "관리"·"플러그인 만들기"가 크래프트 스토어를 쓰므로 등록할 때 워크벤치 스토어로 감싼다
const PLUGINS_SCREEN: ScreenDef = {
  id: "plugins",
  area: "chat",
  label: "desktop.shell.nav.plugins",
  icon: <WandSparkles />,
  render: () => <AddonsScreen />,
};

// 시크릿 화면은 내비 항목이 없다(`nav.ts`에 없음). 설정 화면이 `SecretsPanel`을 넣어 연다.
const SECRETS_SCREEN: ScreenDef = {
  id: "secrets",
  area: "both",
  label: "desktop.secrets.title",
  render: () => <SecretsPanel />,
};

// 첫 실행 화면(P-01)은 내비 항목이 없다. "설정 필요" 띠의 "설정 열기"가 무대에 연다(setup-banner.tsx).
const FIRST_RUN_SCREEN: ScreenDef = {
  id: "first-run",
  area: "both",
  label: "desktop.firstRun.title",
  render: () => <FirstRunScreen />,
};

// 변경 검토 화면(P-04)은 내비 항목이 없다. 승인 카드의 "검토 열기"가 UI 스토어에 검토 승인을 두고, App이 무대를 이 화면으로 옮긴다.
const REVIEW_SCREEN: ScreenDef = {
  id: "review",
  area: "both",
  label: "desktop.review.title",
  render: () => <ReviewScreen />,
};

/** 받은 요청 well 머리 요약(DP-193): "승인 2개가 기다려요", 없으면 "기다리는 요청이 없어요". 문장에 수가 있어 표시를 붙이지 않는다(DP-211) */
function InboxSummary(): ReactNode {
  const count = useApprovalCount();
  if (count === 0) return t("desktop.shell.end.inboxSummary.none");
  return t("desktop.shell.end.inboxSummary.waiting", { count });
}

// 오른쪽 막대의 고정 탭 다섯(DP-192). 플러그인과 무관한 하네스 공통 기능이고 순서·자리가 바뀌지 않는다:
// 받은 요청 · 작업 · 실행 중 · 변경 · 컨텍스트. 플러그인이 더한 패널은 구분선 뒤 "플러그인" 단추의 2차 메뉴로 간다(DP-194)
const INBOX_TAB: EndTabDef = {
  id: "inbox",
  area: "both",
  label: "desktop.shell.nav.inbox",
  icon: <Inbox />,
  shortcut: "panel.inbox",
  width: 400,
  Count: (p) => p.render(useApprovalCount()),
  Summary: () => <InboxSummary />,
  render: () => <InboxTab />,
};

// 작업 탭(P-14, DP-195). 열린 대화의 목표·계획과 작업 판(거울), 대화가 없으면 열린 작업이 있는 최근 대화들(⌘⇧T)
const WORK_TAB: EndTabDef = {
  id: "work",
  area: "chat",
  label: "desktop.work.tab",
  icon: <ListChecks />,
  shortcut: "panel.work",
  width: 360,
  Summary: () => <TasksSummary />,
  render: () => <TasksTab />,
};

// 실행 중 탭(DP-196). 모든 대화의 도는 턴·하위 에이전트·예약 실행, 기다림, 방금 끝남(⌘⇧R). 두 영역 모두에 있다
const RUNNING_TAB: EndTabDef = {
  id: "running",
  area: "both",
  label: "desktop.running.tab",
  icon: <Play />,
  shortcut: "panel.running",
  width: 380,
  Count: (p) => p.render(useRunningThreadCount()),
  Summary: () => <RunningSummary />,
  render: () => <RunningTab />,
};

// 변경 탭(DP-198~200): 이 대화가 바꾼 파일을 전체와 턴별로, 턴 끝으로 대화 되감기
const CHANGES_TAB: EndTabDef = {
  id: CHANGES_TAB_ID,
  area: "chat",
  label: "desktop.changes.tab",
  icon: <SquarePen />,
  width: 440,
  screens: ["chat"],
  render: () => <ChangesTab />,
};

// 아티팩트 탭(artView, AGE-77): 모델이 만든 HTML, SVG, 그림, 마크다운을 가둔 틀에 그린다. 판 전체를 쓰고 넓게 펼 수 있다
const ARTIFACT_TAB: EndTabDef = {
  id: ARTIFACT_TAB_ID,
  area: "chat",
  label: "desktop.artifact.tab",
  icon: <CodeXml />,
  width: 480,
  wideWidth: 880,
  fill: true,
  screens: ["chat"],
  render: () => <ArtifactTab />,
};

// 컨텍스트 탭(DP-201~203): 채움과 자동 요약 문턱, 턴별 구성, 요약 기록, 토큰·비용, 실린 것
const CONTEXT_TAB: EndTabDef = {
  id: CONTEXT_TAB_ID,
  area: "chat",
  label: "desktop.context.tab",
  icon: <Layers />,
  width: 360,
  screens: ["chat"],
  render: () => <ContextTab />,
};

/** 크래프트 화면 셋(개요·확장·엔진)은 `registerWorkbench`가 등록한다. 개요는 캔버스 하나이고 목록을 못 읽으면 띠가 상태를 보인다 */
export function createDesktopRegistry(): ShellRegistry {
  const registry = createShellRegistry();
  // 워크벤치 스토어는 대화 화면(행의 "기록 보기"), 플러그인 탭, 크래프트 화면이 같이 읽으므로 화면과 탭 등록보다 먼저 만든다
  const workbench = createWorkbenchStore();
  registry.registerScreen({
    ...CHAT_SCREEN,
    wellBeside: true,
    render: () => (
      <ChatWithRecords store={workbench}>
        <ChatScreen />
      </ChatWithRecords>
    ),
  });
  registry.registerScreen(INBOX_SCREEN);
  registry.registerScreen(SCHEDULES_SCREEN);
  registry.registerScreen(PROPOSALS_SCREEN);
  registry.registerScreen(CONNECTION_SCREEN);
  registry.registerScreen({
    ...PLUGINS_SCREEN,
    render: () => (
      <WorkbenchStoreContext value={workbench}>
        <AddonsScreen />
      </WorkbenchStoreContext>
    ),
  });
  // 머리 줄 플레이그라운드 탭의 화면(DP-90). 내비 항목이 없고, 한 번 열면 내리지 않는다(상태 유지)
  registry.registerScreen({
    id: PLAYGROUND_TAB_SCREEN,
    area: "chat",
    label: "desktop.shell.nav.plugins",
    keepAlive: true,
    render: () => (
      <WorkbenchStoreContext value={workbench}>
        <PlaygroundTabScreen />
      </WorkbenchStoreContext>
    ),
  });
  registry.registerScreen(SECRETS_SCREEN);
  registry.registerScreen(FIRST_RUN_SCREEN);
  registry.registerScreen(REVIEW_SCREEN);
  // 막대 순서(DP-192): 받은 요청 · 작업 · 실행 중 · 변경 · 컨텍스트 | 플러그인. 크래프트 영역은 받은 요청 · 실행 중 · 검사
  registry.registerEndTab(INBOX_TAB);
  registry.registerEndTab(WORK_TAB);
  registry.registerEndTab(RUNNING_TAB);
  registry.registerEndTab(CHANGES_TAB);
  registry.registerEndTab(ARTIFACT_TAB);
  registry.registerEndTab(CONTEXT_TAB);
  // 플러그인 2차 메뉴(DP-194). 첫 묶음은 플러그인이 기여한 패널이고 Helm이 이 자리의 첫 소비자다(내용 `HelmPanelTab`은 그대로)
  registry.registerPluginEndTab({
    id: "helm",
    area: "chat",
    source: "plugin",
    label: "desktop.plugin.tab.helm",
    description: "desktop.plugin.tab.helmDescription",
    icon: <Compass />,
    shortcut: "panel.helm",
    render: () => <HelmPanelTab />,
  });
  // 둘째 묶음은 호스트가 그리는 이 대화의 플러그인 상태다: 옛 "런타임"(§4.9.8: 주도 락, 켜진 그룹과 확장, 실패)과 옛 "플러그인"(알림, 프로필, 화면 목록).
  // 탭 id(`runtime`, `plugin-pages`)는 그대로라 상태 줄·대화 머리의 링크가 계속 연다
  registry.registerPluginEndTab({
    ...runtimeEndTab(workbench),
    source: "host",
    label: "desktop.shell.end.runtimeName",
    description: "desktop.shell.end.runtimeDescription",
    icon: <Component />,
  });
  registry.registerPluginEndTab({
    ...pluginPagesEndTab(workbench),
    source: "host",
    label: "desktop.shell.end.pagesName",
    description: "desktop.shell.end.pagesDescription",
    icon: <LayoutGrid />,
  });
  registerWorkbench(registry, workbench);
  registry.registerEndTab(inspectEndTab(workbench));
  return registry;
}

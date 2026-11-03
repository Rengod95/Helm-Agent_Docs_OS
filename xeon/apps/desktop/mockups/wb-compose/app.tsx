// 블록 구성기 시안 앱: 공용 셸(크래프트 영역) 위에 구성기 한 화면. 크래프트 내비 "구성" 하나가 구성기를 연다(새 플러그인 그룹은 구성 안의 동작).
// 보기는 화면 머리의 SegmentedControl(플러그인 그룹·흐름·프로필·코드). 머리 설명은 한 줄만(개수·명령·사용법 없음). 주요 동작 하나만 solid.
// 블록 팔레트와 속성은 오른쪽 well 탭(§4.9.3). 캔버스 보기(그룹·흐름)는 머리와 캔버스 사이에 가로 경계선을 긋는다(parts/rail.tsx). 세로 레일은 두지 않는다.
import {
  Button,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
} from "@caustic/react";
import { useEffect, type ReactNode } from "react";
import {
  NoticeList,
  Shell,
  SlidersHorizontal,
  SquareStack,
  T,
  WorkbenchHead,
  defaultStatusCells,
  inbox,
  useShell,
  workbenchRightTabs,
  type RightTab,
} from "../_shell";
import { RailRule } from "./parts/rail";
import { CodeView } from "./screens/code";
import { FlowCanvas, TrialBar } from "./screens/flow";
import { GroupCanvas } from "./screens/group";
import { FlowOutline, GroupOutline } from "./screens/outline";
import { ProfileStack } from "./screens/profile";
import { InspectTab, PaletteTab } from "./parts/well";
import { useMock, type View } from "./store";

const VIEWS: View[] = ["group", "flow", "profile", "code"];
const isView = (v: string): v is View => VIEWS.some((x) => x === v);

function Notice() {
  const m = useMock();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center"
    >
      {m.notice !== null && (
        <span className="animate-enter rounded-lg bg-surface-raised px-3 py-1.5 text-ui-dense text-text-primary shadow-3">
          {m.notice}
        </span>
      )}
    </div>
  );
}

function ViewSwitch() {
  const m = useMock();
  return (
    <SegmentedControl
      size="xs"
      value={m.view}
      onValueChange={(v) => {
        if (isView(v)) m.set({ view: v, trial: false, draft: false });
      }}
      aria-label="구성기 보기"
    >
      <SegmentedControlItem value="group">{T.group}</SegmentedControlItem>
      <SegmentedControlItem value="flow">{T.composeFlow}</SegmentedControlItem>
      <SegmentedControlItem value="profile">{T.profile}</SegmentedControlItem>
      <SegmentedControlItem value="code">{T.composeCode}</SegmentedControlItem>
    </SegmentedControl>
  );
}

function Head() {
  const m = useMock();
  const shell = useShell();
  const compact = shell.layout === "compact";
  const draft = m.group === "lens-review";
  let meta: string | undefined;
  let sub: ReactNode;
  let action: ReactNode = null;
  if (m.view === "group") {
    if (m.group === "new") {
      meta = `새 ${T.group}`;
    } else if (draft) {
      meta = "lens-review";
      sub = "작성 중이에요";
      action = (
        <Button size="xs" variant="outline" disabled>
          {T.trialThread}로
        </Button>
      );
    } else {
      meta = "helm";
      sub = `설치된 ${T.group}이라 읽기 전용이에요`;
      action = (
        <Button
          size="xs"
          variant="solid"
          onClick={() => m.set({ group: "lens-review", selected: "drive2" })}
        >
          복제해서 고치기
        </Button>
      );
    }
  } else if (m.view === "flow") {
    meta = draft ? "lens-review" : "helm";
    if (!m.trial && !draft)
      action = (
        <Button size="xs" variant="solid" onClick={() => m.set({ trial: true, selected: null })}>
          {T.trialThread}에서 돌려 보기
        </Button>
      );
  } else if (m.view === "profile") {
    action = (
      <Select size="xs" defaultValue="explore" aria-label={T.profile} className="w-40">
        <SelectOption value="explore">탐구 중심</SelectOption>
        <SelectOption value="quiet">조용히</SelectOption>
        <SelectOption value="review-trial">review 테스트</SelectOption>
      </Select>
    );
  } else {
    meta = "lens-review";
  }
  return (
    <WorkbenchHead
      className="w-full px-4"
      title={T.compose}
      meta={meta}
      actions={
        compact ? (
          <ViewSwitch />
        ) : (
          <span className="flex items-center gap-2">
            {action}
            <ViewSwitch />
          </span>
        )
      }
      {...(sub !== undefined && !compact ? { sub } : {})}
    />
  );
}

function Body() {
  const m = useMock();
  const shell = useShell();
  const compact = shell.layout === "compact";
  if (m.view === "profile") return <ProfileStack />;
  if (m.view === "code") return <CodeView />;
  if (compact) return m.view === "flow" ? <FlowOutline /> : <GroupOutline />;
  if (m.view === "flow")
    return (
      <>
        {m.trial && <TrialBar />}
        {m.trial && <RailRule />}
        <FlowCanvas />
      </>
    );
  return <GroupCanvas />;
}

/** 가운데: 바깥 여백 없이 영역 양 끝까지 쓰고, 안쪽 여백 16(머리·보기 본문 px-4)만 둔다. 보기를 바꿔도 머리 자리가 같아 흔들리지 않는다.
 *  캔버스 보기는 머리 아래에 가로 경계선을 긋고, 프로필 보기의 선 격자 띠는 가장자리까지 닿는다. */
function Stage() {
  const m = useMock();
  const shell = useShell();
  const canvas = shell.layout !== "compact" && (m.view === "group" || m.view === "flow");
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Head />
      {canvas && <RailRule />}
      <Body />
      <Notice />
    </div>
  );
}

export function App() {
  const m = useMock();
  const shell = useShell();
  useEffect(() => {
    if (m.closeStart && shell.layout === "wide") shell.setStartOpen(false);
    // 처음 한 번만(S5: 왼쪽 패널을 닫아 캔버스 폭을 얻는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const base = workbenchRightTabs({
    inbox: <NoticeList notices={inbox.notices} />,
    inboxBadge: 5,
    onGoToThread: () => shell.setArea("chat"),
  });
  const mine: RightTab[] = [
    { id: "palette", label: T.block, icon: <SquareStack />, content: <PaletteTab /> },
    { id: "inspect", label: "속성", icon: <SlidersHorizontal />, content: <InspectTab /> },
  ];
  const [first, ...rest] = base;
  const tabs = first === undefined ? mine : [first, ...mine, ...rest];
  return (
    <Shell
      activeNav="compose"
      onNavSelect={(id) => {
        if (id === "compose")
          m.set({
            group: "helm",
            view: "group",
            trial: false,
            draft: false,
            gateAdded: false,
            selected: "drive",
          });
        else m.notify("이 화면은 다른 크래프트 시안에 있어요");
      }}
      workbench={{ onGoToThread: () => shell.setArea("chat") }}
      stageLabel={T.compose}
      threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
      rightTabs={tabs}
      status={defaultStatusCells({
        layout: shell.layout,
        thread: false,
        pendingApprovals: 2,
        openEnd: shell.openEnd,
        runtime: { drive: "helm", extFailures: 1, onOpen: () => m.notify("크래프트 개요로 가요") },
      })}
    >
      <Stage />
    </Shell>
  );
}

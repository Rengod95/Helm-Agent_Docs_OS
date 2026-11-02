// 블록 구성기 시안 앱: 공용 셸(크래프트 영역) 위에 구성기 한 화면. 크래프트 내비 "구성"(Helm 참고, 흐름, 테스트, 프로필)과
// "만들기"(빈 구성기, 작성 중 그룹, 코드)가 같은 구성기를 연다. 보기는 화면 머리의 SegmentedControl(그룹·흐름·프로필·코드).
// 가운데는 투명한 캔버스(점 격자만), 왼쪽 패널은 내비, 블록 팔레트와 속성은 오른쪽 well 탭(§4.9.3, DP-01·DP-13).
import { Button, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { useEffect } from "react";
import {
  Copy,
  FlaskConical,
  NoticeList,
  Shell,
  SlidersHorizontal,
  SquareStack,
  WorkbenchHead,
  defaultStatusCells,
  inbox,
  useShell,
  workbenchRightTabs,
  type RightTab,
} from "../_shell";
import { CodeView } from "./screens/code";
import { FlowCanvas, TrialBar } from "./screens/flow";
import { GroupCanvas } from "./screens/group";
import { FlowOutline, GroupOutline } from "./screens/outline";
import { ProfileStack } from "./screens/profile";
import { InspectTab, PaletteTab } from "./parts/well";
import { useMock, type View } from "./store";

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
      onValueChange={(v) => m.set({ view: v as View, trial: false, draft: false })}
      aria-label="구성기 보기"
    >
      <SegmentedControlItem value="group">그룹</SegmentedControlItem>
      <SegmentedControlItem value="flow">흐름</SegmentedControlItem>
      <SegmentedControlItem value="profile">프로필</SegmentedControlItem>
      <SegmentedControlItem value="code">코드</SegmentedControlItem>
    </SegmentedControl>
  );
}

function Head() {
  const m = useMock();
  const shell = useShell();
  const compact = shell.layout === "compact";
  const draft = m.group === "lens-review";
  const title = m.nav === "create" ? "만들기" : "구성";
  let meta = "";
  let sub: React.ReactNode;
  let action: React.ReactNode = null;
  if (m.view === "group") {
    if (m.group === "new") {
      meta = "새 그룹";
      sub = "블록을 쌓으면 매니페스트와 drive·정책·관찰 템플릿 하나로 풀려요";
    } else if (draft) {
      meta = "lens-review · 작성 중";
      sub = "블록 7 · 오류 3 · 경고 1 · 맥락 캐시 무효화 조사 · 프로필 조용히";
      action = (
        <Button size="xs" variant="soft" iconStart={<FlaskConical />} disabled>
          테스트 대화로
        </Button>
      );
    } else {
      meta = "helm · 참고 구성";
      sub =
        "설치본 매니페스트와 소스에서 읽었어요 · 블록 7 · 훅 6 · 기능 5(모두 optional) · 공개 기록 3";
      action = (
        <Button
          size="xs"
          variant="soft"
          iconStart={<Copy />}
          onClick={() => m.set({ group: "lens-review", nav: "create", selected: "drive2" })}
        >
          복제해서 고치기
        </Button>
      );
    }
  } else if (m.view === "flow") {
    meta = draft
      ? "lens-review · 단계 머신 편집"
      : m.trial
        ? "helm · 테스트 실행"
        : "helm · 단계 머신";
    sub = m.trial
      ? undefined
      : draft
        ? "converge의 다음 포트를 사람 확인 노드로 끌고 있어요"
        : "단계 5 · 자식 렌즈 3 · 상태 기반 재호출 · 읽기 전용";
    if (!m.trial && !draft)
      action = (
        <Button
          size="xs"
          variant="soft"
          iconStart={<FlaskConical />}
          onClick={() => m.set({ trial: true, selected: null })}
        >
          테스트 대화에서 돌려 보기
        </Button>
      );
  } else if (m.view === "profile") {
    meta = "프로필 · 탐구 중심";
    sub = "층마다 켜기·끄기·그대로를 쌓고, 순서가 뜻을 가지는 곳만 끌어 옮겨요";
  } else {
    meta = "lens-review · 코드";
    sub = (
      <>
        <span className="font-mono text-mono-sm">fresnel group new lens-review --drive</span>
        <span>· 파일 10개 · 블록 내용은 생성 뒤 패치로 들어가요</span>
      </>
    );
  }
  return (
    <WorkbenchHead
      className="w-full px-3"
      title={title}
      meta={meta}
      actions={
        compact ? (
          <ViewSwitch />
        ) : (
          <>
            {action}
            <ViewSwitch />
          </>
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
        <FlowCanvas />
      </>
    );
  return <GroupCanvas />;
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
    { id: "palette", label: "블록", icon: <SquareStack />, content: <PaletteTab /> },
    { id: "inspect", label: "속성", icon: <SlidersHorizontal />, content: <InspectTab /> },
  ];
  const tabs = [base[0]!, ...mine, ...base.slice(1)];
  return (
    <Shell
      activeNav={m.nav}
      onNavSelect={(id) => {
        if (id === "compose")
          m.set({
            nav: "compose",
            group: "helm",
            view: "group",
            trial: false,
            draft: false,
            gateAdded: false,
            selected: "drive",
          });
        else if (id === "create")
          m.set({
            nav: "create",
            group: "new",
            view: "group",
            trial: false,
            draft: false,
            selected: null,
          });
        else m.notify("이 화면은 다른 크래프트 시안에 있어요");
      }}
      workbench={{ onGoToThread: () => shell.setArea("chat") }}
      stageLabel="구성기"
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
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Head />
        <Body />
        <Notice />
      </div>
    </Shell>
  );
}

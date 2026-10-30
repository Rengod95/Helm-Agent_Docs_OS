// P-01 첫 실행 목업. ?state=S1..S10(기본 S1 키 등록), ?theme=dark.
// 공용 셸 위에 가운데 단계 목록을 꽂는다. 첫 실행이라 대화 목록과 배지가 비어 있고(셸 items·nav), 오른쪽 well은 닫아 둔다.
// "대화 시작"은 O-07 새 대화(../o07-new-thread)를 연다.
import { Alert, Button, EmptyState, IconButton, Tooltip } from "@caustic/react";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  defaultStatusCells,
  Inbox,
  loadCausticFonts,
  MockRoot,
  PanelLeft,
  Shell,
  ShellStateProvider,
  standardRightTabs,
  useShell,
  type StatusCell,
} from "../_shell";
import { NewThreadDialog } from "../o07-new-thread/new-thread-dialog";
import "./mockup.css";
import { firstRunNav, firstRunPalette } from "./fixtures";
import { Steps } from "./steps";
import { FirstRunProvider, STATES, STEP_IDS, useFirstRun } from "./store";

loadCausticFonts();

const READ_WIDTH = "mx-auto w-full max-w-[46rem] px-3";

function useStatus() {
  const shell = useShell();
  const m = useFirstRun();
  const link: StatusCell | undefined = m.offline
    ? {
        id: "link",
        text: "연결 끊김",
        dot: "danger",
        title: "연결 끊김",
        description: "엔진과 연결이 끊겼어요. 읽은 값은 그대로 두었어요.",
        action: { label: "다시 연결", onSelect: () => {} },
      }
    : undefined;
  const cells = defaultStatusCells({
    layout: shell.layout,
    thread: false,
    pendingApprovals: 0,
    openEnd: shell.openEnd,
    link,
  });
  // 첫 실행: 대화가 없어 문맥 사용량이 없고, 0인 승인·알림 칸은 뺀다. 모델은 정하기 전까지 "모델 없음".
  const end = cells.end
    .filter((c) => c.id !== "tokens" && c.id !== "approvals" && c.id !== "notices")
    .map((c) =>
      c.id === "model"
        ? {
            ...c,
            text: m.done.model ? "sonnet-5-5" : "모델 없음",
            description: m.done.model
              ? "기본 모델이에요."
              : "기본 모델을 아직 정하지 않았어요. 시작하기에서 정해요.",
          }
        : c,
    );
  return { start: cells.start, end };
}

function Head() {
  const shell = useShell();
  const m = useFirstRun();
  const count = STEP_IDS.filter((id) => m.done[id]).length;
  const start = (
    <Button
      size="sm"
      tone="neutral"
      variant="solid"
      disabled={!m.ready}
      onClick={() => m.setDialogOpen(true)}
    >
      대화 시작
    </Button>
  );
  return (
    <header className={`${READ_WIDTH} flex h-10 flex-none items-center gap-1`}>
      {!shell.startOpen && (
        <IconButton
          size="sm"
          variant="ghost"
          label="사이드바 열기"
          aria-expanded={false}
          onClick={() => shell.setStartOpen(true)}
          className="-ms-1.5"
        >
          <PanelLeft />
        </IconButton>
      )}
      <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <h1 className="m-0 truncate font-ui text-ui-strong text-text-primary">시작하기</h1>
        <span
          className="text-ui-sm tabular-nums text-text-tertiary"
          aria-label={`5단계 중 ${count}개 끝남`}
        >
          {count}/5
        </span>
      </div>
      {m.ready ? (
        start
      ) : (
        <Tooltip content="키와 기본 모델을 정하면 시작할 수 있어요">
          <span className="inline-flex">{start}</span>
        </Tooltip>
      )}
    </header>
  );
}

function Page() {
  const shell = useShell();
  const m = useFirstRun();
  // 첫 실행에는 받은 요청이 비어 있어 well을 닫고 시작한다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 처음 한 번만
  useEffect(() => shell.setEndOpen(false), []);
  return (
    <>
      <Shell
        activeNav=""
        stageLabel="시작하기"
        nav={firstRunNav}
        palette={firstRunPalette}
        modalOpen={m.dialogOpen}
        threads={{
          currentId: null,
          items: [],
          onSelect: () => {},
          onNew: () => m.setDialogOpen(true),
        }}
        rightTabs={standardRightTabs({
          only: ["inbox"],
          inbox: (
            <EmptyState size="sm" surface="none" icon={<Inbox />} title="받은 요청이 없어요" />
          ),
        })}
        status={useStatus()}
        onPaletteRun={(_g, label) => {
          if (label === "새 대화") m.setDialogOpen(true);
        }}
      >
        <Head />
        <div className="min-h-0 flex-1 overflow-auto">
          <div className={`${READ_WIDTH} grid gap-2 pt-1 pb-6`}>
            {m.offline && (
              <Alert tone="warning" layout="inline" size="sm">
                엔진에 연결되지 않았어요. 연결되면 이어서 할 수 있어요.
              </Alert>
            )}
            <Steps />
          </div>
        </div>
      </Shell>
      <NewThreadDialog
        open={m.dialogOpen}
        onOpenChange={m.setDialogOpen}
        recent={[]}
        initialPath=""
      />
    </>
  );
}

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider initialPaletteOpen={state === "S9"}>
            <FirstRunProvider state={state}>
              <Page />
            </FirstRunProvider>
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );

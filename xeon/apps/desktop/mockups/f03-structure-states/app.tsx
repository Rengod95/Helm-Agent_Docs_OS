// P-16 구조 화면이 아직 없던 상태들. 지도 보기·나눔 보기는 사용자 결정으로 없다: 층 × 단계 표 하나.
// 어느 상태든 표의 자리와 모양은 그대로이고, 표 위 Alert 한 줄과 칸 내용, 표 아래 구역만 달라진다.
// 레일 대신 평범한 스크롤 열과 선 격자 바깥 틀(LineGridFrame)을 쓴다(옛 언어 이식).
import { Alert, Button, toast } from "@caustic/react";
import { useEffect, useState } from "react";
import {
  defaultStatusCells,
  inbox,
  josa,
  GRID_BODY_COMPACT,
  LineGridFrame,
  NoticeList,
  ScenarioDock,
  Shell,
  ShellToaster,
  T,
  useScenarioParam,
  useShell,
  useTimeline,
  workbenchNav,
  workbenchRightTabs,
  WorkbenchHead,
  type StatusCell,
} from "../_shell";
import { EmptyInvite, PickSection, SafeOut } from "./parts/below";
import { ROW_HEAD, SAFE_OFF, StructureGrid } from "./parts/grid";
import { BrowserFrame } from "./parts/web";
import { SCENARIOS, STEPS, initial, type Look, type S, type StateId } from "./flow";

// 결정 6과 wb-v3: 만들기는 구성에 합치고, 개요는 구조로 부른다.
const NAV = workbenchNav
  .filter((n) => n.id !== "create")
  .map((n) => (n.id === "overview" ? { ...n, label: T.structure } : n));

const LOAD_MS = 1400;
const DROP_MS = 2400;

function firstState(state: StateId, scenario: string | null): S {
  const q = new URLSearchParams(window.location.search);
  const steps = scenario === null ? undefined : STEPS[scenario];
  if (steps === undefined) return initial(state);
  const n = Number(q.get("step") ?? 0);
  const at = steps[Math.min(n, steps.length - 1)];
  if (at === undefined) return initial(state);
  return q.get("hold") === "1" ? { ...at, then: null } : at;
}

export function App({ state }: { state: StateId }) {
  const scenario = useScenarioParam();
  const hold = new URLSearchParams(window.location.search).get("hold") === "1";
  const [s, setS] = useState<S>(() => firstState(state, scenario));
  const shell = useShell();
  const { start } = useTimeline();
  const set = (p: Partial<S>) => setS((o) => ({ ...o, ...p }));

  // 읽기가 끝나면 다음 화면으로. 시나리오 reload-offline은 평상 화면에서 잠시 뒤 연결이 끊긴다.
  useEffect(() => {
    if (s.look === "loading" && s.then !== null) {
      const then = s.then;
      start([
        {
          after: LOAD_MS,
          run: () => {
            setS((o) => ({ ...o, look: then, then: null, busy: null }));
            if (then === "ready" && s.reconnected)
              toast({ title: "다시 연결됐어요", tone: "success" });
          },
        },
      ]);
    } else if (scenario === "reload-offline" && !hold && s.look === "ready" && !s.reconnected) {
      start([{ after: DROP_MS, run: () => setS((o) => ({ ...o, look: "offline" })) }]);
    }
  }, [s.look, s.then, s.reconnected, scenario, hold, start]);

  const done = (msg: string) => toast({ title: msg, tone: "neutral" });
  const narrow = s.look === "narrow";
  const transposed = narrow || shell.layout === "compact";
  const web = s.look === "web";
  // 좁은 폭은 머리·표·구역을 한 줄 기둥에 모은다. 아니면 영역 전체 폭. 어느 쪽이든 가로 여백은 기둥에 두지 않는다:
  // 표 띠(LineGridFrame)가 기둥 양 끝까지 닿고, 머리·구역·알림은 칸 글자와 같은 px-3(compact 칸)을 가진다.
  const column = narrow ? "mx-auto w-full max-w-[43.75rem]" : "w-full";

  const statusOf = (look: Look) => {
    const link: StatusCell | undefined =
      look === "offline"
        ? {
            id: "link",
            text: "끊김",
            dot: "danger",
            title: T.connection,
            description: "엔진에 연결되지 않았어요. 마지막 값만 보여요.",
          }
        : undefined;
    const safe: StatusCell = {
      id: "safe",
      text: T.safeMode,
      dot: "warning",
      title: T.safeMode,
      description: `${josa(SAFE_OFF, "을", "를")} 싣지 않았어요.`,
    };
    const cells = defaultStatusCells({
      layout: shell.layout,
      thread: false,
      pendingApprovals: 0,
      openEnd: shell.openEnd,
      link,
      ...(web
        ? {
            target: {
              id: "target",
              text: `${T.webClient} · build-box`,
              title: "대상",
              description: `${josa(T.webClient, "이", "가")} 붙은 컴퓨터예요.`,
            },
          }
        : {}),
      ...(look === "safe-mode" ? { startExtra: [safe] } : {}),
      runtime: {
        drive: look === "safe-mode" || look === "empty" ? null : "helm",
        extFailures: look === "failure" ? 1 : 0,
        onOpen: () => {},
      },
    });
    // 웹은 엔진 칸이 없다(서비스 쪽 일, e05와 같음).
    return web ? { ...cells, start: cells.start.filter((c) => c.id !== "engine") } : cells;
  };

  const busyLine =
    s.busy === "safe-on"
      ? `${josa(T.safeMode, "으로", "로")} 시작하는 중이에요…`
      : s.busy === "safe-off"
        ? `${T.safeMode} 끄고 다시 시작하는 중이에요…`
        : undefined;

  const screen = (
    <Shell
      activeNav="overview"
      onNavSelect={() => {}}
      workbench={{ onGoToThread: () => shell.setArea("chat"), nav: NAV }}
      stageLabel={T.workbench}
      threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
      rightTabs={workbenchRightTabs({
        inbox: <NoticeList notices={inbox.notices} />,
        inboxBadge: 5,
        onGoToThread: () => shell.setArea("chat"),
      })}
      status={statusOf(s.look)}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <WorkbenchHead
          className={`${column} px-3 pt-6`}
          title={T.structure}
          {...(narrow ? { meta: T.readOnly } : {})}
          {...(busyLine !== undefined
            ? { sub: busyLine }
            : s.look === "offline"
              ? { sub: "14:03 기준" }
              : {})}
        />
        <div className={`${column} ${GRID_BODY_COMPACT} gap-6 pb-8`}>
          {s.look === "offline" && (
            <Alert
              tone="warning"
              variant="soft"
              size="sm"
              action={
                <Button
                  size="xs"
                  tone="neutral"
                  variant="outline"
                  onClick={() => set({ look: "loading", then: "ready", reconnected: true })}
                >
                  다시 연결
                </Button>
              }
            >
              오프라인이라 바꿀 수 없어요
            </Alert>
          )}
          {s.look === "safe-mode" && (
            <Alert
              tone="warning"
              variant="soft"
              size="sm"
              action={
                <Button
                  size="xs"
                  tone="neutral"
                  variant="outline"
                  onClick={() =>
                    set({ look: "loading", then: "failure", busy: "safe-off", pick: {} })
                  }
                >
                  {T.safeMode} 끄고 다시 시작
                </Button>
              }
            >
              {`${T.safeMode}라 ${josa(SAFE_OFF, "이", "가")} 빠졌어요`}
            </Alert>
          )}
          {s.look === "failure" && (
            <Alert
              tone="danger"
              variant="soft"
              size="sm"
              action={
                <span className="flex items-center gap-2">
                  <Button
                    size="xs"
                    tone="neutral"
                    variant="outline"
                    onClick={() =>
                      set({ look: "loading", then: "safe-mode", busy: "safe-on", pick: {} })
                    }
                  >
                    {josa(T.safeMode, "으로", "로")} 다시 시작
                  </Button>
                  <Button
                    size="xs"
                    tone="neutral"
                    variant="outline"
                    onClick={() => done("이번 단계가 끝나면 다시 켜요")}
                  >
                    다시 켜기
                  </Button>
                </span>
              }
            >
              리뷰가 연속 5번 실패해 자동으로 꺼졌어요.
            </Alert>
          )}
          <div data-bleed="" aria-busy={s.look === "loading"}>
            <LineGridFrame>
              <StructureGrid
                look={s.look}
                pick={s.pick}
                focus={s.focus}
                transposed={transposed}
                onPick={(pick) => set({ pick, focus: null })}
                onFocus={(focus) => set({ focus, pick: {} })}
              />
            </LineGridFrame>
          </div>
          {s.look !== "loading" && (
            <div className="grid min-w-0 gap-8 pt-2">
              {s.look === "safe-mode" && <SafeOut head={transposed ? "5.5rem" : ROW_HEAD} />}
              {s.look === "empty" && <EmptyInvite onNew={() => done(`${T.compose}에서 열어요`)} />}
              <PickSection
                look={s.look}
                pick={s.pick}
                focus={s.focus}
                compact={transposed}
                onFocus={(focus) => set({ focus })}
                onDone={done}
              />
            </div>
          )}
        </div>
      </div>
    </Shell>
  );

  return (
    <>
      {web ? <BrowserFrame title={T.productName}>{screen}</BrowserFrame> : screen}
      <ShellToaster />
      <ScenarioDock scenarios={SCENARIOS} />
    </>
  );
}

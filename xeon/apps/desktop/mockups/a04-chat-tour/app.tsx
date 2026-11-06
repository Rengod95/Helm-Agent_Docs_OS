// N-14 대화 영역 둘러보기 목업. 대화 t1 "캐시 무효화 조사" 위에서 세 곳을 차례로 짚는다:
// 1 런타임 줄(대화 머리 둘째 줄) → 2 런타임 탭(오른쪽 well) → 3 "크래프트에서 보기". 끝나면 토스트 한 줄.
// 시작점은 트랜스크립트의 흐린 런타임 행 하나("둘러보기", DP-19 동작 하나). 좁은 폭에서는 말풍선이 아래 시트로 내려온다.
// 실패 갈래: 사용자가 런타임 탭을 닫아 대상이 없으면 말풍선이 "다시 열기"를 보인다.
import { Button, Toaster, toast } from "@caustic/react";
import { useEffect, useState } from "react";
import {
  chatRightTabs,
  defaultStatusCells,
  inbox,
  josa,
  NoticeList,
  ScenarioDock,
  Shell,
  T,
  useScenarioParam,
  useShell,
} from "../_shell";
import {
  ChatComposer,
  ChatHead,
  ChatStage,
  Items,
  RuntimePanel,
  t1Base,
  t1Runtime,
  t1RuntimeLine,
  T1_TITLE,
  type ChatItem,
} from "../_chat-rt";
import { Tour, type TourStep } from "./parts/tour";

export const STATES = [
  { id: "tour-1", label: "1 런타임 줄" },
  { id: "entry", label: "시작점(런타임 행)" },
  { id: "tour-2", label: "2 런타임 탭" },
  { id: "tour-3", label: "3 크래프트에서 보기" },
  { id: "done", label: "끝" },
  { id: "missing", label: "실패: 런타임 탭이 닫힘" },
  { id: "narrow-1", label: "좁은 폭(390) · 1" },
  { id: "narrow-2", label: "좁은 폭(390) · 2(시트)" },
  { id: "w700-3", label: "700 · 3" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

export const SCENARIOS = [
  { id: "tour", label: "둘러보기: 런타임 줄 → 탭 → 크래프트" },
  { id: "tour-closed", label: "실패: 둘러보는 중 탭을 닫음" },
];

const STEPS: TourStep[] = [
  {
    target: "runtime-line",
    title: `${T.runtime} 줄`,
    side: "below",
    body: `지금 ${josa(T.lead, "을", "를")} 쥔 ${T.group}과 ${T.step}, 켜진 ${T.extension} 수예요. 누르면 ${T.runtime} 탭이 열려요.`,
  },
  {
    target: "runtime-tab",
    title: `${T.runtime} 탭`,
    side: "left",
    body: `이 ${T.thread}의 ${T.group}과 ${T.extension}, ${T.lead}, ${T.stepBoundary}마다의 전환 기록이 모여 있어요. ${T.group}이 바뀌는 건 늘 ${T.step}가 끝난 뒤예요.`,
  },
  {
    target: "to-workbench",
    title: `${T.workbench}에서 보기`,
    side: "left",
    body: `이 ${josa(T.thread, "을", "를")} ${T.context}으로 ${T.pin}하고 ${josa(T.workbench, "을", "를")} 열어요. ${T.extension}을 켜고 끄고, ${T.trial}하고, 만드는 곳이에요.`,
  },
];

function initialAt(state: StateId, scenario: string | null): number {
  if (scenario !== null) return -1;
  if (state === "entry") return -1;
  if (state === "tour-2" || state === "narrow-2" || state === "missing") return 1;
  if (state === "tour-3" || state === "w700-3") return 2;
  if (state === "done") return 3;
  return 0;
}

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const scenario = useScenarioParam();
  const [at, setAt] = useState(initialAt(state, scenario));
  const [closedOnce, setClosedOnce] = useState(false);

  // 단계마다 대상이 보이게 준비: 2·3은 런타임 탭을 연다(사용자가 닫은 실패 갈래는 열지 않는다).
  useEffect(() => {
    if (at === 1 || at === 2) {
      if (state === "missing") shell.setEndOpen(false);
      else shell.openEnd("runtime");
    }
    if (at === 0 && shell.layout !== "wide") shell.setEndOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);

  // 실패 갈래 시나리오: 2단계에서 1.5초 뒤 탭이 닫힌다(사용자가 Esc를 누른 것처럼).
  useEffect(() => {
    if (scenario !== "tour-closed" || at !== 1 || closedOnce) return undefined;
    const id = window.setTimeout(() => {
      setClosedOnce(true);
      shell.setEndOpen(false);
    }, 1500);
    return () => window.clearTimeout(id);
  }, [scenario, at, closedOnce, shell]);

  useEffect(() => {
    if (at === 3 && state === "done")
      toast({
        title: "둘러보기를 마쳤어요",
        description: "도움말에서 다시 볼 수 있어요.",
        tone: "neutral",
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    setAt(3);
    toast({
      title: "둘러보기를 마쳤어요",
      description: "도움말에서 다시 볼 수 있어요.",
      tone: "neutral",
    });
  };

  const items: ChatItem[] = [
    ...t1Base,
    {
      k: "node",
      key: "entry",
      node:
        at === -1 ? (
          <div className="flex min-h-6 items-center gap-1.5 text-ui-dense text-text-secondary">
            <span className="min-w-0 truncate">
              {`처음 보는 ${T.runtime} 표시예요 · ${T.group}과 ${T.lead}가 어디 보이는지 짚어 볼까요`}
            </span>
            <Button
              size="xs"
              variant="ghost"
              className="ms-auto -my-1 flex-none"
              onClick={() => setAt(0)}
            >
              둘러보기
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <Shell
        activeNav="chat"
        stageLabel={T.thread}
        threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
        rightTabs={chatRightTabs({
          inbox: <NoticeList notices={inbox.notices} />,
          inboxBadge: 3,
          runtime: (
            <div data-tour="runtime-tab">
              <RuntimePanel
                data={t1Runtime()}
                onWorkbench={() => {
                  if (at >= 0 && at < 3) return;
                  shell.pinThread("t1");
                }}
              />
            </div>
          ),
        })}
        status={defaultStatusCells({
          layout: shell.layout,
          thread: true,
          pendingApprovals: 2,
          openEnd: shell.openEnd,
          runtime: { drive: "helm", extFailures: 1, onOpen: () => shell.openEnd("runtime") },
        })}
      >
        <ChatStage
          follow={at}
          head={
            <ChatHead
              title={T1_TITLE}
              runtime={t1RuntimeLine}
              runtimeLabel={`${T.runtime} 탭 열기: ${t1RuntimeLine}`}
            />
          }
          composer={<ChatComposer value="" onValueChange={() => {}} running onSubmit={() => {}} />}
        >
          <Items items={items} />
        </ChatStage>
      </Shell>
      {at >= 0 && at < 3 && (
        <Tour
          steps={STEPS}
          at={at}
          onNext={() => (at === 2 ? finish() : setAt(at + 1))}
          onBack={() => setAt(Math.max(0, at - 1))}
          onSkip={finish}
          missing={(step) => (
            <div className="grid gap-1.5">
              <span className="text-ui-strong font-semibold text-text-primary">
                {step.title}이 닫혀 있어요
              </span>
              <p className="m-0 text-ui-sm text-text-secondary">다시 열면 이어서 짚어 드려요.</p>
              <div>
                <Button size="xs" variant="outline" onClick={() => shell.openEnd("runtime")}>
                  {T.runtime} 탭 다시 열기
                </Button>
              </div>
            </div>
          )}
        />
      )}
      <Toaster label="알림" />
      <ScenarioDock
        scenarios={SCENARIOS}
        hint={at === -1 ? `런타임 행의 "둘러보기"` : at < 3 ? `"다음"` : undefined}
      />
    </>
  );
}

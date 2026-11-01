// S-01 셸 내비 정합 + N-01 보기 기준 칸 + N-04 대화 목록 시험 표지 + 계획에 없음 4(시험 대화 정리) 목업.
// - 대화 영역: 주 내비 다섯(연결 포함, U-3), 작업 폴더별 대화 목록, 폴더 안 "시험" 묶음(실행 중·멈춤·끝남 표지).
// - 작업대 영역: 왼쪽 보기 기준 칸(전체·대화·프로필·시험, 대화는 따라감/고정), 내비 여섯(만들기 없음, C-6).
// - "작업대에서 보기"(런타임 탭)는 그 대화로 고정하고 작업대로 간다(결정 11). 패널을 닫으면 작업대 머리에 "보기 기준 <이름>".
// - 시험 정리: 묶음의 "끝난 시험 n개 지우기…" → 확인 대화 상자 → 지움(실패 갈래: 다른 창에서 연 시험은 남김).
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  ListDescription,
  ListDescriptionRow,
  Toaster,
  toast,
} from "@caustic/react";
import { useEffect, useState } from "react";
import {
  chatRightTabs,
  defaultStatusCells,
  FlaskConical,
  inbox,
  NoticeList,
  profiles,
  ScenarioDock,
  Shell,
  T,
  threads as allThreads,
  Trash2,
  useScenarioParam,
  useShell,
  workbenchRightTabs,
  workbenchNav,
  type Thread,
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
  type ChatItem,
} from "../_chat-rt";
import { ContextView } from "./parts/context-view";

export const STATES = [
  { id: "chat", label: "대화 영역(내비 다섯 · 시험 묶음)" },
  { id: "wb-follow", label: "작업대 · 대화 기준(따라감)" },
  { id: "wb-pinned", label: "작업대 · 대화 기준(고정)" },
  { id: "wb-all", label: "작업대 · 전체" },
  { id: "wb-profile", label: "작업대 · 프로필 기준" },
  { id: "wb-trial", label: "작업대 · 시험 기준" },
  { id: "wb-picker", label: "작업대 · 기준 칸 펼침" },
  { id: "wb-closed", label: "작업대 · 패널 닫힘(머리에 기준)" },
  { id: "cleanup-confirm", label: "끝난 시험 지우기 확인" },
  { id: "cleanup-context", label: "지우기 확인 · 기준이 그 시험" },
  { id: "cleanup-done", label: "끝난 시험 지움" },
  { id: "cleanup-partial", label: "실패: 한 시험은 남김" },
  { id: "narrow", label: "좁은 폭(390) · 왼쪽 시트" },
  { id: "narrow-wb", label: "좁은 폭(390) · 작업대 머리 기준" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

export const SCENARIOS = [
  { id: "context-pin", label: "보기 기준: 따라감 → 고정 → 풀기" },
  { id: "context-pin-lost", label: "실패: 고정한 대화가 닫힘" },
  { id: "trial-cleanup", label: "끝난 시험 지우기" },
  { id: "trial-cleanup-busy", label: "실패: 다른 창에서 연 시험" },
];

const WB_TITLE: Record<string, string> = Object.fromEntries(
  workbenchNav.map((n) => [n.id, n.label]),
);

function genericItems(t: Thread): ChatItem[] {
  return [
    { k: "user", text: `${t.title} 이어서 해줘` },
    { k: "agent", text: "지난 단계에서 멈춘 곳부터 이어갈게요." },
  ];
}

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const scenario = useScenarioParam();
  const [current, setCurrent] = useState<string>(state === "wb-trial" ? "t8" : "t1");
  const [wbNav, setWbNav] = useState("overview");
  const [removed, setRemoved] = useState<string[]>(
    state === "cleanup-done" ? ["t9"] : state === "cleanup-partial" ? [] : [],
  );
  const [confirm, setConfirm] = useState(
    state === "cleanup-confirm" || state === "cleanup-context",
  );
  const [pinLostFired, setPinLostFired] = useState(false);

  // 정적 상태 준비(목업 전용): 좁은 폭 시트 열기, 기준 칸 펼치기.
  useEffect(() => {
    if (state === "narrow") shell.setStartOpen(true);
    if (state === "wb-closed" || state === "narrow-wb") shell.setStartOpen(false);
    if (state === "wb-picker")
      window.setTimeout(
        () => document.querySelector<HTMLElement>(`[aria-label="${T.context}"]`)?.click(),
        200,
      );
    if (state === "cleanup-done")
      toast({ title: `끝난 ${T.trialThread} 1개를 지웠어요`, tone: "neutral" });
    if (state === "cleanup-partial")
      toast({
        title: `review 다시 켜기 확인은 남겼어요`,
        description: "다른 창에서 열려 있어요. 그 창을 닫고 다시 지워 주세요.",
        tone: "warning",
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 실패 갈래: 고정한 대화가 다른 창에서 닫힘 → 기준을 전체로.
  const c = shell.context;
  useEffect(() => {
    if (scenario !== "context-pin-lost" || pinLostFired) return;
    if (c.kind === "thread" && c.pinned && shell.area === "workbench") {
      setPinLostFired(true);
      const id = window.setTimeout(() => {
        setRemoved((r) => [...r, "t1"]);
        setCurrent("t2");
        shell.setContext({ kind: "all" });
        toast({
          title: `고정한 ${T.thread}가 닫혔어요`,
          description: `다른 창에서 "캐시 무효화 조사"를 닫아 ${T.context}을 ${T.contextAll}로 바꿨어요.`,
          tone: "warning",
        });
      }, 3500);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [scenario, pinLostFired, c, shell]);

  const items = allThreads.filter((t) => !removed.includes(t.id));
  const done = items.filter((t) => t.trial?.state === "done");
  const thread = items.find((t) => t.id === current);
  const contextIsDone =
    state === "cleanup-context" ||
    ((c.kind === "trial" || c.kind === "thread") && done.some((t) => t.id === c.threadId));

  const doClear = () => {
    setConfirm(false);
    const busy = scenario === "trial-cleanup-busy";
    const gone = done.filter((t) => !(busy && t.id === "t9")).map((t) => t.id);
    setRemoved((r) => [...r, ...gone]);
    if (contextIsDone) shell.setContext({ kind: "all" });
    if (gone.includes(current)) setCurrent("t1");
    if (busy)
      toast({
        title: `review 다시 켜기 확인은 남겼어요`,
        description: "다른 창에서 열려 있어요. 그 창을 닫고 다시 지워 주세요.",
        tone: "warning",
      });
    else
      toast({
        title: `끝난 ${T.trialThread} ${gone.length}개를 지웠어요`,
        description: `결과는 ${T.workbench} ${T.trials}에 읽기 전용으로 남아요.`,
        tone: "neutral",
      });
  };

  const hint = (() => {
    if (scenario === "context-pin" || scenario === "context-pin-lost") {
      if (shell.area === "chat") {
        if (c.kind === "thread" && c.pinned)
          return `다른 ${T.thread}를 열어도 기준은 그대로예요 → ${T.workbench}로`;
        return `런타임 탭의 "${T.workbench}에서 보기"를 누르세요`;
      }
      if (c.kind === "thread" && c.pinned) return `자물쇠를 눌러 ${T.unpin}`;
      if (c.kind === "all") return `${T.context}이 ${T.contextAll}로 바뀌었어요`;
      return `${T.contextFollow}: 대화 영역에서 다른 ${T.thread}를 열어 보세요`;
    }
    if (scenario?.startsWith("trial-cleanup") === true)
      return confirm
        ? `"지우기"를 누르세요`
        : done.length > 0
          ? `"시험" 묶음의 "끝난 ${T.trial} ${done.length}개 지우기…"`
          : "끝났어요";
    return undefined;
  })();

  const wb = shell.area === "workbench";
  const isTrial = thread?.trial !== undefined;
  const profileTitle = (id: string) => profiles.find((p) => p.id === id)?.title ?? id;

  const chatStage =
    thread === undefined ? null : (
      <ChatStage
        follow={current}
        head={
          <ChatHead
            title={thread.title === "" ? "제목 없음" : thread.title}
            marks={
              isTrial && thread.trial !== undefined ? (
                <>
                  <Badge size="xs" tone="neutral" icon={<FlaskConical />} className="shrink-0">
                    {T.trial}
                  </Badge>
                  <span className="min-w-0 truncate text-ui-sm text-text-tertiary max-compact:hidden">
                    {T.profile} {profileTitle(thread.trial.profile)} · 대상{" "}
                    <span className="font-mono text-mono-sm">{thread.trial.target}</span>
                  </span>
                </>
              ) : undefined
            }
            runtime={current === "t1" ? t1RuntimeLine : `${T.lead} 없음 · ${T.extension} 3`}
          />
        }
        composer={
          <ChatComposer value="" onValueChange={() => {}} running={false} onSubmit={() => {}} />
        }
      >
        <Items items={current === "t1" ? t1Base : genericItems(thread)} />
      </ChatStage>
    );

  return (
    <>
      <Shell
        activeNav={wb ? wbNav : "chat"}
        onNavSelect={(id) => (wb ? setWbNav(id) : undefined)}
        stageLabel={wb ? (WB_TITLE[wbNav] ?? T.workbench) : T.thread}
        modalOpen={confirm}
        threads={{
          currentId: current,
          items,
          trialsOpen: true,
          onSelect: (id) => setCurrent(id),
          onNew: () => {},
          onClearTrials: () => setConfirm(true),
        }}
        workbench={{
          onGoToThread: (id) => {
            setCurrent(id);
            shell.setArea("chat");
          },
        }}
        rightTabs={
          wb
            ? workbenchRightTabs({
                inbox: <NoticeList notices={inbox.notices} />,
                inboxBadge: 3,
                onGoToThread: () => shell.setArea("chat"),
              })
            : chatRightTabs({
                inbox: <NoticeList notices={inbox.notices} />,
                inboxBadge: 3,
                runtime: (
                  <RuntimePanel
                    data={t1Runtime({
                      caption: `${thread?.title ?? ""} · ${T.turn} 3`,
                    })}
                    onWorkbench={() => {
                      shell.pinThread(current);
                      toast({
                        title: `${T.context}을 이 ${T.thread}로 ${T.pin}했어요`,
                        description: `자물쇠를 누르면 다시 열린 ${T.thread}를 따라가요.`,
                        tone: "neutral",
                      });
                    }}
                  />
                ),
              })
        }
        status={defaultStatusCells({
          layout: shell.layout,
          thread: !wb || c.kind !== "all",
          pendingApprovals: 2,
          openEnd: shell.openEnd,
          runtime: {
            drive: current === "t1" ? "helm" : null,
            extFailures: current === "t1" ? 1 : 0,
            onOpen: () => (wb ? setWbNav("overview") : shell.openEnd("runtime")),
          },
        })}
      >
        {wb ? <ContextView title={WB_TITLE[wbNav] ?? T.overview} /> : chatStage}
      </Shell>
      <Dialog
        kind="alert"
        size="sm"
        open={confirm}
        onOpenChange={setConfirm}
        icon={<Trash2 />}
        title={`끝난 ${T.trialThread} ${done.length}개를 지울까요?`}
        description={`결과는 ${T.workbench} ${T.trials}에 읽기 전용으로 남아요. 실행 중이거나 멈춘 ${T.trial}은 그대로 둬요.`}
        footer={
          <>
            <DialogClose asChild>
              <Button size="sm" tone="neutral" variant="outline" autoFocus>
                취소
              </Button>
            </DialogClose>
            <Button size="sm" tone="danger" variant="solid" onClick={doClear}>
              지우기
            </Button>
          </>
        }
      >
        <div className="grid gap-2">
          <ListDescription
            variant="ghost"
            size="xs"
            aria-label={`지울 ${T.trialThread}`}
            className="rounded-none [--cs-size-list-term:9rem] [&_[data-slot=list-description-row]]:px-0"
          >
            {done.map((t) => (
              <ListDescriptionRow key={t.id} term={t.title}>
                {T.profile} {profileTitle(t.trial?.profile ?? "")} · 대상{" "}
                <span className="font-mono">{t.trial?.target}</span>
              </ListDescriptionRow>
            ))}
          </ListDescription>
          {contextIsDone && (
            <p className="m-0 text-ui-sm text-text-secondary">
              {T.workbench} {T.context}이 이 {T.trial}이라 {T.contextAll}로 바뀌어요.
            </p>
          )}
        </div>
      </Dialog>
      <Toaster label="알림" />
      <ScenarioDock scenarios={SCENARIOS} hint={hint} />
    </>
  );
}

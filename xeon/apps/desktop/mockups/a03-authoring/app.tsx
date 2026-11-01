// 대화에서 제작(N-08~N-13) 목업. 대화 "아침 요약 그룹 만들기"에서 제작 확장(L3 authoring)이 진행권을 쥐고
// 요구 정리 → 구성 초안 → 뼈대 → 검사(⇄ 고치기) → 시험 → 묶기를 돌린다. 사람 확인 다섯은 loop.ask 표준 카드로 오고,
// 기다리는 동안 진행권을 반납한다(런타임 줄 "authoring 사람 확인 기다림 · 진행권 반납").
// 런타임 줄은 단계 사슬(지금 단계 굵게), 오른쪽에 "제작" well(authoring/panel), 작업대 "제작" 화면(authoring/session).
import { Badge, Toaster, toast } from "@caustic/react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  EXT,
  chatRightTabs,
  defaultStatusCells,
  inbox,
  josa,
  NoticeList,
  pluginPages,
  ScenarioDock,
  Shell,
  T,
  threads,
  useShell,
  WandSparkles,
  type Thread,
} from "../_shell";
import {
  ChatComposer,
  ChatHead,
  ChatStage,
  Items,
  RuntimePanel,
  RuntimeRow,
  baseGroups,
  useMachine,
  usePrefill,
  type ChatItem,
} from "../_chat-rt";
import { effect, init, NAME, reduce, SCRIPTS, STAGES, SRC, type A, type S } from "./flow";
import { FixCard, KindCard, LinkCard, PackageCard, ResultCard, TrialCard } from "./parts/cards";
import { AuthoringPage, AuthoringWell } from "./parts/session";

export const STATES = [
  { id: "result", label: "결과 카드(선언형 화면)" },
  { id: "progress", label: "진행 중(뼈대)" },
  { id: "ask-kind", label: "확인 1 · 종류와 이름" },
  { id: "ask-fix", label: "확인 2 · 고치기 한도" },
  { id: "fix-stopped", label: "멈춤 · 파일 남김" },
  { id: "ask-trial", label: "확인 3 · 시험 비용" },
  { id: "trial-running", label: "시험 중" },
  { id: "ask-package", label: "확인 4 · 묶기 전 경고" },
  { id: "ask-link", label: "확인 5 · 연결 전" },
  { id: "linked", label: "연결함 · 제작 끝" },
  { id: "result-frame", label: "결과 카드(프레임 화면)" },
  { id: "result-web", label: "결과 카드(웹·원격: 경로 복사)" },
  { id: "scope-denied", label: "쓰기 범위 거부" },
  { id: "stopped", label: "사용자가 멈춤" },
  { id: "off", label: "제작 확장 꺼짐" },
  { id: "blocked", label: "종류 준비 중(x.hook)" },
  { id: "safe-mode", label: "안전 모드라 빠짐" },
  { id: "dev-required", label: "다시 돌려 검사: 개발 모드 필요" },
  { id: "well", label: "제작 well" },
  { id: "page", label: "작업대 제작 화면" },
  { id: "narrow", label: "좁은 폭(390) · 확인 카드" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const AT: Record<StateId, { script: string; n: number }> = {
  result: { script: "authoring-happy", n: 14 },
  progress: { script: "authoring-happy", n: 7 },
  "ask-kind": { script: "authoring-happy", n: 4 },
  "ask-fix": { script: "authoring-fix-limit", n: 12 },
  "fix-stopped": { script: "authoring-fix-limit", n: 13 },
  "ask-trial": { script: "authoring-happy", n: 9 },
  "trial-running": { script: "authoring-happy", n: 10 },
  "ask-package": { script: "authoring-happy", n: 12 },
  "ask-link": { script: "authoring-happy", n: 15 },
  linked: { script: "authoring-happy", n: 16 },
  "result-frame": { script: "authoring-frame", n: 14 },
  "result-web": { script: "authoring-happy", n: 14 },
  "scope-denied": { script: "authoring-scope-denied", n: 8 },
  stopped: { script: "authoring-stop", n: 8 },
  off: { script: "authoring-off", n: 3 },
  blocked: { script: "authoring-blocked", n: 5 },
  "safe-mode": { script: "authoring-safe", n: 3 },
  "dev-required": { script: "authoring-dev-required", n: 15 },
  well: { script: "authoring-happy", n: 8 },
  page: { script: "authoring-happy", n: 14 },
  narrow: { script: "authoring-happy", n: 12 },
};

export const SCENARIOS = [
  { id: "authoring-happy", label: "그룹 만들기: 확인 다섯 → 결과 → 연결" },
  { id: "authoring-fix-limit", label: "실패: 고치기 3번 → 멈춤, 파일 남김" },
  { id: "authoring-scope-denied", label: "실패: 쓰기 범위 밖 거부" },
  { id: "authoring-off", label: "제작 확장 꺼짐 → 켜기" },
  { id: "authoring-blocked", label: "실패: x.hook 준비 중 → 관찰 그룹" },
  { id: "authoring-frame", label: "에이전트가 프레임 화면을 고름" },
  { id: "authoring-dev-required", label: "실패: 다시 돌려 검사 → 개발 모드 필요" },
];

const TITLE = "아침 요약 그룹 만들기";
const THREAD_ID = "ta";
const PAGE_ID = "authoring/session";

function RuntimeChain({ s }: { s: S }) {
  const waiting = Object.values(s.asks).includes("pending");
  if (s.ext !== "on") return <>{`${T.lead} 없음 · ${T.extension} 3`}</>;
  if (s.stage === "idle") return <>{`${T.lead} 없음 · ${T.authoringExt} 켜짐`}</>;
  if (s.stage === "stopped") return <>{`${T.authoring} 멈춤 · 파일은 남김 · ${T.lead} 없음`}</>;
  if (s.stage === "done" && s.asks.link !== "pending")
    return (
      <>{`${T.authoring} 끝 · ${s.linked ? `${T.installLink}됨` : "결과 카드"} · ${T.lead} 없음`}</>
    );
  const cur = s.stage === "fix" ? "validate" : s.stage === "done" ? "package" : s.stage;
  return (
    <>
      {waiting
        ? `authoring ${T.humanGate} 기다림 · ${T.lead} ${T.leadReturn} · `
        : `authoring ${T.drive} · `}
      {STAGES.map((x, i) => (
        <Fragment key={x.id}>
          {i > 0 && <span className="text-text-tertiary"> › </span>}
          <span className={x.id === cur ? "font-semibold text-text-primary" : "text-text-tertiary"}>
            {x.label}
            {x.id === "validate" && s.fixes > 0 ? ` ${s.fixes}/3` : ""}
          </span>
        </Fragment>
      ))}
    </>
  );
}

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const pre = usePrefill(SCRIPTS, AT[state]);
  const [s, dispatch] = useMachine<S, A>({
    init: init(pre.script),
    reduce,
    prefill: pre.prefill,
    effect,
    kick: pre.live,
  });
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState(state === "page");
  const web = state === "result-web";

  useEffect(() => {
    if (pre.live && pre.prefill.length === 0) dispatch({ t: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPage = () => {
    setPage(true);
    shell.pinThread(THREAD_ID);
  };

  const nodes: Record<string, ReactNode> = {
    "ask-kind": (
      <KindCard
        state={s.asks.kind ?? "pending"}
        blocked={s.script === "authoring-blocked"}
        onAnswer={(kind) => dispatch({ t: "answerKind", kind })}
        onDeny={() => dispatch({ t: "stop" })}
      />
    ),
    "ask-fix": (
      <FixCard
        state={s.asks.fix ?? "pending"}
        onStop={() => dispatch({ t: "fixStop" })}
        onRedo={() => dispatch({ t: "fixRedo" })}
      />
    ),
    "ask-trial": (
      <TrialCard
        state={s.asks.trial ?? "pending"}
        onYes={() => dispatch({ t: "trialYes" })}
        onNo={() => dispatch({ t: "trialSkip" })}
      />
    ),
    "ask-package": (
      <PackageCard
        state={s.asks.package ?? "pending"}
        onYes={() => dispatch({ t: "packageYes" })}
        onNo={() => dispatch({ t: "packageNo" })}
      />
    ),
    "ask-link": (
      <LinkCard
        state={s.asks.link ?? "pending"}
        onYes={() => dispatch({ t: "linkYes" })}
        onNo={() => dispatch({ t: "linkNo" })}
      />
    ),
    result: (
      <ResultCard
        view={s.view}
        web={web}
        trialSkipped={s.asks.trial === "declined"}
        linked={s.linked}
        onTrial={() =>
          toast({
            title: `새 ${T.trialThread}를 열었어요`,
            description: `${NAME}를 그 ${T.thread}에서만 켰어요.`,
            tone: "neutral",
          })
        }
        onLink={() => dispatch({ t: "askLink" })}
        onReplay={() => dispatch({ t: "replay" })}
        onMore={openPage}
      />
    ),
    "trial-row": (
      <RuntimeRow
        source={SRC}
        action={{ label: "보기", onClick: () => {} }}
        onOpen={() => shell.openEnd("runtime")}
      >
        {`${T.trialThread}를 열었어요 · 아침 요약 ${T.trial} · 대상 ${NAME}만`}
      </RuntimeRow>
    ),
    "stopped-row": (
      <RuntimeRow
        source="core"
        action={{ label: web ? "경로 복사" : "폴더 열기", onClick: () => {} }}
      >
        {`이어서 하려면 "${T.authoring} 이어서"라고 보내세요 · ${T.targetFolder}의 매니페스트를 읽어 이어 가요`}
      </RuntimeRow>
    ),
    "enable-row": (
      <RuntimeRow
        source="core"
        {...(s.ext === "off"
          ? {
              action: { label: `${T.authoringExt} 켜기`, onClick: () => dispatch({ t: "enable" }) },
            }
          : {})}
      >
        {s.ext === "off"
          ? `${T.authoringExt}(authoring) 꺼짐 · 내장 ${T.group}`
          : `${T.authoringExt}(authoring) 켜짐`}
      </RuntimeRow>
    ),
    "safe-row": (
      <RuntimeRow
        source="core"
        tone="warning"
        action={{ label: `${T.safeMode} 끄기…`, onClick: () => {} }}
      >
        {`${T.safeMode} · ${T.authoringExt}이 빠졌어요 · ${T.group}·외부 ${T.extension}·X 훅 꺼짐`}
      </RuntimeRow>
    ),
    "dev-row": (
      <RuntimeRow
        source={SRC}
        tone="warning"
        action={{ label: `${T.devMode} 설정 보기`, onClick: () => {} }}
      >
        {`${T.replay}는 ${T.devMode}에서만 돌아요 · dev_mode_required`}
      </RuntimeRow>
    ),
  };

  const items: ChatItem[] = s.items.map((it) =>
    it.k === "node" ? { ...it, node: nodes[it.key] ?? null } : it,
  );

  const waiting = Object.values(s.asks).includes("pending");
  const running =
    s.ext === "on" && !waiting && s.stage !== "idle" && s.stage !== "done" && s.stage !== "stopped";
  const holder = running ? "authoring" : null;

  const list: Thread[] = threads.map((t) =>
    t.id === THREAD_ID
      ? { ...t, status: running ? "running" : "idle", approvals: waiting ? 1 : 0 }
      : t,
  );

  const runtime = (
    <RuntimePanel
      data={{
        caption: `${TITLE} · ${T.turn} 2`,
        holder,
        phase: STAGES.find((x) => x.id === (s.stage === "fix" ? "validate" : s.stage))?.label ?? "",
        since: `${T.turn} 1부터`,
        gate: waiting
          ? { group: "authoring", text: `답을 기다려요 · ${T.lead} ${T.leadReturn}` }
          : null,
        queue: [],
        groups: [
          {
            layer: "L3",
            name: "authoring",
            state:
              s.ext === "on"
                ? "켜짐 · 이 대화"
                : s.ext === "safe"
                  ? `빠짐 · ${T.safeMode}`
                  : "꺼짐",
            points: ["drive", "tool.call.before (쓰기 범위)", "session.start"],
          },
          ...baseGroups.filter((g) => g.name !== "helm" && g.name !== "review"),
        ],
        switches: [
          ...(s.linked
            ? [
                {
                  at: "14:21",
                  turn: 2,
                  text: `${EXT.authoring}이 ${josa(T.lead, "을", "를")} 놓았어요`,
                },
              ]
            : []),
          ...(s.items.some((i) => i.k === "row" && i.tone === "danger" && i.icon === "danger")
            ? [
                {
                  at: "14:13",
                  turn: 1,
                  text: `${T.writeScope} 거부 · edit group-kit/src/define.ts`,
                },
              ]
            : []),
          ...(s.stage !== "idle" && s.ext === "on"
            ? [
                {
                  at: "14:11",
                  turn: 1,
                  text: `${EXT.authoring}이 ${josa(T.lead, "을", "를")} 받았어요`,
                },
              ]
            : []),
        ],
      }}
    />
  );

  const hint = (() => {
    if (s.asks.kind === "pending") return "종류를 고르고 답하기";
    if (s.asks.fix === "pending") return "멈추기 또는 구성 초안부터 다시";
    if (s.asks.trial === "pending") return `"${T.trial}하기"`;
    if (s.asks.package === "pending") return `"${T.stagePackage}"`;
    if (s.asks.link === "pending") return `"${T.installLink}"`;
    if (s.ext === "off" && s.items.length > 2) return `"${T.authoringExt} 켜기"`;
    if (s.stage === "done" && !s.linked) return `결과 카드의 "${T.userExtDir}에 ${T.installLink}"`;
    return running ? "기다리거나 중단(■)으로 멈추기" : undefined;
  })();

  const pages = [...pluginPages, { id: PAGE_ID, ext: "authoring", label: T.authoring }];

  return (
    <>
      <Shell
        activeNav={page ? PAGE_ID : "chat"}
        onNavSelect={(id) => setPage(id === PAGE_ID)}
        stageLabel={page ? T.authoring : TITLE}
        workbench={{
          pages,
          onGoToThread: () => {
            setPage(false);
            shell.setArea("chat");
          },
        }}
        threads={{
          currentId: THREAD_ID,
          items: list,
          onSelect: () => setPage(false),
          onNew: () => {},
        }}
        rightTabs={chatRightTabs({
          inbox: <NoticeList notices={inbox.notices} />,
          inboxBadge: 3,
          runtime,
          plugins:
            s.ext === "on"
              ? [
                  {
                    id: "authoring/panel",
                    label: T.authoring,
                    icon: <WandSparkles />,
                    ext: "authoring",
                    expand: { label: `${T.authoring} 화면 크게`, onSelect: openPage },
                    content: <AuthoringWell s={s} />,
                  },
                ]
              : [],
        })}
        status={defaultStatusCells({
          layout: shell.layout,
          thread: true,
          pendingApprovals: 2 + (waiting ? 1 : 0),
          openEnd: shell.openEnd,
          runtime: {
            drive: holder,
            extFailures: 0,
            onOpen: () => shell.openEnd("runtime"),
            ...(waiting ? { waiting: "authoring" } : {}),
          },
        })}
      >
        {page && shell.area === "workbench" ? (
          <AuthoringPage
            s={s}
            onBack={() => {
              setPage(false);
              shell.setArea("chat");
            }}
          />
        ) : (
          <ChatStage
            follow={items.length}
            head={
              <ChatHead
                title={TITLE}
                marks={
                  s.ext === "on" && s.stage !== "idle" ? (
                    <Badge size="xs" tone="neutral" icon={<WandSparkles />} className="shrink-0">
                      {T.authoring}
                    </Badge>
                  ) : undefined
                }
                runtime={<RuntimeChain s={s} />}
                runtimeLabel={`${T.runtime} 탭 열기`}
              />
            }
            composer={
              <ChatComposer
                value={draft}
                onValueChange={setDraft}
                running={running}
                onSubmit={(text) => {
                  if (s.stage === "idle") dispatch({ t: "user", text });
                  setDraft("");
                }}
                onStop={() => dispatch({ t: "stop" })}
              />
            }
          >
            <Items items={items} />
          </ChatStage>
        )}
      </Shell>
      <Toaster label="알림" />
      <ScenarioDock scenarios={SCENARIOS} hint={hint} />
    </>
  );
}

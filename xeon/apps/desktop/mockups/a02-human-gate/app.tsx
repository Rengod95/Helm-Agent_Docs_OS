// N-05 사람 확인 관문(loop.ask) · N-06 자식 에이전트 승인 출처 · N-07 만료 뒤 모습 · 계획에 없음 3(진행권 충돌 "이 그룹 먼저")
// · P-05(Helm well에서 진행권·그룹 구역을 빼 런타임 탭으로) 목업. 대화는 t1 "캐시 무효화 조사", helm이 진행권을 쥐고 수렴 중.
// 한 상태 기계(flow.ts)가 ?state=, ?scenario=, &step=을 함께 돌린다.
import { AgentRequest, Toaster, toast } from "@caustic/react";
import { useEffect, useState } from "react";
import {
  EXT,
  approvals,
  chatRightTabs,
  Compass,
  defaultStatusCells,
  inbox,
  josa,
  NoticeList,
  QuestionCard,
  ScenarioDock,
  Shell,
  T,
  threads,
  ToolApprovalCard,
  useShell,
  type QuestionApproval,
  type Thread,
  type ToolApproval,
} from "../_shell";
import {
  ChatComposer,
  ChatHead,
  ChatStage,
  Items,
  RuntimePanel,
  t1Base,
  t1Runtime,
  T1_TITLE,
  useMachine,
  usePrefill,
  type ChatItem,
  type QueueRow,
} from "../_chat-rt";
import { effect, init, PICKS, reduce, SCRIPTS, type A, type S } from "./flow";
import { HelmWell } from "./parts/helm-well";
import { OsNotice } from "./parts/os-notice";

export const STATES = [
  { id: "asking", label: "사람 확인 기다림(진행권 반납)" },
  { id: "answered", label: "답함 → 진행권 다시 받음" },
  { id: "ask-expired", label: "만료: 자동 답, 진행 재개" },
  { id: "other-thread", label: "다른 대화에 있을 때(받은 요청·OS 알림)" },
  { id: "other-inbox", label: "다른 대화 · 받은 요청 탭" },
  { id: "other-jumped", label: "알림에서 그 대화로" },
  { id: "child-approval", label: "자식 에이전트 승인 출처" },
  { id: "child-allowed", label: "자식 승인 허용 뒤" },
  { id: "approval-expired", label: "만료: 자동 거부" },
  { id: "conflict", label: "진행권 충돌(차례 기다림)" },
  { id: "conflict-first", label: "이 그룹 먼저 누름" },
  { id: "conflict-switched", label: "다음 단계 사이에서 교대" },
  { id: "conflict-withdrawn", label: "실패: 기다리던 그룹이 거둠" },
  { id: "helm-well", label: "Helm well(진행권 구역 뺌, P-05)" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const AT: Record<StateId, { script: string; n: number }> = {
  asking: { script: "ask-lease-release", n: 2 },
  answered: { script: "ask-lease-release", n: 4 },
  "ask-expired": { script: "ask-expire", n: 4 },
  "other-thread": { script: "ask-other-thread", n: 2 },
  "other-inbox": { script: "ask-other-thread", n: 2 },
  "other-jumped": { script: "ask-other-thread", n: 3 },
  "child-approval": { script: "child-approval", n: 2 },
  "child-allowed": { script: "child-approval", n: 4 },
  "approval-expired": { script: "approval-expired", n: 3 },
  conflict: { script: "drive-conflict-first", n: 1 },
  "conflict-first": { script: "drive-conflict-first", n: 2 },
  "conflict-switched": { script: "drive-conflict-first", n: 3 },
  "conflict-withdrawn": { script: "drive-conflict-withdrawn", n: 3 },
  "helm-well": { script: "drive-conflict-first", n: 1 },
};

export const SCENARIOS = [
  { id: "ask-lease-release", label: "사람 확인: 반납 → 답 → 다시 받음" },
  { id: "ask-expire", label: "실패: 답 없이 만료 → 자동 답" },
  { id: "ask-other-thread", label: "다른 대화에 있을 때 질문 옴" },
  { id: "child-approval", label: "렌즈(자식) 승인 출처" },
  { id: "approval-expired", label: "실패: 렌즈 승인 만료 → 자동 거부" },
  { id: "drive-conflict-first", label: "진행권 충돌: 이 그룹 먼저" },
  { id: "drive-conflict-withdrawn", label: "실패: 기다리던 그룹이 거둠" },
];

const ASK: QuestionApproval = {
  kind: "question",
  thread: T1_TITLE,
  at: "14:06",
  questions: [
    {
      id: "q1",
      header: "적용 순서",
      text: `${T.finding} 3개 중 무엇부터 적용할까요?`,
      multiSelect: false,
      allowFreeText: true,
      options: [
        {
          id: "f1",
          label: PICKS.f1 ?? "",
          description: "set은 초, isExpired는 밀리초",
          recommended: true,
        },
        { id: "f2", label: PICKS.f2 ?? "", description: "비교 쪽은 그대로 둬요" },
        { id: "f3", label: PICKS.f3 ?? "", description: "시험만 더해요" },
      ],
    },
  ],
};

const CHILD: ToolApproval = {
  ...approvals.a1,
  command: "bun test cache --reporter=verbose",
  args: { command: "bun test cache --reporter=verbose", cwd: "~/code/xeon", timeoutSeconds: 60 },
  secrets: [],
};

const SOURCE_HELM = "grp:helm";
const SOURCE_LENS = `${T.lens} 실패 사례 · grp:helm`;

const t2Items: ChatItem[] = [
  { k: "user", text: "느린 시험 다섯 개만 골라줘" },
  { k: "agent", text: "시간 순으로 정렬했어요. cache, sync, migrate, index, render 순이에요." },
];

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
  const [answer, setAnswer] = useState<{ pick: string | null; text: string }>({
    pick: "f1",
    text: "",
  });
  const [draft, setDraft] = useState("");

  // 시나리오를 처음부터 틀면 start로 시간표를 건다.
  useEffect(() => {
    if (pre.live && pre.prefill.length === 0) dispatch({ t: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 다른 대화에 있을 때 질문이 오면 토스트(앱 안)와 OS 알림(앱 밖)을 함께 낸다(flow §7.2).
  useEffect(() => {
    if (s.inboxAsk && s.open === "t2")
      toast({
        title: `질문 필요: ${EXT.helm}, ${T1_TITLE}`,
        description: `${T.humanGate}을 기다리는 동안 ${T.lead}을 놓았어요.`,
        tone: "neutral",
        actionLabel: "열기",
        onAction: () => dispatch({ t: "jump" }),
        duration: 0,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.inboxAsk]);

  const waiting = s.gate === "asking";
  const conflictScript = pre.script.startsWith("drive-conflict");
  // 사람 확인·승인 대본에서는 기다리는 그룹이 없다(반납한 진행권을 다른 그룹이 가져가는 경우는 그리지 않음).
  const queue: QueueRow[] = !conflictScript
    ? []
    : s.first === "switched"
      ? [{ group: "helm", state: "waiting", note: `수렴 이어서 · ${T.step} 4부터` }]
      : s.first === "withdrawn"
        ? [{ group: "work", state: "rejected", note: `${T.leadLimit} 넘음` }]
        : [
            {
              group: "review",
              state: "waiting",
              note: "tool.call.after 뒤 진행 원함",
              first: s.first === "requested",
            },
            { group: "work", state: "rejected", note: `${T.leadLimit} 넘음` },
          ];

  const runtimeLine = waiting
    ? `${EXT.helm} ${T.humanGate} 기다림 · ${T.lead} ${T.leadReturn}`
    : s.holder === "review"
      ? `${EXT.review} ${T.drive} · 변경 확인 · ${T.extension} 4`
      : s.first === "requested"
        ? `${EXT.helm} ${T.drive} · 다음 ${T.stepBoundary}에 review로`
        : `${EXT.helm} ${T.drive} · ${T.inquiry} 수렴 · ${T.extension} 4`;

  const askCard =
    s.gate === "expired" ? (
      <AgentRequest
        kind="permission"
        status="answered"
        title="답이 없어 자동으로 답했어요"
        subtitle={`${ASK.questions[0]?.header ?? ""} · ${PICKS.f1} · 14:21`}
        badge="만료"
      />
    ) : (
      <QuestionCard
        approval={ASK}
        status={s.gate === "answered" ? "answered" : s.gate === "denied" ? "denied" : "pending"}
        subtitle={`${SOURCE_HELM} · 14:06 · 14:21에 추천안으로 자동 답`}
        answer={s.gate === "answered" ? { pick: s.pick, text: "" } : answer}
        onAnswerChange={setAnswer}
        onAnswer={() => dispatch({ t: "answer", pick: answer.pick ?? "f1" })}
        onDeny={() => dispatch({ t: "deny" })}
      />
    );

  const apprCard =
    s.appr === "expired" ? (
      <AgentRequest
        kind="permission"
        status="denied"
        title="답이 없어 자동 거부했어요"
        subtitle={`bash · ${CHILD.command} · ${SOURCE_LENS}`}
        badge="만료"
      />
    ) : (
      <ToolApprovalCard
        approval={CHILD}
        decision={s.appr === "pending" ? "pending" : s.appr === "denied" ? "denied" : "allowed"}
        subtitle={`${SOURCE_LENS} · 지금 · 14:16에 자동 거부`}
        onDecide={(d) => dispatch({ t: "decide", d: d === "denied" ? "denied" : "allowed" })}
      />
    );

  const items: ChatItem[] = [...t1Base, ...s.items].map((it) =>
    it.k === "node" ? { ...it, node: it.key === "ask" ? askCard : apprCard } : it,
  );

  const list: Thread[] = threads.map((t) =>
    t.id === "t1" && s.inboxAsk ? { ...t, approvals: t.approvals + 1 } : t,
  );

  const inboxContent = (
    <div className="grid gap-4">
      {s.inboxAsk && (
        <QuestionCard
          approval={ASK}
          status="pending"
          flat
          subtitle={`${T1_TITLE} · ${SOURCE_HELM} · 14:06`}
          answer={answer}
          onAnswerChange={setAnswer}
          onAnswer={() => dispatch({ t: "answer", pick: answer.pick ?? "f1" })}
          onDeny={() => dispatch({ t: "deny" })}
          summary={{ onOpen: () => dispatch({ t: "jump" }) }}
        />
      )}
      <NoticeList notices={inbox.notices} />
    </div>
  );

  const runtime = (
    <RuntimePanel
      data={t1Runtime({
        holder: waiting ? null : s.holder,
        phase: s.holder === "review" ? "변경 확인" : `${T.inquiry} · 수렴`,
        gate: waiting
          ? { group: "helm", text: `답을 기다려요 · ${T.lead} ${T.leadReturn} · 14:21 만료` }
          : null,
        queue,
        switches: [
          ...(s.first === "switched"
            ? [{ at: "14:08", turn: 3, text: `${EXT.helm} → ${EXT.review} · 이 ${T.group} 먼저` }]
            : []),
          ...(s.gate === "answered" || s.gate === "expired" || s.gate === "denied"
            ? [
                {
                  at: s.gate === "expired" ? "14:21" : "14:07",
                  turn: 3,
                  text: `${EXT.helm} ${T.lead} ${T.leadRetake} · ${s.gate === "expired" ? "자동 답" : s.gate === "denied" ? "거부" : "답함"}`,
                },
              ]
            : []),
          ...(s.gate !== "none"
            ? [
                {
                  at: "14:06",
                  turn: 3,
                  text: `${EXT.helm} ${T.lead} ${T.leadReturn} · ${T.humanGate}`,
                },
              ]
            : []),
          ...t1Runtime().switches,
        ],
      })}
      onFirst={() => dispatch({ t: "first" })}
    />
  );

  const hint = (() => {
    if (pre.script === "drive-conflict-first" || pre.script === "drive-conflict-withdrawn")
      return s.first === "none" ? `런타임 탭 차례 행의 "이 ${T.group} 먼저"` : undefined;
    if (s.gate === "asking")
      return s.open === "t2" ? `토스트나 OS 알림의 "열기"` : "답을 고르고 답하기";
    if (s.appr === "pending") return "허용 또는 거부";
    return undefined;
  })();

  return (
    <>
      <Shell
        activeNav="chat"
        stageLabel={T.thread}
        threads={{
          currentId: s.open,
          items: list,
          onSelect: (id) => (id === "t1" ? dispatch({ t: "jump" }) : undefined),
          onNew: () => {},
        }}
        rightTabs={chatRightTabs({
          inbox: inboxContent,
          inboxBadge: 3 + (s.inboxAsk ? 1 : 0),
          runtime,
          plugins: [
            {
              id: "helm/panel",
              label: "탐구",
              icon: <Compass />,
              ext: "helm",
              content: <HelmWell onRuntime={() => shell.openEnd("runtime")} />,
            },
          ],
        })}
        status={defaultStatusCells({
          layout: shell.layout,
          thread: true,
          pendingApprovals: 2 + (s.appr === "pending" ? 1 : 0) + (waiting ? 1 : 0),
          openEnd: shell.openEnd,
          runtime: {
            drive: s.holder,
            extFailures: 1,
            onOpen: () => shell.openEnd("runtime"),
            ...(waiting ? { waiting: "helm" } : {}),
          },
        })}
      >
        {s.open === "t1" ? (
          <ChatStage
            follow={items.length}
            head={
              <ChatHead
                title={T1_TITLE}
                runtime={runtimeLine}
                runtimeLabel={`${T.runtime} 탭 열기: ${runtimeLine}`}
              />
            }
            composer={
              <ChatComposer
                value={draft}
                onValueChange={setDraft}
                running={!waiting}
                {...(waiting
                  ? {
                      note: `${EXT.helm}이 답을 기다려요. 보낸 메시지는 답이 아니라 다음 입력이 돼요.`,
                    }
                  : {})}
                onSubmit={() => setDraft("")}
              />
            }
          >
            <Items items={items} />
          </ChatStage>
        ) : (
          <ChatStage
            follow="t2"
            head={<ChatHead title="테스트 정리" runtime={`${T.lead} 없음 · ${T.extension} 3`} />}
            composer={
              <ChatComposer value="" onValueChange={() => {}} running={false} onSubmit={() => {}} />
            }
          >
            <Items items={t2Items} />
          </ChatStage>
        )}
      </Shell>
      {s.osNotice && state !== "other-inbox" && (
        <OsNotice
          title={`Xeon · ${T1_TITLE}`}
          body={`${EXT.helm}이 ${josa(T.humanGate, "을", "를")} 기다려요: ${ASK.questions[0]?.text ?? ""}`}
          onOpen={() => dispatch({ t: "jump" })}
          onClose={() => dispatch({ t: "dismissOs" })}
        />
      )}
      <Toaster label="알림" />
      <ScenarioDock scenarios={SCENARIOS} hint={hint} />
    </>
  );
}

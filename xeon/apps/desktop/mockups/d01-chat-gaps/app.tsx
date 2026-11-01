// 묶음 D · 대화 영역 빈칸(N-42~N-46, O-06, 계획에 없음 6). 대화는 t1 "캐시 무효화 조사"(p02와 같은 사실).
// 한 상태 기계(flow.ts)가 ?state=, ?scenario=, &step=을 함께 돌린다.
import {
  Alert,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  ScrollArea,
  toast,
} from "@caustic/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarClock,
  chatRightTabs,
  defaultStatusCells,
  Download,
  Ellipsis,
  GitBranch,
  inbox,
  NoticeList,
  Pencil,
  RotateCw,
  ScenarioDock,
  Shell,
  ShellToaster,
  SquareStack,
  T,
  Trash2,
  useShell,
  X,
  type Thread,
} from "../_shell";
import {
  ChatComposer,
  ChatHead,
  Items,
  READ_WIDTH,
  RuntimePanel,
  t1Base,
  t1Runtime,
  t1RuntimeLine,
  useMachine,
  usePrefill,
  type ChatItem,
} from "../_chat-rt";
import { effect, init, LONG, reduce, SCRIPTS, type A, type S } from "./flow";
import { ApprovalCard, KIND_LABEL, type CardKind } from "./parts/approval-card";
import {
  LongToolRow,
  NewMessages,
  ReadFail,
  ResumeBand,
  TranscriptLoading,
  TurnFail,
} from "./parts/bands";
import {
  DeleteScheduleDialog,
  DeleteThreadDialog,
  ExportDialog,
  RenameDialog,
} from "./parts/dialogs";

export const STATES = [
  { id: "main", label: "기본(긴 도구 결과 · 도구 승인)" },
  { id: "cards-transcript", label: "승인 카드 네 종류 · 트랜스크립트" },
  { id: "cards-well", label: "승인 카드 네 종류 · 받은 요청 well" },
  { id: "cards-page", label: "승인 카드 네 종류 · P-03 무대" },
  { id: "cards-resolved", label: "답한 뒤(세 곳 함께 기록 줄)" },
  { id: "loading", label: "대화 읽는 중" },
  { id: "read-fail", label: "대화 읽기 실패" },
  { id: "turn-fail", label: "턴 실패 Alert" },
  { id: "new-msgs", label: "위로 올려 읽는 중 · 새 메시지 N" },
  { id: "restarting", label: "앱 다시 시작 직후" },
  { id: "resume-band", label: "이어서 실행 띠" },
  { id: "resume-resumed", label: "이어서 실행 → resumed" },
  { id: "resume-closed", label: "이어서 실행 → closed" },
  { id: "resume-nothing", label: "이어서 실행 → nothing" },
  { id: "row-menu", label: "대화 행 메뉴" },
  { id: "rename", label: "이름 바꾸기" },
  { id: "forked", label: "분기 뒤" },
  { id: "delete", label: "O-06 대화 삭제 확인" },
  { id: "delete-running", label: "O-06 실행 중이라 못 지움" },
  { id: "schedule-delete", label: "O-06 예약 변형" },
  { id: "export", label: "대화 내보내기" },
  { id: "export-fail", label: "내보내기 실패(권한)" },
  { id: "list-loading", label: "목록 읽는 중(5행)" },
  { id: "list-fail", label: "목록 읽기 실패" },
  { id: "list-more", label: "50개 뒤 더 보기" },
  { id: "list-empty", label: "목록 빈" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const AT: Record<StateId, { script: string; n: number }> = {
  main: { script: "base", n: 1 },
  "cards-transcript": { script: "cards-all", n: 4 },
  "cards-well": { script: "cards-all", n: 4 },
  "cards-page": { script: "cards-all", n: 4 },
  "cards-resolved": { script: "approval-sync", n: 6 },
  loading: { script: "read-fail", n: 2 },
  "read-fail": { script: "read-fail", n: 3 },
  "turn-fail": { script: "turn-fail-retry", n: 4 },
  "new-msgs": { script: "new-messages", n: 11 },
  restarting: { script: "resume-after-restart", n: 2 },
  "resume-band": { script: "resume-after-restart", n: 3 },
  "resume-resumed": { script: "resume-after-restart", n: 5 },
  "resume-closed": { script: "resume-closed", n: 5 },
  "resume-nothing": { script: "resume-nothing", n: 5 },
  "row-menu": { script: "thread-menu", n: 2 },
  rename: { script: "thread-menu", n: 3 },
  forked: { script: "thread-menu", n: 6 },
  delete: { script: "thread-menu", n: 11 },
  "delete-running": { script: "thread-menu", n: 8 },
  "schedule-delete": { script: "schedule-delete", n: 3 },
  export: { script: "export-thread", n: 3 },
  "export-fail": { script: "export-fail", n: 6 },
  "list-loading": { script: "list-states", n: 2 },
  "list-fail": { script: "list-states", n: 3 },
  "list-more": { script: "list-states", n: 5 },
  "list-empty": { script: "base", n: 1 },
};

export const SCENARIOS = [
  { id: "turn-fail-retry", label: "턴 실패 → 다시 시도" },
  { id: "resume-after-restart", label: "앱 재시작 → 이어서 실행(resumed)" },
  { id: "resume-closed", label: "실패: 이어서 실행 → closed" },
  { id: "resume-nothing", label: "이어서 실행 → nothing" },
  { id: "thread-menu", label: "행 메뉴: 이름·분기·삭제" },
  { id: "schedule-delete", label: "예약 대화: 예약 지우기" },
  { id: "export-thread", label: "대화 내보내기" },
  { id: "export-fail", label: "실패: 내보내기 권한 없음" },
  { id: "list-states", label: "목록: 읽는 중 → 실패 → 다시 → 더 보기" },
  { id: "read-fail", label: "실패: 대화 읽기 실패 → 다시 읽기" },
  { id: "new-messages", label: "위로 올려 읽기 · 새 메시지 N" },
  { id: "approval-sync", label: "승인 카드 세 곳 함께 사라짐" },
];

const KINDS: CardKind[] = ["tool", "question", "plan", "review"];

/** t1이 아닌 대화의 짧은 트랜스크립트(읽기 실패 뒤 다시 읽은 모습, 분기한 대화). */
function otherItems(title: string): ChatItem[] {
  return [
    {
      k: "user",
      text: title.startsWith("빌드") ? "CI 빌드가 왜 깨졌는지 봐줘" : "이어서 정리해줘",
    },
    {
      k: "tool",
      name: "bash",
      detail: "bun run build",
      status: "failed",
      duration: "8.4s",
      output: "error TS2307: Cannot find module './cache/policy'",
    },
    {
      k: "agent",
      text: "src/cache/policy.ts가 이름이 바뀐 뒤 import가 남아 있었어요. 고친 줄을 보여 드릴게요.",
    },
  ];
}

/** 대화 무대(ChatStage를 이 화면에 맞게 다시 짬): "새 메시지 N"이면 바닥 따라가기를 멈추고 위에 머문다. */
function Stage({
  head,
  children,
  band,
  composer,
  follow,
  pinnedUp,
  overlay,
}: {
  head: ReactNode;
  children: ReactNode;
  band?: ReactNode;
  composer?: ReactNode;
  follow: unknown;
  pinnedUp: boolean;
  overlay?: ReactNode;
}) {
  const vp = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = vp.current;
    if (el === null) return;
    if (pinnedUp) {
      if (el.scrollTop > el.scrollHeight - el.clientHeight - 400) el.scrollTop = 120;
    } else el.scrollTop = el.scrollHeight;
  }, [follow, pinnedUp]);
  return (
    <>
      {head}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ScrollArea label="대화 내용" className="min-h-0 flex-1" viewportRef={vp}>
          <div
            role="log"
            aria-live="polite"
            aria-label="대화 기록"
            className={`${READ_WIDTH} grid gap-4 pt-1 pb-3 [&>*]:min-w-0`}
          >
            {children}
          </div>
        </ScrollArea>
        {overlay !== undefined && <div className="absolute inset-x-0 bottom-2">{overlay}</div>}
      </div>
      {(band !== undefined || composer !== undefined) && (
        <div className={`${READ_WIDTH} grid flex-none gap-1.5 pb-1.5`}>
          {band}
          {composer}
        </div>
      )}
    </>
  );
}

function ThreadMenuItems({ t, dispatch }: { t: Thread; dispatch: (a: A) => void }) {
  return (
    <>
      <MenuItem icon={<Pencil />} onSelect={() => dispatch({ t: "renameOpen", id: t.id })}>
        이름 바꾸기
      </MenuItem>
      <MenuItem icon={<GitBranch />} onSelect={() => dispatch({ t: "fork", id: t.id })}>
        {T.fork}
      </MenuItem>
      <MenuItem icon={<SquareStack />} onSelect={() => dispatch({ t: "compact", id: t.id })}>
        {T.compaction}
      </MenuItem>
      <MenuItem icon={<Download />} onSelect={() => dispatch({ t: "exportOpen", id: t.id })}>
        내보내기…
      </MenuItem>
      <MenuSeparator />
      {t.id === "t4" && (
        <MenuItem icon={<CalendarClock />} onSelect={() => dispatch({ t: "deleteSchedule" })}>
          예약 지우기…
        </MenuItem>
      )}
      <MenuItem icon={<X />} onSelect={() => dispatch({ t: "close", id: t.id })}>
        닫기
      </MenuItem>
      <MenuItem
        icon={<Trash2 />}
        tone="danger"
        onSelect={() => dispatch({ t: "deleteOpen", id: t.id })}
      >
        지우기…
      </MenuItem>
    </>
  );
}

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const pre = usePrefill(SCRIPTS, AT[state]);
  const [s, dispatch] = useMachine<S, A>({
    init: init(pre.script),
    reduce,
    prefill: state === "cards-page" ? [...pre.prefill, { t: "stage", v: "inbox" }] : pre.prefill,
    effect,
    kick: pre.live,
  });
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (pre.live && pre.prefill.length === 0) dispatch({ t: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 상태 기계가 낸 토스트(이름 바꿈, 분기, 내보냄 …)를 caustic toast로.
  useEffect(() => {
    const t = s.toast;
    // 정적 상태에서는 대화 상자가 열린 순간에 앞 단계의 토스트를 띄우지 않는다(스크린숏이 섞이지 않게).
    if (t === null || (!pre.live && s.dialog !== null)) return;
    toast({
      title: t.title,
      ...(t.description !== undefined ? { description: t.description } : {}),
      tone: t.tone ?? "neutral",
      ...(t.action !== undefined ? { actionLabel: t.action, onAction: () => {} } : {}),
      duration: 0,
    });
  }, [s.toast]);

  const openThread = s.list.find((t) => t.id === s.open);
  const openTitle =
    openThread === undefined
      ? "캐시 무효화 조사"
      : openThread.title === ""
        ? "제목 없음"
        : openThread.title;
  const isT1 = s.open === "t1";

  const decide = (k: CardKind, d: "allowed" | "denied" | "answered") =>
    dispatch({ t: "decide", k, d });

  const cardsIn = (where: "transcript" | "well" | "page", pendingOnly: boolean) =>
    KINDS.filter((k) => {
      const st = s.cards[k];
      return st !== "none" && (!pendingOnly || st === "pending");
    }).map((k) => {
      const st = s.cards[k];
      return (
        <ApprovalCard
          key={k}
          kind={k}
          status={st === "none" ? "pending" : st}
          where={where}
          onDecide={(d) => decide(k, d)}
        />
      );
    });

  const pendingCount = KINDS.filter((k) => s.cards[k] === "pending").length;

  // 트랜스크립트: t1 앞부분 + 상태 기계 항목(긴 도구 결과는 node) + 끝에 승인 카드.
  const items: ChatItem[] = (isT1 ? [...t1Base, ...s.items] : otherItems(openTitle)).map((it) =>
    it.k === "node" && it.key === "long-tool"
      ? { ...it, node: <LongToolRow {...LONG} defaultOpen={state === "main"} /> }
      : it,
  );

  const resumeBusy = s.resume === "resuming";
  const band =
    s.resume === "offered" || s.resume === "resuming" ? (
      <ResumeBand
        at="14:02"
        busy={resumeBusy}
        onResume={() => dispatch({ t: "resume" })}
        onLeave={() => dispatch({ t: "leave" })}
      />
    ) : s.resume === "restarting" ? (
      <Alert tone="neutral" size="sm" icon={<RotateCw />}>
        앱을 다시 열었어요. {T.thread}를 다시 맞추는 중이에요…
      </Alert>
    ) : undefined;

  const composerNote =
    s.resume === "restarting"
      ? `${T.engine}이 다시 붙는 중이에요. 쓰던 글은 남아요.`
      : s.resume === "offered"
        ? `새로 보내면 멈춘 ${T.turn}은 그대로 두고 새 ${T.turn}을 시작해요.`
        : undefined;

  const headMenu = (
    <Menu
      size="sm"
      align="end"
      trigger={
        <IconButton size="sm" variant="ghost" label={`${openTitle} 메뉴`}>
          <Ellipsis />
        </IconButton>
      }
    >
      {openThread !== undefined && <ThreadMenuItems t={openThread} dispatch={dispatch} />}
    </Menu>
  );

  const stageChat = (
    <Stage
      follow={`${items.length}-${s.fail ?? ""}-${s.resume}-${KINDS.map((k) => s.cards[k]).join()}`}
      pinnedUp={s.newMsgs > 0}
      overlay={
        s.newMsgs > 0 ? (
          <NewMessages count={s.newMsgs} onJump={() => dispatch({ t: "jump" })} />
        ) : undefined
      }
      head={
        <ChatHead
          title={openTitle}
          {...(isT1
            ? {
                runtime:
                  s.resume === "restarting" || s.resume === "offered" || s.resume === "resuming"
                    ? `${T.lead} 없음 · 멈춘 ${T.turn} 1 · ${T.extension} 4`
                    : t1RuntimeLine,
                runtimeLabel: `${T.runtime} 탭 열기`,
              }
            : {})}
          end={headMenu}
        />
      }
      band={band}
      composer={
        <ChatComposer
          value={draft}
          onValueChange={setDraft}
          running={s.running}
          disabled={s.resume === "restarting" || s.view !== "ok"}
          {...(composerNote !== undefined ? { note: composerNote } : {})}
          onSubmit={(text) => {
            setDraft("");
            dispatch({ t: "send", text });
          }}
          onStop={() => dispatch({ t: "fail" })}
        />
      }
    >
      {s.view === "loading" || s.view === "rereading" ? (
        <TranscriptLoading />
      ) : s.view === "readFail" ? (
        <div className="pt-16">
          <ReadFail onRetry={() => dispatch({ t: "reread" })} busy={false} />
        </div>
      ) : (
        <>
          <Items items={items} />
          {isT1 && cardsIn("transcript", false)}
          {s.fail !== null && (
            <TurnFail
              reason={s.fail}
              onRetry={() => dispatch({ t: "retry" })}
              onDismiss={() => dispatch({ t: "dismissFail" })}
            />
          )}
        </>
      )}
    </Stage>
  );

  // P-03 무대(받은 요청 전체 보기): 같은 카드 부품, 오른쪽 well은 닫힘(DP-34).
  const stageInbox = (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className={`${READ_WIDTH} flex h-10 flex-none items-center gap-2`}>
        <h1 className="m-0 text-ui-strong text-text-primary">{T.inbox}</h1>
      </header>
      <ScrollArea label={T.inbox} className="min-h-0 flex-1">
        <div className={`${READ_WIDTH} grid gap-3 pb-4`}>
          <h2 className="m-0 flex h-7 items-center gap-1.5 text-ui-sm font-semibold text-text-primary">
            {T.approval}
            <span className="tabular-nums text-text-tertiary">{pendingCount}</span>
            <span className="ms-auto text-ui-xs font-normal text-text-tertiary">
              {KINDS.map((k) => KIND_LABEL[k]).join(" · ")}
            </span>
          </h2>
          {cardsIn("page", false)}
        </div>
      </ScrollArea>
    </div>
  );

  const inboxWell = (
    <div className="grid gap-4">
      {cardsIn("well", true)}
      <NoticeList notices={inbox.notices} />
    </div>
  );

  const hint = (() => {
    switch (pre.script) {
      case "turn-fail-retry":
        return s.fail !== null ? "Alert의 다시 시도" : undefined;
      case "resume-after-restart":
      case "resume-closed":
      case "resume-nothing":
        return s.resume === "offered" ? `띠의 "${T.resume}"` : undefined;
      case "thread-menu":
        return "왼쪽 대화 행 위에 올리면 ⋯ 메뉴 · 이름 바꾸기, 분기, 지우기";
      case "schedule-delete":
        return "‘예약: 매일 정리’ 행 ⋯ → 예약 지우기";
      case "export-thread":
      case "export-fail":
        return s.dialog === null ? "‘캐시 무효화 조사’ 행 ⋯ → 내보내기" : "저장…";
      case "list-states":
        return s.listState === "error"
          ? "다시 읽기"
          : s.more === "shown"
            ? "목록 아래 더 보기"
            : undefined;
      case "read-fail":
        return s.view === "readFail" ? "다시 읽기" : undefined;
      case "new-messages":
        return s.newMsgs > 0 ? "새 메시지 N 버튼" : undefined;
      case "approval-sync":
        return "카드 하나를 well이나 트랜스크립트에서 답해 보세요";
      default:
        return undefined;
    }
  })();

  const dialogThread =
    s.dialog !== null && s.dialog.k !== "deleteSchedule"
      ? s.list.find((t) => t.id === (s.dialog as { id: string }).id)
      : undefined;

  return (
    <>
      <Shell
        activeNav={s.stage === "inbox" ? "inbox" : "chat"}
        onNavSelect={(id) => (id === "chat" ? dispatch({ t: "stage", v: "chat" }) : undefined)}
        stageLabel={s.stage === "inbox" ? T.inbox : T.thread}
        modalOpen={s.dialog !== null}
        threads={{
          currentId: s.stage === "inbox" ? null : s.open,
          items: state === "list-empty" ? [] : s.list,
          onSelect: (id) => dispatch({ t: "openThread", id }),
          onNew: () => {},
          rowMenu: (t) => <ThreadMenuItems t={t} dispatch={dispatch} />,
          menuOpenId: s.menu ?? undefined,
          listState: s.listState === "ok" ? undefined : s.listState,
          onRetry: () => dispatch({ t: "listRetry" }),
          ...(s.more === "shown" || s.more === "loading"
            ? {
                more: {
                  label: "더 보기 · 50개 뒤",
                  loading: s.more === "loading",
                  onMore: () => dispatch({ t: "more" }),
                },
              }
            : {}),
        }}
        rightTabs={chatRightTabs({
          inbox: inboxWell,
          inboxBadge: pendingCount + 3,
          runtime: <RuntimePanel data={t1Runtime()} />,
        })}
        status={defaultStatusCells({
          layout: shell.layout,
          thread: s.stage === "chat",
          pendingApprovals: pendingCount,
          openEnd: shell.openEnd,
          runtime: { drive: "helm", extFailures: 0, onOpen: () => shell.openEnd("runtime") },
        })}
      >
        {s.stage === "inbox" ? stageInbox : stageChat}
      </Shell>
      {s.dialog?.k === "rename" && dialogThread !== undefined && (
        <RenameDialog
          title={dialogThread.title}
          onClose={() => dispatch({ t: "dialogClose" })}
          onSave={(title) => dispatch({ t: "rename", id: dialogThread.id, title })}
        />
      )}
      {s.dialog?.k === "delete" && dialogThread !== undefined && (
        <DeleteThreadDialog
          f={{
            title: dialogThread.title === "" ? "제목 없음" : dialogThread.title,
            messages: dialogThread.id === "t1" ? 24 : 9,
            attachments: dialogThread.id === "t1" ? 2 : 0,
            schedules: 0,
            forks: dialogThread.id === "t1" ? 1 : 0,
            running: dialogThread.status === "running",
          }}
          onClose={() => dispatch({ t: "dialogClose" })}
          onConfirm={() => dispatch({ t: "deleteConfirm", id: dialogThread.id })}
        />
      )}
      {s.dialog?.k === "deleteSchedule" && (
        <DeleteScheduleDialog
          onClose={() => dispatch({ t: "dialogClose" })}
          onConfirm={() => dispatch({ t: "deleteScheduleConfirm" })}
        />
      )}
      {s.dialog?.k === "export" && dialogThread !== undefined && (
        <ExportDialog
          title={dialogThread.title}
          format={s.exportFmt}
          phase={s.exportPhase}
          onFormat={(f) => dispatch({ t: "exportFmt", f })}
          onSave={() => dispatch({ t: "exportGo" })}
          onClose={() => dispatch({ t: "dialogClose" })}
        />
      )}
      <ShellToaster />
      <ScenarioDock scenarios={SCENARIOS} hint={hint} />
    </>
  );
}

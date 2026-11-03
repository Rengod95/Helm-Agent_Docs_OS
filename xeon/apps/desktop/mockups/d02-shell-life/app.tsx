// 묶음 D · 셸 수명(N-51~N-56, N-58, S-04, 계획에 없음 1·5·10). 대화는 t1 "캐시 무효화 조사"(p02와 같은 사실).
// 엔진·연결·안전 모드·업데이트·진행 중은 모두 상태 표시줄 칸(Popover)과 무대 띠로만 드러낸다(DP-05: 위 띠 없음).
// 한 상태 기계(flow.ts)가 ?state=, ?scenario=, &step=을 함께 돌린다.
import { toast } from "@caustic/react";
import { useEffect, useState } from "react";
import {
  josa,
  chatRightTabs,
  defaultStatusCells,
  extName,
  inbox,
  NoticeList,
  ScenarioDock,
  Shell,
  ShellToaster,
  T,
  useShell,
  type StatusCell,
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
  useMachine,
  usePrefill,
  type ChatItem,
} from "../_chat-rt";
import { ApprovalCard } from "../d01-chat-gaps/parts/approval-card";
import { effect, init, reduce, SCRIPTS, type A, type S } from "./flow";
import {
  BgWorkBody,
  EngineBand,
  Relaunch,
  RestartDialog,
  SAFE_OFF,
  SafeBody,
  SafeSuggestCard,
  UpdateBody,
  type BgItem,
} from "./parts/life";
import { NotifySettings } from "./parts/notify-settings";
import { Desktop, MacMenuBar, OS_COPY, OsBanners } from "./parts/os-chrome";

type Pop = "bg" | "upd" | "safe" | "engine" | "target";
type Os = "tray" | "tray-closed" | "mac-app" | "mac-thread";
interface Look {
  script: string;
  n: number;
  pop?: Pop;
  os?: Os;
  web?: boolean;
}

export const STATES = [
  { id: "main", label: "기본(진행 중 칸)" },
  { id: "bg-popover", label: "진행 중 Popover(백그라운드 작업)" },
  { id: "bg-fail", label: "백그라운드 작업 실패" },
  { id: "engine-restarting", label: "엔진 다시 시작 중(1/3)" },
  { id: "engine-failed", label: "엔진 시작 실패 + 안전 모드 제안" },
  { id: "engine-popover", label: "엔진 실패 칸 Popover" },
  { id: "safe-starting", label: "안전 모드로 시작 중" },
  { id: "safe-mode", label: "안전 모드(대화 영역 칩)" },
  { id: "safe-chip", label: "안전 모드 칩 Popover" },
  { id: "reattach", label: "화면 다시 붙는 중(WebView)" },
  { id: "reattached", label: "화면 다시 붙음" },
  { id: "web-failed", label: "웹: 서비스 연결 실패" },
  { id: "update-available", label: "업데이트 있음" },
  { id: "update-downloading", label: "업데이트 내려받는 중" },
  { id: "update-confirm", label: "다시 시작 확인(턴 실행 중)" },
  { id: "update-applying", label: "업데이트 적용 중" },
  { id: "update-done", label: "업데이트 뒤" },
  { id: "update-fail-download", label: "실패: 내려받기" },
  { id: "update-fail-signature", label: "실패: 서명 불일치" },
  { id: "toast-well", label: "토스트 · well 왼쪽" },
  { id: "toast-nowell", label: "토스트 · well 닫힘" },
  { id: "os-banners", label: "OS 알림 네 종류" },
  { id: "os-landed", label: "OS 알림 눌러 카드로" },
  { id: "notify-denied", label: "OS 알림 권한 거부" },
  { id: "notify-settings", label: "알림 끄는 자리(설정)" },
  { id: "tray", label: "메뉴 막대 아이콘 메뉴" },
  { id: "tray-closed", label: "창 닫은 뒤 메뉴 막대" },
  { id: "mac-menu", label: "macOS 앱 메뉴" },
  { id: "mac-menu-thread", label: "macOS 대화 메뉴" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const AT: Record<StateId, Look> = {
  main: { script: "base", n: 1 },
  "bg-popover": { script: "base", n: 1, pop: "bg" },
  "bg-fail": { script: "background-work", n: 2, pop: "bg" },
  "engine-restarting": { script: "engine-crash", n: 2 },
  "engine-failed": { script: "engine-crash-safe", n: 5 },
  "engine-popover": { script: "engine-crash-safe", n: 5, pop: "engine" },
  "safe-starting": { script: "engine-crash-safe", n: 6 },
  "safe-mode": { script: "engine-crash-safe", n: 7 },
  "safe-chip": { script: "engine-crash-safe", n: 7, pop: "safe" },
  reattach: { script: "webview-reattach", n: 2 },
  reattached: { script: "webview-reattach", n: 3 },
  "web-failed": { script: "engine-crash", n: 2, web: true },
  "update-available": { script: "app-update", n: 2, pop: "upd" },
  "update-downloading": { script: "app-update", n: 4, pop: "upd" },
  "update-confirm": { script: "app-update", n: 6 },
  "update-applying": { script: "app-update", n: 7 },
  "update-done": { script: "app-update", n: 8 },
  "update-fail-download": { script: "app-update-fail", n: 5, pop: "upd" },
  "update-fail-signature": { script: "app-update-fail", n: 7, pop: "upd" },
  "toast-well": { script: "toast-well", n: 2 },
  "toast-nowell": { script: "toast-well", n: 4 },
  "os-banners": { script: "os-all", n: 5 },
  "os-landed": { script: "notifications", n: 3 },
  "notify-denied": { script: "notifications-denied", n: 2 },
  "notify-settings": { script: "notifications-denied", n: 3 },
  tray: { script: "base", n: 1, os: "tray" },
  "tray-closed": { script: "base", n: 1, os: "tray-closed" },
  "mac-menu": { script: "base", n: 1, os: "mac-app" },
  "mac-menu-thread": { script: "base", n: 1, os: "mac-thread" },
};

export const SCENARIOS = [
  { id: "engine-crash", label: "엔진이 멈춤 → 다시 시작 → 돌아옴" },
  { id: "engine-crash-safe", label: "실패: 3번 시작 실패 → 안전 모드로 시작" },
  { id: "webview-reattach", label: "화면(WebView)만 죽음 → 다시 붙음" },
  { id: "app-update", label: "앱 업데이트: 확인 → 내려받기 → 다시 시작 확인" },
  { id: "app-update-fail", label: "실패: 내려받기 끊김 → 서명 불일치" },
  { id: "notifications", label: "다른 대화에서 OS 알림 → 눌러 카드로" },
  { id: "notifications-denied", label: "실패: OS 알림 권한 거부 → 설정" },
  { id: "background-work", label: "진행 중 Popover → 실패 → 그 대화로" },
  { id: "toast-well", label: "토스트 자리: well 열림·닫힘" },
];

/** 진행 중 Popover 목록(host.status.liveTurns + 테스트·예약·제작 대화). */
function bgItems(fail: boolean): BgItem[] {
  return [
    { kind: "thread", id: "t1", title: "캐시 무효화 조사", note: `${T.turn} 3 · 2분` },
    { kind: "thread", id: "t3", title: "빌드 실패 분석", note: "승인 기다림" },
    { kind: "trial", id: "t8", title: "렌즈 5개로 넓히기", note: `${T.step} 4` },
    fail
      ? {
          kind: "schedule",
          id: "t4",
          title: "매일 정리",
          note: "실패 · rate_limited",
          failed: true,
        }
      : { kind: "schedule", id: "t4", title: "매일 정리", note: "09:00 실행 중" },
    { kind: "authoring", id: "ta", title: "아침 요약 그룹 만들기", note: T.stageValidate },
  ];
}

const T2: ChatItem[] = [
  { k: "user", text: "느린 테스트 다섯 개만 골라줘" },
  { k: "agent", text: "시간 순으로 정렬했어요. cache, sync, migrate, index, render 순이에요." },
];
const T3: ChatItem[] = [
  { k: "user", text: "CI 빌드가 왜 깨졌는지 봐줘" },
  {
    k: "agent",
    text: "src/cache/policy.ts 이름이 바뀐 뒤 import가 남아 있었어요. 고쳤고 빌드가 통과해요.",
  },
];

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const look = AT[state];
  const pre = usePrefill(SCRIPTS, look);
  const [s, dispatch] = useMachine<S, A>({
    init: { ...init(pre.script), web: look.web === true },
    reduce,
    prefill: pre.prefill,
    effect,
    kick: pre.live,
  });
  const [draft, setDraft] = useState("");
  const [trayOpen, setTrayOpen] = useState(look.os === "tray" || look.os === "tray-closed");

  useEffect(() => {
    if (pre.live && pre.prefill.length === 0) dispatch({ t: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = s.toast;
    if (t === null || (!pre.live && state === "update-confirm")) return;
    toast({
      title: t.title,
      ...(t.description !== undefined ? { description: t.description } : {}),
      tone: t.tone ?? "neutral",
      ...(t.action !== undefined
        ? {
            actionLabel: t.action,
            onAction: () =>
              t.action === "설정 보기" ? dispatch({ t: "openSettings" }) : undefined,
          }
        : {}),
      duration: 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.toast]);

  // 시나리오가 well을 열고 닫는다(토스트 자리 확인).
  useEffect(() => {
    if (s.well !== null) shell.setEndOpen(s.well);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.well]);

  // OS 알림이 오면 앱 안 토스트도(창이 앞에 있어도 기본으로 보임, §6.4).
  const [seen, setSeen] = useState(s.os.length);
  useEffect(() => {
    if (s.os.length > seen && pre.live) {
      const k = s.os[s.os.length - 1];
      if (k !== undefined)
        toast({
          title: OS_COPY[k].title,
          description: OS_COPY[k].body,
          tone: "neutral",
          actionLabel: "열기",
          onAction: () => dispatch({ t: "osOpen", k }),
          duration: 0,
        });
    }
    setSeen(s.os.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.os.length]);

  if (s.view === "settings") return <NotifySettings denied={s.perm === "denied"} />;

  const pop = look.pop;
  const failed = s.engine === "failed";
  const down = s.engine !== "running";

  const target: StatusCell | undefined = s.web
    ? {
        id: "target",
        text: "웹 · build-box",
        title: "대상",
        description:
          "이 탭은 build-box의 서비스에 붙어 있어요. 웹은 엔진을 직접 다시 시작하지 못해요.",
      }
    : undefined;

  const engine: StatusCell | undefined = s.web
    ? {
        id: "engine",
        text: `서비스 응답 없음 ${s.attempt}/3`,
        dot: "danger",
        title: "서비스",
        description:
          "build-box의 서비스가 응답하지 않아요. 서비스를 다시 시작하는 일은 그 컴퓨터에서 해요.",
        inline: [{ label: "다시 연결", onSelect: () => {} }],
      }
    : s.engine === "restarting"
      ? {
          id: "engine",
          text: `다시 시작 중 ${s.attempt}/3`,
          dot: "warning",
          title: T.engine,
          description: `${josa(T.engine, "이", "가")} 멈춰 다시 시작하고 있어요. 10분 안에 3번까지 자동으로 해요.`,
        }
      : s.engine === "starting-safe"
        ? {
            id: "engine",
            text: `${josa(T.safeMode, "으로", "로")} 시작 중`,
            dot: "warning",
            title: T.engine,
            description: `${josa(SAFE_OFF, "을", "를")} 싣지 않고 시작해요.`,
          }
        : failed
          ? {
              id: "engine",
              text: `${T.engine} 시작 실패`,
              dot: "danger",
              title: `${T.engine} 시작 실패`,
              description: `3번 연속 시작하지 못했어요. 원인은 ${extName("acme-notes")} 시작 오류예요(ext:acme-notes).`,
              action: {
                label: `${T.engine} 다시 시작`,
                onSelect: () => dispatch({ t: "retryEngine" }),
              },
              secondary: { label: "진단 복사", onSelect: () => dispatch({ t: "copyDiag" }) },
              inline: [
                { label: `${T.engine} 다시 시작`, onSelect: () => dispatch({ t: "retryEngine" }) },
              ],
              defaultOpen: pop === "engine",
            }
          : undefined;

  const link: StatusCell | undefined = down
    ? {
        id: "link",
        text: failed ? "끊김" : "다시 연결 중",
        dot: failed ? "danger" : "warning",
        title: "연결",
        description: failed
          ? `${josa(T.engine, "이", "가")} 없어 연결이 끊겼어요. 대화는 읽기만 돼요.`
          : `${josa(T.engine, "이", "가")} 돌아오면 다시 맞춰요. 끊긴 동안의 스트리밍 조각은 버리고 완성된 항목만 다시 받아요.`,
      }
    : undefined;

  const safeChip: StatusCell[] = s.safe
    ? [
        {
          id: "safe",
          text: T.safeMode,
          dot: "warning",
          title: T.safeMode,
          description: `${josa(SAFE_OFF, "을", "를")} 싣지 않았어요. 그래서 이 대화에 Helm이 없어요.`,
          body: <SafeBody />,
          wide: true,
          action: { label: `${T.engine} 화면 열기`, onSelect: () => {} },
          secondary: {
            label: `${T.safeMode} 끄고 다시 시작`,
            onSelect: () => dispatch({ t: "safeOff" }),
          },
          defaultOpen: pop === "safe",
        },
      ]
    : [];

  const items = bgItems(s.bgFail);
  const live: StatusCell | undefined = down
    ? undefined
    : {
        id: "live",
        text: `${T.liveWork} ${items.length}`,
        label: `${T.backgroundWork} ${items.length}개${s.bgFail ? ", 실패 1" : ""}`,
        ...(s.bgFail ? { dot: "danger" as const } : {}),
        title: T.backgroundWork,
        description: `${T.thread} 2 · ${T.trial} 1 · ${T.schedules} 1 · ${T.authoringSession} 1`,
        body: (
          <BgWorkBody
            items={items}
            onGo={(it) => dispatch({ t: "go", id: it.id === "t3" ? "t3" : "t1" })}
          />
        ),
        defaultOpen: pop === "bg",
        wide: true,
      };

  const upd: StatusCell[] =
    s.upd === "none" || s.upd === "done" || s.upd === "applying"
      ? []
      : [
          {
            id: "update",
            text:
              s.upd === "downloading"
                ? `업데이트 ${s.pct}%`
                : s.upd === "ready"
                  ? "다시 시작해서 업데이트"
                  : s.upd === "available"
                    ? "업데이트"
                    : "업데이트 실패",
            dot: s.upd === "failDownload" || s.upd === "failSignature" ? "danger" : "success",
            title: `${T.appUpdate} 0.4.2`,
            description:
              s.upd === "failSignature"
                ? "받은 파일의 서명을 확인하지 못했어요."
                : s.upd === "failDownload"
                  ? "내려받다가 멈췄어요."
                  : "새 버전이 있어요. 설정과 대화는 그대로 남아요.",
            body: <UpdateBody u={s.upd} pct={s.pct} />,
            wide: true,
            ...(s.upd === "available"
              ? { action: { label: "내려받기", onSelect: () => dispatch({ t: "download" }) } }
              : s.upd === "ready"
                ? { action: { label: "다시 시작", onSelect: () => dispatch({ t: "apply" }) } }
                : s.upd === "failDownload"
                  ? { action: { label: "다시 시도", onSelect: () => dispatch({ t: "download" }) } }
                  : s.upd === "failSignature"
                    ? {
                        action: { label: "진단 복사", onSelect: () => dispatch({ t: "copyDiag" }) },
                      }
                    : {}),
            defaultOpen: pop === "upd",
          },
        ];

  const transcript: ChatItem[] =
    s.open === "t1" ? [...t1Base, ...s.items] : s.open === "t2" ? T2 : T3;

  const card =
    s.open === "t1" && (s.focusCard || state === "os-banners" || s.script === "notifications") ? (
      <div
        className={
          s.focusCard ? "rounded-2xl shadow-[0_0_0_2px_var(--cs-color-accent-graphic)]" : undefined
        }
      >
        <ApprovalCard
          kind="tool"
          status={
            s.items.some((i) => i.k === "row" && i.text.startsWith("bash 실행을 허용"))
              ? "allowed"
              : "pending"
          }
          where="transcript"
          onDecide={() => dispatch({ t: "decide" })}
        />
      </div>
    ) : null;

  const band = s.suggest ? (
    <SafeSuggestCard
      busy={s.busy}
      onSafe={() => dispatch({ t: "safeStart" })}
      onRetry={() => dispatch({ t: "retryEngine" })}
      onCopy={() => dispatch({ t: "copyDiag" })}
    />
  ) : s.engine === "restarting" || s.engine === "starting-safe" ? (
    <EngineBand
      phase={s.engine === "starting-safe" ? "starting-safe" : "restarting"}
      attempt={s.attempt}
      limit={3}
      web={s.web}
    />
  ) : undefined;

  const runtimeLine = down
    ? `${T.engine} 멈춤 · ${josa(T.thread, "은", "는")} 읽기만 돼요`
    : s.safe
      ? `${T.safeMode} · ${T.group}·외부 ${T.extension}·${T.xHook} 꺼짐 · ${T.lead} 없음`
      : t1RuntimeLine;

  const titles = { t1: "캐시 무효화 조사", t2: "테스트 정리", t3: "빌드 실패 분석" } as const;

  const hint = (() => {
    switch (pre.script) {
      case "engine-crash-safe":
        return s.suggest
          ? `카드의 "${josa(T.safeMode, "으로", "로")} 시작"`
          : s.safe
            ? "상태 표시줄 안전 모드 칩"
            : undefined;
      case "app-update":
        return s.upd === "available"
          ? "상태 표시줄 업데이트 칸 → 내려받기"
          : s.upd === "ready"
            ? "업데이트 칸 → 다시 시작"
            : undefined;
      case "app-update-fail":
        return s.upd === "failDownload" ? "업데이트 칸 → 다시 시도" : undefined;
      case "notifications":
        return s.os.length > 0
          ? "오른쪽 위 OS 알림을 눌러요"
          : s.focusCard
            ? "허용 또는 거부"
            : undefined;
      case "notifications-denied":
        return "토스트의 설정 보기";
      case "background-work":
        return `상태 표시줄 "${T.liveWork}" 칸`;
      default:
        return undefined;
    }
  })();

  const app = (
    <Shell
      activeNav="chat"
      stageLabel={T.thread}
      modalOpen={s.confirm}
      threads={{
        currentId: s.open,
        onSelect: (id) =>
          id === "t1" || id === "t2" || id === "t3" ? dispatch({ t: "go", id }) : undefined,
        onNew: () => {},
        dimmed: down,
      }}
      rightTabs={chatRightTabs({
        inbox: (
          <div className="grid gap-4">
            <NoticeList notices={inbox.notices} />
          </div>
        ),
        inboxBadge: 3,
        runtime: <RuntimePanel data={t1Runtime(s.safe ? { holder: null, queue: [] } : {})} />,
      })}
      status={defaultStatusCells({
        layout: shell.layout,
        thread: !down,
        pendingApprovals: 1,
        openEnd: shell.openEnd,
        runtime: down
          ? undefined
          : {
              drive: s.safe ? null : "helm",
              extFailures: 0,
              onOpen: () => shell.openEnd("runtime"),
            },
        target,
        engine,
        link,
        startExtra: safeChip,
        live,
        endExtra: upd,
      })}
    >
      <ChatStage
        follow={`${transcript.length}-${s.engine}-${s.suggest}-${s.focusCard}`}
        head={
          <ChatHead title={titles[s.open]} {...(s.open === "t1" ? { runtime: runtimeLine } : {})} />
        }
        band={band}
        composer={
          s.suggest ? undefined : (
            <ChatComposer
              value={draft}
              onValueChange={setDraft}
              running={s.running && s.open === "t1" && !down}
              disabled={down}
              {...(down
                ? {
                    note: s.web
                      ? "서비스에 연결되면 보낼 수 있어요. 쓰던 글은 남아요."
                      : `${josa(T.engine, "이", "가")} 돌아오면 보낼 수 있어요. 쓰던 글은 남아요.`,
                  }
                : {})}
              onSubmit={() => setDraft("")}
            />
          )
        }
      >
        <Items items={transcript} />
        {card}
      </ChatStage>
    </Shell>
  );

  const os = look.os;
  return (
    <>
      {os !== undefined ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <MacMenuBar
            open={os === "mac-app" ? "app" : os === "mac-thread" ? "thread" : null}
            trayOpen={trayOpen}
            trayBadge={2}
            onTray={() => setTrayOpen(!trayOpen)}
          />
          {os === "tray-closed" ? (
            <Desktop />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">{app}</div>
          )}
        </div>
      ) : (
        app
      )}
      {s.confirm && (
        <RestartDialog
          onLater={() => dispatch({ t: "confirmClose" })}
          onAfterTurn={() => dispatch({ t: "afterTurn" })}
          onNow={() => dispatch({ t: "applyNow" })}
        />
      )}
      {s.reattach === "blank" && <Relaunch text="화면을 다시 불러오는 중이에요…" />}
      {s.upd === "applying" && <Relaunch text="0.4.2로 다시 시작하는 중이에요…" />}
      <OsBanners
        kinds={s.os}
        onOpen={(k) => dispatch({ t: "osOpen", k })}
        onClose={(k) => dispatch({ t: "osClose", k })}
      />
      <ShellToaster />
      <ScenarioDock scenarios={SCENARIOS} hint={hint} />
    </>
  );
}

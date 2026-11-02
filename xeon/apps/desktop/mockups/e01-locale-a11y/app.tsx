// e01 화면 언어와 접근성(N-49 영어 UI 스모크, N-50 접근성 상태). 묶음 E.
// - ?lang=en이면 셸 전체(T, 셸 문구)가 영어로 바뀐다(_shell/i18n.ts). 이 페이지의 문장은 L2(ko, en)로 둘 다 준다.
// - 대화(P-02), 크래프트 확장 목록(P-13), 상태 표시줄 Popover, 설정 외관 탭을 같은 상태 기계로 그린다.
// - 접근성: 초점 정류장 덧그림, 승인 카드 Y·N, aria-live 자막, 움직임 줄이기, 강제 색(고대비) 흉내, 200% 확대.
import { Button, toast } from "@caustic/react";
import { useEffect, useMemo, useState } from "react";
import {
  approvals,
  chatRightTabs,
  defaultStatusCells,
  extensions,
  inbox,
  L2,
  LANG,
  NoticeList,
  ScenarioDock,
  Shell,
  ShellToaster,
  T,
  ToolApprovalCard,
  useShell,
  WB_WIDTH,
  WorkbenchHead,
  workbenchRightTabs,
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
import { ExtTable } from "../e04-workbench-states/parts/ext-table";
import { effect, init, reduce, SCRIPTS, type A, type Contrast, type S, type View } from "./flow";
import {
  FocusOverlay,
  LiveCaptions,
  LiveRegion,
  simFocus,
  stopOfElement,
  STOPS,
  targetOf,
} from "./parts/a11y-overlay";
import { Appearance } from "./parts/appearance";

interface Look {
  script: string;
  n: number;
  over?: Partial<S>;
  /** 상태 표시줄 Popover를 처음부터 연다. */
  pop?: string;
}

export const STATES = [
  { id: "chat", label: "대화(영어는 ?lang=en)" },
  { id: "wb-ext", label: "크래프트 확장 목록" },
  { id: "status-pop", label: "상태 표시줄 Popover" },
  { id: "settings", label: "설정 외관(언어·접근성)" },
  { id: "focus-order", label: "초점 순서 덧그림(크래프트)" },
  { id: "focus-order-chat", label: "초점 순서 덧그림(대화)" },
  { id: "focus-approval", label: "승인 카드 초점(Y·N)" },
  { id: "live-captions", label: "aria-live 문장 자막" },
  { id: "reduced-motion", label: "움직임 줄이기" },
  { id: "hc-broken", label: "강제 색: 지금 셸(깨짐)" },
  { id: "hc-fixed", label: "강제 색: 고친 규칙" },
  { id: "zoom-200", label: "200% 확대(640×400으로 찍음)" },
  { id: "lang-fail", label: "언어 바꾸기 실패" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const AT: Record<StateId, Look> = {
  chat: { script: "base", n: 0 },
  "wb-ext": { script: "base", n: 0, over: { view: "wb" } },
  "status-pop": { script: "base", n: 0, pop: "drive" },
  settings: { script: "base", n: 0, over: { view: "settings" } },
  "focus-order": { script: "wb-focus", n: 3 },
  "focus-order-chat": { script: "keyboard-only", n: 2 },
  "focus-approval": { script: "keyboard-only", n: 4 },
  "live-captions": { script: "keyboard-live", n: 8 },
  "reduced-motion": {
    script: "base",
    n: 0,
    over: { view: "settings", reduced: true, captions: true },
  },
  "hc-broken": { script: "base", n: 0, over: { contrast: "broken" } },
  "hc-fixed": { script: "base", n: 0, over: { contrast: "fixed" } },
  "zoom-200": { script: "base", n: 0 },
  "lang-fail": { script: "lang-switch-fail", n: 3 },
};

export const SCENARIOS = [
  { id: "keyboard-only", label: "키보드만: F6으로 영역 돌기 → Y로 승인" },
  { id: "keyboard-only-fail", label: "실패: 입력란에서 Y → 글자로 들어감 → 카드로" },
  { id: "lang-switch", label: "설정에서 English로 바꾸기" },
  { id: "lang-switch-fail", label: "실패: 영어 문구 묶음을 못 읽음" },
];

/** 영어 화면의 대화 기록(사용자 내용 흉내). 문장은 용어 조각을 잇지 않고 문장 하나로 둔다(N-49 원칙). */
const T1_EN: ChatItem[] = [
  { k: "user", text: "The invalidation test keeps failing. Find the cause." },
  { k: "agent", text: "Let me run the failing test first." },
  {
    k: "tool",
    name: "bash",
    detail: "bun test cache",
    status: "failed",
    duration: "1.2s",
    output: "FAIL test/cache.test.ts > expires after ttl\n  expected true, received false",
  },
  {
    k: "row",
    text: "Helm took the drive lease · inquiry started · 3 lenses",
    source: "grp:helm",
    icon: "lease",
  },
  { k: "tool", name: "read", detail: "src/cache.ts", status: "done", duration: "40ms" },
  {
    k: "agent",
    text: "All 3 lenses point to the same spot: ttl is in seconds but isExpired compares milliseconds.",
  },
];

/** 강제 색 덧그림 아래 붙는 개발용 메모(무엇이 깨지고 무엇을 고쳤는지). */
const HC_NOTE: Record<Exclude<Contrast, "off">, string[]> = {
  broken: [
    L2("초점 고리(box-shadow)가 사라져요", "Focus ring (box-shadow) disappears"),
    L2(
      "패널·well·입력창 면이 바탕과 합쳐져요",
      "Panels, well and composer merge into the background",
    ),
    L2("고른 대화 행과 상태 점이 안 보여요", "Selected row and status dots vanish"),
  ],
  fixed: [
    L2("초점: outline 2px Highlight", "Focus: 2px Highlight outline"),
    L2("면마다 1px CanvasText 테두리", "1px CanvasText border on each surface"),
    L2(
      "고른 행·켜진 스위치: Highlight 면, 점은 글자색 고정",
      "Selected row and on switch: Highlight fill; dots keep text color",
    ),
  ],
};

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const look = AT[state];
  const pre = usePrefill(SCRIPTS, look);
  const [s, dispatch] = useMachine<S, A>({
    init: { ...init(), ...look.over },
    reduce,
    prefill: pre.prefill,
    effect,
    kick: pre.live,
  });
  const go = (a: A) => dispatch(a);

  // 정류장으로 프로그램 초점(F6, 시나리오 단계, 정적 상태). 레이아웃이 그려진 뒤에.
  useEffect(() => {
    if (s.stop === 0) return;
    const id = window.setTimeout(() => simFocus(targetOf(s.stop, s.inComposer)), 120);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.focusReq, s.view]);

  // F6·⇧F6 영역 이동(제안), ⌘⇧A 다음 승인(§4.8). Tab으로 움직이면 덧그림이 따라간다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F6") {
        e.preventDefault();
        const next = e.shiftKey ? (s.stop <= 1 ? STOPS : s.stop - 1) : (s.stop % STOPS) + 1;
        dispatch({ t: "focus", stop: next });
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        dispatch({ t: "approvalNext" });
      } else if (e.key === "Tab") {
        for (const x of document.querySelectorAll("[data-sim-focus]"))
          x.removeAttribute("data-sim-focus");
      }
    };
    const onFocus = () => {
      const at = stopOfElement(document.activeElement);
      if (at.stop > 0) dispatch({ t: "at", stop: at.stop, composer: at.composer });
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
    };
  }, [s.stop, dispatch]);

  // 영역은 보기에 따라.
  useEffect(() => {
    shell.setArea(s.view === "wb" ? "workbench" : "chat");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.view]);

  useEffect(() => {
    if (s.toast === null) return;
    toast({
      title: s.toast.title,
      tone: s.toast.tone,
      duration: s.toast.tone === "danger" ? 0 : 4000,
    });
  }, [s.toast]);

  // 움직임 줄이기·강제 색: 뿌리 속성 하나로(caustic의 미디어 쿼리 규칙을 앱 설정으로도 켤 수 있게, mockup.css).
  useEffect(() => {
    const r = document.documentElement;
    if (s.reduced) r.dataset["motion"] = "reduce";
    else delete r.dataset["motion"];
    if (s.contrast === "off") delete r.dataset["simForced"];
    else r.dataset["simForced"] = s.contrast;
  }, [s.reduced, s.contrast]);

  // 강제 색 상태는 초점 고리가 보이는지 보려고 "새 대화" 칸 하나에 초점을 둔다.
  useEffect(() => {
    if (s.contrast === "off") return;
    const id = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>('[data-slot="composer-attach"]');
      simFocus(el);
    }, 200);
    return () => window.clearTimeout(id);
  }, [s.contrast]);

  const [draft, setDraft] = useState("");
  const value = s.draft !== "" && draft === "" ? s.draft : draft;

  const transcript: ChatItem[] = useMemo(() => {
    const base = LANG === "en" ? T1_EN : t1Base;
    const after: ChatItem[] = [];
    if (s.decision !== "pending") {
      after.push({
        k: "row",
        text:
          s.decision === "denied"
            ? L2("bash 실행을 거부했어요", "Denied the bash run")
            : L2("bash 실행을 허용했어요 · 한 번", "Allowed the bash run once"),
        source: "core",
        icon: s.decision === "denied" ? "danger" : "ok",
      });
      if (s.decision !== "denied")
        after.push({
          k: "agent",
          text: L2(
            "캐시를 지우고 테스트를 다시 돌렸어요. 12개 모두 통과해요.",
            "Cleared the cache and ran the tests again. All 12 pass.",
          ),
          live: !s.answered && !s.reduced,
        });
    }
    return [...base, ...after];
  }, [s.decision, s.answered, s.reduced]);

  const runtimeLine =
    LANG === "en" ? "Helm is driving · inquiry converging · 4 extensions on" : t1RuntimeLine;

  const status = defaultStatusCells({
    layout: shell.layout,
    thread: s.view === "chat",
    pendingApprovals: s.decision === "pending" ? 1 : 0,
    openEnd: shell.openEnd,
    runtime: { drive: "helm", extFailures: 1, onOpen: () => shell.openEnd("runtime") },
  });
  const withPop = (cells: StatusCell[]) =>
    cells.map((c) => (look.pop === c.id && !pre.live ? { ...c, defaultOpen: true } : c));

  const card =
    s.decision === "pending" ? (
      <ToolApprovalCard
        approval={approvals.a1}
        decision="pending"
        subtitle={`${T.approvalTool} · core · 14:05`}
        onDecide={(d) => go({ t: "decide", d })}
      />
    ) : null;

  const hint = (() => {
    switch (pre.script) {
      case "keyboard-only":
        return s.stop === 3 && s.decision === "pending"
          ? L2("카드에 초점: Y 허용 · N 거부", "Card focused: Y allow · N deny")
          : L2(
              `F6 다음 영역 · ⇧F6 앞 영역 (지금 ${s.stop}/5)`,
              `F6 next region · ⇧F6 previous (now ${s.stop}/5)`,
            );
      case "keyboard-only-fail":
        return s.inComposer
          ? L2(
              "입력란에서 Y를 눌러 보고 → ⌘⇧A로 카드로",
              "Press Y in the composer → ⌘⇧A to jump to the card",
            )
          : L2("카드에서 N 거부", "N to deny on the card");
      case "lang-switch":
      case "lang-switch-fail":
        return s.view === "settings"
          ? L2("화면 언어 → English", "Display language → English")
          : L2("왼쪽 아래 설정", "Settings, bottom left");
      default:
        return undefined;
    }
  })();

  const view: View = s.view;
  const page =
    view === "settings" ? (
      <Appearance
        s={s}
        onLang={(v) =>
          go({ t: "lang", v, ...(pre.script === "lang-switch-fail" ? { fail: true } : {}) })
        }
        onReduced={(on) => go({ t: "reduced", on })}
        onContrast={(on) => go({ t: "contrast", c: on ? "fixed" : "off" })}
        onShortcuts={() => {
          window.location.href = `../e02-shortcuts/index.html${LANG === "en" ? "?lang=en" : ""}`;
        }}
      />
    ) : (
      <Shell
        activeNav={view === "wb" ? "extensions" : "chat"}
        stageLabel={view === "wb" ? T.extension : T.thread}
        onNavSelect={(id) => {
          if (id === "settings") go({ t: "view", v: "settings" });
          else if (id === "extensions") go({ t: "view", v: "wb" });
          else if (id === "chat") go({ t: "view", v: "chat" });
        }}
        threads={{ currentId: "t1", onSelect: () => go({ t: "view", v: "chat" }), onNew: () => {} }}
        rightTabs={
          view === "wb"
            ? workbenchRightTabs({ inboxBadge: 2 })
            : chatRightTabs({
                inbox: (
                  <div className="grid gap-3">
                    {s.decision === "pending" && (
                      <ToolApprovalCard
                        approval={approvals.a1}
                        decision="pending"
                        subtitle={`${T.approvalTool} · core · 14:05`}
                        onDecide={(d) => go({ t: "decide", d })}
                        flat
                      />
                    )}
                    <NoticeList notices={inbox.notices} />
                  </div>
                ),
                inboxBadge: s.decision === "pending" ? 3 : 2,
                runtime: <RuntimePanel data={t1Runtime()} />,
              })
        }
        status={{ start: withPop(status.start), end: withPop(status.end) }}
      >
        {view === "wb" ? (
          <>
            <WorkbenchHead
              title={T.extension}
              actions={
                <>
                  <Button size="xs" tone="neutral" variant="ghost">
                    {L2("가져오기", "Import")}
                  </Button>
                  <Button size="xs" tone="neutral" variant="outline">
                    {L2(`새 ${T.group}`, `New ${T.group.toLowerCase()}`)}
                  </Button>
                </>
              }
              sub={
                <span>
                  {L2(
                    `${T.extension} ${extensions.length} · 켜짐 ${extensions.filter((e) => e.status === "enabled").length} · ${T.autoDisabled} 1`,
                    `${extensions.length} extensions · ${extensions.filter((e) => e.status === "enabled").length} on · 1 auto-disabled`,
                  )}
                </span>
              }
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className={`${WB_WIDTH} pt-1 pb-6`}>
                <ExtTable rows={extensions} layout={shell.layout} />
              </div>
            </div>
          </>
        ) : (
          <ChatStage
            follow={`${transcript.length}-${s.decision}`}
            head={
              <ChatHead
                title={L2("캐시 무효화 조사", "Investigate cache invalidation")}
                runtime={runtimeLine}
              />
            }
            composer={
              <ChatComposer
                value={value}
                onValueChange={setDraft}
                running={s.decision === "pending" || (s.decision !== "denied" && !s.answered)}
                onSubmit={() => setDraft("")}
              />
            }
          >
            <Items items={transcript} />
            {card}
          </ChatStage>
        )}
      </Shell>
    );

  const extra =
    s.contrast !== "off"
      ? HC_NOTE[s.contrast]
      : s.reduced
        ? [
            L2(
              "패널·well이 미끄러지지 않고 바로 나타나요",
              "Panels and the well appear without sliding",
            ),
            L2(
              "에이전트 글은 한 번에, 작성 커서는 깜빡이지 않아요",
              "Agent text appears at once; no blinking caret",
            ),
            L2(
              "실행 중 표시는 도는 고리 대신 멈춘 점",
              "Running indicator is a still dot, not a spinner",
            ),
            L2("런타임 흐름 움직임 0개(DP-51)", "No live runtime motion (DP-51)"),
          ]
        : undefined;

  return (
    <>
      {page}
      <LiveRegion caps={s.caps} />
      {s.overlay && <FocusOverlay stop={s.stop} area={view === "wb" ? "workbench" : "chat"} />}
      {(s.captions || extra !== undefined) && <LiveCaptions caps={s.caps} extra={extra} />}
      <ShellToaster />
      <ScenarioDock scenarios={SCENARIOS} hint={hint} />
    </>
  );
}

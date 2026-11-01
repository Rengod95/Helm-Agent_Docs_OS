// B02 대화 영역의 플러그인 기여(ADR-0021 §3.2): well(오른쪽 막대 탭, 6개 넘으면 "더 보기", 자체 코드 well 폭 320~480),
// card(트랜스크립트 안, 높이 320 상한, 그리기 실패 → 일반 항목), status(상태 표시줄 칸 24자 + tone + Popover, 대화 머리 런타임 줄),
// command(팔레트 "플러그인" 묶음, 꺼진 확장 명령 숨김). 열린 대화가 없으면 well·status 기여를 그리지 않는다.
import {
  Composer,
  EmptyState,
  IconButton,
  ListDescription,
  ListDescriptionRow,
  Message,
  Toaster,
  ToolCall,
  toast,
} from "@caustic/react";
import { useEffect, useRef, useState } from "react";
import {
  chatRightTabs,
  Compass,
  defaultStatusCells,
  Eye,
  GitBranch,
  josa,
  Layers,
  MessageSquare,
  PanelLeft,
  palette as basePalette,
  ScenarioDock,
  Shell,
  T,
  useScenarioParam,
  useShell,
  useTimeline,
  useTypewriter,
  type PaletteGroup,
  type RightTab,
  type StatusCell,
} from "../_shell";
import { useFlow } from "../b01-plugin-frame/flow";
import { clip24, COMMANDS, STATUS, WELLS } from "./data";
import { BASE, FLOWS, PHASE_PRESET, PRESET, type FlowId, type PS, type StateId } from "./model";
import { GenericItem, HelmFinishedTree, PluginCard, RuntimeRow } from "./parts/cards";
import { ICONS, WellContent } from "./parts/wells";

const READ_WIDTH = "mx-auto w-full max-w-[46rem] px-3";
const DISPLAY: Record<string, string> = Object.fromEntries(WELLS.map((w) => [w.ext, w.display]));
const LD = "rounded-none [&_[data-slot=list-description-row]]:px-0 [--cs-size-list-term:4.5rem]";

function flowOf(id: string | null) {
  return id !== null && id in FLOWS ? FLOWS[id as FlowId] : null;
}

/** 헤드리스 스크린숏과 시나리오 순간: 막대 "더 보기" 메뉴나 상태 칸 Popover를 미리 편다(목업 전용). */
function useAutoOpen(what: PS["autoOpen"]) {
  useEffect(() => {
    if (what === null) return;
    const sel =
      what === "overflow"
        ? '[aria-label^="더 보기, 플러그인 패널"]'
        : what === "status-review"
          ? '[aria-label^="검토 상태"]'
          : '[aria-label^="Helm 상태"]';
    const id = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(sel);
      if (el === null) return;
      el.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
      );
      if (what !== "overflow") el.click();
    }, 300);
    return () => window.clearTimeout(id);
  }, [what]);
}

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const scenarioId = useScenarioParam();
  const flowDef = flowOf(scenarioId);
  const flow = useFlow<string>(flowDef);
  const [s, setS] = useState<PS>(() => ({
    ...BASE,
    ...(flowDef !== null ? PHASE_PRESET[`${flowDef.id}:${flow.phase}`] : PRESET[state]),
  }));
  const set = (p: Partial<PS>) => setS((x) => ({ ...x, ...p }));
  const tl = useTimeline();
  const tl2 = useTimeline();
  useAutoOpen(s.autoOpen);
  // 대화 기록은 끝에 붙어 있다(새 카드가 보이게).
  const logRef = useRef<HTMLDivElement>(null);

  // 첫 값: well을 연다(중간·좁은 폭이면 뜨는 시트로 열린다), 팔레트를 연다.
  useEffect(() => {
    if (s.openTab !== null) shell.openEnd(s.openTab);
    if (s.palette) shell.setPaletteOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wellOpen = shell.endOpen ? shell.endTab : null;

  // 시나리오 slot-overflow: 확장 둘이 더 켜져 7개 → 일곱째가 "더 보기"로. 메뉴에서 고르면 well이 열리고,
  // 잠시 뒤 실패 갈래: 검토가 자동으로 꺼져 그 탭·상태 칸이 빠지고 넘침이 풀린다.
  useEffect(() => {
    if (scenarioId !== "slot-overflow" || s.wells.length !== 5) return;
    tl.start([
      {
        after: 1600,
        run: () => {
          setS((x) => ({ ...x, wells: [...x.wells, "acme-notes/side"] }));
          toast({ title: "Acme 노트를 켰어요", description: "옆 패널 하나가 더해졌어요" });
        },
      },
      {
        after: 1800,
        run: () => {
          setS((x) => ({ ...x, wells: [...x.wells, "turn-cost/panel"] }));
          toast({
            title: "턴 비용을 켰어요",
            description: "옆 패널이 6개를 넘어 더 보기로 갔어요",
          });
        },
      },
    ]);
  }, [scenarioId, s.wells.length, tl]);
  useEffect(() => {
    if (scenarioId !== "slot-overflow" || wellOpen !== "turn-cost/panel" || !s.reviewOn) return;
    tl2.start([
      {
        after: 3500,
        run: () => {
          setS((x) => ({
            ...x,
            reviewOn: false,
            wells: x.wells.filter((w) => w !== "review/queue"),
          }));
          toast({
            title: `검토가 ${T.autoDisabled}됐어요`,
            description: "연속 실패 5번 · 옆 패널, 상태 칸, 명령을 거뒀어요",
            actionLabel: "확장 상세",
            onAction: () => {},
          });
        },
      },
    ]);
  }, [scenarioId, wellOpen, s.reviewOn, tl2]);

  // 시나리오 card-more: 답이 스트리밍되고 탐구 결과 카드가 붙는다(높이 320 넘침). "더 보기"로 well을 열면,
  // 실패 갈래: 다음 레코드(acme-notes)의 카드가 그려지지 않아 일반 항목으로 보인다.
  const answer = "탐구를 마쳤어요. 발견 9개 중 둘을 바로 적용했고, 나머지는 결과 카드에 모았어요.";
  const typed = useTypewriter(answer, s.streaming, 50);
  useEffect(() => {
    if (s.streaming && typed.done) {
      const id = window.setTimeout(() => set({ streaming: false, finished: "tall" }), 300);
      return () => window.clearTimeout(id);
    }
  }, [s.streaming, typed.done]);
  useEffect(() => {
    if (scenarioId !== "card-more" || wellOpen !== "helm/panel" || s.cardFail) return;
    tl.start([{ after: 2500, run: () => setS((x) => ({ ...x, cardFail: true })) }]);
  }, [scenarioId, wellOpen, s.cardFail, tl]);

  // 시나리오 status-command: 상태 칸 글이 단계마다 바뀐다(플러그인 query 갱신). 팔레트에서 "탐구 멈춤"을 고르면 멈춤,
  // 실패 갈래: 검토가 자동으로 꺼져 상태 칸이 빠지고 팔레트에서 그 명령이 사라진다.
  useEffect(() => {
    if (scenarioId !== "status-command" || s.helmStatus !== "탐색 1/3 렌즈") return;
    tl.start([
      { after: 2200, run: () => setS((x) => ({ ...x, helmStatus: "탐색 2/3 렌즈" })) },
      { after: 2600, run: () => setS((x) => ({ ...x, helmStatus: "수렴 · 발견 2" })) },
    ]);
  }, [scenarioId, s.helmStatus, tl]);
  useEffect(() => {
    if (scenarioId !== "status-command" || !s.helmStatus.startsWith("멈춤") || !s.reviewOn) return;
    tl2.start([
      {
        after: 2500,
        run: () => {
          setS((x) => ({ ...x, reviewOn: false }));
          toast({
            title: `검토가 ${T.autoDisabled}됐어요`,
            description: "상태 칸과 명령을 거뒀어요 · 팔레트를 다시 열어 보세요",
          });
        },
      },
    ]);
  }, [scenarioId, s.helmStatus, s.reviewOn, tl2]);

  useEffect(() => {
    const el = logRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [s.finished, s.cardFail, typed.shown, s.thread]);

  const enabled = (ext: string) => ext !== "review" || s.reviewOn;
  const wells = WELLS.filter((w) => s.wells.includes(w.id) && enabled(w.ext));

  const pluginTabs: RightTab[] = wells.map((w) => ({
    id: w.id,
    label: w.label,
    icon: ICONS[w.icon],
    ext: w.ext,
    content: <WellContent w={w} />,
    ...(w.mode === "frame" ? { width: 400, resizable: true } : {}),
    ...(w.id === "helm/panel"
      ? {
          expand: {
            label: `${T.inquiry} 화면 크게 열기`,
            onSelect: () => toast({ title: `작업대 ${T.pluginView} Helm 탐구로 가요` }),
          },
        }
      : {}),
  }));

  const rightTabs = s.thread
    ? chatRightTabs({ inboxBadge: 2, runtimeBadge: 1, plugins: pluginTabs })
    : chatRightTabs({ inboxBadge: 2, only: ["inbox"] });

  // 상태 표시줄: 공용 칸 + 플러그인 status 칸(열린 대화가 있고 compact가 아닐 때만).
  const base = defaultStatusCells({
    layout: shell.layout,
    thread: s.thread,
    pendingApprovals: 2,
    openEnd: shell.openEnd,
    ...(s.thread
      ? { runtime: { drive: "helm", extFailures: 1, onOpen: () => shell.openEnd("runtime") } }
      : {}),
  });
  // 넓은 폭은 전부, 중간 폭(≤1100)은 진행권을 쥔 그룹의 칸 하나만, compact는 없음(대상·연결·승인만) [제안].
  const statusDecls = STATUS.filter((d) => enabled(d.ext))
    .filter((d) => shell.layout === "wide" || d.ext === "helm")
    .map((d) => (d.ext === "helm" ? { ...d, text: s.helmStatus } : d));
  const pluginCells: StatusCell[] =
    s.thread && shell.layout !== "compact"
      ? statusDecls.map((d) => ({
          id: `p:${d.id}`,
          text: clip24(d.text),
          label: `${d.display} 상태: ${d.text}`,
          icon: d.ext === "helm" ? <Compass /> : <Eye />,
          ...(d.tone !== "neutral" ? { dot: d.tone } : {}),
          title: `${d.display} · ${d.title}`,
          description: d.detail ?? d.text,
          content: (
            <div className="grid gap-1.5">
              <ListDescription variant="ghost" size="xs" aria-label={d.title} className={LD}>
                {d.ext === "helm" ? (
                  <>
                    <ListDescriptionRow term={T.step}>
                      {s.helmStatus.split(" ·")[0]}
                    </ListDescriptionRow>
                    <ListDescriptionRow term={T.lens}>3 · 1 실행 중</ListDescriptionRow>
                    <ListDescriptionRow term={T.finding}>2</ListDescriptionRow>
                  </>
                ) : (
                  <>
                    <ListDescriptionRow term="대기">12건</ListDescriptionRow>
                    <ListDescriptionRow term="가장 오래된">3일 전</ListDescriptionRow>
                  </>
                )}
              </ListDescription>
              <span className="font-mono text-mono-sm text-text-tertiary">ext:{d.ext}</span>
            </div>
          ),
          action:
            d.ext === "helm"
              ? { label: "옆 패널 열기", onSelect: () => shell.openEnd("helm/panel") }
              : { label: "검토 대기열 열기", onSelect: () => shell.openEnd("review/queue") },
        }))
      : [];
  let end = base.end;
  if (!s.thread) end = end.filter((c) => c.id !== "tokens"); // DP-45
  const at = end.findIndex((c) => c.id === "approvals");
  end = [
    ...end.slice(0, at < 0 ? end.length : at),
    ...pluginCells,
    ...end.slice(at < 0 ? end.length : at),
  ];

  // 팔레트: 공용 묶음 + "플러그인"(켜진 확장의 command 기여만, 확장 id는 연한 mono).
  // 시안은 이 묶음을 맨 위에 둔다(스크린숏에 보이게). 실제 순서는 spec §4.5 묶음 순서를 따른다.
  const paletteGroups: PaletteGroup[] = [
    {
      group: "플러그인",
      items: COMMANDS.filter((c) => enabled(c.ext)).map((c) => ({ label: c.label, hint: c.ext })),
    },
    ...basePalette,
  ];
  const onPaletteRun = (group: string, label: string) => {
    if (group !== "플러그인") return;
    const c = COMMANDS.find((x) => x.label === label);
    if (label === "탐구 멈춤") {
      set({ helmStatus: "멈춤 · 발견 2" });
      toast({ title: `${josa(T.inquiry, "을", "를")} 멈췄어요`, description: "Helm · /helm stop" });
    } else
      toast({ title: label, description: `${DISPLAY[c?.ext ?? ""] ?? ""} · ext:${c?.ext ?? ""}` });
  };

  const runtimeLine = `helm ${T.drive} · ${s.helmStatus} · ${T.extension} 6 · 실패 1`;

  return (
    <>
      <Shell
        activeNav="chat"
        stageLabel={T.thread}
        threads={{
          currentId: s.thread ? "t1" : null,
          onSelect: () => set({ thread: true }),
          onNew: () => {},
        }}
        rightTabs={rightTabs}
        status={{ start: base.start, end }}
        palette={paletteGroups}
        onPaletteRun={onPaletteRun}
      >
        {!s.thread ? (
          <div className="grid flex-1 place-items-center">
            <EmptyState
              size="sm"
              surface="none"
              icon={<MessageSquare />}
              title="열린 대화가 없어요"
              description="대화를 고르거나 새로 시작하세요."
            />
          </div>
        ) : (
          <>
            <header className={`${READ_WIDTH} grid flex-none pb-1`}>
              <div className="flex h-10 items-center gap-1">
                {!shell.startOpen && (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label="사이드바 열기"
                    onClick={() => shell.setStartOpen(true)}
                    className="-ms-1.5"
                  >
                    <PanelLeft />
                  </IconButton>
                )}
                <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
                  <h1 className="m-0 truncate font-ui text-ui-strong text-text-primary">
                    캐시 무효화 조사
                  </h1>
                  <span className="truncate font-mono text-mono-sm text-text-tertiary">
                    ~/code/xeon
                  </span>
                  <span className="shrink-0 text-ui-dense tabular-nums text-text-tertiary">
                    목표 2/3
                  </span>
                </div>
              </div>
              {/* 런타임 줄(§6.30, DP-19): 진행 그룹과 그 status 기여 글자, 켜진 확장 수, 실패. 누르면 런타임 탭. */}
              <button
                type="button"
                onClick={() => shell.openEnd("runtime")}
                aria-label="런타임 탭 열기"
                className="-mt-1.5 flex min-w-0 items-center gap-1.5 justify-self-start rounded-sm text-ui-dense text-text-secondary outline-none hover:text-text-primary focus-visible:focus-ring"
              >
                <Layers emphasis="muted" aria-hidden className="size-icon-xs text-text-tertiary" />
                <span className="truncate">{runtimeLine}</span>
              </button>
            </header>
            <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto">
              <div
                role="log"
                aria-label="대화 기록"
                className={`${READ_WIDTH} grid gap-4 pt-1 pb-3`}
              >
                <Message author="user">무효화 시험이 계속 실패해. 원인 찾아줘</Message>
                <ToolCall
                  name="bash"
                  detail="bun test cache"
                  status="failed"
                  duration="1.2s"
                  failedLabel="실패 · 1.2s"
                />
                <RuntimeRow source="grp:helm">Helm이 막힘 신호를 봤어요 · 같은 오류 3번</RuntimeRow>
                <PluginCard
                  icon={<Compass />}
                  display="Helm"
                  ext="helm"
                  onMore={() => shell.openEnd("helm/panel")}
                >
                  <div className="grid gap-1">
                    <span className="text-ui-dense font-medium text-text-primary">
                      캐시 무효화를 {T.lens} 3개로 넓게 볼까요?
                    </span>
                    <span className="text-ui-dense text-text-secondary">
                      실패 사례, 기본 원리, 다른 분야 유사 · 14:02에 시작했어요
                    </span>
                  </div>
                </PluginCard>
                <PluginCard
                  icon={<GitBranch />}
                  display="작업 흐름"
                  ext="taskflow"
                  onMore={() => shell.openEnd("taskflow/panel")}
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 text-ui-dense">
                    <span className="font-mono text-mono-sm text-text-tertiary">t13</span>
                    <span className="text-text-primary">만료 비교 단위 통일</span>
                    <span className="text-text-secondary">대기 → 진행</span>
                    <span className="text-ui-xs text-text-tertiary">흐름판에서 옮김</span>
                  </div>
                </PluginCard>
                {(s.streaming || s.finished !== "none") && (
                  <Message>
                    <p>{s.streaming ? typed.shown : answer}</p>
                  </Message>
                )}
                {s.finished !== "none" && (
                  <PluginCard
                    icon={<Compass />}
                    display="Helm"
                    ext="helm"
                    onMore={() => shell.openEnd("helm/panel")}
                  >
                    <HelmFinishedTree
                      tall={s.finished === "tall"}
                      onOpenPage={() => toast({ title: `작업대 ${T.pluginView} Helm 탐구로 가요` })}
                    />
                  </PluginCard>
                )}
                {s.cardFail && (
                  <GenericItem
                    kind="x.acme-notes.note.pinned"
                    summary="노트를 고정했어요: 만료 비교 단위"
                    diag="모르는 위젯 MapPin"
                    onLog={() => toast({ title: "작업대 확장 상세 기록으로 가요" })}
                  />
                )}
              </div>
            </div>
            <div className={`${READ_WIDTH} flex-none pb-1.5`}>
              <Composer
                rows={2}
                inputLabel="메시지"
                sendLabel="보내기"
                stopLabel="중단"
                attachLabel="맥락 더하기"
                modelLabel="sonnet-5-5"
                usage={41}
                usageLabel={(p) => `문맥 ${p}% 사용`}
                placeholder="메시지를 입력하세요"
                running={s.streaming}
                onAttach={() => {}}
                onStop={() => {}}
                onSubmit={() => {}}
              />
            </div>
          </>
        )}
      </Shell>
      <ScenarioDock scenarios={Object.values(FLOWS)} />
      <Toaster label="알림" />
    </>
  );
}

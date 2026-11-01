// B01 P-18 플러그인 화면 호스트: 자체 코드 화면(frame) 틀·수명·확인 줄·막힘, 승인과 외부 링크, 기본 부품 화면 남은 상태.
// 작업대 영역 하나. 왼쪽 "플러그인 화면" 목록으로 세 화면(작업 흐름판 frame, Helm 탐구 declarative, 노트 지도 project frame)을 오간다.
import { Button, EmptyState, Skeleton, Toaster, toast } from "@caustic/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CodeXml,
  defaultStatusCells,
  Inbox,
  josa,
  Package,
  RotateCw,
  ScenarioDock,
  Shell,
  Shield,
  T,
  TriangleAlert,
  useScenarioParam,
  useShell,
  useTimeline,
  workbenchNav,
  workbenchRightTabs,
} from "../_shell";
import { acmeNotes, externalLink, helmExt, taskflow, webExa, type PluginExt } from "./data";
import { useFlow } from "./flow";
import {
  BASE,
  FLOWS,
  moveTask,
  PHASE_PRESET,
  PRESET,
  type FlowId,
  type PS,
  type StateId,
  type ViewId,
} from "./model";
import { BoardFallback, HelmTree } from "./parts/declarative";
import { FrameBoard } from "./parts/frame-board";
import {
  ConfirmRow,
  FRAME_WIDTH,
  FrameBox,
  FrameLoading,
  FramePlaceholder,
  ViewHead,
} from "./parts/frame-host";
import { ExtApprovalCard, FramesSettingDialog, LinkDialog } from "./parts/shell-asks";

const EXT_OF: Record<ViewId, PluginExt> = {
  "taskflow/board": taskflow,
  "helm/inquiry": helmExt,
  "acme-notes/map": acmeNotes,
  "web-exa/none": webExa,
};
const viewOf = (id: ViewId) => {
  const ext = EXT_OF[id];
  const v = ext.views.find((x) => x.id === id);
  if (v === undefined) throw new Error(`화면 선언 없음: ${id}`);
  return { ext, view: v };
};

function flowOf(id: string | null): (typeof FLOWS)[FlowId] | null {
  return id !== null && id in FLOWS ? FLOWS[id as FlowId] : null;
}

/** 셸이 그리는 조용한 한 줄(DP-19 글자 단계): muted 아이콘, secondary 글, 동작 0~1개. */
function ShellLine({
  icon,
  children,
  action,
}: {
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-7 min-w-0 items-center gap-1.5 text-ui-dense text-text-secondary">
      <span aria-hidden className="flex size-icon-sm flex-none text-text-tertiary">
        {icon}
      </span>
      <span className="min-w-0 truncate">{children}</span>
      {action !== undefined && <span className="ms-1 flex-none">{action}</span>}
    </div>
  );
}

const BLOCK_REASON: Record<string, { line: string; settings: boolean }> = {
  "blocked-setting": {
    line: `설정에서 ${josa(T.viewFrame, "을", "를")} 꺼 두었어요`,
    settings: true,
  },
  "blocked-project": {
    line: `${T.trustProject} ${T.extension}의 ${T.viewFrame}은 기본으로 꺼져 있어요`,
    settings: true,
  },
  "blocked-build": {
    line: `이 앱 버전에서는 ${josa(T.viewFrame, "을", "를")} 아직 열 수 없어요 · 보안 확인을 마친 버전부터 열려요`,
    settings: false,
  },
  "blocked-web": {
    line: `웹에서는 ${josa(T.viewFrame, "을", "를")} 열 수 없어요 · 데스크톱 앱에서 열려요`,
    settings: false,
  },
};

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const scenarioId = useScenarioParam();
  const flowDef = flowOf(scenarioId);
  const flow = useFlow<string>(flowDef);
  const [s, setS] = useState<PS>(() => ({
    ...BASE,
    ...(flowDef !== null ? PHASE_PRESET[`${flowDef.id}:${flow.phase}`] : PRESET[state]),
  }));
  // 사용자가 한 번이라도 누르면 정적 상태여도 타이머(준비 → 그림)를 돌린다.
  const [touched, setTouched] = useState(false);
  const set = (p: Partial<PS>) => {
    setTouched(true);
    setS((x) => ({ ...x, ...p }));
  };
  const live = flowDef !== null || touched;
  const tlFrame = useTimeline();
  const tlPing = useTimeline();
  const tlHelm = useTimeline();
  const lastFrameView = useRef(s.view);

  // 자체 코드 화면: ready를 받으면 그린다(목업은 1.4초).
  useEffect(() => {
    if (!live || s.view !== "taskflow/board") return;
    if (s.frame === "loading" || s.frame === "reshown")
      tlFrame.start([{ after: 1400, run: () => setS((x) => ({ ...x, frame: "ready" })) }]);
  }, [live, s.view, s.frame, tlFrame]);

  // 시나리오 a′: 생존 확인 무응답 1번(늦음 한 줄) → 2번(내림, 장부 1).
  useEffect(() => {
    if (scenarioId !== "liveness" || s.frame !== "ready" || s.fails > 0) return;
    tlPing.start([
      { after: 2500, run: () => setS((x) => ({ ...x, pingMissed: 1 })) },
      {
        after: 5000,
        run: () => setS((x) => ({ ...x, pingMissed: 0, frame: "liveness", fails: 1 })),
      },
    ]);
  }, [scenarioId, s.frame, s.fails, tlPing]);

  // 시나리오 helm: 읽는 중 → 그림 → 오프라인 → 다시 연결 → 연속 실패 5번 → 화면 꺼짐.
  useEffect(() => {
    if (scenarioId !== "helm") return;
    if (s.helm === "loading")
      tlHelm.start([{ after: 1200, run: () => setS((x) => ({ ...x, helm: "active" })) }]);
    if (s.helm === "active" && s.fails === 0 && flow.index <= 1)
      tlHelm.start([{ after: 3000, run: () => setS((x) => ({ ...x, helm: "offline" })) }]);
    if (s.helm === "offline")
      tlHelm.start([
        { after: 3000, run: () => setS((x) => ({ ...x, helm: "active", fails: 3 })) },
        {
          after: 2500,
          run: () => {
            setS((x) => ({ ...x, helm: "view_disabled", fails: 5 }));
            toast({
              title: "Helm 탐구 화면을 껐어요",
              description: "연속 5번 실패했어요. 확장은 그대로 켜져 있어요.",
            });
          },
        },
      ]);
  }, [scenarioId, s.helm, s.fails, flow.index, tlHelm]);

  // 받은 요청 well: 승인이 생기면 연다(시나리오와 F4).
  useEffect(() => {
    if (s.inboxOpen) shell.openEnd("inbox");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.inboxOpen]);

  const { ext, view } = viewOf(s.view);

  const go = (id: ViewId) => {
    if (id === s.view) return;
    // 숨은 프레임은 내린다(§3.7). 다시 보이면 새로 띄운다.
    const leaving = s.view === "taskflow/board" && s.frame === "ready";
    lastFrameView.current = id;
    set({
      view: id,
      ...(id === "taskflow/board" && s.frame === "ready" ? { frame: "reshown" as const } : {}),
      ...(leaving ? { frame: "reshown" as const } : {}),
      confirm: null,
    });
  };

  const onMove = (id: string) => {
    if (s.dontAsk) {
      set({ tasks: moveTask(s.tasks, id), focus: id });
      toast({ title: "작업을 옮겼어요", description: `${id} · 이 화면에서는 묻지 않아요` });
    } else set({ confirm: id });
  };
  const onAllow = () => {
    if (s.confirm === null) return;
    set({ tasks: moveTask(s.tasks, s.confirm), focus: s.confirm, confirm: null });
  };
  const onDispatch = () => {
    set({ dispatch: "waiting", approval: "pending" });
    if (flowDef !== null) shell.openEnd("inbox");
    else
      toast({
        title: `승인 필요: ${ext.display}`,
        description: "대기 작업 3개 맡기기",
        actionLabel: "보기",
        onAction: () => shell.openEnd("inbox"),
      });
  };
  const onDecide = (d: "allowed" | "denied") => {
    set({ approval: d, dispatch: d === "allowed" ? "done" : "denied" });
  };

  const pending = s.approval === "pending" ? 1 : 0;
  const offline = s.view === "helm/inquiry" && s.helm === "offline";
  const safe = s.view === "helm/inquiry" && s.helm === "safe";

  const blocked = s.frame.startsWith("blocked");
  const reason = BLOCK_REASON[s.frame];

  const frameCenter = () => {
    if (s.view === "acme-notes/map" || (blocked && view.fallback === undefined)) {
      return (
        <div className={`${FRAME_WIDTH} grid flex-1 place-items-center`}>
          <EmptyState
            size="sm"
            surface="none"
            icon={<CodeXml />}
            title="이 화면은 자체 코드가 필요해요"
            description={
              <span className="grid gap-1">
                <span>{reason?.line}</span>
                <span className="text-text-tertiary">{view.frame?.reason}</span>
              </span>
            }
            actions={
              reason?.settings === true ? (
                <Button
                  size="xs"
                  tone="neutral"
                  variant="outline"
                  onClick={() => set({ setting: true })}
                >
                  {s.frame === "blocked-project" ? "켜는 방법" : "설정 열기"}
                </Button>
              ) : undefined
            }
          />
        </div>
      );
    }
    if (blocked) {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={`${FRAME_WIDTH} grid gap-4 pb-6`}>
            <ShellLine
              icon={<CodeXml emphasis="muted" />}
              action={
                reason?.settings === true ? (
                  <Button
                    size="xs"
                    tone="neutral"
                    variant="ghost"
                    onClick={() => set({ setting: true })}
                  >
                    설정 열기
                  </Button>
                ) : undefined
              }
            >
              {reason?.line} · {josa(T.viewFallback, "으로", "로")} 보여요
            </ShellLine>
            <section role="region" aria-label={`${ext.display} ${T.viewFallback}`}>
              <BoardFallback tasks={s.tasks} onMove={onMove} />
            </section>
          </div>
        </div>
      );
    }
    return (
      <div className={`${FRAME_WIDTH} flex min-h-0 flex-1 flex-col gap-2 pb-3`}>
        {s.confirm !== null && (
          <ConfirmRow
            ext={ext}
            verb="move"
            label={taskflow.methods.find((m) => m.verb === "move")?.label ?? ""}
            dontAsk={s.dontAsk}
            onDontAsk={(v) => set({ dontAsk: v })}
            onAllow={onAllow}
            onDeny={() => set({ confirm: null })}
          />
        )}
        {s.approval === "pending" && (
          <ShellLine
            icon={<Inbox emphasis="muted" />}
            action={
              <Button
                size="xs"
                tone="neutral"
                variant="ghost"
                onClick={() => shell.openEnd("inbox")}
              >
                {T.inbox}
              </Button>
            }
          >
            {josa(ext.display, "이", "가")} 승인을 기다려요 · 승인은 앱 카드로만 받아요
          </ShellLine>
        )}
        {s.pingMissed > 0 && s.frame === "ready" && (
          <ShellLine icon={<TriangleAlert emphasis="muted" />}>
            이 화면의 응답이 늦어요 · 생존 확인 1번 놓침
          </ShellLine>
        )}
        <FrameBox label={`${ext.display} ${T.viewFrame}`}>
          {s.frame === "loading" || s.frame === "reshown" ? (
            <FrameLoading
              line={
                s.frame === "reshown"
                  ? "다른 화면에 있는 동안 내렸다가 다시 띄우는 중이에요"
                  : `${josa(T.viewFrame, "을", "를")} 띄우는 중이에요`
              }
            />
          ) : s.frame === "bridge" ? (
            <FramePlaceholder
              icon={<TriangleAlert />}
              title="이 앱 버전과 맞지 않는 화면이에요"
              description="확장이나 앱을 업데이트하면 열려요."
              diag="bridge_unsupported · 요청 ^2.0.0 · 앱 1.4"
              actions={
                <Button size="xs" tone="neutral" variant="outline" iconStart={<Package />}>
                  확장 상세 열기
                </Button>
              }
            />
          ) : s.frame === "liveness" ? (
            <FramePlaceholder
              icon={<TriangleAlert />}
              title="응답이 없어 이 화면을 내렸어요"
              description="생존 확인에 2번 답하지 않았어요. 다른 화면은 그대로예요."
              diag={`연속 실패 ${s.fails}/5 · 5번이면 이 화면만 꺼져요`}
              actions={
                <Button
                  size="xs"
                  tone="neutral"
                  variant="outline"
                  iconStart={<RotateCw />}
                  onClick={() => set({ frame: "loading" })}
                >
                  다시 불러오기
                </Button>
              }
            />
          ) : (
            <FrameBoard
              tasks={s.tasks}
              focus={s.focus}
              dispatch={s.dispatch}
              onMove={onMove}
              onDispatch={onDispatch}
              onLink={() => set({ link: true })}
            />
          )}
        </FrameBox>
      </div>
    );
  };

  const helmCenter = () => {
    if (s.helm === "loading")
      return (
        <div className={`${FRAME_WIDTH} grid content-start gap-4 pb-6`} aria-busy="true">
          <Skeleton height={16} width="45%" />
          <Skeleton height={28} width="60%" />
          <div className="grid grid-cols-2 gap-6">
            <div className="grid gap-2">
              <Skeleton height={14} />
              <Skeleton height={14} />
              <Skeleton height={14} />
            </div>
            <div className="grid gap-2">
              <Skeleton height={14} />
              <Skeleton height={14} />
            </div>
          </div>
        </div>
      );
    if (s.helm === "view_disabled" || s.helm === "safe")
      return (
        <div className={`${FRAME_WIDTH} grid flex-1 place-items-center`}>
          {s.helm === "safe" ? (
            <EmptyState
              size="sm"
              surface="none"
              icon={<Shield />}
              title={`${T.safeMode}라 Helm이 빠졌어요`}
              description={`${T.safeMode}에서는 ${T.trustUser} ${josa(T.extension, "을", "를")} 싣지 않아요.`}
              actions={
                <Button size="xs" tone="neutral" variant="outline">
                  보통 모드로 다시 시작
                </Button>
              }
            />
          ) : (
            <EmptyState
              size="sm"
              surface="none"
              icon={<TriangleAlert />}
              title="이 화면이 연속 실패해 꺼졌어요"
              description={
                <span className="grid gap-1">
                  <span>Helm은 그대로 켜져 있어요. 이 화면만 껐어요.</span>
                  <span className="font-mono text-mono-sm text-text-tertiary">
                    query ext.helm.status · timeout 5번
                  </span>
                </span>
              }
              actions={
                <>
                  <Button
                    size="xs"
                    tone="neutral"
                    variant="outline"
                    onClick={() => set({ helm: "loading", fails: 0 })}
                  >
                    다시 켜기
                  </Button>
                  <Button size="xs" tone="neutral" variant="ghost">
                    확장 상세 열기
                  </Button>
                </>
              }
            />
          )}
        </div>
      );
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${FRAME_WIDTH} grid gap-3 pb-6`}>
          {offline && (
            <ShellLine icon={<TriangleAlert emphasis="muted" />}>
              엔진 연결이 끊겨 14:20 값을 보여요 · 연결되면 다시 쓸 수 있어요
            </ShellLine>
          )}
          <section role="region" aria-label={`${ext.display} 화면`} className="pt-1">
            <HelmTree offline={offline} truncated={s.helm === "long"} />
          </section>
        </div>
      </div>
    );
  };

  const center = () => {
    if (s.view === "web-exa/none")
      return (
        <div className={`${FRAME_WIDTH} grid flex-1 place-items-center`}>
          <EmptyState
            size="sm"
            surface="none"
            icon={<Package />}
            title="이 확장은 화면을 내지 않아요"
            description="설정과 기록은 확장 상세에서 봐요."
            actions={
              <Button size="xs" tone="neutral" variant="outline">
                확장 상세 열기
              </Button>
            }
          />
        </div>
      );
    if (s.view === "helm/inquiry") return helmCenter();
    return frameCenter();
  };

  const marker =
    view.mode === "frame"
      ? blocked && view.fallback !== undefined
        ? "fallback"
        : "frame"
      : "none";

  return (
    <>
      <Shell
        activeNav={s.view}
        onNavSelect={(id) => {
          if (id in EXT_OF) go(id as ViewId);
          else toast({ title: "이 시안에서는 플러그인 화면만 그려요" });
        }}
        stageLabel={T.workbench}
        workbench={{
          nav: workbenchNav,
          pages: [
            { id: "taskflow/board", ext: "taskflow", label: taskflow.display },
            { id: "helm/inquiry", ext: "helm", label: "Helm 탐구", disabled: safe },
            { id: "acme-notes/map", ext: "acme-notes", label: "노트 지도" },
          ],
          onGoToThread: () => toast({ title: "대화 화면으로 가요" }),
        }}
        threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
        rightTabs={workbenchRightTabs({
          inbox:
            s.approval === "none" ? undefined : (
              <section aria-label={T.approval} className="grid gap-1.5">
                <h3 className="m-0 flex items-baseline gap-1.5 text-ui-sm font-semibold text-text-primary">
                  {T.approval} <span className="tabular-nums text-text-tertiary">{pending}</span>
                </h3>
                <ExtApprovalCard
                  ext={taskflow}
                  status={s.approval}
                  at="지금"
                  thread="캐시 무효화 조사"
                  onDecide={onDecide}
                  flat
                />
              </section>
            ),
          inboxBadge: 2 + pending,
          onGoToThread: () => toast({ title: "대화 화면으로 가요" }),
        })}
        status={defaultStatusCells({
          layout: shell.layout,
          thread: false,
          pendingApprovals: 2 + pending,
          openEnd: shell.openEnd,
          ...(offline
            ? {
                link: {
                  id: "link",
                  text: "연결 끊김",
                  dot: "danger" as const,
                  title: "연결 끊김",
                  description: "엔진과 연결이 끊겼어요.",
                },
              }
            : {}),
          runtime: { drive: safe ? null : "helm", extFailures: 0, onOpen: () => {} },
        })}
        modalOpen={s.link || s.setting}
      >
        <ViewHead
          ext={ext}
          view={view}
          marker={marker}
          onBackToChat={() => toast({ title: "대화로 가요", description: "캐시 무효화 조사" })}
        />
        {center()}
      </Shell>
      <LinkDialog
        ext={ext}
        url={externalLink}
        web={s.web}
        open={s.link}
        onOpenChange={(o) => set({ link: o })}
        onOpenLink={() => {
          set({ link: false });
          toast({ title: s.web ? "새 탭에서 열었어요" : "브라우저에서 열었어요" });
        }}
      />
      <FramesSettingDialog
        open={s.setting}
        onOpenChange={(o) => set({ setting: o })}
        on={s.framesOn}
        project={s.view === "acme-notes/map"}
        projectOn={s.projectFramesOn}
        onToggle={(v) => {
          set({
            framesOn: v,
            ...(v && s.view === "taskflow/board" ? { frame: "loading" as const } : {}),
          });
          if (v && s.view === "taskflow/board")
            window.setTimeout(() => set({ setting: false }), 500);
        }}
        onToggleProject={(v) => {
          set({ projectFramesOn: v });
          if (v)
            toast({
              title: `${T.projectFramesSetting}을 켰어요`,
              description: "사용자 설정에 저장했어요. 노트 지도는 다음에 열 때 띄워요.",
            });
        }}
      />
      <ScenarioDock scenarios={Object.values(FLOWS)} />
      <Toaster label="알림" />
    </>
  );
}

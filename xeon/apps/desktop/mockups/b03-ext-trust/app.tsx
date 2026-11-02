// B03 확장 가져오기와 신뢰: N-37 가져오기(폴더·묶음 파일, 검사, 위치) → O-10 신뢰 확인, coverage §4-2 업데이트 뒤 다시 확인(차이),
// N-38 지우기 확인(O-06 변형), §4-12 URL 설치는 "다음 단계" 안내만. 크래프트 "확장"(P-13) 화면 위에서 열린다.
import { Alert, Button, Toaster, toast } from "@caustic/react";
import { useEffect, useState } from "react";
import {
  defaultStatusCells,
  josa,
  Layers,
  Package,
  ScenarioDock,
  Shell,
  T,
  useScenarioParam,
  useShell,
  useTimeline,
  WB_WIDTH,
  WorkbenchHead,
  workbenchNav,
  workbenchRightTabs,
} from "../_shell";
import { useFlow } from "../b01-plugin-frame/flow";
import { acmeManifest, CHECKS, EXTS, graphLens, webClipManifest } from "./data";
import {
  BASE,
  FLOWS,
  graphRow,
  PHASE_PRESET,
  PRESET,
  updateExt,
  type FlowId,
  type PS,
  type StateId,
} from "./model";
import { ExtList } from "./parts/ext-list";
import { InstallDialog } from "./parts/install";
import { RecheckDialog, RemoveDialog, TrustDialog } from "./parts/trust";

function flowOf(id: string | null) {
  return id !== null && id in FLOWS ? FLOWS[id as FlowId] : null;
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
  const tlRemove = useTimeline();

  // 검사는 하나씩 돈다(목업 0.45초 간격). 다 돌면 결과 단계.
  useEffect(() => {
    if (s.install !== "checking") return;
    const left = CHECKS.length - s.checked;
    tl.start([
      ...Array.from({ length: left }, () => ({
        after: 450,
        run: () => setS((x) => ({ ...x, checked: x.checked + 1 })),
      })),
      { after: 200, run: () => setS((x) => ({ ...x, install: "done" })) },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.install, tl]);

  // 지우기: 이번 단계가 끝나면 빠진다(목업 2.5초). 저장 데이터까지 지우면 실패 갈래(테이블 잠김).
  useEffect(() => {
    const removing = s.exts.find((e) => e.state === "removing");
    if (removing === undefined) return;
    tlRemove.start([
      {
        after: 2500,
        run: () =>
          setS((x) => {
            const failed = x.dropTables;
            if (!failed)
              toast({
                title: `${josa(removing.display, "을", "를")} 지웠어요`,
                description: `${T.extStorage}는 남겼어요`,
              });
            return {
              ...x,
              exts: x.exts.filter((e) => e.name !== removing.name),
              removeError: failed,
              focus: null,
            };
          }),
      },
    ]);
  }, [s.exts, tlRemove]);

  const pick = (p: "good" | "bad") => set({ install: "checking", picked: p, checked: 0 });
  const enableGraph = () => {
    set({ trust: null, exts: graphRow("on"), focus: "graph-lens" });
    toast({
      title: `${josa(graphLens.display, "을", "를")} 켰어요`,
      description: `이번 ${josa(T.step, "이", "가")} 끝나면 실려요`,
    });
  };
  const cancelTrust = () => {
    if (s.trust === "graph-lens") {
      set({ trust: null, exts: graphRow("trust_undecided"), focus: "graph-lens" });
      toast({
        title: "켜지 않았어요",
        description: `${T.installUserDir}에 두고 신뢰 확인을 기다려요`,
      });
    } else set({ trust: null });
  };
  const ext = (name: string) => s.exts.find((e) => e.name === name) ?? EXTS[0];
  const removing = s.remove === null ? undefined : ext(s.remove);
  const trustTarget =
    s.trust === "web-clip" ? webClipManifest : s.trust === "acme-notes" ? acmeManifest : graphLens;

  const total = s.exts.length;
  const on = s.exts.filter((e) => e.state === "on").length;
  const updates = s.exts.filter((e) => e.update !== undefined).length;

  return (
    <>
      <Shell
        activeNav="extensions"
        onNavSelect={() => toast({ title: `이 시안에서는 ${T.extension} 화면만 그려요` })}
        stageLabel={T.workbench}
        workbench={{ nav: workbenchNav, onGoToThread: () => {} }}
        threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
        rightTabs={workbenchRightTabs({ inboxBadge: 2 })}
        status={defaultStatusCells({
          layout: shell.layout,
          thread: false,
          pendingApprovals: 2,
          openEnd: shell.openEnd,
          runtime: { drive: "helm", extFailures: 0, onOpen: () => {} },
        })}
        modalOpen={s.install !== null || s.trust !== null || s.recheck || s.remove !== null}
      >
        <WorkbenchHead
          title={T.extension}
          meta={`${total}개 · 켜짐 ${on}${updates > 0 ? ` · 업데이트 ${updates}` : ""}`}
          actions={
            <Button
              size="xs"
              tone="neutral"
              variant="outline"
              iconStart={<Package />}
              onClick={() => set({ install: "pick", picked: null, checked: 0 })}
            >
              {T.install}
            </Button>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={`${WB_WIDTH} grid gap-2 pb-6`}>
            {/* 줄어든 변경은 묻지 않고 한 줄로만 알린다(coverage §4-2). */}
            <div className="flex min-h-7 items-center gap-1.5 text-ui-dense text-text-secondary">
              <Layers emphasis="muted" aria-hidden className="size-icon-xs text-text-tertiary" />
              <span className="truncate">
                Exa 웹 검색 1.0.4로 업데이트했어요 · 권한이 줄어 묻지 않았어요
              </span>
              <span className="text-ui-xs text-text-tertiary">어제</span>
            </div>
            {s.removeError && (
              <Alert
                tone="danger"
                size="sm"
                action={
                  <Button
                    size="xs"
                    tone="neutral"
                    variant="outline"
                    onClick={() => {
                      set({ removeError: false });
                      toast({
                        title: `${T.extStorage}를 지웠어요`,
                        description: "x_taskflow_tasks, x_taskflow_links",
                      });
                    }}
                  >
                    다시 시도
                  </Button>
                }
              >
                작업 흐름은 지웠지만 {josa(T.extStorage, "을", "를")} 지우지 못했어요 ·
                x_taskflow_tasks 잠김
              </Alert>
            )}
            <ExtList
              exts={s.exts}
              focus={s.focus}
              onUpdate={() => set({ recheck: true })}
              onEnable={() => set({ trust: "graph-lens" })}
              onRemove={(name) => set({ remove: name, dropTables: false })}
            />
          </div>
        </div>
      </Shell>
      {s.install !== null && (
        <InstallDialog
          step={s.install}
          picked={s.picked}
          checked={s.checked}
          web={s.web}
          onPick={pick}
          onNext={() => set({ install: null, trust: "graph-lens" })}
          onRepick={() => set({ install: "pick", picked: null, checked: 0 })}
          onClose={() => set({ install: null })}
        />
      )}
      {s.trust !== null && (
        <TrustDialog
          m={trustTarget}
          projectTrust={s.projectTrust}
          onTrustFolder={() => {
            set({ projectTrust: "allow" });
            toast({
              title: "이 폴더를 신뢰했어요",
              description: `~/code/fresnel · ${T.projectTrust}`,
            });
          }}
          onEnable={() => {
            if (s.trust === "graph-lens") enableGraph();
            else {
              set({ trust: null });
              toast({ title: `${josa(trustTarget.display, "을", "를")} 켰어요` });
            }
          }}
          onCancel={cancelTrust}
        />
      )}
      {s.recheck && (
        <RecheckDialog
          onAccept={() => {
            set({
              recheck: false,
              exts: updateExt(s.exts, "taskflow", { version: "0.4.0", update: undefined }),
              focus: "taskflow",
            });
            toast({
              title: "작업 흐름 0.4.0을 켰어요",
              description: `이번 ${josa(T.step, "이", "가")} 끝나면 바뀌어요`,
            });
          }}
          onDecline={() => {
            set({
              recheck: false,
              exts: updateExt(s.exts, "taskflow", { update: undefined }),
              focus: "taskflow",
            });
            toast({
              title: "0.3.0을 그대로 써요",
              description: `0.4.0은 ${T.version} 탭에 남아요`,
            });
          }}
        />
      )}
      {removing !== undefined && (
        <RemoveDialog
          display={removing.display}
          name={removing.name}
          dropTables={s.dropTables}
          onDropTables={(v) => set({ dropTables: v })}
          onRemove={() =>
            set({
              remove: null,
              exts: updateExt(s.exts, removing.name, { state: "removing" }),
              focus: removing.name,
            })
          }
          onCancel={() => set({ remove: null })}
        />
      )}
      <ScenarioDock scenarios={Object.values(FLOWS)} />
      <Toaster label="알림" />
    </>
  );
}

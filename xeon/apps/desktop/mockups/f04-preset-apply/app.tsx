// N-41 프로필 적용 결과. 미리 보기 실패, 적용 기다림, 적용함, 모두 되돌림을 앞뒤 선 격자로 보인다.
// 구성기 입구는 고르던 값을 잃지 않고 그 자리에서 고친다(parts/compose.tsx). 레일 대신 가장자리까지 닿는 선 격자 띠(LineGridFrame)와 칸 글자에 맞춘 px-3 열을 쓴다(옛 언어 이식).
import { Alert, Button, toast } from "@caustic/react";
import { useEffect, useState } from "react";
import {
  BAR_INSET,
  NoticeList,
  ScenarioDock,
  Shell,
  ShellToaster,
  T,
  GRID_BODY_COMPACT,
  WorkbenchHead,
  defaultStatusCells,
  inbox,
  josa,
  useScenarioParam,
  useShell,
  useTimeline,
  workbenchNav,
  workbenchRightTabs,
} from "../_shell";
import { ApplyBand, ApplyCompare, BLOCKER_NAME, FAIL_NAME, PROFILE_NAME } from "./parts/compare";
import { ComposeBody, ComposeHead, composeWillFail } from "./parts/compose";
import { SCENARIOS, STEPS, initial, type S, type StateId } from "./flow";

const NAV = workbenchNav
  .filter((n) => n.id !== "create")
  .map((n) => (n.id === "overview" ? { ...n, label: T.structure } : n));

const APPLY_MS = 2000;
const PREVIEW_MS = 1200;

function firstState(state: StateId, scenario: string | null): S {
  const q = new URLSearchParams(window.location.search);
  const steps = scenario === null ? undefined : STEPS[scenario];
  if (steps === undefined) return initial(state);
  const at = steps[Math.min(Number(q.get("step") ?? 0), steps.length - 1)];
  if (at === undefined) return initial(state);
  return q.get("hold") === "1" ? { ...at, auto: false } : at;
}

export function App({ state }: { state: StateId }) {
  const scenario = useScenarioParam();
  const [s, setS] = useState<S>(() => firstState(state, scenario));
  const shell = useShell();
  const { start } = useTimeline();
  const set = (p: Partial<S>) => setS((o) => ({ ...o, ...p, auto: true }));
  const say = (title: string) => toast({ title, tone: "neutral" });
  const goThread = () => shell.setArea("chat");

  useEffect(() => {
    if (!s.auto) return;
    if (s.phase === "pending")
      start([
        {
          after: APPLY_MS,
          run: () =>
            setS((o) => {
              const fail = o.entry === "compose" ? composeWillFail(o.picks) : o.failNext;
              return { ...o, phase: fail ? "reverted" : "done", failNext: false };
            }),
        },
      ]);
    else if (s.phase === "preview-loading")
      start([
        {
          after: PREVIEW_MS,
          run: () => setS((o) => ({ ...o, phase: o.reviewOn ? "preview" : "preview-fail" })),
        },
      ]);
  }, [s.phase, s.auto, start]);

  const compose = s.entry === "compose";
  const apply = () => set({ phase: "pending" });
  const toStructure = () => say(`${T.structure}로 돌아가요`);
  const trial = () => say(`${T.trialThread}를 만들고 적용했어요`);

  const headActions = () => {
    const back = (
      <Button size="sm" variant="ghost" onClick={toStructure}>
        {T.structure}로
      </Button>
    );
    switch (s.phase) {
      case "done":
        return (
          <>
            {back}
            <Button size="sm" variant="solid" onClick={goThread}>
              {T.thread}로 가기
            </Button>
          </>
        );
      case "reverted":
        return (
          <>
            {back}
            <Button
              size="sm"
              variant="outline"
              onClick={() => set({ entry: "compose", phase: "reverted" })}
            >
              {T.editProfile}
            </Button>
            <Button size="sm" variant="solid" onClick={apply}>
              다시 적용
            </Button>
          </>
        );
      case "pending":
        return (
          <>
            {back}
            <Button size="sm" variant="solid" loading>
              {T.applyToThread}
            </Button>
          </>
        );
      case "preview-fail":
        return (
          <>
            {back}
            <Button size="sm" variant="outline" onClick={() => set({ phase: "preview-loading" })}>
              다시 {T.preview}
            </Button>
            <Button size="sm" variant="solid" disabled>
              {T.applyToThread}
            </Button>
          </>
        );
      case "preview-loading":
      case "preview":
        return (
          <>
            {back}
            <Button size="sm" variant="outline" onClick={trial}>
              새 {T.trialThread}로
            </Button>
            <Button size="sm" variant="solid" disabled={s.phase !== "preview"} onClick={apply}>
              {T.applyToThread}
            </Button>
          </>
        );
    }
  };

  return (
    <>
      <Shell
        activeNav={compose ? "compose" : "overview"}
        onNavSelect={(id) => {
          if (id === "compose") set({ entry: "compose", phase: "preview" });
          if (id === "overview") set({ entry: "structure", phase: "preview" });
        }}
        workbench={{ onGoToThread: goThread, nav: NAV }}
        stageLabel={T.workbench}
        threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
        rightTabs={workbenchRightTabs({
          inbox: <NoticeList notices={inbox.notices} />,
          inboxBadge: 5,
          onGoToThread: goThread,
        })}
        status={defaultStatusCells({
          layout: shell.layout,
          thread: true,
          pendingApprovals: 0,
          openEnd: shell.openEnd,
          runtime: { drive: "helm", extFailures: 0, onOpen: () => {} },
        })}
      >
        {compose ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <ComposeHead />
            <ComposeBody
              phase={s.phase}
              picks={s.picks}
              onPick={(name, p) => setS((o) => ({ ...o, picks: { ...o.picks, [name]: p } }))}
              onApply={apply}
              onGoThread={goThread}
              onTrial={trial}
              onSave={() => say("저장했어요")}
            />
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
            <WorkbenchHead
              className={`w-full px-3 pt-6 ${BAR_INSET}`}
              title={`${T.profile} 적용`}
              actions={headActions()}
            />
            <div className={`${GRID_BODY_COMPACT} gap-8 pb-8`}>
              <ApplyBand phase={s.phase} />
              {s.phase === "preview-fail" && (
                <Alert
                  tone="danger"
                  variant="soft"
                  size="sm"
                  action={
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => set({ reviewOn: true, phase: "preview-loading" })}
                    >
                      {BLOCKER_NAME} 다시 켜기
                    </Button>
                  }
                >
                  {`${josa(PROFILE_NAME, "을", "를")} 미리 보지 못했어요. ${josa(BLOCKER_NAME, "이", "가")} ${josa(T.autoDisabled, "이라", "라")} 켤 수 없어요.`}
                </Alert>
              )}
              {s.phase === "reverted" && (
                <Alert tone="danger" variant="soft" size="sm">
                  {`${josa(FAIL_NAME, "을", "를")} 켜지 못해 모두 되돌렸어요.`}
                </Alert>
              )}
              <ApplyCompare phase={s.phase} />
            </div>
          </div>
        )}
      </Shell>
      <ShellToaster />
      <ScenarioDock scenarios={SCENARIOS} />
    </>
  );
}

// P-21 구성기 진입 시안: 크래프트 내비 "구성" 하나 안에서 그룹 고르기와 "새 그룹"을 함께 연다(C-6). 만들기 내비가 없다.
// 머리 오른쪽: 주요 동작 하나 · 그룹 고르기 · 새 그룹 · 보기 전환. 코드 보기는 wb-compose CodeView를 그대로 쓰고 아래에 "다음 길" 띠를 더한다(제안, NOTES).
import {
  Button,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectGroup,
  SelectHeading,
  SelectOption,
} from "@caustic/react";
import { useCallback, useEffect, useReducer, useState, type ReactNode } from "react";
import {
  LoaderCircle,
  Lock,
  NoticeList,
  Plus,
  QuestionCard,
  ScenarioDock,
  Shell,
  SlidersHorizontal,
  SquareStack,
  T,
  WorkbenchHead,
  defaultStatusCells,
  inbox,
  josa,
  useScenarioParam,
  useShell,
  workbenchRightTabs,
  type RightTab,
} from "../_shell";
import { StatusDot } from "../_wb-c/parts";
import { lenses, type Lens } from "../wb-compose/fixtures";
import { RailRule } from "../wb-compose/parts/rail";
import { CodeView } from "../wb-compose/screens/code";
import { FlowCanvas } from "../wb-compose/screens/flow";
import { GroupCanvas } from "../wb-compose/screens/group";
import { MockProvider } from "../wb-compose/store";
import {
  AT,
  SCENARIOS,
  SCRIPTS,
  modelAt,
  nameError,
  nextAuto,
  reduce,
  type Action,
  type Model,
  type StateId,
} from "./flow";
import { DraftCanvas, NoComposition, NoPhases } from "./parts/canvases";
import { FlowBoard, type PhaseId } from "./parts/flow-board";
import { NewGroup } from "./parts/new-group";
import { GATE_QUESTION, InspectWell, PaletteWell } from "./parts/well";

const MAKE = `${josa(T.authoringExt, "으로", "로")} 만들기`;
const ENABLE = `${T.authoringExt} 켜기`;
const SOURCE = "grp:lens-review";

const q = new URLSearchParams(window.location.search);
const HOLD = q.get("hold") === "1";

function GroupPick({ s, dispatch }: { s: Model; dispatch: (a: Action) => void }) {
  return (
    <Select
      size="xs"
      value={s.group}
      aria-label={T.group}
      className="w-36"
      onValueChange={(v) => {
        if (v === "helm" || v === "review" || v === "audit-trail")
          dispatch({ t: "pickGroup", group: v });
      }}
    >
      <SelectGroup>
        <SelectHeading>설치됨</SelectHeading>
        <SelectOption value="helm">helm</SelectOption>
        <SelectOption value="review">review</SelectOption>
        <SelectOption value="audit-trail">audit-trail</SelectOption>
      </SelectGroup>
      <SelectGroup>
        <SelectHeading>작성 중</SelectHeading>
        <SelectOption value="lens-review">lens-review</SelectOption>
        {s.group === "new" && <SelectOption value="new">{`새 ${T.group}`}</SelectOption>}
      </SelectGroup>
    </Select>
  );
}

function ViewSwitch({ s, dispatch }: { s: Model; dispatch: (a: Action) => void }) {
  const isNew = s.group === "new";
  return (
    <SegmentedControl
      size="xs"
      value={s.view}
      aria-label="구성기 보기"
      onValueChange={(v) => {
        if (v === "group" || v === "flow" || v === "code") dispatch({ t: "view", view: v });
      }}
    >
      <SegmentedControlItem value="group">{T.group}</SegmentedControlItem>
      <SegmentedControlItem value="flow" disabled={isNew}>
        {T.composeFlow}
      </SegmentedControlItem>
      <SegmentedControlItem value="profile" disabled>
        {T.profile}
      </SegmentedControlItem>
      <SegmentedControlItem value="code" disabled={isNew}>
        {T.composeCode}
      </SegmentedControlItem>
    </SegmentedControl>
  );
}

/** 머리의 주요 동작 하나. 코드 보기는 아래 띠가 맡아 머리에 두지 않는다. */
function Primary({ s, dispatch }: { s: Model; dispatch: (a: Action) => void }): ReactNode {
  if (s.group === "new") {
    const ok = s.name !== "" && nameError(s.name) === null && s.start !== null;
    return (
      <Button size="xs" variant="solid" disabled={!ok} onClick={() => dispatch({ t: "begin" })}>
        {`${T.compose} 시작`}
      </Button>
    );
  }
  if (s.group === "lens-review") {
    if (s.view === "code") return null;
    if (s.view === "flow") {
      if (s.trial !== "none") return null;
      return (
        <Button size="xs" variant="solid" onClick={() => dispatch({ t: "runTrial" })}>
          {`${T.trialThread}에서 돌려 보기`}
        </Button>
      );
    }
    if (s.handoff === "created") return null;
    return <MakeButton s={s} dispatch={dispatch} />;
  }
  if (s.group === "helm" || s.group === "review" || s.group === "audit-trail")
    return (
      <Button
        size="xs"
        variant={s.group === "helm" ? "solid" : "outline"}
        onClick={() => dispatch({ t: "newGroup" })}
      >
        복제해서 고치기
      </Button>
    );
  return null;
}

/** "플러그인 빌더로 만들기" 자리 하나. 꺼져 있으면 같은 자리에 "플러그인 빌더 켜기"(§6.29). */
function MakeButton({ s, dispatch }: { s: Model; dispatch: (a: Action) => void }) {
  if (s.ext === "no-engine")
    return (
      <Button
        size="xs"
        variant="outline"
        onClick={() => dispatch({ t: "note", text: `${T.engine} 화면으로 가요` })}
      >
        {`${T.engine} 보기`}
      </Button>
    );
  if (s.ext === "off" || s.ext === "turning")
    return (
      <Button
        size="xs"
        variant="solid"
        disabled={s.ext === "turning"}
        onClick={() => dispatch({ t: "enable" })}
        {...(s.ext === "turning"
          ? { iconStart: <LoaderCircle className="animate-spin motion-reduce:animate-none" /> }
          : {})}
      >
        {s.ext === "turning" ? "켜는 중" : ENABLE}
      </Button>
    );
  const busy = s.handoff === "opening" || s.handoff === "open";
  return (
    <Button
      size="xs"
      variant="solid"
      disabled={busy}
      onClick={() => dispatch({ t: "make" })}
      {...(busy
        ? { iconStart: <LoaderCircle className="animate-spin motion-reduce:animate-none" /> }
        : {})}
    >
      {busy ? "만드는 중" : MAKE}
    </Button>
  );
}

function Head({ s, dispatch }: { s: Model; dispatch: (a: Action) => void }) {
  const sub =
    s.group === "lens-review" && s.view === "group" && s.handoff === "none"
      ? s.ext === "off" || s.ext === "turning"
        ? `${josa(T.authoringExt, "이", "가")} 꺼져 있어요. 작성한 ${josa(T.block, "은", "는")} 그대로 남아요`
        : `${T.stageCompose}이에요`
      : s.group === "helm" || s.group === "review" || s.group === "audit-trail"
        ? `설치된 ${T.group}이라 읽기 전용이에요`
        : undefined;
  // 머리 한 줄은 제목과 주요 동작, 보기 전환만 둔다. 그룹 고르기와 새 그룹은 설명 줄에 둬서 좁은 폭에서도 제목이 남는다.
  const row = (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {sub !== undefined && <span>{sub}</span>}
      <GroupPick s={s} dispatch={dispatch} />
      {s.group !== "new" && (
        <Button
          size="xs"
          variant="outline"
          iconStart={<Plus />}
          onClick={() => dispatch({ t: "newGroup" })}
        >
          {`새 ${T.group}`}
        </Button>
      )}
    </span>
  );
  return (
    <WorkbenchHead
      className="w-full px-4"
      title={T.compose}
      {...(s.group === "new" ? { meta: `새 ${T.group}` } : {})}
      sub={row}
      actions={
        <span className="flex items-center gap-2">
          <Primary s={s} dispatch={dispatch} />
          <ViewSwitch s={s} dispatch={dispatch} />
        </span>
      }
    />
  );
}

/** 넘긴 뒤 한 줄(캔버스 위, 또는 코드 보기 아래). 주요 동작은 하나만 solid. */
function Handoff({ s, dispatch }: { s: Model; dispatch: (a: Action) => void }) {
  const open = () => dispatch({ t: "note", text: `${T.authoringSession}로 가요` });
  if (s.handoff === "open" || s.handoff === "opening")
    return (
      <Band
        busy
        text={`${T.authoringSession}에 ${josa(T.stageCompose, "을", "를")} 넘겼어요. 파일을 만들고 ${T.stageValidate}하는 중이에요`}
        action={
          <Button size="xs" variant="outline" onClick={open}>
            {`${T.authoringSession} 보기`}
          </Button>
        }
      />
    );
  return (
    <Band
      text={`${josa(s.name, "을", "를")} 만들고 ${T.stageValidate}를 통과했어요`}
      action={
        <span className="flex flex-wrap items-center gap-2">
          <Button
            size="xs"
            variant="solid"
            onClick={() => dispatch({ t: "note", text: `${T.trialThread}를 만들어요` })}
          >
            {`${T.trialThread}에서 켜기`}
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => dispatch({ t: "note", text: "편집기를 열어요" })}
          >
            편집기에서 열기
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => dispatch({ t: "note", text: `${T.humanGate} 뒤 ${T.installLink}해요` })}
          >
            {`${T.userExtDir}에 ${T.installLink}`}
          </Button>
          <Button
            size="xs"
            variant="soft"
            iconStart={<Lock />}
            aria-disabled
            className="text-text-tertiary"
          >
            {T.replay}
          </Button>
        </span>
      }
    />
  );
}

function Band({
  text,
  action,
  busy = false,
}: {
  text: ReactNode;
  action?: ReactNode;
  busy?: boolean;
}) {
  return (
    <div role="status" className="flex flex-none flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <span className="flex min-w-0 flex-1 basis-64 items-center gap-2 text-body text-text-primary">
        {busy ? (
          <LoaderCircle
            aria-hidden
            className="size-icon-xs flex-none animate-spin text-text-tertiary motion-reduce:animate-none"
          />
        ) : (
          <StatusDot tone="neutral" />
        )}
        <span className="min-w-0">{text}</span>
      </span>
      {action}
    </div>
  );
}

/** 코드 보기에서 파일 만들기로 가는 길(제안): 옛 명령 복사 자리. 조건마다 다음 동작 하나. */
function ForwardBar({ s, dispatch }: { s: Model; dispatch: (a: Action) => void }) {
  if (s.handoff !== "none") return <Handoff s={s} dispatch={dispatch} />;
  const text =
    s.ext === "no-engine"
      ? `${T.engine}에 연결되어 있지 않아요. 연결되면 여기서 만들 수 있어요`
      : s.ext === "on"
        ? `아직 파일이 없어요. ${josa(T.authoringExt, "이", "가")} ${T.targetFolder}에 만들고 ${T.stageValidate}해요`
        : `${josa(T.authoringExt, "이", "가")} 꺼져 있어요. 켜면 여기서 바로 만들 수 있어요`;
  return <Band text={text} action={<MakeButton s={s} dispatch={dispatch} />} />;
}

/** 테스트가 사람 확인을 기다리는 동안의 한 줄. */
function GateBand({ s, onAnswer }: { s: Model; onAnswer: () => void }) {
  if (s.trial === "running") return <Band busy text={`${T.trialThread} 돌리는 중`} />;
  if (s.trial === "waiting")
    return (
      <div
        role="status"
        className="flex flex-none flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
      >
        <span className="flex min-w-0 flex-1 basis-64 items-center gap-2 text-body text-warning-text">
          <StatusDot tone="warning" />
          {`${T.trialThread}가 ${josa(T.humanGate, "을", "를")} 기다려요 · ${T.lead} ${T.leadReturn}`}
        </span>
        <Button size="xs" variant="solid" onClick={onAnswer}>
          답하기
        </Button>
      </div>
    );
  return (
    <Band
      text={
        s.trial === "done"
          ? `${T.trialThread} ${T.stageDone}`
          : `${T.lead} ${T.leadRetake} · ${T.trialThread} 돌리는 중`
      }
    />
  );
}

function trialNow(s: Model): PhaseId | null {
  if (s.trial === "none") return null;
  if (s.trial === "running") return "converge";
  if (s.trial === "waiting") return "gate";
  return "apply";
}

function Body({
  s,
  dispatch,
  onAnswer,
}: {
  s: Model;
  dispatch: (a: Action) => void;
  onAnswer: () => void;
}) {
  if (s.group === "new") return <NewGroup s={s} dispatch={dispatch} />;
  if (s.group === "audit-trail")
    return s.view === "flow" ? <NoPhases name={s.group} /> : <NoComposition name={s.group} />;
  if (s.group === "review" && s.view === "flow") return <NoPhases name={s.group} />;
  // 설치된 그룹은 읽기 전용이라 흐름·코드 보기도 wb-compose 것을 그대로 보인다(다음 길 띠 없음).
  if (s.group === "helm" && s.view === "flow")
    return (
      <MockProvider state="S4">
        <FlowCanvas />
      </MockProvider>
    );
  if (s.group === "helm" || s.group === "review")
    return (
      <MockProvider state={s.view === "code" ? "S8" : "S1"}>
        {s.view === "code" ? <CodeView /> : <GroupCanvas />}
      </MockProvider>
    );
  if (s.view === "code")
    return (
      <>
        <MockProvider state="S8">
          <CodeView />
        </MockProvider>
        <div className="mx-4 h-px flex-none bg-border-subtle" />
        <ForwardBar s={s} dispatch={dispatch} />
      </>
    );
  if (s.view === "flow") {
    const trial = s.trial !== "none";
    return (
      <>
        {trial && (
          <>
            <GateBand s={s} onAnswer={onAnswer} />
            <RailRule />
          </>
        )}
        <FlowBoard
          label={`${s.name} ${T.phaseMachine}`}
          mode={trial ? "trial" : "edit"}
          now={trialNow(s)}
          finished={s.trial === "done"}
          gate={s.gate === "absent" ? "idle" : s.gate}
          lenses={lenses.map((l): Lens =>
            l.status === "running" ? { ...l, status: "done", findings: 1 } : l,
          )}
          guardHits={trial ? 1 : 0}
          selected={s.selected}
          onSelect={(id) => dispatch({ t: "select", id })}
        />
      </>
    );
  }
  return (
    <>
      {s.handoff !== "none" && (
        <>
          <Handoff s={s} dispatch={dispatch} />
          <RailRule />
        </>
      )}
      <DraftCanvas
        name={s.name}
        start={s.start}
        selected={s.selected}
        onSelect={(id) => dispatch({ t: "select", id })}
      />
    </>
  );
}

function hint(s: Model): string | undefined {
  if (s.group === "helm") return `"새 ${T.group}"`;
  if (s.group === "new")
    return s.start === null ? `이름을 쓰고 ${T.startPoint}을 고르기` : `"${T.compose} 시작"`;
  if (s.ext === "off") return `"${ENABLE}"`;
  if (s.view === "group" && s.handoff === "none") return `"${T.composeCode}" 보기 또는 "${MAKE}"`;
  if (s.view === "code" && s.handoff === "none") return `"${MAKE}"`;
  if (s.trial === "waiting") return `"답하기"`;
  if (s.view === "flow" && s.trial === "none") return `"${T.trialThread}에서 돌려 보기"`;
  return undefined;
}

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const scenario = useScenarioParam();
  const live = scenario !== null && SCRIPTS[scenario] !== undefined;
  const [s, rawDispatch] = useReducer(reduce, undefined, () => {
    if (live) return modelAt(scenario, Number(q.get("step") ?? "0"));
    const at = AT[state];
    return modelAt(at.script, at.n);
  });
  // 정적 상태(?state=)는 그 모습에 머문다. 시간으로 넘어가는 자리는 시나리오이거나 사용자가 누른 뒤에만 돈다.
  const [touched, setTouched] = useState(false);
  const dispatch = useCallback((a: Action) => {
    setTouched(true);
    rawDispatch(a);
  }, []);
  const [answer, setAnswer] = useState<{ pick: string | null; text: string }>({
    pick: "apply",
    text: "",
  });

  // 스크린숏(hold)은 그 순간에 둔다.
  useEffect(() => {
    if (HOLD || (!live && !touched)) return;
    const next = nextAuto(s);
    if (next === null) return;
    const id = window.setTimeout(() => rawDispatch(next.action), next.after);
    return () => window.clearTimeout(id);
  }, [s, live, touched]);

  // 사람 확인 노드는 캔버스 폭이 필요해 왼쪽 패널을 닫는다(wb-compose S5와 같음).
  useEffect(() => {
    if (s.view === "flow" && s.group === "lens-review" && shell.layout === "wide")
      shell.setStartOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.view]);

  useEffect(() => {
    if (s.note === null || s.trial !== "none") return;
    const id = window.setTimeout(() => rawDispatch({ t: "note", text: null }), 2400);
    return () => window.clearTimeout(id);
  }, [s.note, s.trial]);

  const base = workbenchRightTabs({
    inbox:
      s.gate === "waiting" || s.gate === "answered" ? (
        <div className="p-3">
          <QuestionCard
            approval={{
              kind: "question",
              thread: s.name,
              at: "14:21",
              questions: [
                {
                  id: "gate",
                  header: T.humanGate,
                  text: GATE_QUESTION,
                  multiSelect: false,
                  allowFreeText: false,
                  options: [
                    { id: "apply", label: "적용", recommended: true },
                    { id: "skip", label: "건너뛰기" },
                  ],
                },
              ],
            }}
            status={s.gate === "answered" ? "answered" : "pending"}
            subtitle={`${T.trialThread} · ${SOURCE}`}
            answer={answer}
            onAnswerChange={setAnswer}
            onAnswer={() => dispatch({ t: "answer" })}
            onDeny={() => dispatch({ t: "answer" })}
          />
        </div>
      ) : (
        <NoticeList notices={inbox.notices} />
      ),
    inboxBadge: s.gate === "waiting" ? 1 : 5,
    onGoToThread: () => shell.setArea("chat"),
  });
  const mine: RightTab[] = [
    { id: "palette", label: T.block, icon: <SquareStack />, content: <PaletteWell s={s} /> },
    { id: "inspect", label: "속성", icon: <SlidersHorizontal />, content: <InspectWell s={s} /> },
  ];
  const [first, ...rest] = base;
  const tabs = first === undefined ? mine : [first, ...mine, ...rest];
  const canvas = s.group !== "new" && s.view !== "code";

  return (
    <>
      <Shell
        activeNav="compose"
        onNavSelect={(id) => {
          if (id === "compose") dispatch({ t: "pickGroup", group: "helm" });
          else dispatch({ t: "note", text: "이 화면은 다른 크래프트 시안에 있어요" });
        }}
        workbench={{ onGoToThread: () => shell.setArea("chat") }}
        stageLabel={T.compose}
        threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
        rightTabs={tabs}
        status={defaultStatusCells({
          layout: shell.layout,
          thread: false,
          pendingApprovals: s.gate === "waiting" ? 1 : 0,
          openEnd: shell.openEnd,
          runtime:
            s.trial === "waiting"
              ? {
                  drive: null,
                  extFailures: 0,
                  waiting: "lens-review",
                  onOpen: () => shell.openEnd("inbox"),
                }
              : {
                  drive: s.trial === "none" ? "helm" : "lens-review",
                  extFailures: 0,
                  onOpen: () => {},
                },
        })}
      >
        <div className="relative flex min-h-0 flex-1 flex-col">
          <Head s={s} dispatch={dispatch} />
          {canvas && <RailRule />}
          <Body s={s} dispatch={dispatch} onAnswer={() => shell.openEnd("inbox")} />
          {s.note !== null && s.trial === "none" && (
            <div
              role="status"
              className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center"
            >
              <span className="animate-enter rounded-lg bg-surface-raised px-3 py-1.5 text-ui-dense text-text-primary shadow-3">
                {s.note}
              </span>
            </div>
          )}
        </div>
      </Shell>
      <ScenarioDock scenarios={SCENARIOS} hint={live ? hint(s) : undefined} />
    </>
  );
}

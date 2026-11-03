// P-08 연결 목업 진입점(무대 전체 화면). 대상(이 컴퓨터 앱 안 엔진, 이 컴퓨터 서비스, 원격 SSH) 고르기와 지금 대상의 엔진 상태.
// ?state=S1..S7(기본 S1 앱 안 엔진에 붙음), ?theme=dark.
import { ShellStateProvider } from "../../_shell";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogClose,
  Skeleton,
  Field,
  IconButton,
  Input,
  ListDescription,
  ListDescriptionRow,
  RadioGroup,
  RadioGroupItem,
  Stepper,
  Switch,
  type StepperStep,
} from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import {
  PanelLeft,
  defaultStatusCells,
  Shell,
  standardRightTabs,
  useShell,
  type StatusCell,
} from "../../_shell";
import { InboxLite } from "../p07/parts/inbox-lite";

type Base = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7";
type S = Base | "D-loading" | "D-stop" | "D-restarting" | "D-idle" | "D-target" | "D-web";
/** d03: 새 상태가 기대는 원래 상태. */
const BASE: Record<string, Base> = {
  "D-loading": "S1",
  "D-stop": "S2",
  "D-restarting": "S2",
  "D-idle": "S2",
  "D-target": "S1",
  "D-web": "S4",
};
const toBase = (s: S): Base => (BASE[s] ?? s) as Base;
export const STATES = [
  { id: "S1", label: "S1 앱 안 엔진에 붙음" },
  { id: "S2", label: "S2 로컬 서비스" },
  { id: "S3", label: "S3 원격에 붙는 중" },
  { id: "S4", label: "S4 원격에 붙음" },
  { id: "S5", label: "S5 붙기 실패" },
  { id: "S6", label: "S6 원격 대상 추가" },
  { id: "S7", label: "S7 원격 대상 없음" },
  { id: "D-loading", label: "D 읽는 중" },
  { id: "D-stop", label: "D 서비스 멈추기 확인" },
  { id: "D-restarting", label: "D 서비스 다시 시작 중" },
  { id: "D-idle", label: "D 유휴 종료 안내" },
  { id: "D-target", label: "D 상태 표시줄 대상 팝오버" },
  { id: "D-web", label: "D 웹: 대상 바꾸기 없음" },
] as const satisfies readonly { id: S; label: string }[];

interface Target {
  id: string;
  name: string;
  kind: "sidecar" | "service" | "remote";
  address: string;
}
const targets: Target[] = [
  {
    id: "sidecar",
    name: "이 컴퓨터 · 앱 안 엔진",
    kind: "sidecar",
    address: "앱과 함께 켜지고 꺼져요",
  },
  {
    id: "service",
    name: "이 컴퓨터 · 서비스",
    kind: "service",
    address: "unix:/home/me/.fresnel/run/service.sock",
  },
  {
    id: "build-box",
    name: "build-box",
    kind: "remote",
    address: "ssh://me@build-box/home/me/.fresnel/run/service.sock",
  },
  {
    id: "mac-mini",
    name: "mac-mini",
    kind: "remote",
    address: "ssh://me@mac-mini:2222/Users/me/.fresnel/run/service.sock",
  },
];

const CURRENT: Record<Base, string> = {
  S1: "sidecar",
  S2: "service",
  S3: "sidecar",
  S4: "build-box",
  S5: "sidecar",
  S6: "sidecar",
  S7: "sidecar",
};

function Section({
  title,
  end,
  children,
}: {
  title: string;
  end?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid content-start gap-1.5">
      <div className="flex min-h-7 items-center gap-1.5">
        <h2 className="m-0 flex-1 text-ui-sm font-semibold text-text-primary">{title}</h2>
        {end}
      </div>
      {children}
    </section>
  );
}

const rowsClass =
  "rounded-none [--cs-size-list-term:8rem] [&_[data-slot=list-description-row]]:px-0";

function TargetList({
  state,
  selected,
  onSelect,
}: {
  state: Base;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const current = CURRENT[state];
  const list = state === "S7" ? targets.filter((t) => t.kind !== "remote") : targets;
  return (
    <Section
      title="대상"
      end={
        <Button size="xs" tone="neutral" variant="ghost">
          원격 대상 추가
        </Button>
      }
    >
      <RadioGroup
        aria-label="엔진 대상"
        size="sm"
        value={selected}
        onValueChange={onSelect}
        className="gap-0.5"
      >
        {list.map((t) => (
          <RadioGroupItem key={t.id} value={t.id} className="mt-1 self-start">
            <span className="grid min-w-0 flex-1 gap-0.5 py-1">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-ui-sm font-medium text-text-primary">{t.name}</span>
                <span className="flex-1" />
                {t.id === current && (
                  <Badge
                    size="xs"
                    tone={state === "S3" || state === "S5" ? "neutral" : "success"}
                    dot
                  >
                    {state === "S3" || state === "S5" ? "지금 대상" : "연결됨"}
                  </Badge>
                )}
                {state === "S3" && t.id === "build-box" && (
                  <Badge size="xs" tone="info" dot>
                    붙는 중
                  </Badge>
                )}
                {state === "S5" && t.id === "build-box" && (
                  <Badge size="xs" tone="danger" dot>
                    실패
                  </Badge>
                )}
              </span>
              {t.kind === "remote" && (
                <span className="truncate font-mono text-mono-sm text-text-tertiary">
                  {t.address}
                </span>
              )}
            </span>
          </RadioGroupItem>
        ))}
      </RadioGroup>
      {state === "S7" && (
        <p className="m-0 text-ui-sm font-normal text-text-tertiary">원격 대상이 없어요.</p>
      )}
      {state === "S6" && (
        <div className="grid gap-2.5 pt-2">
          <Field label="이름" size="sm">
            <Input size="sm" defaultValue="lab-server" />
          </Field>
          <Field label="주소" size="sm" error="루프백이 아닌 tcp 주소는 저장하지 않아요.">
            <Input size="sm" defaultValue="tcp://10.0.4.12:7300" invalid className="font-mono" />
          </Field>
          <div className="flex justify-end gap-1.5">
            <Button size="sm" tone="neutral" variant="ghost">
              취소
            </Button>
            <Button size="sm" tone="neutral" variant="solid">
              저장
            </Button>
          </div>
        </div>
      )}
      {selected !== current && state !== "S6" && (
        <div className="flex items-center gap-2 pt-1">
          <span className="min-w-0 flex-1 truncate text-ui-xs text-text-tertiary">
            바꾸면 엔진이 이 대상으로 다시 붙어요.
          </span>
          <Button size="sm" tone="neutral" variant="solid">
            연결
          </Button>
        </div>
      )}
    </Section>
  );
}

function AttachSteps({ failed = false }: { failed?: boolean }) {
  const steps: StepperStep[] = [
    {
      label: "SSH 터널",
      status: failed ? "failed" : "done",
      ...(failed ? { description: "거부됨" } : {}),
    },
    { label: "초기화", status: failed ? "todo" : "done" },
    { label: "동기화", status: failed ? "todo" : "now" },
  ];
  return (
    <Stepper
      aria-label="원격 연결 단계"
      size="xs"
      steps={steps}
      statusLabels={{ done: "끝남", now: "지금", todo: "남음", failed: "실패" }}
    />
  );
}

function Detail({ state: full }: { state: S }) {
  const state = toBase(full);
  const current = CURRENT[state];
  const t = targets.find((x) => x.id === current)!;
  const service = t.kind !== "sidecar";
  const [svc, setSvc] = useState(state === "S2" || state === "S4");
  const changed = svc !== (state === "S2" || state === "S4");
  const [stop, setStop] = useState(full === "D-stop");
  if (full === "D-loading")
    return (
      <div className="grid content-start gap-3" role="status" aria-label="엔진 상태 읽는 중">
        <Skeleton width="40%" height={14} />
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex gap-6">
            <Skeleton width="22%" height={12} />
            <Skeleton width={`${30 + ((i * 13) % 35)}%`} height={12} />
          </div>
        ))}
      </div>
    );
  const restarting = full === "D-restarting";
  return (
    <div className="grid content-start gap-5">
      {full === "D-idle" && (
        <Alert tone="neutral" size="sm" actions={[{ label: "계속 켜 두기", primary: true }]}>
          연결·진행 중 턴·대기 예약이 모두 0이라 4분 뒤 서비스가 꺼져요.
        </Alert>
      )}
      {restarting && (
        <Alert tone="warning" size="sm">
          서비스를 다시 시작하는 중이에요.
        </Alert>
      )}
      {state === "S3" && (
        <Section title="build-box에 붙는 중">
          <AttachSteps />
          <div>
            <Button size="xs" tone="neutral" variant="ghost">
              그만두기
            </Button>
          </div>
        </Section>
      )}
      {state === "S5" && (
        <Section title="build-box에 붙지 못했어요">
          <AttachSteps failed />
          <Alert
            tone="danger"
            size="sm"
            actions={[{ label: "다시 시도", primary: true }, { label: "진단 복사" }]}
          >
            SSH 터널을 열지 못했어요. build-box:22가 연결을 거부했어요. 지금은 이 컴퓨터 앱 안
            엔진에 그대로 붙어 있어요.
          </Alert>
        </Section>
      )}
      <Section title={`지금 대상 · ${t.name}`}>
        <ListDescription variant="ghost" size="xs" aria-label="엔진 상태" className={rowsClass}>
          <ListDescriptionRow term="상태">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${restarting ? "bg-warning-graphic" : "bg-success-graphic"}`}
              />
              {restarting ? "다시 시작 중" : "연결됨"}
            </span>
          </ListDescriptionRow>
          {t.kind === "remote" && (
            <ListDescriptionRow term="주소" mono>
              <span className="break-all">{t.address}</span>
            </ListDescriptionRow>
          )}
          <ListDescriptionRow term="연결된 클라이언트">
            {service ? "이 앱, 웹" : "이 앱"}
          </ListDescriptionRow>
          <ListDescriptionRow term="안전 모드">꺼짐</ListDescriptionRow>
        </ListDescription>
      </Section>
      {t.kind !== "remote" && (
        <Section title="서비스">
          <div className="grid gap-2.5">
            <label className="flex items-center gap-2.5 text-ui-sm text-text-primary">
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex items-center gap-2">
                  서비스 모드
                  {changed && (
                    <Badge size="xs" tone="warning">
                      재시작 필요
                    </Badge>
                  )}
                </span>
              </span>
              <Switch size="sm" checked={svc} onCheckedChange={setSvc} aria-label="서비스 모드" />
            </label>
            <label className="flex items-center gap-2.5 text-ui-sm text-text-primary">
              <span className="grid min-w-0 flex-1 gap-0.5">원격 예약 허용</span>
              <Switch size="sm" defaultChecked aria-label="원격 예약 허용" />
            </label>
            <label className="flex items-center gap-2.5 text-ui-sm text-text-primary">
              <span className="grid min-w-0 flex-1 gap-0.5">원격 응답 허용</span>
              <Switch size="sm" aria-label="원격 응답 허용" />
            </label>
          </div>
        </Section>
      )}
      <div className="flex flex-wrap gap-1.5">
        {service && (
          <Button size="sm" tone="danger" variant="ghost" onClick={() => setStop(true)}>
            서비스 멈추기
          </Button>
        )}
        {service && t.kind !== "remote" && (
          <Button size="sm" tone="neutral" variant="ghost" loading={restarting}>
            서비스 다시 시작
          </Button>
        )}
        {t.kind === "remote" && (
          <Button size="sm" tone="neutral" variant="ghost">
            로컬로 돌아가기
          </Button>
        )}
        <span className="flex-1" />
        <Button size="sm" tone="neutral" variant="ghost">
          진단 복사
        </Button>
        <Button size="sm" tone="neutral" variant="soft">
          엔진 다시 시작
        </Button>
      </div>
      {stop && (
        <Dialog
          open
          kind="alert"
          size="sm"
          tone="danger"
          onOpenChange={(o) => !o && setStop(false)}
          title="서비스를 멈출까요?"
          description="멈추면 앱을 닫았을 때 예약이 돌지 않아요."
          footer={
            <>
              <DialogClose asChild>
                <Button size="sm" tone="neutral" variant="outline" autoFocus>
                  취소
                </Button>
              </DialogClose>
              <Button size="sm" tone="danger" variant="solid" onClick={() => setStop(false)}>
                서비스 멈추기
              </Button>
            </>
          }
        >
          <ListDescription
            variant="ghost"
            size="xs"
            aria-label="멈추면 생기는 일"
            className={rowsClass}
          >
            <ListDescriptionRow term="진행 중 턴">1 · 멈췄다가 이어서 실행 후보</ListDescriptionRow>
            <ListDescriptionRow term="대기 예약">
              5 · 앱이 열려 있는 동안만 돌아요
            </ListDescriptionRow>
            <ListDescriptionRow term="다른 클라이언트">1 · 연결이 끊겨요</ListDescriptionRow>
          </ListDescription>
        </Dialog>
      )}
    </div>
  );
}

/** d03: 상태 표시줄 대상 팝오버 본문(P-08 요약). 대상 바꾸기는 데스크톱만. */
function TargetSummary({ web }: { web: boolean }) {
  return (
    <ListDescription variant="ghost" size="xs" aria-label="대상 요약" className={rowsClass}>
      <ListDescriptionRow term="대상">
        {web ? "build-box · 서비스" : "이 컴퓨터 · 앱 안 엔진"}
      </ListDescriptionRow>
      <ListDescriptionRow term="엔진">실행 중</ListDescriptionRow>
      <ListDescriptionRow term="클라이언트">{web ? "이 탭, 앱" : "이 앱"}</ListDescriptionRow>
    </ListDescription>
  );
}

function Page({ state: full }: { state: S }) {
  const state = toBase(full);
  const shell = useShell();
  const initialSelected = state === "S3" || state === "S5" ? "build-box" : CURRENT[state];
  const [selected, setSelected] = useState(initialSelected);
  useEffect(() => {
    shell.setEndOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const status = defaultStatusCells({
    layout: shell.layout,
    thread: false,
    pendingApprovals: 2,
    openEnd: shell.openEnd,
    ...(state === "S3"
      ? {
          link: {
            id: "link",
            text: "붙는 중",
            dot: "warning" as const,
            title: "연결",
            description: "build-box에 붙고 있어요.",
          },
        }
      : {}),
  });
  const targetText =
    { sidecar: "앱 안 엔진", service: "서비스", "build-box": "원격 · build-box" }[CURRENT[state]] ??
    "앱 안 엔진";
  const web = full === "D-web";
  status.start = status.start.map((c): StatusCell =>
    c.id === "target"
      ? {
          ...c,
          text: web ? "웹 · build-box" : targetText,
          title: "대상",
          description: web
            ? "이 탭은 build-box의 서비스에 붙어 있어요. 다른 서비스는 그 주소를 새 탭으로 열어요."
            : `이 창은 ${targetText}에 붙어 있어요.`,
          body: <TargetSummary web={web} />,
          ...(web ? {} : { action: { label: "대상 바꾸기", onSelect: () => {} } }),
          secondary: { label: "연결 화면", onSelect: () => {} },
          defaultOpen: full === "D-target" || web,
          wide: true,
        }
      : c.id === "engine" && full === "D-restarting"
        ? {
            ...c,
            text: "다시 시작 중",
            dot: "warning",
            description: "서비스를 다시 시작하고 있어요.",
          }
        : c,
  );
  return (
    <Shell
      activeNav="connection"
      stageLabel="연결"
      threads={{ currentId: null, onSelect: () => {}, onNew: () => {} }}
      rightTabs={standardRightTabs({ inbox: <InboxLite />, inboxBadge: 5, only: ["inbox"] })}
      status={status}
    >
      <header className="flex h-10 flex-none items-center gap-2 px-3">
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
        <h1 className="m-0 text-ui-strong text-text-primary">연결</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-4">
        <div className="grid gap-8 [grid-template-columns:minmax(0,1fr)] min-[1000px]:[grid-template-columns:minmax(0,1fr)_minmax(0,1.15fr)]">
          {full === "D-loading" ? (
            <div className="grid content-start gap-3" aria-hidden>
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} width={`${60 + ((i * 11) % 30)}%`} height={14} />
              ))}
            </div>
          ) : (
            <TargetList state={state} selected={selected} onSelect={setSelected} />
          )}
          <Detail state={full} />
        </div>
      </div>
    </Shell>
  );
}

export function Root({ state }: { state: string }) {
  return (
    <ShellStateProvider>
      <Page state={state as S} />
    </ShellStateProvider>
  );
}

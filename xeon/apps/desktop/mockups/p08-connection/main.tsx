// P-08 연결 목업 진입점(무대 전체 화면). 대상(이 컴퓨터 앱 안 엔진, 이 컴퓨터 서비스, 원격 SSH) 고르기와 지금 대상의 엔진 상태.
// ?state=S1..S7(기본 S1 앱 안 엔진에 붙음), ?theme=dark.
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import {
  Alert,
  Badge,
  Button,
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
import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  PanelLeft,
  defaultStatusCells,
  Shell,
  standardRightTabs,
  useShell,
  type StatusCell,
} from "../_shell";
import { InboxLite } from "../p07-schedules/parts/inbox-lite";

loadCausticFonts();

type S = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7";
const STATES = [
  { id: "S1", label: "S1 앱 안 엔진에 붙음" },
  { id: "S2", label: "S2 로컬 서비스" },
  { id: "S3", label: "S3 원격에 붙는 중" },
  { id: "S4", label: "S4 원격에 붙음" },
  { id: "S5", label: "S5 붙기 실패" },
  { id: "S6", label: "S6 원격 대상 추가" },
  { id: "S7", label: "S7 원격 대상 없음" },
] as const satisfies readonly { id: S; label: string }[];

interface Target {
  id: string;
  name: string;
  kind: "sidecar" | "service" | "remote";
  address: string;
}
const SIDECAR: Target = {
  id: "sidecar",
  name: "이 컴퓨터 · 앱 안 엔진",
  kind: "sidecar",
  address: "",
};
const targets: Target[] = [
  SIDECAR,
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

const CURRENT: Record<S, string> = {
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
  state: S;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const current = CURRENT[state];
  const list = state === "S7" ? targets.filter((t) => t.kind !== "remote") : targets;
  return (
    <Section
      title="대상"
      end={
        <Button size="xs" variant="ghost">
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
                {t.id === current && state !== "S3" && state !== "S5" && (
                  <Badge size="xs" tone="success" dot>
                    연결됨
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
            <Button size="sm" variant="ghost">
              취소
            </Button>
            <Button size="sm" variant="solid">
              저장
            </Button>
          </div>
        </div>
      )}
      {selected !== current && state !== "S6" && (
        <div className="flex justify-end pt-1">
          <Button size="sm" variant="solid">
            연결
          </Button>
        </div>
      )}
    </Section>
  );
}

function AttachSteps({ failed = false }: { failed?: boolean }) {
  const steps: StepperStep[] = [
    { label: "SSH 터널", status: failed ? "failed" : "done" },
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

function Detail({ state }: { state: S }) {
  const current = CURRENT[state];
  const t = targets.find((x) => x.id === current) ?? SIDECAR;
  const service = t.kind !== "sidecar";
  const [svc, setSvc] = useState(state === "S2" || state === "S4");
  const changed = svc !== (state === "S2" || state === "S4");
  return (
    <div className="grid content-start gap-5">
      {state === "S3" && (
        <Section title="build-box에 붙는 중">
          <AttachSteps />
          <div>
            <Button size="xs" variant="ghost">
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
            SSH 터널을 열지 못했어요.
          </Alert>
        </Section>
      )}
      <Section title="지금 대상">
        <ListDescription variant="ghost" size="xs" aria-label="엔진 상태" className={rowsClass}>
          <ListDescriptionRow term="상태">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-1.5 rounded-full bg-success-graphic" />
              연결됨
            </span>
          </ListDescriptionRow>
          {t.kind === "remote" && (
            <ListDescriptionRow term="주소" mono>
              <span className="break-all">{t.address}</span>
            </ListDescriptionRow>
          )}
          <ListDescriptionRow term="시작">
            {t.kind === "sidecar" ? "25분 전" : "3시간 전"}
          </ListDescriptionRow>
          <ListDescriptionRow term="대기 예약">5</ListDescriptionRow>
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
          <Button size="sm" tone="danger" variant="ghost">
            서비스 멈추기
          </Button>
        )}
        {t.kind === "remote" && (
          <Button size="sm" variant="ghost">
            로컬로 돌아가기
          </Button>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost">
          진단 복사
        </Button>
        <Button size="sm" variant="soft">
          엔진 다시 시작
        </Button>
      </div>
    </div>
  );
}

function Page({ state }: { state: S }) {
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
  status.start = status.start.map((c): StatusCell =>
    c.id === "target"
      ? { ...c, text: targetText, description: `이 창은 ${targetText}에 붙어 있어요.` }
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
          <TargetList state={state} selected={selected} onSelect={setSelected} />
          <Detail state={state} />
        </div>
      </div>
    </Shell>
  );
}

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider>
            <Page state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );

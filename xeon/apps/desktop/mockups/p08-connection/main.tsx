// P-08 연결 목업 진입점(무대 전체 화면). 대상(이 컴퓨터 사이드카, 이 컴퓨터 서비스, 원격 SSH) 고르기와 지금 대상의 엔진 상태.
// ?state=S1..S7(기본 S1 사이드카에 붙음), ?theme=dark.
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
  Copy,
  PanelLeft,
  Plus,
  RotateCw,
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
  { id: "S1", label: "S1 사이드카에 붙음" },
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
const targets: Target[] = [
  {
    id: "sidecar",
    name: "이 컴퓨터 · 사이드카",
    kind: "sidecar",
    address: "앱과 함께 켜지고 꺼져요",
  },
  {
    id: "service",
    name: "이 컴퓨터 · 서비스",
    kind: "service",
    address: "unix:/home/me/.xeon/run/service.sock",
  },
  {
    id: "build-box",
    name: "build-box",
    kind: "remote",
    address: "ssh://me@build-box/home/me/.xeon/run/service.sock",
  },
  {
    id: "mac-mini",
    name: "mac-mini",
    kind: "remote",
    address: "ssh://me@mac-mini:2222/Users/me/.xeon/run/service.sock",
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
        <Button size="xs" tone="neutral" variant="ghost" iconStart={<Plus />}>
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
                {t.kind === "remote" && <span className="text-ui-xs text-text-tertiary">원격</span>}
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
              <span
                className={`truncate text-text-tertiary ${t.kind === "sidecar" ? "text-ui-xs" : "font-mono text-mono-sm"}`}
              >
                {t.address}
              </span>
            </span>
          </RadioGroupItem>
        ))}
      </RadioGroup>
      {state === "S7" && (
        <p className="m-0 text-ui-sm font-normal text-text-tertiary">
          원격 대상이 없어요. SSH로 접속할 수 있는 기기의 서비스 소켓 주소를 넣어요.
        </p>
      )}
      {state === "S6" && (
        <div className="grid gap-2.5 pt-2">
          <Field label="이름" size="sm">
            <Input size="sm" defaultValue="lab-server" />
          </Field>
          <Field
            label="주소"
            size="sm"
            error="루프백이 아닌 tcp 주소는 저장하지 않아요. SSH 터널이나 사설망을 써요."
            hint="unix:/abs, ssh://[user@]host[:port]/abs/socket, tcp://127.0.0.1:port"
          >
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
    {
      label: "동기화",
      status: failed ? "todo" : "now",
      ...(failed ? {} : { description: "1,200 / 1,840" }),
    },
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
  const t = targets.find((x) => x.id === current)!;
  const service = t.kind !== "sidecar";
  const [svc, setSvc] = useState(state === "S2" || state === "S4");
  const changed = svc !== (state === "S2" || state === "S4");
  return (
    <div className="grid content-start gap-5">
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
            SSH 터널을 열지 못했어요. build-box:22가 연결을 거부했어요 (tunnel_failed). 지금은 이
            컴퓨터 사이드카에 그대로 붙어 있어요.
          </Alert>
        </Section>
      )}
      <Section title={`지금 대상 · ${t.name}`}>
        <ListDescription variant="ghost" size="xs" aria-label="엔진 상태" className={rowsClass}>
          <ListDescriptionRow term="상태">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-1.5 rounded-full bg-success-graphic" />
              연결됨 · {t.kind === "remote" ? "remote" : t.kind}
            </span>
          </ListDescriptionRow>
          {t.kind === "remote" && (
            <ListDescriptionRow term="주소" mono>
              <span className="break-all">{t.address}</span>
            </ListDescriptionRow>
          )}
          <ListDescriptionRow term="pid" mono>
            {t.kind === "remote" ? "88120" : t.kind === "service" ? "4211" : "51907"}
          </ListDescriptionRow>
          <ListDescriptionRow term="시작">
            {t.kind === "sidecar" ? "25분 전" : "3시간 전"}
          </ListDescriptionRow>
          <ListDescriptionRow term="연결된 클라이언트">
            {service ? "2 (이 앱, xeon CLI)" : "1 (이 앱)"}
          </ListDescriptionRow>
          <ListDescriptionRow term="진행 중 턴">1</ListDescriptionRow>
          <ListDescriptionRow term="유휴 종료">
            {service ? "연결 0, 진행 0, 예약 0이 되면" : "앱을 닫으면"}
          </ListDescriptionRow>
          <ListDescriptionRow term="대기 예약">
            {service ? "5" : "5 · 앱을 닫으면 멈춰요"}
          </ListDescriptionRow>
          <ListDescriptionRow term="안전 모드">꺼짐 · 그룹 3개 불러옴</ListDescriptionRow>
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
                <span className="text-ui-xs font-normal text-text-tertiary">
                  켜면 앱을 닫아도 예약과 대화가 이어져요.
                </span>
              </span>
              <Switch size="sm" checked={svc} onCheckedChange={setSvc} aria-label="서비스 모드" />
            </label>
            <label className="flex items-center gap-2.5 text-ui-sm text-text-primary">
              <span className="grid min-w-0 flex-1 gap-0.5">
                원격 예약 허용
                <span className="text-ui-xs font-normal text-text-tertiary">
                  다른 기기가 원격 트리거 예약을 부를 수 있어요.
                </span>
              </span>
              <Switch size="sm" defaultChecked aria-label="원격 예약 허용" />
            </label>
            <label className="flex items-center gap-2.5 text-ui-sm text-text-primary">
              <span className="grid min-w-0 flex-1 gap-0.5">
                원격 응답 허용
                <span className="text-ui-xs font-normal text-text-tertiary">
                  다른 기기가 승인과 질문에 답할 수 있어요.
                </span>
              </span>
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
          <Button size="sm" tone="neutral" variant="ghost">
            로컬로 돌아가기
          </Button>
        )}
        <span className="flex-1" />
        <Button size="sm" tone="neutral" variant="ghost" iconStart={<Copy />}>
          진단 복사
        </Button>
        <Button size="sm" tone="neutral" variant="soft" iconStart={<RotateCw />}>
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
    { sidecar: "사이드카", service: "서비스", "build-box": "원격 · build-box" }[CURRENT[state]] ??
    "사이드카";
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

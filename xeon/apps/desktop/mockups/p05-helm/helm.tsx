// P-05 탐구(Helm). 오른쪽 well 탭 내용(HelmPanel)과 전체 화면 보기(HelmPage, S12).
// 맨 위는 이 대화의 그룹과 탐구 머리(주제, 단계, 상한)다. Helm의 보조 에이전트(렌즈)는 caustic ActivityTree 나무(렌즈 = step, 도구 호출 = call)로 그린다.
import {
  ActivityTree,
  Alert,
  Badge,
  Button,
  Input,
  ListDescription,
  ListDescriptionRow,
  Skeleton,
  Stepper,
  Timeline,
  TimelineItem,
  type ActivityNode,
  type StepperStep,
} from "@caustic/react";
import type { ReactNode } from "react";
import { BAR_INSET, extJ, extName, T, useShell } from "../_shell";
import {
  findings,
  groups,
  lensesDone,
  lensesExplore,
  recent,
  switches,
  type ActiveGroup,
  type Finding,
  type Lens,
} from "./fixtures";

export type HelmState =
  | "S1"
  | "S2"
  | "S3"
  | "S4"
  | "S5"
  | "S6"
  | "S7"
  | "S8"
  | "S9"
  | "S10"
  | "S11"
  | "S12";

export function Section({
  title,
  count,
  end,
  children,
}: {
  title: string;
  count?: ReactNode;
  end?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid gap-1.5">
      <div className="flex min-h-6 items-center gap-1.5">
        <h3 className="m-0 flex flex-1 items-baseline gap-1.5 text-ui-sm font-semibold text-text-primary">
          {title}
          {count !== undefined && (
            <span className="font-normal tabular-nums text-text-tertiary">{count}</span>
          )}
        </h3>
        {end}
      </div>
      {children}
    </section>
  );
}

// ── 그룹과 주도 ─────────────────────────────────────────────

function LeaseBadge({ lease }: { lease: ActiveGroup["lease"] }) {
  if (lease === "held")
    return (
      <Badge size="xs" tone="agent">
        {T.lead} 보유
      </Badge>
    );
  if (lease === "waiting")
    return (
      <Badge size="xs" tone="neutral">
        {T.lead} 대기
      </Badge>
    );
  return null;
}

/** 이 대화에 걸린 그룹. 줄마다 이름, 지금 상태, 주도. */
export function GroupsSection({
  helmLease = "held",
  helmState,
  reviewLease = "waiting",
}: {
  helmLease?: ActiveGroup["lease"];
  helmState?: string;
  reviewLease?: ActiveGroup["lease"];
}) {
  const rows = groups.map((g) =>
    g.id === "helm"
      ? { ...g, lease: helmLease, state: helmState ?? g.state }
      : g.id === "review"
        ? { ...g, lease: reviewLease, state: reviewLease === "held" ? "변경 검토 중" : g.state }
        : g,
  );
  return (
    <Section
      title="이 대화의 그룹"
      end={
        <Button size="xs" tone="neutral" variant="ghost">
          그룹
        </Button>
      }
    >
      <ul className="m-0 grid list-none gap-1 p-0">
        {rows.map((g) => (
          <li key={g.id} className="flex min-w-0 items-center gap-2 text-ui-sm">
            <span className="w-16 shrink-0 font-mono text-mono-sm text-text-primary">
              {extName(g.name)}
            </span>
            <span className="min-w-0 flex-1 truncate text-text-tertiary">{g.state}</span>
            <LeaseBadge lease={g.lease} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ── 단계, 상한, 렌즈 ─────────────────────────────────────────────

const PHASES = ["확산", "탐색", "수렴", "적용"];
function PhaseStepper({ at, failed = false }: { at: number; failed?: boolean }) {
  // at: 지금 단계(1~4), 5 = 모두 끝
  const steps: StepperStep[] = PHASES.map((label, i) => ({
    label,
    status: i + 1 < at ? "done" : i + 1 === at ? (failed ? "failed" : "now") : "todo",
  }));
  return (
    <Stepper
      aria-label="탐구 단계"
      size="xs"
      steps={steps}
      statusLabels={{ done: "끝남", now: "지금", todo: "남음", failed: "멈춤" }}
    />
  );
}

function Budget({ turn, spawn }: { turn: string; spawn: string }) {
  return (
    <ListDescription
      variant="ghost"
      size="xs"
      aria-label="상한"
      className="rounded-none [--cs-size-list-term:6rem] [&_[data-slot=list-description-row]]:px-0"
    >
      <ListDescriptionRow term="턴">
        <span className="tabular-nums">{turn}</span>
      </ListDescriptionRow>
      <ListDescriptionRow term="자식 에이전트">
        <span className="tabular-nums">{spawn}</span>
      </ListDescriptionRow>
    </ListDescription>
  );
}

const lensStatus = {
  running: "active",
  done: "done",
  failed: "failed",
  pending: "done",
  skipped: "done",
} as const;
export function LensTree({ lenses }: { lenses: Lens[] }) {
  // caustic 빈틈: ActivityTree step에 pending·skipped 상태가 없다(done·active·failed). 이 시안의 렌즈는 셋 중 하나만 쓴다.
  const nodes: ActivityNode[] = lenses.flatMap((l) => [
    {
      id: l.id,
      kind: "step" as const,
      status: lensStatus[l.status],
      label: l.title,
      ...(l.meta !== undefined ? { meta: l.meta } : {}),
    },
    ...l.calls.map((c) => ({
      id: c.id,
      kind: "call" as const,
      label: c.label,
      ...(c.running ? { running: true } : {}),
      ...(c.failed ? { failed: true } : {}),
    })),
  ]);
  return (
    <ActivityTree
      aria-label="렌즈와 자식 에이전트"
      variant="ghost"
      failedLabel="실패"
      nodes={nodes}
      className="p-0"
    />
  );
}

// ── 발견 ───────────────────────────────────────────────────────

const CONF = {
  high: { word: "높음", tone: "success" },
  med: { word: "보통", tone: "neutral" },
  low: { word: "낮음", tone: "outline" },
} as const;

function FindingRow({ f }: { f: Finding }) {
  const shell = useShell();
  const c = CONF[f.confidence];
  return (
    <li className="grid gap-1">
      <p className="m-0 text-ui-sm font-normal text-text-primary">{f.claim}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-xs text-text-tertiary">
        <Badge size="xs" tone={c.tone}>
          신뢰 {c.word}
        </Badge>
        {f.task !== undefined && (
          <button
            type="button"
            onClick={() => shell.openEnd("work")}
            className="rounded-sm text-text-secondary underline-offset-2 outline-none hover:underline focus-visible:focus-ring"
          >
            작업
          </button>
        )}
      </div>
    </li>
  );
}

export function FindingList({ items }: { items: Finding[] }) {
  const lenses = [...new Set(items.map((f) => f.lens))];
  return (
    <div className="grid gap-3">
      {lenses.map((lens) => (
        <div key={lens} className="grid gap-1.5">
          <span className="text-ui-xs font-medium text-text-tertiary">{lens}</span>
          <ul className="m-0 grid list-none gap-2.5 p-0">
            {items
              .filter((f) => f.lens === lens)
              .map((f) => (
                <FindingRow key={f.id} f={f} />
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ── 머리 ───────────────────────────────────────────────────────

function InquiryHead({
  meta,
  action,
  badge,
  full = false,
  onFull,
}: {
  meta?: ReactNode;
  action?: ReactNode;
  badge?: ReactNode;
  full?: boolean;
  onFull?: () => void;
}) {
  return (
    <div className="grid gap-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <h3 className="m-0 min-w-0 flex-1 truncate text-ui-strong text-text-primary">
          캐시 무효화
        </h3>
        {action}
        {onFull !== undefined && (
          <Button size="xs" tone="neutral" variant="ghost" onClick={onFull}>
            {full ? "대화로" : "크게"}
          </Button>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-xs text-text-tertiary">
        {meta !== undefined && <span>{meta}</span>}
        {badge}
      </div>
    </div>
  );
}

const writeDenied = (
  <Badge size="xs" tone="warning">
    쓰기 도구 거부 중
  </Badge>
);

// ── well 내용 ───────────────────────────────────────────────────

export function HelmPanel({ state, onFull }: { state: HelmState; onFull: () => void }) {
  const stop = (
    <Button size="xs" tone="neutral" variant="ghost">
      멈춤
    </Button>
  );
  switch (state) {
    case "S1":
      return (
        <div className="grid gap-5" aria-live="polite">
          <GroupsSection />
          <div className="grid gap-3">
            <InquiryHead meta="같은 오류 3번" badge={writeDenied} action={stop} onFull={onFull} />
            <PhaseStepper at={2} />
            <Budget turn="1 / 4" spawn="3 / 8" />
          </div>
          <Section title="렌즈">
            <LensTree lenses={lensesExplore} />
          </Section>
        </div>
      );
    case "S2":
      return (
        <div className="grid gap-5">
          <GroupsSection helmState="수렴 단계" />
          <div className="grid gap-3">
            <InquiryHead meta="같은 오류 3번" action={stop} onFull={onFull} />
            <PhaseStepper at={3} />
            <Budget turn="2 / 4" spawn="3 / 8" />
          </div>
          <Section title="발견">
            <FindingList items={findings} />
          </Section>
          <Section title="렌즈">
            <LensTree lenses={lensesDone} />
          </Section>
        </div>
      );
    case "S3":
      return (
        <div className="grid gap-5" aria-live="polite">
          <GroupsSection helmLease="none" helmState="쉬는 중" reviewLease="held" />
          <div className="grid gap-3">
            <InquiryHead
              badge={
                <Badge size="xs" tone="success">
                  적용함
                </Badge>
              }
              onFull={onFull}
            />
            <PhaseStepper at={5} />
            <p className="m-0 text-ui-sm font-normal text-text-secondary">
              ttl을 저장할 때 밀리초로 바꾸고 경계 시각 테스트를 더했어요.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button size="xs" tone="neutral" variant="soft">
                적용 턴으로
              </Button>
            </div>
          </div>
          <Section title="생긴 작업">
            <ul className="m-0 grid list-none gap-1 p-0 text-ui-sm">
              <li className="flex gap-2">
                <span className="text-text-primary">TTL 경계 시각 테스트 추가</span>
              </li>
              <li className="flex gap-2">
                <span className="text-text-primary">테스트 시계를 가짜 시계로 바꾸기</span>
              </li>
            </ul>
          </Section>
          <Section title="발견">
            <FindingList items={findings} />
          </Section>
        </div>
      );
    case "S4":
    case "S11":
      return (
        <div className="grid gap-5">
          <GroupsSection helmLease="none" helmState="막힘 신호 없음" reviewLease="none" />
          <Section title="탐구 시작">
            <div className="grid gap-1.5">
              <div className="flex gap-1.5">
                <Input
                  size="sm"
                  aria-label="주제"
                  placeholder="주제"
                  containerClassName="min-w-0 flex-1"
                  invalid={state === "S11"}
                />
                <Button size="sm" tone="neutral" variant="solid">
                  시작
                </Button>
              </div>
              {state === "S11" && (
                <p role="alert" className="m-0 text-ui-xs text-danger-text">
                  탐구 상태를 저장하지 못했어요. 다시 시도해 주세요.
                </p>
              )}
            </div>
          </Section>
          <Section title="최근 탐구">
            <ul className="m-0 -mx-1.5 grid list-none gap-0.5 p-0">
              {recent.map((r) => (
                <li key={r.topic}>
                  <button
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-ui-sm outline-none hover:bg-fill-hover focus-visible:focus-ring"
                  >
                    <span className="min-w-0 flex-1 truncate text-text-primary">{r.topic}</span>
                    <span className="font-mono text-mono-sm text-text-tertiary">{r.result}</span>
                    <span className="w-20 shrink-0 text-end text-ui-xs text-text-tertiary">
                      {r.at}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      );
    case "S5":
      return (
        <div className="grid gap-5">
          <GroupsSection helmLease="waiting" helmState="주도 대기" reviewLease="held" />
          <div className="grid gap-3">
            <InquiryHead meta="대기열 1번째" onFull={onFull} />
            <p className="m-0 text-ui-sm font-normal text-text-secondary">
              주도를 {extJ("review", "이", "가")} 쥐고 있어요.
            </p>
            <div>
              <Button size="xs" tone="neutral" variant="soft">
                요청 취소
              </Button>
            </div>
          </div>
        </div>
      );
    case "S6":
      return (
        <div className="grid gap-5">
          <GroupsSection helmLease="none" helmState="상한에서 멈춤" />
          <div className="grid gap-3">
            <InquiryHead onFull={onFull} />
            <PhaseStepper at={3} failed />
            <Alert tone="warning" size="sm">
              자식 에이전트 상한에 걸려 멈췄어요. 수렴과 적용은 하지 않았어요.
            </Alert>
          </div>
          <Section title="발견">
            <FindingList items={findings.slice(0, 2)} />
          </Section>
        </div>
      );
    case "S7":
      return (
        <div className="grid gap-5">
          <GroupsSection helmState="멈추는 중" />
          <div className="grid gap-3">
            <InquiryHead
              meta="같은 오류 3번"
              badge={writeDenied}
              action={
                <Button size="xs" tone="neutral" variant="ghost" disabled>
                  멈추는 중
                </Button>
              }
              onFull={onFull}
            />
            <PhaseStepper at={2} />
            <p className="m-0 text-ui-sm font-normal text-text-secondary">
              다음 경계에서 멈춰요. 실행 중인 렌즈 1개가 끝나길 기다려요.
            </p>
          </div>
          <Section title="렌즈">
            <LensTree lenses={lensesExplore} />
          </Section>
        </div>
      );
    case "S8":
      return (
        <div className="grid gap-5">
          <Section title="이 대화의 그룹">
            <div className="flex items-center gap-2 text-ui-sm">
              <span className="w-16 shrink-0 font-mono text-mono-sm text-text-primary">
                {extName("learning")}
              </span>
              <span className="flex-1 text-text-tertiary">대화 관찰 중</span>
            </div>
          </Section>
          <div className="grid gap-2">
            <h3 className="m-0 text-ui-strong text-text-primary">Helm이 꺼져 있어요</h3>
            <div>
              <Button size="xs" tone="neutral" variant="soft">
                플러그인과 그룹에서 켜기
              </Button>
            </div>
          </div>
        </div>
      );
    case "S9":
      return (
        <div className="grid gap-5" aria-busy>
          <div className="grid gap-2">
            <Skeleton width={112} height={12} />
            <Skeleton width="100%" height={12} />
            <Skeleton width="100%" height={12} />
          </div>
          <div className="grid gap-2">
            <Skeleton width={160} height={16} />
            <Skeleton width="100%" height={28} />
          </div>
          <div className="grid gap-2">
            <Skeleton width={80} height={12} />
            <Skeleton width="100%" height={12} />
            <Skeleton width="83%" height={12} />
            <Skeleton width="66%" height={12} />
          </div>
        </div>
      );
    case "S10":
      return (
        <div className="grid gap-5">
          <Alert tone="warning" size="sm">
            엔진과 연결이 끊겼어요. 마지막으로 받은 상태예요.
          </Alert>
          <div className="pointer-events-none grid gap-5 opacity-50" aria-disabled>
            <GroupsSection />
            <div className="grid gap-3">
              <InquiryHead
                meta="같은 오류 3번"
                action={
                  <Button size="xs" tone="neutral" variant="ghost" disabled>
                    멈춤
                  </Button>
                }
              />
              <PhaseStepper at={2} />
            </div>
            <Section title="렌즈">
              <LensTree lenses={lensesExplore} />
            </Section>
          </div>
        </div>
      );
    case "S12":
      return null;
  }
}

// ── 전체 화면(S12) ──────────────────────────────────────────────
// 스펙은 탐구를 끝 영역 탭으로만 둔다. Helm은 자식 에이전트를 여럿 띄우는 그룹이라 나무·발견·단계 기록을 한눈에 보는 넓은 보기를 더한다.

export function HelmPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className={`flex h-10 flex-none items-center gap-2 px-3 ${BAR_INSET}`}>
        <h1 className="m-0 min-w-0 truncate text-ui-strong text-text-primary">
          탐구 · 캐시 무효화
        </h1>
        <span className="flex-1" />
        {writeDenied}
        <Button size="xs" tone="neutral" variant="ghost">
          멈춤
        </Button>
        <Button size="xs" tone="neutral" variant="ghost" onClick={onBack}>
          대화로
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid gap-6 px-3 pt-1 pb-4 [grid-template-columns:minmax(0,1fr)] min-[1000px]:[grid-template-columns:minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-5">
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-x-2 text-ui-xs text-text-tertiary">
                <span>같은 오류 3번 · 수렴 단계</span>
              </div>
              <PhaseStepper at={3} />
              <Budget turn="2 / 4" spawn="3 / 8" />
            </div>
            <Section title="렌즈와 자식 에이전트">
              <LensTree lenses={lensesDone} />
            </Section>
            <Section title="그룹 전환">
              <Timeline aria-label="단계 경계의 그룹 전환" size="sm">
                <TimelineItem
                  author="agent"
                  running
                  title="수렴 · 발견 4개를 모으는 중"
                  time="지금"
                />
                {[...switches].reverse().map((s, i) => (
                  <TimelineItem
                    key={i}
                    author="system"
                    title={`${s.step} · ${s.text}`}
                    time={s.at}
                  />
                ))}
              </Timeline>
            </Section>
          </div>
          <div className={`grid content-start gap-5 ${BAR_INSET}`}>
            <GroupsSection helmState="수렴 단계" />
            <Section title="발견">
              <FindingList items={findings} />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

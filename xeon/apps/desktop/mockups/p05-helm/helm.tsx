// P-05 탐구(Helm). 오른쪽 well 탭 내용(HelmPanel)과 전체 화면 보기(HelmPage, S12).
// 런타임 관점(브리프 "Framing correction"): 맨 위에 이 대화의 L3 그룹과 drive 임대 보유자를 늘 보이고,
// Helm의 자식 에이전트(렌즈)는 caustic ActivityTree 나무(렌즈 = step, 자식의 도구 호출 = call)로 그린다.
import {
  ActivityTree,
  Alert,
  Badge,
  Button,
  Input,
  ListDescription,
  ListDescriptionRow,
  Progress,
  Skeleton,
  Stepper,
  Timeline,
  TimelineItem,
  type ActivityNode,
  type StepperStep,
} from "@caustic/react";
import type { ReactNode } from "react";
import { ArrowRight, Maximize2, Minimize2, Settings, useShell } from "../_shell";
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

// ── 그룹과 drive 임대 ─────────────────────────────────────────────

function LeaseBadge({ lease }: { lease: ActiveGroup["lease"] }) {
  if (lease === "held")
    return (
      <Badge size="xs" tone="agent">
        drive 보유
      </Badge>
    );
  if (lease === "waiting")
    return (
      <Badge size="xs" tone="neutral">
        drive 대기
      </Badge>
    );
  return null;
}

/** 이 대화에 걸린 L3 그룹. 줄마다 이름, 거는 훅, 지금 상태, drive 임대. */
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
      count={rows.length}
      end={
        <Button size="xs" tone="neutral" variant="ghost" iconStart={<Settings />}>
          그룹
        </Button>
      }
    >
      <ul className="m-0 grid list-none gap-1 p-0">
        {rows.map((g) => (
          <li key={g.id} className="flex min-w-0 items-center gap-2 text-ui-sm">
            <span className="w-16 shrink-0 font-mono text-mono-sm text-text-primary">{g.name}</span>
            <span className="min-w-0 flex-1 truncate text-text-tertiary">
              {g.state}
              <span className="font-mono text-mono-sm"> · {g.hooks.join(" ")}</span>
            </span>
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

function Budget({ turn, spawn, tokens }: { turn: string; spawn: string; tokens: number }) {
  return (
    <ListDescription
      variant="ghost"
      size="xs"
      aria-label="임대와 상한"
      className="rounded-none [--cs-size-list-term:6rem] [&_[data-slot=list-description-row]]:px-0"
    >
      <ListDescriptionRow term="drive 임대">helm 보유 · 턴 경계에서 돌려줘요</ListDescriptionRow>
      <ListDescriptionRow term="턴">
        <span className="tabular-nums">{turn}</span>
      </ListDescriptionRow>
      <ListDescriptionRow term="자식 에이전트">
        <span className="tabular-nums">{spawn}</span>
      </ListDescriptionRow>
      <ListDescriptionRow term="토큰">
        <span className="flex w-full items-center gap-2">
          <Progress size="xs" value={tokens * 100} label="토큰 사용" className="w-24" />
          <span className="tabular-nums">{Math.round(tokens * 400)}k / 400k</span>
        </span>
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
      label: (
        <>
          {l.title} <span className="font-mono text-mono-sm text-text-tertiary">{l.agent}</span>
        </>
      ),
      meta: l.meta,
    },
    ...l.calls.map((c) => ({
      id: c.id,
      kind: "call" as const,
      label: c.label,
      ...(c.meta !== undefined ? { meta: c.meta } : {}),
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
        <span className="truncate">
          출처 {f.sources.length} ·{" "}
          <span className="font-mono">{f.sources.slice(0, 4).join(", ")}</span>
        </span>
        {f.task !== undefined && (
          <button
            type="button"
            onClick={() => shell.openEnd("work")}
            className="rounded-sm text-text-secondary underline-offset-2 outline-none hover:underline focus-visible:focus-ring"
          >
            작업 #{f.task}
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
  meta: ReactNode;
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
          <Button
            size="xs"
            tone="neutral"
            variant="ghost"
            iconStart={full ? <Minimize2 /> : <Maximize2 />}
            onClick={onFull}
          >
            {full ? "대화로" : "크게"}
          </Button>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-xs text-text-tertiary">
        <span className="font-mono">h3k9</span>
        <span>{meta}</span>
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
            <InquiryHead
              meta="신호 stuck · 같은 오류 3번"
              badge={writeDenied}
              action={stop}
              onFull={onFull}
            />
            <PhaseStepper at={2} />
            <Budget turn="1 / 4" spawn="3 / 8" tokens={0.3} />
          </div>
          <Section title="렌즈" count="3 · 실패 1">
            <LensTree lenses={lensesExplore} />
          </Section>
        </div>
      );
    case "S2":
      return (
        <div className="grid gap-5">
          <GroupsSection helmState="수렴 단계" />
          <div className="grid gap-3">
            <InquiryHead meta="신호 stuck · 같은 오류 3번" action={stop} onFull={onFull} />
            <PhaseStepper at={3} />
            <Budget turn="2 / 4" spawn="3 / 8" tokens={0.46} />
          </div>
          <Section title="발견" count={findings.length}>
            <FindingList items={findings} />
          </Section>
          <Section title="렌즈" count="3 · 실패 1">
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
              meta="18분 · 렌즈 3 (실패 1) · 발견 4"
              badge={
                <Badge size="xs" tone="success">
                  적용함
                </Badge>
              }
              onFull={onFull}
            />
            <PhaseStepper at={5} />
            <p className="m-0 text-ui-sm font-normal text-text-secondary">
              ttl을 저장할 때 밀리초로 바꾸고 경계 시각 시험을 더했어요. drive는 review로
              넘어갔어요.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button size="xs" tone="neutral" variant="soft" iconEnd={<ArrowRight />}>
                적용 턴으로
              </Button>
            </div>
          </div>
          <Section title="생긴 작업" count={2}>
            <ul className="m-0 grid list-none gap-1 p-0 text-ui-sm">
              <li className="flex gap-2">
                <span className="tabular-nums text-text-tertiary">#12</span>
                <span className="text-text-primary">TTL 경계 시각 시험 추가</span>
              </li>
              <li className="flex gap-2">
                <span className="tabular-nums text-text-tertiary">#13</span>
                <span className="text-text-primary">시험 시계를 가짜 시계로 바꾸기</span>
              </li>
            </ul>
          </Section>
          <Section title="발견" count={findings.length}>
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
                  placeholder="주제 (비우면 마지막 신호로 정해요)"
                  containerClassName="min-w-0 flex-1"
                  invalid={state === "S11"}
                />
                <Button size="sm" tone="neutral" variant="solid">
                  시작
                </Button>
              </div>
              {state === "S11" && (
                <p role="alert" className="m-0 text-ui-xs text-danger-text">
                  탐구 상태를 저장하지 못했어요 (state_write). 다시 시도해 주세요.
                </p>
              )}
            </div>
          </Section>
          <Section title="최근 탐구" count={recent.length}>
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
          <GroupsSection helmLease="waiting" helmState="임대 대기" reviewLease="held" />
          <div className="grid gap-3">
            <InquiryHead meta="대기열 1번째" onFull={onFull} />
            <p className="m-0 text-ui-sm font-normal text-text-secondary">
              drive 임대를 review가 쥐고 있어요. review가 단계 경계에서 놓으면 바로 시작해요.
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
            <InquiryHead
              meta="렌즈 3 · 발견 2"
              badge={
                <Badge size="xs" tone="warning">
                  상한 도달
                </Badge>
              }
              onFull={onFull}
            />
            <PhaseStepper at={3} failed />
            <Alert tone="warning" size="sm">
              자식 에이전트 상한(8/8)에 걸려 멈췄어요. 수렴과 적용은 하지 않았어요.
            </Alert>
          </div>
          <Section title="발견" count={2}>
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
              meta="신호 stuck · 같은 오류 3번"
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
              다음 drive 경계에서 멈춰요. 실행 중인 렌즈 1개가 끝나길 기다려요.
            </p>
          </div>
          <Section title="렌즈" count="3 · 실패 1">
            <LensTree lenses={lensesExplore} />
          </Section>
        </div>
      );
    case "S8":
      return (
        <div className="grid gap-5">
          <Section title="이 대화의 그룹" count={1}>
            <div className="flex items-center gap-2 text-ui-sm">
              <span className="w-16 shrink-0 font-mono text-mono-sm text-text-primary">
                learning
              </span>
              <span className="flex-1 text-text-tertiary">
                세션 관찰 중<span className="font-mono text-mono-sm"> · post</span>
              </span>
            </div>
          </Section>
          <div className="grid gap-2">
            <h3 className="m-0 text-ui-strong text-text-primary">Helm이 꺼져 있어요</h3>
            <p className="m-0 text-ui-sm font-normal text-text-secondary">
              켜면 같은 오류가 반복될 때 탐구를 제안해요.
            </p>
            <div>
              <Button size="xs" tone="neutral" variant="soft" iconEnd={<ArrowRight />}>
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
                meta="신호 stuck · 같은 오류 3번"
                action={
                  <Button size="xs" tone="neutral" variant="ghost" disabled>
                    멈춤
                  </Button>
                }
              />
              <PhaseStepper at={2} />
            </div>
            <Section title="렌즈" count="3 · 실패 1">
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
// 스펙은 탐구를 끝 영역 탭으로만 둔다. Helm은 자식 에이전트를 여럿 띄우는 그룹이라 나무·발견·그룹 전환을 한눈에 보는 넓은 보기를 더한다.

export function HelmPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-10 flex-none items-center gap-2 px-3">
        <h1 className="m-0 min-w-0 truncate text-ui-strong text-text-primary">
          탐구 · 캐시 무효화
        </h1>
        <span className="truncate text-ui-sm text-text-tertiary">캐시 무효화 조사</span>
        <span className="flex-1" />
        {writeDenied}
        <Button size="xs" tone="neutral" variant="ghost">
          멈춤
        </Button>
        <Button size="xs" tone="neutral" variant="ghost" iconStart={<Minimize2 />} onClick={onBack}>
          대화로
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid gap-6 px-3 pt-1 pb-4 [grid-template-columns:minmax(0,1fr)] min-[1000px]:[grid-template-columns:minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-5">
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-x-2 text-ui-xs text-text-tertiary">
                <span className="font-mono">h3k9</span>
                <span>신호 stuck · 같은 오류 3번 · 수렴 단계</span>
              </div>
              <PhaseStepper at={3} />
              <Budget turn="2 / 4" spawn="3 / 8" tokens={0.46} />
            </div>
            <Section title="렌즈와 자식 에이전트" count="3 · 실패 1">
              <LensTree lenses={lensesDone} />
            </Section>
            <Section title="그룹 전환" count={switches.length + 1}>
              <Timeline aria-label="단계 경계의 그룹 전환" size="sm">
                <TimelineItem
                  author="agent"
                  running
                  title="수렴 · 발견 4개를 모으는 중"
                  detail="helm"
                  time="지금"
                />
                {[...switches].reverse().map((s, i) => (
                  <TimelineItem
                    key={i}
                    author="system"
                    title={`${s.step} · ${s.text}`}
                    detail={s.detail ?? "helm"}
                    time={s.at}
                  />
                ))}
              </Timeline>
            </Section>
          </div>
          <div className="grid content-start gap-5">
            <GroupsSection helmState="수렴 단계" />
            <Section title="발견" count={findings.length}>
              <FindingList items={findings} />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

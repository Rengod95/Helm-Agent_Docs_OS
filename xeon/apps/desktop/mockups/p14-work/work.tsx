// P-14 목표와 작업: 대화 화면 오른쪽 well "작업" 탭 내용. 목표(조건, 상태, 판정 기록), 계획, 작업 목록.
// 목표는 턴 끝에 판정 모델을 돌려 미충족이면 다음 턴을 잇는 장치라, 판정 기록을 보인다.
import {
  Badge,
  Button,
  Field,
  Input,
  Plan,
  Select,
  SelectOption,
  Skeleton,
  Timeline,
  TimelineItem,
  type PlanStep,
} from "@caustic/react";
import { useState, type ReactNode } from "react";
import { ChevronRight } from "../_shell";

export type WorkState = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7";

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
    <section aria-label={title} className="grid gap-1.5">
      <div className="flex min-h-6 items-center gap-1.5">
        <h3 className="m-0 flex flex-1 items-baseline gap-1.5 text-ui-sm font-semibold text-text-primary">
          {title}
        </h3>
        {end}
      </div>
      {children}
    </section>
  );
}

interface Judgement {
  n: number;
  met: boolean | "failed" | "running";
  reason: string;
  missing?: string;
  at: string;
}

const history: Record<"active" | "met" | "limit" | "failed", Judgement[]> = {
  active: [
    {
      n: 2,
      met: false,
      reason: "단위 테스트는 통과, e2e 2개 실패",
      missing: "e2e cache-expiry, e2e warm-start",
      at: "3분 전",
    },
    {
      n: 1,
      met: false,
      reason: "cache.test.ts 1개 실패",
      missing: "expires after ttl",
      at: "12분 전",
    },
  ],
  met: [
    { n: 3, met: true, reason: "bun test 312개 모두 통과", at: "방금" },
    { n: 2, met: false, reason: "단위 테스트는 통과, e2e 2개 실패", at: "9분 전" },
    { n: 1, met: false, reason: "cache.test.ts 1개 실패", at: "18분 전" },
  ],
  limit: [
    { n: 3, met: false, reason: "e2e warm-start 1개 실패", missing: "e2e warm-start", at: "방금" },
    { n: 2, met: false, reason: "e2e 2개 실패", at: "9분 전" },
    { n: 1, met: false, reason: "cache.test.ts 1개 실패", at: "18분 전" },
  ],
  failed: [
    { n: 3, met: "failed", reason: "판정 모델이 응답하지 않았어요", at: "방금" },
    { n: 2, met: false, reason: "e2e 2개 실패", at: "9분 전" },
    { n: 1, met: false, reason: "cache.test.ts 1개 실패", at: "18분 전" },
  ],
};

function JudgeHistory({ items, running = false }: { items: Judgement[]; running?: boolean }) {
  return (
    <Timeline aria-label="판정 기록" size="sm">
      {running && <TimelineItem author="agent" running title="턴 9 진행 중" time="지금" />}
      {items.map((j) => (
        <TimelineItem
          key={j.n}
          author="system"
          title={`판정 ${j.n} · ${j.met === true ? "충족" : j.met === "failed" ? "판정 실패" : "미충족"}`}
          detail={j.missing !== undefined ? `${j.reason} · 빠진 것: ${j.missing}` : j.reason}
          time={j.at}
        />
      ))}
    </Timeline>
  );
}

const STATUS = {
  active: { word: "진행 중", tone: "info" },
  met: { word: "충족", tone: "success" },
  limit: { word: "상한 도달", tone: "warning" },
  failed: { word: "판정 실패", tone: "danger" },
} as const;

function Goal({ kind }: { kind: keyof typeof STATUS }) {
  const s = STATUS[kind];
  const settled = kind !== "active";
  const n = kind === "active" ? 2 : 3;
  return (
    <Section
      title="목표"
      end={
        settled ? (
          <Button size="xs" variant="ghost">
            다시 걸기
          </Button>
        ) : (
          <Button size="xs" variant="ghost">
            해제
          </Button>
        )
      }
    >
      <div className="grid gap-1">
        <p className="m-0 text-ui-strong text-text-primary">테스트가 모두 통과한다</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-xs text-text-tertiary">
          <Badge size="xs" tone={s.tone}>
            {s.word}
          </Badge>
          <span className="tabular-nums">판정 {n} / 3</span>
        </div>
      </div>
      <JudgeHistory items={history[kind]} running={kind === "active"} />
    </Section>
  );
}

function PlanRef({ approved = true }: { approved?: boolean }) {
  return (
    <Section title="계획">
      <div className="-mx-1.5 flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-ui-sm hover:bg-fill-hover">
        <span className="min-w-0 flex-1 truncate text-text-primary">캐시 만료 단위 통일</span>
        <Badge size="xs" tone={approved ? "success" : "neutral"}>
          {approved ? "승인됨" : "초안"}
        </Badge>
        <Button size="xs" variant="ghost">
          보기
        </Button>
      </div>
    </Section>
  );
}

const tasksActive: PlanStep[] = [
  { id: "t1", label: "만료 비교 단위 통일", status: "done" },
  { id: "t2", label: "TTL 경계 시각 테스트 추가", status: "now", detail: "탐구에서" },
  { id: "t3", label: "테스트 시계를 가짜 시계로 바꾸기", status: "todo", detail: "탐구에서" },
  { id: "t4", label: "캐시 문서 고치기", status: "todo", detail: "막힘" },
  { id: "t5", label: "회귀 확인", status: "done" },
];
const tasksDone: PlanStep[] = tasksActive.map((t) => ({ ...t, status: "done" }));
const tasksLimit: PlanStep[] = tasksActive.map((t) =>
  t.id === "t2" ? { ...t, status: "failed", detail: "e2e warm-start 실패" } : t,
);

const statusLabels = { done: "끝남", now: "진행 중", todo: "남음", failed: "실패" };

function Tasks({ steps, title = "작업" }: { steps: PlanStep[]; title?: string }) {
  return (
    // 개수 글은 뺀다(caustic Plan은 countLabel이 필수라 빈 글을 준다).
    <Plan title={title} steps={steps} countLabel={() => ""} statusLabels={statusLabels} />
  );
}

function LongTasks() {
  const [open, setOpen] = useState(false);
  const remaining: PlanStep[] = [
    { id: "r1", label: "warm-start 경로 캐시 키 정리", status: "now" },
    { id: "r2", label: "만료 이벤트 로그 줄이기", status: "todo" },
    { id: "r3", label: "벤치마크 다시 재기", status: "todo" },
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `r${i + 4}`,
      label: `패키지 ${i + 1} 테스트 이전`,
      status: "todo" as const,
    })),
  ];
  return (
    <div className="grid gap-1.5">
      <Tasks steps={remaining} title="작업 · 남은 것" />
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="-mx-1.5 flex items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left text-ui-sm text-text-secondary outline-none hover:bg-fill-hover focus-visible:focus-ring"
      >
        <ChevronRight aria-hidden className={`size-icon-sm ${open ? "rotate-90" : ""}`} />
        끝난 작업
      </button>
    </div>
  );
}

export function WorkPanel({ state }: { state: WorkState }) {
  switch (state) {
    case "S1":
      return (
        <div className="grid gap-5">
          <Goal kind="active" />
          <PlanRef />
          <Tasks steps={tasksActive} />
        </div>
      );
    case "S2":
      return (
        <div className="grid gap-5">
          <Goal kind="met" />
          <PlanRef />
          <Tasks steps={tasksDone} />
        </div>
      );
    case "S3":
      return (
        <div className="grid gap-5">
          <Goal kind="limit" />
          <PlanRef />
          <Tasks steps={tasksLimit} />
        </div>
      );
    case "S4":
      return (
        <div className="grid gap-5">
          <Goal kind="failed" />
          <PlanRef />
          <Tasks steps={tasksActive} />
        </div>
      );
    case "S5":
      return (
        <div className="grid gap-5">
          <Section title="목표">
            <div className="grid gap-2.5">
              <Field label="조건" size="sm">
                <Input size="sm" placeholder="예: 테스트가 모두 통과한다" />
              </Field>
              <div className="flex gap-2">
                <Field label="판정 모델" size="sm" className="min-w-0 flex-1">
                  <Select size="sm" defaultValue="sonnet-5-5" aria-label="판정 모델">
                    <SelectOption value="sonnet-5-5">sonnet-5-5</SelectOption>
                    <SelectOption value="haiku-5-5">haiku-5-5</SelectOption>
                  </Select>
                </Field>
                <Field label="최대 판정" size="sm" className="w-24">
                  <Input size="sm" defaultValue="3" inputMode="numeric" />
                </Field>
              </div>
              <div>
                <Button size="sm" variant="solid">
                  목표 걸기
                </Button>
              </div>
            </div>
          </Section>
          <Section title="계획과 작업">
            <p className="m-0 text-ui-sm font-normal text-text-tertiary">
              이 대화에는 아직 없어요.
            </p>
          </Section>
        </div>
      );
    case "S6":
      return (
        <div className="grid gap-5" aria-busy>
          <div className="grid gap-2">
            <Skeleton width={64} height={12} />
            <Skeleton width="80%" height={16} />
            <Skeleton width="100%" height={12} />
            <Skeleton width="100%" height={12} />
          </div>
          <div className="grid gap-2">
            <Skeleton width={64} height={12} />
            <Skeleton width="100%" height={28} />
          </div>
          <div className="grid gap-2">
            <Skeleton width={64} height={12} />
            <Skeleton width="90%" height={12} />
            <Skeleton width="70%" height={12} />
            <Skeleton width="80%" height={12} />
          </div>
        </div>
      );
    case "S7":
      return (
        <div className="grid gap-5">
          <Goal kind="active" />
          <PlanRef />
          <LongTasks />
        </div>
      );
  }
}

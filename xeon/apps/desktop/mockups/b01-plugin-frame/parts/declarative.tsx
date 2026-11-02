// 기본 부품 화면(declarative) 트리들. 렌더러는 그리지 않고, 블록마다 "widget:" 주석으로 렌더러가 낼 위젯 카탈로그 v1 이름을 적는다
// (ADR-0021 §3.4.1). 플러그인은 색·간격을 정하지 않으므로 여기 간격은 렌더러 기본값(Stack, Section)을 흉내 낸 것이다.
// - BoardFallback: taskflow/board의 fallback 트리(프레임이 막혔을 때). 그래프와 끌기 없이 목록과 단추만.
// - HelmTree: helm/inquiry(wb-opus W4를 줄인 것). N-20 남은 상태(오프라인 흐림, 긴 내용 자름)를 받는다.
import { Badge, Button, Progress, Stepper } from "@caustic/react";
import { helmInquiry, T } from "../../_shell";
import { SectionTitle } from "../../wb-opus/parts/ext-bits";
import { LensTree } from "../../wb-opus/parts/lens-tree";
import { colLabel, type Task, type TaskCol } from "../data";

const COLS: TaskCol[] = ["doing", "todo", "done"];

export function BoardFallback({
  tasks,
  locked = false,
  onMove,
}: {
  tasks: Task[];
  locked?: boolean;
  onMove: (id: string) => void;
}) {
  return (
    // widget: Stack
    <div className="grid gap-5">
      {/* widget: Row — Text(주제), Text(요약) */}
      <div className="flex flex-wrap items-baseline gap-x-3 text-ui-dense">
        <span className="font-medium text-text-primary">캐시 무효화 조사</span>
        <span className="text-text-tertiary">
          작업 {tasks.length} · 대기 {tasks.filter((t) => t.col === "todo").length}
        </span>
      </div>
      {COLS.map((c) => (
        // widget: Section(Heading h2) + List(each /tasks[col]) — Text, Text, Button(call ext.taskflow.move)
        <section key={c} aria-label={colLabel[c]} className="grid gap-1">
          <SectionTitle end={`${tasks.filter((t) => t.col === c).length}개`}>
            {colLabel[c]}
          </SectionTitle>
          <ul className="m-0 grid max-w-[40rem] list-none gap-1 p-0">
            {tasks
              .filter((t) => t.col === c)
              .map((t) => (
                <li
                  key={t.id}
                  className="grid min-h-7 grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2 text-ui-dense"
                >
                  <span className="font-mono text-mono-sm text-text-tertiary">{t.id}</span>
                  <span className="truncate text-text-primary">
                    {t.title}
                    {t.after !== undefined && (
                      <span className="text-text-tertiary"> · {t.after} 다음</span>
                    )}
                  </span>
                  {c === "todo" ? (
                    <Button
                      size="xs"
                      tone="neutral"
                      variant="ghost"
                      disabled={locked}
                      onClick={() => onMove(t.id)}
                    >
                      진행으로
                    </Button>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const conf = {
  high: { label: "높음", tone: "success" },
  med: { label: "보통", tone: "warning" },
  low: { label: "낮음", tone: "neutral" },
} as const;

/** helm/inquiry 트리. offline이면 마지막 값을 흐리게, 동작 잠금(§3.7). truncated면 발견 목록을 상한에서 자른다(§3.4 크기 상한). */
export function HelmTree({
  offline = false,
  truncated = false,
}: {
  offline?: boolean;
  truncated?: boolean;
}) {
  const q = helmInquiry;
  const findings = truncated
    ? Array.from({ length: 6 }, (_, i) => q.findings[i % q.findings.length]).filter(
        (f) => f !== undefined,
      )
    : q.findings;
  return (
    // widget: Stack
    <div className={`grid gap-6 ${offline ? "opacity-60" : ""}`} aria-disabled={offline}>
      {/* widget: Row — Text(주제), Text(신호), Button(call ext.helm.stop) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ui-dense">
        <span>
          <span className="text-text-tertiary">주제 </span>
          <span className="font-medium text-text-primary">{q.topic}</span>
        </span>
        <span className="text-text-secondary">
          {q.signal.kind} · {q.signal.text}
        </span>
        <Button size="xs" tone="neutral" variant="outline" className="ms-auto" disabled={offline}>
          멈춤
        </Button>
      </div>
      {/* widget: Stepper(bind /phase) */}
      <Stepper
        size="xs"
        variant="ghost"
        className="max-w-[36rem]"
        value={1}
        aria-label={`${T.inquiry} ${T.step}`}
        statusLabels={{ done: "끝남", now: "지금", todo: "남음", failed: "실패" }}
        steps={[
          { id: "diverge", label: "확산", status: "done" },
          { id: "explore", label: "탐색", status: "now", description: `${T.lens} 3 · 1 실행 중` },
          { id: "converge", label: "수렴", status: "todo" },
          { id: "apply", label: "적용", status: "todo" },
        ]}
      />
      {/* widget: Split */}
      <div className="grid gap-6 medium:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-label={T.lens} className="grid content-start gap-1">
          <SectionTitle end={`${T.childAgent} 3`}>{T.lens}</SectionTitle>
          <LensTree lenses={q.lenses} defaultOpen={offline ? [] : ["failure-cases"]} />
        </section>
        <section aria-label={T.finding} className="grid content-start gap-1">
          <SectionTitle end={truncated ? "1,240개 중 500개" : `${q.findings.length}개`}>
            {T.finding}
          </SectionTitle>
          <ul className="m-0 grid list-none gap-2 p-0">
            {findings.map((f, i) => (
              <li
                key={`${f.claim}-${i}`}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2"
              >
                <Badge size="sm" tone={conf[f.confidence].tone}>
                  {conf[f.confidence].label}
                </Badge>
                <span className="truncate text-ui-dense text-text-primary">{f.claim}</span>
              </li>
            ))}
          </ul>
          {truncated && (
            // 셸이 상한을 넘는 노드를 자른 자리(§3.4: events 500행). 렌더러 글자 단계로 한 줄.
            <p className="m-0 pt-1 text-ui-xs text-text-tertiary">
              긴 내용이라 앞 500개만 보여요 · 나머지는 확장이 나눠 보내야 해요
            </p>
          )}
        </section>
      </div>
      {/* widget: Section + Meter ×2 (Meter 빈틈 C-05 → Progress) */}
      <section aria-label={`${T.lead}와 토큰`} className="grid gap-1.5">
        <SectionTitle>{`${T.lead}와 토큰`}</SectionTitle>
        <div className="grid max-w-[32rem] grid-cols-[4rem_minmax(0,1fr)_6rem] items-center gap-x-3 gap-y-1.5 text-ui-dense">
          <span className="text-text-tertiary">{T.turn}</span>
          <Progress value={25} size="xs" label={`${T.turn} 1/4`} />
          <span className="tabular-nums text-text-secondary">1 / 4</span>
          <span className="text-text-tertiary">토큰</span>
          <Progress value={30} size="xs" label="토큰 120k/400k" />
          <span className="tabular-nums text-text-secondary">120k / 400k</span>
        </div>
      </section>
    </div>
  );
}

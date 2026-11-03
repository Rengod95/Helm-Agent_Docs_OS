// 자세히 보기의 가운데: 한 턴의 생명선. 순간 14개를 세로로 놓고 이 플러그인이 끼어드는 순간만 펼친다.
// 그룹은 구성원마다 열 하나를 같은 생명선에 놓아 구성원 사이 손 넘김이 보이게 한다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { PHASES } from "@fresnel/client/workbench/canvas";
import { Alert, Chip, Tooltip, type ChipProps } from "@caustic/react";
import type { ReactNode } from "react";
import {
  MOMENTS,
  TOOL_RUN,
  activeMoments,
  timeLabel,
  type Column,
  type Hand,
  type Moment,
  type Part,
  type Phase,
  type RunMark,
  type RunMarks,
  type RunOutcome,
  type RunResult,
  type ValueKind,
  type Verb,
} from "./turn-flow.ts";

const LABEL = "text-footnote text-text-tertiary";

const PHASE_LABEL: Record<Phase, MessageId> = {
  start: "desktop.craft.detail.phase.start",
  think: "desktop.craft.detail.phase.think",
  act: "desktop.craft.detail.phase.act",
  wrap: "desktop.craft.detail.phase.wrap",
};

// 순간 이름은 훅마다 하나씩 있다. 표에 없는 id(없어야 한다)는 "알 수 없는 순간"으로 보인다.
const MOMENT_LABEL: ReadonlyMap<string, MessageId> = new Map<string, MessageId>([
  ["thread.start", "desktop.craft.detail.moment.thread.start"],
  ["input.user.before", "desktop.craft.detail.moment.input.user.before"],
  ["input.agent.before", "desktop.craft.detail.moment.input.agent.before"],
  ["thread.compact.before", "desktop.craft.detail.moment.thread.compact.before"],
  ["request.provider.before", "desktop.craft.detail.moment.request.provider.before"],
  ["guard.model.before", "desktop.craft.detail.moment.guard.model.before"],
  ["request.model.after", "desktop.craft.detail.moment.request.model.after"],
  ["tool.call.before", "desktop.craft.detail.moment.tool.call.before"],
  [TOOL_RUN, "desktop.craft.detail.moment.tool.run"],
  ["tool.result", "desktop.craft.detail.moment.tool.result"],
  ["tool.execution.after", "desktop.craft.detail.moment.tool.execution.after"],
  ["boundary.step.after", "desktop.craft.detail.moment.boundary.step.after"],
  ["boundary.settle.after", "desktop.craft.detail.moment.boundary.settle.after"],
  ["thread.shutdown", "desktop.craft.detail.moment.thread.shutdown"],
]);

const VALUE_LABEL: Record<ValueKind, MessageId> = {
  thread: "desktop.craft.detail.value.thread",
  "user-input": "desktop.craft.detail.value.userInput",
  "agent-input": "desktop.craft.detail.value.agentInput",
  history: "desktop.craft.detail.value.history",
  "model-request": "desktop.craft.detail.value.modelRequest",
  "model-response": "desktop.craft.detail.value.modelResponse",
  "tool-call": "desktop.craft.detail.value.toolCall",
  "tool-result": "desktop.craft.detail.value.toolResult",
  step: "desktop.craft.detail.value.step",
  turn: "desktop.craft.detail.value.turn",
};

const VERB_LABEL: Record<Verb, MessageId> = {
  observe: "desktop.craft.detail.verb.observe",
  modify: "desktop.craft.detail.verb.modify",
  block: "desktop.craft.detail.verb.block",
  merge: "desktop.craft.detail.verb.merge",
  call: "desktop.craft.detail.verb.call",
};

/** 한 줄 설명. 도구 실행(불려 나옴)은 설명이 없다 */
const VERB_TIP: Record<Verb, MessageId | null> = {
  observe: "desktop.craft.detail.verb.tip.observe",
  modify: "desktop.craft.detail.verb.tip.modify",
  block: "desktop.craft.detail.verb.tip.block",
  merge: "desktop.craft.detail.verb.tip.merge",
  call: null,
};

const HAND_LABEL: Record<Hand, MessageId> = {
  unchanged: "desktop.craft.detail.hand.unchanged",
  modified: "desktop.craft.detail.hand.modified",
  decision: "desktop.craft.detail.hand.decision",
  merged: "desktop.craft.detail.hand.merged",
  result: "desktop.craft.detail.hand.result",
};

// [미결] "고침"(changed)은 wire 결과에 없어 목록에 넣지 않는다(turn-flow의 outcomeOf 참고).
const OUTCOME_LABEL: Record<RunOutcome, MessageId> = {
  passed: "desktop.craft.detail.outcome.passed",
  failed: "desktop.craft.detail.outcome.failed",
  blocked: "desktop.craft.detail.outcome.blocked",
  skipped: "desktop.craft.detail.outcome.skipped",
};

// 결과 칩: 실패만 위험 색, 막음은 잉크 채움, 나머지는 중립. 색만으로 구분하지 않도록 글자가 늘 함께 나온다.
const OUTCOME_CHIP = {
  passed: { variant: "outline", tone: "neutral" },
  failed: { variant: "soft", tone: "danger" },
  blocked: { variant: "solid", tone: "neutral" },
  skipped: { variant: "dashed", tone: "neutral" },
} satisfies Record<RunOutcome, Pick<ChipProps, "variant" | "tone">>;

/** 실패 이유 한 줄. wire 결과에 이유 글이 없어서 결과 종류로 고른다 */
const RESULT_REASON: Record<RunResult, MessageId | null> = {
  ok: null,
  error: "desktop.craft.detail.reason.error",
  over_budget: "desktop.craft.detail.reason.overBudget",
  denied: null,
  skipped: null,
};

const railOf = (grouped: boolean): string => (grouped ? "9.5rem" : "13rem");

function momentText(id: string): string {
  const key = MOMENT_LABEL.get(id);
  return t(key ?? "desktop.craft.detail.moment.unknown");
}

function VerbChip({ verb }: { readonly verb: Verb }): ReactNode {
  const chip = (
    <Chip size="sm" variant={verb === "merge" ? "dashed" : "outline"}>
      {t(VERB_LABEL[verb])}
    </Chip>
  );
  const tip = VERB_TIP[verb];
  if (tip === null) return chip;
  return (
    <Tooltip content={t(tip)} side="top" delayDuration={300}>
      {chip}
    </Tooltip>
  );
}

function MarkLine({ mark }: { readonly mark: RunMark }): ReactNode {
  const time = timeLabel(mark.ms);
  const reason = RESULT_REASON[mark.result];
  return (
    <div className="grid gap-1.5 border-t border-border-subtle pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-mono-sm text-text-tertiary">
          {t("desktop.craft.detail.time.s", { n: mark.sec.toFixed(1) })}
        </span>
        <span className="font-mono text-mono-sm text-text-secondary">
          {t(time.unit === "ms" ? "desktop.craft.detail.time.ms" : "desktop.craft.detail.time.s", {
            n: time.n,
          })}
        </span>
        <Chip size="sm" className="ms-auto" {...OUTCOME_CHIP[mark.outcome]}>
          {t(OUTCOME_LABEL[mark.outcome])}
        </Chip>
      </div>
      {mark.outcome === "failed" && reason !== null && (
        <Alert tone="danger" size="sm" radius="lg">
          {t(reason)}
        </Alert>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="grid content-start gap-0.5">
      <dt className={LABEL}>{label}</dt>
      <dd className="m-0 text-body text-text-primary">{children}</dd>
    </div>
  );
}

/** 한 순간에서 한 플러그인이 하는 일. 기록이 있으면(최근 실행) 걸린 시간과 결과를 얹는다 */
function StepCard({
  part,
  nameOf,
  marks,
}: {
  readonly part: Part;
  readonly nameOf: (id: string) => string;
  /** 최근 실행이면 이 순간의 기록(없으면 빈 목록). 예시 흐름이면 null */
  readonly marks: readonly RunMark[] | null;
}): ReactNode {
  return (
    <div className="grid gap-2 rounded-lg border border-border-default bg-surface-base px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <VerbChip verb={part.verb} />
        {part.from !== null && (
          <Chip size="sm" tone="info" variant="soft">
            {t("desktop.craft.detail.card.prev", { name: nameOf(part.from) })}
          </Chip>
        )}
        {part.to !== null && (
          <Chip size="sm" tone="info" variant="soft">
            {t("desktop.craft.detail.card.next", { name: nameOf(part.to) })}
          </Chip>
        )}
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-4">
        <Field label={t("desktop.craft.detail.card.gets")}>{t(VALUE_LABEL[part.gets])}</Field>
        <Field label={t("desktop.craft.detail.card.hands")}>{t(HAND_LABEL[part.hands])}</Field>
      </dl>
      {marks !== null && <Marks marks={marks} />}
    </div>
  );
}

function Marks({ marks }: { readonly marks: readonly RunMark[] }): ReactNode {
  if (marks.length === 0) {
    return <span className={LABEL}>{t("desktop.craft.detail.run.noRecord")}</span>;
  }
  return (
    <div className="grid gap-1.5">
      {marks.map((mark, i) => (
        <MarkLine key={`${String(i)}:${String(mark.sec)}`} mark={mark} />
      ))}
    </div>
  );
}

/** 이 순간에 기록은 있는데 구조상 끼는 줄이 없는 칸. 기록을 그대로 보인다 */
function RecordOnly({ marks }: { readonly marks: readonly RunMark[] }): ReactNode {
  return (
    <div className="grid gap-2 rounded-lg border border-dashed border-border-default bg-surface-base px-3 py-2.5">
      <Marks marks={marks} />
    </div>
  );
}

interface Row {
  readonly moment: Moment;
  readonly active: boolean;
}

export interface LifelineProps {
  readonly columns: readonly Column[];
  /** 대상이 그룹이면 참: 열마다 구성원 이름 머리글을 단다 */
  readonly grouped: boolean;
  readonly nameOf: (id: string) => string;
  /** 최근 실행이면 플러그인 id → 훅별 기록. 예시 흐름이면 null */
  readonly marks: ReadonlyMap<string, RunMarks> | null;
}

/** 펼칠 순간: 열 중 하나라도 끼는 순간, 그리고 기록이 남은 생명선 순간 */
function activeOf(
  columns: readonly Column[],
  marks: ReadonlyMap<string, RunMarks> | null,
): ReadonlySet<string> {
  const out = new Set(activeMoments(columns));
  if (marks === null) return out;
  for (const byHook of marks.values()) {
    for (const hook of byHook.keys()) {
      if (MOMENTS.some((m) => m.id === hook)) out.add(hook);
    }
  }
  return out;
}

/** 생명선 밖 훅 한 줄: 열 하나가 건 훅(또는 기록이 남은 훅) */
interface OffRow {
  readonly plugin: string;
  readonly hook: string;
  readonly verb: Verb | null;
}

function offRowsOf(
  columns: readonly Column[],
  marks: ReadonlyMap<string, RunMarks> | null,
): OffRow[] {
  const rows: OffRow[] = [];
  for (const c of columns) {
    const declared = new Map(c.offTurn.map((o) => [o.hook, o.verb] as const));
    const recorded = marks?.get(c.plugin.id);
    const hooks = new Set([...declared.keys(), ...(recorded?.keys() ?? [])]);
    for (const hook of hooks) {
      if (MOMENTS.some((m) => m.id === hook)) continue;
      rows.push({ plugin: c.plugin.id, hook, verb: declared.get(hook) ?? null });
    }
  }
  return rows;
}

function MomentRow({
  row,
  columns,
  grouped,
  nameOf,
  marks,
}: {
  readonly row: Row;
  readonly columns: readonly Column[];
  readonly grouped: boolean;
  readonly nameOf: (id: string) => string;
  readonly marks: ReadonlyMap<string, RunMarks> | null;
}): ReactNode {
  const id = row.moment.id;
  const line = (
    <span aria-hidden className="absolute bottom-0 left-[3.1rem] top-0 w-px bg-border-default" />
  );
  if (!row.active) {
    return (
      <div className="relative flex h-6 scroll-mt-14 items-center gap-2" data-moment={id}>
        {line}
        <span className="w-10 flex-none" />
        <span aria-hidden className="z-10 h-px w-3 flex-none bg-border-strong" />
        <span className="truncate text-footnote text-text-tertiary">{momentText(id)}</span>
      </div>
    );
  }
  return (
    <div
      className="relative grid scroll-mt-14 gap-x-3 py-2"
      style={{
        gridTemplateColumns: `${railOf(grouped)} repeat(${String(columns.length)}, minmax(0,1fr))`,
      }}
      data-moment={id}
    >
      {line}
      <div className="relative flex items-start gap-2 pt-2.5">
        <span className="w-10 flex-none" />
        <span
          aria-hidden
          className="z-10 mt-1 size-2.5 flex-none rounded-full bg-text-primary ring-4 ring-surface-base"
        />
        <div className="grid min-w-0 gap-0.5">
          <span className="text-ui-strong text-text-primary">{momentText(id)}</span>
          <span className="font-mono text-mono-sm text-text-tertiary [overflow-wrap:anywhere]">
            {id}
          </span>
        </div>
      </div>
      {columns.map((c) => {
        const part = c.moments.find((p) => p.moment === id);
        const recs = marks?.get(c.plugin.id)?.get(id);
        if (part !== undefined) {
          return (
            <StepCard
              key={c.plugin.id}
              part={part}
              nameOf={nameOf}
              marks={marks === null ? null : (recs ?? [])}
            />
          );
        }
        if (recs !== undefined) return <RecordOnly key={c.plugin.id} marks={recs} />;
        return (
          <div key={c.plugin.id} aria-hidden className="relative">
            <span className="absolute inset-y-0 left-1/2 w-px border-l border-dashed border-border-default" />
          </div>
        );
      })}
    </div>
  );
}

export function Lifeline({ columns, grouped, nameOf, marks }: LifelineProps): ReactNode {
  const active = activeOf(columns, marks);
  const off = offRowsOf(columns, marks);
  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
      {grouped && (
        <div
          className="sticky top-0 z-10 grid gap-x-3 bg-surface-base pb-2"
          style={{
            gridTemplateColumns: `${railOf(grouped)} repeat(${String(columns.length)}, minmax(0,1fr))`,
          }}
        >
          <span />
          {columns.map((c) => (
            <div key={c.plugin.id} className="min-w-0">
              <Chip size="md" tone="info" variant="soft" className="max-w-full">
                <span className="min-w-0 truncate">{c.plugin.name}</span>
              </Chip>
            </div>
          ))}
        </div>
      )}
      {PHASES.map((phase) => (
        <div key={phase}>
          <div className="ps-[3.4rem] flex items-center gap-3 pb-0.5 pt-3 text-footnote text-text-tertiary">
            {t(PHASE_LABEL[phase])}
            <span aria-hidden className="h-px flex-1 bg-border-subtle" />
          </div>
          {MOMENTS.filter((m) => m.phase === phase).map((m) => (
            <MomentRow
              key={m.id}
              row={{ moment: m, active: active.has(m.id) }}
              columns={columns}
              grouped={grouped}
              nameOf={nameOf}
              marks={marks}
            />
          ))}
        </div>
      ))}
      {off.length > 0 && (
        <div>
          <div className="ps-[3.4rem] flex items-center gap-3 pb-0.5 pt-3 text-footnote text-text-tertiary">
            {t("desktop.craft.detail.flow.offTurn")}
            <span aria-hidden className="h-px flex-1 bg-border-subtle" />
          </div>
          <div className="grid gap-2 py-2">
            {off.map((o) => {
              const recs = marks?.get(o.plugin)?.get(o.hook);
              return (
                <div
                  key={`${o.plugin}:${o.hook}`}
                  className="grid gap-2 rounded-lg border border-border-default bg-surface-base px-3 py-2.5"
                  data-moment={o.hook}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-mono-sm text-text-secondary">{o.hook}</span>
                    {o.verb !== null && <VerbChip verb={o.verb} />}
                    {grouped && (
                      <Chip size="sm" tone="info" variant="soft">
                        {nameOf(o.plugin)}
                      </Chip>
                    )}
                  </div>
                  {recs !== undefined && <Marks marks={recs} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

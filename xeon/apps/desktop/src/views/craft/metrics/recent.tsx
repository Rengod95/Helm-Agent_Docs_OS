// 최근 턴: 인사이트가 없어도 턴 하나를 골라 트레이스를 여는 길. 줄을 누르면 그 턴의 트레이스로 간다.
// 엔진에는 모든 대화의 턴을 한 번에 주는 목록이 없어(`turnRecord.list`는 대화 하나) 화면이 최근 대화 몇 개를 읽어 합친다(`source.ts`).
// 그래서 다 못 읽었으면 그 사실을 조용히 적는다. 날별 흐름의 기둥을 누르면 그날의 턴만 남는다.
import { activeLocale, t } from "@fresnel/client/i18n";
import type { TurnSummary } from "@fresnel/contracts/wire";
import { Button, ListNavigation, ListNavigationItem } from "@caustic/react";
import { X } from "@caustic/react/icons";
import { useState, type ReactNode } from "react";
import { countText } from "./format.ts";
import { DecisionGlyph, type Decision } from "./glyphs.tsx";
import { isPartialTurn, turnsOnDay, type RecentTurn } from "./model.ts";
import { Gate, Section } from "./parts.tsx";
import { dayLongText } from "./sections.tsx";
import type { MetricsData } from "./source.ts";

const FIRST = 8;
const STEP = 24;

function whenText(epochMs: number): string {
  return new Intl.DateTimeFormat(activeLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(epochMs);
}

/** 턴 요약의 결정 표: 0이 아닌 것만 점 구슬과 수로. 고장(고장으로 막음·시간 초과·실패)은 하나로 묶는다 */
function TurnDecisions(props: { readonly turn: TurnSummary }): ReactNode {
  const f = props.turn.flags;
  const items: readonly { readonly kind: Decision; readonly n: number; readonly word: string }[] = [
    { kind: "blocked", n: f.blockedIntent, word: t("desktop.craft.metrics.daily.blocked") },
    { kind: "asked", n: f.asked, word: t("desktop.craft.metrics.daily.asked") },
    { kind: "modified", n: f.modified, word: t("desktop.craft.metrics.daily.modified") },
    {
      kind: "error",
      n: f.blockedFault + f.timedOut + f.failed,
      word: t("desktop.craft.metrics.recent.fault"),
    },
  ];
  const shown = items.filter((i) => i.n > 0);
  if (shown.length === 0) return <span aria-hidden="true" />;
  return (
    <span className="flex items-center gap-2.5">
      {shown.map((i) => (
        <span
          key={i.kind}
          title={i.word}
          className={`inline-flex items-center gap-1 text-ui-sm ${i.kind === "error" ? "text-danger-text" : "text-text-secondary"}`}
        >
          <DecisionGlyph decision={i.kind} size={11} />
          <span className="sr-only">{i.word}</span>
          {countText(i.n)}
        </span>
      ))}
    </span>
  );
}

function StatusChip(props: { readonly turn: TurnSummary }): ReactNode {
  const turn = props.turn;
  const word =
    turn.status === "open"
      ? t("desktop.craft.trace.status.open")
      : isPartialTurn(turn)
        ? t("desktop.craft.trace.status.partial")
        : turn.status === "completed"
          ? null
          : turn.status === "failed" || turn.status === "lost"
            ? t("desktop.craft.trace.status.failed")
            : t("desktop.craft.trace.status.interrupted");
  if (word === null) return <span aria-hidden="true" />;
  const warn = turn.status !== "open";
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-ui-sm ${warn ? "border-warning-border text-text-secondary" : "border-border-default text-text-secondary"}`}
    >
      {turn.status === "open" ? <span className="viz-live">{word}</span> : word}
    </span>
  );
}

/** 줄 하나: 대화 목록의 줄과 같은 부품(`ListNavigationItem`, 높이 32). 앞에 시각, 가운데 대화 제목, 뒤에 결정과 상태 */
function TurnLine(props: { readonly item: RecentTurn; readonly onOpen: () => void }): ReactNode {
  const { turn, title } = props.item;
  const name = title ?? t("desktop.craft.metrics.recent.untitled");
  return (
    <ListNavigationItem
      leading={
        <time
          className="viz-figure w-36 shrink-0 truncate text-ui-sm text-text-tertiary"
          dateTime={new Date(turn.startedAt).toISOString()}
        >
          {whenText(turn.startedAt)}
        </time>
      }
      meta={
        <span className="flex items-center gap-3">
          <span className="viz-figure hidden text-ui-sm text-text-tertiary @[40rem]/metrics:inline">
            {t("desktop.craft.trace.rail.counts", {
              steps: countText(turn.stepCount),
              calls: countText(turn.callCount),
            })}
          </span>
          <TurnDecisions turn={turn} />
          <StatusChip turn={turn} />
        </span>
      }
      onSelect={props.onOpen}
    >
      <span className="truncate">{name}</span>
    </ListNavigationItem>
  );
}

export function RecentTurnsSection(props: {
  readonly data: MetricsData;
  readonly day: string | null;
  readonly onClearDay: () => void;
}): ReactNode {
  const d = props.data;
  const [shown, setShown] = useState(FIRST);
  const dayTurns =
    props.day === null || d.daily.kind !== "ready"
      ? null
      : (d.daily.value.rows.find((r) => r.key.day === props.day)?.values["block.time_split"]?.n ??
        0);
  return (
    <Section
      id="cm-recent"
      title={t("desktop.craft.metrics.recent.title")}
      info={t("desktop.craft.metrics.recent.info")}
      actions={
        props.day === null ? undefined : (
          <Button size="xs" variant="outline" onClick={props.onClearDay}>
            {t("desktop.craft.metrics.recent.dayUtc", { day: dayLongText(props.day) })}
            <X size={12} aria-label={t("desktop.craft.metrics.recent.clearDay")} />
          </Button>
        )
      }
    >
      <Gate
        load={d.recent}
        height={160}
        label={t("desktop.craft.metrics.recent.title")}
        onRetry={d.actions.reload}
      >
        {(recent) => {
          const list = props.day === null ? recent.turns : turnsOnDay(recent.turns, props.day);
          if (list.length === 0) {
            return (
              <div className="flex min-h-12 items-center rounded-2xl border border-dashed border-border-default px-4 text-ui text-text-secondary">
                {props.day !== null && dayTurns !== null && dayTurns > 0
                  ? t("desktop.craft.metrics.recent.dayOutside", { n: countText(dayTurns) })
                  : t("desktop.craft.metrics.recent.none")}
              </div>
            );
          }
          const visible = list.slice(0, shown);
          return (
            <div className="grid grid-cols-1 gap-1">
              <ListNavigation
                size="sm"
                aria-label={t("desktop.craft.metrics.recent.title")}
                className="-mx-2"
              >
                {visible.map((item) => (
                  <TurnLine
                    key={`${item.turn.threadId}:${item.turn.turnId}`}
                    item={item}
                    onOpen={() => {
                      d.actions.openTurn({
                        kind: "turn",
                        threadId: item.turn.threadId,
                        turnId: item.turn.turnId,
                      });
                    }}
                  />
                ))}
              </ListNavigation>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {list.length > shown ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="-ms-2 w-fit font-normal text-text-tertiary"
                    onClick={() => {
                      setShown(shown + STEP);
                    }}
                  >
                    {t("desktop.craft.metrics.recent.more", {
                      n: countText(Math.min(STEP, list.length - shown)),
                    })}
                  </Button>
                ) : null}
                {recent.partial ? (
                  <span className="text-ui-sm text-text-tertiary">
                    {t("desktop.craft.metrics.recent.partial", {
                      n: countText(recent.threads),
                    })}
                  </span>
                ) : null}
              </div>
            </div>
          );
        }}
      </Gate>
    </Section>
  );
}

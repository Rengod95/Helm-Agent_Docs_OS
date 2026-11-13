import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  ContextAnalytics,
  Tooltip,
} from "@caustic/react";
import { ChevronRight } from "@caustic/react/icons";
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  useAgentRows,
  useCompactionAnchors,
  useLinkPhase,
  useOpenThreadId,
  useOpenTranscript,
  useThreadRunning,
  useTurnSummaries,
} from "../../../state/engine/index.ts";
import type { CompactionRecord } from "../../../state/engine/state.ts";
import type { SettingsJumpTarget } from "../../../state/ui/index.ts";
import { useCommands } from "../../commands.ts";
import {
  priceNumberText,
  tokenCountText,
  useModelNameOf,
  useSessionUsage,
} from "../../model-usage.ts";
import { relativeAgeOf } from "../../pages/shared/relative-age.ts";
import { useClockNow } from "../../approval-card/clock.ts";
import { runThreadCompact } from "../../thread-compact.ts";
import { PanelEmpty, PanelSection } from "../panel-kit.tsx";
import {
  compositionPartsOf,
  contextFillOf,
  loadedToolsOf,
  roundsOf,
  usageReportOf,
  type CompactPolicy,
  type CompositionKey,
  type ContextFill,
  type ContextRound,
  type UsageTotals,
} from "./context-model.ts";

// 컨텍스트 탭(DP-201~203, 시안 _notes/design/dz/dzR5-design.md §4). 얼마나 찼고(채움, 자동 요약 문턱), 무엇이 차지하는지(턴별 구성),
// 무엇이 요약됐는지(요약 기록), 얼마를 썼는지(토큰·비용, 하위 에이전트 따로), 무엇이 실렸는지(도구, 스킬, 기억)를 보인다.
// 편집은 설정이 맡는다: "실린 것" 줄은 설정의 그 구역을 연다.

export function ContextTab(): ReactNode {
  const threadId = useOpenThreadId();
  if (threadId === null) return <PanelEmpty title={t("desktop.context.empty.noThread")} />;
  return <ThreadContext key={threadId} threadId={threadId} />;
}

function ThreadContext(props: { readonly threadId: ThreadId }): ReactNode {
  const { threadId } = props;
  const running = useThreadRunning(threadId);
  const usage = useSessionUsage(threadId, running);
  const policy = useCompactPolicy(threadId);
  const turns = useTurnSummaries(threadId);
  const fill = contextFillOf(usage, policy);
  const model = turns.findLast((turn) => turn.model !== null)?.model ?? null;
  return (
    <div data-panel="context" className="grid grid-cols-1 min-w-0 gap-5">
      <FillBlock threadId={threadId} fill={fill} model={model} running={running} />
      <CompositionBlock threadId={threadId} limit={usage?.limit ?? null} />
      <CompactionBlock threadId={threadId} />
      <UsageBlock threadId={threadId} />
      <LoadedBlock threadId={threadId} />
    </div>
  );
}

/** 자동 요약 정책을 한 번 읽는다(대화가 바뀌면 다시) */
function useCompactPolicy(threadId: ThreadId): CompactPolicy | null {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const [policy, setPolicy] = useState<CompactPolicy | null>(null);
  useEffect(() => {
    if (!live) return undefined;
    let alive = true;
    detach(
      commands.compactPolicy(threadId).then((read) => {
        if (alive) setPolicy(read);
        return undefined;
      }),
      rethrow,
    );
    return () => {
      alive = false;
    };
  }, [commands, threadId, live]);
  return policy;
}

// ── 채움 ───────────────────────────────────────────────────────────────

function fillCaptionOf(fill: ContextFill): string {
  switch (fill.kind) {
    case "none":
      return t("desktop.context.fill.none");
    case "noLimit":
      return t("desktop.context.fill.noLimit");
    case "known":
      switch (fill.compaction.kind) {
        case "left":
          return t("desktop.context.fill.left", { tokens: tokenCountText(fill.compaction.tokens) });
        case "over":
          return t("desktop.context.fill.over");
        case "off":
          return t("desktop.context.fill.off");
        case "unknown":
          return t("desktop.context.fill.unknown");
        default:
          return assertNever(fill.compaction, "ContextFill.compaction");
      }
    default:
      return assertNever(fill, "ContextFill");
  }
}

/** 채움 막대(8). 자동 요약 문턱에 눈금(2×14)을 세운다. 문턱을 넘으면 채움이 경고 색이다 */
function ContextGauge(props: {
  readonly fill: ContextFill & { readonly kind: "known" };
}): ReactNode {
  const { fill } = props;
  const over = fill.compaction.kind === "over";
  const tick = fill.threshold === null ? null : (fill.threshold / fill.limit) * 100;
  return (
    <div className="relative py-0.75">
      <div
        role="meter"
        aria-label={t("desktop.context.fill.label")}
        aria-valuemin={0}
        aria-valuemax={fill.limit}
        aria-valuenow={Math.min(fill.used, fill.limit)}
        aria-valuetext={t("desktop.context.fill.value", {
          percent: fill.percent,
          used: tokenCountText(fill.used),
          limit: tokenCountText(fill.limit),
        })}
        className="h-2 overflow-hidden rounded-full bg-neutral-track"
      >
        <div
          className={`h-full rounded-full ${over ? "bg-warning-solid" : "bg-accent-solid"}`}
          style={{ width: `${String(fill.percent)}%` }}
        />
      </div>
      {tick === null ? null : (
        <span
          data-slot="compaction-tick"
          aria-hidden
          className="absolute top-0 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-text-tertiary"
          style={{ left: `${String(Math.min(100, Math.max(0, tick)))}%` }}
        />
      )}
    </div>
  );
}

function FillBlock(props: {
  readonly threadId: ThreadId;
  readonly fill: ContextFill;
  readonly model: string | null;
  readonly running: boolean;
}): ReactNode {
  const { fill } = props;
  const commands = useCommands();
  const nameOf = useModelNameOf();
  const compactButton = (
    <Button
      size="sm"
      variant="outline"
      disabled={props.running}
      onClick={() => {
        runThreadCompact(commands, props.threadId);
      }}
    >
      {t("desktop.context.compact")}
    </Button>
  );
  return (
    <section
      aria-label={t("desktop.context.fill.label")}
      className="grid grid-cols-1 min-w-0 gap-2"
    >
      <div className="flex min-w-0 items-baseline gap-2">
        {fill.kind === "known" ? (
          <>
            <span className="text-title-3 text-text-primary tabular-nums">{fill.percent}%</span>
            <span className="text-ui text-text-secondary tabular-nums">
              {tokenCountText(fill.used)} / {tokenCountText(fill.limit)}
            </span>
          </>
        ) : fill.kind === "noLimit" ? (
          <span className="text-title-3 text-text-primary tabular-nums">
            {tokenCountText(fill.used)}
          </span>
        ) : (
          <span className="text-title-3 text-text-tertiary">—</span>
        )}
        <span className="flex-1" />
        {props.model === null ? null : (
          <span className="min-w-0 truncate text-footnote text-text-tertiary" title={props.model}>
            {nameOf(props.model)}
          </span>
        )}
      </div>
      {fill.kind === "known" ? <ContextGauge fill={fill} /> : null}
      <div className="flex min-h-7 min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 text-footnote text-text-secondary">
          {fillCaptionOf(fill)}
        </span>
        {props.running ? (
          <Tooltip content={t("desktop.context.compact.busy")} side="top">
            <span className="inline-flex">{compactButton}</span>
          </Tooltip>
        ) : (
          compactButton
        )}
      </div>
    </section>
  );
}

// ── 구성 ───────────────────────────────────────────────────────────────

const SERIES_OF: Readonly<Record<CompositionKey, "scene" | "tools" | "tokens" | "transcript">> = {
  system: "scene",
  tools: "tools",
  rules: "tokens",
  history: "transcript",
};

const PART_LABEL: Readonly<Record<CompositionKey, MessageId>> = {
  system: "desktop.context.part.system",
  tools: "desktop.context.part.tools",
  rules: "desktop.context.part.rules",
  history: "desktop.context.part.history",
};

function CompositionBlock(props: {
  readonly threadId: ThreadId;
  readonly limit: number | null;
}): ReactNode {
  const turns = useTurnSummaries(props.threadId);
  const rounds = useMemo(
    () => (props.limit === null ? [] : roundsOf(turns, props.limit)),
    [turns, props.limit],
  );
  const [picked, setPicked] = useState<number | null>(null);
  const selected = picked !== null && picked < rounds.length ? picked : rounds.length - 1;
  const round: ContextRound | undefined = rounds[selected];
  return (
    <PanelSection
      title={t("desktop.context.composition.title")}
      info={t("desktop.context.composition.help")}
      end={
        round === undefined ? null : (
          <span className="text-footnote text-text-tertiary">
            {t("desktop.context.composition.turn", { number: round.number })}
          </span>
        )
      }
    >
      {props.limit === null || round === undefined ? (
        <p className="m-0 text-ui text-text-secondary">{t("desktop.context.composition.empty")}</p>
      ) : (
        <CompositionFigure
          rounds={rounds}
          selected={selected}
          onSelect={setPicked}
          limit={props.limit}
        />
      )}
    </PanelSection>
  );
}

function CompositionFigure(props: {
  readonly rounds: readonly ContextRound[];
  readonly selected: number;
  readonly onSelect: (index: number) => void;
  readonly limit: number;
}): ReactNode {
  const round = props.rounds[props.selected];
  const parts =
    round?.composition === null || round === undefined
      ? []
      : compositionPartsOf(round.composition, props.limit);
  const detail = parts.find((part) => part.key === "rules")?.detail ?? [];
  return (
    <div className="grid grid-cols-1 min-w-0 gap-2">
      <ContextAnalytics
        aria-label={t("desktop.context.composition.title")}
        size="sm"
        rounds={props.rounds.map((r) => ({ total: r.total, out: r.out }))}
        selectedRound={props.selected}
        onSelectedRoundChange={props.onSelect}
        roundsLabel={t("desktop.context.composition.rounds")}
        roundLabel={(n, percent) =>
          t("desktop.context.composition.round", {
            number: props.rounds[n - 1]?.number ?? n,
            percent,
          })
        }
        freeLabel={t("desktop.context.part.free")}
        segments={parts.map((part) => ({
          label: `${t(PART_LABEL[part.key])} ${tokenCountText(part.tokens)}`,
          value: part.percent,
          series: SERIES_OF[part.key],
        }))}
        summary={
          round === undefined
            ? null
            : t("desktop.context.composition.summary", { tokens: tokenCountText(round.tokens) })
        }
        share={
          round === undefined
            ? null
            : t("desktop.context.composition.share", { percent: Math.round(round.total) })
        }
      />
      {round !== undefined && round.composition === null ? (
        <p className="m-0 text-footnote text-text-tertiary">
          {t("desktop.context.composition.noParts")}
        </p>
      ) : null}
      {detail.length === 0 ? null : (
        <ul
          aria-label={t("desktop.context.part.rulesDetail")}
          className="m-0 grid list-none gap-0.5 border-s border-border-subtle p-0 ps-3"
        >
          {detail.map((d) => (
            <li key={d.name} className="flex min-w-0 items-center gap-2 text-footnote">
              <span className="min-w-0 flex-1 truncate text-text-secondary">
                {sectionLabelOf(d.name)}
              </span>
              <span className="flex-none text-text-tertiary tabular-nums">
                {tokenCountText(d.tokens)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function sectionLabelOf(name: string): string {
  if (name === "injected") return t("desktop.context.part.injected");
  if (name === "volatile") return t("desktop.context.part.volatile");
  return name;
}

// ── 요약 기록 ───────────────────────────────────────────────────────────

function CompactionBlock(props: { readonly threadId: ThreadId }): ReactNode {
  const anchors = useCompactionAnchors(props.threadId);
  const records = anchors.map((a) => a.record).toReversed();
  const nowMs = useClockNow();
  return (
    <PanelSection
      title={t("desktop.context.compactions.title")}
      {...(records.length === 0 ? {} : { count: records.length })}
    >
      {records.length === 0 ? (
        <p className="m-0 text-ui text-text-secondary">{t("desktop.context.compactions.empty")}</p>
      ) : (
        <Accordion type="multiple" size="sm" className="min-w-0 grid-cols-1">
          {records.map((record) => (
            <AccordionItem key={record.eventId} value={record.eventId} className="min-w-0">
              <AccordionTrigger>
                <CompactionHead record={record} nowMs={nowMs} />
              </AccordionTrigger>
              <AccordionContent className="max-w-none pb-3">
                <div className="max-h-60 overflow-auto rounded-lg bg-bg-inset px-3 py-2 text-ui-relaxed whitespace-pre-wrap text-text-secondary">
                  {record.summary}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </PanelSection>
  );
}

function CompactionHead(props: {
  readonly record: CompactionRecord;
  readonly nowMs: number;
}): ReactNode {
  const { record } = props;
  const at = Date.parse(record.at);
  const age = Number.isNaN(at) ? null : relativeAgeOf(at, props.nowMs);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="flex-none text-ui text-text-primary">
        {record.reason === "manual"
          ? t("desktop.context.compactions.manual")
          : t("desktop.context.compactions.auto")}
      </span>
      {age === null ? null : (
        <span className="min-w-0 flex-1 truncate text-footnote text-text-tertiary">
          {t(age.id, age.args)}
        </span>
      )}
      <span className="ms-auto flex-none text-ui-sm text-text-secondary tabular-nums">
        {record.tokensAfter === null
          ? tokenCountText(record.tokensBefore)
          : `${tokenCountText(record.tokensBefore)} → ${tokenCountText(record.tokensAfter)}`}
      </span>
    </span>
  );
}

// ── 사용량 ─────────────────────────────────────────────────────────────

const USAGE_ROWS: readonly {
  readonly key: "input" | "output" | "cacheRead" | "cacheWrite";
  readonly label: MessageId;
}[] = [
  { key: "input", label: "desktop.context.usage.input" },
  { key: "output", label: "desktop.context.usage.output" },
  { key: "cacheRead", label: "desktop.context.usage.cacheRead" },
  { key: "cacheWrite", label: "desktop.context.usage.cacheWrite" },
];

function costText(totals: UsageTotals): string {
  return totals.cost === null ? "—" : `$${priceNumberText(totals.cost)}`;
}

function UsageBlock(props: { readonly threadId: ThreadId }): ReactNode {
  const turns = useTurnSummaries(props.threadId);
  const agents = useAgentRows(props.threadId);
  const nameOf = useModelNameOf();
  const report = useMemo(() => usageReportOf(turns, agents), [turns, agents]);
  if (report.turns === 0 && report.agents === null) {
    return (
      <PanelSection title={t("desktop.context.usage.title")}>
        <p className="m-0 text-ui text-text-secondary">{t("desktop.context.usage.empty")}</p>
      </PanelSection>
    );
  }
  const columns: readonly { readonly label: string; readonly totals: UsageTotals }[] = [
    { label: t("desktop.context.usage.thread"), totals: report.main },
    ...(report.agents === null
      ? []
      : [
          {
            label: t("desktop.context.usage.agents", { count: report.agentCount }),
            totals: report.agents,
          },
        ]),
  ];
  return (
    <PanelSection
      title={t("desktop.context.usage.title")}
      info={t("desktop.context.usage.help")}
      end={
        <span className="text-footnote text-text-tertiary tabular-nums">
          {t("desktop.context.usage.turns", { count: report.turns })}
        </span>
      }
    >
      <table className="w-full border-collapse text-ui">
        <thead>
          <tr className="text-footnote text-text-tertiary">
            <th className="py-1 text-start font-normal">
              <span className="sr-only">{t("desktop.context.usage.kind")}</span>
            </th>
            {columns.map((c) => (
              <th key={c.label} className="py-1 ps-4 text-end font-normal">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {USAGE_ROWS.map((row) => (
            <tr key={row.key} className="border-t border-border-subtle">
              <th className="py-1.5 text-start font-normal text-text-secondary">{t(row.label)}</th>
              {columns.map((c) => (
                <td key={c.label} className="py-1.5 ps-4 text-end text-text-primary tabular-nums">
                  {tokenCountText(c.totals[row.key])}
                </td>
              ))}
            </tr>
          ))}
          <tr className="border-t border-border-subtle">
            <th className="py-1.5 text-start text-ui-strong text-text-primary">
              {t("desktop.context.usage.cost")}
            </th>
            {columns.map((c) => (
              <td
                key={c.label}
                className="py-1.5 ps-4 text-end text-ui-strong text-text-primary tabular-nums"
              >
                {costText(c.totals)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {report.byModel.length < 2 ? null : (
        <ul className="m-0 mt-2 grid grid-cols-[1fr_auto_auto] list-none gap-x-4 gap-y-0.5 p-0 text-footnote">
          {report.byModel.map((m) => (
            <li key={m.model} className="contents">
              <span className="min-w-0 truncate text-text-secondary" title={m.model}>
                {nameOf(m.model)}
              </span>
              <span className="text-end text-text-tertiary tabular-nums">
                {tokenCountText(m.total)}
              </span>
              <span className="text-end text-text-tertiary tabular-nums">
                {m.cost === null ? "—" : `$${priceNumberText(m.cost)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  );
}

// ── 실린 것 ─────────────────────────────────────────────────────────────

type LoadedCounts = {
  readonly skills: { readonly model: number; readonly slash: number } | null;
  readonly memory: { readonly user: number; readonly env: number } | null;
};

/** 스킬과 기억 수를 한 번 읽는다. 기능이 꺼졌거나 읽지 못하면 그 줄은 null이다 */
function useLoadedCounts(threadId: ThreadId): LoadedCounts {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const [counts, setCounts] = useState<LoadedCounts>({ skills: null, memory: null });
  useEffect(() => {
    if (!live) return undefined;
    let alive = true;
    detach(
      Promise.all([commands.skills.list(threadId), commands.memory.read()]).then(
        ([skills, memory]) => {
          if (!alive) return undefined;
          const countOf = (store: "user" | "env"): number =>
            memory.ok
              ? (memory.value.stores.find((s) => s.store === store)?.entries.length ?? 0)
              : 0;
          setCounts({
            skills: skills.ok
              ? {
                  model: skills.value.skills.filter((s) => s.modelInvocable).length,
                  slash: skills.value.skills.filter((s) => !s.modelInvocable).length,
                }
              : null,
            memory: memory.ok ? { user: countOf("user"), env: countOf("env") } : null,
          });
          return undefined;
        },
      ),
      rethrow,
    );
    return () => {
      alive = false;
    };
  }, [commands, threadId, live]);
  return counts;
}

function LoadedBlock(props: { readonly threadId: ThreadId }): ReactNode {
  const transcript = useOpenTranscript(props.threadId);
  const turns = useTurnSummaries(props.threadId);
  const counts = useLoadedCounts(props.threadId);
  const commands = useCommands();
  const lastWarnings = turns.at(-1)?.warnings;
  const tools = useMemo(
    () =>
      transcript.status === "ready"
        ? loadedToolsOf(transcript.itemIds, transcript.items, lastWarnings ?? [])
        : null,
    [transcript, lastWarnings],
  );
  const open = (tab: SettingsJumpTarget): void => {
    commands.requestSettingsJump({ tab, key: null });
  };
  return (
    <PanelSection title={t("desktop.context.loaded.title")} info={t("desktop.context.loaded.help")}>
      <div className="grid grid-cols-1 min-w-0">
        <LoadedRow
          label={t("desktop.context.loaded.tools")}
          value={
            tools === null
              ? t("desktop.context.loaded.unknown")
              : tools.deferred.length === 0
                ? t("desktop.context.loaded.count", { count: tools.names.length })
                : t("desktop.context.loaded.toolsDeferred", {
                    count: tools.names.length,
                    deferred: tools.deferred.length,
                  })
          }
          title={tools === null ? undefined : tools.names.join(", ")}
          onOpen={() => {
            open("tools");
          }}
        />
        <LoadedRow
          label={t("desktop.context.loaded.skills")}
          value={
            counts.skills === null
              ? t("desktop.context.loaded.unknown")
              : counts.skills.slash === 0
                ? t("desktop.context.loaded.count", { count: counts.skills.model })
                : t("desktop.context.loaded.skillsSplit", {
                    count: counts.skills.model,
                    slash: counts.skills.slash,
                  })
          }
          onOpen={() => {
            open("tools");
          }}
        />
        <LoadedRow
          label={t("desktop.context.loaded.memory")}
          value={
            counts.memory === null
              ? t("desktop.context.loaded.unknown")
              : t("desktop.context.loaded.memoryCounts", {
                  user: counts.memory.user,
                  env: counts.memory.env,
                })
          }
          onOpen={() => {
            open("sessions");
          }}
        />
      </div>
    </PanelSection>
  );
}

function LoadedRow(props: {
  readonly label: string;
  readonly value: string;
  readonly title?: string | undefined;
  readonly onOpen: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      data-loaded-row
      onClick={props.onOpen}
      title={props.title}
      className="-mx-1.5 flex min-h-8 min-w-0 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-1.5 text-start outline-none hover:bg-fill-hover focus-visible:focus-ring"
    >
      <span className="flex-none text-ui text-text-primary">{props.label}</span>
      <span className="min-w-0 flex-1 truncate text-end text-footnote text-text-tertiary tabular-nums">
        {props.value}
      </span>
      <ChevronRight aria-hidden className="size-icon-sm flex-none text-text-tertiary" />
    </button>
  );
}

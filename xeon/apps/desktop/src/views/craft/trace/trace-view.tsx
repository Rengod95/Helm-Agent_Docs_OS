// 트레이스 화면(C8)의 그리기. 질문: "이 턴에서 무엇이 실렸고, 어떤 Hook이 무엇을 정했고, 비용은 얼마였나?"
// 판은 하나다: 왼쪽에 이 대화의 턴 목록, 오른쪽에 고른 턴. 맨 위 그림은 "시간 순서"와 "블록 자리" 둘로 바꿔 본다.
// 그 아래 섹션: Hook 결정, 실린 것, Drive, 비용, 자식 대화. 기록에 없는 값은 0으로 그리지 않고 "기록되지 않음"이라 쓴다.
import { activeLocale, t, type MessageId } from "@fresnel/client/i18n";
import type {
  FrameMark,
  ScopeKind,
  TurnRecord,
  TurnStatus,
  TurnSummary,
} from "@fresnel/contracts/wire";
import {
  Button,
  ListNavigation,
  ListNavigationItem,
  SegmentedControl,
  SegmentedControlItem,
} from "@caustic/react";
import { ChevronLeft } from "@caustic/react/icons";
import { useState, type ReactNode } from "react";
import { useCommands } from "../../commands.ts";
import { HEADER_SEGMENTED_SIZE, ScreenHeader } from "../../shell/screen-header.tsx";
import { StackRows, type Series } from "../metrics/charts.tsx";
import { countText, msText, tokensText } from "../metrics/format.ts";
import { KIND_COLOR, KindGlyph } from "../metrics/glyphs.tsx";
import { Gate, LoadingBlock, Section, Stat } from "../metrics/parts.tsx";
import { partSeries } from "../metrics/sections.tsx";
import { BlockFlow, HookChip } from "./flow.tsx";
import { placeText } from "./place.ts";
import {
  drivePathOf,
  hookEntriesOf,
  isFault,
  loadedOf,
  outcomeCountsOf,
  spansOf,
  stepMarksOf,
  totalsOf,
  turnLengthOf,
  usageOf,
  type HookEntry,
} from "./model.ts";
import { OUTCOME_WORD, Timeline } from "./timeline.tsx";
import type { TraceData, TurnPage } from "./source.ts";

type TraceMode = "time" | "blocks";

const STATUS_WORD: Readonly<Record<TurnStatus, MessageId>> = {
  completed: "desktop.craft.trace.status.completed",
  interrupted: "desktop.craft.trace.status.interrupted",
  failed: "desktop.craft.trace.status.failed",
  open: "desktop.craft.trace.status.open",
  lost: "desktop.craft.trace.status.lost",
};

const SCOPE_WORD: Readonly<Record<ScopeKind, MessageId>> = {
  live: "desktop.craft.trace.scope.live",
  overlay_reviewed: "desktop.craft.trace.scope.reviewed",
  overlay_draft: "desktop.craft.trace.scope.draft",
  test: "desktop.craft.trace.scope.test",
  craft: "desktop.craft.trace.scope.craft",
};

const EXIT_WORD: Readonly<Record<NonNullable<FrameMark["exitReason"]>, MessageId>> = {
  done: "desktop.craft.trace.exit.done",
  budget: "desktop.craft.trace.exit.budget",
  error: "desktop.craft.trace.exit.error",
  idle: "desktop.craft.trace.exit.idle",
  revoked: "desktop.craft.trace.exit.revoked",
  restart: "desktop.craft.trace.exit.restart",
  waiting: "desktop.craft.trace.exit.waiting",
  disabled: "desktop.craft.trace.exit.disabled",
};

/** 상태 칩: 외곽선만(색 없음) */
function StateChip(props: { readonly children: ReactNode; readonly danger?: boolean }): ReactNode {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-ui-sm ${props.danger === true ? "border-danger-border text-danger-text" : "border-border-default text-text-secondary"}`}
    >
      {props.children}
    </span>
  );
}

function clockText(epochMs: number, withDate: boolean): string {
  return new Intl.DateTimeFormat(activeLocale(), {
    ...(withDate ? { month: "short", day: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(epochMs);
}

// ───────── 턴 목록(왼쪽) ─────────

/** 턴 한 줄: 대화 목록의 줄과 같은 부품(ListNavigationItem). 시각, 그 뒤 흐리게 단계·도구 수와 막음, 끝나지 않았으면 상태 */
function TurnRow(props: {
  readonly turn: TurnSummary;
  readonly current: boolean;
  readonly onPick: () => void;
}): ReactNode {
  const s = props.turn;
  const stopped =
    s.flags.blockedIntent + s.flags.blockedFault + s.flags.deniedPolicy + s.flags.deniedHuman;
  const meta = [
    t("desktop.craft.trace.rail.counts", {
      steps: countText(s.stepCount),
      calls: countText(s.callCount),
    }),
    ...(stopped > 0 ? [t("desktop.craft.trace.rail.stopped", { n: countText(stopped) })] : []),
    ...(s.status === "completed" ? [] : [t(STATUS_WORD[s.status])]),
  ].join(" · ");
  return (
    <ListNavigationItem
      current={props.current}
      meta={<span className="viz-figure">{meta}</span>}
      onSelect={props.onPick}
    >
      <time className="viz-figure" dateTime={new Date(s.startedAt).toISOString()}>
        {clockText(s.startedAt, false)}
      </time>
    </ListNavigationItem>
  );
}

function TurnRail(props: { readonly data: TraceData; readonly page: TurnPage }): ReactNode {
  const d = props.data;
  const items = props.page.items;
  return (
    <div className="grid min-h-0 content-start gap-2">
      <div className="flex h-7 items-center gap-2 px-2">
        <h2 className="text-ui font-semibold text-text-primary">
          {t("desktop.craft.trace.rail.title")}
        </h2>
        <span className="viz-figure text-ui-sm text-text-tertiary">
          {props.page.next === null
            ? countText(items.length)
            : t("desktop.craft.trace.rail.atLeast", { n: countText(items.length) })}
        </span>
      </div>
      {props.page.off ? (
        <p className="px-2 text-ui-sm text-text-secondary">{t("desktop.craft.trace.rail.off")}</p>
      ) : null}
      <ListNavigation aria-label={t("desktop.craft.trace.rail.label")} size="sm">
        {items.map((turn) => (
          <TurnRow
            key={turn.turnId}
            turn={turn}
            current={turn.turnId === d.turnId}
            onPick={() => {
              d.actions.pick(turn.turnId);
            }}
          />
        ))}
      </ListNavigation>
      {props.page.next === null ? null : (
        <Button
          size="sm"
          variant="ghost"

          disabled={d.loadingMore}
          onClick={d.actions.more}
          className="justify-self-start"
        >
          {d.loadingMore
            ? t("desktop.craft.trace.rail.loading")
            : t("desktop.craft.trace.rail.more")}
        </Button>
      )}
    </div>
  );
}

// ───────── 경고(항상 보인다) ─────────

function warningsOf(record: TurnRecord): string[] {
  const out: string[] = [];
  if (record.status === "lost") out.push(t("desktop.craft.trace.warn.lost"));
  else if (!record.complete && record.status !== "open")
    out.push(t("desktop.craft.trace.warn.partial"));
  if (record.level === "log_only") out.push(t("desktop.craft.trace.warn.logOnly"));
  const e = record.elided;
  const elided =
    (e.hooks ?? 0) + (e.calls ?? 0) + (e.materials ?? 0) + (e.tools ?? 0) + (e.skills ?? 0);
  if (elided > 0) out.push(t("desktop.craft.trace.warn.elided", { n: countText(elided) }));
  if (record.scope !== "live" && record.scope !== "overlay_reviewed") {
    out.push(t("desktop.craft.trace.warn.notMetrics"));
  }
  return out;
}

function Warnings(props: { readonly record: TurnRecord }): ReactNode {
  const list = warningsOf(props.record);
  if (list.length === 0) return null;
  return (
    <ul role="note" className="grid gap-1.5">
      {list.map((w) => (
        <li
          key={w}
          className="rounded-lg border border-warning-border px-3 py-2 text-ui text-text-primary"
        >
          {w}
        </li>
      ))}
    </ul>
  );
}

// ───────── 머리 숫자 ─────────

function TurnSummaryStrip(props: {
  readonly record: TurnRecord;
  readonly lengthMs: number;
  readonly entries: readonly HookEntry[];
}): ReactNode {
  const r = props.record;
  const totals = totalsOf(r);
  const counts = outcomeCountsOf(props.entries);
  const n = (o: string): number => counts.find((c) => c.outcome === o)?.n ?? 0;
  const faults = n("error") + n("timeout");
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-ui text-text-secondary">
        <time
          dateTime={new Date(r.startedAt).toISOString()}
          className="viz-figure text-text-primary"
        >
          {clockText(r.startedAt, true)}
        </time>
        <StateChip danger={r.status === "failed" || r.status === "lost"}>
          {t(STATUS_WORD[r.status])}
        </StateChip>
        <StateChip>{t(SCOPE_WORD[r.scope])}</StateChip>
      </div>
      <div className="grid grid-cols-2 gap-4 compact:grid-cols-3 medium:grid-cols-6">
        <Stat label={t("desktop.craft.trace.kpi.length")} value={msText(props.lengthMs)} />
        <Stat
          label={t("desktop.craft.trace.kpi.modelCalls")}
          value={countText(totals.modelCalls)}
        />
        <Stat label={t("desktop.craft.trace.kpi.toolCalls")} value={countText(totals.toolCalls)} />
        <Stat label={t("desktop.craft.trace.kpi.input")} value={tokensText(totals.input)} />
        <Stat label={t("desktop.craft.trace.kpi.output")} value={tokensText(totals.output)} />
        <Stat
          label={t("desktop.craft.trace.kpi.decisions")}
          value={t("desktop.craft.trace.kpi.decisionsValue", {
            blocked: countText(n("blocked")),
            asked: countText(n("asked")),
          })}
          {...(faults > 0
            ? { info: t("desktop.craft.trace.kpi.faults", { n: countText(faults) }) }
            : {})}
        />
      </div>
    </div>
  );
}

// ───────── Hook 결정 ─────────

function entryPlaceText(e: HookEntry, locale: string): string {
  const where = placeText(e.place, locale);
  return e.call === null ? where : `${where} · ${e.call.tool}`;
}

function HooksSection(props: { readonly entries: readonly HookEntry[] }): ReactNode {
  const locale = activeLocale();
  const decided = props.entries.filter((e) => e.outcome !== "pass" && e.outcome !== "skipped");
  const [all, setAll] = useState(decided.length === 0);
  const shown = all ? props.entries : decided;
  const counts = outcomeCountsOf(props.entries);
  return (
    <Section
      id="tr-hooks"
      title={t("desktop.craft.trace.hooks.title")}
      info={t("desktop.craft.trace.hooks.info")}
      actions={
        props.entries.length === 0 ? undefined : (
          <SegmentedControl
            size="xs"
            aria-label={t("desktop.craft.trace.hooks.filter")}
            value={all ? "all" : "decided"}
            onValueChange={(v) => {
              setAll(v === "all");
            }}
          >
            <SegmentedControlItem value="decided">
              {t("desktop.craft.trace.hooks.decided")}
            </SegmentedControlItem>
            <SegmentedControlItem value="all">
              {t("desktop.craft.trace.hooks.all")}
            </SegmentedControlItem>
          </SegmentedControl>
        )
      }
    >
      {props.entries.length === 0 ? (
        <p className="text-ui text-text-secondary">{t("desktop.craft.trace.hooks.none")}</p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-1.5" aria-label={t("desktop.craft.trace.hooks.counts")}>
            {counts.map((c) => (
              <li key={c.outcome} className="viz-figure text-ui-sm text-text-secondary">
                <StateChip danger={isFault(c.outcome)}>
                  {t(OUTCOME_WORD[c.outcome])} {countText(c.n)}
                </StateChip>
              </li>
            ))}
          </ul>
          {shown.length === 0 ? (
            <p className="text-ui text-text-secondary">
              {t("desktop.craft.trace.hooks.noneDecided")}
            </p>
          ) : (
            <table className="viz-figure w-full border-collapse text-ui">
              <caption className="sr-only">{t("desktop.craft.trace.hooks.title")}</caption>
              <thead>
                <tr className="border-b border-border-subtle text-ui-sm text-text-tertiary">
                  <th scope="col" className="h-7 w-20 px-2 text-left font-normal">
                    {t("desktop.craft.trace.col.at")}
                  </th>
                  <th scope="col" className="h-7 px-2 text-left font-normal">
                    {t("desktop.craft.trace.col.place")}
                  </th>
                  <th scope="col" className="h-7 px-2 text-left font-normal">
                    {t("desktop.craft.trace.col.plugin")}
                  </th>
                  <th scope="col" className="h-7 px-2 text-left font-normal">
                    {t("desktop.craft.trace.col.outcome")}
                  </th>
                  <th scope="col" className="h-7 w-20 px-2 text-right font-normal">
                    {t("desktop.craft.trace.col.took")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr
                    key={`${e.run.registrationId}:${String(e.run.seq)}:${String(e.run.atMs)}:${e.run.toolCallId ?? ""}`}
                    className="border-b border-border-subtle align-top last:border-b-0"
                  >
                    <td className="px-2 py-1.5 text-text-tertiary">{msText(e.run.atMs)}</td>
                    <td className="px-2 py-1.5 text-text-secondary">{entryPlaceText(e, locale)}</td>
                    <td className="px-2 py-1.5">
                      <div className="text-text-primary">{e.run.plugin}</div>
                      {e.run.decisionText === null ? null : (
                        <div className="text-ui-sm text-text-secondary">{e.run.decisionText}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <ul className="flex">
                        <HookChip entry={e} plugin={false} />
                      </ul>
                    </td>
                    <td className="px-2 py-1.5 text-right text-text-tertiary">
                      {msText(e.run.ms)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Section>
  );
}

// ───────── 실린 것 ─────────

function loadedSeries(): readonly Series[] {
  return [
    {
      id: "instruction",
      label: t("desktop.craft.trace.loaded.instruction"),
      color: KIND_COLOR.inject,
    },
    {
      id: "skills",
      label: t("desktop.craft.trace.loaded.skills"),
      color: `color-mix(in oklab, ${KIND_COLOR.inject} 50%, transparent)`,
    },
    { id: "tools", label: t("desktop.craft.trace.loaded.tools"), color: KIND_COLOR.tool },
  ];
}

function LoadedSection(props: { readonly record: TurnRecord }): ReactNode {
  const r = props.record;
  const groups = loadedOf(r);
  const series = loadedSeries();
  const lastStep = r.steps.at(-1) ?? null;
  const advertised = lastStep?.advertised ?? null;
  return (
    <Section
      id="tr-loaded"
      title={t("desktop.craft.trace.loaded.title")}
      info={t("desktop.craft.trace.loaded.info")}
    >
      {groups.length === 0 ? (
        <p className="text-ui text-text-secondary">
          {r.level === "full"
            ? t("desktop.craft.trace.loaded.none")
            : t("desktop.craft.trace.absent")}
        </p>
      ) : (
        <StackRows
          series={series}
          label={t("desktop.craft.trace.loaded.title")}
          format={tokensText}
          rows={groups.map((g) => ({
            id: g.plugin,
            name: g.plugin,
            label: (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{g.plugin}</span>
                {g.truncated ? (
                  <StateChip>{t("desktop.craft.trace.loaded.truncated")}</StateChip>
                ) : null}
              </span>
            ),
            parts: [
              { series: "instruction", value: g.instruction },
              { series: "skills", value: g.skills },
              { series: "tools", value: g.tools },
            ],
            totalText: tokensText(g.instruction + g.skills + g.tools),
          }))}
        />
      )}
      <dl className="grid gap-1 text-ui compact:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-text-tertiary">{t("desktop.craft.trace.loaded.advertised")}</dt>
        <dd className="viz-figure text-text-secondary">
          {advertised === null
            ? t("desktop.craft.trace.absent")
            : t("desktop.craft.trace.loaded.advertisedValue", {
                n: countText(advertised.count),
                tokens: tokensText(advertised.tokens),
                deferred: countText(advertised.deferredCount),
              })}
        </dd>
        <dt className="text-text-tertiary">{t("desktop.craft.trace.loaded.skillsRead")}</dt>
        <dd className="text-text-secondary">
          {r.skills.read.length === 0
            ? t("desktop.craft.trace.loaded.skillsNone", {
                listed: countText(r.skills.listed.length + r.skills.listedOmitted),
              })
            : r.skills.read
                .map((s) =>
                  t(
                    s.via === "model"
                      ? "desktop.craft.trace.loaded.readByModel"
                      : "desktop.craft.trace.loaded.readByUser",
                    {
                      name: s.name,
                      plugin: s.plugin,
                    },
                  ),
                )
                .join(", ")}
        </dd>
      </dl>
    </Section>
  );
}

// ───────── Drive ─────────

function Meter(props: {
  readonly label: string;
  readonly used: number;
  readonly limit: number | undefined;
  readonly ratio: number | null;
}): ReactNode {
  return (
    <div className="flex items-center gap-2 text-ui-sm text-text-secondary">
      <span className="w-12 shrink-0 text-text-tertiary">{props.label}</span>
      <span
        aria-hidden="true"
        className="relative h-1.5 w-20 overflow-hidden rounded-full bg-neutral-track"
      >
        {props.ratio === null ? null : (
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${String(Math.round(props.ratio * 100))}%`,
              background: KIND_COLOR.drive,
            }}
          />
        )}
      </span>
      <span className="viz-figure">
        {props.limit === undefined
          ? countText(props.used)
          : `${countText(props.used)} / ${countText(props.limit)}`}
      </span>
    </div>
  );
}

function DriveSection(props: { readonly record: TurnRecord }): ReactNode {
  const r = props.record;
  const path = drivePathOf(r.frames);
  return (
    <Section
      id="tr-drive"
      title={t("desktop.craft.trace.drive.title")}
      info={t("desktop.craft.trace.drive.info")}
    >
      {path.length === 0 ? (
        <p className="text-ui text-text-secondary">{t("desktop.craft.trace.drive.none")}</p>
      ) : (
        <>
          <ol
            className="flex flex-wrap items-center gap-1.5 text-ui"
            aria-label={t("desktop.craft.trace.drive.path")}
          >
            <li className="text-text-secondary">{t("desktop.craft.trace.drive.base")}</li>
            {path.map((f, i) => (
              <li
                key={f.leaseId ?? String(i)}
                className="flex items-center gap-1.5 text-text-primary"
              >
                <span aria-hidden="true" className="text-text-tertiary">
                  ›
                </span>
                <span style={{ color: KIND_COLOR.drive }}>
                  <KindGlyph kind="drive" />
                </span>
                {f.plugin ?? t("desktop.craft.trace.drive.unnamed")}
              </li>
            ))}
          </ol>
          <ul className="grid gap-2">
            {path.map((f, i) => {
              const u = usageOf(f);
              return (
                <li
                  key={f.leaseId ?? String(i)}
                  className="grid gap-2 rounded-xl border border-border-subtle p-4 compact:grid-cols-[minmax(0,1fr)_auto]"
                  style={{ marginInlineStart: `${String(Math.max(0, f.depth - 1) * 16)}px` }}
                >
                  <div className="grid min-w-0 gap-1">
                    <div className="flex items-center gap-2 text-ui">
                      <span className="font-medium text-text-primary">
                        {f.plugin ?? t("desktop.craft.trace.drive.unnamed")}
                      </span>
                      {f.exitReason === null ? (
                        <StateChip>{t("desktop.craft.trace.drive.running")}</StateChip>
                      ) : (
                        <StateChip danger={f.exitReason === "error"}>
                          {t(EXIT_WORD[f.exitReason])}
                        </StateChip>
                      )}
                    </div>
                    <div className="viz-figure text-ui-sm text-text-secondary">
                      {msText(f.enteredAtMs)} →{" "}
                      {f.exitedAtMs === null
                        ? t("desktop.craft.trace.running")
                        : msText(f.exitedAtMs)}
                      {f.userMessages > 0
                        ? ` · ${t("desktop.craft.trace.drive.userMessages", { n: countText(f.userMessages) })}`
                        : ""}
                    </div>
                  </div>
                  <div className="grid content-start gap-1">
                    <Meter
                      label={t("desktop.craft.trace.drive.turns")}
                      used={f.used.turns}
                      limit={f.limits.maxTurns}
                      ratio={u.turns}
                    />
                    <Meter
                      label={t("desktop.craft.trace.drive.tokens")}
                      used={f.used.tokens}
                      limit={f.limits.maxTokens}
                      ratio={u.tokens}
                    />
                    <Meter
                      label={t("desktop.craft.trace.drive.spawns")}
                      used={f.used.spawns}
                      limit={f.limits.maxSpawns}
                      ratio={u.spawns}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {r.continues.length === 0 ? null : (
        <ul className="grid gap-1 text-ui" aria-label={t("desktop.craft.trace.drive.continues")}>
          {r.continues.map((c) => (
            <li
              key={`${c.plugin}:${String(c.atMs)}`}
              className="flex items-baseline gap-2 text-text-secondary"
            >
              <span className="viz-figure w-16 shrink-0 text-ui-sm text-text-tertiary">
                {msText(c.atMs)}
              </span>
              <span className="text-text-primary">{c.plugin}</span>
              <StateChip>
                {t(
                  c.decided === "continue"
                    ? "desktop.craft.trace.drive.continue"
                    : "desktop.craft.trace.drive.stop",
                )}
              </StateChip>
              {c.reason === null ? null : <span className="min-w-0 truncate">{c.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ───────── 비용 ─────────

function CostSection(props: { readonly record: TurnRecord }): ReactNode {
  const r = props.record;
  const totals = totalsOf(r);
  const breaks = r.steps.filter((s) => s.cache !== null && s.cache.observed);
  return (
    <Section
      id="tr-cost"
      title={t("desktop.craft.trace.cost.title")}
      info={t("desktop.craft.trace.cost.info")}
    >
      <div className="grid grid-cols-2 gap-4 compact:grid-cols-4">
        <Stat label={t("desktop.craft.trace.kpi.input")} value={tokensText(totals.input)} />
        <Stat label={t("desktop.craft.trace.kpi.output")} value={tokensText(totals.output)} />
        <Stat
          label={t("desktop.craft.trace.cost.cacheRead")}
          value={tokensText(totals.cacheRead)}
        />
        <Stat
          label={t("desktop.craft.trace.cost.cacheWrite")}
          value={tokensText(totals.cacheWrite)}
        />
      </div>
      {r.cost.length === 0 ? (
        <p className="text-ui text-text-secondary">{t("desktop.craft.trace.cost.none")}</p>
      ) : (
        <StackRows
          series={partSeries()}
          label={t("desktop.craft.trace.cost.byPlugin")}
          format={tokensText}
          rows={r.cost
            .toSorted((a, b) => b.always + b.drive + b.onDemand - (a.always + a.drive + a.onDemand))
            .map((c) => ({
              id: c.plugin,
              name: c.plugin,
              label: <span className="truncate">{c.plugin}</span>,
              parts: [
                { series: "always", value: c.always },
                { series: "drive", value: c.drive },
                { series: "onDemand", value: c.onDemand },
              ],
              totalText: tokensText(c.always + c.drive + c.onDemand),
            }))}
        />
      )}
      {breaks.length === 0 ? null : (
        <p className="text-ui text-text-secondary">
          {t("desktop.craft.trace.cost.cacheBreaks", {
            n: countText(breaks.length),
            plugins:
              [
                ...new Set(
                  breaks
                    .flatMap((s) => s.cache?.causes.map((c) => c.plugin ?? "") ?? [])
                    .filter((p) => p !== ""),
                ),
              ].join(", ") || t("desktop.craft.trace.cost.cacheUnknown"),
          })}
        </p>
      )}
    </Section>
  );
}

const CHILD_WORD: Readonly<Record<TurnRecord["children"][number]["status"], MessageId>> = {
  running: "desktop.craft.trace.child.running",
  completed: "desktop.craft.trace.child.completed",
  failed: "desktop.craft.trace.child.failed",
  interrupted: "desktop.craft.trace.child.interrupted",
};

function ChildrenSection(props: { readonly record: TurnRecord }): ReactNode {
  const children = props.record.children;
  if (children.length === 0) return null;
  return (
    <Section id="tr-children" title={t("desktop.craft.trace.children.title")}>
      <ul className="grid gap-0.5 text-ui">
        {children.map((c) => (
          <li key={c.childThreadId} className="flex h-8 items-center gap-2 px-2">
            <span className="text-text-primary">{c.agent}</span>
            <StateChip danger={c.status === "failed"}>{t(CHILD_WORD[c.status])}</StateChip>
            <span className="viz-figure ml-auto text-ui-sm text-text-tertiary">
              {c.used === null
                ? t("desktop.craft.trace.absent")
                : t("desktop.craft.trace.children.used", {
                    turns: countText(c.used.turns),
                    tokens: tokensText(c.used.tokens),
                  })}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ───────── 턴 하나 ─────────

function TurnBody(props: {
  readonly record: TurnRecord;
  readonly mode: TraceMode;
  readonly live: boolean;
}): ReactNode {
  const r = props.record;
  const entries = hookEntriesOf(r);
  const spans = spansOf(r);
  const lengthMs = turnLengthOf(r, spans);
  return (
    <div className="grid min-w-0 gap-10">
      <div className="grid gap-4">
        <TurnSummaryStrip record={r} lengthMs={lengthMs} entries={entries} />
        <Warnings record={r} />
      </div>
      <section
        aria-label={t(
          props.mode === "time"
            ? "desktop.craft.trace.mode.time"
            : "desktop.craft.trace.mode.blocks",
        )}
      >
        {props.mode === "time" ? (
          <Timeline
            spans={spans}
            lengthMs={lengthMs}
            steps={stepMarksOf(r)}
            live={props.live}
            label={t("desktop.craft.trace.timeline.label")}
          />
        ) : (
          <BlockFlow record={r} entries={entries} />
        )}
      </section>
      <HooksSection key={`${r.threadId}:${r.turnId}`} entries={entries} />
      <LoadedSection record={r} />
      <DriveSection record={r} />
      <CostSection record={r} />
      <ChildrenSection record={r} />
    </div>
  );
}

const ABSENT_WORD: Readonly<Record<"never_recorded" | "purged" | "off", MessageId>> = {
  never_recorded: "desktop.craft.trace.absentTurn.never",
  purged: "desktop.craft.trace.absentTurn.purged",
  off: "desktop.craft.trace.absentTurn.off",
};

function Blank(props: {
  readonly title: string;
  readonly body: string;
  readonly action?: ReactNode;
}): ReactNode {
  return (
    <div className="mx-auto grid max-w-120 justify-items-center gap-3 px-4 py-16 text-center">
      <h2 className="text-title-3 font-semibold text-text-primary">{props.title}</h2>
      <p className="text-ui text-text-secondary">{props.body}</p>
      {props.action}
    </div>
  );
}

function TurnPane(props: { readonly data: TraceData; readonly mode: TraceMode }): ReactNode {
  const d = props.data;
  if (d.turnId === null) {
    return d.turns.kind === "ready" ? (
      <Blank
        title={t("desktop.craft.trace.noTurns.title")}
        body={t("desktop.craft.trace.noTurns.body")}
      />
    ) : (
      <LoadingBlock height={320} label={t("desktop.craft.trace.loading")} />
    );
  }
  return (
    <Gate
      load={d.record}
      height={420}
      label={t("desktop.craft.trace.loading")}
      onRetry={d.actions.reload}
    >
      {(got) =>
        got.record === null ? (
          <Blank
            title={t(
              got.absent === null
                ? "desktop.craft.trace.absentTurn.never"
                : ABSENT_WORD[got.absent],
            )}
            body={t("desktop.craft.trace.absentTurn.body")}
          />
        ) : (
          <TurnBody record={got.record} mode={props.mode} live={d.watching} />
        )
      }
    </Gate>
  );
}

const BACK_WORD: Readonly<Record<"metrics" | "chat", MessageId>> = {
  metrics: "desktop.craft.trace.back.metrics",
  chat: "desktop.craft.trace.back.chat",
};

export function TraceView(props: { readonly data: TraceData }): ReactNode {
  const d = props.data;
  const commands = useCommands();
  const [mode, setMode] = useState<TraceMode>("time");
  const back = d.actions.back;
  const from = d.from;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        title={t("desktop.craft.trace.title")}
        lead={
          back !== null && (from === "metrics" || from === "chat") ? (
            <Button size="md" variant="ghost" onClick={back} className="-ms-1.5">
              <ChevronLeft />
              {t(BACK_WORD[from])}
            </Button>
          ) : undefined
        }
        meta={
          d.watching ? (
            <span className="viz-live text-ui-sm text-text-secondary">
              {t("desktop.craft.trace.live")}
            </span>
          ) : undefined
        }
        controls={
          <SegmentedControl
            size={HEADER_SEGMENTED_SIZE}
            aria-label={t("desktop.craft.trace.mode.label")}
            value={mode}
            onValueChange={(v) => {
              setMode(v === "blocks" ? "blocks" : "time");
            }}
          >
            <SegmentedControlItem value="time">
              {t("desktop.craft.trace.mode.time")}
            </SegmentedControlItem>
            <SegmentedControlItem value="blocks">
              {t("desktop.craft.trace.mode.blocks")}
            </SegmentedControlItem>
          </SegmentedControl>
        }
      />
      {d.threadId === null ? (
        <Blank
          title={t("desktop.craft.trace.pick.title")}
          body={t("desktop.craft.trace.pick.body")}
          action={
            <Button
              size="md"
              variant="outline"

              onClick={() => {
                commands.showScreen("chat");
              }}
            >
              {t("desktop.craft.trace.pick.toChat")}
            </Button>
          }
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[17rem_minmax(0,1fr)]">
          <div className="min-h-0 overflow-y-auto border-r border-border-subtle px-3 pt-2 pb-6">
            <Gate
              load={d.turns}
              height={240}
              label={t("desktop.craft.trace.loading")}
              onRetry={d.actions.reload}
            >
              {(page) => <TurnRail data={d} page={page} />}
            </Gate>
          </div>
          <div className="min-h-0 overflow-y-auto">
            <div className="mx-auto grid w-full max-w-260 gap-6 px-6 pt-4 pb-12">
              {d.link === "offline" && d.record.kind === "ready" ? (
                <div role="status" className="text-ui-sm text-warning-text">
                  {t("desktop.craft.metrics.stale")}
                </div>
              ) : null}
              <TurnPane data={d} mode={mode} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

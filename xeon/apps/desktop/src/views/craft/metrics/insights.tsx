// 인사이트(옛 살펴볼 것). 엔진이 근거와 함께 올린 발견을 영향 순으로 보이고, 줄마다 근거 턴과 다음 걸음을 둔다(AC-40).
// 다음 걸음: "고치기"·"막기로 올리기"는 근거를 들고 테스트 챗을 열고, "프로필에서 빼기"는 그 플러그인이 든 프로필에서 뺀다.
// 닫으면 목록에서 빠지고, 영향이 두 배로 늘거나 절반으로 줄면 엔진이 다시 연다(`findings.ts` reopens). 닫은 것은 접힌 칸에 있다.
import { activeLocale, t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow, type Result } from "@fresnel/contracts";
import type { EvidenceRef, Finding, MetricDef, Profile } from "@fresnel/contracts/wire";
import { Button, Chip, IconButton, Popover } from "@caustic/react";
import { ChevronDown, ChevronRight, X } from "@caustic/react/icons";
import { useState, type ReactNode } from "react";
import type { CommandError } from "../../commands.ts";
import { subjectRefText } from "../trace/place.ts";
import { KindTile, kindOfSubject } from "./glyphs.tsx";
import { cellText, countText, msText, percentText, tokensText } from "./format.ts";
import { insightFiguresOf, insightGroupsOf, type ImpactUnit } from "./model.ts";
import { Card, Gate } from "./parts.tsx";
import type { MetricsActions, MetricsData } from "./source.ts";

const RULE_TITLE: Readonly<Record<string, MessageId>> = {
  unused_tools: "desktop.craft.metrics.rule.unusedTools",
  ask_always_denied: "desktop.craft.metrics.rule.askAlwaysDenied",
  ask_always_allowed: "desktop.craft.metrics.rule.askAlwaysAllowed",
  hook_slow_faulty: "desktop.craft.metrics.rule.hookSlowFaulty",
  hook_never_reached: "desktop.craft.metrics.rule.hookNeverReached",
  skill_activation_drop: "desktop.craft.metrics.rule.skillActivationDrop",
  skill_never_read: "desktop.craft.metrics.rule.skillNeverRead",
  cache_break_by_plugin: "desktop.craft.metrics.rule.cacheBreakByPlugin",
  instruction_defied: "desktop.craft.metrics.rule.instructionDefied",
  instruction_truncated: "desktop.craft.metrics.rule.instructionTruncated",
  repeat_after_block: "desktop.craft.metrics.rule.repeatAfterBlock",
  drive_budget_exhausted: "desktop.craft.metrics.rule.driveBudgetExhausted",
};

const UNIT_WORD: Readonly<Record<ImpactUnit, MessageId>> = {
  tokens_per_turn: "desktop.craft.metrics.impact.tokensPerTurn",
  hits: "desktop.craft.metrics.impact.hits",
  turns: "desktop.craft.metrics.impact.turns",
};

const UNIT_GROUP: Readonly<Record<ImpactUnit, MessageId>> = {
  tokens_per_turn: "desktop.craft.metrics.impactGroup.tokensPerTurn",
  hits: "desktop.craft.metrics.impactGroup.hits",
  turns: "desktop.craft.metrics.impactGroup.turns",
};

function ruleTitleOf(ruleId: string): string {
  const id = RULE_TITLE[ruleId];
  return id === undefined ? t("desktop.craft.metrics.rule.other") : t(id);
}

/** 대상 글: 플러그인 · 참조. Hook은 내부 이름 대신 자리(블록 + 앞·뒤)로 쓴다 */
function subjectText(f: Finding): string {
  const ref =
    f.subject.ref === null ? "" : subjectRefText(f.subject.kind, f.subject.ref, activeLocale());
  return ref === "" ? f.subject.plugin : `${f.subject.plugin} · ${ref}`;
}

function impactText(finding: Finding): string {
  const value =
    finding.impact.unit === "tokens_per_turn"
      ? tokensText(finding.impact.value)
      : countText(finding.impact.value);
  return t(UNIT_WORD[finding.impact.unit], { n: value });
}

/** 지표 단위에 맞는 값 글 */
function metricValueText(def: MetricDef | undefined, value: number): string {
  if (def === undefined) return countText(value);
  switch (def.kind) {
    case "ratio":
      return percentText(value);
    case "tokens":
      return tokensText(value);
    case "ms":
      return msText(value);
    case "count":
      return countText(value);
    default:
      return assertNever(def.kind, "MetricKind");
  }
}

/** 엔진 카탈로그의 지표 이름(ko/en). 카탈로그를 못 읽었으면 id */
function metricLabelOf(def: MetricDef | undefined, id: string, locale: string): string {
  if (def === undefined) return id;
  return locale.startsWith("ko") ? def.label.ko : def.label.en;
}

function evidenceLabel(ref: EvidenceRef, index: number): string {
  if (ref.kind === "backtest") return t("desktop.craft.metrics.evidence.backtest");
  return t("desktop.craft.metrics.evidence.turn", { n: String(index + 1) });
}

function profilesWith(profiles: readonly Profile[], plugin: string): Profile[] {
  return profiles.filter((p) => p.plugins.some((ref) => ref.name === plugin));
}

/** 다음 걸음의 단추 */
function NextSteps(props: {
  readonly finding: Finding;
  readonly profiles: readonly Profile[];
  readonly actions: MetricsActions;
  readonly locked: boolean;
}): ReactNode {
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<CommandError | null>(null);
  const run = (id: string, work: () => Promise<Result<null, CommandError>>): void => {
    setBusy(id);
    setFailure(null);
    detach(
      work().then((done) => {
        setBusy(null);
        if (!done.ok) setFailure(done.error);
        return undefined;
      }),
      rethrow,
    );
  };
  const holders = profilesWith(props.profiles, props.finding.subject.plugin);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {props.finding.next.map((step) => {
        if (step.kind === "remove") {
          return (
            <Popover
              key={step.kind}
              size="sm"
              side="bottom"
              align="start"
              anchor={
                <Button size="sm" variant="ghost" disabled={props.locked || holders.length === 0}>
                  {t("desktop.craft.metrics.next.remove")}
                </Button>
              }
            >
              <div className="grid w-64 gap-2 p-1 text-ui">
                <p className="text-text-secondary">
                  {t("desktop.craft.metrics.next.removeAsk", {
                    plugin: props.finding.subject.plugin,
                  })}
                </p>
                <ul className="grid gap-1">
                  {holders.map((profile) => (
                    <li key={profile.id} className="flex h-8 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-text-primary">
                        {profile.title}
                      </span>
                      <Button
                        size="xs"
                        variant="outline"

                        loading={busy === `remove:${profile.id}`}
                        onClick={() => {
                          run(`remove:${profile.id}`, () =>
                            props.actions.removeFromProfile(profile, props.finding.subject.plugin),
                          );
                        }}
                      >
                        {t("desktop.craft.metrics.next.removeConfirm")}
                      </Button>
                    </li>
                  ))}
                </ul>
                <p className="text-ui-sm text-text-tertiary">
                  {t("desktop.craft.metrics.next.removeNote")}
                </p>
              </div>
            </Popover>
          );
        }
        const label =
          step.kind === "promote"
            ? t("desktop.craft.metrics.next.promote")
            : t("desktop.craft.metrics.next.fix");
        return (
          <Button
            key={step.kind}
            size="sm"
            variant="ghost"

            disabled={props.locked}
            loading={busy === step.kind}
            onClick={() => {
              run(step.kind, () => props.actions.openFix(props.finding));
            }}
          >
            {label}
          </Button>
        );
      })}
      {failure === null ? null : (
        <span role="alert" className="text-ui-sm text-danger-text">
          {failure.kind === "unsupported"
            ? t("desktop.craft.metrics.next.unsupported")
            : t("desktop.craft.metrics.next.failed")}
        </span>
      )}
    </div>
  );
}

function InsightCard(props: {
  readonly finding: Finding;
  readonly catalog: ReadonlyMap<string, MetricDef>;
  readonly profiles: readonly Profile[];
  readonly actions: MetricsActions;
  readonly locked: boolean;
  readonly compact: boolean;
  readonly locale: string;
}): ReactNode {
  const f = props.finding;
  const figures = insightFiguresOf(f, props.compact ? 1 : 2);
  const shown = f.evidence.slice(0, props.compact ? 2 : 4);
  const [dismissing, setDismissing] = useState(false);
  return (
    <Card as="li" className={props.compact ? "gap-2 p-3" : ""}>
      <div className="flex min-w-0 items-start gap-3">
        <KindTile kind={kindOfSubject(f.subject.kind)} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <div className="text-ui leading-5 font-medium text-text-primary">
            {ruleTitleOf(f.ruleId)}
          </div>
          <div className="truncate text-ui-sm text-text-tertiary">{subjectText(f)}</div>
        </div>
        <div className="viz-figure shrink-0 pt-0.5 text-right text-ui font-medium text-text-primary">
          {impactText(f)}
        </div>
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.craft.metrics.insight.dismiss")}
          disabled={props.locked || dismissing}
          className="-mt-1 -mr-1 shrink-0"
          onClick={() => {
            setDismissing(true);
            detach(
              props.actions.dismiss(f.id).then((done) => {
                if (!done.ok) setDismissing(false);
                return undefined;
              }),
              rethrow,
            );
          }}
        >
          <X />
        </IconButton>
      </div>
      {figures.length === 0 ? null : (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 pl-10 text-ui-sm">
          {figures.map((fig) => {
            const def = props.catalog.get(fig.metric);
            return (
              <div key={fig.metric} className="flex min-w-0 items-baseline gap-1.5">
                <dt className="truncate text-text-tertiary">
                  {metricLabelOf(def, fig.metric, props.locale)}
                </dt>
                <dd className="viz-figure text-text-primary">
                  {cellText(fig.cell, (v) => metricValueText(def, v))}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-10">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="mr-1 text-ui-sm text-text-tertiary">
            {t("desktop.craft.metrics.evidence.count", { n: countText(f.evidenceTotal) })}
          </span>
          {shown.map((ref, i) => (
            <Chip
              key={
                ref.kind === "backtest"
                  ? ref.backtestRunId
                  : `${ref.threadId}:${ref.turnId}:${String(i)}`
              }
              size="sm"
              variant="outline"
              disabled={ref.kind === "backtest"}
              onClick={() => {
                props.actions.openTurn(ref);
              }}
            >
              {evidenceLabel(ref, i)}
            </Chip>
          ))}
        </div>
        <div className="ml-auto">
          <NextSteps
            finding={f}
            profiles={props.profiles}
            actions={props.actions}
            locked={props.locked}
          />
        </div>
      </div>
    </Card>
  );
}

/** 닫은 인사이트(숨김 칸). 펼치면 한 줄씩 보인다 */
function Dismissed(props: { readonly findings: readonly Finding[] }): ReactNode {
  const [open, setOpen] = useState(false);
  if (props.findings.length === 0) return null;
  return (
    <div className="grid gap-1">
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        className="-ms-2 w-fit font-normal text-text-tertiary"
        onClick={() => {
          setOpen(!open);
        }}
      >
        {open ? <ChevronDown /> : <ChevronRight />}
        {t("desktop.craft.metrics.insight.dismissed", { n: String(props.findings.length) })}
      </Button>
      {open ? (
        <ul className="grid gap-0.5 pl-8">
          {props.findings.map((f) => (
            <li key={f.id} className="flex h-8 items-center gap-2 text-ui text-text-secondary">
              <span className="min-w-0 flex-1 truncate">
                {ruleTitleOf(f.ruleId)} · {f.subject.plugin}
              </span>
              <span className="viz-figure text-ui-sm text-text-tertiary">{impactText(f)}</span>
            </li>
          ))}
          <li className="text-ui-sm text-text-tertiary">
            {t("desktop.craft.metrics.insight.reopenNote")}
          </li>
        </ul>
      ) : null}
    </div>
  );
}

/** 인사이트가 하나도 없을 때 */
function NoInsights(): ReactNode {
  return (
    <div className="flex min-h-12 items-center rounded-xl border border-dashed border-border-default px-4 text-ui text-text-secondary">
      {t("desktop.craft.metrics.insight.none")}
    </div>
  );
}

export function InsightList(props: {
  readonly data: MetricsData;
  readonly compact: boolean;
  readonly limit?: number;
  readonly locale: string;
}): ReactNode {
  const { data } = props;
  const catalog = data.catalog.kind === "ready" ? data.catalog.value : new Map<string, MetricDef>();
  const profiles = data.profiles.kind === "ready" ? data.profiles.value : [];
  const locked = data.link !== "live";
  const [all, setAll] = useState(false);
  return (
    <Gate
      load={data.findings}
      height={160}
      label={t("desktop.craft.metrics.insight.title")}
      onRetry={data.actions.reload}
    >
      {(result) => {
        const groups = insightGroupsOf(result.findings);
        const total = result.findings.length;
        const limit = props.limit ?? Number.POSITIVE_INFINITY;
        let budget = all ? Number.POSITIVE_INFINITY : limit;
        return (
          <div className="grid gap-4">
            {total === 0 ? <NoInsights /> : null}
            {groups.map((group) => {
              const items = group.items.slice(0, Math.max(0, budget));
              budget -= items.length;
              if (items.length === 0) return null;
              return (
                <div key={group.unit} className="grid gap-2">
                  {groups.length > 1 ? (
                    <div className="text-ui-sm text-text-tertiary">{t(UNIT_GROUP[group.unit])}</div>
                  ) : null}
                  <ul className="grid gap-2">
                    {items.map((f) => (
                      <InsightCard
                        key={f.id}
                        finding={f}
                        catalog={catalog}
                        profiles={profiles}
                        actions={data.actions}
                        locked={locked}
                        compact={props.compact}
                        locale={props.locale}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
            {!all && total > limit ? (
              <Button
                size="sm"
                variant="ghost"

                className="w-fit"
                onClick={() => {
                  setAll(true);
                }}
              >
                {t("desktop.craft.metrics.insight.more", { n: String(total - limit) })}
              </Button>
            ) : null}
            {data.dismissed.kind === "ready" ? (
              <Dismissed findings={data.dismissed.value.findings} />
            ) : null}
          </div>
        );
      }}
    </Gate>
  );
}

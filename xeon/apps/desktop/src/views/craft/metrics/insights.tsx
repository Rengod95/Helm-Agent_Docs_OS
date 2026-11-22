// 인사이트(옛 살펴볼 것). 엔진이 근거와 함께 올린 발견을 영향 순으로 보이고, 줄마다 근거 턴과 다음 걸음을 둔다(AC-40).
// 다음 걸음: "고치기"·"막기로 올리기"는 근거를 들고 테스트 챗을 열고, "프로필에서 빼기"는 그 플러그인이 든 프로필에서 뺀다.
// 닫으면 목록에서 빠지고, 영향이 두 배로 늘거나 절반으로 줄면 엔진이 다시 연다(`findings.ts` reopens). 닫은 것은 접힌 칸에 있다.
import { activeLocale, t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow, type Result } from "@fresnel/contracts";
import type { Finding, MetricDef, Profile } from "@fresnel/contracts/wire";
import { Button, IconButton, Popover, ToneScopeContext, type ToneScope } from "@caustic/react";
import { ChevronDown, ChevronRight, X } from "@caustic/react/icons";
import { useRef, useState, type ReactNode } from "react";
import type { CommandError } from "../../commands.ts";
import { isRequiredByCore } from "../core-required.ts";
import { subjectRefText } from "../trace/place.ts";
import { InfoTip } from "../info-tip.tsx";
import { KindGlyph, KindTile, kindOfSubject, type Kind } from "./glyphs.tsx";
import { cellText, countText, msText, percentText, tokensText } from "./format.ts";
import {
  dailyOf,
  insightFiguresOf,
  insightGroupsOf,
  sampleStatusOf,
  type ImpactUnit,
} from "./model.ts";
import { Gate } from "./parts.tsx";
import { useRailAvoid } from "../../shell/rail-avoid.ts";
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

export function ruleTitleOf(ruleId: string): string {
  const id = RULE_TITLE[ruleId];
  return id === undefined ? t("desktop.craft.metrics.rule.other") : t(id);
}

/** 대상 글: 플러그인 · 참조. Hook은 내부 이름 대신 자리(블록 + 앞·뒤)로 쓴다 */
function subjectText(f: Finding): string {
  const ref =
    f.subject.ref === null ? "" : subjectRefText(f.subject.kind, f.subject.ref, activeLocale());
  return ref === "" ? f.subject.plugin : `${f.subject.plugin} · ${ref}`;
}

const UNIT_WORD_SHORT: Readonly<Record<ImpactUnit, MessageId>> = {
  tokens_per_turn: "desktop.craft.metrics.impactUnit.tokensPerTurn",
  hits: "desktop.craft.metrics.impactUnit.hits",
  turns: "desktop.craft.metrics.impactUnit.turns",
};

function impactValueText(finding: Finding): string {
  return finding.impact.unit === "tokens_per_turn"
    ? tokensText(finding.impact.value)
    : countText(finding.impact.value);
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

function profilesWith(profiles: readonly Profile[], plugin: string): Profile[] {
  return profiles.filter((p) => p.plugins.some((ref) => ref.name === plugin));
}

/**
 * 다음 걸음 단추의 색 갈래. Button의 `tone` 속성은 caustic이 통째로 deprecated로 표시해 lint가 막으므로, 단추 묶음을
 * accent 범위로 감싸고 단추는 강세(variant)만 정한다. 빼기의 팝오버는 떠 있는 층이라 범위가 풀린다
 */
const ACCENT_SCOPE: ToneScope = { tone: "accent", variant: "soft" };

/**
 * 다음 걸음의 단추. 넷째 판(사용자 2026-11-21: "면이 있는 변형, 오른쪽"): 둘 다 면이 있다. 주 행동(고치기·막기로 올리기)이
 * 가장 강한 accent solid(어두운 판 흰 면, 밝은 판 검은 면), 프로필에서 빼기는 한 단계 약한 accent soft다. neutral soft는 어두운
 * 판에서 카드 면과 거의 같아 면이 사라지고, neutral solid는 어두운 판에서 회색이라 주 행동이 약해 버렸다.
 * 주 행동이 오른쪽 끝에 선다(읽는 차례의 마지막, 카드 오른쪽 값 열의 선)
 */
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
  const steps = props.finding.next.toSorted(
    (a, b) => Number(a.kind !== "remove") - Number(b.kind !== "remove"),
  );
  return (
    <ToneScopeContext value={ACCENT_SCOPE}>
      <div className="flex min-w-0 items-center justify-end gap-1.5">
        {failure === null ? null : (
          <span role="alert" className="me-1 min-w-0 truncate text-ui-sm text-danger-text">
            {failure.kind === "unsupported"
              ? t("desktop.craft.metrics.next.unsupported")
              : isRequiredByCore(failure)
                ? t("desktop.craft.metrics.next.requiredByCore", {
                    plugin: props.finding.subject.plugin,
                  })
                : t("desktop.craft.metrics.next.failed")}
          </span>
        )}
        {steps.map((step) => {
          if (step.kind === "remove") {
            return (
              <Popover
                key={step.kind}
                size="sm"
                side="bottom"
                align="end"
                anchor={
                  <Button size="sm" variant="soft" disabled={props.locked || holders.length === 0}>
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
                  <ul className="grid grid-cols-1 gap-1">
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
                              props.actions.removeFromProfile(
                                profile,
                                props.finding.subject.plugin,
                              ),
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
              variant="solid"
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
      </div>
    </ToneScopeContext>
  );
}

/** 근거 턴을 보러 가는 단추. 카드의 근거 줄(글 + 턴 칩)을 대신한다: 누르면 "최근 턴"이 이 인사이트의 근거 턴만 보인다 */
function EvidenceButton(props: {
  readonly finding: Finding;
  readonly onShow: (finding: Finding) => void;
}): ReactNode {
  const f = props.finding;
  const openable = f.evidence.some((ref) => ref.kind !== "backtest");
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={!openable}
      aria-label={t("desktop.craft.metrics.evidence.show", { n: countText(f.evidenceTotal) })}
      className="-me-3.5 shrink-0 font-normal"
      onClick={() => {
        props.onShow(f);
      }}
    >
      {t("desktop.craft.metrics.evidence.count", { n: countText(f.evidenceTotal) })}
      <ChevronRight />
    </Button>
  );
}

/**
 * 인사이트 하나(열린 카드). 셋째 판(m6X3): 앱의 알림 토스트와 같은 판(rounded-2xl squircle, border-subtle, 그림자 없음)에
 * 세 묶음을 쌓는다. 묶음 안은 가깝게(4~8), 묶음 사이는 멀게(16).
 *   1. 머리: 종류 타일 28 · 한 줄 제목(13/500, 말줄임) 위 대상(12, 흐림) · 닫기 ×
 *   2. 숫자: 큰 영향 숫자(18/600)와 단위(13, 보조 글색) 한 기준선, 같은 줄 오른쪽 끝에 근거 턴 단추(ghost, 가장 약함,
 *      꺾쇠의 오른쪽 끝이 값 열 선에 선다), 그 아래 이름-값 줄(12, 이름 흐림 · 값 보조, 양끝)
 *   3. 바닥 한 줄: 오른쪽에 다음 걸음 단추만(면 있음, `NextSteps`). 주 행동의 오른쪽 끝이 위 이름-값 줄의 값 열 선에 선다.
 *      다섯째 판(m6X5): 넷째 판은 근거 단추를 바닥 왼쪽에 두었는데, 1440 창에서 단추 셋(근거 · 빼기 · 막기로 올리기)이 304px로
 *      바닥 285px(띠 옆에서는 263px)을 넘어 다음 걸음이 다음 줄로 내려갔다. 근거 단추를 영향 숫자 줄로 올려 바닥은 늘 한 줄이다
 * 글은 크기 셋(18·13·12), 굵기 셋(600·500·400), 색 셋(주·보조·흐림) 안에서만 가른다. 왼쪽 선은 하나(카드 안 16)다.
 * 반경은 바깥 2xl(19.2), 단추는 sm 기본 lg(12)다. 단추는 모서리에서 16 떨어져 같은 중심이 아니므로 2xl보다 두 단계 작게 둔다.
 * 띠 비키기(다섯째 판, 리뷰 m6R5와 같은 길): 카드의 면과 테두리는 열 끝까지 가고, 그 안의 줄(머리, 큰 숫자, 이름-값 줄, 바닥) 가운데
 * 오른쪽 세로 단추 띠와 실제로 겹치는 줄만 `data-under-rail`을 받아 띠 왼쪽 12px 앞에서 끝난다(`views/shell/rail-avoid.ts`, 줄의 `data-rail-avoid`).
 * 줄은 모두 한 줄(말줄임)이라 비켜도 높이는 그대로다
 */
function InsightCard(props: {
  readonly finding: Finding;
  readonly catalog: ReadonlyMap<string, MetricDef>;
  readonly profiles: readonly Profile[];
  readonly actions: MetricsActions;
  readonly locked: boolean;
  readonly locale: string;
  readonly onFold?: () => void;
  readonly onShowEvidence: (finding: Finding) => void;
}): ReactNode {
  const f = props.finding;
  const figures = insightFiguresOf(f, 2);
  const [dismissing, setDismissing] = useState(false);
  const title = ruleTitleOf(f.ruleId);
  return (
    <li className="grid min-w-0 grid-cols-1 rounded-2xl border border-border-subtle bg-surface-base">
      <div className="grid min-w-0 grid-cols-1 gap-4 ps-4 pt-3.5 pe-4 pb-4">
        <div data-rail-avoid="" className="flex min-w-0 items-center gap-3">
          <KindTile kind={kindOfSubject(f.subject.kind)} />
          <div className="grid min-w-0 flex-1 grid-cols-1">
            {props.onFold === undefined ? (
              <div title={title} className="truncate text-ui-strong text-text-primary">
                {title}
              </div>
            ) : (
              <button
                type="button"
                aria-expanded="true"
                title={title}
                onClick={props.onFold}
                className="truncate rounded-none border-0 bg-transparent p-0 text-left text-ui-strong text-text-primary outline-none hover:underline focus-visible:focus-ring"
              >
                {title}
              </button>
            )}
            <div className="truncate text-ui-sm text-text-tertiary">{subjectText(f)}</div>
          </div>
          <IconButton
            size="sm"
            variant="ghost"
            label={t("desktop.craft.metrics.insight.dismiss")}
            disabled={props.locked || dismissing}
            className="-me-2 shrink-0 self-start text-text-tertiary"
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
        <div className="grid min-w-0 grid-cols-1 gap-2">
          <div data-rail-avoid="" className="flex min-w-0 items-center gap-3">
            <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="text-title-feature font-semibold text-text-primary">
                {impactValueText(f)}
              </span>
              <span className="truncate text-ui text-text-secondary">
                {t(UNIT_WORD_SHORT[f.impact.unit])}
              </span>
            </div>
            <EvidenceButton finding={f} onShow={props.onShowEvidence} />
          </div>
          {figures.length === 0 ? null : (
            <dl className="m-0 grid grid-cols-1 gap-1 text-ui-sm">
              {figures.map((fig) => {
                const def = props.catalog.get(fig.metric);
                return (
                  <div
                    key={fig.metric}
                    data-rail-avoid=""
                    className="flex min-w-0 items-baseline gap-3"
                  >
                    <dt className="min-w-0 flex-1 truncate text-text-tertiary">
                      {metricLabelOf(def, fig.metric, props.locale)}
                    </dt>
                    <dd className="m-0 shrink-0 text-text-secondary">
                      {cellText(fig.cell, (v) => metricValueText(def, v))}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
        {f.next.length === 0 ? null : (
          <div data-rail-avoid="" className="grid min-w-0 grid-cols-1">
            <NextSteps
              finding={f}
              profiles={props.profiles}
              actions={props.actions}
              locked={props.locked}
            />
          </div>
        )}
      </div>
    </li>
  );
}

/** 접힌 인사이트 한 줄(많을 때 여섯째부터). 누르면 카드로 펼친다 */
function InsightRow(props: { readonly finding: Finding; readonly onOpen: () => void }): ReactNode {
  const f = props.finding;
  return (
    <li data-rail-avoid="">
      <button
        type="button"
        aria-expanded="false"
        onClick={props.onOpen}
        className="grid h-9 w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border-0 bg-transparent ps-2 pe-2 py-0 text-left text-ui outline-none hover:bg-neutral-hover focus-visible:focus-ring"
      >
        <KindTile kind={kindOfSubject(f.subject.kind)} size={20} />
        <span className="min-w-0 truncate">
          <span className="text-text-primary">{ruleTitleOf(f.ruleId)}</span>
          <span className="text-ui-sm text-text-tertiary"> · {f.subject.plugin}</span>
        </span>
        <span className="viz-figure text-ui-sm text-text-secondary">{impactText(f)}</span>
      </button>
    </li>
  );
}

/** 닫은 인사이트(숨김 칸). 펼치면 한 줄씩 보인다 */
function Dismissed(props: { readonly findings: readonly Finding[] }): ReactNode {
  const [open, setOpen] = useState(false);
  if (props.findings.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-1">
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
        <ul className="grid grid-cols-1 gap-0.5 pl-6">
          {props.findings.map((f) => (
            <li
              key={f.id}
              data-rail-avoid=""
              className="flex h-8 items-center gap-2 text-ui text-text-secondary"
            >
              <span className="min-w-0 flex-1 truncate">
                {ruleTitleOf(f.ruleId)} · {f.subject.plugin}
              </span>
              <span className="viz-figure text-ui-sm text-text-tertiary">{impactText(f)}</span>
            </li>
          ))}
          <li className="pt-1 text-ui-sm text-text-tertiary">
            {t("desktop.craft.metrics.insight.reopenNote")}
          </li>
        </ul>
      ) : null}
    </div>
  );
}

/**
 * 열린 인사이트가 없을 때. 가짜로 채우지 않고, 엔진이 지켜보는 규칙을 이 화면의 두 물음으로 묶어 보인다.
 * 턴이 최소 표본보다 적으면 몇 턴이 더 모여야 확인하는지 말한다
 */
function NoInsights(props: {
  readonly data: MetricsData;
  readonly focus: string | null;
}): ReactNode {
  const d = props.data;
  const turns =
    d.daily.kind === "ready" ? dailyOf(d.daily.value).reduce((s, p) => s + p.turns, 0) : null;
  const status = turns === null ? null : sampleStatusOf(turns, d.minSample);
  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid grid-cols-1 gap-1">
        <p data-rail-avoid="" className="text-ui font-medium text-text-primary">
          {props.focus === null
            ? t("desktop.craft.metrics.insight.none")
            : t("desktop.craft.metrics.insight.noneFor", { plugin: props.focus })}
        </p>
        <p data-rail-avoid="" className="text-ui-sm text-text-secondary">
          {status !== null && status.short !== null && status.short > 0
            ? t("desktop.craft.metrics.insight.noneShort", {
                n: countText(status.turns),
                more: countText(status.short),
              })
            : t("desktop.craft.metrics.insight.noneWatching")}
        </p>
      </div>
      {WATCH_GROUPS.map((group) => (
        <div key={group.id} className="grid grid-cols-1 gap-1.5">
          <div data-rail-avoid="" className="text-ui-sm text-text-tertiary">
            {t(group.title)}
          </div>
          <ul className="grid grid-cols-1 gap-1">
            {group.rules.map((rule) => (
              <li
                key={rule.id}
                data-rail-avoid=""
                className="flex items-center gap-2 text-ui-sm text-text-secondary"
              >
                <span className="text-text-tertiary">
                  <KindGlyph kind={rule.kind} size={12} />
                </span>
                {ruleTitleOf(rule.id)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** 엔진의 인사이트 규칙(`apps/host` findings 규칙 12개)을 이 화면의 두 물음으로 묶은 것 */
const WATCH_GROUPS: readonly {
  readonly id: string;
  readonly title: MessageId;
  readonly rules: readonly { readonly id: string; readonly kind: Kind }[];
}[] = [
  {
    id: "rules",
    title: "desktop.craft.metrics.insight.watchRules",
    rules: [
      { id: "instruction_defied", kind: "inject" },
      { id: "repeat_after_block", kind: "hook" },
      { id: "hook_never_reached", kind: "hook" },
      { id: "hook_slow_faulty", kind: "hook" },
      { id: "ask_always_denied", kind: "hook" },
      { id: "ask_always_allowed", kind: "hook" },
      { id: "drive_budget_exhausted", kind: "drive" },
    ],
  },
  {
    id: "context",
    title: "desktop.craft.metrics.insight.watchContext",
    rules: [
      { id: "unused_tools", kind: "tool" },
      { id: "skill_never_read", kind: "inject" },
      { id: "skill_activation_drop", kind: "inject" },
      { id: "instruction_truncated", kind: "inject" },
      { id: "cache_break_by_plugin", kind: "block" },
    ],
  },
];

/** 처음부터 카드로 펼쳐 두는 인사이트 수. 그 뒤는 한 줄로 접는다 */
const OPEN_FIRST = 5;

/**
 * 인사이트 열. 메트릭 화면 오른쪽에 붙어 왼쪽을 스크롤해도 남고, 열 안에서 따로 스크롤한다.
 * 좁은 창에서는 같은 것이 서랍으로 열린다(`onClose`가 있으면 닫기 단추를 단다)
 */
export function InsightPanel(props: {
  readonly data: MetricsData;
  readonly locale: string;
  readonly onClose?: () => void;
  /** 카드의 "근거 턴 n개"를 눌렀다: 화면이 "최근 턴"을 그 근거로 거른다 */
  readonly onShowEvidence: (finding: Finding) => void;
}): ReactNode {
  const { data } = props;
  const catalog = data.catalog.kind === "ready" ? data.catalog.value : new Map<string, MetricDef>();
  const profiles = data.profiles.kind === "ready" ? data.profiles.value : [];
  const locked = data.link !== "live";
  const focus = data.filter.plugin;
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  // 띠와 겹치는 줄(`[data-rail-avoid]`)만 비킨다. 폭을 끝 바깥 여백으로 쓰는 규칙은 `viz.css`의 `.cm-insights [data-under-rail]`이다.
  // 비킬 줄끼리 겹쳐 싸지 않는다(안팎이 두 번 줄지 않게). 좁은 창의 서랍(`onClose`가 있다)은 띠를 덮으므로 비키지 않는다
  useRailAvoid(scroller, "");
  const count =
    data.findings.kind === "ready"
      ? data.findings.value.findings.filter((f) => focus === null || f.subject.plugin === focus)
          .length
      : null;
  return (
    <aside aria-labelledby="cm-insights-title" className="flex min-h-0 flex-1 flex-col">
      {/* 머리: 그림 열의 첫 상자와 같은 위 24px에서 시작한다. 좌우 안쪽 여백은 같은 20px(열의 왼쪽 선과 창 끝에서) */}
      <div className="flex min-h-7 shrink-0 items-center gap-2 px-5 pt-6 pb-3">
        <h2
          id="cm-insights-title"
          className="text-title-3 leading-5 font-semibold text-text-primary"
        >
          {t("desktop.craft.metrics.insight.title")}
        </h2>
        {count === null || count === 0 ? null : (
          <span className="text-ui text-text-tertiary">{countText(count)}</span>
        )}
        <InfoTip text={t("desktop.craft.metrics.insight.info")} />
        {focus === null ? null : (
          <span className="min-w-0 truncate text-ui-sm text-text-tertiary">· {focus}</span>
        )}
        {props.onClose === undefined ? null : (
          <IconButton
            size="sm"
            variant="ghost"
            label={t("desktop.craft.metrics.insight.close")}
            className="-me-1.5 ml-auto"
            onClick={props.onClose}
          >
            <X />
          </IconButton>
        )}
      </div>
      <div
        ref={props.onClose === undefined ? scroller : undefined}
        className="cm-insights min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-10"
      >
        <Gate
          load={data.findings}
          height={160}
          label={t("desktop.craft.metrics.insight.title")}
          onRetry={data.actions.reload}
        >
          {(result) => {
            const findings = result.findings.filter(
              (f) => focus === null || f.subject.plugin === focus,
            );
            const groups = insightGroupsOf(findings);
            let index = 0;
            return (
              <div className="grid grid-cols-1 gap-6">
                {findings.length === 0 ? <NoInsights data={data} focus={focus} /> : null}
                {groups.map((group) => (
                  <section
                    key={group.unit}
                    className="grid grid-cols-1 gap-2.5"
                    aria-label={t(UNIT_GROUP[group.unit])}
                  >
                    <div
                      data-rail-avoid=""
                      className="flex items-center gap-1.5 text-ui-sm text-text-tertiary"
                    >
                      <span>{t(UNIT_GROUP[group.unit])}</span>
                      <span>{countText(group.items.length)}</span>
                    </div>
                    <ul className="m-0 grid grid-cols-1 gap-3 p-0">
                      {group.items.map((f) => {
                        const at = index;
                        index += 1;
                        const open = (at < OPEN_FIRST && !folded.has(f.id)) || opened.has(f.id);
                        return open ? (
                          <InsightCard
                            key={f.id}
                            finding={f}
                            catalog={catalog}
                            profiles={profiles}
                            actions={data.actions}
                            locked={locked}
                            locale={props.locale}
                            onShowEvidence={props.onShowEvidence}
                            {...(at < OPEN_FIRST && !opened.has(f.id)
                              ? {}
                              : {
                                  onFold: () => {
                                    const next = new Set(opened);
                                    next.delete(f.id);
                                    setOpened(next);
                                    setFolded(new Set(folded).add(f.id));
                                  },
                                })}
                          />
                        ) : (
                          <InsightRow
                            key={f.id}
                            finding={f}
                            onOpen={() => {
                              setOpened(new Set(opened).add(f.id));
                              const next = new Set(folded);
                              next.delete(f.id);
                              setFolded(next);
                            }}
                          />
                        );
                      })}
                    </ul>
                  </section>
                ))}
                {data.dismissed.kind === "ready" ? (
                  <Dismissed
                    findings={data.dismissed.value.findings.filter(
                      (f) => focus === null || f.subject.plugin === focus,
                    )}
                  />
                ) : null}
              </div>
            );
          }}
        </Gate>
      </div>
    </aside>
  );
}

/** 좁은 창의 위 요약 줄: 인사이트 수와 가장 큰 것 하나, 그리고 서랍을 여는 단추 */
export function InsightSummary(props: {
  readonly data: MetricsData;
  readonly onOpen: () => void;
}): ReactNode {
  const d = props.data;
  if (d.findings.kind !== "ready") return null;
  const focus = d.filter.plugin;
  const findings = d.findings.value.findings.filter(
    (f) => focus === null || f.subject.plugin === focus,
  );
  const top = insightGroupsOf(findings)[0]?.items[0] ?? null;
  return (
    <button
      type="button"
      onClick={props.onOpen}
      className="flex h-11 w-full items-center gap-3 rounded-2xl border border-border-subtle bg-transparent px-4 py-0 text-left text-ui outline-none hover:bg-neutral-hover focus-visible:focus-ring"
    >
      <span className="font-semibold text-text-primary">
        {t("desktop.craft.metrics.insight.title")}
      </span>
      <span className="text-text-tertiary">{countText(findings.length)}</span>
      <span className="min-w-0 flex-1 truncate text-text-secondary">
        {top === null
          ? t("desktop.craft.metrics.insight.none")
          : `${ruleTitleOf(top.ruleId)} · ${top.subject.plugin}`}
      </span>
      <span className="shrink-0 text-ui-sm text-text-tertiary">
        {t("desktop.craft.metrics.insight.openAll")}
      </span>
      <ChevronRight size={14} />
    </button>
  );
}

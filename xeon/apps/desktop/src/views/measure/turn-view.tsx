// P-20 Turn 다시 보기(§6.27)의 그림. 훅 발화 시간줄, 플러그인별 몫(눌러 그 플러그인만 강조), 요청 구성 막대, 캐시 사건.
// 값은 `turnViewOf`가 만든다. 상태: 읽는 중, 오프라인(마지막 값), 오류, 측정 꺼짐, 기록 없음, 긴 목록(처음 N줄만).
import { t } from "@fresnel/client/i18n";
import {
  turnViewOf,
  type CompositionBarVM,
  type HookEventVM,
  type PluginShareVM,
  type TabRead,
  type TurnViewVM,
} from "@fresnel/client/workbench";
import { assertNever } from "@fresnel/contracts";
import type { MeasureTurnResult } from "@fresnel/contracts/wire";
import { Button } from "@caustic/react";
import { useState, type ReactNode } from "react";
import { MUTED, TabBody } from "../workbench/tab-body.tsx";
import {
  cacheCodeText,
  cacheDetailText,
  cacheOwnerText,
  outcomeText,
  partText,
} from "./turn-text.ts";

/** 한 목록에 그리는 줄 상한. 넘으면 나머지 개수만 적는다 */
const TURN_LIST_CAP = 100;

const PART_CLASS: Readonly<Record<string, string>> = {
  system: "bg-neutral-track",
  section: "bg-info-soft",
  injected: "bg-warning-soft",
  volatile: "bg-danger-soft",
  history: "bg-success-soft",
};

function Heading(props: { readonly children: ReactNode }): ReactNode {
  return <h4 className="m-0 text-ui-sm font-semibold text-text-secondary">{props.children}</h4>;
}

function numberText(value: number): string {
  return t("desktop.workbench.metrics.number", { value });
}

function Capped(props: { readonly total: number }): ReactNode {
  if (props.total <= TURN_LIST_CAP) return null;
  return (
    <p className={MUTED}>
      {t("desktop.measure.turn.more", { count: props.total - TURN_LIST_CAP })}
    </p>
  );
}

function PluginRows(props: {
  readonly plugins: readonly PluginShareVM[];
  readonly focus: string | null;
  readonly onFocus: (owner: string | null) => void;
}): ReactNode {
  if (props.plugins.length === 0)
    return <p className={MUTED}>{t("desktop.measure.turn.pluginsNone")}</p>;
  return (
    <ul className="m-0 grid list-none gap-1 p-0 text-ui-sm">
      {props.plugins.slice(0, TURN_LIST_CAP).map((share) => {
        const active = props.focus === share.owner;
        return (
          <li key={share.owner}>
            <Button
              size="sm"
              variant={active ? "soft" : "ghost"}
              aria-pressed={active}
              className="w-full flex-wrap justify-start gap-3 text-start"
              onClick={() => props.onFocus(active ? null : share.owner)}
            >
              <span className="font-mono text-text-primary">{share.owner}</span>
              <span className="ms-auto text-text-tertiary">
                {t("desktop.measure.turn.pluginRow", {
                  ms: share.hookMs,
                  tokens: share.sectionTokens,
                  problems: share.problems,
                  cache: share.cacheEvents,
                })}
              </span>
            </Button>
          </li>
        );
      })}
      <Capped total={props.plugins.length} />
    </ul>
  );
}

function HookRows(props: {
  readonly hooks: readonly HookEventVM[];
  readonly focus: string | null;
}): ReactNode {
  if (props.hooks.length === 0)
    return <p className={MUTED}>{t("desktop.measure.turn.hooksNone")}</p>;
  const longest = Math.max(1, ...props.hooks.map((hook) => hook.ms));
  return (
    <ol className="m-0 grid list-none gap-1 p-0 text-ui-sm">
      {props.hooks.slice(0, TURN_LIST_CAP).map((hook) => {
        const dim = props.focus !== null && props.focus !== hook.registrationId;
        return (
          <li
            key={`${hook.seq}:${hook.registrationId}:${hook.hook}`}
            className={`grid gap-0.5 ${dim ? "opacity-40" : ""}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-text-tertiary">
                {t("desktop.measure.turn.stepOf", { step: hook.step })}
              </span>
              <span className="font-mono text-text-primary">{hook.hook}</span>
              <span className="font-mono text-text-secondary">{hook.registrationId}</span>
              <span className="text-text-secondary">{outcomeText(hook.outcome)}</span>
              <span className="ms-auto font-mono text-text-primary">
                {t("desktop.measure.ms", { ms: hook.ms })}
              </span>
            </div>
            <div
              className={`h-1 rounded-sm ${hook.outcome.problem ? "bg-danger-graphic" : "bg-border-strong"}`}
              style={{ width: `${Math.max(1, Math.round((hook.ms / longest) * 100))}%` }}
            />
          </li>
        );
      })}
      <Capped total={props.hooks.length} />
    </ol>
  );
}

function Bar(props: { readonly bar: CompositionBarVM; readonly focus: string | null }): ReactNode {
  const { bar } = props;
  const sum = Math.max(
    1,
    bar.segments.reduce((total, segment) => total + segment.tokens, 0),
  );
  return (
    <li className="grid gap-0.5 text-ui-sm">
      <div className="flex items-center gap-2">
        <span className="text-text-tertiary">
          {t("desktop.measure.turn.stepOf", { step: bar.step })}
        </span>
        <span className="ms-auto font-mono text-text-primary">
          {t("desktop.measure.turn.barTotal", {
            total: numberText(bar.total),
            tools: numberText(bar.tools),
          })}
        </span>
      </div>
      <div
        className="flex h-3 overflow-hidden rounded-sm"
        role="img"
        aria-label={t("desktop.measure.turn.bars")}
      >
        {bar.segments.map((segment) => {
          const dim =
            props.focus !== null && !(segment.part === "section" && segment.owner === props.focus);
          return (
            <div
              key={`${segment.part}:${segment.owner ?? ""}`}
              className={`${PART_CLASS[segment.part] ?? "bg-neutral-track"} ${dim ? "opacity-40" : ""}`}
              style={{ width: `${(segment.tokens / sum) * 100}%` }}
              title={`${partText(segment.part, segment.owner)} ${numberText(segment.tokens)}`}
            />
          );
        })}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-3 p-0 text-text-tertiary">
        {bar.segments.map((segment) => (
          <li key={`${segment.part}:${segment.owner ?? ""}`}>
            {partText(segment.part, segment.owner)} {numberText(segment.tokens)}
          </li>
        ))}
      </ul>
    </li>
  );
}

function ReadyView(props: { readonly view: TurnViewVM }): ReactNode {
  const { view } = props;
  const [focus, setFocus] = useState<string | null>(null);
  return (
    <div className="grid gap-4 text-ui-sm">
      {view.summary !== null && (
        <p className="m-0 flex flex-wrap gap-x-4 text-text-primary">
          <span>
            {t("desktop.measure.turn.summary", {
              status: view.summary.status,
              steps: view.summary.steps,
              tokens: numberText(view.summary.totalTokens),
            })}
          </span>
          <span>{t("desktop.measure.turn.hookTotal", { ms: view.hookTotalMs })}</span>
        </p>
      )}
      <section aria-label={t("desktop.measure.turn.plugins")} className="grid gap-1">
        <Heading>{t("desktop.measure.turn.plugins")}</Heading>
        <PluginRows plugins={view.plugins} focus={focus} onFocus={setFocus} />
      </section>
      <section aria-label={t("desktop.measure.turn.hooks")} className="grid gap-1">
        <Heading>{t("desktop.measure.turn.hooks")}</Heading>
        <HookRows hooks={view.hooks} focus={focus} />
      </section>
      <section aria-label={t("desktop.measure.turn.bars")} className="grid gap-1">
        <Heading>{t("desktop.measure.turn.bars")}</Heading>
        {view.bars.length === 0 ? (
          <p className={MUTED}>{t("desktop.measure.turn.barsNone")}</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {view.bars.slice(0, TURN_LIST_CAP).map((bar) => (
              <Bar key={bar.step} bar={bar} focus={focus} />
            ))}
          </ul>
        )}
      </section>
      <section aria-label={t("desktop.measure.turn.cache")} className="grid gap-1">
        <Heading>{t("desktop.measure.turn.cache")}</Heading>
        {view.cache.length === 0 ? (
          <p className={MUTED}>{t("desktop.measure.turn.cacheNone")}</p>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0">
            {view.cache.slice(0, TURN_LIST_CAP).map((event) => (
              <li
                key={`${event.step}:${event.code}:${event.owner}:${event.at ?? ""}:${event.from}:${event.to}`}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="text-text-tertiary">
                  {t("desktop.measure.turn.stepOf", { step: event.step })}
                </span>
                <span className="text-text-primary">{cacheCodeText(event.code)}</span>
                <span className="font-mono text-text-secondary">{cacheOwnerText(event.owner)}</span>
                <span className="ms-auto text-text-tertiary">{cacheDetailText(event)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TurnBody(props: { readonly result: MeasureTurnResult }): ReactNode {
  const state = turnViewOf(props.result);
  switch (state.kind) {
    case "off":
      return <p className={MUTED}>{t("desktop.measure.off")}</p>;
    case "empty":
      return <p className={MUTED}>{t("desktop.measure.turn.empty")}</p>;
    case "ready":
      return <ReadyView view={state.view} />;
    default:
      return assertNever(state, "TurnViewState");
  }
}

export function TurnView(props: { readonly read: TabRead<MeasureTurnResult> }): ReactNode {
  return <TabBody read={props.read} render={(result) => <TurnBody result={result} />} />;
}

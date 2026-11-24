// 구성 탭 캔버스 위 떠 있는 설명 판(plugHead, AGE-76 "우측 훅도 사용자 입장에서 이게 뭐지? … 플로팅 패널 형태로").
// 예전 오른쪽 단의 훅 표(이름, fold, 예산, p95, 실패)를 대신한다. 캔버스에서 고른 것이 무엇이고, 루프의 언제 불리며, 무엇을 하는지를 사람 말로 보이고,
// 훅 이름과 잰 값은 그 아래에 둔다. 아무것도 고르지 않았으면 이 플러그인이 루프에 붙는 곳의 요약(누르면 그것을 고른다)과 Drive 구성 검사, 구성원이다.
// 면은 프로필 캔버스의 떠 있는 판(cv6)과 같은 말이다: surface.base, border.subtle 1px, 큰 둥근 모서리, 그림자. 닫으면 오른쪽 위의 "설명 보기" 단추 하나로 접힌다.
// 도움말(캔버스 읽는 법)은 제목 옆 정보 아이콘 한 번에 나온다.
import { activeLocale, t, type MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { BLOCK_MODEL } from "@fresnel/contracts/blocks";
import type { WireManifestIssue } from "@fresnel/contracts/wire";
import { Button, IconButton, Progress } from "@caustic/react";
import { Info, X } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { FOLD_WORD } from "../canvas/cv6/facts.ts";
import { InfoTip } from "../info-tip.tsx";
import { PRODUCT_TEXT, issueTextOf } from "../composition/composition-text.ts";
import { KindTag } from "../../workbench/plugin-kind.tsx";
import { PANEL_END } from "../../workbench/detail-rail.ts";
import {
  hookLinesOf,
  hooksBySpot,
  pointOfSpot,
  spotKey,
  type FeedPoint,
  type LoopHook,
  type LoopPick,
  type LoopPlan,
  type OutsideItem,
  type PointId,
  RAIL_POINTS,
} from "./loop-model.ts";
import {
  FEED_ITEM_WORD,
  FEED_WORD,
  POINT_WHAT,
  POINT_WORD,
  POWER_WORD,
  spotWord,
} from "./loop-text.ts";

/** ms 값의 글. 1초 이상은 초로 줄인다(예전 훅 표와 같다) */
function msText(value: number): string {
  return value >= 1000 ? `${value / 1000}s` : `${value}ms`;
}

/** 예산 막대의 색(예전 훅 표, 확장 상세의 `BAR_TONE`과 같다): 50% 넘으면 warning, 100%면 danger */
const BAR_TONE = { normal: "accent", warning: "warning", danger: "danger" } as const;

/** 판 안 구역: 작은 머리 글과 내용 */
function Section(props: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <section className="grid gap-1.5">
      <h4 className="m-0 text-ui-sm text-text-tertiary">{props.title}</h4>
      <div className="grid gap-1 text-ui text-text-primary">{props.children}</div>
    </section>
  );
}

/** 요약과 지점 설명의 한 줄: 누르면 그것을 고른다 */
function PickRow(props: {
  readonly kind: "inject" | "tool" | "hook" | "drive";
  readonly text: string;
  readonly meta?: string;
  readonly onPick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className="-mx-2 flex min-h-8 items-center gap-2 rounded-md px-2 text-start outline-none hover:bg-neutral-hover focus-visible:shadow-focus"
      onClick={props.onPick}
    >
      <KindTag kind={props.kind} />
      <span className="min-w-0 flex-1 truncate text-ui text-text-primary">{props.text}</span>
      {props.meta === undefined ? null : (
        <span className="flex-none text-ui-sm tabular-nums text-text-tertiary">{props.meta}</span>
      )}
    </button>
  );
}

/** 루프 밖에서 주는 것: 종류마다 한 줄, 이름은 셋까지 보이고 나머지는 "외 N개"다 */
const OUTSIDE_KINDS: readonly OutsideItem["kind"][] = ["service", "screen"];
const OUTSIDE_SHOWN = 3;

/** 루프 밖에서 주는 것의 종류 말 */
const OUTSIDE_WORD: Readonly<Record<OutsideItem["kind"], MessageId>> = {
  service: "desktop.craft.loop.item.service",
  screen: "desktop.craft.loop.item.screen",
};

function feedKind(point: FeedPoint): "inject" | "tool" {
  return point === "tools" ? "tool" : "inject";
}

/** 이 플러그인이 지점 하나에 붙이는 것들의 줄 */
function attachRows(plan: LoopPlan, point: PointId, onPick: (pick: LoopPick) => void): ReactNode[] {
  const rows: ReactNode[] = [];
  for (const feed of plan.feeds) {
    if (feed.point !== point) continue;
    rows.push(
      <PickRow
        key={`feed:${feed.point}`}
        kind={feedKind(feed.point)}
        text={t(FEED_WORD[feed.point])}
        meta={t("desktop.craft.loop.count", { count: feed.items.length })}
        onPick={() => {
          onPick({ kind: "feed", point: feed.point });
        }}
      />,
    );
  }
  // 같은 자리에서 같은 일을 하는 훅은 캔버스 카드처럼 한 줄로 묶고 수를 붙인다
  for (const group of hooksBySpot(plan.hooks)) {
    if (pointOfSpot(group.spot) !== point) continue;
    for (const line of hookLinesOf(group.hooks)) {
      const first = line.hooks[0];
      if (first === undefined) continue;
      rows.push(
        <PickRow
          key={`hook:${spotKey(group.spot)}:${first.name}`}
          kind="hook"
          text={`${t(spotWord(group.spot))}: ${line.power === null ? first.name : t(POWER_WORD[line.power])}`}
          {...(line.hooks.length > 1
            ? { meta: t("desktop.craft.loop.count", { count: line.hooks.length }) }
            : {})}
          onPick={() => {
            onPick({ kind: "hook", name: first.name });
          }}
        />,
      );
    }
  }
  for (const step of plan.drive?.steps ?? []) {
    if (!step.spots.some((s) => pointOfSpot(s) === point)) continue;
    rows.push(
      <PickRow
        key={`step:${step.row.id}`}
        kind="drive"
        text={step.row.title}
        onPick={() => {
          onPick({ kind: "step", id: step.row.id });
        }}
      />,
    );
  }
  return rows;
}

/** 엔진이 이 블록에서 지키는 것(블록 모델의 보장 문구, 화면 언어로) */
function guaranteesOf(point: PointId): readonly string[] {
  const block = BLOCK_MODEL.blocks.find((b) => b.id === point);
  if (block === undefined) return [];
  const ko = activeLocale().startsWith("ko");
  return block.guarantees.map((g) => (ko ? g.text.ko : g.text.en));
}

/** 좁은 칸(720 이하, DP-49)의 개요: 캔버스 대신 루프의 지점을 차례로 적고 지점마다 이 플러그인이 붙이는 것을 줄로 보인다 */
const OUTLINE: readonly PointId[] = [...RAIL_POINTS, "record"];

function Outline(props: {
  readonly plan: LoopPlan;
  readonly onPick: (pick: LoopPick) => void;
}): ReactNode {
  return (
    <ol aria-label={t("desktop.craft.loop.label")} className="m-0 grid list-none gap-3 p-0">
      {OUTLINE.map((point) => {
        const rows = attachRows(props.plan, point, props.onPick);
        return (
          <li key={point} className="grid gap-1">
            <span
              className={`text-ui-strong ${rows.length === 0 ? "text-text-tertiary" : "text-text-primary"}`}
            >
              {t(POINT_WORD[point])}
            </span>
            {rows}
          </li>
        );
      })}
    </ol>
  );
}

function Summary(props: {
  readonly plan: LoopPlan;
  readonly onPick: (pick: LoopPick) => void;
  readonly extra: ReactNode;
  readonly inline: boolean;
}): ReactNode {
  const { plan } = props;
  const groups = hooksBySpot(plan.hooks);
  const empty = plan.feeds.length === 0 && groups.length === 0 && plan.drive === null;
  return (
    <>
      <p className="m-0 text-ui text-text-secondary">
        {t(props.inline ? "desktop.craft.loop.panel.hintList" : "desktop.craft.loop.panel.hint")}
      </p>
      {props.inline ? (
        <>
          <Outline plan={plan} onPick={props.onPick} />
          {plan.drive === null ? null : (
            <PickRow
              kind="drive"
              text={t("desktop.craft.canvas.cv3.fact.changes.holdsTurn")}
              meta={t("desktop.craft.loop.steps", { count: plan.drive.steps.length })}
              onPick={() => {
                props.onPick({ kind: "drive" });
              }}
            />
          )}
        </>
      ) : empty ? (
        <p className="m-0 text-ui text-text-tertiary">{t("desktop.craft.loop.panel.empty")}</p>
      ) : (
        <Section title={t("desktop.craft.loop.panel.attaches")}>
          {plan.feeds.map((feed) => (
            <PickRow
              key={feed.point}
              kind={feedKind(feed.point)}
              text={t(FEED_WORD[feed.point])}
              meta={t("desktop.craft.loop.count", { count: feed.items.length })}
              onPick={() => {
                props.onPick({ kind: "feed", point: feed.point });
              }}
            />
          ))}
          {groups.map((group) => {
            const first = group.hooks[0];
            return first === undefined ? null : (
              <PickRow
                key={spotKey(group.spot)}
                kind="hook"
                text={t(spotWord(group.spot))}
                meta={t("desktop.craft.loop.count", { count: group.hooks.length })}
                onPick={() => {
                  props.onPick({ kind: "hook", name: first.name });
                }}
              />
            );
          })}
          {plan.drive === null ? null : (
            <PickRow
              kind="drive"
              text={t("desktop.craft.canvas.cv3.fact.changes.holdsTurn")}
              meta={t("desktop.craft.loop.steps", { count: plan.drive.steps.length })}
              onPick={() => {
                props.onPick({ kind: "drive" });
              }}
            />
          )}
        </Section>
      )}
      {plan.outside.length === 0 ? null : (
        <Section title={t("desktop.craft.loop.panel.provides")}>
          {OUTSIDE_KINDS.map((kind) => {
            const names = plan.outside
              .filter((item) => item.kind === kind)
              .map((item) => item.name);
            if (names.length === 0) return null;
            const more = names.length - OUTSIDE_SHOWN;
            return (
              <p key={kind} className="m-0 flex min-w-0 items-baseline gap-2">
                <span className="flex-none text-ui-sm text-text-tertiary">
                  {t(OUTSIDE_WORD[kind])}
                </span>
                <span className="min-w-0 truncate font-mono text-ui-sm text-text-secondary">
                  {names.slice(0, OUTSIDE_SHOWN).join(", ")}
                </span>
                {more > 0 ? (
                  <span className="flex-none text-ui-sm text-text-tertiary">
                    {t("desktop.craft.loop.more", { count: more })}
                  </span>
                ) : null}
              </p>
            );
          })}
        </Section>
      )}
      {props.extra}
    </>
  );
}

function PointBody(props: {
  readonly plan: LoopPlan;
  readonly point: PointId;
  readonly onPick: (pick: LoopPick) => void;
}): ReactNode {
  const rows = attachRows(props.plan, props.point, props.onPick);
  const guarantees = guaranteesOf(props.point);
  return (
    <>
      <Section title={t("desktop.craft.loop.sec.what")}>
        <p className="m-0">{t(POINT_WHAT[props.point])}</p>
      </Section>
      <Section title={t("desktop.craft.loop.sec.here")}>
        {rows.length === 0 ? (
          <p className="m-0 text-text-tertiary">{t("desktop.craft.loop.here.none")}</p>
        ) : (
          rows
        )}
      </Section>
      {guarantees.length === 0 ? null : (
        <Section title={t("desktop.craft.loop.sec.guarantees")}>
          {guarantees.map((text) => (
            <p key={text} className="m-0 text-text-secondary">
              {text}
            </p>
          ))}
        </Section>
      )}
    </>
  );
}

function HookBody(props: {
  readonly plan: LoopPlan;
  readonly hook: LoopHook;
  readonly traceOff: boolean;
  readonly onPick: (pick: LoopPick) => void;
}): ReactNode {
  const { hook } = props;
  const keys = new Set(hook.spots.map(spotKey));
  const others = props.plan.hooks.filter(
    (other) => other.name !== hook.name && other.spots.some((spot) => keys.has(spotKey(spot))),
  );
  const m = hook.measure;
  return (
    <>
      <Section title={t("desktop.craft.loop.sec.when")}>
        {!hook.known ? (
          <p className="m-0 text-text-secondary">{t("desktop.craft.loop.hook.unknown")}</p>
        ) : (
          hook.spots.map((spot) => {
            const point = pointOfSpot(spot);
            return (
              <p key={spotKey(spot)} className="m-0">
                <span className="text-text-primary">{t(spotWord(spot))}</span>
                <span className="block text-text-secondary">
                  {point === null ? t("desktop.craft.loop.hook.outside") : t(POINT_WHAT[point])}
                </span>
              </p>
            );
          })
        )}
        {hook.known && hook.event ? (
          <p className="m-0 text-text-secondary">{t("desktop.craft.loop.hook.event")}</p>
        ) : null}
        {hook.known && !hook.fired ? (
          <p className="m-0 text-warning-text">{t("desktop.craft.loop.hook.notFired")}</p>
        ) : null}
      </Section>
      {hook.powers.length === 0 ? null : (
        <Section title={t("desktop.craft.loop.sec.does")}>
          {hook.powers.map((power) => (
            <p key={power} className="m-0">
              {t(POWER_WORD[power])}
            </p>
          ))}
        </Section>
      )}
      {hook.fold === null ? null : (
        <Section title={t("desktop.craft.loop.sec.many")}>
          <p className="m-0">{t(FOLD_WORD[hook.fold])}</p>
        </Section>
      )}
      <Section title={t("desktop.craft.loop.sec.measure")}>
        {m === null ? (
          <p className="m-0 text-text-tertiary">{t("desktop.craft.loop.measure.none")}</p>
        ) : (
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-text-secondary">{t("desktop.workbench.detail.hooks.budget")}</dt>
            <dd className="m-0 text-end tabular-nums">{msText(m.budgetMs)}</dd>
            <dt className="text-text-secondary">p95</dt>
            <dd className="m-0 text-end tabular-nums">
              {m.p95Ms === null ? "—" : msText(m.p95Ms)}
            </dd>
            <dt className="text-text-secondary">
              {t("desktop.workbench.detail.hooks.col.failures")}
            </dt>
            <dd className="m-0 text-end tabular-nums">
              {m.failures === null ? "—" : String(m.failures)}
            </dd>
            {m.p95Ms === null || m.level === null || m.budgetMs <= 0 ? null : (
              <>
                <dt className="text-text-secondary">
                  {t("desktop.workbench.detail.hooks.col.use")}
                </dt>
                <dd className="m-0 flex items-center justify-end gap-2">
                  <Progress
                    value={Math.max(2, Math.round((m.p95Ms / m.budgetMs) * 100))}
                    size="sm"
                    tone={BAR_TONE[m.level]}
                    label={t("desktop.workbench.detail.hooks.col.use")}
                    className="w-14"
                  />
                  <span className="tabular-nums">
                    {m.p95Ms / m.budgetMs < 0.01
                      ? "<1%"
                      : `${Math.round((m.p95Ms / m.budgetMs) * 100)}%`}
                  </span>
                </dd>
              </>
            )}
          </dl>
        )}
        {props.traceOff ? (
          <p className="m-0 text-text-tertiary">{t("desktop.inspect.hook.traceOff")}</p>
        ) : null}
      </Section>
      <Section title={t("desktop.craft.loop.sec.name")}>
        <p className="m-0 font-mono text-ui-sm text-text-secondary">{hook.name}</p>
      </Section>
      {others.length === 0 ? null : (
        <Section title={t("desktop.craft.loop.sec.others")}>
          {others.map((other) => {
            const power = other.powers[0];
            return (
              <PickRow
                key={other.name}
                kind="hook"
                text={power === undefined ? other.name : t(POWER_WORD[power])}
                meta={other.name}
                onPick={() => {
                  props.onPick({ kind: "hook", name: other.name });
                }}
              />
            );
          })}
        </Section>
      )}
    </>
  );
}

function FeedBody(props: { readonly plan: LoopPlan; readonly point: FeedPoint }): ReactNode {
  const feed = props.plan.feeds.find((f) => f.point === props.point);
  return (
    <>
      <Section title={t("desktop.craft.loop.sec.what")}>
        <p className="m-0">{t(POINT_WHAT[props.point])}</p>
      </Section>
      <Section title={t("desktop.craft.loop.sec.puts")}>
        {(feed?.items ?? []).map((item) => (
          <p key={`${item.kind}:${item.name}`} className="m-0 flex min-w-0 items-baseline gap-2">
            <span className="flex-none text-ui-sm text-text-tertiary">
              {t(FEED_ITEM_WORD[item.kind])}
            </span>
            <span className="min-w-0 truncate font-mono text-ui-sm">{item.name}</span>
          </p>
        ))}
      </Section>
    </>
  );
}

function DriveBody(props: {
  readonly plan: LoopPlan;
  readonly onPick: (pick: LoopPick) => void;
}): ReactNode {
  const drive = props.plan.drive;
  if (drive === null) return null;
  return (
    <>
      <Section title={t("desktop.craft.loop.sec.what")}>
        <p className="m-0">{t("desktop.craft.loop.drive.what")}</p>
      </Section>
      {drive.commands.length === 0 ? null : (
        <Section title={t("desktop.craft.loop.sec.commands")}>
          {drive.commands.map((command) => (
            <p key={command} className="m-0 font-mono text-ui-sm">
              {command}
            </p>
          ))}
        </Section>
      )}
      <Section title={t("desktop.craft.loop.sec.steps")}>
        {drive.steps.length === 0 ? (
          <p className="m-0 text-text-tertiary">{t("desktop.craft.composition.none.title")}</p>
        ) : (
          drive.steps.map((step) => (
            <PickRow
              key={step.row.id}
              kind="drive"
              text={step.row.title}
              onPick={() => {
                props.onPick({ kind: "step", id: step.row.id });
              }}
            />
          ))
        )}
      </Section>
    </>
  );
}

function StepBody(props: {
  readonly plan: LoopPlan;
  readonly id: string;
  readonly issues: readonly WireManifestIssue[];
}): ReactNode {
  const step = props.plan.drive?.steps.find((s) => s.row.id === props.id);
  if (step === undefined) return null;
  const { row } = step;
  return (
    <>
      {row.summary === null ? null : (
        <Section title={t("desktop.craft.loop.sec.what")}>
          <p className="m-0">{row.summary}</p>
        </Section>
      )}
      {row.memberTitle === null && row.plugin === null ? null : (
        <p className="m-0 text-ui-sm text-text-tertiary">
          {t("desktop.craft.composition.block.member", {
            name: row.memberTitle ?? row.plugin ?? "",
          })}
        </p>
      )}
      <Section title={t("desktop.craft.loop.sec.when")}>
        {step.spots.length === 0 ? (
          <p className="m-0 text-text-tertiary">{t("desktop.craft.loop.step.noSpot")}</p>
        ) : (
          step.spots.map((spot) => (
            <p key={spotKey(spot)} className="m-0">
              {t(spotWord(spot))}
            </p>
          ))
        )}
      </Section>
      {row.consumes.length === 0 ? null : (
        <Section title={t("desktop.craft.loop.sec.uses")}>
          {row.consumes.map((id) => (
            <p key={id} className="m-0 font-mono text-ui-sm">
              {id}
            </p>
          ))}
        </Section>
      )}
      {row.produces.length === 0 ? null : (
        <Section title={t("desktop.craft.composition.outputs")}>
          {row.produces.map((product) => (
            <p
              key={`${product.kind}:${product.recordKind ?? ""}`}
              className="m-0 flex items-baseline gap-2"
            >
              <span>{t(PRODUCT_TEXT[product.kind])}</span>
              {product.recordKind === null ? null : (
                <span className="min-w-0 truncate font-mono text-ui-sm text-text-secondary">
                  {product.recordKind}
                </span>
              )}
            </p>
          ))}
        </Section>
      )}
      {props.issues.length === 0 ? null : (
        <Section title={t("desktop.craft.loop.sec.issues")}>
          {props.issues.map((issue) => (
            <p
              key={`${issue.code}:${issue.path}`}
              role="alert"
              className={`m-0 ${issue.severity === "error" ? "text-danger-text" : "text-warning-text"}`}
            >
              <span className="font-mono">{issue.code}</span> {issueTextOf(issue)}
            </p>
          ))}
        </Section>
      )}
    </>
  );
}

/** 고른 것의 제목 */
function titleOf(plan: LoopPlan, pick: LoopPick | null): string {
  if (pick === null) return t("desktop.craft.loop.panel.title");
  switch (pick.kind) {
    case "point":
      return t(POINT_WORD[pick.point]);
    case "feed":
      return t(FEED_WORD[pick.point]);
    case "drive":
      return t("desktop.craft.canvas.cv3.kind.drive");
    case "step":
      return plan.drive?.steps.find((s) => s.row.id === pick.id)?.row.title ?? pick.id;
    case "hook": {
      const hook = plan.hooks.find((h) => h.name === pick.name);
      const spot = hook?.spots[0];
      return spot === undefined ? pick.name : t(spotWord(spot));
    }
    default:
      return assertNever(pick, "titleOf");
  }
}

/** 캔버스 읽는 법(정보 아이콘 뒤) */
const HELP: readonly MessageId[] = [
  "desktop.craft.loop.help.rail",
  "desktop.craft.loop.help.called",
  "desktop.craft.loop.help.feed",
  "desktop.craft.loop.help.hook",
  "desktop.craft.loop.help.drive",
];

export function LoopPanel(props: {
  readonly plan: LoopPlan;
  readonly pick: LoopPick | null;
  readonly onPick: (pick: LoopPick | null) => void;
  readonly open: boolean;
  readonly onOpen: (open: boolean) => void;
  /** 훅 계측이 꺼졌나(잰 값 아래 한 줄) */
  readonly traceOff: boolean;
  /** Drive 단계마다의 검사 이슈 */
  readonly issues: ReadonlyMap<string, readonly WireManifestIssue[]>;
  /** 요약 아래에 붙는 것(Drive 구성 검사, 구성원) */
  readonly extra: ReactNode;
  /** 좁은 칸(720 이하, DP-49): 떠 있지 않고 칸 전체 폭에 놓이며, 요약은 루프 개요다. 닫기 단추가 없다 */
  readonly inline?: boolean;
}): ReactNode {
  const { plan, pick } = props;
  const inline = props.inline === true;
  const label = t("desktop.craft.loop.panel.title");
  const picked = (next: LoopPick): void => {
    props.onPick(next);
  };
  let body: ReactNode;
  if (pick === null)
    body = <Summary plan={plan} onPick={picked} extra={props.extra} inline={inline} />;
  else if (pick.kind === "point")
    body = <PointBody plan={plan} point={pick.point} onPick={picked} />;
  else if (pick.kind === "feed") body = <FeedBody plan={plan} point={pick.point} />;
  else if (pick.kind === "drive") body = <DriveBody plan={plan} onPick={picked} />;
  else if (pick.kind === "step")
    body = <StepBody plan={plan} id={pick.id} issues={props.issues.get(pick.id) ?? []} />;
  else {
    const hook = plan.hooks.find((h) => h.name === pick.name);
    body =
      hook === undefined ? null : (
        <HookBody plan={plan} hook={hook} traceOff={props.traceOff} onPick={picked} />
      );
  }
  if (inline) {
    return (
      <section aria-label={label} className="grid content-start gap-4">
        <header className="flex min-h-8 items-center gap-2">
          <h3 className="m-0 min-w-0 flex-1 truncate text-title-3 text-text-primary">
            {titleOf(plan, pick)}
          </h3>
          {pick === null ? null : (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                props.onPick(null);
              }}
            >
              {t("desktop.craft.loop.panel.summary")}
            </Button>
          )}
        </header>
        {body}
      </section>
    );
  }
  return (
    <div
      className={`pointer-events-none absolute top-3 bottom-4 ${PANEL_END} flex flex-col items-end group-data-[panel-at=bottom]/loop:justify-end`}
    >
      {props.open ? (
        <section
          data-loop-panel-body
          aria-label={label}
          className="pointer-events-auto flex max-h-full w-72 flex-col rounded-3xl border border-border-subtle bg-surface-base shadow-3 group-data-[panel-at=bottom]/loop:max-h-[var(--loop-panel-room)]"
          onClick={(e) => {
            e.stopPropagation();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              props.onPick(null);
            }
          }}
        >
          <header className="flex flex-none items-center gap-2 ps-5 pe-3 pt-3 pb-2">
            <h3 className="m-0 min-w-0 flex-1 truncate text-title-3 text-text-primary">
              {titleOf(plan, pick)}
            </h3>
            <InfoTip text={HELP.map((id) => t(id))} label={t("desktop.craft.loop.help.label")} />
            {pick === null ? null : (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  props.onPick(null);
                }}
              >
                {t("desktop.craft.loop.panel.summary")}
              </Button>
            )}
            <IconButton
              size="xs"
              variant="ghost"
              label={t("desktop.craft.loop.panel.close")}
              onClick={() => {
                props.onOpen(false);
              }}
            >
              <X aria-hidden />
            </IconButton>
          </header>
          <div className="grid min-h-0 content-start gap-4 overflow-y-auto px-5 pb-5">{body}</div>
        </section>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="pointer-events-auto bg-surface-base shadow-2"
          onClick={(e) => {
            e.stopPropagation();
            props.onOpen(true);
          }}
        >
          <Info aria-hidden />
          {t("desktop.craft.loop.panel.open")}
        </Button>
      )}
    </div>
  );
}

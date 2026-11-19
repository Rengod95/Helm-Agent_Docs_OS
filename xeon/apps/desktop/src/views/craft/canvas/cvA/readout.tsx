// cvA 고른 것의 가벼운 상세(오른쪽 아래 계기판. 위쪽은 Drive와 묶음이 서는 자리라 비워 둔다). 그 노드에 필요한 것만: 종류, 붙는 곳과 순서, 결정(Hook), 핸드오프(Drive),
// 담은 것, 최근 사용 한 줄, 그리고 할 수 있는 일(내부 열기, 앞·뒤로, 빼기). 베이스에서 온 것은 여기서 빼지 않는다.
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { KIND_INK, KindGlyph } from "./glyphs.tsx";
import {
  DECISIONS,
  isBase,
  orderInStack,
  stackKeyOf,
  type Catalog,
  type Group,
  type PluginSpec,
  type ProfileModel,
} from "./model.ts";
import {
  DECISION_KEY,
  KIND_KEY,
  groupName,
  holdingText,
  portName,
  recentText,
  stationName,
} from "./words.ts";

function Row(props: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-7 items-baseline gap-3">
      <dt className="cva-mono w-16 shrink-0 text-[11px] text-text-tertiary">{props.label}</dt>
      <dd className="m-0 min-w-0 flex-1 text-[12px] text-text-primary">{props.children}</dd>
    </div>
  );
}

function Action(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly tone?: "danger";
  readonly icon: string;
}): ReactNode {
  return (
    <button
      type="button"
      disabled={props.disabled === true}
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className={`cva-row flex h-7 min-w-7 items-center justify-center gap-1.5 px-1.5 text-[12px] disabled:opacity-35 ${props.tone === "danger" ? "text-danger-text" : "text-text-secondary"}`}
    >
      <svg aria-hidden width="14" height="14" viewBox="0 0 14 14">
        <path
          d={props.icon}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/** 붙는 곳 한 줄 */
function whereOf(spec: PluginSpec, profile: ProfileModel, catalog: Catalog): string {
  const key = stackKeyOf(spec);
  const n = orderInStack(profile, catalog, spec.name);
  if (key.lane === "feed")
    return t("desktop.craft.canvas.cvA.where.feed", { station: stationName(key.station), n });
  if (key.lane === "hook")
    return t("desktop.craft.canvas.cvA.where.hook", { port: portName(key.port), n });
  if (profile.startDrive === spec.name)
    return t("desktop.craft.canvas.cvA.where.start", { station: stationName("input-received") });
  return t("desktop.craft.canvas.cvA.where.drive");
}

export interface ReadoutActions {
  readonly open: (name: string) => void;
  readonly nudge: (name: string, delta: -1 | 1) => void;
  readonly remove: (name: string) => void;
  readonly close: () => void;
}

export function PluginReadout(props: {
  readonly spec: PluginSpec;
  readonly profile: ProfileModel;
  readonly catalog: Catalog;
  readonly actions: ReadoutActions;
}): ReactNode {
  const { spec, profile, catalog, actions } = props;
  const base = isBase(profile, spec.name);
  const receivesFrom = [...catalog.values()].filter(
    (s) => s.handoffTo?.includes(spec.name) === true && profile.plugins.includes(s.name),
  );
  return (
    <Shell onClose={actions.close} kind={spec.kind}>
      <div className="flex items-center gap-2.5 pe-8">
        <span style={{ color: KIND_INK[spec.kind] }} className="flex">
          <KindGlyph kind={spec.kind} size={18} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[15px] leading-5 font-semibold text-text-primary">
            {spec.name}
          </div>
          <div className="cva-mono text-[11px] text-text-tertiary">
            {[
              t(KIND_KEY[spec.kind]),
              base ? t("desktop.craft.canvas.cvA.mark.base") : null,
              spec.draft === true ? t("desktop.craft.canvas.cvA.mark.draft") : null,
              spec.guard === true ? t("desktop.craft.canvas.cvA.mark.guard") : null,
            ]
              .filter((x) => x !== null)
              .join(" · ")}
          </div>
        </div>
      </div>
      <dl className="m-0 mt-3 flex flex-col">
        <Row label={t("desktop.craft.canvas.cvA.readout.where")}>
          {whereOf(spec, profile, catalog)}
        </Row>
        {spec.kind === "hook" ? (
          <Row label={t("desktop.craft.canvas.cvA.readout.decision")}>
            <span className="flex gap-1">
              {DECISIONS.map((d) => (
                <span
                  key={d}
                  className={`px-1.5 py-0.5 text-[11px] ${d === spec.decision ? "text-text-primary" : "text-text-tertiary"}`}
                  style={
                    d === spec.decision
                      ? { boxShadow: "inset 0 0 0 1px var(--cva-hook)" }
                      : { boxShadow: "inset 0 0 0 1px var(--cva-line-soft)" }
                  }
                >
                  {t(DECISION_KEY[d])}
                </span>
              ))}
            </span>
          </Row>
        ) : null}
        {spec.handoffTo !== undefined && spec.handoffTo.length > 0 ? (
          <Row label={t("desktop.craft.canvas.cvA.readout.handoff")}>
            <span className="cva-mono">{spec.handoffTo.join(", ")}</span>
          </Row>
        ) : null}
        {receivesFrom.length > 0 ? (
          <Row label={t("desktop.craft.canvas.cvA.readout.receives")}>
            <span className="cva-mono">{receivesFrom.map((s) => s.name).join(", ")}</span>
          </Row>
        ) : null}
        {spec.holds.length > 0 ? (
          <Row label={t("desktop.craft.canvas.cvA.readout.holds")}>
            {spec.holds.map(holdingText).join(" · ")}
          </Row>
        ) : null}
      </dl>
      {spec.draft === true ? (
        <div className="mt-2 flex items-center gap-2 py-1.5 text-[12px] text-text-secondary">
          <span aria-hidden className="h-px w-3 bg-[var(--cva-line-hot)]" />
          {t("desktop.craft.canvas.cvA.readout.draftNote")}
        </div>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--cva-line-soft)] pt-2">
        <span className="cva-mono truncate text-[11px] text-text-tertiary">
          {recentText(spec.lastUsedMin)}
        </span>
        <div className="flex items-center">
          <Action
            label={t("desktop.craft.canvas.cvA.action.earlier")}
            icon="M7 11V3M3.5 6.5 7 3l3.5 3.5"
            onClick={() => {
              actions.nudge(spec.name, -1);
            }}
          />
          <Action
            label={t("desktop.craft.canvas.cvA.action.later")}
            icon="M7 3v8M3.5 7.5 7 11l3.5-3.5"
            onClick={() => {
              actions.nudge(spec.name, 1);
            }}
          />
          <Action
            label={
              base
                ? t("desktop.craft.canvas.cvA.action.removeBase")
                : t("desktop.craft.canvas.cvA.action.remove")
            }
            icon="M3 7h8"
            tone="danger"
            disabled={base}
            onClick={() => {
              actions.remove(spec.name);
            }}
          />
          <button
            type="button"
            onClick={() => {
              actions.open(spec.name);
            }}
            className="cva-row ms-1 flex h-7 items-center gap-1 px-2 text-[12px] text-text-primary"
            style={{ boxShadow: "inset 0 0 0 1px var(--cva-line)" }}
          >
            {t("desktop.craft.canvas.cvA.action.open")}
            <svg aria-hidden width="12" height="12" viewBox="0 0 12 12">
              <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
        </div>
      </div>
    </Shell>
  );
}

export function GroupReadout(props: {
  readonly group: Group;
  readonly catalog: Catalog;
  readonly closed: boolean;
  readonly onToggle: () => void;
  readonly onPick: (name: string) => void;
  readonly onClose: () => void;
}): ReactNode {
  const { group, catalog } = props;
  return (
    <Shell onClose={props.onClose} kind={null}>
      <div className="pe-8 text-[15px] leading-5 font-semibold text-text-primary">
        {groupName(group.name)}
      </div>
      <div className="cva-mono text-[11px] text-text-tertiary">
        {t("desktop.craft.canvas.cvA.group.count", { n: group.members.length })}
      </div>
      <ul className="m-0 mt-3 flex list-none flex-col p-0">
        {group.members.map((m) => {
          const spec = catalog.get(m);
          if (spec === undefined) return null;
          return (
            <li key={m}>
              <button
                type="button"
                className="cva-row flex h-8 w-full items-center gap-2 px-1 text-start"
                onClick={() => {
                  props.onPick(m);
                }}
              >
                <span style={{ color: KIND_INK[spec.kind] }} className="flex">
                  <KindGlyph kind={spec.kind} size={14} />
                </span>
                <span className="flex-1 text-[13px] text-text-primary">{m}</span>
                <span className="cva-mono text-[11px] text-text-tertiary">
                  {t(KIND_KEY[spec.kind])}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex justify-end border-t border-[var(--cva-line-soft)] pt-2">
        <button
          type="button"
          onClick={props.onToggle}
          className="cva-row flex h-7 items-center px-2 text-[12px] text-text-primary"
          style={{ boxShadow: "inset 0 0 0 1px var(--cva-line)" }}
        >
          {t(
            props.closed
              ? "desktop.craft.canvas.cvA.group.expand"
              : "desktop.craft.canvas.cvA.group.collapse",
          )}
        </button>
      </div>
    </Shell>
  );
}

function Shell(props: {
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly kind: PluginSpec["kind"] | null;
}): ReactNode {
  return (
    <section
      aria-label={t("desktop.craft.canvas.cvA.readout.label")}
      data-kind={props.kind ?? undefined}
      className="cva-panel absolute right-3 bottom-14 z-10 w-[288px] px-4 pt-3.5 pb-2.5"
    >
      <span
        aria-hidden
        className="absolute top-0 left-0 h-px w-10"
        style={{ background: props.kind === null ? "var(--cva-line-hot)" : "var(--cva-ink)" }}
      />
      <button
        type="button"
        aria-label={t("desktop.craft.canvas.cvA.readout.close")}
        onClick={props.onClose}
        className="cva-row absolute top-2.5 right-2.5 flex size-7 items-center justify-center text-text-tertiary"
      >
        <svg aria-hidden width="12" height="12" viewBox="0 0 12 12">
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      {props.children}
    </section>
  );
}

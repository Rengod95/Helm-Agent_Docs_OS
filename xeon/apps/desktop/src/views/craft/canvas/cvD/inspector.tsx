// cvD 선택 상세: 고른 노드에 필요한 것만 든 가벼운 판(오른쪽에 뜬다). 플러그인은 자리·결정·순서·출처와 두 동작(안으로, 빼기),
// 블록은 붙은 플러그인, 묶음은 멤버와 접기.
import { t } from "@fresnel/client/i18n";
import type { ReactElement, ReactNode } from "react";
import { DecisionGlyph, Icon, KIND_COLOR, KindBadge } from "./glyphs.tsx";
import { entriesAt, type CanvasProfile, type Layout } from "./model.ts";
import { agoText } from "../shared-sample.ts";
import { pluginById, type BlockId } from "./sample.ts";
import { BLOCK_WORD, DECISION_WORD, KIND_WORD, pointWord } from "./words.ts";

const BTN =
  "inline-flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-medium outline-none focus-visible:outline-2 focus-visible:outline-[var(--cs-color-focus-ring)] disabled:cursor-not-allowed disabled:opacity-45";
const ICON_BTN =
  "inline-flex size-6 items-center justify-center rounded-[6px] text-text-tertiary outline-none hover:bg-[var(--cs-color-fill-hover)] hover:text-text-primary focus-visible:outline-2 focus-visible:outline-[var(--cs-color-focus-ring)] disabled:opacity-35";

function Row(props: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="grid grid-cols-[72px_1fr] items-center gap-2 py-1">
      <dt className="text-[11.5px] text-text-tertiary">{props.label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-[12px] text-text-primary">
        {props.children}
      </dd>
    </div>
  );
}

export interface InspectorActions {
  readonly close: () => void;
  readonly open: (plugin: string) => void;
  readonly remove: (plugin: string) => void;
  readonly shift: (plugin: string, delta: -1 | 1) => void;
  readonly select: (key: string) => void;
  readonly toggle: (group: string) => void;
}

export function Inspector(props: {
  readonly selected: string;
  readonly profile: CanvasProfile;
  readonly layout: Layout;
  readonly actions: InspectorActions;
}): ReactNode {
  const [kind, id] = splitKey(props.selected);
  let body: ReactNode = null;
  if (kind === "plugin") body = <PluginDetail id={id} {...props} />;
  if (kind === "station") body = <BlockDetail block={blockOf(id)} {...props} />;
  if (kind === "group") body = <GroupDetail id={id} {...props} />;
  if (body === null) return null;
  return (
    <section
      aria-label={t("desktop.craft.canvas.cvD.inspector.label")}
      className="absolute right-3 bottom-16 z-20 w-[272px] rounded-[16px] border border-border-subtle bg-surface-base p-3.5 shadow-[var(--cs-elevation-3)]"
    >
      <button
        type="button"
        data-slot="cvd"
        className={`${ICON_BTN} absolute top-3 right-3`}
        aria-label={t("desktop.craft.canvas.cvD.inspector.close")}
        onClick={props.actions.close}
      >
        <Icon name="close" size={12} />
      </button>
      {body}
    </section>
  );
}

function splitKey(key: string): readonly [string, string] {
  const at = key.indexOf(":");
  return [key.slice(0, at), key.slice(at + 1)];
}

function blockOf(id: string): BlockId | null {
  const blocks: readonly BlockId[] = ["context", "model", "tools", "ask", "agents", "record"];
  return blocks.find((b) => b === id) ?? null;
}

function PluginDetail(props: {
  readonly id: string;
  readonly profile: CanvasProfile;
  readonly layout: Layout;
  readonly actions: InspectorActions;
}): ReactNode {
  const p = pluginById(props.id);
  const entry = props.profile.entries.find((e) => e.plugin === props.id);
  if (p === undefined || entry === undefined) return null;
  const start = props.profile.startDrive === p.id;
  const point = p.points[0];
  const siblings = point === undefined || start ? [] : entriesAt(props.profile, point);
  const order = siblings.findIndex((e) => e.plugin === p.id);
  const group = props.profile.groups.find((g) => g.members.includes(p.id));
  const base = entry.origin === "base";
  return (
    <>
      <div className="flex items-center gap-2 pr-7">
        <KindBadge kind={p.kind} guard={p.guard === true} draft={p.draft === true} size={22} />
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] text-text-primary">{p.id}</div>
          <div className="text-[11px]" style={{ color: KIND_COLOR[p.kind] }}>
            {t(KIND_WORD[p.kind])}
          </div>
        </div>
      </div>
      {p.draft === true && (
        <div className="mt-3 rounded-[8px] border border-[var(--cs-color-warning-border)] bg-[var(--cs-color-warning-soft)] px-2.5 py-1.5 text-[11.5px] text-[var(--cs-color-warning-text)]">
          {t("desktop.craft.canvas.cvD.inspector.draftNote")}
        </div>
      )}
      <dl className="mt-3 border-t border-border-subtle pt-2">
        <Row label={t("desktop.craft.canvas.cvD.inspector.where")}>
          {start
            ? t("desktop.craft.canvas.cvD.startDrive")
            : point === undefined
              ? ""
              : t(pointWord(point))}
        </Row>
        {p.decision !== undefined && (
          <Row label={t("desktop.craft.canvas.cvD.inspector.decision")}>
            <DecisionGlyph decision={p.decision} />
            {t(DECISION_WORD[p.decision])}
            {p.guard === true && (
              <span className="text-text-tertiary">· {t("desktop.craft.canvas.cvD.guard")}</span>
            )}
          </Row>
        )}
        {siblings.length > 1 && order >= 0 && (
          <Row label={t("desktop.craft.canvas.cvD.inspector.order")}>
            <span className="font-mono text-[11.5px] tabular-nums">
              {order + 1} / {siblings.length}
            </span>
            <span className="ml-auto flex gap-0.5">
              <button
                type="button"
                data-slot="cvd"
                className={ICON_BTN}
                aria-label={t("desktop.craft.canvas.cvD.inspector.earlier")}
                disabled={order === 0 || base}
                onClick={() => props.actions.shift(p.id, -1)}
              >
                <Icon name="left" size={12} />
              </button>
              <button
                type="button"
                data-slot="cvd"
                className={ICON_BTN}
                aria-label={t("desktop.craft.canvas.cvD.inspector.later")}
                disabled={order === siblings.length - 1 || base}
                onClick={() => props.actions.shift(p.id, 1)}
              >
                <Icon name="right" size={12} />
              </button>
            </span>
          </Row>
        )}
        {(p.handoff ?? []).length > 0 && (
          <Row label={t("desktop.craft.canvas.cvD.handoff")}>
            {(p.handoff ?? []).map((h) => (
              <button
                key={h}
                type="button"
                data-slot="cvd"
                className="font-mono text-[11.5px] underline decoration-dotted underline-offset-2 hover:text-text-primary"
                onClick={() => props.actions.select(`plugin:${h}`)}
              >
                {h}
              </button>
            ))}
          </Row>
        )}
        <Row label={t("desktop.craft.canvas.cvD.inspector.origin")}>
          {base
            ? t("desktop.craft.canvas.cvD.base")
            : p.draft === true
              ? t("desktop.craft.canvas.cvD.draft")
              : t("desktop.craft.canvas.cvD.inspector.thisProfile")}
          {group !== undefined && <span className="text-text-tertiary">· {t(group.name)}</span>}
        </Row>
        <Row label={t("desktop.craft.canvas.cvD.inspector.recent")}>
          <span className="text-text-secondary">{agoText(p.recent)}</span>
        </Row>
      </dl>
      <div className="mt-3 flex items-center gap-1.5 border-t border-border-subtle pt-3">
        <button
          type="button"
          data-slot="cvd"
          className={`${BTN} bg-[var(--cs-color-ink-solid)] text-[var(--cs-color-ink-on)] hover:bg-[var(--cs-color-ink-solid-hover)]`}
          onClick={() => props.actions.open(p.id)}
        >
          {t("desktop.craft.canvas.cvD.inspector.open")}
          <Icon name="right" size={12} />
        </button>
        <button
          type="button"
          data-slot="cvd"
          className={`${BTN} text-text-secondary hover:bg-[var(--cs-color-fill-hover)] hover:text-text-primary`}
          disabled={base}
          onClick={() => props.actions.remove(p.id)}
        >
          {t("desktop.craft.canvas.cvD.inspector.remove")}
        </button>
        {base && (
          <span className="ml-auto text-[11px] text-text-tertiary">
            {t("desktop.craft.canvas.cvD.inspector.baseLocked")}
          </span>
        )}
      </div>
    </>
  );
}

function BlockDetail(props: {
  readonly block: BlockId | null;
  readonly layout: Layout;
  readonly actions: InspectorActions;
}): ReactNode {
  if (props.block === null) return null;
  const block = props.block;
  const attached = props.layout.chips.filter(
    (c) =>
      c.point === `before:${block}` || c.point === `after:${block}` || c.point === `feed:${block}`,
  );
  return (
    <>
      <div className="flex items-center gap-2 pr-7">
        <span className="font-mono text-[10px] text-text-tertiary">
          {t("desktop.craft.canvas.cvD.inspector.block")}
        </span>
        <span className="text-[13px] font-medium text-text-primary">{t(BLOCK_WORD[block])}</span>
      </div>
      {block === "record" && (
        <p className="mt-2 text-[11.5px] text-text-tertiary">
          {t("desktop.craft.canvas.cvD.inspector.recordNote")}
        </p>
      )}
      <ul className="mt-3 border-t border-border-subtle pt-2">
        {attached.length === 0 && block !== "record" && (
          <li className="py-1 text-[11.5px] text-text-tertiary">
            {t("desktop.craft.canvas.cvD.inspector.nothing")}
          </li>
        )}
        {attached.map((c) => (
          <li key={c.plugin}>
            <button
              type="button"
              data-slot="cvd"
              onClick={() => props.actions.select(`plugin:${c.plugin}`)}
              className="flex h-7 w-full items-center gap-2 rounded-[6px] px-1 text-left hover:bg-[var(--cs-color-fill-hover)]"
            >
              <KindBadge kind={c.kind} guard={c.guard} draft={c.draft} size={16} />
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-primary">
                {c.plugin}
              </span>
              <span className="text-[11px] text-text-tertiary">{t(pointWord(c.point))}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function GroupDetail(props: {
  readonly id: string;
  readonly profile: CanvasProfile;
  readonly layout: Layout;
  readonly actions: InspectorActions;
}): ReactNode {
  const g = props.profile.groups.find((x) => x.id === props.id);
  const box = props.layout.groups.find((x) => x.id === props.id);
  if (g === undefined || box === undefined) return null;
  return (
    <>
      <div className="flex items-center gap-2 pr-7">
        <span className="text-[13px] font-medium text-text-primary">{t(g.name)}</span>
        <span className="font-mono text-[11px] text-text-tertiary">{g.members.length}</span>
      </div>
      <ul className="mt-3 border-t border-border-subtle pt-2">
        {g.members.map((m) => {
          const p = pluginById(m);
          if (p === undefined) return null;
          return (
            <li key={m}>
              <button
                type="button"
                data-slot="cvd"
                onClick={() => props.actions.select(`plugin:${m}`)}
                className="flex h-7 w-full items-center gap-2 rounded-[6px] px-1 text-left hover:bg-[var(--cs-color-fill-hover)]"
              >
                <KindBadge kind={p.kind} size={16} />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-primary">
                  {m}
                </span>
                <span className="text-[11px] text-text-tertiary">
                  {t(pointWord(p.points[0] ?? "drive"))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 border-t border-border-subtle pt-3">
        <button
          type="button"
          data-slot="cvd"
          className={`${BTN} text-text-secondary hover:bg-[var(--cs-color-fill-hover)] hover:text-text-primary`}
          onClick={() => props.actions.toggle(g.id)}
        >
          <Icon name={box.open ? "chevron-down" : "chevron-right"} size={12} />
          {t(
            box.open
              ? "desktop.craft.canvas.cvD.inspector.fold"
              : "desktop.craft.canvas.cvD.inspector.unfold",
          )}
        </button>
      </div>
    </>
  );
}

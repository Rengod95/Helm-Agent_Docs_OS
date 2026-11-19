// 고른 노드의 가벼운 상세(캔버스 오른쪽 위에 뜬 판). 그 노드에 필요한 것만: 붙는 곳, 출처, 순서, 핸드오프, 최근 사용 한 줄.
// 동작은 셋: 열기(내부로), 순서 앞·뒤, 빼기. 베이스에서 온 것은 뺄 수 없고 그 까닭을 보이는 글로 둔다.
import { Button, IconButton, Tooltip } from "@caustic/react";
import { ArrowDown, ArrowUp, X } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { Gem } from "./glass.tsx";
import { anchorName, kindName, recentText, titleText, verbName } from "./labels.ts";
import {
  anchorKey,
  groupOf,
  handoffsOf,
  movePlugin,
  orderAt,
  type Catalog,
  type CvbPlugin,
  type Group,
  type ProfileState,
} from "./model.ts";

export function PluginDetail(props: {
  readonly plugin: CvbPlugin;
  readonly state: ProfileState;
  readonly catalog: Catalog;
  readonly onOpen: () => void;
  readonly onMove: (dir: -1 | 1) => void;
  readonly onRemove: () => void;
  readonly onClose: () => void;
}): ReactNode {
  const { plugin, state, catalog } = props;
  const entry = state.entries.find((e) => e.plugin === plugin.id);
  const base = entry?.base === true;
  const order = orderAt(state, catalog, anchorKey(plugin.anchor));
  const at = order.indexOf(plugin.id);
  const canUp = movePlugin(state, catalog, plugin.id, -1).ok;
  const canDown = movePlugin(state, catalog, plugin.id, 1).ok;
  const group = groupOf(state, plugin.id);
  const handoffs = handoffsOf(state, catalog);
  const outgoing = handoffs.filter((h) => h.from === plugin.id).map((h) => h.to);
  const incoming = handoffs.filter((h) => h.to === plugin.id).map((h) => h.from);
  const origin =
    plugin.draft === true
      ? t("desktop.craft.canvas.cvB.origin.draft")
      : base
        ? t("desktop.craft.canvas.cvB.origin.base")
        : t("desktop.craft.canvas.cvB.origin.profile");
  const how =
    plugin.kind === "hook" && plugin.verb !== undefined
      ? `${verbName(plugin.verb)}${plugin.guard === true ? ` · ${t("desktop.craft.canvas.cvB.detail.guard")}` : ""}`
      : null;
  return (
    <aside className="cvb-detail" aria-label={plugin.id} data-kind={plugin.kind}>
      <div className="cvb-detail-head">
        <Gem kind={plugin.kind} size={24} />
        <div className="cvb-detail-title">
          <span className="cvb-detail-name">{plugin.id}</span>
          <span className="cvb-detail-kind">{kindName(plugin.kind)}</span>
        </div>
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.craft.canvas.cvB.detail.close")}
          onClick={props.onClose}
        >
          <X size={16} />
        </IconButton>
      </div>
      <dl className="cvb-detail-rows">
        <dt>{t("desktop.craft.canvas.cvB.detail.where")}</dt>
        <dd>
          {how === null ? anchorName(plugin.anchor) : `${anchorName(plugin.anchor)} · ${how}`}
        </dd>
        {order.length > 1 && at >= 0 && (
          <>
            <dt>{t("desktop.craft.canvas.cvB.detail.order")}</dt>
            <dd>
              {t("desktop.craft.canvas.cvB.detail.orderValue", { n: at + 1, total: order.length })}
            </dd>
          </>
        )}
        {outgoing.length > 0 && (
          <>
            <dt>{t("desktop.craft.canvas.cvB.handoff")}</dt>
            <dd>{t("desktop.craft.canvas.cvB.detail.handoffTo", { name: outgoing.join(", ") })}</dd>
          </>
        )}
        {incoming.length > 0 && (
          <>
            <dt>{t("desktop.craft.canvas.cvB.handoff")}</dt>
            <dd>
              {t("desktop.craft.canvas.cvB.detail.handoffFrom", { name: incoming.join(", ") })}
            </dd>
          </>
        )}
        {group !== null && (
          <>
            <dt>{t("desktop.craft.canvas.cvB.detail.group")}</dt>
            <dd>{titleText(group.title)}</dd>
          </>
        )}
        <dt>{t("desktop.craft.canvas.cvB.detail.origin")}</dt>
        <dd>{origin}</dd>
        <dt>{t("desktop.craft.canvas.cvB.recent.label")}</dt>
        <dd>{recentText(plugin.recent)}</dd>
      </dl>
      {base && <p className="cvb-detail-kind">{t("desktop.craft.canvas.cvB.detail.removeBase")}</p>}
      <div className="cvb-detail-actions">
        <Button size="sm" variant="solid" onClick={props.onOpen}>
          {t("desktop.craft.canvas.cvB.detail.open")}
        </Button>
        {order.length > 1 && (
          <>
            <Tooltip content={t("desktop.craft.canvas.cvB.detail.up")} shortcut="⌥↑">
              <IconButton
                size="sm"
                variant="ghost"
                label={t("desktop.craft.canvas.cvB.detail.up")}
                disabled={!canUp}
                onClick={() => {
                  props.onMove(-1);
                }}
              >
                <ArrowUp size={16} />
              </IconButton>
            </Tooltip>
            <Tooltip content={t("desktop.craft.canvas.cvB.detail.down")} shortcut="⌥↓">
              <IconButton
                size="sm"
                variant="ghost"
                label={t("desktop.craft.canvas.cvB.detail.down")}
                disabled={!canDown}
                onClick={() => {
                  props.onMove(1);
                }}
              >
                <ArrowDown size={16} />
              </IconButton>
            </Tooltip>
          </>
        )}
        <Button size="sm" variant="ghost" disabled={base} onClick={props.onRemove}>
          {t("desktop.craft.canvas.cvB.detail.remove")}
        </Button>
      </div>
    </aside>
  );
}

export function GroupDetail(props: {
  readonly group: Group;
  readonly catalog: Catalog;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onPick: (plugin: string) => void;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <aside className="cvb-detail" aria-label={titleText(props.group.title)} data-kind="group">
      <div className="cvb-detail-head">
        <Gem kind="group" size={24} />
        <div className="cvb-detail-title">
          <span className="cvb-detail-name">{titleText(props.group.title)}</span>
          <span className="cvb-detail-kind">
            {t("desktop.craft.canvas.cvB.detail.groupCount", { n: props.group.members.length })}
          </span>
        </div>
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.craft.canvas.cvB.detail.close")}
          onClick={props.onClose}
        >
          <X size={16} />
        </IconButton>
      </div>
      <dl className="cvb-detail-rows">
        {props.group.members.map((id) => {
          const plugin = props.catalog.get(id);
          if (plugin === undefined) return null;
          return (
            <div key={id} style={{ display: "contents" }}>
              <dt>
                <Gem kind={plugin.kind} size={14} />
              </dt>
              <dd>
                <button
                  type="button"
                  className="cvb-link"
                  onClick={() => {
                    props.onPick(id);
                  }}
                >
                  {id}
                </button>
                <span className="cvb-detail-kind"> · {anchorName(plugin.anchor)}</span>
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="cvb-detail-actions">
        <Button size="sm" variant="soft" onClick={props.onToggle}>
          {t(
            props.open
              ? "desktop.craft.canvas.cvB.group.close"
              : "desktop.craft.canvas.cvB.group.open",
          )}
        </Button>
      </div>
    </aside>
  );
}

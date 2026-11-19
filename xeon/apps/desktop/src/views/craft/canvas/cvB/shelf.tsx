// 왼쪽 플러그인 목록(끌어 놓기의 출발점). 설치된 플러그인을 종류별로 둔다.
// 프로필에 없는 것은 끌 수 있다. 키보드: Enter로 놓을 자리를 캔버스에 드러내고, 한 번 더 Enter로 놓는다. Esc는 그만둔다.
// 프로필에 이미 있는 것은 Enter·누르기로 캔버스에서 고른다.
import { IconButton, Tooltip } from "@caustic/react";
import { Check, PanelLeft } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { DragEvent, ReactNode } from "react";
import { Gem } from "./glass.tsx";
import { kindName } from "./labels.ts";
import { hasPlugin, KINDS, type CvbPlugin, type ProfileState } from "./model.ts";

const DRAG_TYPE = "application/x-fresnel-plugin";

export function Shelf(props: {
  readonly plugins: readonly CvbPlugin[];
  readonly state: ProfileState;
  readonly placing: string | null;
  readonly collapsed: boolean;
  readonly onCollapse: (collapsed: boolean) => void;
  readonly onPick: (plugin: string) => void;
  readonly onPlace: (plugin: string) => void;
  readonly onCancel: () => void;
  readonly onDragStart: (plugin: string) => void;
  readonly onDragEnd: () => void;
}): ReactNode {
  const collapsed = props.collapsed;
  return (
    <nav
      className="cvb-shelf"
      data-collapsed={collapsed ? "" : undefined}
      aria-label={t("desktop.craft.canvas.cvB.shelf.title")}
    >
      <div className="cvb-shelf-head">
        {!collapsed && <span>{t("desktop.craft.canvas.cvB.shelf.title")}</span>}
        <IconButton
          size="sm"
          variant="ghost"
          label={t(
            collapsed
              ? "desktop.craft.canvas.cvB.shelf.expand"
              : "desktop.craft.canvas.cvB.shelf.collapse",
          )}
          onClick={() => {
            props.onCollapse(!collapsed);
          }}
        >
          <PanelLeft size={16} />
        </IconButton>
      </div>
      <div className="cvb-shelf-list">
        {KINDS.map((kind) => {
          const items = props.plugins.filter((p) => p.kind === kind);
          if (items.length === 0) return null;
          return (
            <section key={kind} aria-label={kindName(kind)}>
              <div className="cvb-shelf-kind" aria-hidden="true">
                <Gem kind={kind} size={12} />
                {!collapsed && <span>{kindName(kind)}</span>}
              </div>
              {items.map((plugin) => (
                <ShelfItem
                  key={plugin.id}
                  plugin={plugin}
                  inProfile={hasPlugin(props.state, plugin.id)}
                  placing={props.placing === plugin.id}
                  collapsed={collapsed}
                  onPick={props.onPick}
                  onPlace={props.onPlace}
                  onCancel={props.onCancel}
                  onDragStart={props.onDragStart}
                  onDragEnd={props.onDragEnd}
                />
              ))}
            </section>
          );
        })}
      </div>
    </nav>
  );
}

function ShelfItem(props: {
  readonly plugin: CvbPlugin;
  readonly inProfile: boolean;
  readonly placing: boolean;
  readonly collapsed: boolean;
  readonly onPick: (plugin: string) => void;
  readonly onPlace: (plugin: string) => void;
  readonly onCancel: () => void;
  readonly onDragStart: (plugin: string) => void;
  readonly onDragEnd: () => void;
}): ReactNode {
  const { plugin, inProfile } = props;
  const note = plugin.draft === true ? t("desktop.craft.canvas.cvB.tag.draft") : null;
  const hint = inProfile
    ? t("desktop.craft.canvas.cvB.shelf.inProfile")
    : t("desktop.craft.canvas.cvB.shelf.placeHint");
  const button = (
    <button
      type="button"
      className="cvb-shelf-item"
      data-in={inProfile ? "" : undefined}
      data-placing={props.placing ? "" : undefined}
      draggable={!inProfile}
      aria-label={`${plugin.id}, ${kindName(plugin.kind)}, ${hint}`}
      aria-pressed={inProfile ? undefined : props.placing}
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData(DRAG_TYPE, plugin.id);
        e.dataTransfer.effectAllowed = "copy";
        props.onDragStart(plugin.id);
      }}
      onDragEnd={props.onDragEnd}
      onClick={() => {
        if (inProfile) props.onPick(plugin.id);
        else props.onPlace(plugin.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && props.placing) {
          e.preventDefault();
          props.onCancel();
        }
      }}
    >
      <Gem kind={plugin.kind} size={16} />
      {!props.collapsed && <span className="cvb-shelf-name">{plugin.id}</span>}
      {!props.collapsed && note !== null && <span className="cvb-shelf-note">{note}</span>}
      {!props.collapsed && inProfile && (
        <Check size={14} className="cvb-shelf-check" aria-hidden="true" />
      )}
    </button>
  );
  if (!props.collapsed) return button;
  return (
    <Tooltip content={plugin.id} side="right">
      {button}
    </Tooltip>
  );
}

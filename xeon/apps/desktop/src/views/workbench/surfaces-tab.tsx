// 크래프트 상세 "화면과 설정" 탭(P-17, AGE-76 plugMin). 플레이그라운드 상세에 있던 관리가 여기로 왔다.
// 위에서부터: 열 수 없는 화면 띠(앱 화면 허용), 화면(열기, 머리 줄 탭 고정), 대화 기능(명령 실행), 플러그인 설정 폼과 플러그인이 그린 설정 화면, 권한.
// 데이터는 플레이그라운드와 같은 `useAddonData`(화면 항목과 매니페스트)다. 화면 이름은 플러그인 메시지로 고른 글이다.
// 화면과 기능 줄 끝에는 보이기 스위치를 두고, 상태 표시줄 칸과 오른쪽 패널 목록에 드는 줄에는 순서 메뉴("위로", "아래로")를 둔다.
// 값은 앱 전체에 한 벌인 사용자 설정 `x.ui.hidden`, `x.ui.order`이고 리뷰를 거치지 않는다(AGE-73, ADR-0021 §3.12).
// 설정 구역(settings 자리)은 끄는 대상이 아니다.
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { Button, IconButton, Menu, MenuItem, Switch, toast } from "@caustic/react";
import { ChevronDown, ChevronUp, Ellipsis } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { useCommands } from "../commands.ts";
import { useAddonData } from "../plugin/addon-data.ts";
import { addonDetailOf } from "../plugin/addon-model.ts";
import {
  CARD,
  FeatureRow,
  ProblemsNotice,
  RiskSection,
  ScreenRow,
  Section,
  type SurfaceOps,
} from "../plugin/addon-parts.tsx";
import {
  movedKeys,
  nativeEntriesOf,
  statusOrderKeysOf,
  type OrderedPlace,
  type UiLayout,
} from "../../plugin-ui/placements.ts";
import type { AddonFeatureKind } from "../plugin/addon-model.ts";
import { usePluginCommandRunner } from "../plugin/command-run.ts";
import { usePluginUi, usePluginUiState } from "../plugin/plugin-context.tsx";
import { panelOrderKeysOf } from "../plugin/plugin-pick.ts";
import { EntrySurface } from "../plugin/plugin-view.tsx";
import { PluginConfigForm } from "../plugin/plugin-config-form.tsx";
import { PinIcon } from "../plugin/plugin-glyph.tsx";
import { usePlaygroundTabs } from "../plugin/playground-tab-strip.tsx";
import { isPinned } from "../plugin/playground-tabs.ts";

/**
 * 플러그인이 그린 설정 화면(settings 자리, ADR-0021 §3.2). 이 플러그인의 `settings` 항목이 있으면 연한 머리와 그 화면을 붙인다.
 * 항목 제목은 자리의 이름(aria-label)으로만 쓴다. 없거나 꺼졌으면 아무것도 그리지 않는다
 */
export function PluginSettingsSlot(props: { readonly name: string }): ReactNode {
  const plugin = usePluginUiState();
  const slot = nativeEntriesOf(plugin.groups.settings, plugin.inactive).find(
    (entry) => entry.extension === props.name,
  );
  if (slot === undefined) return null;
  return (
    <section aria-label={slot.title} className="grid gap-1">
      <p className="m-0 text-ui text-text-tertiary">
        {t("desktop.workbench.detail.settings.slot")}
      </p>
      <EntrySurface entry={slot} />
    </section>
  );
}

/** 순서를 바꾸는 자리의 메뉴 이름 */
const ORDER_LABEL: Readonly<
  Record<
    OrderedPlace,
    "desktop.workbench.surfaces.order.status" | "desktop.workbench.surfaces.order.panel"
  >
> = {
  status: "desktop.workbench.surfaces.order.status",
  panel: "desktop.workbench.surfaces.order.panel",
};

/** 기능 줄이 순서를 바꾸는 자리. 상태 칸만이다(Helm 옆 패널은 자기 탭이라 목록에 들지 않는다) */
function featurePlaceOf(kind: AddonFeatureKind): OrderedPlace | null {
  return kind === "status" ? "status" : null;
}

/**
 * 줄 끝 칸: 순서 메뉴(순서를 바꾸는 자리일 때)와 보이기 스위치. "열기", "실행" 단추와 같은 줄에 세로 가운데로 선다.
 * 순서 메뉴는 그 자리 전체(다른 플러그인의 항목 포함, 숨긴 항목 포함)에서 한 칸 옮긴다. 끝이면 그 쪽 항목이 꺼진다
 */
function ItemControls(props: {
  readonly title: string;
  readonly itemKey: string;
  readonly place: OrderedPlace | null;
  /** 그 자리의 지금 순서(열쇠 목록) */
  readonly order: readonly string[];
  readonly hidden: boolean;
  readonly disabled: boolean;
  readonly onHidden: (hidden: boolean) => void;
  readonly onOrder: (place: OrderedPlace, keys: readonly string[]) => void;
}): ReactNode {
  const { place, itemKey } = props;
  const up = place === null ? null : movedKeys(props.order, itemKey, -1);
  const down = place === null ? null : movedKeys(props.order, itemKey, 1);
  return (
    <span className="flex flex-none items-center gap-2" data-slot="surface-item-controls">
      {place === null ? null : (
        <Menu
          size="sm"
          align="end"
          aria-label={t(ORDER_LABEL[place])}
          trigger={
            <IconButton
              size="sm"
              variant="ghost"
              label={t(ORDER_LABEL[place])}
              disabled={props.disabled || (up === null && down === null)}
            >
              <Ellipsis />
            </IconButton>
          }
        >
          <MenuItem
            icon={<ChevronUp />}
            disabled={up === null}
            onSelect={() => {
              if (up !== null) props.onOrder(place, up);
            }}
          >
            {t("desktop.workbench.surfaces.order.up")}
          </MenuItem>
          <MenuItem
            icon={<ChevronDown />}
            disabled={down === null}
            onSelect={() => {
              if (down !== null) props.onOrder(place, down);
            }}
          >
            {t("desktop.workbench.surfaces.order.down")}
          </MenuItem>
        </Menu>
      )}
      <Switch
        size="sm"
        aria-label={t("desktop.workbench.surfaces.show", { name: props.title })}
        checked={!props.hidden}
        disabled={props.disabled}
        onCheckedChange={(next) => {
          props.onHidden(!next);
        }}
      />
    </span>
  );
}

/** 숨김 한 칸을 바꾼 새 값 */
function withHidden(layout: UiLayout, key: string, hidden: boolean): UiLayout {
  const next = new Set(layout.hidden);
  if (hidden) next.add(key);
  else next.delete(key);
  return { ...layout, hidden: next };
}

export function SurfacesTab(props: { readonly entry: Pick<ExtListEntry, "name"> }): ReactNode {
  const { name } = props.entry;
  const commands = useCommands();
  const { runtime } = usePluginUi();
  const plugin = usePluginUiState();
  const data = useAddonData(true, true);
  const tabs = usePlaygroundTabs();
  const runCommand = usePluginCommandRunner();
  if (data.phase === "offline") {
    return <p className="m-0 text-ui text-text-tertiary">{t("desktop.plugin.state.offline")}</p>;
  }
  const detail =
    data.phase === "ready" ? addonDetailOf(name, data.source, data.meta, data.locale) : undefined;
  if (detail === undefined) {
    return (
      <div className="grid gap-8">
        <PluginConfigForm name={name} title={name} />
        <PluginSettingsSlot name={name} />
      </div>
    );
  }
  const { row } = detail;
  const ops: SurfaceOps = {
    onOpenScreen: (screen) => {
      // 화면은 플레이그라운드의 머리 줄 탭 화면에서 연다(상태가 남는다)
      tabs.actions.open(row.name, screen.key);
    },
    onRunCommand: (feature) => {
      runCommand(row.name, feature.id);
    },
    onAllowApps: () => {
      commands.requestSettingsJump({ tab: "plugins", key: "x.ui.apps" });
      commands.showScreen("settings");
    },
  };
  const pinned = tabs.prefs !== undefined && isPinned(tabs.prefs, row.name);
  const layout = plugin.layout;
  const orders: Readonly<Record<OrderedPlace, readonly string[]>> = {
    status: statusOrderKeysOf(plugin.entries, layout),
    panel: panelOrderKeysOf(plugin),
  };
  const save = (next: UiLayout): void => {
    detach(
      runtime.saveLayout(next).then((saved) => {
        if (!saved.ok) toast({ tone: "danger", title: t("desktop.workbench.surfaces.saveFailed") });
        return undefined;
      }),
      rethrow,
    );
  };
  const controls = (title: string, key: string, place: OrderedPlace | null): ReactNode => (
    <ItemControls
      title={title}
      itemKey={key}
      place={place}
      order={place === null ? [] : orders[place]}
      hidden={layout.hidden.has(key)}
      disabled={plugin.phase !== "ready"}
      onHidden={(hidden) => {
        save(withHidden(layout, key, hidden));
      }}
      onOrder={(at, keys) => {
        save({ ...layout, order: { ...layout.order, [at]: keys } });
      }}
    />
  );
  const commandFeatures = detail.features.filter((feature) => feature.kind === "command");
  const otherFeatures = detail.features.filter((feature) => feature.kind !== "command");
  return (
    <div className="grid gap-8">
      <ProblemsNotice problems={detail.problems} onAllowApps={ops.onAllowApps} />
      {detail.screens.length === 0 ? null : (
        <Section
          title={t("desktop.addons.section.screens")}
          count={detail.screens.length}
          end={
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={pinned}
              disabled={tabs.prefs === undefined}
              iconStart={<PinIcon aria-hidden />}
              onClick={() => {
                tabs.actions.pin(row.name, !pinned);
              }}
            >
              {t(pinned ? "desktop.addons.detail.pinned" : "desktop.addons.detail.pin")}
            </Button>
          }
        >
          <ul aria-label={t("desktop.addons.section.screens")} className={CARD}>
            {detail.screens.map((screen) => (
              <ScreenRow
                key={screen.key}
                screen={screen}
                placeFirst
                pluginOff={row.off}
                ops={ops}
                hidden={layout.hidden.has(screen.key)}
                end={controls(
                  `${t(screen.where === "panel" ? "desktop.addons.where.panel" : "desktop.addons.where.page")} ${screen.title}`,
                  screen.key,
                  "panel",
                )}
              />
            ))}
          </ul>
        </Section>
      )}
      {detail.features.length === 0 ? null : (
        <Section title={t("desktop.addons.section.conversation")}>
          <ul aria-label={t("desktop.addons.section.conversation")} className={CARD}>
            {[...commandFeatures, ...otherFeatures].map((feature) => (
              <FeatureRow
                key={feature.key}
                feature={feature}
                placeFirst
                pluginOff={row.off}
                ops={ops}
                hidden={feature.kind !== "settings" && layout.hidden.has(feature.key)}
                end={
                  feature.kind === "settings"
                    ? null
                    : controls(
                        `${t(`desktop.addons.feature.${feature.kind}`)} ${feature.title}`,
                        feature.key,
                        featurePlaceOf(feature.kind),
                      )
                }
              />
            ))}
          </ul>
        </Section>
      )}
      <PluginConfigForm name={row.name} title={row.title} />
      <PluginSettingsSlot name={row.name} />
      <RiskSection detail={detail} />
    </div>
  );
}

// 크래프트 상세 "화면과 설정" 탭(P-17, AGE-76 plugMin). 플레이그라운드 상세에 있던 관리가 여기로 왔다.
// 위에서부터: 열 수 없는 화면 띠(앱 화면 허용), 화면(열기, 머리 줄 탭 고정), 대화 기능(명령 실행), 플러그인 설정 폼과 플러그인이 그린 설정 화면, 권한.
// 데이터는 플레이그라운드와 같은 `useAddonData`(화면 항목과 매니페스트)다. 화면 이름은 플러그인 메시지로 고른 글이다.
import { t } from "@fresnel/client/i18n";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { Button } from "@caustic/react";
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
import { nativeEntriesOf } from "../../plugin-ui/placements.ts";
import { usePluginCommandRunner } from "../plugin/command-run.ts";
import { usePluginUiState } from "../plugin/plugin-context.tsx";
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

export function SurfacesTab(props: { readonly entry: Pick<ExtListEntry, "name"> }): ReactNode {
  const { name } = props.entry;
  const commands = useCommands();
  const data = useAddonData(true);
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
              <ScreenRow key={screen.key} screen={screen} pluginOff={row.off} ops={ops} />
            ))}
          </ul>
        </Section>
      )}
      {detail.features.length === 0 ? null : (
        <Section title={t("desktop.addons.section.conversation")}>
          <ul aria-label={t("desktop.addons.section.conversation")} className={CARD}>
            {[...commandFeatures, ...otherFeatures].map((feature) => (
              <FeatureRow key={feature.key} feature={feature} pluginOff={row.off} ops={ops} />
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

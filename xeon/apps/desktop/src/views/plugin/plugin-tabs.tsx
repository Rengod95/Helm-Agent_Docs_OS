import { activeLocale, t } from "@fresnel/client/i18n";
import { extMessageOf } from "@fresnel/client/views/native";
import { detach, rethrow } from "@fresnel/contracts";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import { Button, EmptyState } from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import type { PlacedEntry } from "../../plugin-ui/placements.ts";
import { watchExtensionChanges } from "../../plugin-ui/watch.ts";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { ConfirmHost } from "./confirm-host.tsx";
import { usePluginUi, usePluginUiState } from "./plugin-context.tsx";
import { PluginView, screenKeyOf } from "./plugin-view.tsx";
import { ThreadSwitches } from "./thread-switches.tsx";

// Placement `panel`과 `page`를 오른쪽 탭에 잇는 부품과, 엔진이 붙을 때 화면 목록을 읽는 부품.

/** Helm 옆 패널의 확장 이름. 오른쪽 탭 id `helm`이 이 확장의 `panel` 항목을 그린다 */
const HELM_EXTENSION = "helm";

function Pick(props: {
  readonly items: readonly PlacedEntry[];
  readonly selected: string | undefined;
  readonly onSelect: (key: string) => void;
}): ReactNode {
  if (props.items.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-1 px-3 pt-3">
      {props.items.map(({ entry }) => (
        <Button
          key={screenKeyOf(entry)}
          variant="ghost"
          size="xs"
          aria-pressed={screenKeyOf(entry) === props.selected}
          onClick={() => {
            props.onSelect(screenKeyOf(entry));
          }}
        >
          {extMessageOf(entry.messages, activeLocale(), entry.title)}
        </Button>
      ))}
    </div>
  );
}

function EntryList(props: { readonly items: readonly PlacedEntry[] }): ReactNode {
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const current: ExtUiEntry | undefined =
    props.items.find(({ entry }) => screenKeyOf(entry) === picked)?.entry ?? props.items[0]?.entry;
  if (current === undefined) {
    return <EmptyState size="sm" surface="none" title={t("desktop.plugin.state.empty")} />;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Pick items={props.items} selected={screenKeyOf(current)} onSelect={setPicked} />
      <PluginView key={`${screenKeyOf(current)}@${current.version}`} entry={current} />
    </div>
  );
}

/** 대화 영역 옆 Helm 패널. `helm` 확장의 `panel` 항목을 그린다 */
export function HelmPanelTab(): ReactNode {
  const state = usePluginUiState();
  const items = state.groups.panel.filter(({ entry }) => entry.extension === HELM_EXTENSION);
  return <EntryList items={items} />;
}

/** 맨 위에 이 대화에서 끄기 구역을 두고, 그 아래에 모든 확장의 `page` 항목과 Helm이 아닌 확장의 `panel` 항목을 잇는다 */
export function PluginPagesTab(): ReactNode {
  const state = usePluginUiState();
  const items = [
    ...state.groups.page,
    ...state.groups.panel.filter(({ entry }) => entry.extension !== HELM_EXTENSION),
  ];
  // 탭 전체가 한 스크롤 컨테이너다. 이 대화에서 끄기 구역과 화면이 한 흐름으로 흐르고, 안쪽에 두 번째 스크롤을 두지 않는다
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ThreadSwitches />
        <EntryList items={items} />
      </div>
    </div>
  );
}

/**
 * 엔진이 붙으면(`live`) 화면 목록을 읽고, 확장 켜짐·꺼짐과 앱 정책이 바뀌는 알림에서 다시 읽는다. 확인 줄 모달을 그린다.
 * 화면 트리 어디에든 한 번 둔다. 재연결하면 새 연결로 다시 듣는다
 */
export function PluginUiHost(): ReactNode {
  const { runtime, confirm } = usePluginUi();
  const commands = useCommands();
  const phase = useLinkPhase();
  useEffect(() => {
    if (phase !== "live") return undefined;
    detach(runtime.refresh(), rethrow);
    const connection = commands.pluginUi.current();
    if (connection === null) return undefined;
    return watchExtensionChanges(connection, () => {
      detach(runtime.refresh(), rethrow);
    });
  }, [phase, runtime, commands]);
  return <ConfirmHost queue={confirm} />;
}

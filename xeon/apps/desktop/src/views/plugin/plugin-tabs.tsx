import { activeLocale, t } from "@fresnel/client/i18n";
import { extMessageOf } from "@fresnel/client/views/native";
import { detach, rethrow } from "@fresnel/contracts";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  EmptyState,
} from "@caustic/react";
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

/**
 * 화면(프레임)이 위에서 남는 높이를 다 쓰고, "이 대화에서 끄기" 구역은 맨 아래에 접힌 줄 하나로 둔다.
 * 시안(chat-plugin-off)은 목록을 맨 위에 두지만 목록이 길면 프레임이 밀려나므로, 프레임이 주인공이 되게 접는다.
 * 펼친 목록은 높이를 제한하고 안에서 스크롤한다(프레임은 자기 스크롤을 따로 가진다)
 */
export function PluginPagesTab(): ReactNode {
  const state = usePluginUiState();
  const items = [
    ...state.groups.page,
    ...state.groups.panel.filter(({ entry }) => entry.extension !== HELM_EXTENSION),
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EntryList items={items} />
      <Accordion size="xs" className="flex-none border-t border-border-subtle">
        <AccordionItem value="thread-off">
          <AccordionTrigger>{t("desktop.plugin.thread.title")}</AccordionTrigger>
          <AccordionContent>
            <div className="max-h-[40vh] overflow-y-auto">
              <ThreadSwitches heading={false} />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
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

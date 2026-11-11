import { t } from "@fresnel/client/i18n";
import {
  Button,
  EmptyState,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
} from "@caustic/react";
import { Ellipsis, Info, LayoutGrid } from "@caustic/react/icons";
import { useEffect, useState, type ReactNode } from "react";
import {
  HEADER_CONTROL_SIZE,
  HEADER_SEGMENTED_SIZE,
  HEADER_SELECT_SIZE,
} from "../shell/screen-header.tsx";
import { useAddonData } from "./addon-data.ts";
import { addonDetailOf, type AddonDetail, type AddonScreen } from "./addon-model.ts";
import { usePlaygroundTabs } from "./playground-tab-strip.tsx";
import { openTab, useTabRunState } from "./playground-tab-store.ts";
import { PluginView } from "./plugin-view.tsx";

// 머리 줄 탭 화면(셸 화면 `playground-tab`, keepAlive, DP-90). 한 번 연 탭마다 그 플러그인의 화면을 하나씩 두고 지금 탭만 보인다.
// 그래서 대화·설정·크래프트를 다녀오거나 다른 탭을 봐도 프레임과 화면 트리의 상태가 그대로다(열어 둔 탭 상한 8, 오래 안 본 것부터 내린다).
// 화면이 여럿인 플러그인은 머리의 화면 고르기로 바꾸고, 그 플러그인 안에서 한 번 본 화면도 숨겨 둔다.

/** 화면 고르기: 4개까지 SegmentedControl, 넘으면 Select */
function ScreenPick(props: {
  readonly screens: readonly AddonScreen[];
  readonly value: string;
  readonly onPick: (key: string) => void;
}): ReactNode {
  const ready = props.screens.filter((screen) => screen.state !== "invalid");
  if (ready.length < 2) return null;
  if (ready.length <= 4) {
    return (
      <SegmentedControl
        aria-label={t("desktop.playgroundTabs.screens")}
        size={HEADER_SEGMENTED_SIZE}
        value={props.value}
        onValueChange={props.onPick}
      >
        {ready.map((screen) => (
          <SegmentedControlItem key={screen.key} value={screen.key}>
            {screen.title}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    );
  }
  return (
    <Select
      aria-label={t("desktop.playgroundTabs.screens")}
      size={HEADER_SELECT_SIZE}
      value={props.value}
      onValueChange={props.onPick}
    >
      {ready.map((screen) => (
        <SelectOption key={screen.key} value={screen.key}>
          {screen.title}
        </SelectOption>
      ))}
    </Select>
  );
}

function TabMenu(props: {
  readonly detail: AddonDetail;
  readonly onDetails: () => void;
  readonly onPlayground: () => void;
  readonly onUnpin: () => void;
}): ReactNode {
  return (
    <Menu
      size="sm"
      align="end"
      aria-label={t("desktop.playgroundTabs.menu.label", { name: props.detail.row.title })}
      trigger={
        <IconButton
          size={HEADER_CONTROL_SIZE}
          variant="ghost"
          label={t("desktop.playgroundTabs.menu.label", { name: props.detail.row.title })}
        >
          <Ellipsis />
        </IconButton>
      }
    >
      <MenuItem icon={<Info />} onSelect={props.onDetails}>
        {t("desktop.playgroundTabs.menu.details")}
      </MenuItem>
      <MenuItem icon={<LayoutGrid />} onSelect={props.onPlayground}>
        {t("desktop.playgroundTabs.openPlayground")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={props.onUnpin}>{t("desktop.playgroundTabs.menu.unpin")}</MenuItem>
    </Menu>
  );
}

/** 플러그인 하나의 탭 칸. 이 플러그인에서 한 번 본 화면은 숨겨 둔다 */
function TabPane(props: {
  readonly detail: AddonDetail;
  readonly shown: boolean;
  readonly picked: string | undefined;
  readonly actions: ReturnType<typeof usePlaygroundTabs>["actions"];
}): ReactNode {
  const { detail } = props;
  const name = detail.row.name;
  const fallback = detail.primary?.key ?? detail.screens[0]?.key;
  const current = detail.screens.some((screen) => screen.key === props.picked)
    ? props.picked
    : fallback;
  const [seen, setSeen] = useState<readonly string[]>([]);
  if (current !== undefined && !seen.includes(current)) setSeen([...seen, current]);
  const pick = (key: string): void => {
    openTab(name, key);
  };
  return (
    <div className={props.shown ? "flex min-h-0 flex-1 flex-col" : "hidden"} hidden={!props.shown}>
      {seen.flatMap((key) => {
        const screen = detail.screens.find((item) => item.key === key);
        if (screen === undefined) return [];
        const visible = key === current;
        return [
          <div
            key={`${key}@${screen.entry.version}`}
            hidden={!visible}
            className={visible ? "flex min-h-0 flex-1 flex-col" : "hidden"}
          >
            <PluginView
              entry={screen.entry}
              tab={{
                controls: <ScreenPick screens={detail.screens} value={key} onPick={pick} />,
                action: (
                  <TabMenu
                    detail={detail}
                    onDetails={() => {
                      props.actions.details(name);
                    }}
                    onPlayground={props.actions.playground}
                    onUnpin={() => {
                      props.actions.unpin(name);
                    }}
                  />
                ),
              }}
            />
          </div>,
        ];
      })}
    </div>
  );
}

/** 탭 화면 본체 */
export function PlaygroundTabScreen(): ReactNode {
  const run = useTabRunState();
  const { tabs, actions } = usePlaygroundTabs();
  const data = useAddonData(false);
  // 앱을 다시 켜서 이 화면이 먼저 열렸으면(지금 탭이 없다) 첫 고정 탭을 연다
  const first = tabs[0]?.name;
  useEffect(() => {
    if (run.active === undefined && first !== undefined) openTab(first);
  }, [run.active, first]);
  const panes = run.kept.flatMap((name) => {
    const detail = addonDetailOf(name, data.source, data.meta, data.locale);
    return detail === undefined || detail.screens.length === 0 ? [] : [detail];
  });
  if (!panes.some((detail) => detail.row.name === run.active)) {
    return (
      <section className="flex min-h-0 flex-1 flex-col">
        <EmptyState
          size="sm"
          surface="none"
          title={t("desktop.playgroundTabs.empty.title")}
          description={t("desktop.playgroundTabs.empty.body")}
          actions={
            <Button size="md" variant="outline" onClick={actions.playground}>
              {t("desktop.playgroundTabs.openPlayground")}
            </Button>
          }
        />
      </section>
    );
  }
  return (
    <>
      {panes.map((detail) => (
        <TabPane
          key={detail.row.name}
          detail={detail}
          shown={detail.row.name === run.active}
          picked={run.screens.get(detail.row.name)}
          actions={actions}
        />
      ))}
    </>
  );
}

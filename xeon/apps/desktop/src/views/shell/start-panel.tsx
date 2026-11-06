// 왼쪽 패널(S-01 시작 영역). 머리: 찾기 + 영역 바꾸기(+ 작업대는 맥락 칸). 가운데: 영역별 내비(+ 대화 목록 슬롯). 아래: 설정.
import { t } from "@fresnel/client/i18n";
import {
  Button,
  ListNavigation,
  ListNavigationGroup,
  ListNavigationItem,
  SegmentedControl,
  SegmentedControlItem,
  SidePanel,
} from "@caustic/react";
import { Search, Settings } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { ContextPicker, type ContextProfile } from "./context-picker.tsx";
import { formatKey, type Keymap } from "./keybindings.ts";
import { NAV_BY_AREA } from "./nav.ts";
import type { Area } from "../../state/shell/index.ts";
import type { ScreenDef, ShellRegistry } from "./registry.ts";
import { useShell, useShellActions } from "../../state/shell/index.ts";

// 지금 화면 표시는 굵기 하나로 한다
const ACTIVE_LABEL =
  "[&_[data-slot=list-navigation-label]]:font-semibold [&_[data-slot=list-navigation-label]]:text-text-primary";

export interface StartPanelProps {
  readonly registry: ShellRegistry;
  readonly keymap: Keymap;
  readonly mac: boolean;
  readonly settingsOpen: boolean;
  readonly onOpenSettings: () => void;
  readonly onNavigate: (screen: string) => void;
  /** 영역 바꾸기 칸을 눌렀다. 열려 있는 설정 화면은 닫아야 한다 */
  readonly onSwitchArea: (area: Area) => void;
  /** 대화 영역 목록 슬롯 */
  readonly threadList: ReactNode;
  readonly profiles: readonly ContextProfile[];
  readonly onGoToThread: (threadId: string) => void;
}

function AreaSwitch(props: { readonly onSwitch: (area: Area) => void }): ReactNode {
  const area = useShell((s) => s.area);
  return (
    <SegmentedControl
      aria-label={t("desktop.shell.area.label")}
      size="sm"
      value={area}
      onValueChange={(v) => {
        props.onSwitch(v === "workbench" ? "workbench" : "chat");
      }}
      className="w-full [&>[data-slot=segmented-control-item]]:flex-1"
    >
      <SegmentedControlItem value="chat">{t("desktop.shell.area.chat")}</SegmentedControlItem>
      <SegmentedControlItem value="workbench">
        {t("desktop.shell.area.workbench")}
      </SegmentedControlItem>
    </SegmentedControl>
  );
}

/** 내비 줄 하나. 배지는 화면이 준 부품으로 읽어 값이 바뀌면 이 줄만 다시 그린다 */
function NavRow(props: {
  readonly def: ScreenDef | undefined;
  readonly label: string;
  readonly active: boolean;
  readonly onSelect: () => void;
}): ReactNode {
  const row = (badge: number | undefined): ReactNode => (
    <ListNavigationItem
      icon={props.def?.icon}
      className={props.active ? ACTIVE_LABEL : undefined}
      count={badge === undefined || badge <= 0 ? undefined : badge}
      onSelect={props.onSelect}
    >
      {props.label}
    </ListNavigationItem>
  );
  const Badge = props.def?.Badge;
  return Badge === undefined ? row(undefined) : <Badge render={row} />;
}

export function StartPanel(props: StartPanelProps): ReactNode {
  const area = useShell((s) => s.area);
  const screen = useShell((s) => s.places[s.area].screen);
  const actions = useShellActions();
  const items = NAV_BY_AREA[area];
  return (
    <SidePanel side="start" preset="inspector" label={t("desktop.shell.start.label")}>
      <div className="grid gap-2 p-2">
        <Button
          variant="soft"
          size="sm"
          iconStart={<Search />}
          className="w-full justify-start"
          onClick={() => {
            actions.setPaletteOpen(true);
          }}
        >
          {t("desktop.shell.search")}
          <span className="ms-auto text-text-tertiary">
            {formatKey(props.keymap["palette.open"], props.mac)}
          </span>
        </Button>
        <AreaSwitch onSwitch={props.onSwitchArea} />
        {area === "workbench" ? (
          <ContextPicker profiles={props.profiles} onGoToThread={props.onGoToThread} />
        ) : null}
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-auto px-1.5 pb-2">
        <ListNavigation
          aria-label={t(
            area === "chat" ? "desktop.shell.nav.chatGroup" : "desktop.shell.nav.workbenchGroup",
          )}
          kind="navigation"
          size="sm"
        >
          <ListNavigationGroup>
            {items.map((item) => (
              <NavRow
                key={item.id}
                def={props.registry.screen(item.id)}
                label={t(item.label)}
                active={!props.settingsOpen && item.id === screen}
                onSelect={() => {
                  props.onNavigate(item.id);
                }}
              />
            ))}
          </ListNavigationGroup>
        </ListNavigation>
        {area === "chat" ? props.threadList : null}
      </div>
      <div className="p-1.5">
        <ListNavigation
          aria-label={t("desktop.shell.settings")}
          kind="navigation"
          size="sm"
          as="div"
        >
          <ListNavigationGroup>
            <ListNavigationItem
              icon={<Settings />}
              className={props.settingsOpen ? ACTIVE_LABEL : undefined}
              meta={formatKey(props.keymap["settings.open"], props.mac)}
              onSelect={props.onOpenSettings}
            >
              {t("desktop.shell.settings")}
            </ListNavigationItem>
          </ListNavigationGroup>
        </ListNavigation>
      </div>
    </SidePanel>
  );
}

// 왼쪽 패널(S-01 시작 영역). 시안(_shell/start-panel.tsx)과 같은 틀이다.
//   머리: 영역 바꾸기(대화/크래프트) 줄 + 그 끝의 시작 영역 닫기 단추. 찾기 줄은 없다(명령 팔레트는 ⌘K). 작업대 영역은 머리에 맥락 칸을 더한다.
//   몸: 영역별 내비 + 대화 목록 슬롯. 스크롤은 몸 하나만 한다.
//   바닥: 설정. 두 영역 공통이고 늘 같은 자리(hairline 위)에 고정된다.
// 닫힘(startOpen이 거짓)은 SidePanel의 collapsed로 그린다. compact에서는 셸이 패널을 떠 있는 시트로 올리고, 닫으면 그리지 않는다.
import { activeLocale, t } from "@fresnel/client/i18n";
import { extMessageOf } from "@fresnel/client/views/native";
import {
  IconButton,
  ListNavigation,
  ListNavigationGroup,
  ListNavigationItem,
  SegmentedControl,
  SegmentedControlItem,
  SidePanel,
} from "@caustic/react";
import { Compass, IconEmphasisProvider, PanelLeft, Settings } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { ContextPicker, type ContextProfile } from "./context-picker.tsx";
import { NAV_BY_AREA } from "./nav.ts";
import type { Area } from "../../state/shell/index.ts";
import type { ScreenDef, ShellRegistry } from "./registry.ts";
import { useShell, useShellActions } from "../../state/shell/index.ts";
import { useOptionalPluginUi, usePluginUiState } from "../plugin/plugin-context.tsx";
import { pluginUiRowsOf, requestPluginScreen } from "../plugin/plugin-pick.ts";

// 지금 화면 표시는 굵기 하나로 한다(라벨을 굵게, 아이콘은 selected로)
const ACTIVE_LABEL =
  "[&_[data-slot=list-navigation-label]]:font-semibold [&_[data-slot=list-navigation-label]]:text-text-primary";

export interface StartPanelProps {
  readonly registry: ShellRegistry;
  /** 떠 있는 면(좁은 폭에서 대화 위로 뜬다)인가. 아니면 창 왼쪽 끝에 붙은 평평한 면이다 */
  readonly floating: boolean;
  readonly settingsOpen: boolean;
  readonly onOpenSettings: () => void;
  readonly onNavigate: (screen: string) => void;
  /** 영역 바꾸기 칸을 눌렀다. 열려 있는 설정 화면은 닫아야 한다 */
  readonly onSwitchArea: (area: Area) => void;
  /** 대화 영역 목록 슬롯 */
  readonly threadList: ReactNode;
  readonly profiles: readonly ContextProfile[];
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
      className="min-w-0 flex-1 [&>[data-slot=segmented-control-item]]:flex-1 [&_[data-state=checked]]:font-semibold"
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
  const icon = props.def?.icon;
  const row = (badge: number | undefined): ReactNode => (
    <ListNavigationItem
      // 화면이 준 아이콘을 감싸서 지금 화면이면 selected(굵은 글꼴)로 그린다(DP-17)
      icon={
        icon === undefined ? undefined : (
          <IconEmphasisProvider value={props.active ? "selected" : undefined}>
            {icon}
          </IconEmphasisProvider>
        )
      }
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

/**
 * "플러그인 UI" 구역(시안 `_shell/start-panel.tsx`의 작업대 목록 아래 묶음). 설치된 플러그인 화면을 행마다 바로 연다.
 * 행의 글은 화면 제목, meta는 확장 이름(mono)이고 꺼진 확장은 연하게 "꺼짐"을 보인다. `x.ui.apps`가 꺼져 있거나 화면이 없으면 그리지 않는다.
 * 화면은 대화 영역의 "플러그인 화면"(`plugins`)이 그리므로 그 화면으로 가면서 고른 화면을 알린다
 */
function PluginUiSection(props: { readonly onOpen: (key: string) => void }): ReactNode {
  const rows = pluginUiRowsOf(usePluginUiState());
  if (rows.length === 0) return null;
  return (
    <ListNavigation aria-label={t("term.pluginUi")} kind="navigation" size="xs" as="div">
      <ListNavigationGroup heading={t("term.pluginUi")}>
        {rows.map((row) => {
          const title = extMessageOf(row.entry.messages, activeLocale(), row.entry.title);
          return (
            <ListNavigationItem
              key={row.key}
              icon={<Compass />}
              className={
                row.off ? "[&_[data-slot=list-navigation-label]]:text-text-tertiary" : undefined
              }
              meta={
                <span className="font-mono text-mono-sm">
                  {row.off ? t("desktop.workbench.state.off") : row.entry.extension}
                </span>
              }
              onSelect={() => {
                props.onOpen(row.key);
              }}
            >
              {title}
            </ListNavigationItem>
          );
        })}
      </ListNavigationGroup>
    </ListNavigation>
  );
}

function PluginUiSlot(props: { readonly onOpen: (key: string) => void }): ReactNode {
  // 셸만 따로 그린 곳에는 플러그인 맥락이 없다
  return useOptionalPluginUi() === null ? null : <PluginUiSection onOpen={props.onOpen} />;
}

export function StartPanel(props: StartPanelProps): ReactNode {
  const area = useShell((s) => s.area);
  const startOpen = useShell((s) => s.startOpen);
  const screen = useShell((s) => s.places[s.area].screen);
  const actions = useShellActions();
  const items = NAV_BY_AREA[area];
  return (
    <SidePanel
      side="start"
      preset="inspector"
      label={t("desktop.shell.start.label")}
      scrollLabel={t("desktop.shell.start.label")}
      collapsed={!startOpen}
      onCollapsedChange={(collapsed) => {
        actions.setStartOpen(!collapsed);
      }}
      // 붙박이: 창 왼쪽 끝에서 위아래 끝까지 닿는 평평한 면(outline, 가장자리 헤어라인 하나). 좁은 폭에서 뜰 때만 solid와 그림자 하나.
      variant={props.floating ? "solid" : "outline"}
      shadow={props.floating ? "3" : "none"}
      // 머리·바닥 밀도는 시안의 size="sm"과 같은 값을 자리 클래스로 준다(SidePanel size 속성은 lint가 쓰지 못하게 막는다)
      className="[&>[data-slot=side-panel-header]]:min-h-(--shell-header-h) [&>[data-slot=side-panel-header]]:px-1.5 [&>[data-slot=side-panel-header]]:py-1.5 [&>[data-slot=side-panel-footer]]:px-1.5 [&>[data-slot=side-panel-footer]]:py-2"
      header={
        <div className="grid min-w-0 gap-1.5">
          {/* 영역 탭 줄 끝에 패널 접기 단추를 둔다(찾기 줄은 없다. 명령 팔레트는 ⌘K) */}
          <div className="flex min-w-0 items-center gap-1">
            <AreaSwitch onSwitch={props.onSwitchArea} />
            <IconButton
              size="sm"
              variant="ghost"
              label={t("desktop.shell.start.collapse")}
              onClick={() => {
                actions.setStartOpen(false);
              }}
            >
              <PanelLeft />
            </IconButton>
          </div>
          {area === "workbench" ? <ContextPicker profiles={props.profiles} /> : null}
        </div>
      }
      footer={
        <ListNavigation
          aria-label={t("desktop.shell.settings")}
          kind="navigation"
          size="xs"
          as="div"
          className="w-full"
        >
          <ListNavigationGroup>
            <ListNavigationItem
              icon={props.settingsOpen ? <Settings emphasis="selected" /> : <Settings />}
              className={props.settingsOpen ? ACTIVE_LABEL : undefined}
              onSelect={props.onOpenSettings}
            >
              {t("desktop.shell.settings")}
            </ListNavigationItem>
          </ListNavigationGroup>
        </ListNavigation>
      }
    >
      <div className="grid gap-2 px-1.5 pb-2">
        <ListNavigation
          aria-label={t(
            area === "chat" ? "desktop.shell.nav.chatGroup" : "desktop.shell.nav.workbenchGroup",
          )}
          kind="navigation"
          size="xs"
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
        {area === "workbench" ? (
          <PluginUiSlot
            onOpen={(key) => {
              requestPluginScreen(key);
              props.onSwitchArea("chat");
              actions.updatePlace({ screen: "plugins", scroll: 0 });
              if (props.floating) actions.setStartOpen(false);
            }}
          />
        ) : null}
        {area === "chat" ? props.threadList : null}
      </div>
    </SidePanel>
  );
}

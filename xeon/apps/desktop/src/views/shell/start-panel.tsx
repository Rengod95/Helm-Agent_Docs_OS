// 왼쪽 패널(S-01 시작 영역). 시안(_shell/start-panel.tsx)과 같은 틀이다.
//   머리: 찾기 줄(누르면 팔레트) + 시작 영역 닫기 단추 + 영역 바꾸기. 작업대 영역은 머리에 맥락 칸을 더한다.
//   몸: 영역별 내비 + 대화 목록 슬롯. 스크롤은 몸 하나만 한다.
//   바닥: 설정. 두 영역 공통이고 늘 같은 자리(hairline 위)에 고정된다.
// 닫힘(startOpen이 거짓)은 SidePanel의 collapsed로 그린다. compact에서는 셸이 패널을 떠 있는 시트로 올리고, 닫으면 그리지 않는다.
import { t } from "@fresnel/client/i18n";
import {
  IconButton,
  Input,
  ListNavigation,
  ListNavigationGroup,
  ListNavigationItem,
  SegmentedControl,
  SegmentedControlItem,
  SidePanel,
} from "@caustic/react";
import { IconEmphasisProvider, PanelLeft, Search, Settings } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { ContextPicker, type ContextProfile } from "./context-picker.tsx";
import { NAV_BY_AREA } from "./nav.ts";
import type { Area } from "../../state/shell/index.ts";
import type { ScreenDef, ShellRegistry } from "./registry.ts";
import { useShell, useShellActions } from "../../state/shell/index.ts";

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
      className="w-full [&>[data-slot=segmented-control-item]]:flex-1 [&_[data-state=checked]]:font-semibold"
    >
      <SegmentedControlItem value="chat">{t("desktop.shell.area.chat")}</SegmentedControlItem>
      <SegmentedControlItem value="workbench">
        {t("desktop.shell.area.workbench")}
      </SegmentedControlItem>
    </SegmentedControl>
  );
}

/** 찾기 줄. 입력란처럼 보이지만 글을 쓰지 않는다. 누르거나 Enter를 치면 명령 팔레트가 열린다(⌘K와 같다) */
function SearchField(): ReactNode {
  const actions = useShellActions();
  const open = (): void => {
    actions.setPaletteOpen(true);
  };
  return (
    <Input
      size="xs"
      variant="outline"
      readOnly
      prefix={<Search />}
      placeholder={t("desktop.shell.search")}
      aria-label={t("desktop.shell.search")}
      aria-haspopup="dialog"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      containerClassName="min-w-0 flex-1 bg-transparent! data-[readonly]:bg-transparent! focus-within:bg-transparent!"
      className="cursor-pointer"
    />
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
      className="[&>[data-slot=side-panel-header]]:min-h-control-lg [&>[data-slot=side-panel-header]]:px-1.5 [&>[data-slot=side-panel-header]]:py-1.5 [&>[data-slot=side-panel-footer]]:px-1.5 [&>[data-slot=side-panel-footer]]:py-2"
      header={
        <div className="grid min-w-0 gap-1.5 pb-1">
          <div className="flex min-w-0 items-center gap-1">
            <SearchField />
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
          <AreaSwitch onSwitch={props.onSwitchArea} />
          {area === "workbench" ? (
            <ContextPicker profiles={props.profiles} onGoToThread={props.onGoToThread} />
          ) : null}
        </div>
      }
      footer={
        <ListNavigation
          aria-label={t("desktop.shell.settings")}
          kind="navigation"
          size="sm"
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
    </SidePanel>
  );
}

// 왼쪽 패널(S-01 시작 영역). 시안(_shell/start-panel.tsx)과 같은 틀이다.
//   머리(고정): 영역 바꾸기(대화/크래프트) 줄 + 그 끝의 접기 단추. 그 아래 대화 영역은 "새 대화" 줄, 작업대 영역은 맥락 칸(DP-69).
//   몸(스크롤): 영역별 내비 + 대화 목록 슬롯. 스크롤은 몸 하나만 한다.
//   바닥: 설정. 두 영역 공통이고 늘 같은 자리(hairline 위)에 고정된다. 줄은 위 줄과 같은 32px, 위아래 4px.
// 접힘(startOpen이 거짓)은 48px 아이콘 막대다(DP-68): 새 대화, 내비 아이콘, 설정만 남고 대화 목록은 숨는다.
// 아이콘은 펼친 줄의 아이콘과 같은 자리(x 16..32)라 폭이 줄어드는 동안 제자리에 있다. 이름은 오른쪽 툴팁.
// compact에서는 셸이 패널을 떠 있는 시트로 올리고, 닫으면 그리지 않는다(막대 없음).
import { t } from "@fresnel/client/i18n";
import {
  IconButton,
  ListNavigation,
  ListNavigationGroup,
  ListNavigationItem,
  SegmentedControl,
  SegmentedControlItem,
  SidePanel,
  Tooltip,
} from "@caustic/react";
import { IconEmphasisProvider, PanelLeft, Settings, SquarePen } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { ContextPicker, type ContextProfile } from "./context-picker.tsx";
import type { ActionId } from "./keybindings.ts";
import { NAV_BY_AREA, type NavItem } from "./nav.ts";
import { SIDE_ROW } from "../side-row.ts";
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
  /** "새 대화" 줄을 눌렀다. 셸 밖의 새 대화 흐름(`views/new-thread-flow.ts`)을 부른다 */
  readonly onNewThread: () => void;
  /** 동작의 바로 가기 키 글자(사용자가 바꾼 키 반영). 새 대화 줄 끝과 막대 툴팁에 쓴다 */
  readonly keyLabel: (id: ActionId) => string;
}

/**
 * 접힌 막대의 단추 하나(DP-68). 36×32에 16px 아이콘이 가운데라, 바깥 여백 6px과 더해 아이콘이 펼친 줄의 아이콘(6 + 10)과 같은 x다.
 * hover는 면 색만 바꾼다(떠오름·확대 없음). 지금 화면은 caustic 내비의 `aria-current` 면 하나로 보인다
 */
const RAIL_BUTTON =
  "grid h-control-md w-9 place-items-center rounded-lg text-text-secondary outline-none transition-control hover:bg-neutral-hover hover:text-text-primary focus-visible:shadow-focus aria-[current=page]:bg-control-raised aria-[current=page]:text-text-primary aria-[current=page]:shadow-[inset_0_0_0_1px_var(--cs-color-control-edge)] aria-[current=page]:hover:bg-control-raised-hover";

function RailButton(props: {
  readonly label: string;
  readonly shortcut: string | undefined;
  readonly icon: ReactNode;
  readonly current: boolean;
  readonly onClick: () => void;
}): ReactNode {
  const button = (
    <button
      type="button"
      data-rail-item=""
      aria-label={props.label}
      aria-current={props.current ? "page" : undefined}
      className={RAIL_BUTTON}
      onClick={props.onClick}
    >
      <span aria-hidden className="inline-grid size-icon-md place-items-center [&_svg]:size-full">
        <IconEmphasisProvider value={props.current ? "selected" : undefined}>
          {props.icon}
        </IconEmphasisProvider>
      </span>
    </button>
  );
  return props.shortcut === undefined ? (
    <Tooltip content={props.label} side="right">
      {button}
    </Tooltip>
  ) : (
    <Tooltip content={props.label} side="right" shortcut={props.shortcut}>
      {button}
    </Tooltip>
  );
}

/** 막대의 내비 단추. 배지 수는 막대에 그리지 않고 이름에 붙인다("제안 3") */
function RailNavButton(props: {
  readonly def: ScreenDef | undefined;
  readonly label: string;
  readonly shortcut: string | undefined;
  readonly active: boolean;
  readonly onSelect: () => void;
}): ReactNode {
  const button = (badge: number | undefined): ReactNode => (
    <RailButton
      label={badge === undefined || badge <= 0 ? props.label : `${props.label} ${String(badge)}`}
      shortcut={props.shortcut}
      icon={props.def?.icon}
      current={props.active}
      onClick={props.onSelect}
    />
  );
  const Badge = props.def?.Badge;
  return Badge === undefined ? button(undefined) : <Badge render={button} />;
}

/** 대화 영역 머리 둘째 줄의 "새 대화"(DP-69). 내비 줄과 같은 크기이고, 끝의 단축키는 곁 정보 크기(11px tertiary)다 */
function NewThreadRow(props: {
  readonly shortcut: string;
  readonly onSelect: () => void;
}): ReactNode {
  return (
    <ListNavigation
      aria-label={t("desktop.shell.start.newThread")}
      kind="navigation"
      size="xs"
      as="div"
      className="w-full"
    >
      <ListNavigationGroup>
        <ListNavigationItem
          icon={<SquarePen />}
          className={SIDE_ROW}
          meta={<kbd className="font-ui">{props.shortcut}</kbd>}
          onSelect={props.onSelect}
        >
          {t("desktop.shell.start.newThread")}
        </ListNavigationItem>
      </ListNavigationGroup>
    </ListNavigation>
  );
}

const shortcutOf = (item: NavItem, keyLabel: (id: ActionId) => string): string | undefined =>
  item.action === undefined ? undefined : keyLabel(item.action);

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
  const Mark = props.def?.Mark;
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
      className={props.active ? `${SIDE_ROW} ${ACTIVE_LABEL}` : SIDE_ROW}
      // 수 앞 표시는 화면이 준 부품 하나뿐이다(제안·리뷰 줄의 크리스탈, DP-223). 다른 줄은 수만 둔다(DP-211 [결정: 2026-11-13 사용자 "남용"])
      {...(Mark === undefined ? {} : { meta: <Mark />, "data-crystal-host": "" })}
      count={badge === undefined || badge <= 0 ? undefined : badge}
      onSelect={props.onSelect}
    >
      {props.label}
    </ListNavigationItem>
  );
  const Badge = props.def?.Badge;
  return Badge === undefined ? row(undefined) : <Badge render={row} />;
}

// 머리·바닥 밀도는 시안의 size="sm"과 같은 값을 자리 클래스로 준다(SidePanel size 속성은 lint가 쓰지 못하게 막는다).
// 바닥은 위아래 4px: 설정 줄(32)이 위 줄들과 같은 높이로 보인다(DP-68, 전에는 8px로 49px)
const PANEL_SLOTS =
  "[&>[data-slot=side-panel-header]]:min-h-(--shell-header-h) [&>[data-slot=side-panel-header]]:px-1.5 [&>[data-slot=side-panel-header]]:py-1.5 [&>[data-slot=side-panel-footer]]:px-1.5 [&>[data-slot=side-panel-footer]]:py-1";

export function StartPanel(props: StartPanelProps): ReactNode {
  const area = useShell((s) => s.area);
  const startOpen = useShell((s) => s.startOpen);
  const screen = useShell((s) => s.places[s.area].screen);
  const actions = useShellActions();
  const items = NAV_BY_AREA[area];
  // 떠 있는 시트(compact)는 접히면 셸이 그리지 않으므로 막대가 되지 않는다
  const rail = !startOpen && !props.floating;
  const navLabel = t(
    area === "chat" ? "desktop.shell.nav.chatGroup" : "desktop.shell.nav.workbenchGroup",
  );
  return (
    <SidePanel
      side="start"
      preset="inspector"
      label={t("desktop.shell.start.label")}
      scrollLabel={t("desktop.shell.start.label")}
      data-rail={rail ? "" : undefined}
      // 붙박이: 창 왼쪽 끝에서 위아래 끝까지 닿는 평평한 면(outline, 가장자리 헤어라인 하나). 좁은 폭에서 뜰 때만 solid와 그림자 하나.
      variant={props.floating ? "solid" : "outline"}
      shadow={props.floating ? "3" : "none"}
      // 막대 안쪽은 48px(바깥 6 + 단추 36 + 6)이고 오른쪽 hairline 1px이 더해진다. 폭은 애니메이션하지 않는다(transition-none, DP-106):
      // 폭을 잇면 무대 전체가 프레임마다 다시 배치된다. 셸이 무대를 transform으로 잇고 내용을 투명도로 바꾼다(shell.tsx)
      // 막대에서는 바닥 위 선을 지운다: 48px 폭의 짧은 선은 상태 표시줄 띠와 어긋난 자국으로만 보인다
      className={
        rail
          ? `${PANEL_SLOTS} w-[calc(3rem+1px)] transition-none [&>[data-slot=side-panel-footer]]:border-transparent`
          : `${PANEL_SLOTS} transition-none`
      }
      header={
        rail ? (
          <div className="grid justify-items-start gap-1.5">
            {/* 머리 띠 칸(DP-122): 로고는 없다(DP-172). 칸은 남아 머리 선이 이어지고 아래 단추가 움직이지 않는다.
                창 틀(DP-80): macOS 신호등은 이 칸 위에 온다 */}
            <span data-header-band="" />
            {area === "chat" ? (
              <RailButton
                label={t("desktop.shell.start.newThread")}
                shortcut={props.keyLabel("thread.new")}
                icon={<SquarePen />}
                current={false}
                onClick={props.onNewThread}
              />
            ) : null}
          </div>
        ) : (
          <div className="grid min-w-0 gap-1.5">
            {/* 영역 탭 줄 끝에 패널 접기 단추를 둔다(찾기 줄은 없다. 명령 팔레트는 ⌘K) */}
            {/* 창 틀(DP-80): macOS 신호등 자리만큼 styles.css가 이 줄 앞을 비운다. 로고는 없고 영역 탭이 첫 요소다(DP-172) */}
            {/* 머리 띠(DP-122): 화면 머리와 같은 `--shell-header-h` 높이와 아래 선. 가운데 줄이 신호등·화면 제목과 같은 y 22에 선다 */}
            <div data-chrome-row="" data-header-band="" className="flex min-w-0 items-center gap-1">
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
            {area === "chat" ? (
              <NewThreadRow shortcut={props.keyLabel("thread.new")} onSelect={props.onNewThread} />
            ) : (
              <ContextPicker profiles={props.profiles} />
            )}
          </div>
        )
      }
      footer={
        rail ? (
          <RailButton
            label={t("desktop.shell.settings")}
            shortcut={props.keyLabel("settings.open")}
            icon={<Settings />}
            current={props.settingsOpen}
            onClick={props.onOpenSettings}
          />
        ) : (
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
                className={props.settingsOpen ? `${SIDE_ROW} ${ACTIVE_LABEL}` : SIDE_ROW}
                onSelect={props.onOpenSettings}
              >
                {t("desktop.shell.settings")}
              </ListNavigationItem>
            </ListNavigationGroup>
          </ListNavigation>
        )
      }
    >
      {rail ? (
        <nav aria-label={navLabel} className="px-1.5 pb-2">
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {items.map((item) => (
              <li key={item.id}>
                <RailNavButton
                  def={props.registry.screen(item.id)}
                  label={t(item.label)}
                  shortcut={shortcutOf(item, props.keyLabel)}
                  active={!props.settingsOpen && item.id === screen}
                  onSelect={() => {
                    props.onNavigate(item.id);
                  }}
                />
              </li>
            ))}
          </ul>
        </nav>
      ) : (
        <div className="grid gap-2 px-1.5 pb-2">
          <ListNavigation aria-label={navLabel} kind="navigation" size="xs">
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
      )}
    </SidePanel>
  );
}

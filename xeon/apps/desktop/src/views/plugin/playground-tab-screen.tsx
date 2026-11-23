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
import {
  ChevronLeft,
  Ellipsis,
  LayoutGrid,
  MessageSquare,
  PanelRight,
  Settings,
} from "@caustic/react/icons";
import { useEffect, useState, type ReactNode } from "react";
import { useShell } from "../../state/shell/index.ts";
import { useComposerRequest } from "../../state/ui/index.ts";
import {
  HEADER_CONTROL_SIZE,
  HEADER_SEGMENTED_SIZE,
  HEADER_SELECT_SIZE,
} from "../shell/screen-header.tsx";
import { useAddonData } from "./addon-data.ts";
import { addonDetailOf, type AddonDetail, type AddonScreen } from "./addon-model.ts";
import { AppChatColumn } from "./app-chat-column.tsx";
import { useAppMoves, type AppMoves } from "./app-moves.ts";
import { PinIcon } from "./plugin-glyph.tsx";
import { usePlaygroundTabs } from "./playground-tab-strip.tsx";
import { openTab, PLAYGROUND_TAB_SCREEN, useTabRunState } from "./playground-tab-store.ts";
import { isPinned } from "./playground-tabs.ts";
import { PluginView } from "./plugin-view.tsx";
import { useScreenEnter } from "../../lib/motion-presets.tsx";

// 앱 작업 공간(AGE-78). 셸 화면은 머리 줄 탭 화면(`playground-tab`, keepAlive, DP-90)이라 고정 탭과 같은 상태를 본다.
// 한 번 연 앱마다 그 플러그인의 화면을 하나씩 두고 지금 앱만 보인다. 그래서 대화, 설정, 크래프트를 다녀오거나 다른 탭을 봐도
// 프레임과 화면 트리의 상태가 그대로다(열어 둔 탭 상한 8, 오래 안 본 것부터 내린다). 화면이 여럿인 플러그인은 머리의 화면 고르기로 바꾼다.
// 머리: 뒤로(플레이그라운드 홈), 앱 이름, 화면 고르기, 대화 열 토글, "대화 옆에", 더 보기(고치기, 관리, 고정과 떼기, 모든 앱).
// 대화 열(`AppChatColumn`)은 앱 오른쪽에 끼운다. 이 화면이 보일 때만 그린다(숨은 화면에 입력창이 하나 더 있으면 요청을 가로챈다).

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

/** 대화 열 토글 상태 */
interface ChatToggle {
  readonly open: boolean;
  readonly onToggle: () => void;
}

/** 머리 끝 동작: 대화 열 토글, 대화 옆에, 더 보기 메뉴 */
function AppActions(props: {
  readonly detail: AddonDetail;
  readonly screenKey: string;
  readonly pinned: boolean;
  readonly chat: ChatToggle;
  readonly moves: AppMoves;
  readonly onPin: (pinned: boolean) => void;
}): ReactNode {
  const { detail, moves } = props;
  const name = detail.row.name;
  const more = t("desktop.apps.more", { name: detail.row.title });
  return (
    <div className="flex flex-none items-center gap-1">
      <IconButton
        size={HEADER_CONTROL_SIZE}
        variant="ghost"
        label={t("desktop.apps.chat.toggle")}
        aria-pressed={props.chat.open}
        onClick={props.chat.onToggle}
      >
        <MessageSquare />
      </IconButton>
      <Button
        size={HEADER_CONTROL_SIZE}
        variant="ghost"
        iconStart={<PanelRight aria-hidden />}
        onClick={() => {
          moves.beside(props.screenKey);
        }}
      >
        {t("desktop.apps.beside")}
      </Button>
      <Menu
        size="sm"
        align="end"
        aria-label={more}
        trigger={
          <IconButton size={HEADER_CONTROL_SIZE} variant="ghost" label={more}>
            <Ellipsis />
          </IconButton>
        }
      >
        {detail.row.builtin ? null : (
          <MenuItem
            icon={<MessageSquare />}
            onSelect={() => {
              moves.fix(name);
            }}
          >
            {t("desktop.apps.menu.fix")}
          </MenuItem>
        )}
        <MenuItem
          icon={<Settings />}
          onSelect={() => {
            moves.manage(name);
          }}
        >
          {t("desktop.apps.menu.manage")}
        </MenuItem>
        <MenuItem
          icon={<PinIcon aria-hidden />}
          onSelect={() => {
            props.onPin(!props.pinned);
          }}
        >
          {t(props.pinned ? "desktop.apps.menu.unpin" : "desktop.apps.menu.pin")}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<LayoutGrid />} onSelect={moves.home}>
          {t("desktop.playgroundTabs.openPlayground")}
        </MenuItem>
      </Menu>
    </div>
  );
}

/** 플러그인 하나의 탭 칸. 이 플러그인에서 한 번 본 화면은 숨겨 둔다 */
function TabPane(props: {
  readonly detail: AddonDetail;
  readonly shown: boolean;
  readonly picked: string | undefined;
  readonly pinned: boolean;
  readonly chat: ChatToggle;
  readonly moves: AppMoves;
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
  // 탭을 바꾸거나 화면을 고르면 새 화면이 8px 오르며 들어온다(fade-through, DP-106). 숨은 탭은 세지 않는다
  const box = useScreenEnter<HTMLDivElement>(props.shown ? (current ?? "") : null);
  return (
    <div
      ref={box}
      className={props.shown ? "flex min-h-0 flex-1 flex-col" : "hidden"}
      hidden={!props.shown}
    >
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
                lead: (
                  <IconButton
                    size={HEADER_CONTROL_SIZE}
                    variant="ghost"
                    label={t("desktop.apps.back")}
                    className="-ms-1.5 flex-none"
                    onClick={props.moves.home}
                  >
                    <ChevronLeft />
                  </IconButton>
                ),
                title: detail.row.title,
                controls: <ScreenPick screens={detail.screens} value={key} onPick={pick} />,
                action: (
                  <AppActions
                    detail={detail}
                    screenKey={key}
                    pinned={props.pinned}
                    chat={props.chat}
                    moves={props.moves}
                    onPin={(next) => {
                      props.actions.pin(name, next);
                    }}
                  />
                ),
                onManage: () => {
                  props.moves.manage(name);
                },
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
  const { tabs, actions, prefs } = usePlaygroundTabs();
  const data = useAddonData(false);
  const moves = useAppMoves();
  const visible = useShell(
    (state) => state.area === "chat" && state.places.chat.screen === PLAYGROUND_TAB_SCREEN,
  );
  const [chatOpen, setChatOpen] = useState(false);
  // 앱이 입력창에 글을 넣었으면(AGE-78 `post`) 사람이 읽고 보내도록 대화 열을 연다
  const request = useComposerRequest();
  const asked = request !== null && request.insert !== null;
  if (visible && asked && !chatOpen) setChatOpen(true);
  const chat: ChatToggle = {
    open: chatOpen,
    onToggle: () => {
      setChatOpen(!chatOpen);
    },
  };
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
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {panes.map((detail) => (
          <TabPane
            key={detail.row.name}
            detail={detail}
            shown={detail.row.name === run.active}
            picked={run.screens.get(detail.row.name)}
            pinned={prefs !== undefined && isPinned(prefs, detail.row.name)}
            chat={chat}
            moves={moves}
            actions={actions}
          />
        ))}
      </div>
      {chatOpen && visible ? (
        <AppChatColumn
          onClose={() => {
            setChatOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

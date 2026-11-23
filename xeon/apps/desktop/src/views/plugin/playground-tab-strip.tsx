import { t } from "@fresnel/client/i18n";
import { IconButton, Menu, MenuItem, MenuSeparator, Tooltip } from "@caustic/react";
import { ChevronDown, ChevronLeft, ChevronRight, Info, LayoutGrid } from "@caustic/react/icons";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { useShell, useShellActions } from "../../state/shell/index.ts";
import { useScreen } from "../../state/ui/index.ts";
import { WorkbenchStoreContext } from "../../state/workbench/index.ts";
import { useCommands } from "../commands.ts";
import { useAddonData } from "./addon-data.ts";
import { addonMovesOf } from "./app-moves.ts";
import { tabbableRowsOf, type AddonRow } from "./addon-model.ts";
import { PluginGlyph } from "./plugin-glyph.tsx";
import { useOptionalPluginUi } from "./plugin-context.tsx";
import {
  ensureTabPrefs,
  openTab,
  PLAYGROUND_TAB_SCREEN,
  saveTabPrefs,
  dropTab,
  useTabRunState,
} from "./playground-tab-store.ts";
import {
  dragEdgeOf,
  pinnedTabsOf,
  STRIP_SHARE,
  stripFadeOf,
  tabModeOf,
  wheelShiftOf,
  withAutoPinned,
  withDropped,
  withMoved,
  withPinned,
  type PlaygroundTabsPrefs,
} from "./playground-tabs.ts";

// 머리 줄 플레이그라운드 탭(L4.desktop-ux DP-90 [결정: 2026-11-11 사용자], 시안 `_notes/design/dz/dzP-design.md` 1절).
// 모든 화면 머리(`ScreenHeader`)의 맨 앞에 선다. 탭은 28px, 이름 탭은 최대 160px(좁은 창은 아이콘 탭).
// 탭 줄은 머리 폭의 절반까지 쓰고, 넘치면 가로로 스크롤한다(DP-124): 스크롤 막대는 숨기고 가려진 쪽 끝을 흐리게 하며,
// 세로 휠도 가로로 옮긴다. 지금 탭과 키보드 초점이 간 탭은 늘 보이게 스크롤한다. 넘칠 때만 끝에 "모든 탭" 메뉴가 선다.
// 누르면 그 플러그인 화면을 본문에 연다(크래프트에서는 대화 영역으로, 설정이 열려 있으면 닫는다). 오른쪽 클릭은 탭 메뉴, 끌면 순서가 바뀐다.
// 탭 줄 전체(스크롤 영역 포함)는 창 틀 끌기에서 빠진다(styles.css DP-80·124).

const DRAG_TYPE = "application/x-fresnel-playground-tab";

/** 탭 하나의 겉모습. 지금 탭은 왼쪽 내비 막대의 지금 표시와 같은 면(raised + 안쪽 선)이다 */
const TAB =
  "relative inline-flex h-control-sm flex-none items-center gap-1.5 rounded-lg text-ui font-medium text-text-secondary outline-none transition-control hover:bg-neutral-hover hover:text-text-primary focus-visible:shadow-focus aria-[current=page]:bg-control-raised aria-[current=page]:text-text-primary aria-[current=page]:shadow-[inset_0_0_0_1px_var(--cs-color-control-edge)]";

/** 주의 점: 아이콘 오른쪽 위, 바탕색 테두리로 떼어 낸다 */
function AttentionDot(props: { readonly tone: "warning" | "danger" }): ReactNode {
  return (
    <span
      aria-hidden
      data-slot="tab-attention"
      className={`absolute -end-0.5 -top-0.5 size-1.5 rounded-full shadow-[0_0_0_2px_var(--cs-color-bg-app)] ${props.tone === "danger" ? "bg-danger-solid" : "bg-warning-solid"}`}
    />
  );
}

function tabLabelOf(row: AddonRow): string {
  const state =
    row.attention === "danger"
      ? t("desktop.playgroundTabs.attention.danger")
      : row.attention === "warning"
        ? t("desktop.playgroundTabs.attention.warning")
        : row.off
          ? t("desktop.addons.badge.off")
          : undefined;
  return state === undefined ? row.title : `${row.title}, ${state}`;
}

interface TabActions {
  /** 탭을 연다. 화면 키를 주면 그 화면으로 */
  readonly open: (name: string, screenKey?: string) => void;
  /** 플레이그라운드 목록으로 */
  readonly playground: () => void;
  readonly details: (name: string) => void;
  readonly move: (name: string, delta: -1 | 1) => void;
  readonly unpin: (name: string) => void;
}

/** 탭 메뉴 항목: 플러그인 정보, 왼쪽·오른쪽으로, 고정 해제 */
function TabMenuItems(props: {
  readonly name: string;
  readonly index: number;
  readonly count: number;
  readonly actions: TabActions;
}): ReactNode {
  const { name, actions } = props;
  return (
    <>
      <MenuItem
        icon={<Info />}
        onSelect={() => {
          actions.details(name);
        }}
      >
        {t("desktop.playgroundTabs.menu.details")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={<ChevronLeft />}
        disabled={props.index <= 0}
        onSelect={() => {
          actions.move(name, -1);
        }}
      >
        {t("desktop.playgroundTabs.menu.left")}
      </MenuItem>
      <MenuItem
        icon={<ChevronRight />}
        disabled={props.index >= props.count - 1}
        onSelect={() => {
          actions.move(name, 1);
        }}
      >
        {t("desktop.playgroundTabs.menu.right")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        onSelect={() => {
          actions.unpin(name);
        }}
      >
        {t("desktop.playgroundTabs.menu.unpin")}
      </MenuItem>
    </>
  );
}

function Tab(props: {
  readonly row: AddonRow;
  readonly mode: "label" | "icon";
  readonly current: boolean;
  readonly index: number;
  readonly count: number;
  readonly dropBefore: boolean;
  readonly actions: TabActions;
  readonly onDragStart: () => void;
  readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLElement>) => void;
  readonly onDragEnd: () => void;
}): ReactNode {
  const { row } = props;
  const [menu, setMenu] = useState(false);
  const label = tabLabelOf(row);
  const button = (
    <button
      type="button"
      data-slot="playground-tab"
      data-tab={row.name}
      draggable
      aria-current={props.current ? "page" : undefined}
      aria-label={props.mode === "icon" || label !== row.title ? label : undefined}
      className={`${TAB} ${props.mode === "icon" ? "w-control-sm justify-center" : "max-w-40 px-2"} ${row.off ? "text-text-tertiary" : ""}`}
      onClick={() => {
        props.actions.open(row.name);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu(true);
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, row.name);
        event.dataTransfer.effectAllowed = "move";
        props.onDragStart();
      }}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
    >
      <span className="relative inline-flex flex-none">
        <PluginGlyph icon={row.icon} monogram={row.monogram} size="tab" off={row.off} />
        {row.attention === undefined ? null : <AttentionDot tone={row.attention} />}
      </span>
      {props.mode === "label" ? <span className="min-w-0 truncate">{row.title}</span> : null}
    </button>
  );
  return (
    <span className="relative inline-flex flex-none">
      {props.dropBefore ? (
        <span
          aria-hidden
          className="absolute inset-y-1 -start-0.75 w-0.5 rounded-full bg-accent-solid"
        />
      ) : null}
      {props.mode === "icon" ? (
        <Tooltip content={label} side="bottom">
          {button}
        </Tooltip>
      ) : (
        button
      )}
      {/* 오른쪽 클릭 메뉴의 자리. 왼쪽 클릭은 탭을 열고 메뉴를 열지 않는다 */}
      <Menu
        size="sm"
        align="start"
        open={menu}
        onOpenChange={setMenu}
        aria-label={t("desktop.playgroundTabs.menu.label", { name: row.title })}
        trigger={
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-0" />
        }
      >
        <TabMenuItems
          name={row.name}
          index={props.index}
          count={props.count}
          actions={props.actions}
        />
      </Menu>
    </span>
  );
}

/**
 * 탭 줄의 가로 스크롤(DP-124). 양 끝 흐림과 넘침 여부를 재고, 세로 휠을 가로로 옮기며, 고른 탭이 바뀌면 그 탭을 보이게 한다.
 * 휠은 기본 동작을 막아야 해서(passive: false) React 이벤트가 아니라 직접 단다
 */
function useStripScroll(
  enabled: boolean,
  currentName: string | undefined,
): {
  readonly ref: { current: HTMLDivElement | null };
  readonly fade: { readonly start: boolean; readonly end: boolean };
  readonly overflow: boolean;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [fade, setFade] = useState({ start: false, end: false });
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || el === null) return undefined;
    const measure = (): void => {
      const next = stripFadeOf(el.scrollLeft, el.scrollWidth, el.clientWidth);
      setFade((current) =>
        current.start === next.start && current.end === next.end ? current : next,
      );
      setOverflow(el.scrollWidth > el.clientWidth + 1);
    };
    const wheel = (event: WheelEvent): void => {
      const shift = wheelShiftOf(
        event.deltaX,
        event.deltaY,
        el.scrollLeft,
        el.scrollWidth,
        el.clientWidth,
      );
      if (shift === 0) return;
      event.preventDefault();
      el.scrollLeft += shift;
    };
    measure();
    // 줄 자체의 폭(머리 크기)과 안의 탭 줄 폭(탭 수·이름) 둘 다 바뀔 수 있다
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    const mutations = new MutationObserver(() => {
      for (const child of el.children) observer.observe(child);
      measure();
    });
    mutations.observe(el, { childList: true });
    el.addEventListener("scroll", measure, { passive: true });
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      mutations.disconnect();
      el.removeEventListener("scroll", measure);
      el.removeEventListener("wheel", wheel);
    };
  }, [enabled]);
  // 고른 탭은 늘 보이게(다른 화면에서 탭을 바꿨거나 메뉴로 골랐을 때)
  useEffect(() => {
    const el = ref.current;
    if (el === null || currentName === undefined) return;
    const tab = [...el.querySelectorAll<HTMLElement>("[data-slot=playground-tab]")].find(
      (node) => node.dataset["tab"] === currentName,
    );
    tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [currentName]);
  return { ref, fade, overflow };
}

/** 고정 탭 정보와 동작. 탭 줄과 탭 화면이 같이 쓴다 */
export function usePlaygroundTabs(): {
  readonly rows: readonly AddonRow[];
  readonly tabs: readonly AddonRow[];
  readonly prefs: PlaygroundTabsPrefs | undefined;
  readonly actions: TabActions & { readonly pin: (name: string, pinned: boolean) => void };
} {
  const commands = useCommands();
  const shell = useShellActions();
  const workbench = useContext(WorkbenchStoreContext)?.actions;
  const data = useAddonData(false);
  const run = useTabRunState();
  const rows = useMemo(
    () => tabbableRowsOf(data.source, data.meta, data.locale),
    [data.source, data.meta, data.locale],
  );
  const names = useMemo(() => rows.map((row) => row.name), [rows]);
  useEffect(() => {
    ensureTabPrefs(commands);
  }, [commands]);
  // 처음 보는 화면 플러그인은 끝에 자동 고정한다. 화면 목록을 다 읽은 뒤에만(읽는 중의 빈 목록으로 판정하지 않는다)
  useEffect(() => {
    if (run.prefs === undefined || data.phase !== "ready") return;
    saveTabPrefs(commands, withAutoPinned(run.prefs, names));
  }, [commands, run.prefs, names, data.phase]);
  const prefs = run.prefs;
  const tabs = useMemo(() => {
    const pinned = prefs === undefined ? [] : pinnedTabsOf(prefs, names);
    return pinned.flatMap((name) => rows.filter((row) => row.name === name));
  }, [prefs, names, rows]);
  const update = (next: (current: PlaygroundTabsPrefs) => PlaygroundTabsPrefs): void => {
    if (prefs !== undefined) saveTabPrefs(commands, next(prefs));
  };
  const actions = {
    open: (name: string, screenKey?: string) => {
      openTab(name, screenKey);
      shell.switchArea("chat");
      commands.showScreen("chat");
      shell.updatePlace({ screen: PLAYGROUND_TAB_SCREEN, scroll: 0 });
    },
    playground: () => {
      shell.switchArea("chat");
      commands.showScreen("chat");
      shell.updatePlace({ screen: "plugins", scroll: 0 });
    },
    details: (name: string) => {
      addonMovesOf(shell, workbench).manage(name);
    },
    move: (name: string, delta: -1 | 1) => {
      update((current) => withMoved(current, names, name, delta));
    },
    unpin: (name: string) => {
      update((current) => withPinned(current, name, false));
      dropTab(name);
    },
    pin: (name: string, pinned: boolean) => {
      update((current) => withPinned(current, name, pinned));
      if (!pinned) dropTab(name);
    },
  };
  return { rows, tabs, prefs, actions };
}

/** 탭 줄 본체. 고정 탭이 없으면 아무것도 그리지 않는다(구분선도) */
function TabStrip(): ReactNode {
  const { tabs, prefs, rows, actions } = usePlaygroundTabs();
  const compact = useShell((s) => s.layout) === "compact";
  const onTabScreen = useShell(
    (s) => s.area === "chat" && s.places.chat.screen === PLAYGROUND_TAB_SCREEN,
  );
  const settingsOpen = useScreen() === "settings";
  const active = useTabRunState().active;
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<string | null>(null);
  const commands = useCommands();
  const names = rows.map((row) => row.name);
  const mode = tabModeOf(compact);
  const currentName = onTabScreen && !settingsOpen ? active : undefined;
  const { ref: stripRef, fade, overflow } = useStripScroll(tabs.length > 0, currentName);
  if (tabs.length === 0) return null;
  const drop = (before: string | null): void => {
    if (dragging !== null && prefs !== undefined) {
      saveTabPrefs(commands, withDropped(prefs, names, dragging, before));
    }
    setDragging(null);
    setDropAt(null);
  };
  const allLabel = t("desktop.playgroundTabs.all", { count: tabs.length });
  return (
    <div
      role="toolbar"
      aria-label={t("desktop.playgroundTabs.label")}
      data-slot="playground-tabs"
      className="flex min-w-0 flex-none items-center"
      // 머리 폭의 절반까지(DP-124). 넘치면 안쪽 줄이 줄어들며 스크롤된다
      style={{ maxWidth: `${String(STRIP_SHARE * 100)}%` }}
    >
      <div
        ref={stripRef}
        data-slot="playground-tabs-scroll"
        data-fade-start={fade.start ? "" : undefined}
        data-fade-end={fade.end ? "" : undefined}
        // 위아래 4px은 초점 고리가 스크롤 상자에 잘리지 않을 자리다. 초점이 간 탭은 흐린 끝 밖으로 나오게 스크롤한다
        className="flex min-w-0 items-center gap-0.5 overflow-x-auto overscroll-x-contain px-0.5 py-1 [scroll-padding-inline:24px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onFocus={(event) => {
          if (event.target instanceof HTMLElement) {
            event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
          }
        }}
        onDragOver={(event) => {
          if (dragging === null) return;
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          event.currentTarget.scrollLeft += dragEdgeOf(event.clientX, box.left, box.right) * 8;
        }}
        onDrop={(event) => {
          event.preventDefault();
          drop(dropAt);
        }}
      >
        {tabs.map((row, index) => (
          <Tab
            key={row.name}
            row={row}
            mode={mode}
            current={row.name === currentName}
            index={index}
            count={tabs.length}
            dropBefore={dragging !== null && dropAt === row.name && dragging !== row.name}
            actions={actions}
            onDragStart={() => {
              setDragging(row.name);
            }}
            onDragOver={(event) => {
              if (dragging === null) return;
              event.preventDefault();
              const box = event.currentTarget.getBoundingClientRect();
              const after = event.clientX > box.left + box.width / 2;
              setDropAt(after ? (tabs[index + 1]?.name ?? null) : row.name);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              drop(dropAt);
            }}
            onDragEnd={() => {
              setDragging(null);
              setDropAt(null);
            }}
          />
        ))}
      </div>
      {/* 넘칠 때만: 모든 탭을 이름으로 훑어 고르는 메뉴(스크롤로 찾기보다 빠르다) */}
      {overflow ? (
        <Menu
          size="sm"
          align="end"
          aria-label={allLabel}
          trigger={
            <IconButton size="sm" variant="ghost" label={allLabel} className="ms-0.5 flex-none">
              <ChevronDown />
            </IconButton>
          }
        >
          {tabs.map((row) => (
            <MenuItem
              key={row.name}
              icon={<PluginGlyph icon={row.icon} monogram={row.monogram} size="tab" />}
              selected={row.name === currentName}
              onSelect={() => {
                actions.open(row.name);
              }}
            >
              {row.title}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem icon={<LayoutGrid />} onSelect={actions.playground}>
            {t("desktop.playgroundTabs.openPlayground")}
          </MenuItem>
        </Menu>
      ) : null}
      {/* 탭 묶음과 화면 제목을 가르는 선(DP-124): 머리 높이의 44%(20px), 주변 hairline보다 한 단계 진한 border.default */}
      <span
        aria-hidden
        data-slot="playground-tabs-divider"
        className="mx-2 h-5 w-px flex-none bg-border-default"
      />
    </div>
  );
}

/** 화면 머리 맨 앞 슬롯. 플러그인 맥락이 없는 곳(셸만 그린 시험)에서는 그리지 않는다 */
export function PlaygroundTabStrip(): ReactNode {
  return useOptionalPluginUi() === null ? null : <TabStrip />;
}

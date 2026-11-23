import { t, type MessageId } from "@fresnel/client/i18n";
import { Button, IconButton, Skeleton } from "@caustic/react";
import { ChevronLeft, ChevronRight, Command, MessageSquare, Monitor } from "@caustic/react/icons";
import { useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { ShellStoreContext, type ShellActions } from "../../state/shell/index.ts";
import { WorkbenchStoreContext, type WorkbenchActions } from "../../state/workbench/index.ts";
import { useCommands } from "../commands.ts";
import {
  HEADER_CONTROL_SIZE,
  HEADER_PRIMARY_VARIANT,
  ScreenHeader,
} from "../shell/screen-header.tsx";
import { useAddonData } from "./addon-data.ts";
import {
  ADDON_LIST,
  addonDetailOf,
  addonRouteOf,
  addonRowsOf,
  splitBuiltin,
  type AddonDetail,
  type AddonRoute,
  type AddonRow,
  type AddonScreen,
} from "./addon-model.ts";
import { CARD, ICON, ProblemsNotice, ROW, ScreenRow, Section } from "./addon-parts.tsx";
import { ORIGIN_TEXT, PluginCard } from "./plugin-card.tsx";
import { PinIcon, PluginGlyph } from "./plugin-glyph.tsx";
import {
  markAddonRequest,
  pendingAddonRequest,
  useAddonRequest,
  type AddonRequestTarget,
} from "./plugin-pick.ts";
import { usePlaygroundTabs } from "./playground-tab-strip.tsx";
import { isPinned } from "./playground-tabs.ts";
import { PluginView } from "./plugin-view.tsx";
import { ScreenSwap } from "../../lib/motion-presets.tsx";

// 대화 영역 "플레이그라운드" 화면(화면 id `plugins`, ADR-0021 §3.11, desktop-ux DP-91·92 [결정: 2026-11-11 사용자]).
// 플러그인이 만든 화면을 여는 곳이다. 세 자리: 목록(화면이 있는 플러그인의 카드, 내장은 접힌 묶음) → 상세(머리 블록과 화면 줄)
// → 실행(화면 하나, `PluginView`). 켜고 끔, 기능 실행, 설정, 권한 같은 관리는 크래프트 상세 "화면과 설정" 탭이 맡는다(AGE-76 plugMin).
// 상세 머리의 "관리" 하나가 그리로 보낸다. 모델은 `addon-model.ts`(순수), 치수 근거는 노트 `design/dz/dzP-design.md`다.

/** 가운데 열: 960px, 오른쪽 막대만큼 비켜 둔다(설정 화면과 같은 식) */
const SCROLL =
  "min-h-0 flex-1 overflow-y-auto ps-6 pe-[calc(var(--shell-rail,0px)+var(--cs-space-6))] pb-12";
const COLUMN = "mx-auto grid w-full max-w-240 content-start";

// ---- 이동 ----

export interface AddonMoves {
  /** 크래프트 > 확장 목록 */
  readonly findPlugins: () => void;
  /** 크래프트 > 확장 > 그 확장 상세 */
  readonly manage: (name: string) => void;
  /** 크래프트 개요의 플러그인 빌더 상자 */
  readonly buildPlugin: () => void;
}

/** 크래프트로 가는 동작. 셸이나 워크벤치 문맥이 없는 곳(시험)에서는 그 부분을 건너뛴다 */
export function addonMovesOf(
  shell: ShellActions | undefined,
  workbench: WorkbenchActions | undefined,
): AddonMoves {
  const go = (screen: string): void => {
    shell?.switchArea("workbench");
    shell?.updatePlace({ screen, scroll: 0 });
  };
  return {
    findPlugins: () => {
      go("extensions");
    },
    manage: (name) => {
      go("extensions");
      workbench?.pickPlugin(name);
      workbench?.openDetail(name);
    },
    buildPlugin: () => {
      go("extensions");
      workbench?.requestBuilder(null);
    },
  };
}

function useAddonMoves(): AddonMoves {
  const shell = useContext(ShellStoreContext)?.actions;
  const workbench = useContext(WorkbenchStoreContext)?.actions;
  return useMemo(() => addonMovesOf(shell, workbench), [shell, workbench]);
}

// ---- 목록 ----

function CardGrid(props: {
  readonly rows: readonly AddonRow[];
  readonly label: string;
  readonly pinned: (name: string) => boolean;
  readonly onOpen: (name: string) => void;
}): ReactNode {
  return (
    <ul
      aria-label={props.label}
      className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(17.5rem,1fr))] gap-3 p-0"
    >
      {props.rows.map((row) => (
        <PluginCard
          key={row.name}
          row={row}
          pinned={props.pinned(row.name)}
          onOpen={() => {
            props.onOpen(row.name);
          }}
        />
      ))}
    </ul>
  );
}

/** 내장 묶음: 접힌 머리 한 줄(누르면 펼침). 엔진 핵심 기능이라 기본으로 접는다 */
function BuiltinGroup(props: {
  readonly rows: readonly AddonRow[];
  readonly children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (props.rows.length === 0) return null;
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <button
        type="button"
        data-slot="builtin-toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
        className="-mx-2 flex min-h-9 items-center gap-2 rounded-lg px-2 text-start outline-none hover:bg-neutral-hover focus-visible:focus-ring"
      >
        <ChevronRight
          aria-hidden
          className={`size-3.5 flex-none text-text-tertiary transition-transform duration-quick ${open ? "rotate-90" : ""}`}
        />
        <span id={id} className="text-ui font-medium text-text-primary">
          {t("desktop.addons.builtin.title")}
        </span>
        <span className="text-ui text-text-tertiary">{props.rows.length}</span>
        <span className="min-w-0 truncate text-ui text-text-tertiary">
          {t("desktop.addons.builtin.body")}
        </span>
      </button>
      {open ? props.children : null}
    </section>
  );
}

const EMPTY_KINDS: readonly {
  readonly icon: ReactNode;
  readonly title: MessageId;
  readonly body: MessageId;
}[] = [
  {
    icon: <Monitor aria-hidden className={ICON} />,
    title: "desktop.addons.kind.page.title",
    body: "desktop.addons.kind.page.body",
  },
  {
    icon: <MessageSquare aria-hidden className={ICON} />,
    title: "desktop.addons.kind.card.title",
    body: "desktop.addons.kind.card.body",
  },
  {
    icon: <Command aria-hidden className={ICON} />,
    title: "desktop.addons.kind.command.title",
    body: "desktop.addons.kind.command.body",
  },
];

/** 빈 상태: 이곳이 무엇인지, 무엇이 모이는지, 어디서 더하는지. 화면 가운데가 아니라 목록 자리에서 시작한다 */
function AddonEmpty(props: { readonly moves: AddonMoves }): ReactNode {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid max-w-150 gap-6">
      <div className="grid gap-1">
        <h2 id={id} className="m-0 text-title-2 text-text-primary">
          {t("desktop.addons.empty.title")}
        </h2>
        <p className="m-0 text-ui text-text-secondary">{t("desktop.addons.empty.body")}</p>
      </div>
      <ul aria-label={t("desktop.addons.empty.kinds")} className={CARD}>
        {EMPTY_KINDS.map((kind) => (
          <li key={kind.title} className={ROW}>
            {kind.icon}
            <span className="grid min-w-0 flex-1">
              <span className="text-ui font-medium text-text-primary">{t(kind.title)}</span>
              <span className="text-ui text-text-tertiary">{t(kind.body)}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={props.moves.findPlugins}>
          {t("desktop.addons.find")}
        </Button>
        <Button size="sm" variant="ghost" onClick={props.moves.buildPlugin}>
          {t("desktop.addons.build")}
        </Button>
      </div>
    </section>
  );
}

function ListSkeleton(): ReactNode {
  return (
    <div aria-hidden className="grid grid-cols-[repeat(auto-fill,minmax(17.5rem,1fr))] gap-3">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="grid min-h-33 content-start gap-3 rounded-xl p-4 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
        >
          <div className="flex items-center gap-3">
            <Skeleton width={36} height={36} />
            <div className="grid flex-1 gap-1.5">
              <Skeleton width="50%" height={12} />
              <Skeleton width="30%" height={10} />
            </div>
          </div>
          <Skeleton width="85%" height={12} />
        </div>
      ))}
    </div>
  );
}

function AddonList(props: {
  readonly rows: readonly AddonRow[];
  readonly phase: "loading" | "ready" | "offline";
  readonly moves: AddonMoves;
  readonly pinned: (name: string) => boolean;
  readonly onOpen: (name: string) => void;
}): ReactNode {
  if (props.phase === "offline") {
    return <p className="m-0 text-ui text-text-tertiary">{t("desktop.plugin.state.offline")}</p>;
  }
  if (props.phase === "loading") return <ListSkeleton />;
  // 화면이 있는 플러그인만 보인다. 관리(켜고 끔, 설정, 권한)는 크래프트 상세가 맡는다(AGE-76 plugMin)
  const { added, builtin } = splitBuiltin(props.rows.filter((row) => row.screens > 0));
  if (added.length === 0 && builtin.length === 0) return <AddonEmpty moves={props.moves} />;
  const grid = (rows: readonly AddonRow[], label: string): ReactNode => (
    <CardGrid rows={rows} label={label} pinned={props.pinned} onOpen={props.onOpen} />
  );
  return (
    <div className="grid gap-8">
      <div className="grid gap-4">
        <p className="m-0 text-ui text-text-tertiary">{t("desktop.addons.intro")}</p>
        {added.length === 0 ? (
          <AddonEmpty moves={props.moves} />
        ) : (
          grid(added, t("desktop.shell.nav.plugins"))
        )}
      </div>
      <BuiltinGroup rows={builtin}>{grid(builtin, t("desktop.addons.builtin.title"))}</BuiltinGroup>
    </div>
  );
}

// ---- 상세 ----

/** 상세의 동작. 화면(`AddonsScreen`)이 셸로 채운다. 시험은 빈 함수로 채운다 */
export interface DetailOps {
  /** 머리 줄 탭 고정. 화면이 없으면 undefined */
  readonly pin:
    | { readonly pinned: boolean; readonly onChange: (pinned: boolean) => void }
    | undefined;
  readonly onOpenScreen: (screen: AddonScreen) => void;
  /** 막힌 플러그인 앱 화면: 설정 > 플러그인 > 앱 화면 허용으로 */
  readonly onAllowApps: () => void;
}

function DetailHead(props: { readonly detail: AddonDetail; readonly ops: DetailOps }): ReactNode {
  const { detail, ops } = props;
  const { row, primary } = detail;
  const { pin } = ops;
  return (
    <div className="flex items-start gap-4">
      <PluginGlyph icon={row.icon} monogram={row.monogram} size="head" off={row.off} />
      <div className="grid min-w-0 flex-1 gap-1">
        <h2 className="m-0 truncate text-[20px]/7 font-semibold text-text-primary">{row.title}</h2>
        {detail.description === undefined ? null : (
          <p className="m-0 line-clamp-3 whitespace-pre-line text-ui text-text-secondary">
            {detail.description}
          </p>
        )}
        <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 text-ui-sm font-normal text-text-tertiary">
          <span className="font-mono">{row.name}</span>
          {row.version === "" ? null : (
            <>
              {" "}
              <span>{`v${row.version}`}</span>
            </>
          )}{" "}
          <span>{t(ORIGIN_TEXT[row.trust])}</span>
        </p>
      </div>
      <div className="flex min-h-7 flex-none items-center gap-2 pt-1">
        {pin === undefined ? null : (
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={pin.pinned}
            iconStart={<PinIcon aria-hidden />}
            onClick={() => {
              pin.onChange(!pin.pinned);
            }}
          >
            {t(pin.pinned ? "desktop.addons.detail.pinned" : "desktop.addons.detail.pin")}
          </Button>
        )}
        {primary === undefined ? null : (
          <Button
            size="sm"
            variant="solid"
            onClick={() => {
              ops.onOpenScreen(primary);
            }}
          >
            {t("desktop.addons.detail.open")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function AddonDetailView(props: {
  readonly detail: AddonDetail;
  readonly ops: DetailOps;
}): ReactNode {
  const { detail, ops } = props;
  const { row } = detail;
  return (
    <div className="grid gap-8">
      <div className="grid gap-4">
        <DetailHead detail={detail} ops={ops} />
        <ProblemsNotice problems={detail.problems} onAllowApps={ops.onAllowApps} />
      </div>
      {detail.screens.length === 0 ? null : (
        <Section title={t("desktop.addons.section.screens")} count={detail.screens.length}>
          <ul aria-label={t("desktop.addons.section.screens")} className={CARD}>
            {detail.screens.map((screen) => (
              <ScreenRow
                key={screen.key}
                screen={screen}
                pluginOff={row.off}
                ops={{ ...ops, onRunCommand: () => undefined }}
              />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

// ---- 화면 ----

function routeOfTarget(target: AddonRequestTarget): AddonRoute {
  return target.kind === "screen"
    ? { kind: "screen", key: target.key }
    : { kind: "plugin", name: target.name };
}

/**
 * 지금 자리. 화면이 새로 열리면 목록부터 보이고, 아직 따르지 않은 요청(탭 메뉴의 "플러그인 정보", 크래프트의 "플레이그라운드에서 보기")이
 * 있으면 그 자리다. 열려 있는 동안 새 요청이 오면 그 자리로 간다
 */
function useAddonRoute(): readonly [AddonRoute, (route: AddonRoute) => void] {
  const request = useAddonRequest();
  const [route, setRoute] = useState<AddonRoute>(() => {
    const pending = pendingAddonRequest();
    return pending === undefined ? ADDON_LIST : routeOfTarget(pending.target);
  });
  const [seen, setSeen] = useState(request?.seq);
  if (request !== undefined && request.seq !== seen) {
    setSeen(request.seq);
    setRoute(routeOfTarget(request.target));
  }
  useEffect(() => {
    if (request !== undefined) markAddonRequest(request);
  }, [request]);
  return [route, setRoute];
}

/** 대화 영역 "플레이그라운드" 화면 */
export function AddonsScreen(): ReactNode {
  const commands = useCommands();
  const moves = useAddonMoves();
  const data = useAddonData(true);
  const [asked, setRoute] = useAddonRoute();
  const tabs = usePlaygroundTabs();
  const headingId = useId();
  const route =
    data.phase === "ready" ? addonRouteOf(asked, data.source.entries, data.listed) : ADDON_LIST;
  const pinned = (name: string): boolean => tabs.prefs !== undefined && isPinned(tabs.prefs, name);

  if (route.kind === "screen") {
    const entry = data.source.entries.find((item) => `${item.extension}/${item.id}` === route.key);
    if (entry !== undefined) {
      const name = data.meta.get(entry.extension)?.displayName ?? entry.extension;
      return (
        <PluginView
          key={`${route.key}@${entry.version}`}
          entry={entry}
          back={{
            plugin: name,
            onBack: () => {
              setRoute({ kind: "plugin", name: entry.extension });
            },
          }}
        />
      );
    }
  }

  const detail =
    route.kind === "plugin"
      ? addonDetailOf(route.name, data.source, data.meta, data.locale)
      : undefined;
  const title = detail === undefined ? t("desktop.shell.nav.plugins") : detail.row.title;
  const ops: DetailOps | undefined =
    detail === undefined
      ? undefined
      : {
          pin:
            detail.screens.length === 0
              ? undefined
              : {
                  pinned: pinned(detail.row.name),
                  onChange: (next) => {
                    tabs.actions.pin(detail.row.name, next);
                  },
                },
          onOpenScreen: (screen) => {
            // 화면은 머리 줄 탭 화면에서 연다(상태가 남는다). 고정하지 않은 플러그인도 탭 화면에서 연다
            tabs.actions.open(detail.row.name, screen.key);
          },
          onAllowApps: () => {
            commands.requestSettingsJump({ tab: "plugins", key: "x.ui.apps" });
            commands.showScreen("settings");
          },
        };
  return (
    <section aria-labelledby={headingId} className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        title={title}
        titleId={headingId}
        lead={
          detail === undefined ? undefined : (
            <IconButton
              size={HEADER_CONTROL_SIZE}
              variant="ghost"
              label={t("desktop.addons.detail.back")}
              className="-ms-1.5 flex-none"
              onClick={() => {
                setRoute(ADDON_LIST);
              }}
            >
              <ChevronLeft />
            </IconButton>
          )
        }
        action={
          detail === undefined ? (
            <Button
              size={HEADER_CONTROL_SIZE}
              variant={HEADER_PRIMARY_VARIANT}
              onClick={moves.findPlugins}
            >
              {t("desktop.addons.find")}
            </Button>
          ) : (
            // 관리는 크래프트 상세 "화면과 설정"으로 보낸다(켜고 끔, 기능, 설정, 권한, 지우기)
            <Button
              size={HEADER_CONTROL_SIZE}
              variant="ghost"
              iconEnd={<ChevronRight aria-hidden />}
              onClick={() => {
                moves.manage(detail.row.name);
              }}
            >
              {t("desktop.addons.manage")}
            </Button>
          )
        }
      />
      {/* 목록 ↔ 상세는 fade-through로 바뀐다(DP-106). 안쪽 열은 key로 새로 그려 스크롤이 처음으로 돌아간다 */}
      <ScreenSwap
        swapKey={detail === undefined ? "list" : `plugin:${detail.row.name}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          key={detail === undefined ? "list" : `plugin:${detail.row.name}`}
          className={`${SCROLL} @container/addon`}
        >
          <div className={COLUMN}>
            {detail === undefined || ops === undefined ? (
              <AddonList
                rows={addonRowsOf(data.source, data.meta, data.locale)}
                phase={data.phase}
                moves={moves}
                pinned={pinned}
                onOpen={(name) => {
                  setRoute({ kind: "plugin", name });
                }}
              />
            ) : (
              <AddonDetailView detail={detail} ops={ops} />
            )}
          </div>
        </div>
      </ScreenSwap>
    </section>
  );
}

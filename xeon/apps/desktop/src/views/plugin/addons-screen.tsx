import { t } from "@fresnel/client/i18n";
import { Button, IconButton, Skeleton } from "@caustic/react";
import { ChevronLeft, ChevronRight } from "@caustic/react/icons";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useCommands } from "../commands.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { DEFAULT_PROFILE_ID } from "../convo/profile-chip-model.ts";
import { useProfiles, type ProfilesRead } from "../convo/profile-listing.ts";
import { useOpenThread } from "../../state/engine/index.ts";
import { HEADER_CONTROL_SIZE, ScreenHeader } from "../shell/screen-header.tsx";
import { useAddonData } from "./addon-data.ts";
import {
  ADDON_LIST,
  addonDetailOf,
  addonRouteOf,
  addonRowsOf,
  appGroupsOf,
  type AddonDetail,
  type AddonRoute,
  type AddonRow,
  type AddonScreen,
} from "./addon-model.ts";
import { CARD, ProblemsNotice, ScreenRow, Section } from "./addon-parts.tsx";
import { AppAdditionsButton } from "./app-additions.tsx";
import { type AppMoves, useAppMoves } from "./app-moves.ts";
import { AppTile, CreateAppTile, ORIGIN_TEXT } from "./plugin-card.tsx";
import { PinIcon, PluginGlyph } from "./plugin-glyph.tsx";
import {
  markAddonRequest,
  pendingAddonRequest,
  useAddonRequest,
  type AddonRequestTarget,
} from "./plugin-pick.ts";
import { usePlaygroundTabs } from "./playground-tab-strip.tsx";
import { isPinned } from "./playground-tabs.ts";
import { ScreenSwap } from "../../lib/motion-presets.tsx";

// 대화 영역 "플레이그라운드" 화면(화면 id `plugins`, AGE-78)은 앱의 홈이다. 플러그인 하나가 앱 타일 하나인 격자가 놓인다.
// 지금 대화의 프로필에 든 앱이 먼저 오고, 그 밖의 앱은 접힌 묶음이다. 타일을 누르면 앱 작업 공간(머리 줄 탭 화면)으로 간다.
// 막힌 앱이나 고장 난 앱은 상세가 이유와 허용 단추를 보인다. 상세의 "관리"는 크래프트 상세가 맡는다.
// 모델은 `addon-model.ts`(순수), 이동은 `app-moves.ts`다.

/** 가운데 열: 960px, 오른쪽 막대만큼 비켜 둔다(설정 화면과 같은 식) */
const SCROLL =
  "min-h-0 flex-1 overflow-y-auto ps-6 pe-[calc(var(--shell-rail,0px)+var(--cs-space-6))] pb-12";
const COLUMN = "mx-auto grid w-full max-w-240 content-start";
/** 앱 격자: 타일이 최소 12rem이고 남는 자리를 채운다 */
const GRID = "m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3 p-0";

// ---- 목록(홈) ----

/** 타일 격자가 쓰는 동작. 화면이 셸과 탭으로 채운다 */
interface TileOps {
  readonly pinned: (name: string) => boolean;
  readonly onOpen: (name: string) => void;
  readonly onPin: (name: string, pinned: boolean) => void;
  readonly moves: AppMoves;
}

/** 타일 격자. `create`가 참이면 끝에 만들기 타일을 둔다 */
function AppTiles(props: {
  readonly label: string;
  readonly rows: readonly AddonRow[];
  readonly ops: TileOps;
  readonly create?: boolean;
}): ReactNode {
  const { ops } = props;
  return (
    <ul aria-label={props.label} className={GRID}>
      {props.rows.map((row) => (
        <AppTile
          key={row.name}
          row={row}
          pinned={ops.pinned(row.name)}
          onOpen={() => {
            ops.onOpen(row.name);
          }}
          onPin={(next) => {
            ops.onPin(row.name, next);
          }}
          onFix={() => {
            ops.moves.fix(row.name);
          }}
          onManage={() => {
            ops.moves.manage(row.name);
          }}
        />
      ))}
      {props.create === true ? <CreateAppTile onCreate={ops.moves.create} /> : null}
    </ul>
  );
}

/** 이 프로필에 없는 앱: 접힌 머리 한 줄(누르면 펼침, 처음엔 접힘). 펼치면 같은 격자지만 만들기 타일은 없다 */
export function OthersGroup(props: {
  readonly count: number;
  readonly children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="flex min-h-9 items-center gap-1">
        <button
          type="button"
          data-slot="others-toggle"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
          className="-mx-2 flex min-h-9 min-w-0 items-center gap-2 rounded-lg px-2 text-start outline-none hover:bg-neutral-hover focus-visible:focus-ring"
        >
          <ChevronRight
            aria-hidden
            className={`size-3.5 flex-none text-text-tertiary transition-transform duration-quick ${open ? "rotate-90" : ""}`}
          />
          <span id={id} className="text-ui font-medium text-text-primary">
            {t("desktop.apps.others.title")}
          </span>
          <span className="text-ui text-text-tertiary">{props.count}</span>
        </button>
        <InfoTip text={t("desktop.apps.others.info")} />
      </div>
      {open ? props.children : null}
    </section>
  );
}

/** 빈 상태: 앱이 하나도 없다. 무엇이 모이는지 보이고 "앱 만들기" 단추 하나를 둔다 */
function AppEmpty(props: { readonly moves: AppMoves }): ReactNode {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid max-w-150 gap-6">
      <div className="grid gap-1">
        <h2 id={id} className="m-0 text-title-2 text-text-primary">
          {t("desktop.addons.empty.title")}
        </h2>
        <p className="m-0 text-ui text-text-secondary">{t("desktop.addons.empty.body")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={props.moves.create}>
          {t("desktop.apps.create.title")}
        </Button>
      </div>
    </section>
  );
}

function ListSkeleton(): ReactNode {
  return (
    <div aria-hidden className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="grid min-h-33 content-start gap-3 rounded-xl p-4 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
        >
          <Skeleton width={36} height={36} />
          <Skeleton width="50%" height={12} />
          <Skeleton width="85%" height={12} />
        </div>
      ))}
    </div>
  );
}

/** 지금 대화의 프로필(열린 대화가 없으면 기본 프로필)에 든 플러그인 이름. 프로필을 못 읽었으면 undefined */
function profileNamesOf(
  profiles: ProfilesRead,
  profileId: string | undefined,
): ReadonlySet<string> | undefined {
  if (profiles.kind !== "ready" || profileId === undefined) return undefined;
  const profile = profiles.profiles.find((item) => item.id === profileId);
  return profile === undefined ? undefined : new Set(profile.plugins.map((plugin) => plugin.name));
}

function AppHome(props: {
  readonly rows: readonly AddonRow[];
  readonly phase: "loading" | "ready" | "offline";
  readonly inProfile: ReadonlySet<string> | undefined;
  readonly ops: TileOps;
}): ReactNode {
  if (props.phase === "offline") {
    return <p className="m-0 text-ui text-text-tertiary">{t("desktop.plugin.state.offline")}</p>;
  }
  if (props.phase === "loading") return <ListSkeleton />;
  // 화면이 있는 플러그인만 앱이다. 관리(켜고 끔, 설정, 권한)는 크래프트 상세가 맡는다(AGE-76 plugMin)
  const { main, others } = appGroupsOf(props.rows, props.inProfile);
  if (main.length === 0 && others.length === 0) return <AppEmpty moves={props.ops.moves} />;
  return (
    <div className="grid gap-8">
      <AppTiles label={t("desktop.apps.label")} rows={main} ops={props.ops} create />
      {others.length === 0 ? null : (
        <OthersGroup count={others.length}>
          <AppTiles label={t("desktop.apps.others.title")} rows={others} ops={props.ops} />
        </OthersGroup>
      )}
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

// ---- 자리 ----

/** 화면 요청은 자리를 목록으로 둔다(화면은 앱 작업 공간에서 연다). 플러그인 요청은 그 상세다 */
function routeOfTarget(target: AddonRequestTarget): AddonRoute {
  return target.kind === "screen" ? ADDON_LIST : { kind: "plugin", name: target.name };
}

/**
 * 지금 자리. 화면이 새로 열리면 목록부터 보이고, 아직 따르지 않은 요청(탭 메뉴의 "플러그인 정보", 크래프트의 "플레이그라운드에서 보기")이
 * 있으면 그 자리다. 열려 있는 동안 새 요청이 오면 그 자리로 간다. 화면 요청은 앱 작업 공간을 연다
 */
function useAddonRoute(
  open: (name: string, screenKey?: string) => void,
): readonly [AddonRoute, (route: AddonRoute) => void] {
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
    // 따르지 않은 요청만 한 번 따른다(효과가 다시 돌아도 같은 화면을 두 번 열지 않는다)
    if (request === undefined) return;
    const pending = pendingAddonRequest();
    if (pending === undefined) return;
    markAddonRequest(pending);
    if (pending.target.kind === "screen") {
      open(pending.target.key.split("/")[0] ?? "", pending.target.key);
    }
  }, [request, open]);
  return [route, setRoute];
}

/** 대화 영역 "플레이그라운드" 화면: 앱 홈 */
export function AddonsScreen(): ReactNode {
  const commands = useCommands();
  const moves = useAppMoves();
  const data = useAddonData(true);
  const thread = useOpenThread();
  const profiles = useProfiles();
  const [asked, setRoute] = useAddonRoute(moves.open);
  const tabs = usePlaygroundTabs();
  const headingId = useId();
  const route =
    data.phase === "ready" ? addonRouteOf(asked, data.source.entries, data.listed) : ADDON_LIST;
  const pinned = (name: string): boolean => tabs.prefs !== undefined && isPinned(tabs.prefs, name);

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
  const tiles: TileOps = {
    pinned,
    onOpen: (name) => {
      // 화면 하나라도 열 수 있으면 앱 작업 공간으로, 모두 막혔거나 고장 났으면 상세가 이유를 보인다
      const shown = addonDetailOf(name, data.source, data.meta, data.locale);
      const openable =
        shown?.screens.some((screen) => screen.state === "ready" || screen.state === "off") ===
        true;
      if (openable) moves.open(name);
      else setRoute({ kind: "plugin", name });
    },
    onPin: (name, next) => {
      tabs.actions.pin(name, next);
    },
    moves,
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
            <AppAdditionsButton />
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
              <AppHome
                rows={addonRowsOf(data.source, data.meta, data.locale)}
                phase={data.phase}
                inProfile={profileNamesOf(profiles, thread?.profileId ?? DEFAULT_PROFILE_ID)}
                ops={tiles}
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

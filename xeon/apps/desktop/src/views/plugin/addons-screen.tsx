import { activeLocale, t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { BridgeCapability } from "@fresnel/contracts/extensions";
import type { ExtListEntry, ExtTrust } from "@fresnel/contracts/wire";
import { Alert, Badge, Button, Chip, IconButton, Skeleton, Switch, Tooltip } from "@caustic/react";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  CodeXml,
  Command,
  FolderOpen,
  KeyRound,
  Monitor,
  MessageSquare,
  PanelBottom,
  PanelRight,
  ShieldCheck,
  SlidersHorizontal,
} from "@caustic/react/icons";
import { useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ShellStoreContext, type ShellActions } from "../../state/shell/index.ts";
import { useLinkPhase } from "../../state/engine/index.ts";
import { WorkbenchStoreContext, type WorkbenchActions } from "../../state/workbench/index.ts";
import { useCommands } from "../commands.ts";
import {
  HEADER_CONTROL_SIZE,
  HEADER_PRIMARY_VARIANT,
  ScreenHeader,
} from "../shell/screen-header.tsx";
import {
  ADDON_LIST,
  addonDetailOf,
  addonMetaOf,
  addonRouteOf,
  addonRowsOf,
  type AddonDetail,
  type AddonFeature,
  type AddonFeatureKind,
  type AddonMetaMap,
  type AddonProblem,
  type AddonRoute,
  type AddonRow,
  type AddonScreen,
} from "./addon-model.ts";
import { usePluginUiState } from "./plugin-context.tsx";
import {
  markAddonRequest,
  pendingAddonRequest,
  useAddonRequest,
  type AddonRequestTarget,
} from "./plugin-pick.ts";
import { PluginView } from "./plugin-view.tsx";
import { useThreadSwitchOf } from "./thread-switches.tsx";

// 대화 영역 "플레이그라운드" 화면(화면 id `plugins`, ADR-0021 §3.11, desktop-ux DP-72~74).
// 세 자리: 목록(플러그인마다 한 행) → 상세(그 플러그인이 더한 화면, 대화에 더한 것, 권한, 정보) → 실행(화면 하나, `PluginView`).
// 모델은 `addon-model.ts`(순수), 치수 근거는 노트 `design/cyY-design.md`다.

/** 가운데 열: 800px, 오른쪽 막대만큼 비켜 둔다(설정 화면과 같은 식) */
const SCROLL = "min-h-0 flex-1 overflow-y-auto ps-6 pe-[calc(var(--shell-rail,0px)+1.5rem)] pb-12";
const COLUMN = "mx-auto grid w-full max-w-200 content-start";
/** 행 공통: 행 사이 선 하나, hover는 바탕만 바꾼다(떠오름·그림자 없음) */
const ROW_LINE = "border-b border-border-subtle last:border-b-0";
const ROW_BUTTON =
  "-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 text-start outline-none hover:bg-neutral-hover focus-visible:focus-ring disabled:cursor-default disabled:hover:bg-transparent";
const ICON = "size-4 flex-none text-text-tertiary";

// ---- 이동 ----

interface AddonMoves {
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
      go("overview");
      workbench?.requestBuilder(null);
    },
  };
}

function useAddonMoves(): AddonMoves {
  const shell = useContext(ShellStoreContext)?.actions;
  const workbench = useContext(WorkbenchStoreContext)?.actions;
  return useMemo(() => addonMovesOf(shell, workbench), [shell, workbench]);
}

// ---- 데이터 ----

/**
 * 목록과 상세에 쓸 `ext.list` 행과 `ext.get` 매니페스트. 연결이 살아 있으면 목록을 읽고 확장 목록 알림마다 다시 읽는다.
 * 매니페스트는 이름마다 한 번 읽는다(설명·만든 이는 판이 바뀔 때만 바뀌고, 판이 바뀌면 화면 항목이 다시 오며 이름은 같다)
 */
function useAddonMeta(names: readonly string[]): AddonMetaMap {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const [listed, setListed] = useState<readonly ExtListEntry[]>([]);
  const [manifests, setManifests] = useState<
    ReadonlyMap<string, Readonly<Record<string, unknown>>>
  >(new Map());
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!live) return undefined;
    let alive = true;
    const load = (): void => {
      detach(
        commands.workbench.list().then((result) => {
          if (alive && result.ok) setListed(result.value);
          return undefined;
        }),
        rethrow,
      );
    };
    load();
    const stop = commands.workbench.onChanged(load);
    return () => {
      alive = false;
      stop();
    };
  }, [commands, live]);
  const key = names.join("\n");
  useEffect(() => {
    if (!live) return;
    for (const name of key.split("\n")) {
      if (name === "" || asked.current.has(name)) continue;
      asked.current.add(name);
      detach(
        commands.workbench.get(name).then((result) => {
          if (result.ok) {
            setManifests((current) => new Map([...current, [name, result.value.manifest]]));
          }
          return undefined;
        }),
        rethrow,
      );
    }
  }, [commands, live, key]);
  return useMemo(
    () =>
      new Map(
        key
          .split("\n")
          .filter((name) => name !== "")
          .map((name) => [
            name,
            addonMetaOf(
              listed.find((entry) => entry.name === name),
              manifests.get(name),
            ),
          ]),
      ),
    [key, listed, manifests],
  );
}

// ---- 공용 부품 ----

/** 아이콘 대신 이름 첫 글자 표지. 색을 이름마다 바꾸지 않는다 */
function Monogram(props: { readonly text: string; readonly large?: boolean }): ReactNode {
  return (
    <span
      aria-hidden
      className={
        props.large === true
          ? "flex size-14 flex-none items-center justify-center rounded-xl border border-border-subtle bg-bg-inset text-title-1 font-medium text-text-secondary"
          : "flex size-10 flex-none items-center justify-center rounded-lg border border-border-subtle bg-bg-inset text-title-3 font-medium text-text-secondary"
      }
    >
      {props.text}
    </span>
  );
}

/** 구역 머리: 16/22 600 제목과 연한 개수(DP-62). 선이나 상자는 없다 */
function SectionTitle(props: {
  readonly id: string;
  readonly title: string;
  readonly count?: number;
}): ReactNode {
  return (
    <h2 id={props.id} className="m-0 flex items-baseline gap-2 text-title-2 text-text-primary">
      {props.title}
      {props.count === undefined ? null : (
        <span className="text-ui font-normal text-text-tertiary tabular-nums">{props.count}</span>
      )}
    </h2>
  );
}

function Section(props: {
  readonly title: string;
  readonly count?: number;
  readonly children: ReactNode;
}): ReactNode {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <SectionTitle
        id={id}
        title={props.title}
        {...(props.count === undefined ? {} : { count: props.count })}
      />
      {props.children}
    </section>
  );
}

/** 아이콘·이름·한 줄 설명·오른쪽 끝으로 된 48px 행(누르지 않는 행) */
function InfoRow(props: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly body?: string | undefined;
  readonly end?: ReactNode;
}): ReactNode {
  return (
    <li className={`${ROW_LINE} flex min-h-12 items-center gap-3 py-2`}>
      {props.icon}
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-ui-md text-text-primary">{props.title}</span>
        {props.body === undefined ? null : (
          <span className="text-ui text-text-tertiary">{props.body}</span>
        )}
      </span>
      {props.end}
    </li>
  );
}

function RowList(props: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <ul aria-label={props.label} className="m-0 grid list-none p-0">
      {props.children}
    </ul>
  );
}

// ---- 목록 ----

function countsOf(row: AddonRow): string {
  const parts: string[] = [];
  if (row.screens > 0) parts.push(t("desktop.addons.count.screens", { count: row.screens }));
  if (row.features > 0) parts.push(t("desktop.addons.count.features", { count: row.features }));
  return parts.join(" · ");
}

function AddonListRow(props: { readonly row: AddonRow; readonly onOpen: () => void }): ReactNode {
  const { row } = props;
  return (
    <li className={ROW_LINE}>
      <button
        type="button"
        data-slot="addon-row"
        className={`${ROW_BUTTON} h-16`}
        onClick={props.onOpen}
      >
        <Monogram text={row.monogram} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={`truncate text-ui-md ${row.off ? "text-text-secondary" : "text-text-primary"}`}
            >
              {row.title}
            </span>
            {row.off ? <Badge size="sm">{t("desktop.addons.badge.off")}</Badge> : null}
            {row.attention && !row.off ? (
              <Badge size="sm" className="bg-danger-soft text-danger-text">
                {t("desktop.addons.badge.attention")}
              </Badge>
            ) : null}
          </span>
          {row.summary === undefined ? null : (
            <span className="truncate text-ui text-text-tertiary">{row.summary}</span>
          )}
        </span>
        <span className="flex-none text-ui-sm font-normal text-text-tertiary tabular-nums">
          {countsOf(row)}
        </span>
        <ChevronRight aria-hidden className={ICON} />
      </button>
    </li>
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
    <section aria-labelledby={id} className="grid gap-6">
      <div className="grid gap-1">
        <h2 id={id} className="m-0 text-title-2 text-text-primary">
          {t("desktop.addons.empty.title")}
        </h2>
        <p className="m-0 max-w-140 text-ui text-text-secondary">
          {t("desktop.addons.empty.body")}
        </p>
      </div>
      <RowList label={t("desktop.addons.empty.kinds")}>
        {EMPTY_KINDS.map((kind) => (
          <InfoRow key={kind.title} icon={kind.icon} title={t(kind.title)} body={t(kind.body)} />
        ))}
      </RowList>
      <div className="flex flex-wrap gap-2">
        <Button size="md" variant="outline" onClick={props.moves.findPlugins}>
          {t("desktop.addons.find")}
        </Button>
        <Button size="md" variant="ghost" onClick={props.moves.buildPlugin}>
          {t("desktop.addons.build")}
        </Button>
      </div>
    </section>
  );
}

function ListSkeleton(): ReactNode {
  return (
    <div aria-hidden className="grid">
      {[0, 1, 2].map((index) => (
        <div key={index} className={`${ROW_LINE} flex h-16 items-center gap-3`}>
          <Skeleton width={40} height={40} />
          <div className="grid flex-1 gap-1.5">
            <Skeleton width="30%" height={12} />
            <Skeleton width="55%" height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

function AddonList(props: {
  readonly rows: readonly AddonRow[];
  readonly phase: "loading" | "ready" | "offline";
  readonly moves: AddonMoves;
  readonly onOpen: (name: string) => void;
}): ReactNode {
  if (props.phase === "offline") {
    return <p className="m-0 text-ui text-text-tertiary">{t("desktop.plugin.state.offline")}</p>;
  }
  if (props.phase === "loading") return <ListSkeleton />;
  if (props.rows.length === 0) return <AddonEmpty moves={props.moves} />;
  return (
    <div className="grid gap-4">
      <p className="m-0 text-ui text-text-tertiary">{t("desktop.addons.intro")}</p>
      <RowList label={t("desktop.shell.nav.plugins")}>
        {props.rows.map((row) => (
          <AddonListRow
            key={row.name}
            row={row}
            onOpen={() => {
              props.onOpen(row.name);
            }}
          />
        ))}
      </RowList>
    </div>
  );
}

// ---- 상세 ----

const TRUST_TITLE: Readonly<Record<ExtTrust, MessageId>> = {
  builtin: "desktop.addons.trust.builtin.title",
  managed: "desktop.addons.trust.managed.title",
  user: "desktop.addons.trust.user.title",
  project: "desktop.addons.trust.project.title",
};
const TRUST_BODY: Readonly<Record<ExtTrust, MessageId>> = {
  builtin: "desktop.addons.trust.builtin.body",
  managed: "desktop.addons.trust.managed.body",
  user: "desktop.addons.trust.user.body",
  project: "desktop.addons.trust.project.body",
};

const CAPABILITY: Readonly<
  Record<
    BridgeCapability,
    { readonly icon: ReactNode; readonly title: MessageId; readonly body: MessageId }
  >
> = {
  files: {
    icon: <FolderOpen aria-hidden className={ICON} />,
    title: "desktop.addons.cap.files.title",
    body: "desktop.addons.cap.files.body",
  },
  notify: {
    icon: <Bell aria-hidden className={ICON} />,
    title: "desktop.addons.cap.notify.title",
    body: "desktop.addons.cap.notify.body",
  },
  settingsWrite: {
    icon: <SlidersHorizontal aria-hidden className={ICON} />,
    title: "desktop.addons.cap.settingsWrite.title",
    body: "desktop.addons.cap.settingsWrite.body",
  },
  secrets: {
    icon: <KeyRound aria-hidden className={ICON} />,
    title: "desktop.addons.cap.secrets.title",
    body: "desktop.addons.cap.secrets.body",
  },
};

const FEATURE: Readonly<
  Record<AddonFeatureKind, { readonly icon: ReactNode; readonly label: MessageId }>
> = {
  panel: {
    icon: <PanelRight aria-hidden className={ICON} />,
    label: "desktop.addons.feature.panel",
  },
  card: {
    icon: <MessageSquare aria-hidden className={ICON} />,
    label: "desktop.addons.feature.card",
  },
  command: {
    icon: <Command aria-hidden className={ICON} />,
    label: "desktop.addons.feature.command",
  },
  status: {
    icon: <PanelBottom aria-hidden className={ICON} />,
    label: "desktop.addons.feature.status",
  },
  settings: {
    icon: <SlidersHorizontal aria-hidden className={ICON} />,
    label: "desktop.addons.feature.settings",
  },
};

function problemText(problem: AddonProblem): string {
  switch (problem.kind) {
    case "off":
      return t("desktop.addons.problem.off");
    case "safeMode":
      return t("desktop.addons.problem.safeMode");
    case "invalid":
      return t("desktop.addons.problem.invalid", { count: problem.count });
    case "blocked":
      return t("desktop.addons.problem.blocked", { count: problem.count });
    case "errors":
      return t("desktop.addons.problem.errors", { count: problem.count });
    default:
      return assertNever(problem, "problemText");
  }
}

function DetailHead(props: {
  readonly detail: AddonDetail;
  readonly onManage: () => void;
  readonly onOpen: (screen: AddonScreen) => void;
}): ReactNode {
  const { detail } = props;
  const { row, primary } = detail;
  return (
    <div className="flex items-start gap-4">
      <Monogram text={row.monogram} large />
      <div className="grid min-w-0 flex-1 gap-1">
        <h2 className="m-0 truncate text-[20px]/7 font-semibold text-text-primary">{row.title}</h2>
        {detail.description === undefined ? null : (
          <p className="m-0 line-clamp-3 whitespace-pre-line text-ui text-text-secondary">
            {detail.description}
          </p>
        )}
        <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 text-ui-sm font-normal text-text-tertiary">
          <span className="font-mono">{row.name}</span>
          <span aria-hidden>·</span>
          <span>v{row.version}</span>
          <span aria-hidden>·</span>
          <span>{t(TRUST_TITLE[row.trust])}</span>
        </p>
      </div>
      <div className="flex flex-none items-center gap-2">
        <Button size="md" variant="outline" onClick={props.onManage}>
          {t("desktop.addons.detail.manage")}
        </Button>
        {primary === undefined ? null : (
          <Button
            size="md"
            variant="solid"
            onClick={() => {
              props.onOpen(primary);
            }}
          >
            {t("desktop.addons.detail.open")}
          </Button>
        )}
      </div>
    </div>
  );
}

/** 화면 행 끝의 상태. 플러그인 전체가 꺼졌으면 머리 경고가 이미 말하므로 행마다 "꺼짐"을 되풀이하지 않는다 */
function screenStateText(screen: AddonScreen, pluginOff: boolean): ReactNode {
  switch (screen.state) {
    case "ready":
      return null;
    case "off":
      return pluginOff ? null : <Badge size="sm">{t("desktop.addons.badge.off")}</Badge>;
    case "invalid":
      return (
        <span className="text-ui-sm font-normal text-danger-text">
          {t("desktop.addons.screen.invalid")}
        </span>
      );
    case "blocked":
      return (
        <span className="text-ui-sm font-normal text-warning-text">
          {t("desktop.addons.screen.blocked")}
        </span>
      );
    default:
      return assertNever(screen.state, "screenStateText");
  }
}

/** 플러그인 앱 표지. 툴팁(위로 연다, DP-60)은 앱이 기본 UI로 그릴 수 없다고 선언한 이유다 */
function AppChip(props: { readonly reason: string | undefined }): ReactNode {
  const chip = (
    <Chip size="sm" tone="neutral" variant="soft" icon={<CodeXml aria-hidden />}>
      {t("desktop.workbench.uiMode.app")}
    </Chip>
  );
  if (props.reason === undefined || props.reason === "") return chip;
  return (
    <Tooltip side="top" content={props.reason}>
      <span className="inline-flex flex-none">{chip}</span>
    </Tooltip>
  );
}

function ScreenRow(props: {
  readonly screen: AddonScreen;
  readonly pluginOff: boolean;
  readonly onOpen: () => void;
}): ReactNode {
  const { screen } = props;
  const ready = screen.state === "ready";
  return (
    <li className={ROW_LINE}>
      <button
        type="button"
        data-slot="addon-row"
        className={`${ROW_BUTTON} min-h-14 py-2`}
        disabled={!ready}
        onClick={props.onOpen}
      >
        {screen.where === "panel" ? (
          <PanelRight aria-hidden className={ICON} />
        ) : (
          <Monitor aria-hidden className={ICON} />
        )}
        <span className="grid min-w-0 flex-1">
          <span
            className={`truncate text-ui-md ${ready ? "text-text-primary" : "text-text-secondary"}`}
          >
            {screen.title}
          </span>
          <span className="truncate text-ui text-text-tertiary">
            {screen.issue ??
              t(
                screen.where === "panel"
                  ? "desktop.addons.where.panel"
                  : "desktop.addons.where.page",
              )}
          </span>
        </span>
        {screen.app ? <AppChip reason={screen.reason} /> : null}
        {screenStateText(screen, props.pluginOff)}
        {ready ? (
          <ChevronRight aria-hidden className={ICON} />
        ) : (
          <span className="size-4 flex-none" />
        )}
      </button>
    </li>
  );
}

function ThreadRow(props: { readonly name: string }): ReactNode {
  const one = useThreadSwitchOf(props.name);
  const label = t("desktop.addons.thread.title");
  const note = one.note === undefined ? undefined : t(one.note);
  return (
    <InfoRow
      icon={<MessageSquare aria-hidden className={ICON} />}
      title={label}
      body={note ?? t("desktop.addons.thread.body")}
      end={
        <Switch
          size="sm"
          aria-label={label}
          checked={one.kind === "switch" ? one.on : true}
          disabled={one.kind !== "switch" || one.disabled}
          onCheckedChange={(target) => {
            if (one.kind === "switch") one.toggle(target);
          }}
        />
      }
    />
  );
}

function FeatureRow(props: {
  readonly feature: AddonFeature;
  readonly pluginOff: boolean;
}): ReactNode {
  const { feature } = props;
  const look = FEATURE[feature.kind];
  return (
    <InfoRow
      icon={look.icon}
      title={feature.title}
      body={t(look.label)}
      end={
        feature.off && !props.pluginOff ? (
          <Badge size="sm">{t("desktop.addons.badge.off")}</Badge>
        ) : undefined
      }
    />
  );
}

function AboutRows(props: { readonly detail: AddonDetail }): ReactNode {
  const { detail } = props;
  const rows: readonly (readonly [MessageId, string | undefined, boolean])[] = [
    ["desktop.addons.about.name", detail.row.name, true],
    ["desktop.addons.about.version", detail.row.version, false],
    ["desktop.addons.about.author", detail.author, false],
    ["desktop.addons.about.license", detail.license, false],
  ];
  return (
    <dl className="m-0 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2">
      {rows.map(([label, value, mono]) =>
        value === undefined || value === "" ? null : (
          <div key={label} className="contents">
            <dt className="text-ui text-text-tertiary">{t(label)}</dt>
            <dd className={`m-0 truncate text-ui text-text-primary ${mono ? "font-mono" : ""}`}>
              {value}
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}

export function AddonDetailView(props: {
  readonly detail: AddonDetail;
  readonly moves: AddonMoves;
  readonly onOpen: (screen: AddonScreen) => void;
}): ReactNode {
  const { detail, moves } = props;
  const { row } = detail;
  const manage = (): void => {
    moves.manage(row.name);
  };
  const warn = detail.problems.some(
    (problem) => problem.kind !== "errors" && problem.kind !== "blocked",
  );
  return (
    <div className="grid gap-10">
      <div className="grid gap-4">
        <DetailHead detail={detail} onManage={manage} onOpen={props.onOpen} />
        {detail.problems.length === 0 ? null : (
          <Alert
            variant="outline"
            tone={warn ? "warning" : "danger"}
            actions={[{ label: t("desktop.addons.detail.manage"), onClick: manage }]}
          >
            {detail.problems.map(problemText).join(" ")}
          </Alert>
        )}
      </div>
      {detail.screens.length === 0 ? null : (
        <Section title={t("desktop.addons.section.screens")} count={detail.screens.length}>
          <RowList label={t("desktop.addons.section.screens")}>
            {detail.screens.map((screen) => (
              <ScreenRow
                key={screen.key}
                screen={screen}
                pluginOff={row.off}
                onOpen={() => {
                  props.onOpen(screen);
                }}
              />
            ))}
          </RowList>
        </Section>
      )}
      <Section title={t("desktop.addons.section.conversation")}>
        <RowList label={t("desktop.addons.section.conversation")}>
          <ThreadRow name={row.name} />
          {detail.features.map((feature) => (
            <FeatureRow key={feature.key} feature={feature} pluginOff={row.off} />
          ))}
        </RowList>
      </Section>
      <Section title={t("desktop.addons.section.access")}>
        <RowList label={t("desktop.addons.section.access")}>
          <InfoRow
            icon={<ShieldCheck aria-hidden className={ICON} />}
            title={t(TRUST_TITLE[row.trust])}
            body={t(TRUST_BODY[row.trust])}
          />
          {detail.capabilities.map((name) => (
            <InfoRow
              key={name}
              icon={CAPABILITY[name].icon}
              title={t(CAPABILITY[name].title)}
              body={t(CAPABILITY[name].body)}
            />
          ))}
        </RowList>
        <p className="m-0 text-ui text-text-tertiary">
          {t(detail.hasApp ? "desktop.addons.access.confirm" : "desktop.addons.access.none")}
        </p>
      </Section>
      <Section title={t("desktop.addons.section.about")}>
        <AboutRows detail={detail} />
      </Section>
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
 * 지금 자리. 화면이 새로 열리면 목록부터 보이고, 아직 따르지 않은 요청(사이드바 화면, 크래프트의 "플레이그라운드에서 보기")이 있으면 그 자리다.
 * 열려 있는 동안 새 요청이 오면 그 자리로 간다
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
  const state = usePluginUiState();
  const moves = useAddonMoves();
  const locale = activeLocale();
  const [asked, setRoute] = useAddonRoute();
  const names = useMemo(
    () => [...new Set(state.entries.map((entry) => entry.extension))].toSorted(),
    [state.entries],
  );
  const meta = useAddonMeta(names);
  const source = useMemo(
    () => ({ entries: state.entries, inactive: state.inactive, settings: state.settings }),
    [state.entries, state.inactive, state.settings],
  );
  const route = state.phase === "ready" ? addonRouteOf(asked, state.entries) : ADDON_LIST;
  const headingId = useId();

  if (route.kind === "screen") {
    const entry = state.entries.find((item) => `${item.extension}/${item.id}` === route.key);
    if (entry !== undefined) {
      const plugin = meta.get(entry.extension)?.displayName ?? entry.extension;
      return (
        <PluginView
          key={`${route.key}@${entry.version}`}
          entry={entry}
          back={{
            plugin,
            onBack: () => {
              setRoute({ kind: "plugin", name: entry.extension });
            },
          }}
        />
      );
    }
  }

  const openScreen = (screen: AddonScreen): void => {
    setRoute({ kind: "screen", key: screen.key });
  };
  const detail =
    route.kind === "plugin" ? addonDetailOf(route.name, source, meta, locale) : undefined;
  const title = detail === undefined ? t("desktop.shell.nav.plugins") : detail.row.title;
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
              {t("desktop.addons.manage")}
            </Button>
          ) : undefined
        }
      />
      <div key={detail === undefined ? "list" : `plugin:${detail.row.name}`} className={SCROLL}>
        <div className={COLUMN}>
          {detail === undefined ? (
            <AddonList
              rows={addonRowsOf(source, meta, locale)}
              phase={state.phase}
              moves={moves}
              onOpen={(name) => {
                setRoute({ kind: "plugin", name });
              }}
            />
          ) : (
            <AddonDetailView detail={detail} moves={moves} onOpen={openScreen} />
          )}
        </div>
      </div>
    </section>
  );
}

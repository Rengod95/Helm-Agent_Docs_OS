import { t, type MessageId } from "@fresnel/client/i18n";
import { rowOf as workbenchRowOf } from "@fresnel/client/workbench";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { BridgeCapability } from "@fresnel/contracts/extensions";
import type { ExtDiagnostic, ExtTrust } from "@fresnel/contracts/wire";
import {
  Alert,
  Badge,
  Button,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Skeleton,
  Switch,
  toast,
} from "@caustic/react";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  CircleX,
  CodeXml,
  Command,
  Copy,
  Ellipsis,
  FolderOpen,
  History,
  KeyRound,
  MessageSquare,
  Monitor,
  PanelBottom,
  PanelRight,
  RotateCw,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  PenTool,
  Trash2,
  TriangleAlert,
} from "@caustic/react/icons";
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ShellStoreContext, type ShellActions } from "../../state/shell/index.ts";
import {
  useWorkbench,
  WorkbenchStoreContext,
  type WorkbenchActions,
} from "../../state/workbench/index.ts";
import { useCommands, type DependencyRefusalView } from "../commands.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import {
  HEADER_CONTROL_SIZE,
  HEADER_PRIMARY_VARIANT,
  ScreenHeader,
} from "../shell/screen-header.tsx";
import { useToggleRequest } from "../workbench/craft-parts.tsx";
import { detachVoid, useWorkbenchController } from "../workbench/controller.ts";
import { ExportExtension } from "../workbench/export-extension.tsx";
import { RemoveDialog } from "../workbench/remove-dialog.tsx";
import { keepsDialogOpen, removableOf } from "../workbench/remove-model.ts";
import { forgetManifest, useAddonData } from "./addon-data.ts";
import {
  ADDON_LIST,
  addonDetailOf,
  addonRouteOf,
  addonRowsOf,
  splitBuiltin,
  type AddonDetail,
  type AddonFeature,
  type AddonFeatureKind,
  type AddonProblem,
  type AddonRisk,
  type AddonRoute,
  type AddonRow,
  type AddonScreen,
} from "./addon-model.ts";
import { usePluginCommandRunner } from "./command-run.ts";
import { reloadExtListing } from "./ext-listing.ts";
import { ORIGIN_TEXT, PluginCard } from "./plugin-card.tsx";
import { PluginConfigForm } from "./plugin-config-form.tsx";
import { usePluginUiState } from "./plugin-context.tsx";
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
import { useThreadSwitchOf } from "./thread-switches.tsx";
import { ScreenSwap } from "../../lib/motion-presets.tsx";

// 대화 영역 "플레이그라운드" 화면(화면 id `plugins`, ADR-0021 §3.11, desktop-ux DP-91·92 [결정: 2026-11-11 사용자]).
// 세 자리: 목록(카드 격자, 내장은 접힌 묶음) → 상세(머리 블록과 전역 스위치, 두 열: 화면·대화에서·설정·권한과 위험·진단 / 정보 열)
// → 실행(화면 하나, `PluginView`). 플레이그라운드는 쓰는 곳이다: 만들고 고치는 일(설치 검토, 훅 순서, 버전, 측정)은 크래프트로 보낸다.
// 모델은 `addon-model.ts`(순수), 치수 근거는 노트 `design/dz/dzP-design.md`다.

/** 가운데 열: 960px, 오른쪽 막대만큼 비켜 둔다(설정 화면과 같은 식) */
const SCROLL =
  "min-h-0 flex-1 overflow-y-auto ps-6 pe-[calc(var(--shell-rail,0px)+var(--cs-space-6))] pb-12";
const COLUMN = "mx-auto grid w-full max-w-240 content-start";
const ICON = "size-4 flex-none text-text-tertiary";
/** 줄 목록 카드(설정 카드와 같은 면·선·반경) */
const CARD =
  "m-0 grid list-none overflow-hidden rounded-xl bg-surface-base p-0 py-1 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)] [&>*+*]:border-t [&>*+*]:border-border-subtle";
/** 카드 안 줄: 좌우 16, 최소 48 */
const ROW = "flex min-h-12 min-w-0 items-center gap-3 px-4 py-2";

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

// ---- 공용 부품 ----

/** 구역: 16/22 600 제목(+ 연한 개수), 제목과 내용 8 */
function Section(props: {
  readonly title: string;
  readonly count?: number | undefined;
  readonly end?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <div className="flex min-h-7 items-center gap-2">
        <h2 id={id} className="m-0 flex flex-1 items-baseline gap-2 text-title-2 text-text-primary">
          {props.title}
          {props.count === undefined ? null : (
            <span className="text-ui font-normal text-text-tertiary">{props.count}</span>
          )}
        </h2>
        {props.end}
      </div>
      {props.children}
    </section>
  );
}

// ---- 목록 ----

/** 켜짐 스위치 값: 워크벤치 목록의 행(요청 중이면 목표 값). 잠긴 확장(안전 모드, 면제 등급, 관리)은 바꿀 수 없다 */
interface ToggleInfo {
  readonly on: boolean;
  readonly locked: boolean;
  readonly busy: boolean;
}

type ToggleOf = (name: string) => ToggleInfo | undefined;

function CardGrid(props: {
  readonly rows: readonly AddonRow[];
  readonly label: string;
  readonly pinned: (name: string) => boolean;
  readonly toggleOf: ToggleOf;
  readonly onToggle: (name: string, target: boolean) => void;
  readonly onOpen: (name: string) => void;
}): ReactNode {
  return (
    <ul
      aria-label={props.label}
      className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(17.5rem,1fr))] gap-3 p-0"
    >
      {props.rows.map((row) => {
        const toggle = props.toggleOf(row.name);
        return (
          <PluginCard
            key={row.name}
            row={row}
            pinned={props.pinned(row.name)}
            toggle={
              toggle === undefined || toggle.locked
                ? undefined
                : {
                    on: toggle.on,
                    busy: toggle.busy,
                    onChange: (target) => {
                      props.onToggle(row.name, target);
                    },
                  }
            }
            onOpen={() => {
              props.onOpen(row.name);
            }}
          />
        );
      })}
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
  readonly toggleOf: ToggleOf;
  readonly onToggle: (name: string, target: boolean) => void;
  readonly onOpen: (name: string) => void;
}): ReactNode {
  if (props.phase === "offline") {
    return <p className="m-0 text-ui text-text-tertiary">{t("desktop.plugin.state.offline")}</p>;
  }
  if (props.phase === "loading") return <ListSkeleton />;
  const { added, builtin } = splitBuiltin(props.rows);
  if (added.length === 0 && builtin.length === 0) return <AddonEmpty moves={props.moves} />;
  const grid = (rows: readonly AddonRow[], label: string): ReactNode => (
    <CardGrid
      rows={rows}
      label={label}
      pinned={props.pinned}
      toggleOf={props.toggleOf}
      onToggle={props.onToggle}
      onOpen={props.onOpen}
    />
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
  Record<
    AddonFeatureKind,
    { readonly icon: ReactNode; readonly label: MessageId; readonly where: MessageId }
  >
> = {
  panel: {
    icon: <PanelRight aria-hidden className={ICON} />,
    label: "desktop.addons.feature.panel",
    where: "desktop.addons.where.panelFeature",
  },
  card: {
    icon: <MessageSquare aria-hidden className={ICON} />,
    label: "desktop.addons.feature.card",
    where: "desktop.addons.where.card",
  },
  command: {
    icon: <Command aria-hidden className={ICON} />,
    label: "desktop.addons.feature.command",
    where: "desktop.addons.where.command",
  },
  status: {
    icon: <PanelBottom aria-hidden className={ICON} />,
    label: "desktop.addons.feature.status",
    where: "desktop.addons.where.status",
  },
  settings: {
    icon: <SlidersHorizontal aria-hidden className={ICON} />,
    label: "desktop.addons.feature.settings",
    where: "desktop.addons.where.settings",
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
    default:
      return assertNever(problem, "problemText");
  }
}

/** 상세의 동작. 화면(`AddonsScreen`)이 컨트롤러와 셸로 채운다. 시험은 빈 함수로 채운다 */
export interface DetailOps {
  /** 전역 켜기·끄기. 잠겼거나 목록을 아직 못 읽었으면 undefined(스위치를 그리지 않는다) */
  readonly toggle: (ToggleInfo & { readonly onChange: (target: boolean) => void }) | undefined;
  /** 머리 줄 탭 고정. 화면이 없으면 undefined */
  readonly pin:
    | { readonly pinned: boolean; readonly onChange: (pinned: boolean) => void }
    | undefined;
  /** 끌까요 질문 답 */
  readonly onKeepOff: () => void;
  readonly onKeepOn: () => void;
  readonly onOpenScreen: (screen: AddonScreen) => void;
  /** 명령 기능 실행 */
  readonly onRunCommand: (feature: AddonFeature) => void;
  /** 막힌 플러그인 앱 화면: 설정 > 플러그인 > 앱 화면 허용으로 */
  readonly onAllowApps: () => void;
  readonly onCopy: (text: string) => void;
}

function DetailHead(props: { readonly detail: AddonDetail; readonly ops: DetailOps }): ReactNode {
  const { detail, ops } = props;
  const { row, primary } = detail;
  const { pin } = ops;
  const switchId = useId();
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
          {detail.isOrchestration ? (
            <>
              {" "}
              <span>{t("desktop.addons.detail.group")}</span>
            </>
          ) : null}
        </p>
      </div>
      <div className="flex min-h-7 flex-none items-center gap-2 pt-1">
        {ops.toggle === undefined ? null : (
          <span className="me-2 inline-flex items-center gap-2">
            <label htmlFor={switchId} className="text-ui text-text-secondary">
              {t(ops.toggle.on ? "desktop.addons.detail.on" : "desktop.addons.detail.off")}
            </label>
            <Switch
              id={switchId}
              size="sm"
              checked={ops.toggle.on}
              disabled={ops.toggle.busy}
              aria-label={t("desktop.addons.toggle", { name: row.title })}
              onCheckedChange={ops.toggle.onChange}
            />
          </span>
        )}
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

/** 머리 블록 아래의 띠: 끌까요 질문(답 단추), 꺼짐·안전 모드·열 수 없는 화면 */
function DetailNotices(props: {
  readonly detail: AddonDetail;
  readonly ops: DetailOps;
}): ReactNode {
  const { detail, ops } = props;
  const keepOff = detail.keepOff;
  const problems = detail.problems;
  return (
    <>
      {keepOff === undefined ? null : (
        <Alert
          variant="outline"
          tone="warning"
          actions={[
            { label: t("desktop.addons.keepOff.off"), onClick: ops.onKeepOff },
            { label: t("desktop.addons.keepOff.on"), onClick: ops.onKeepOn },
          ]}
        >
          {keepOff.rule === "consecutive"
            ? t("desktop.addons.keepOff.consecutive", { count: keepOff.consecutive })
            : t("desktop.addons.keepOff.rate", { count: keepOff.windowFailures })}
        </Alert>
      )}
      {problems.length === 0 ? null : (
        <Alert
          variant="outline"
          tone={problems.some((problem) => problem.kind === "invalid") ? "danger" : "neutral"}
          {...(problems.some((problem) => problem.kind === "blocked")
            ? { actions: [{ label: t("desktop.addons.allowApps"), onClick: ops.onAllowApps }] }
            : {})}
        >
          {problems.map(problemText).join(" ")}
        </Alert>
      )}
    </>
  );
}

/** 화면 줄 끝의 상태. 플러그인 전체가 꺼졌으면 머리 띠가 이미 말하므로 줄마다 "꺼짐"을 되풀이하지 않는다 */
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

function ScreenRow(props: {
  readonly screen: AddonScreen;
  readonly pluginOff: boolean;
  readonly ops: DetailOps;
}): ReactNode {
  const { screen, ops } = props;
  return (
    <li className={ROW}>
      {screen.where === "panel" ? (
        <PanelRight aria-hidden className={ICON} />
      ) : (
        <Monitor aria-hidden className={ICON} />
      )}
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-ui font-medium text-text-primary">{screen.title}</span>
        <span className="truncate text-ui text-text-tertiary">
          {screen.issue ??
            t(
              screen.where === "panel" ? "desktop.addons.where.panel" : "desktop.addons.where.page",
            )}
        </span>
      </span>
      {screen.app ? (
        <Chip size="sm" tone="neutral" variant="soft" icon={<CodeXml aria-hidden />}>
          {t("desktop.workbench.uiMode.app")}
        </Chip>
      ) : null}
      {screenStateText(screen, props.pluginOff)}
      {screen.state === "blocked" ? (
        <Button size="sm" variant="ghost" onClick={ops.onAllowApps}>
          {t("desktop.addons.allowApps")}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          disabled={screen.state !== "ready"}
          onClick={() => {
            ops.onOpenScreen(screen);
          }}
        >
          {t("desktop.addons.detail.open")}
        </Button>
      )}
    </li>
  );
}

function ThreadRow(props: { readonly name: string }): ReactNode {
  const one = useThreadSwitchOf(props.name);
  const label = t("desktop.addons.thread.title");
  const note = one.note === undefined ? undefined : t(one.note);
  return (
    <li className={ROW}>
      <MessageSquare aria-hidden className={ICON} />
      <span className="grid min-w-0 flex-1">
        <span className="text-ui font-medium text-text-primary">{label}</span>
        <span className="text-ui text-text-tertiary">
          {note ?? t("desktop.addons.thread.body")}
        </span>
      </span>
      {/* 읽기만 한다. 이 대화의 켜짐은 이 대화의 프로필이 정하므로 여기서 바꾸지 않는다 */}
      <Switch size="sm" aria-label={label} checked={one.kind === "state" && one.on} disabled />
    </li>
  );
}

function FeatureRow(props: {
  readonly feature: AddonFeature;
  readonly pluginOff: boolean;
  readonly ops: DetailOps;
}): ReactNode {
  const { feature, ops } = props;
  const look = FEATURE[feature.kind];
  return (
    <li className={ROW}>
      {look.icon}
      <span className="grid min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-ui font-medium text-text-primary">{feature.title}</span>
          <InfoTip text={t(look.where)} />
        </span>
        <span className="text-ui text-text-tertiary">{t(look.label)}</span>
      </span>
      {feature.off && !props.pluginOff ? (
        <Badge size="sm">{t("desktop.addons.badge.off")}</Badge>
      ) : null}
      {feature.kind === "command" ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={feature.off}
          iconStart={<Terminal aria-hidden />}
          onClick={() => {
            ops.onRunCommand(feature);
          }}
        >
          {t("desktop.addons.feature.run")}
        </Button>
      ) : null}
    </li>
  );
}

function riskLine(risk: AddonRisk): {
  readonly icon: ReactNode;
  readonly title: string;
  readonly body: string;
  readonly danger: boolean;
} {
  switch (risk.kind) {
    case "toolHooks":
      return {
        icon: <TriangleAlert aria-hidden className="size-4 flex-none text-warning-text" />,
        title: t("desktop.addons.risk.toolHooks.title"),
        body: t("desktop.addons.risk.toolHooks.body", { hooks: risk.hooks.join(", ") }),
        danger: true,
      };
    case "requestHooks":
      return {
        icon: <TriangleAlert aria-hidden className="size-4 flex-none text-warning-text" />,
        title: t("desktop.addons.risk.requestHooks.title"),
        body: t("desktop.addons.risk.requestHooks.body", { hooks: risk.hooks.join(", ") }),
        danger: true,
      };
    case "otherHooks":
      return {
        icon: <History aria-hidden className={ICON} />,
        title: t("desktop.addons.risk.otherHooks.title", { count: risk.count }),
        body: t("desktop.addons.risk.otherHooks.body"),
        danger: false,
      };
    case "methods":
      return {
        icon: <Command aria-hidden className={ICON} />,
        title:
          risk.writes > 0
            ? t("desktop.addons.risk.methods.write", { count: risk.writes })
            : t("desktop.addons.risk.methods.read", { count: risk.methods.length }),
        body: risk.methods
          .map((method) =>
            method.approval
              ? t("desktop.addons.risk.methods.approval", { verb: method.verb })
              : method.verb,
          )
          .join(", "),
        danger: false,
      };
    case "capability":
      return {
        icon: CAPABILITY[risk.capability].icon,
        title: t(CAPABILITY[risk.capability].title),
        body: t(CAPABILITY[risk.capability].body),
        danger: false,
      };
    default:
      return assertNever(risk, "riskLine");
  }
}

function RiskSection(props: { readonly detail: AddonDetail }): ReactNode {
  const { detail } = props;
  const { row } = detail;
  const grade =
    detail.requestedGrade !== undefined &&
    detail.effectiveGrade !== undefined &&
    detail.requestedGrade !== ""
      ? detail.requestedGrade === detail.effectiveGrade
        ? t("desktop.addons.grade.same", { grade: detail.effectiveGrade })
        : t("desktop.addons.grade.changed", {
            requested: detail.requestedGrade,
            effective: detail.effectiveGrade,
          })
      : undefined;
  const none = detail.risksKnown && detail.risks.length === 0;
  return (
    <Section title={t("desktop.addons.section.access")}>
      <ul aria-label={t("desktop.addons.section.access")} className={CARD}>
        {detail.risks.map((risk, index) => {
          const line = riskLine(risk);
          return (
            <li key={`${risk.kind}-${String(index)}`} className={ROW}>
              {line.icon}
              <span className="grid min-w-0 flex-1">
                <span className="text-ui font-medium text-text-primary">{line.title}</span>
                <span className="text-ui text-text-tertiary">{line.body}</span>
              </span>
            </li>
          );
        })}
        <li className={ROW}>
          <ShieldCheck aria-hidden className={ICON} />
          <span className="grid min-w-0 flex-1">
            <span className="text-ui font-medium text-text-primary">
              {t(ORIGIN_TEXT[row.trust])}
            </span>
            <span className="text-ui text-text-tertiary">
              {t(TRUST_BODY[row.trust])}
              {grade === undefined ? null : ` ${grade}`}
            </span>
          </span>
        </li>
      </ul>
      <p className="m-0 text-ui text-text-tertiary">
        {none
          ? t("desktop.addons.access.none")
          : detail.hasApp
            ? t("desktop.addons.access.confirm")
            : detail.risksKnown
              ? null
              : t("desktop.addons.access.unknown")}
      </p>
    </Section>
  );
}

function DiagnosticRow(props: { readonly item: ExtDiagnostic }): ReactNode {
  const { item } = props;
  const where =
    item.file === undefined
      ? undefined
      : item.line === undefined
        ? item.file
        : `${item.file}:${String(item.line)}`;
  return (
    <li className="flex min-w-0 items-start gap-3 px-4 py-3">
      {item.severity === "error" ? (
        <CircleX aria-hidden className="mt-0.5 size-4 flex-none text-danger-text" />
      ) : (
        <TriangleAlert aria-hidden className="mt-0.5 size-4 flex-none text-warning-text" />
      )}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-ui text-text-primary">
          <span className="sr-only">
            {t(
              item.severity === "error"
                ? "desktop.addons.diag.error"
                : "desktop.addons.diag.warning",
            )}
            {": "}
          </span>
          {item.message}
        </span>
        <span className="flex min-w-0 items-baseline gap-2 font-mono text-mono-sm text-text-tertiary">
          {where === undefined ? null : (
            <>
              <span className="min-w-0 truncate">{where}</span>{" "}
            </>
          )}
          <span className="min-w-0 truncate">{item.code}</span>
        </span>
      </span>
    </li>
  );
}

function AboutColumn(props: { readonly detail: AddonDetail; readonly ops: DetailOps }): ReactNode {
  const { detail, ops } = props;
  const rows: readonly (readonly [MessageId, ReactNode])[] = [
    [
      "desktop.addons.about.name",
      <span key="name" className="font-mono">
        {detail.row.name}
      </span>,
    ],
    ["desktop.addons.about.version", detail.row.version === "" ? undefined : detail.row.version],
    ["desktop.addons.about.author", detail.author],
    ["desktop.addons.about.license", detail.license],
    ["desktop.addons.about.origin", t(ORIGIN_TEXT[detail.row.trust])],
    [
      "desktop.addons.about.location",
      detail.location === undefined ? undefined : (
        <span key="location" className="flex min-w-0 items-start gap-1">
          <span className="min-w-0 font-mono text-mono-sm break-all">{detail.location}</span>
          <IconButton
            size="xs"
            variant="ghost"
            label={t("desktop.addons.about.copyLocation")}
            className="-mt-0.5 flex-none"
            onClick={() => {
              if (detail.location !== undefined) ops.onCopy(detail.location);
            }}
          >
            <Copy />
          </IconButton>
        </span>
      ),
    ],
    [
      "desktop.addons.about.links",
      detail.homepage === undefined && detail.repository === undefined ? undefined : (
        <span key="links" className="grid gap-1">
          {detail.homepage === undefined ? null : (
            <a
              href={detail.homepage}
              target="_blank"
              rel="noreferrer"
              className="w-fit text-accent-text underline-offset-2 hover:underline"
            >
              {t("desktop.addons.about.homepage")}
            </a>
          )}
          {detail.repository === undefined ? null : (
            <a
              href={detail.repository}
              target="_blank"
              rel="noreferrer"
              className="w-fit text-accent-text underline-offset-2 hover:underline"
            >
              {t("desktop.addons.about.repository")}
            </a>
          )}
        </span>
      ),
    ],
  ];
  return (
    <aside aria-label={t("desktop.addons.section.about")} className="grid content-start gap-3">
      <h2 className="m-0 text-ui font-medium text-text-primary">
        {t("desktop.addons.section.about")}
      </h2>
      <dl className="m-0 grid gap-3">
        {rows.map(([label, value]) =>
          value === undefined || value === null || value === "" ? null : (
            <div key={label} className="grid gap-0.5">
              <dt className="text-ui-sm font-normal text-text-tertiary">{t(label)}</dt>
              <dd className="m-0 min-w-0 text-ui text-text-primary">{value}</dd>
            </div>
          ),
        )}
      </dl>
    </aside>
  );
}

export function AddonDetailView(props: {
  readonly detail: AddonDetail;
  readonly ops: DetailOps;
  /** 플러그인 자체 설정 폼. 시험은 비운다 */
  readonly config?: ReactNode;
  /** 정보 열 아래 붙는 것(내보내기) */
  readonly aboutEnd?: ReactNode;
}): ReactNode {
  const { detail, ops } = props;
  const { row } = detail;
  const commands = detail.features.filter((feature) => feature.kind === "command");
  const others = detail.features.filter((feature) => feature.kind !== "command");
  return (
    <div className="grid gap-8">
      <div className="grid gap-4">
        <DetailHead detail={detail} ops={ops} />
        <DetailNotices detail={detail} ops={ops} />
      </div>
      <div className="grid gap-10 @[52rem]/addon:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="grid min-w-0 content-start gap-8">
          {detail.screens.length === 0 ? null : (
            <Section title={t("desktop.addons.section.screens")} count={detail.screens.length}>
              <ul aria-label={t("desktop.addons.section.screens")} className={CARD}>
                {detail.screens.map((screen) => (
                  <ScreenRow key={screen.key} screen={screen} pluginOff={row.off} ops={ops} />
                ))}
              </ul>
            </Section>
          )}
          <Section title={t("desktop.addons.section.conversation")}>
            <ul aria-label={t("desktop.addons.section.conversation")} className={CARD}>
              <ThreadRow name={row.name} />
              {[...commands, ...others].map((feature) => (
                <FeatureRow key={feature.key} feature={feature} pluginOff={row.off} ops={ops} />
              ))}
            </ul>
          </Section>
          {props.config}
          <RiskSection detail={detail} />
          {detail.diagnostics.length === 0 ? null : (
            <Section
              title={t("desktop.addons.section.diagnostics")}
              count={detail.diagnostics.length}
            >
              <ul aria-label={t("desktop.addons.section.diagnostics")} className={CARD}>
                {detail.diagnostics.map((item, index) => (
                  <DiagnosticRow key={`${item.code}-${String(index)}`} item={item} />
                ))}
              </ul>
            </Section>
          )}
        </div>
        <div className="grid content-start gap-4">
          <AboutColumn detail={detail} ops={ops} />
          {props.aboutEnd}
        </div>
      </div>
    </div>
  );
}

/** 상세 머리의 "⋯" 메뉴: 다시 읽기, 버전 되돌리기(크래프트), 크래프트에서 열기, 제거 */
function DetailMenu(props: {
  readonly title: string;
  readonly removable: boolean;
  readonly onReload: () => void;
  readonly onVersions: () => void;
  readonly onCraft: () => void;
  readonly onRemove: () => void;
}): ReactNode {
  return (
    <Menu
      size="sm"
      align="end"
      aria-label={t("desktop.addons.menu.label", { name: props.title })}
      trigger={
        <IconButton
          size={HEADER_CONTROL_SIZE}
          variant="ghost"
          label={t("desktop.addons.menu.label", { name: props.title })}
        >
          <Ellipsis />
        </IconButton>
      }
    >
      <MenuItem icon={<RotateCw />} onSelect={props.onReload}>
        {t("desktop.addons.menu.reload")}
      </MenuItem>
      <MenuItem icon={<History />} onSelect={props.onVersions}>
        {t("desktop.addons.menu.versions")}
      </MenuItem>
      <MenuItem icon={<PenTool />} onSelect={props.onCraft}>
        {t("desktop.addons.menu.craft")}
      </MenuItem>
      {props.removable ? (
        <>
          <MenuSeparator />
          <MenuItem icon={<Trash2 />} tone="danger" onSelect={props.onRemove}>
            {t("desktop.addons.menu.remove")}
          </MenuItem>
        </>
      ) : null}
    </Menu>
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
  const plugin = usePluginUiState();
  const moves = useAddonMoves();
  const data = useAddonData(true);
  const [asked, setRoute] = useAddonRoute();
  const controller = useWorkbenchController();
  const toggleRequest = useToggleRequest(controller);
  const workbench = useWorkbench((s) => s);
  const tabs = usePlaygroundTabs();
  const runCommand = usePluginCommandRunner();
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeDataFailed, setRemoveDataFailed] = useState(false);
  const [removeRefusal, setRemoveRefusal] = useState<DependencyRefusalView | null>(null);
  const headingId = useId();
  const loadPreview = useCallback(
    (name: string) => commands.workbench.removePreview(name),
    [commands],
  );
  const loadProfiles = useCallback(() => commands.workbench.profiles(), [commands]);
  // 켜기·끄기 확인은 워크벤치 목록을 읽어야 한다. 아직 안 읽었으면 한 번 읽는다
  const listState = workbench.list;
  useEffect(() => {
    if (listState === "idle") detachVoid(controller.reload());
  }, [listState, controller]);
  const route =
    data.phase === "ready" ? addonRouteOf(asked, data.source.entries, data.listed) : ADDON_LIST;

  const toggleOf = useCallback(
    (name: string): ToggleInfo | undefined => {
      const entry = workbench.entries.find((item) => item.name === name);
      if (entry === undefined) return undefined;
      const row = workbenchRowOf(entry, workbench.pending);
      return { on: row.on, locked: row.lock !== null, busy: workbench.pending[name] !== undefined };
    },
    [workbench.entries, workbench.pending],
  );
  const onToggle = (name: string, target: boolean): void => {
    toggleRequest.request(name, target);
  };
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
  const listEntry =
    detail === undefined
      ? undefined
      : workbench.entries.find((item) => item.name === detail.row.name);
  const ops: DetailOps | undefined =
    detail === undefined
      ? undefined
      : {
          toggle: (() => {
            const info = toggleOf(detail.row.name);
            return info === undefined || info.locked
              ? undefined
              : {
                  ...info,
                  onChange: (target: boolean) => {
                    onToggle(detail.row.name, target);
                  },
                };
          })(),
          pin:
            detail.screens.length === 0
              ? undefined
              : {
                  pinned: pinned(detail.row.name),
                  onChange: (next) => {
                    tabs.actions.pin(detail.row.name, next);
                  },
                },
          onKeepOff: () => {
            detachVoid(controller.keepOff(detail.row.name));
          },
          onKeepOn: () => {
            detachVoid(controller.reenable(detail.row.name));
          },
          onOpenScreen: (screen) => {
            // 화면은 머리 줄 탭 화면에서 연다(상태가 남는다). 고정하지 않은 플러그인도 탭 화면에서 연다
            tabs.actions.open(detail.row.name, screen.key);
          },
          onRunCommand: (feature) => {
            runCommand(detail.row.name, feature.id);
          },
          onAllowApps: () => {
            commands.requestSettingsJump({ tab: "plugins", key: "x.ui.apps" });
            commands.showScreen("settings");
          },
          onCopy: (text) => {
            detach(
              commands.copyText(text).then((done) => {
                if (done) toast({ tone: "success", title: t("desktop.addons.about.copied") });
                return undefined;
              }),
              rethrow,
            );
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
            <DetailMenu
              title={detail.row.title}
              removable={listEntry !== undefined && removableOf(listEntry)}
              onReload={() => {
                detach(
                  commands.workbench.reload(detail.row.name).then((done) => {
                    toast(
                      done.ok
                        ? { tone: "success", title: t("desktop.addons.menu.reloaded") }
                        : { tone: "danger", title: t("desktop.addons.menu.reloadFailed") },
                    );
                    forgetManifest(commands, detail.row.name);
                    reloadExtListing(commands);
                    return undefined;
                  }),
                  rethrow,
                );
              }}
              onVersions={() => {
                moves.manage(detail.row.name);
              }}
              onCraft={() => {
                moves.manage(detail.row.name);
              }}
              onRemove={() => {
                setRemoving(detail.row.name);
              }}
            />
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
                toggleOf={toggleOf}
                onToggle={onToggle}
                onOpen={(name) => {
                  setRoute({ kind: "plugin", name });
                }}
              />
            ) : (
              <AddonDetailView
                detail={detail}
                ops={ops}
                config={<PluginConfigForm name={detail.row.name} title={detail.row.title} />}
                aboutEnd={
                  listEntry === undefined ? undefined : <ExportExtension entry={listEntry} />
                }
              />
            )}
          </div>
        </div>
      </ScreenSwap>
      {toggleRequest.dialog}
      <RemoveDialog
        name={removing}
        busy={removeBusy}
        dataFailed={removeDataFailed}
        refusal={removeRefusal}
        loadPreview={loadPreview}
        loadProfiles={loadProfiles}
        pluginEntries={plugin.phase === "ready" ? plugin.entries : null}
        onCancel={() => {
          if (!removeBusy) {
            setRemoving(null);
            setRemoveDataFailed(false);
            setRemoveRefusal(null);
          }
        }}
        onConfirm={(name, dropData) => {
          setRemoveBusy(true);
          setRemoveDataFailed(false);
          setRemoveRefusal(null);
          detachVoid(
            controller.remove(name, { dropData }).then(({ outcome, refusal }) => {
              setRemoveBusy(false);
              const stay = keepsDialogOpen(outcome, dropData);
              setRemoveDataFailed(stay && outcome === "failed");
              setRemoveRefusal(refusal);
              if (!stay) {
                setRemoving(null);
                setRoute(ADDON_LIST);
              }
              return undefined;
            }),
          );
        }}
      />
    </section>
  );
}

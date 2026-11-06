// 검사 탭(LightCraft 오른쪽 "검사", spec §6.22.4). 캔버스나 목록에서 고른 확장 하나를 읽는다. 고른 것이 없으면 빈 상태다.
// 구역: 머리(이름, 층·종류·등급·버전·상태, 켜기·끄기, 다시 켜기, 확장 상세), 훅(예산과 p95), 주도 락(그룹이고 drive를 쓸 때),
// 기능, 설정 바인딩(`settings.explain`, 읽기만), 구성(그룹만), 최근 실패.
// 이 대화에서 끄기 스위치(`views/plugin/thread-switches.tsx`)와 이 대화의 프로필(`thread-profile.tsx`)은 대화 영역 "플러그인" 탭에 있다.
// 값은 `packages/client/src/workbench/inspect.ts`가 만든다.
// 데이터: `ext.get`, `ext.timings`, `group.list`·`group.driveLock`(대화가 열렸을 때), 엔진 거울의 실패 기록과 장부(`health`).
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  failureRowsOf,
  inspectCompositionOf,
  inspectDriveOf,
  inspectFeaturesOf,
  inspectHealthOf,
  inspectHookRowsOf,
  inspectSettingOf,
  rowOf,
  runtimeViewOf,
  selectedEntry,
  userConfigOf,
  type ExtRowVM,
  type InspectFeatureVM,
  type InspectHookVM,
  type HandlerFailureEntry,
  type InspectSettingVM,
  type RuntimeDriveView,
  type WorkbenchState,
} from "@fresnel/client/workbench";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ExtTimingsResult } from "@fresnel/contracts/extensions";
import type {
  ExtGetResult,
  ExtHealthEntry,
  ExtListEntry,
  GroupDriveLockResult,
  GroupStatusWire,
} from "@fresnel/contracts/wire";
import {
  Alert,
  Button,
  EmptyState,
  IconButton,
  ListDescription,
  ListDescriptionRow,
  Menu,
  MenuItem,
  Progress,
  Skeleton,
  StatusDot,
} from "@caustic/react";
import { CircleAlert, Ellipsis, TriangleAlert } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useHandlerFailures, useLinkPhase, useOpenThreadId } from "../../state/engine/index.ts";
import { useWorkbench, useWorkbenchActions } from "../../state/workbench/index.ts";
import { useCommands, type WorkbenchCommands } from "../commands.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { TONE_CLASS } from "../pages/settings/settings-text.ts";
import { BAR_TONE, FOLD_TEXT } from "./ext-detail.tsx";
import { kindText, lockText, stateText, stateTone } from "./ext-row.tsx";
import { detachVoid, reloadOnExtChanges, useWorkbenchController } from "./controller.ts";
import { useToggleRequest } from "./craft-parts.tsx";
import { linkOf, RoleText, type LinkState } from "../runtime/runtime-tab.tsx";

/** 한 묶음의 읽기 상태. `idle`은 대화가 없어 읽을 것이 없다는 뜻이다 */
type Load<T> =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly value: T };

const LOADING: { readonly kind: "loading" } = { kind: "loading" };
const ERROR: { readonly kind: "error" } = { kind: "error" };
const IDLE: { readonly kind: "idle" } = { kind: "idle" };

interface DriveData {
  readonly groups: readonly GroupStatusWire[];
  readonly lock: GroupDriveLockResult;
}

/** 검사 탭이 읽는 값 전부 */
export interface InspectData {
  readonly detail: Load<ExtGetResult>;
  readonly timings: Load<ExtTimingsResult>;
  readonly drive: Load<DriveData>;
  readonly settings: Load<readonly InspectSettingVM[]>;
}

const INSPECT_LOADING: InspectData = {
  detail: LOADING,
  timings: LOADING,
  drive: LOADING,
  settings: LOADING,
};

/** 주도 락 구역의 읽기. 대화가 없으면 읽을 것이 없다 */
async function loadDrive(
  workbench: WorkbenchCommands,
  threadId: ThreadId | null,
): Promise<Load<DriveData>> {
  if (threadId === null) return IDLE;
  const [groups, lock] = await Promise.all([
    workbench.groups(threadId),
    workbench.driveLock(threadId),
  ]);
  return groups.ok && lock.ok
    ? { kind: "ready", value: { groups: groups.value, lock: lock.value } }
    : ERROR;
}

/** 설정 바인딩 구역의 읽기: 매니페스트의 `userConfig` 키마다 `settings.explain`. 대화가 없거나 확장 읽기가 실패하면 그에 따른다 */
async function loadSettings(
  workbench: WorkbenchCommands,
  threadId: ThreadId | null,
  detail: Load<ExtGetResult>,
): Promise<Load<readonly InspectSettingVM[]>> {
  if (detail.kind !== "ready") return detail.kind === "error" ? ERROR : LOADING;
  if (threadId === null) return IDLE;
  const entries = userConfigOf(detail.value.manifest);
  if (entries.length === 0) return { kind: "ready", value: [] };
  const pairs = await Promise.all(
    entries.map(async (entry) => ({
      entry,
      got: await workbench.explain(entry.setting, threadId),
    })),
  );
  return pairs.every((pair) => pair.got.ok)
    ? {
        kind: "ready",
        value: pairs.flatMap((pair) =>
          pair.got.ok ? [inspectSettingOf(pair.entry, pair.got.value)] : [],
        ),
      }
    : ERROR;
}

/** 확장 하나의 검사 값 전부를 읽는다. 읽기들은 서로 기다리지 않는다(설정은 확장 읽기 뒤다) */
async function loadInspect(
  workbench: WorkbenchCommands,
  name: string,
  threadId: ThreadId | null,
): Promise<InspectData> {
  const [got, measured, drive] = await Promise.all([
    workbench.get(name),
    workbench.timings(name, threadId ?? undefined),
    loadDrive(workbench, threadId),
  ]);
  const detail: Load<ExtGetResult> = got.ok ? { kind: "ready", value: got.value } : ERROR;
  const timings: Load<ExtTimingsResult> = measured.ok
    ? { kind: "ready", value: measured.value }
    : ERROR;
  const settings = await loadSettings(workbench, threadId, detail);
  return { detail, timings, drive, settings };
}

/**
 * 고른 확장의 검사 값을 읽는다. 확장을 바꾸거나 대화를 바꾸면 다시 읽고, 확장 목록 알림마다 다시 읽는다.
 * 읽은 값은 확장과 대화의 키와 함께 둔다. 키가 다르면 읽는 중으로 본다. 연결이 없으면 읽지 않는다.
 */
function useInspectData(name: string, threadId: ThreadId | null, live: boolean): InspectData {
  const commands = useCommands();
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly data: InspectData } | null>(
    null,
  );
  // 읽기가 겹치면 마지막에 시작한 읽기의 값만 쓴다(먼저 끝난 오래된 값이 새 값을 덮지 않는다)
  const started = useRef(0);
  const key = `${name}\u0000${threadId ?? ""}`;
  const load = useCallback(async (): Promise<void> => {
    started.current += 1;
    const attempt = started.current;
    const data = await loadInspect(commands.workbench, name, threadId);
    if (attempt === started.current) setLoaded({ key, data });
  }, [commands, name, threadId, key]);
  useEffect(() => {
    if (!live) return undefined;
    detach(load(), rethrow);
    return reloadOnExtChanges(commands.workbench, load);
  }, [commands, live, load]);
  return loaded !== null && loaded.key === key ? loaded.data : INSPECT_LOADING;
}

/** 구역 머리(시안 `H`): 제목은 굵기와 글자색 단계로만 묶고, 끝 글(개수나 차수)은 오른쪽에 둔다. 낭독기에는 제목이 구역 이름이다 */
function Section(props: {
  readonly title: string;
  readonly end?: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section aria-label={props.title} className="grid content-start gap-2">
      <h3 className="m-0 flex min-w-0 items-baseline gap-2 pb-1 text-ui-dense font-semibold text-text-primary">
        {props.title}
        {props.end !== undefined && (
          <span className="ms-auto text-ui-xs font-normal text-text-tertiary">{props.end}</span>
        )}
      </h3>
      {props.children}
    </section>
  );
}

/** 훅 fold 글(`FOLD_TEXT`는 확장 상세와 같다). 알려지지 않은 훅이거나 fold가 없으면 없다 */
function foldText(fold: string | null): string | null {
  const id = fold === null ? undefined : FOLD_TEXT[fold];
  return id === undefined ? null : t(id);
}

/** 아이콘을 작은 면에 담고 색은 면에만 준다(시안 `ToneIcon`). 경고는 `TONE_CLASS`, 자동 꺼짐은 danger 한 쌍 */
const TONE_FACE = {
  warning: TONE_CLASS.warning,
  danger: "bg-danger-soft text-danger-text",
} as const;

function ToneFace(props: { readonly tone: keyof typeof TONE_FACE }): ReactNode {
  const Icon = props.tone === "danger" ? CircleAlert : TriangleAlert;
  return (
    <span
      aria-hidden
      className={`inline-grid size-5 flex-none place-items-center rounded-sm [&_svg]:size-icon-xs ${TONE_FACE[props.tone]}`}
    >
      <Icon />
    </span>
  );
}

const MUTED = "m-0 text-ui-dense text-text-tertiary";

function HooksSection(props: {
  readonly load: Load<ExtGetResult>;
  readonly timings: Load<ExtTimingsResult>;
}): ReactNode {
  const { load } = props;
  if (load.kind === "loading") return <Skeleton height={24} />;
  if (load.kind !== "ready") return <Alert tone="danger">{t("desktop.inspect.load.failed")}</Alert>;
  const measured =
    props.timings.kind === "ready" && props.timings.value.traceEnabled
      ? props.timings.value.timings
      : [];
  const rows: readonly InspectHookVM[] = inspectHookRowsOf(load.value.hooks, measured);
  if (rows.length === 0)
    return <p className={MUTED}>{t("desktop.workbench.detail.hooks.empty")}</p>;
  const traceOff = props.timings.kind === "ready" && !props.timings.value.traceEnabled;
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {rows.map((row) => {
        const fold = foldText(row.fold);
        // 예산 대비 퍼센트(시안 훅 표의 "예산 대비" 칸). 측정이 없거나 예산이 0이면 없다
        const ratio =
          row.p95Ms !== null && row.budgetMs > 0
            ? Math.round((row.p95Ms / row.budgetMs) * 100)
            : null;
        return (
          <li key={`${row.registrationId}:${row.hook}`} className="grid gap-1 text-ui-dense">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="text-text-primary">{row.hook}</span>
              {fold !== null && <span className="text-ui-xs text-text-secondary">{fold}</span>}
              <span className="ms-auto tabular-nums text-text-secondary">
                {t("desktop.inspect.hook.budget", { ms: row.budgetMs })}
              </span>
            </div>
            {/* 막대는 측정이 있을 때만 그린다(50% 넘으면 warning, 100%면 danger). 계측이 꺼졌으면 이유를 정보 아이콘 뒤에 둔다 */}
            <div className="flex flex-wrap items-center gap-2">
              {ratio !== null && row.level !== null ? (
                <>
                  <Progress
                    value={Math.max(2, ratio)}
                    size="xs"
                    tone={BAR_TONE[row.level]}
                    label={t("desktop.workbench.detail.hooks.col.use")}
                    className="w-14"
                  />
                  <span className="text-ui-xs tabular-nums text-text-tertiary">{`${ratio}%`}</span>
                </>
              ) : (
                <span className="text-ui-xs text-text-tertiary">
                  {t("desktop.inspect.hook.noMeasure")}
                </span>
              )}
              {traceOff && <InfoTip text={t("desktop.inspect.hook.traceOff")} />}
            </div>
            {(row.p95Ms !== null || row.failures !== null) && (
              <div className="flex flex-wrap items-baseline gap-x-3 text-ui-xs">
                {row.p95Ms !== null && (
                  <span className="tabular-nums text-text-primary">
                    {t("desktop.inspect.hook.p95", { ms: row.p95Ms })}
                  </span>
                )}
                {row.failures !== null && (
                  <span
                    className={`ms-auto tabular-nums ${row.failures > 0 ? "text-text-primary" : "text-text-tertiary"}`}
                  >
                    {t("desktop.inspect.hook.failures", { count: row.failures })}
                  </span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** 사용량 한 줄(시안 `Gauge`): 이름, 막대, 쓴 양 / 상한. 상한이 없으면 막대 자리에 "상한 없음"을 둔다 */
function Gauge(props: {
  readonly label: string;
  readonly used: number;
  readonly max: number | null;
}): ReactNode {
  const text = props.max === null ? String(props.used) : `${props.used} / ${props.max}`;
  return (
    <>
      <span className="text-text-tertiary">{props.label}</span>
      {props.max === null ? (
        <span className="text-text-tertiary">{t("desktop.inspect.drive.noLimit")}</span>
      ) : (
        <Progress
          value={props.max > 0 ? Math.min(100, Math.round((props.used / props.max) * 100)) : 0}
          size="xs"
          label={`${props.label} ${text}`}
        />
      )}
      <span className="text-end tabular-nums text-text-secondary">{text}</span>
    </>
  );
}

/** 주도 구역: 이 그룹의 역할과 대기 횟수, 주도의 턴·spawn·토큰 사용량. 끝 글은 차수다 */
function DriveSection(props: {
  readonly name: string;
  readonly drive: Load<DriveData>;
  readonly isGroup: boolean;
}): ReactNode {
  const { drive } = props;
  const title = t("desktop.inspect.drive.title");
  if (drive.kind === "idle") {
    return props.isGroup ? (
      <Section title={title}>
        <p className={MUTED}>{t("desktop.inspect.drive.noThread")}</p>
      </Section>
    ) : null;
  }
  if (drive.kind === "loading") {
    return props.isGroup ? (
      <Section title={title}>
        <Skeleton height={24} />
      </Section>
    ) : null;
  }
  if (drive.kind === "error") {
    return (
      <Section title={title}>
        <Alert tone="danger">{t("desktop.runtime.lock.failed")}</Alert>
      </Section>
    );
  }
  const own = drive.value.groups.find((group) => group.id === props.name);
  if (own === undefined || !own.usesDrive) return null;
  const view: RuntimeDriveView = runtimeViewOf(drive.value.groups, drive.value.lock);
  const role = inspectDriveOf(view, props.name);
  return (
    <Section title={title} end={t("desktop.runtime.lock.epoch", { epoch: view.leaseEpoch })}>
      <div className="grid gap-2">
        <p className="m-0 flex flex-wrap items-baseline gap-2 text-ui-dense">
          <span className="text-text-primary">{t(RoleText[role.role])}</span>
          {role.waits !== null && role.waitLimit !== null && (
            <span className="text-ui-xs text-text-tertiary">
              {t("desktop.inspect.drive.waits", { waits: role.waits, waitLimit: role.waitLimit })}
            </span>
          )}
        </p>
        <div className="grid grid-cols-[3rem_minmax(0,1fr)_5.5rem] items-center gap-x-2 gap-y-1.5 text-ui-xs">
          <Gauge
            label={t("desktop.inspect.drive.turns")}
            used={view.used.turns}
            max={view.limits.turns}
          />
          <Gauge
            label={t("desktop.inspect.drive.spawns")}
            used={view.used.spawns}
            max={view.limits.spawns}
          />
          <Gauge
            label={t("desktop.inspect.drive.tokens")}
            used={view.used.tokens}
            max={view.limits.tokens}
          />
        </div>
      </div>
    </Section>
  );
}

/** 주도 락 구역을 보일지: 그룹이거나, 목록에서 이 확장이 drive를 쓴다고 읽힌 경우다 */
function driveShown(entry: ExtListEntry, drive: Load<DriveData>): boolean {
  if (entry.isGroup) return true;
  return (
    drive.kind === "ready" && drive.value.groups.some((g) => g.id === entry.name && g.usesDrive)
  );
}

/** 요구·선택 줄(시안 `ListDescriptionRow`): 용어 하나, 값은 기능 이름마다 묶인 제공자(`← peer`)와 묶이지 않은 글 */
function FeatureRow(props: {
  readonly term: string;
  readonly items: readonly InspectFeatureVM[];
}): ReactNode {
  if (props.items.length === 0) return null;
  return (
    <ListDescriptionRow term={props.term}>
      <span className="grid gap-0.5">
        {props.items.map((item) => (
          <span
            key={`${props.term}:${item.capability}:${item.peer ?? ""}`}
            className="flex flex-wrap items-baseline gap-x-2"
          >
            <span className="font-mono text-mono-sm text-text-primary">{item.capability}</span>
            {item.peer !== null && (
              <span className="font-mono text-mono-sm text-text-tertiary">
                {t("desktop.inspect.features.peer", { peer: item.peer })}
              </span>
            )}
            {!item.satisfied && (
              <span className="text-ui-xs text-text-tertiary">
                {t("desktop.inspect.features.unmet")}
              </span>
            )}
          </span>
        ))}
      </span>
    </ListDescriptionRow>
  );
}

function FeaturesSection(props: { readonly load: Load<ExtGetResult> }): ReactNode {
  const { load } = props;
  if (load.kind === "loading") return <Skeleton height={24} />;
  if (load.kind !== "ready") return <Alert tone="danger">{t("desktop.inspect.load.failed")}</Alert>;
  const features = inspectFeaturesOf(load.value.bindings);
  const unmetRequired = features.requires.some((f) => !f.satisfied);
  const unmetOptional = features.optional.some((f) => !f.satisfied);
  const none = unmetRequired
    ? t("desktop.inspect.features.none.blocked")
    : unmetOptional
      ? t("desktop.inspect.features.none.degraded")
      : t("desktop.inspect.features.none");
  const shown =
    features.provides.length > 0 || features.requires.length > 0 || features.optional.length > 0;
  return (
    <div className="grid gap-2">
      {features.provides.length === 0 && <p className={MUTED}>{none}</p>}
      {shown && (
        <ListDescription variant="ghost" size="xs">
          {features.provides.length > 0 && (
            <ListDescriptionRow term={t("desktop.inspect.features.provides")}>
              <span className="flex flex-wrap gap-x-2 font-mono text-mono-sm text-text-primary">
                {features.provides.map((capability) => (
                  <span key={capability}>{capability}</span>
                ))}
              </span>
            </ListDescriptionRow>
          )}
          <FeatureRow term={t("desktop.inspect.features.requires")} items={features.requires} />
          <FeatureRow term={t("desktop.inspect.features.optional")} items={features.optional} />
        </ListDescription>
      )}
    </div>
  );
}

const SCOPE_TEXT: Readonly<Record<string, MessageId>> = {
  managed: "desktop.inspect.scope.managed",
  user: "desktop.inspect.scope.user",
  project: "desktop.inspect.scope.project",
  local: "desktop.inspect.scope.local",
  session: "desktop.inspect.scope.session",
};

/**
 * 설정 한 줄(시안 `SettingRow`의 읽기 전용 형태): 제목과 mono 키, 값, 이긴 범위 글.
 * 적용 시점과 가려진 범위는 `settings.explain`이 주지 않아 그리지 않는다. 컨트롤은 없다(읽기만).
 */
function SettingLine(props: { readonly row: InspectSettingVM }): ReactNode {
  const { row } = props;
  const labelId = useId();
  return (
    <div
      role="group"
      data-slot="setting-row"
      aria-labelledby={labelId}
      className="grid gap-1.5 py-3"
    >
      <div className="flex min-h-6 min-w-0 items-baseline gap-2">
        <span id={labelId} className="shrink-0 text-ui font-medium text-text-primary">
          {row.title}
        </span>
        <span className="min-w-0 truncate font-mono text-mono-sm text-text-tertiary">
          {row.key}
        </span>
      </div>
      <p className="m-0 text-ui-dense text-text-primary">
        {row.value ?? t("desktop.inspect.settings.hidden")}
      </p>
      <p className="m-0 text-ui-sm text-text-tertiary">
        {row.winningScope === null
          ? t("desktop.inspect.settings.default")
          : t("desktop.inspect.settings.from", {
              scope: t(SCOPE_TEXT[row.winningScope] ?? "desktop.inspect.scope.user"),
            })}
      </p>
    </div>
  );
}

function SettingsSection(props: { readonly load: Load<readonly InspectSettingVM[]> }): ReactNode {
  const { load } = props;
  if (load.kind === "idle")
    return <p className={MUTED}>{t("desktop.inspect.settings.noThread")}</p>;
  if (load.kind === "loading") return <Skeleton height={24} />;
  if (load.kind === "error")
    return <Alert tone="danger">{t("desktop.inspect.settings.failed")}</Alert>;
  if (load.value.length === 0)
    return <p className={MUTED}>{t("desktop.inspect.settings.empty")}</p>;
  return (
    <div className="grid gap-1">
      {load.value.map((row) => (
        <SettingLine key={row.key} row={row} />
      ))}
    </div>
  );
}

function CompositionSection(props: { readonly load: Load<ExtGetResult> }): ReactNode {
  const { load } = props;
  if (load.kind === "loading") return <Skeleton height={24} />;
  if (load.kind !== "ready") return <Alert tone="danger">{t("desktop.inspect.load.failed")}</Alert>;
  const blocks = inspectCompositionOf(load.value.manifest);
  if (blocks === null) return <p className={MUTED}>{t("desktop.inspect.composition.none")}</p>;
  return (
    <ListDescription variant="ghost" size="xs">
      {blocks.map((block) => (
        <ListDescriptionRow key={block.id} term={block.title ?? block.id}>
          <span className="font-mono text-mono-sm text-text-tertiary">
            {`${block.stage} · ${block.op}`}
          </span>
        </ListDescriptionRow>
      ))}
    </ListDescription>
  );
}

function FailuresSection(props: {
  readonly name: string;
  readonly health: readonly ExtHealthEntry[];
  readonly records: readonly HandlerFailureEntry[];
}): ReactNode {
  const rows = failureRowsOf(props.records, props.name);
  const health = inspectHealthOf(props.health);
  if (rows.length === 0 && health.length === 0) {
    return <p className={MUTED}>{t("desktop.inspect.failures.empty")}</p>;
  }
  // 장부 줄은 연속 실패, 자동 꺼짐, 마지막 실패를, 기록 줄은 훅과 사유와 연속 수를 보인다. 자동 꺼짐은 글로만 두고 나눔 보기의 Alert를 되풀이하지 않는다
  return (
    <ul className="m-0 grid list-none gap-2 p-0 text-ui-dense">
      {health.map((h) => (
        <li key={h.registrationId} className="flex min-w-0 items-start gap-1.5">
          <ToneFace tone={h.autoDisabled ? "danger" : "warning"} />
          <span className="grid min-w-0 gap-0.5">
            {h.consecutiveFailures > 0 && (
              <span className="text-text-primary">
                {t("desktop.inspect.failures.consecutive", { count: h.consecutiveFailures })}
              </span>
            )}
            {h.autoDisabled && (
              <span className="text-ui-xs text-text-secondary">
                {t("desktop.inspect.failures.autoOff")}
              </span>
            )}
            {h.lastFailureAt !== null && (
              <span className="truncate text-ui-xs text-text-tertiary">
                {t("desktop.inspect.failures.last", {
                  at: h.lastFailureAt,
                  error: h.lastError ?? "",
                })}
              </span>
            )}
          </span>
        </li>
      ))}
      {rows.map((row) => (
        <li
          key={`${row.point}\u0000${row.result}\u0000${row.message}`}
          className="flex min-w-0 items-start gap-1.5"
        >
          <ToneFace tone="warning" />
          <span className="grid min-w-0 gap-0.5">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="text-text-primary">{row.point}</span>
              <span className="ms-auto text-ui-xs tabular-nums text-text-tertiary">
                {t("desktop.inspect.failures.streak", { count: row.consecutive })}
              </span>
            </span>
            <span className="truncate text-ui-xs text-text-secondary">{row.message}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * 켜기·끄기 단추(시안 머리의 outline xs). 잠기면 단추를 끄고 이유는 정보 아이콘 뒤에 둔다.
 * 요청이 반영되길 기다리는 동안도 끈다(시안과 같다). 요청 자체는 `onToggle`이 확인 대화 상자로 보낸다.
 */
function ToggleButton(props: {
  readonly row: ExtRowVM;
  readonly onToggle: (target: boolean) => void;
}): ReactNode {
  const { row } = props;
  return (
    <>
      <Button
        size="xs"
        variant="outline"
        disabled={row.lock !== null || row.pendingTarget !== null}
        onClick={() => {
          props.onToggle(!row.on);
        }}
      >
        {row.on ? t("desktop.inspect.toggle.off") : t("desktop.inspect.toggle.on")}
      </Button>
      {row.lock !== null && <InfoTip text={lockText(row.lock)} />}
    </>
  );
}

/**
 * 검사 탭 그림. 값과 연결 상태, 장부, 실패 기록을 받아 그린다(시험은 값을 넣어 그린다).
 * `onToggle`, `onReenable`, `onDetail`은 호출자가 잇는다.
 */
export function InspectBody(props: {
  readonly entry: ExtListEntry;
  readonly pending: WorkbenchState["pending"];
  readonly link: LinkState;
  readonly data: InspectData;
  readonly health: readonly ExtHealthEntry[];
  readonly records: readonly HandlerFailureEntry[];
  readonly onToggle: (target: boolean) => void;
  readonly onReenable: () => void;
  readonly onDetail: () => void;
}): ReactNode {
  const { entry, data } = props;
  const row = rowOf(entry, props.pending);
  const isGroup = entry.isGroup;
  return (
    <div className="grid content-start gap-5">
      <header className="grid gap-2">
        {/* 이름: 표시 이름이 따로 있으면 mono id를 옆에 둔다(시안 ExtName) */}
        <span className="inline-flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-medium text-text-primary">
            {row.displayName ?? row.name}
          </span>
          {row.displayName !== null && (
            <span className="truncate font-mono text-mono-sm text-text-tertiary">{row.name}</span>
          )}
        </span>
        <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-ui-sm text-text-tertiary">
          <span className="font-mono text-mono-sm">{row.layer}</span>
          <span>{`${kindText(row.kind)} · ${row.grade} · ${row.version}`}</span>
        </p>
        <div className="text-ui-dense">
          <StatusDot tone={stateTone(row.state)} label={stateText(row.state)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {row.state === "auto_disabled" ? (
            <Button size="xs" variant="outline" onClick={props.onReenable}>
              {t("desktop.workbench.reenable")}
            </Button>
          ) : (
            <ToggleButton row={row} onToggle={props.onToggle} />
          )}
          <Menu
            align="end"
            aria-label={t("desktop.inspect.menu.label")}
            trigger={
              <IconButton size="sm" variant="ghost" label={t("desktop.inspect.menu.label")}>
                <Ellipsis aria-hidden />
              </IconButton>
            }
          >
            <MenuItem onSelect={props.onDetail}>{t("desktop.workbench.selection.detail")}</MenuItem>
          </Menu>
        </div>
      </header>
      {props.link === "offline" ? (
        <p className={MUTED}>{t("desktop.runtime.offline")}</p>
      ) : (
        <>
          <Section
            title={t("desktop.inspect.section.hooks")}
            end={t("desktop.inspect.section.count", { count: entry.hookCount })}
          >
            <HooksSection load={data.detail} timings={data.timings} />
          </Section>
          {driveShown(entry, data.drive) && (
            <DriveSection name={entry.name} drive={data.drive} isGroup={isGroup} />
          )}
          <Section title={t("desktop.inspect.features.title")}>
            <FeaturesSection load={data.detail} />
          </Section>
          <Section title={t("desktop.inspect.settings.title")}>
            <SettingsSection load={data.settings} />
          </Section>
          {isGroup && (
            <Section title={t("desktop.inspect.composition.title")}>
              <CompositionSection load={data.detail} />
            </Section>
          )}
          <Section title={t("desktop.inspect.failures.title")}>
            <FailuresSection name={entry.name} health={props.health} records={props.records} />
          </Section>
        </>
      )}
    </div>
  );
}

/** 검사 탭. 목록이나 캔버스에서 고른 확장을 읽는다. 고른 것이 없으면 빈 상태다 */
export function InspectTab(): ReactNode {
  const entry = useWorkbench(selectedEntry);
  if (entry === null) {
    return (
      <EmptyState
        surface="none"
        size="sm"
        title={t("desktop.inspect.empty.title")}
        description={t("desktop.inspect.empty.body")}
      />
    );
  }
  return <InspectPanel entry={entry} />;
}

function InspectPanel(props: { readonly entry: ExtListEntry }): ReactNode {
  const { entry } = props;
  const threadId = useOpenThreadId();
  const link = linkOf(useLinkPhase());
  const data = useInspectData(entry.name, threadId, link === "live");
  const controller = useWorkbenchController();
  const toggle = useToggleRequest(controller);
  const actions = useWorkbenchActions();
  const pending = useWorkbench((s) => s.pending);
  const healthRecords = useWorkbench((s) => s.health);
  const records = useHandlerFailures();
  const health = Object.values(healthRecords).filter((h) => h.name === entry.name);
  return (
    <>
      <InspectBody
        entry={entry}
        pending={pending}
        link={link}
        data={data}
        health={health}
        records={records}
        onToggle={(target) => {
          toggle.request(entry.name, target);
        }}
        onReenable={() => {
          detachVoid(controller.reenable(entry.name));
        }}
        onDetail={() => {
          actions.openDetail(entry.name);
        }}
      />
      {toggle.dialog}
    </>
  );
}

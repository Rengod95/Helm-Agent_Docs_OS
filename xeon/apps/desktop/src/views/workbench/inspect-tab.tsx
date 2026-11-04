// 검사 탭(LightCraft 오른쪽 "검사", spec §6.22.4). 캔버스나 목록에서 고른 확장 하나를 읽는다. 고른 것이 없으면 빈 상태다.
// 구역: 머리(이름, 층·종류·등급·버전·상태, 켜기·끄기, 다시 켜기, 확장 상세), 훅(예산과 p95), 주도 락(그룹이고 drive를 쓸 때),
// 기능, 설정 바인딩(`settings.explain`, 읽기만), 구성(그룹만), 최근 실패, 이 대화의 프로필(프로필 하나를 이 대화에 적용).
// 이 대화에서 끄기 스위치는 대화 영역 "플러그인" 탭(`views/plugin/thread-switches.tsx`)에 있다.
// 값은 `packages/client/src/workbench/inspect.ts`가 만든다.
// 데이터: `ext.get`, `ext.timings`, `group.list`·`group.driveLock`(대화가 열렸을 때), `profile.list`, 엔진 거울의 실패 기록과 장부(`health`).
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
  Profile,
} from "@fresnel/contracts/wire";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  EmptyState,
  Field,
  Meter,
  Select,
  SelectOption,
  Skeleton,
  StatusDot,
} from "@caustic/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHandlerFailures, useLinkPhase, useOpenThreadId } from "../../state/engine/index.ts";
import { useWorkbench, useWorkbenchActions } from "../../state/workbench/index.ts";
import { useCommands, type WorkbenchCommands } from "../commands.ts";
import { FailureRecords } from "./ext-detail.tsx";
import { ExtName, ExtSwitch, kindText, lockText, stateText, stateTone } from "./ext-row.tsx";
import { detachVoid, reloadOnExtChanges, useWorkbenchController } from "./controller.ts";
import { useToggleRequest } from "./craft-parts.tsx";
import { driveUsageText, linkOf, RoleText, type LinkState } from "../runtime/runtime-tab.tsx";

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
  /** 저장된 프로필 목록. 대화와 상관없이 읽는다 */
  readonly profiles: Load<readonly Profile[]>;
}

const INSPECT_LOADING: InspectData = {
  detail: LOADING,
  timings: LOADING,
  drive: LOADING,
  settings: LOADING,
  profiles: LOADING,
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

async function loadProfiles(workbench: WorkbenchCommands): Promise<Load<readonly Profile[]>> {
  const got = await workbench.profiles();
  return got.ok ? { kind: "ready", value: got.value } : ERROR;
}

/** 확장 하나의 검사 값 전부를 읽는다. 읽기들은 서로 기다리지 않는다(설정은 확장 읽기 뒤다) */
async function loadInspect(
  workbench: WorkbenchCommands,
  name: string,
  threadId: ThreadId | null,
): Promise<InspectData> {
  const [got, measured, drive, profiles] = await Promise.all([
    workbench.get(name),
    workbench.timings(name, threadId ?? undefined),
    loadDrive(workbench, threadId),
    loadProfiles(workbench),
  ]);
  const detail: Load<ExtGetResult> = got.ok ? { kind: "ready", value: got.value } : ERROR;
  const timings: Load<ExtTimingsResult> = measured.ok
    ? { kind: "ready", value: measured.value }
    : ERROR;
  const settings = await loadSettings(workbench, threadId, detail);
  return { detail, timings, drive, settings, profiles };
}

/**
 * 고른 확장의 검사 값을 읽는다. 확장을 바꾸거나 대화를 바꾸면 다시 읽고, 확장 목록 알림마다 다시 읽는다.
 * 읽은 값은 확장과 대화의 키와 함께 둔다. 키가 다르면 읽는 중으로 본다. 연결이 없으면 읽지 않는다.
 * `reload`는 쓰기가 끝난 뒤 바로 다시 읽을 때 쓴다(알림을 기다리지 않는다).
 */
function useInspectData(
  name: string,
  threadId: ThreadId | null,
  live: boolean,
): { readonly data: InspectData; readonly reload: () => void } {
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
  const reload = useCallback(() => {
    detach(load(), rethrow);
  }, [load]);
  return {
    data: loaded !== null && loaded.key === key ? loaded.data : INSPECT_LOADING,
    reload,
  };
}

function Section(props: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <section aria-label={props.title} className="grid content-start gap-2">
      <h3 className="m-0 text-ui-sm font-semibold text-text-primary">{props.title}</h3>
      {props.children}
    </section>
  );
}

/** 훅 fold의 사용자 글(용어 `fold`: 보기·막기·고치기·모으기) */
const FOLD_TEXT: Readonly<Record<string, MessageId>> = {
  tap: "desktop.inspect.fold.tap",
  first: "desktop.inspect.fold.first",
  chain: "desktop.inspect.fold.chain",
  collect: "desktop.inspect.fold.collect",
};

function FoldBadge(props: { readonly fold: string }): ReactNode {
  const id = FOLD_TEXT[props.fold];
  return id === undefined ? null : <Badge size="sm">{t(id)}</Badge>;
}

const MUTED = "m-0 text-ui-sm text-text-tertiary";

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
    <ul className="m-0 grid list-none gap-2 p-0">
      {rows.map((row) => (
        <li key={`${row.registrationId}:${row.hook}`} className="grid gap-1 text-ui-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-text-primary">{row.hook}</span>
            {row.fold !== null && <FoldBadge fold={row.fold} />}
            <span className="ms-auto text-text-tertiary">
              {t("desktop.inspect.hook.budgetValue", {
                budgetClass: row.budgetClass,
                ms: row.budgetMs,
              })}
            </span>
          </div>
          {row.p95Ms !== null && row.budgetMs > 0 ? (
            <Meter
              size="sm"
              value={row.p95Ms}
              max={row.budgetMs}
              high={row.budgetMs / 2}
              label={row.hook}
              valueText={t("desktop.inspect.hook.p95", { ms: row.p95Ms })}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-text-tertiary">
            {row.p95Ms !== null ? (
              <span>{t("desktop.inspect.hook.p95", { ms: row.p95Ms })}</span>
            ) : (
              <span>
                {traceOff
                  ? t("desktop.inspect.hook.traceOff")
                  : t("desktop.inspect.hook.noMeasure")}
              </span>
            )}
            {row.failures !== null && (
              <span className="ms-auto">
                {t("desktop.inspect.hook.failures", { count: row.failures })}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function DriveSection(props: {
  readonly name: string;
  readonly drive: Load<DriveData>;
  readonly isGroup: boolean;
}): ReactNode {
  const { drive } = props;
  if (drive.kind === "idle") {
    return props.isGroup ? <p className={MUTED}>{t("desktop.inspect.drive.noThread")}</p> : null;
  }
  if (drive.kind === "loading") return props.isGroup ? <Skeleton height={24} /> : null;
  if (drive.kind === "error")
    return <Alert tone="danger">{t("desktop.runtime.lock.failed")}</Alert>;
  const own = drive.value.groups.find((group) => group.id === props.name);
  if (own === undefined || !own.usesDrive) return null;
  const view: RuntimeDriveView = runtimeViewOf(drive.value.groups, drive.value.lock);
  const role = inspectDriveOf(view, props.name);
  return (
    <div className="grid gap-1 text-ui-sm">
      <p className="m-0 flex flex-wrap items-center gap-2">
        <Badge size="sm">{t(RoleText[role.role])}</Badge>
        {role.waits !== null && role.waitLimit !== null && (
          <span className="text-text-tertiary">
            {t("desktop.inspect.drive.waits", { waits: role.waits, waitLimit: role.waitLimit })}
          </span>
        )}
      </p>
      <p className={MUTED}>
        {t("desktop.runtime.lock.epoch", { epoch: view.leaseEpoch })} · {driveUsageText(view)}
      </p>
    </div>
  );
}

/** 주도 락 구역을 보일지: 그룹이거나, 목록에서 이 확장이 drive를 쓴다고 읽힌 경우다 */
function driveShown(entry: ExtListEntry, drive: Load<DriveData>): boolean {
  if (entry.isGroup) return true;
  return (
    drive.kind === "ready" && drive.value.groups.some((g) => g.id === entry.name && g.usesDrive)
  );
}

function FeatureList(props: {
  readonly title: string;
  readonly items: readonly InspectFeatureVM[];
}): ReactNode {
  if (props.items.length === 0) return null;
  return (
    <div className="grid gap-0.5">
      <h4 className="m-0 text-ui-sm font-medium text-text-secondary">{props.title}</h4>
      <ul className="m-0 grid list-none gap-0.5 p-0 text-ui-sm">
        {props.items.map((item) => (
          <li
            key={`${props.title}:${item.capability}:${item.peer ?? ""}`}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="font-mono text-text-primary">{item.capability}</span>
            {item.peer !== null && (
              <span className="font-mono text-text-tertiary">
                {t("desktop.inspect.features.peer", { peer: item.peer })}
              </span>
            )}
            <span className="ms-auto text-text-tertiary">
              {item.satisfied ? null : t("desktop.inspect.features.unmet")}
            </span>
          </li>
        ))}
      </ul>
    </div>
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
  return (
    <div className="grid gap-2">
      {features.provides.length === 0 ? (
        <p className={MUTED}>{none}</p>
      ) : (
        <div className="grid gap-0.5">
          <h4 className="m-0 text-ui-sm font-medium text-text-secondary">
            {t("desktop.inspect.features.provides")}
          </h4>
          <p className="m-0 flex flex-wrap gap-2 font-mono text-ui-sm text-text-primary">
            {features.provides.map((capability) => (
              <span key={capability}>{capability}</span>
            ))}
          </p>
        </div>
      )}
      <FeatureList title={t("desktop.inspect.features.requires")} items={features.requires} />
      <FeatureList title={t("desktop.inspect.features.optional")} items={features.optional} />
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
    <ul className="m-0 grid list-none gap-2 p-0 text-ui-sm">
      {load.value.map((row) => (
        <li key={row.key} className="grid gap-0.5">
          <span className="text-text-primary">{row.title}</span>
          <span className="font-mono text-text-tertiary">{row.key}</span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-text-primary">
              {row.value ?? t("desktop.inspect.settings.hidden")}
            </span>
            <span className="ms-auto text-text-tertiary">
              {row.winningScope === null
                ? t("desktop.inspect.settings.default")
                : t("desktop.inspect.settings.from", {
                    scope: t(SCOPE_TEXT[row.winningScope] ?? "desktop.inspect.scope.user"),
                  })}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function CompositionSection(props: { readonly load: Load<ExtGetResult> }): ReactNode {
  const { load } = props;
  if (load.kind === "loading") return <Skeleton height={24} />;
  if (load.kind !== "ready") return <Alert tone="danger">{t("desktop.inspect.load.failed")}</Alert>;
  const blocks = inspectCompositionOf(load.value.manifest);
  if (blocks === null) return <p className={MUTED}>{t("desktop.inspect.composition.none")}</p>;
  return (
    <ul className="m-0 grid list-none gap-0.5 p-0 text-ui-sm">
      {blocks.map((block) => (
        <li key={block.id} className="flex flex-wrap items-center gap-2">
          <span className="text-text-primary">{block.title ?? block.id}</span>
          <span className="font-mono text-text-tertiary">{block.stage}</span>
          <span className="ms-auto font-mono text-text-tertiary">{block.op}</span>
        </li>
      ))}
    </ul>
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
  return (
    <div className="grid gap-2">
      {health.map((h) => (
        <div key={h.registrationId} className="grid gap-0.5 text-ui-sm">
          {h.consecutiveFailures > 0 && (
            <span className="text-text-primary">
              {t("desktop.inspect.failures.consecutive", { count: h.consecutiveFailures })}
            </span>
          )}
          {h.lastFailureAt !== null && (
            <span className="text-text-tertiary">
              {t("desktop.inspect.failures.last", {
                at: h.lastFailureAt,
                error: h.lastError ?? "",
              })}
            </span>
          )}
          {h.autoDisabled && (
            <span className="text-text-tertiary">{t("desktop.inspect.failures.autoOff")}</span>
          )}
        </div>
      ))}
      {rows.length > 0 && <FailureRecords rows={rows} failed={false} />}
    </div>
  );
}

/** 확인 대화 상자 하나. 취소는 닫기이고 실행 단추는 `onConfirm`을 부른다 */
function ConfirmDialog(props: {
  readonly open: boolean;
  readonly heading: string;
  readonly body: string;
  readonly action: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): ReactNode {
  return (
    <Dialog
      kind="alert"
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      title={props.heading}
      description={props.body}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.workbench.cancel")}
            </Button>
          </DialogClose>
          <DialogAction onClick={props.onConfirm}>{props.action}</DialogAction>
        </>
      }
    />
  );
}

/**
 * 이 대화의 프로필 구역: 저장된 프로필을 고르고 "적용"을 확인한 뒤 이 대화에 쓴다.
 * 대화가 없으면 고르기와 적용이 잠기고, 목록을 못 읽으면 오류 한 줄이다.
 */
function ProfileSection(props: {
  readonly profiles: Load<readonly Profile[]>;
  readonly threadOpen: boolean;
  readonly onApply: (id: string) => void;
}): ReactNode {
  const { profiles } = props;
  const title = t("desktop.inspect.profile.title");
  const [selected, setSelected] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  if (profiles.kind !== "ready") {
    return (
      <Section title={title}>
        {profiles.kind === "error" ? (
          <Alert tone="danger">{t("desktop.inspect.profile.loadFailed")}</Alert>
        ) : (
          <Skeleton height={24} />
        )}
      </Section>
    );
  }
  const chosen = profiles.value.find((profile) => profile.id === selected);
  return (
    <Section title={title}>
      {profiles.value.length === 0 ? (
        <p className={MUTED}>{t("desktop.inspect.profile.empty")}</p>
      ) : (
        <Field label={t("desktop.inspect.profile.select")}>
          <Select
            value={selected ?? ""}
            placeholder={t("desktop.inspect.profile.pick")}
            disabled={!props.threadOpen}
            onValueChange={setSelected}
          >
            {profiles.value.map((profile) => (
              <SelectOption key={profile.id} value={profile.id}>
                {profile.title}
              </SelectOption>
            ))}
          </Select>
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!props.threadOpen || chosen === undefined}
          onClick={() => {
            setAsking(true);
          }}
        >
          {t("desktop.inspect.profile.apply")}
        </Button>
      </div>
      {!props.threadOpen && <p className={MUTED}>{t("desktop.inspect.profile.noThread")}</p>}
      <ConfirmDialog
        open={asking && chosen !== undefined}
        heading={t("desktop.inspect.profile.confirm.heading")}
        body={
          chosen === undefined
            ? ""
            : t("desktop.inspect.profile.confirm.body", { title: chosen.title })
        }
        action={t("desktop.inspect.profile.apply")}
        onCancel={() => {
          setAsking(false);
        }}
        onConfirm={() => {
          setAsking(false);
          if (chosen !== undefined) props.onApply(chosen.id);
        }}
      />
    </Section>
  );
}

/**
 * 검사 탭 그림. 값과 연결 상태, 장부, 실패 기록을 받아 그린다(시험은 값을 넣어 그린다).
 * `onToggle`, `onReenable`, `onDetail`, `onApplyProfile`은 호출자가 잇는다.
 */
export function InspectBody(props: {
  readonly entry: ExtListEntry;
  readonly pending: WorkbenchState["pending"];
  readonly link: LinkState;
  readonly data: InspectData;
  readonly health: readonly ExtHealthEntry[];
  readonly records: readonly HandlerFailureEntry[];
  /** 열린 대화가 있나. 없으면 프로필 적용이 잠긴다 */
  readonly threadOpen: boolean;
  readonly onToggle: (target: boolean) => void;
  readonly onApplyProfile: (id: string) => void;
  readonly onReenable: () => void;
  readonly onDetail: () => void;
}): ReactNode {
  const { entry, data } = props;
  const row = rowOf(entry, props.pending);
  const isGroup = entry.isGroup;
  return (
    <div className="grid content-start gap-5">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ExtName row={row} />
          <span className="font-mono text-text-tertiary">
            {row.layer} · {kindText(row.kind)} · {row.version}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-ui-sm">
          <StatusDot tone={stateTone(row.state)} label={stateText(row.state)} />
          <Badge size="sm">{row.grade}</Badge>
          <ExtSwitch row={row} onToggle={props.onToggle} />
        </div>
        {row.lock !== null && <p className={MUTED}>{lockText(row.lock)}</p>}
        <div className="flex flex-wrap gap-2">
          {row.state === "auto_disabled" && (
            <Button size="sm" variant="outline" onClick={props.onReenable}>
              {t("desktop.workbench.reenable")}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={props.onDetail}>
            {t("desktop.workbench.selection.detail")}
          </Button>
        </div>
      </header>
      {props.link === "offline" ? (
        <p className={MUTED}>{t("desktop.runtime.offline")}</p>
      ) : (
        <>
          <Section title={`${t("desktop.inspect.section.hooks")} ${entry.hookCount}`}>
            <HooksSection load={data.detail} timings={data.timings} />
          </Section>
          {driveShown(entry, data.drive) && (
            <Section title={t("desktop.inspect.drive.title")}>
              <DriveSection name={entry.name} drive={data.drive} isGroup={isGroup} />
            </Section>
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
          <ProfileSection
            profiles={data.profiles}
            threadOpen={props.threadOpen}
            onApply={props.onApplyProfile}
          />
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
  const inspect = useInspectData(entry.name, threadId, link === "live");
  const { data } = inspect;
  const controller = useWorkbenchController();
  const toggle = useToggleRequest(controller);
  const actions = useWorkbenchActions();
  const pending = useWorkbench((s) => s.pending);
  const healthRecords = useWorkbench((s) => s.health);
  const records = useHandlerFailures();
  const health = Object.values(healthRecords).filter((h) => h.name === entry.name);
  const applyProfile = async (id: string): Promise<void> => {
    if (threadId === null) return;
    const done = await controller.applyProfile(id, threadId);
    if (done) inspect.reload();
  };
  return (
    <>
      <InspectBody
        entry={entry}
        pending={pending}
        link={link}
        data={data}
        health={health}
        records={records}
        threadOpen={threadId !== null}
        onToggle={(target) => {
          toggle.request(entry.name, target);
        }}
        onApplyProfile={(id) => {
          detachVoid(applyProfile(id));
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

import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogClose,
  EmptyState,
  IconButton,
  Input,
  Menu,
  MenuItem,
  NumberField,
  Progress,
  Select,
  SelectOption,
  Skeleton,
  Switch,
} from "@caustic/react";
import { LocalizedTagInput } from "../../localized-tag-input.tsx";
import { Ellipsis, Lock, TriangleAlert, X } from "@caustic/react/icons";
import { activeLocale, t } from "@fresnel/client/i18n";
import type { AccountEntry, RateLimitEntry, RotationState } from "@fresnel/client";
import type { UsageGauge, UsageUnit } from "@fresnel/contracts/wire";
import { useState, type ReactNode } from "react";
import { TONE_CLASS } from "../settings/settings-text.ts";
import { InfoTip, PanelBlock } from "../shared/panel-parts.tsx";
import { OrderedList, type OrderedItem } from "../shared/ordered-list.tsx";
import {
  ON_LIMIT_ACTIONS,
  ROLE_IDS,
  foldOf,
  usageFractionOf,
  type ChainMap,
  type ProviderPool,
  type RateRow,
  type RoleRefs,
  type RoleId,
} from "./providers-model.ts";
import {
  amountRefOf,
  fieldIdOf,
  onLimitIdOf,
  resetTextOf,
  roleIdOf,
  unitIdOf,
  windowIdOf,
  type FieldName,
} from "./providers-text.ts";

// 계정과 제공자, 예산과 한도 화면(P-11)의 그림. 상태는 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 값은 `providers-screen.tsx`가 검사해서 넘기고, 이 그림은 보여 주고 콜백을 부를 뿐이다.
// 그림은 목업 `p11-accounts/parts.tsx`와 `app.tsx`를 따른다. 설명은 정보 아이콘 뒤에, 경고와 오류는 글로 보인다.

/** 읽을 수 없는 값의 안내. 그 항목은 고칠 수 없고 파일로 본다 */
export function UnreadableNote(props: { readonly message: string }): ReactNode {
  return (
    <Alert tone="warning" variant="ghost" size="sm">
      {props.message}
    </Alert>
  );
}

/** 칸 검사 실패의 한 줄. 칸 이름과 함께 말한다(목업의 칸 아래 오류 글) */
function ErrorNote(props: { readonly message: string | null }): ReactNode {
  if (props.message === null) return null;
  return (
    <p role="alert" className="m-0 text-ui-sm text-danger-text">
      {props.message}
    </p>
  );
}

/** 잠긴 이유의 한 줄(목업 LockNote): 자물쇠 아이콘과 글 하나 */
function LockLine(props: { readonly text: string }): ReactNode {
  return (
    <p className="m-0 flex min-w-0 items-center gap-1.5 text-ui-sm text-text-tertiary">
      <Lock aria-hidden className="size-icon-xs flex-none" />
      <span>{props.text}</span>
    </p>
  );
}

export function invalidTextOf(field: FieldName): string {
  return t("desktop.providers.invalid", { field: t(fieldIdOf(field)) });
}

// ── 사용량 (이 대화) ────────────────────────────────────────────────────

/** 사용량 패널의 자료. 읽는 중, 읽지 못함, 값이 있음을 나눈다 */
export type UsageLoad =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly gauges: readonly UsageGauge[] };

export interface UsagePanelViewProps {
  readonly load: UsageLoad;
  /** 연결이 끊겼으면 참. 마지막으로 읽은 값은 보이지 않는다 */
  readonly offline: boolean;
  /** 열린 대화가 있으면 참. 없으면 "이 대화"의 값이 없어 안내만 보인다 */
  readonly hasThread: boolean;
  readonly onRetry: () => void;
}

/** 사용량 패널(P-11 맨 위 블록, 목업 UsageSection). 게이지마다 막대와 글을 한 줄에 그린다 */
export function UsagePanelView(props: UsagePanelViewProps): ReactNode {
  return (
    <PanelBlock title={t("desktop.providers.usage.title")}>
      <UsageBody {...props} />
    </PanelBlock>
  );
}

function UsageBody(props: UsagePanelViewProps): ReactNode {
  const { load } = props;
  if (!props.hasThread) {
    return <EmptyState size="sm" surface="none" title={t("desktop.providers.usage.noThread")} />;
  }
  if (props.offline) {
    return <EmptyState size="sm" surface="none" title={t("desktop.providers.usage.offline")} />;
  }
  if (load.status === "loading") return <UsageSkeleton />;
  if (load.status === "failed") {
    return (
      <Alert
        tone="danger"
        layout="inline"
        action={
          <Button size="xs" variant="outline" onClick={props.onRetry}>
            {t("desktop.providers.usage.retry")}
          </Button>
        }
      >
        {load.message}
      </Alert>
    );
  }
  if (load.gauges.length === 0) {
    return <EmptyState size="sm" surface="none" title={t("desktop.providers.usage.empty")} />;
  }
  return (
    <ul className="m-0 grid list-none gap-1 p-0">
      {load.gauges.map((gauge) => (
        <li key={gauge.id}>
          <UsageRow gauge={gauge} />
        </li>
      ))}
    </ul>
  );
}

/** 읽는 중의 자리(목업 d03 D-loading): 줄 세 개. 읽는 중 글은 이름으로만 남는다 */
function UsageSkeleton(): ReactNode {
  return (
    <div
      role="status"
      aria-label={t("desktop.providers.usage.loading")}
      className="grid gap-3 py-1"
    >
      <Skeleton width="40%" height={12} />
      <Skeleton width="52%" height={12} />
      <Skeleton width="28%" height={12} />
    </div>
  );
}

function amountTextOf(unit: UsageUnit, amount: number): string {
  const ref = amountRefOf(unit, amount);
  return t(ref.id, ref.args);
}

/**
 * 게이지 한 줄(목업 Gauge). 이름, 막대, 쓴 양과 한도 글을 한 줄에 둔다. 한도를 모르면 막대 대신 빈 막대 자리와
 * "한도 모름"을 보인다(숫자를 지어내지 않는다). 재설정 시각은 알 때만 정보 아이콘 뒤에 있다. 줄의 이름은 스크린 리더 문장이다.
 */
function UsageRow(props: { readonly gauge: UsageGauge }): ReactNode {
  const { gauge } = props;
  const name = gauge.account === null ? gauge.providerId : `${gauge.providerId} ${gauge.account}`;
  const unit = t(unitIdOf(gauge.unit));
  const windowId = windowIdOf(gauge.window);
  const label =
    windowId === null
      ? t("desktop.providers.usage.label", { name, unit })
      : t("desktop.providers.usage.windowedLabel", { name, window: t(windowId), unit });
  const value = amountTextOf(gauge.unit, gauge.used);
  const limitText =
    gauge.limit === null
      ? t("desktop.providers.usage.limitUnknown")
      : t("desktop.providers.usage.limit", { limit: amountTextOf(gauge.unit, gauge.limit) });
  const resetText =
    gauge.resetsAt === null
      ? null
      : t("desktop.providers.usage.resets", {
          time: resetTextOf(gauge.resetsAt, activeLocale()),
        });
  const sentence = t("desktop.providers.usage.sentence", { label, value, limit: limitText });
  const fraction = usageFractionOf(gauge);
  return (
    <div
      role="group"
      aria-label={sentence}
      className="flex min-w-0 items-center gap-3 py-1 text-ui"
    >
      <span className="w-36 flex-none truncate text-text-secondary">{label}</span>
      {fraction === null ? (
        <span aria-hidden className="h-1 min-w-0 flex-1 rounded-full bg-neutral-soft" />
      ) : (
        <Progress className="min-w-0 flex-1" value={fraction} size="sm" decorative />
      )}
      <span className="flex flex-none items-center gap-2 tabular-nums">
        <span className="font-mono text-mono text-text-primary">{value}</span>
        <span className="text-ui-sm text-text-tertiary">{limitText}</span>
        {resetText === null ? null : <InfoTip text={resetText} />}
      </span>
    </div>
  );
}

// ── 계정 회전 행 ─────────────────────────────────────────────────────────

/** 회전 행의 자료. `state`가 null이면 엔진 카탈로그에 설정 값이 없다는 뜻이다 */
export interface RotationRowViewProps {
  readonly state: RotationState | null;
  /** 위험 고지 문장(client `modelAccountsView().rotation.notice`) */
  readonly notice: string;
  readonly editable: boolean;
  /** 바꿀 수 없는 이유의 문장. 바꿀 수 있으면 null */
  readonly lockedText: string | null;
  /** 마지막 저장 오류의 문장. 없으면 null */
  readonly error: string | null;
  /** 위험 확인 대화 상자가 열려 있는가 */
  readonly asking: boolean;
  readonly onToggle: (next: boolean) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * 계정 회전 행(P-11, 목업 계정 회전 줄). 글 제목, 스위치, 그리고 회전이 도는 `on`에서만 "위험 확인함" 배지다.
 * 고지에 동의하지 않은 채 켜면 위험 확인 대화 상자(caustic `Dialog kind="alert"`)가 먼저 뜬다.
 */
export function RotationRowView(props: RotationRowViewProps): ReactNode {
  const { state, editable } = props;
  const title = t("desktop.providers.rotation.title");
  return (
    <div data-slot="rotation-row" className="grid gap-1.5">
      {/* 섹션 제목(설정의 패널 머리)이 이미 같은 글이라 눈에는 한 번만 보이고, 읽기 도구에는 이름으로 남는다(rtE R-6b) */}
      <span className="sr-only">{title}</span>
      <Switch
        size="sm"
        aria-label={title}
        checked={state === "on"}
        disabled={!editable}
        onCheckedChange={(next) => {
          props.onToggle(next);
        }}
      />
      {state === "on" ? (
        <p className="m-0 flex items-center gap-2 text-ui-sm text-text-tertiary">
          <Badge size="sm" className={TONE_CLASS.warning} icon={<TriangleAlert />}>
            {t("desktop.providers.rotation.acknowledged")}
          </Badge>
        </p>
      ) : null}
      {state === "needsNotice" ? (
        <Alert tone="warning" variant="ghost" size="sm">
          {t("desktop.providers.rotation.warning")}
        </Alert>
      ) : null}
      {props.lockedText === null ? null : <LockLine text={props.lockedText} />}
      {props.error === null ? null : (
        <p role="alert" className="m-0 text-ui-sm text-danger-text">
          {props.error}
        </p>
      )}
      <Dialog
        kind="alert"
        size="sm"
        tone="warning"
        open={props.asking}
        onOpenChange={(open) => {
          if (!open) props.onCancel();
        }}
        title={t("desktop.providers.rotation.confirm.title")}
        description={props.notice}
        footer={
          <>
            <DialogClose asChild>
              <Button size="sm" variant="outline" autoFocus>
                {t("desktop.providers.rotation.confirm.cancel")}
              </Button>
            </DialogClose>
            <Button size="sm" variant="solid" onClick={props.onConfirm}>
              {t("desktop.providers.rotation.confirm.accept")}
            </Button>
          </>
        }
      />
    </div>
  );
}

// ── 계정 풀 ──────────────────────────────────────────────────────────────

export interface AccountDraft {
  readonly provider: string;
  readonly accountId: string;
  readonly credential: string;
  readonly priority: number;
  readonly reservePct: number;
}

export const EMPTY_ACCOUNT_DRAFT: AccountDraft = {
  provider: "",
  accountId: "",
  credential: "",
  priority: 100,
  reservePct: 0,
};

export interface AccountPoolViewProps {
  readonly pools: readonly ProviderPool[];
  readonly expanded: ReadonlySet<string>;
  readonly editable: boolean;
  readonly draft: AccountDraft;
  readonly error: string | null;
  readonly onDraft: (next: AccountDraft) => void;
  readonly onAdd: () => void;
  readonly onExpand: (provider: string) => void;
  readonly onMove: (provider: string, orderedIds: readonly string[]) => void;
  readonly onPriority: (entry: AccountEntry, priority: number) => void;
  /** 예비율 칸을 바꿨다. 검사는 화면이 한다(`onPriority`와 같은 길) */
  readonly onReserve: (entry: AccountEntry, reservePct: number) => void;
  readonly onRemove: (entry: AccountEntry) => void;
}

export function AccountPoolView(props: AccountPoolViewProps): ReactNode {
  const { pools, editable } = props;
  // 계정이 하나도 없으면 입력 칸 대신 빈 상태를 보이고, "계정 추가"를 누르면 칸이 열린다(시안 d03 D-empty)
  const [adding, setAdding] = useState(false);
  const formShown = pools.length > 0 || adding;
  return (
    <div className="grid">
      {pools.length === 0 ? (
        <EmptyState
          size="sm"
          surface="none"
          title={t("desktop.providers.pool.empty")}
          actions={
            formShown ? undefined : (
              <Button
                size="xs"
                variant="outline"
                disabled={!editable}
                onClick={() => {
                  setAdding(true);
                }}
              >
                {t("desktop.providers.pool.add")}
              </Button>
            )
          }
        />
      ) : (
        pools.map((pool) => <PoolGroup key={pool.provider} pool={pool} {...props} />)
      )}
      {formShown ? (
        <AccountAddForm
          draft={props.draft}
          editable={editable}
          onDraft={props.onDraft}
          onAdd={props.onAdd}
        />
      ) : null}
      <ErrorNote message={props.error} />
    </div>
  );
}

function PoolGroup(props: AccountPoolViewProps & { readonly pool: ProviderPool }): ReactNode {
  const { pool, expanded, editable } = props;
  const fold = foldOf(pool.accounts, expanded.has(pool.provider));
  const items: OrderedItem[] = fold.shown.map((entry) => ({
    id: entry.accountId,
    title: entry.accountId,
    detail: <span className="font-mono text-mono-sm text-text-tertiary">{entry.credential}</span>,
    end: (
      <AccountCells
        entry={entry}
        editable={editable}
        onPriority={props.onPriority}
        onReserve={props.onReserve}
        onRemove={props.onRemove}
      />
    ),
  }));
  return (
    <PanelBlock title={pool.provider}>
      <OrderedList
        label={t("desktop.providers.pool.listLabel", { provider: pool.provider })}
        items={items}
        editable={editable}
        onMove={(order) => {
          props.onMove(pool.provider, order);
        }}
      />
      {fold.hidden === 0 ? null : (
        <div className="flex items-center gap-2">
          <span className="text-ui-sm text-text-tertiary">
            {t("desktop.providers.pool.hidden", { count: fold.hidden })}
          </span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              props.onExpand(pool.provider);
            }}
          >
            {t("desktop.providers.pool.expand")}
          </Button>
        </div>
      )}
    </PanelBlock>
  );
}

/** 계정 한 줄의 끝 칸(목업 AccountGrid의 우선, 예비 %, 메뉴). 메뉴에는 지우기만 있다 */
function AccountCells(props: {
  readonly entry: AccountEntry;
  readonly editable: boolean;
  readonly onPriority: (entry: AccountEntry, priority: number) => void;
  readonly onReserve: (entry: AccountEntry, reservePct: number) => void;
  readonly onRemove: (entry: AccountEntry) => void;
}): ReactNode {
  const { entry, editable } = props;
  return (
    <span className="flex items-center gap-2">
      <span className="text-ui-sm text-text-tertiary">{t("desktop.providers.field.priority")}</span>
      <NumberField
        size="xs"
        containerClassName="w-24"
        aria-label={`${entry.accountId} ${t("desktop.providers.field.priority")}`}
        value={entry.priority}
        min={0}
        max={1000}
        step={1}
        commitMode="release"
        disabled={!editable}
        onValueChange={(next) => {
          props.onPriority(entry, next);
        }}
      />
      <span className="text-ui-sm text-text-tertiary">
        {t("desktop.providers.field.reservePct")}
      </span>
      <NumberField
        size="xs"
        unit="%"
        containerClassName="w-24"
        aria-label={`${entry.accountId} ${t("desktop.providers.field.reservePct")}`}
        value={entry.reservePct}
        min={0}
        max={100}
        step={1}
        commitMode="release"
        disabled={!editable}
        onValueChange={(next) => {
          props.onReserve(entry, next);
        }}
      />
      <Menu
        align="end"
        trigger={
          <IconButton
            size="xs"
            variant="ghost"
            label={t("desktop.providers.pool.menu", { account: entry.accountId })}
            disabled={!editable}
          >
            <Ellipsis />
          </IconButton>
        }
      >
        <MenuItem
          tone="danger"
          onSelect={() => {
            props.onRemove(entry);
          }}
        >
          {t("desktop.providers.pool.remove")}
        </MenuItem>
      </Menu>
    </span>
  );
}

function AccountAddForm(props: {
  readonly draft: AccountDraft;
  readonly editable: boolean;
  readonly onDraft: (next: AccountDraft) => void;
  readonly onAdd: () => void;
}): ReactNode {
  const { draft, editable, onDraft } = props;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        size="sm"
        aria-label={t("desktop.providers.field.provider")}
        placeholder={t("desktop.providers.field.provider")}
        value={draft.provider}
        disabled={!editable}
        onValueChange={(next) => {
          onDraft({ ...draft, provider: next });
        }}
      />
      <Input
        size="sm"
        aria-label={t("desktop.providers.field.accountId")}
        placeholder={t("desktop.providers.field.accountId")}
        value={draft.accountId}
        disabled={!editable}
        onValueChange={(next) => {
          onDraft({ ...draft, accountId: next });
        }}
      />
      <Input
        size="sm"
        aria-label={t("desktop.providers.field.credential")}
        placeholder="secret://"
        value={draft.credential}
        disabled={!editable}
        onValueChange={(next) => {
          onDraft({ ...draft, credential: next });
        }}
      />
      <NumberField
        size="sm"
        appearance="stepper"
        containerClassName="w-36"
        commitMode="release"
        aria-label={t("desktop.providers.field.priority")}
        value={draft.priority}
        min={0}
        max={1000}
        step={1}
        disabled={!editable}
        onValueChange={(next) => {
          onDraft({ ...draft, priority: next });
        }}
      />
      <NumberField
        size="sm"
        appearance="stepper"
        containerClassName="w-36"
        commitMode="release"
        aria-label={t("desktop.providers.field.reservePct")}
        value={draft.reservePct}
        min={0}
        max={100}
        step={1}
        disabled={!editable}
        onValueChange={(next) => {
          onDraft({ ...draft, reservePct: next });
        }}
      />
      <Button size="xs" variant="ghost" disabled={!editable} onClick={props.onAdd}>
        {t("desktop.providers.pool.add")}
      </Button>
    </div>
  );
}

// ── 레이트 리밋 표 ──────────────────────────────────────────────────────

export interface RateLimitViewProps {
  readonly rows: readonly RateRow[];
  readonly editable: boolean;
  readonly draftProvider: string;
  readonly error: string | null;
  readonly onDraftProvider: (next: string) => void;
  readonly onAdd: () => void;
  readonly onChange: (provider: string, patch: Partial<RateLimitEntry>) => void;
  readonly onRemove: (provider: string) => void;
}

/** 레이트 리밋 표(목업 RateRow). 머리 줄과 provider마다 한 줄: 간격, 한도 도달 시, 최대 대기, 지우기 */
export function RateLimitView(props: RateLimitViewProps): ReactNode {
  const { rows, editable } = props;
  return (
    <div className="grid gap-2">
      {rows.length === 0 ? (
        <EmptyState size="sm" surface="none" title={t("desktop.providers.rate.empty")} />
      ) : (
        <div
          role="table"
          aria-label={t("desktop.providers.rate.table")}
          className="grid overflow-x-auto"
        >
          <div role="row" className="flex items-center gap-2 pb-1 text-ui-sm text-text-tertiary">
            <span role="columnheader" className="w-28 flex-none">
              {t("desktop.providers.field.provider")}
            </span>
            <span role="columnheader" className="w-32 flex-none">
              {t("desktop.providers.field.minIntervalMs")}
            </span>
            <span role="columnheader" className="w-28 flex-none">
              {t("desktop.providers.field.onLimit")}
            </span>
            <span role="columnheader" className="w-36 flex-none">
              {t("desktop.providers.field.maxWaitMs")}
            </span>
            <span role="columnheader" className="w-7 flex-none">
              <span className="sr-only">{t("desktop.providers.rate.remove")}</span>
            </span>
          </div>
          {rows.map((row) => (
            <div key={row.provider} role="row" className="flex items-center gap-2 py-0.5">
              <span
                role="cell"
                className="w-28 flex-none truncate font-mono text-mono text-text-primary"
              >
                {row.provider}
              </span>
              <span role="cell" className="w-32 flex-none">
                <NumberField
                  size="xs"
                  unit="ms"
                  commitMode="release"
                  aria-label={`${row.provider} ${t("desktop.providers.field.minIntervalMs")}`}
                  value={row.policy.minIntervalMs}
                  min={0}
                  max={3_600_000}
                  step={100}
                  disabled={!editable}
                  onValueChange={(next) => {
                    props.onChange(row.provider, { minIntervalMs: next });
                  }}
                />
              </span>
              <span role="cell" className="w-28 flex-none">
                <Select
                  size="xs"
                  className="w-full"
                  aria-label={`${row.provider} ${t("desktop.providers.field.onLimit")}`}
                  value={row.policy.onLimit}
                  disabled={!editable}
                  onValueChange={(next) => {
                    const action = ON_LIMIT_ACTIONS.find((candidate) => candidate === next);
                    if (action !== undefined) props.onChange(row.provider, { onLimit: action });
                  }}
                >
                  {ON_LIMIT_ACTIONS.map((action) => (
                    <SelectOption key={action} value={action}>
                      {t(onLimitIdOf(action))}
                    </SelectOption>
                  ))}
                </Select>
              </span>
              <span role="cell" className="w-36 flex-none">
                <NumberField
                  size="xs"
                  unit="ms"
                  commitMode="release"
                  aria-label={`${row.provider} ${t("desktop.providers.field.maxWaitMs")}`}
                  value={row.policy.maxWaitMs}
                  min={0}
                  max={3_600_000}
                  step={1000}
                  disabled={!editable}
                  onValueChange={(next) => {
                    props.onChange(row.provider, { maxWaitMs: next });
                  }}
                />
              </span>
              <IconButton
                size="xs"
                variant="ghost"
                label={`${row.provider} ${t("desktop.providers.rate.remove")}`}
                disabled={!editable}
                onClick={() => {
                  props.onRemove(row.provider);
                }}
              >
                <X />
              </IconButton>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          size="sm"
          aria-label={t("desktop.providers.field.provider")}
          placeholder={t("desktop.providers.field.provider")}
          value={props.draftProvider}
          disabled={!editable}
          onValueChange={props.onDraftProvider}
        />
        <Button size="xs" variant="ghost" disabled={!editable} onClick={props.onAdd}>
          {t("desktop.providers.rate.add")}
        </Button>
        <InfoTip text={t("desktop.providers.rate.defaultNote")} />
      </div>
      <ErrorNote message={props.error} />
    </div>
  );
}

// ── 모델 역할과 대체 사슬 ─────────────────────────────────────────────

/** 역할 하나의 모델 칸. 글은 고르고 떠날 때(또는 Enter) 보낸다. 값이 바뀌면 줄을 새로 만든다(key) */
function RoleRow(props: {
  readonly role: RoleId;
  readonly value: string;
  readonly editable: boolean;
  readonly onCommit: (role: RoleId, text: string) => void;
}): ReactNode {
  const { role, editable } = props;
  return (
    <label className="flex flex-wrap items-center gap-2">
      <span className="w-28 text-ui-sm text-text-secondary">{t(roleIdOf(role))}</span>
      <Input
        size="sm"
        aria-label={t(roleIdOf(role))}
        placeholder={t("desktop.providers.roles.default")}
        defaultValue={props.value}
        disabled={!editable}
        onBlur={(event) => {
          props.onCommit(role, event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") props.onCommit(role, event.currentTarget.value);
        }}
      />
    </label>
  );
}

export interface RoleRefsViewProps {
  readonly refs: RoleRefs;
  readonly editable: boolean;
  readonly error: string | null;
  readonly onCommit: (role: RoleId, text: string) => void;
}

export function RoleRefsView(props: RoleRefsViewProps): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      {ROLE_IDS.map((role) => (
        <RoleRow
          key={`${role}:${props.refs[role] ?? ""}`}
          role={role}
          value={props.refs[role] ?? ""}
          editable={props.editable}
          onCommit={props.onCommit}
        />
      ))}
      <ErrorNote message={props.error} />
    </div>
  );
}

export interface ChainMapViewProps {
  readonly chains: ChainMap;
  readonly editable: boolean;
  readonly error: string | null;
  readonly onChange: (role: RoleId, items: readonly string[]) => void;
}

export function ChainMapView(props: ChainMapViewProps): ReactNode {
  const { chains, editable } = props;
  const empty = ROLE_IDS.every((role) => (chains[role] ?? []).length === 0);
  return (
    <div className="flex flex-col gap-2">
      {empty ? (
        <EmptyState size="sm" surface="none" title={t("desktop.providers.chain.empty")} />
      ) : null}
      {ROLE_IDS.map((role) => (
        <div key={role} className="flex flex-wrap items-start gap-2">
          <span className="w-28 pt-2 text-ui-sm text-text-secondary">{t(roleIdOf(role))}</span>
          <LocalizedTagInput
            aria-label={t(roleIdOf(role))}
            value={[...(chains[role] ?? [])]}
            disabled={!editable}
            onValueChange={(next) => {
              props.onChange(role, next);
            }}
          />
        </div>
      ))}
      <ErrorNote message={props.error} />
    </div>
  );
}

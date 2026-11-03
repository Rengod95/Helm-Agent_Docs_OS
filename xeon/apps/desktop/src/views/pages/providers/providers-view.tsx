import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  Input,
  NumberField,
  Progress,
  Select,
  SelectOption,
  Skeleton,
  Switch,
  TagInput,
} from "@caustic/react";
import { TriangleAlert } from "@caustic/react/icons";
import { activeLocale, t } from "@fresnel/client/i18n";
import type { AccountEntry, RateLimitEntry, RotationState } from "@fresnel/client";
import type { UsageGauge, UsageUnit } from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import { TONE_CLASS } from "../settings/settings-text.ts";
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
  rotationStateIdOf,
  unitIdOf,
  windowIdOf,
  type FieldName,
} from "./providers-text.ts";

// 계정과 제공자, 예산과 한도 화면(P-11)의 그림. 상태는 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 값은 `providers-screen.tsx`가 검사해서 넘기고, 이 그림은 보여 주고 콜백을 부를 뿐이다.

/** 읽을 수 없는 값의 안내. 그 항목은 고칠 수 없고 파일로 본다 */
export function UnreadableNote(props: { readonly message: string }): ReactNode {
  return (
    <Alert tone="warning" variant="ghost" size="sm">
      {props.message}
    </Alert>
  );
}

/** 칸 검사 실패의 한 줄. 칸 이름과 함께 말한다 */
function ErrorNote(props: { readonly message: string | null }): ReactNode {
  if (props.message === null) return null;
  return (
    <Alert tone="warning" variant="ghost" size="sm">
      {props.message}
    </Alert>
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

/** 사용량 (이 대화) 패널(P-11 맨 위 블록). 게이지마다 caustic `Progress`와 글을 함께 그린다 */
export function UsagePanelView(props: UsagePanelViewProps): ReactNode {
  return (
    <div className="flex flex-col gap-2" data-slot="usage-panel">
      <span className="text-ui-strong text-text-primary">{t("desktop.providers.usage.title")}</span>
      <UsageBody {...props} />
    </div>
  );
}

function UsageBody(props: UsagePanelViewProps): ReactNode {
  const { load } = props;
  if (!props.hasThread) {
    return <p className="text-ui-sm text-text-tertiary">{t("desktop.providers.usage.noThread")}</p>;
  }
  if (props.offline) return <Alert tone="info">{t("desktop.providers.usage.offline")}</Alert>;
  if (load.status === "loading") {
    return (
      <div className="flex flex-col gap-2">
        <p role="status" className="text-ui-sm text-text-tertiary">
          {t("desktop.providers.usage.loading")}
        </p>
        <Skeleton height={40} />
      </div>
    );
  }
  if (load.status === "failed") {
    return (
      <Alert
        tone="danger"
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
    return <p className="text-ui-sm text-text-tertiary">{t("desktop.providers.usage.empty")}</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {load.gauges.map((gauge) => (
        <li key={gauge.id}>
          <UsageRow gauge={gauge} />
        </li>
      ))}
    </ul>
  );
}

function amountTextOf(unit: UsageUnit, amount: number): string {
  const ref = amountRefOf(unit, amount);
  return t(ref.id, ref.args);
}

/**
 * 게이지 한 줄. 이름과 단위, 쓴 양, 막대, 한도와 재설정 시각(알 때만)을 보인다. 막대의 이름은 스크린 리더 문장이다
 * ("anthropic 토큰 41천, 한도 모름"). 한도와 재설정 시각을 모두 모르면 그 사실을 한 문장으로 말한다.
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
      ? null
      : t("desktop.providers.usage.limit", { limit: amountTextOf(gauge.unit, gauge.limit) });
  const resetText =
    gauge.resetsAt === null
      ? null
      : t("desktop.providers.usage.resets", {
          time: resetTextOf(gauge.resetsAt, activeLocale()),
        });
  const sentence = t("desktop.providers.usage.sentence", {
    label,
    value,
    limit: limitText ?? t("desktop.providers.usage.limitUnknown"),
  });
  const details = [limitText, resetText].filter((text): text is string => text !== null);
  const fraction = usageFractionOf(gauge);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-ui-sm text-text-primary">{label}</span>
        <span className="text-ui-sm text-text-secondary">{value}</span>
      </div>
      <Progress
        size="sm"
        value={fraction ?? undefined}
        indeterminate={fraction === null}
        label={sentence}
      />
      <p className="text-ui-sm text-text-tertiary">
        {details.length === 0 ? t("desktop.providers.usage.unknown") : details.join(" · ")}
      </p>
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

const ROTATION_TONE: Readonly<Record<RotationState, keyof typeof TONE_CLASS>> = {
  off: "neutral",
  needsNotice: "warning",
  on: "success",
};

/**
 * 계정 회전 행(P-11). 스위치는 회전이 도는 `on`에서만 켜져 있다. 고지에 동의하지 않은 채 켜면
 * 위험 확인 대화 상자(caustic `Dialog kind="alert"`)가 먼저 뜬다.
 */
export function RotationRowView(props: RotationRowViewProps): ReactNode {
  const { state, editable } = props;
  const title = t("desktop.providers.rotation.title");
  return (
    <div data-slot="rotation-row" className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ui-strong text-text-primary">{title}</span>
        {state === null ? null : (
          <Badge className={TONE_CLASS[ROTATION_TONE[state]]}>{t(rotationStateIdOf(state))}</Badge>
        )}
        <Switch
          aria-label={title}
          checked={state === "on"}
          disabled={!editable}
          onCheckedChange={(next) => {
            props.onToggle(next);
          }}
        />
      </div>
      {state === "needsNotice" ? (
        <Alert tone="warning" variant="ghost" size="sm">
          {t("desktop.providers.rotation.warning")}
        </Alert>
      ) : null}
      {props.lockedText === null ? null : (
        <p className="text-ui-sm text-text-tertiary">{props.lockedText}</p>
      )}
      {props.error === null ? null : (
        <Alert tone="warning" variant="ghost" size="sm">
          {props.error}
        </Alert>
      )}
      <Dialog
        kind="alert"
        open={props.asking}
        onOpenChange={(open) => {
          if (!open) props.onCancel();
        }}
        icon={<TriangleAlert />}
        title={t("desktop.providers.rotation.confirm.title")}
        description={props.notice}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline" size="sm" autoFocus>
                {t("desktop.providers.rotation.confirm.cancel")}
              </Button>
            </DialogClose>
            <DialogAction onClick={props.onConfirm}>
              {t("desktop.providers.rotation.confirm.accept")}
            </DialogAction>
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
  readonly onRemove: (entry: AccountEntry) => void;
}

export function AccountPoolView(props: AccountPoolViewProps): ReactNode {
  const { pools, editable } = props;
  return (
    <div className="flex flex-col gap-3">
      {pools.length === 0 ? (
        <p className="text-ui-sm text-text-tertiary">{t("desktop.providers.pool.empty")}</p>
      ) : (
        pools.map((pool) => <PoolGroup key={pool.provider} pool={pool} {...props} />)
      )}
      <AccountAddForm
        draft={props.draft}
        editable={editable}
        onDraft={props.onDraft}
        onAdd={props.onAdd}
      />
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
    detail: t("desktop.providers.pool.detail", {
      credential: entry.credential,
      reservePct: entry.reservePct,
    }),
    end: (
      <span className="flex items-center gap-2">
        <NumberField
          appearance="stepper"
          commitMode="release"
          aria-label={t("desktop.providers.field.priority")}
          value={entry.priority}
          min={0}
          max={1000}
          step={1}
          disabled={!editable}
          onValueChange={(next) => {
            props.onPriority(entry, next);
          }}
        />
        <Button
          size="xs"
          variant="outline"
          disabled={!editable}
          onClick={() => {
            props.onRemove(entry);
          }}
        >
          {t("desktop.providers.pool.remove")}
        </Button>
      </span>
    ),
  }));
  return (
    <div className="flex flex-col gap-2">
      <span className="text-ui-strong text-text-primary">{pool.provider}</span>
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
            variant="outline"
            onClick={() => {
              props.onExpand(pool.provider);
            }}
          >
            {t("desktop.providers.pool.expand")}
          </Button>
        </div>
      )}
    </div>
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
    <div className="flex flex-col gap-2">
      <span className="text-ui-sm text-text-secondary">{t("desktop.providers.pool.add")}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t("desktop.providers.field.provider")}
          placeholder={t("desktop.providers.field.provider")}
          value={draft.provider}
          disabled={!editable}
          onValueChange={(next) => {
            onDraft({ ...draft, provider: next });
          }}
        />
        <Input
          aria-label={t("desktop.providers.field.accountId")}
          placeholder={t("desktop.providers.field.accountId")}
          value={draft.accountId}
          disabled={!editable}
          onValueChange={(next) => {
            onDraft({ ...draft, accountId: next });
          }}
        />
        <Input
          aria-label={t("desktop.providers.field.credential")}
          placeholder="secret://"
          value={draft.credential}
          disabled={!editable}
          onValueChange={(next) => {
            onDraft({ ...draft, credential: next });
          }}
        />
        <NumberField
          appearance="stepper"
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
          appearance="stepper"
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
        <Button size="sm" variant="outline" disabled={!editable} onClick={props.onAdd}>
          {t("desktop.providers.pool.add")}
        </Button>
      </div>
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

export function RateLimitView(props: RateLimitViewProps): ReactNode {
  const { rows, editable } = props;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ui-sm text-text-tertiary">{t("desktop.providers.rate.defaultNote")}</p>
      {rows.length === 0 ? (
        <p className="text-ui-sm text-text-tertiary">{t("desktop.providers.rate.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.provider} className="flex flex-wrap items-center gap-2">
              <span className="w-32 text-ui-strong text-text-primary">{row.provider}</span>
              <NumberField
                appearance="stepper"
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
              <Select
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
              <NumberField
                appearance="stepper"
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
              <Button
                size="xs"
                variant="outline"
                disabled={!editable}
                onClick={() => {
                  props.onRemove(row.provider);
                }}
              >
                {t("desktop.providers.rate.remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t("desktop.providers.field.provider")}
          placeholder={t("desktop.providers.field.provider")}
          value={props.draftProvider}
          disabled={!editable}
          onValueChange={props.onDraftProvider}
        />
        <Button size="sm" variant="outline" disabled={!editable} onClick={props.onAdd}>
          {t("desktop.providers.rate.add")}
        </Button>
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
        <p className="text-ui-sm text-text-tertiary">{t("desktop.providers.chain.empty")}</p>
      ) : null}
      {ROLE_IDS.map((role) => (
        <div key={role} className="flex flex-wrap items-start gap-2">
          <span className="w-28 pt-2 text-ui-sm text-text-secondary">{t(roleIdOf(role))}</span>
          <TagInput
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

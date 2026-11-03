import { Alert, Button, Input, NumberField, Select, SelectOption, TagInput } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { AccountEntry, RateLimitEntry } from "@fresnel/client";
import type { GaugeSlotVM } from "@fresnel/client/settings";
import type { ReactNode } from "react";
import { OrderedList, type OrderedItem } from "../shared/ordered-list.tsx";
import {
  ON_LIMIT_ACTIONS,
  ROLE_IDS,
  foldOf,
  type ChainMap,
  type ProviderPool,
  type RateRow,
  type RoleRefs,
  type RoleId,
} from "./providers-model.ts";
import { fieldIdOf, onLimitIdOf, roleIdOf, type FieldName } from "./providers-text.ts";

// 계정과 제공자, 예산과 한도 화면(P-11)의 그림. 상태는 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 값은 `providers-screen.tsx`가 검사해서 넘기고, 이 그림은 보여 주고 콜백을 부를 뿐이다.

/** 사용량 게이지 자리. M3에서는 `unavailable`만 있어 글만 보인다(L4.settings-ui §4.7) */
export function GaugeSlotView(props: { readonly gauge: GaugeSlotVM }): ReactNode {
  return (
    <p role="status" data-slot="gauge-slot" className="text-ui-sm text-text-tertiary">
      {props.gauge.text}
    </p>
  );
}

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

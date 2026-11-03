import {
  checkAccount,
  checkRateLimit,
  DEFAULT_RATE_LIMIT_POLICY,
  readAccounts,
  readRateLimit,
  withAccount,
  withoutAccount,
  withRateLimit,
  withoutRateLimit,
  type AccountEntry,
  type RateLimitEntry,
} from "@fresnel/client";
import { t } from "@fresnel/client/i18n";
import { checkModelRef } from "@fresnel/client/settings";
import { useState, type ReactNode } from "react";
import type { DedicatedEditorProps, DedicatedEditors } from "../settings/settings-field.tsx";
import {
  FALLBACK_MAX,
  chainsOf,
  isProviderId,
  poolsOf,
  rateRowsOf,
  reprioritizedOf,
  roleRefsOf,
  withChain,
  withRoleRef,
  type RoleId,
} from "./providers-model.ts";
import {
  AccountPoolView,
  ChainMapView,
  EMPTY_ACCOUNT_DRAFT,
  RateLimitView,
  RoleRefsView,
  UnreadableNote,
  invalidTextOf,
  type AccountDraft,
} from "./providers-view.tsx";

// 계정과 제공자, 예산과 한도 화면(P-11)의 편집기. 설정 항목 한 줄이 전용 편집기로 그리는 자리에 들어간다(`settings-field.tsx`).
// 모든 편집기는 초안만 바꾼다(`handlers.edit`). 저장과 되돌리기는 항목 아래의 줄이 한다(P-09 초안 흐름, `settings.set` 한 번).
// 칸 검사에서 떨어진 값은 초안에 넣지 않고 그 칸 이름과 함께 문장으로 말한다. 읽을 수 없는 값은 고치지 못하게 막는다.

/** 계정 풀(`l1.models.accounts`). 계정마다 우선순위와 지우기, provider 안의 끌기와 ↑·↓ 순서 바꾸기, 새 계정 추가 */
function AccountPoolEditor(props: DedicatedEditorProps): ReactNode {
  const { field, editable, handlers } = props;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [draft, setDraft] = useState<AccountDraft>(EMPTY_ACCOUNT_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const read = readAccounts(field.value);
  if (!read.ok) return <UnreadableNote message={t("desktop.providers.pool.unreadable")} />;
  const list = read.value;
  const write = (next: readonly AccountEntry[]): void => {
    setError(null);
    handlers.edit(field.key, next);
  };
  return (
    <AccountPoolView
      pools={poolsOf(list)}
      expanded={expanded}
      editable={editable}
      draft={draft}
      error={error}
      onDraft={setDraft}
      onAdd={() => {
        const checked = checkAccount(draft);
        if (!checked.ok) {
          setError(invalidTextOf(checked.error.field));
          return;
        }
        write(withAccount(list, checked.value));
        setDraft(EMPTY_ACCOUNT_DRAFT);
      }}
      onExpand={(provider) => {
        setExpanded((prev) => new Set([...prev, provider]));
      }}
      onMove={(provider, order) => {
        write(reprioritizedOf(list, provider, order));
      }}
      onPriority={(entry, priority) => {
        const checked = checkAccount({ ...entry, priority });
        if (!checked.ok) {
          setError(invalidTextOf(checked.error.field));
          return;
        }
        write(withAccount(list, checked.value));
      }}
      onRemove={(entry: AccountEntry) => {
        write(withoutAccount(list, entry.provider, entry.accountId));
      }}
    />
  );
}

/** 레이트 리밋 표(`l1.models.rateLimit`). 정책 없는 provider는 간격 0, 전환, 대기 0이다 */
function RateLimitEditor(props: DedicatedEditorProps): ReactNode {
  const { field, editable, handlers } = props;
  const [draftProvider, setDraftProvider] = useState("");
  const [error, setError] = useState<string | null>(null);
  const read = readRateLimit(field.value);
  if (!read.ok) return <UnreadableNote message={t("desktop.providers.rate.unreadable")} />;
  const map = read.value;
  const write = (next: Readonly<Record<string, RateLimitEntry>>): void => {
    setError(null);
    handlers.edit(field.key, next);
  };
  return (
    <RateLimitView
      rows={rateRowsOf(map)}
      editable={editable}
      draftProvider={draftProvider}
      error={error}
      onDraftProvider={setDraftProvider}
      onAdd={() => {
        if (!isProviderId(draftProvider)) {
          setError(invalidTextOf("provider"));
          return;
        }
        if (Object.hasOwn(map, draftProvider)) {
          setError(t("desktop.providers.rate.exists"));
          return;
        }
        write(withRateLimit(map, draftProvider, {}));
        setDraftProvider("");
      }}
      onChange={(provider, patch) => {
        const checked = checkRateLimit(patch, map[provider] ?? DEFAULT_RATE_LIMIT_POLICY);
        if (!checked.ok) {
          setError(invalidTextOf(checked.error.field));
          return;
        }
        write(withRateLimit(map, provider, checked.value));
      }}
      onRemove={(provider) => {
        write(withoutRateLimit(map, provider));
      }}
    />
  );
}

/** 모델 역할 맵(역할 → 모델 참조). 칸을 떠나면 검사하고 초안에 넣는다. 비우면 그 역할은 기본 모델을 쓴다 */
function ModelRolesEditor(props: DedicatedEditorProps): ReactNode {
  const { field, editable, handlers } = props;
  const [error, setError] = useState<string | null>(null);
  const refs = roleRefsOf(field.value);
  if (refs === null) return <UnreadableNote message={t("desktop.providers.roles.unreadable")} />;
  return (
    <RoleRefsView
      refs={refs}
      editable={editable}
      error={error}
      onCommit={(role: RoleId, text: string) => {
        const trimmed = text.trim();
        if (trimmed === (refs[role] ?? "")) return;
        if (trimmed === "") {
          setError(null);
          handlers.edit(field.key, withRoleRef(refs, role, null));
          return;
        }
        const checked = checkModelRef(trimmed);
        if (!checked.ok) {
          setError(invalidTextOf("model"));
          return;
        }
        setError(null);
        handlers.edit(field.key, withRoleRef(refs, role, checked.value));
      }}
    />
  );
}

/** 대체 사슬 맵(역할 → 대체 모델 목록, 역할마다 최대 셋). 목록을 바꾸면 모든 참조를 검사한다 */
function FallbackChainEditor(props: DedicatedEditorProps): ReactNode {
  const { field, editable, handlers } = props;
  const [error, setError] = useState<string | null>(null);
  const chains = chainsOf(field.value);
  if (chains === null) return <UnreadableNote message={t("desktop.providers.chain.unreadable")} />;
  return (
    <ChainMapView
      chains={chains}
      editable={editable}
      error={error}
      onChange={(role, items) => {
        if (items.length > FALLBACK_MAX) {
          setError(t("desktop.providers.chain.max", { count: FALLBACK_MAX }));
          return;
        }
        const values: string[] = [];
        for (const item of items) {
          const checked = checkModelRef(item);
          if (!checked.ok) {
            setError(invalidTextOf("model"));
            return;
          }
          values.push(checked.value);
        }
        setError(null);
        handlers.edit(field.key, withChain(chains, role, values));
      }}
    />
  );
}

/** 이 화면이 맡는 전용 편집기. 설정 화면의 `editors`로 넘긴다 */
export const PROVIDER_EDITORS: DedicatedEditors = {
  accountPool: AccountPoolEditor,
  rateLimit: RateLimitEditor,
  modelRoles: ModelRolesEditor,
  fallbackChain: FallbackChainEditor,
};

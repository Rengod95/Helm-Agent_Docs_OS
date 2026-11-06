import {
  ACCOUNTS_KEY,
  RATE_LIMIT_KEY,
  ROTATION_ACK_KEY,
  checkAccount,
  checkRateLimit,
  DEFAULT_RATE_LIMIT_POLICY,
  modelAccountsView,
  readAccounts,
  readRateLimit,
  rotationRiskNotice,
  withAccount,
  withoutAccount,
  withRateLimit,
  withoutRateLimit,
  type AccountEntry,
  type RateLimitEntry,
} from "@fresnel/client";
import { t } from "@fresnel/client/i18n";
import { checkModelRef, type SettingsView } from "@fresnel/client/settings";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useCommands } from "../../commands.ts";
import type {
  DedicatedEditorProps,
  DedicatedEditors,
  FieldHandlers,
} from "../settings/settings-field.tsx";
import { allFieldsOf } from "../settings/settings-model.ts";
import {
  FALLBACK_MAX,
  ROTATION_ENABLED_KEY,
  chainsOf,
  fieldOfKey,
  isProviderId,
  poolsOf,
  rateRowsOf,
  reprioritizedOf,
  roleRefsOf,
  rotationConfirmOf,
  rotationStepOf,
  withChain,
  withRoleRef,
  type RoleId,
  type RotationWrite,
} from "./providers-model.ts";
import {
  AccountPoolView,
  ChainMapView,
  EMPTY_ACCOUNT_DRAFT,
  RateLimitView,
  RoleRefsView,
  RotationRowView,
  UnreadableNote,
  invalidTextOf,
  type AccountDraft,
  type UsageLoad,
} from "./providers-view.tsx";

// 계정과 제공자, 예산과 한도 화면(P-11)의 편집기. 설정 항목 한 줄이 전용 편집기로 그리는 자리에 들어간다(`settings-field.tsx`).
// 모든 편집기는 초안만 바꾼다(`handlers.edit`). 저장과 되돌리기는 항목 아래의 줄이 한다(P-09 초안 흐름, `settings.set` 한 번).
// 칸 검사에서 떨어진 값은 초안에 넣지 않고 그 칸 이름과 함께 문장으로 말한다. 읽을 수 없는 값은 고치지 못하게 막는다.
// 계정 회전 행과 사용량 패널도 여기서 동작을 맡는다. 회전 행의 쓰기는 `handlers.change`(바꾸고 바로 저장, `settings.set` 한 번)다.

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
      onReserve={(entry, reservePct) => {
        const checked = checkAccount({ ...entry, reservePct });
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

const NOOP = (): void => {};

/**
 * 계정 회전 행(P-11). 켜기 키와 고지 동의 키는 플러그인 탭과 같은 설정 항목이다. 행은 그 값을 `modelAccountsView().rotation`으로
 * 옮기고, 스위치를 켜는 쪽이 고지에 동의하지 않았으면 위험 확인 대화 상자를 먼저 연다. "위험을 알고 켜기"는 동의 키를 쓰고 필요하면 켜기 키를 잇는다.
 * 키를 엔진 카탈로그에서 찾지 못하면 행은 잠긴 채 문장만 보인다. 오프라인이면 잠긴다.
 */
export function RotationPanel(props: {
  readonly view: SettingsView;
  readonly live: boolean;
  readonly handlers: FieldHandlers;
}): ReactNode {
  const { view, live, handlers } = props;
  const [asking, setAsking] = useState(false);
  const fields = allFieldsOf(view);
  const enabled = fieldOfKey(fields, ROTATION_ENABLED_KEY);
  const acknowledge = fieldOfKey(fields, ROTATION_ACK_KEY);
  if (enabled === undefined || acknowledge === undefined) {
    return (
      <RotationRowView
        state={null}
        notice={rotationRiskNotice()}
        editable={false}
        lockedText={t("desktop.providers.rotation.missing")}
        error={null}
        asking={false}
        onToggle={NOOP}
        onConfirm={NOOP}
        onCancel={NOOP}
      />
    );
  }
  const pluginEnabled = enabled.value === true;
  const acknowledged = acknowledge.value === true;
  const rotation = modelAccountsView({
    accounts: fieldOfKey(fields, ACCOUNTS_KEY)?.value,
    rateLimit: fieldOfKey(fields, RATE_LIMIT_KEY)?.value,
    acknowledged: acknowledge.value,
    pluginEnabled,
  }).rotation;
  const lock = enabled.lock ?? acknowledge.lock;
  let lockedText: string | null = null;
  if (!live) lockedText = t("desktop.providers.rotation.offline");
  else if (lock !== null) lockedText = lock.text;
  else if (!enabled.editable || !acknowledge.editable) {
    lockedText = t("desktop.providers.rotation.locked");
  }
  const editable = lockedText === null && !enabled.saving && !acknowledge.saving;
  const error = acknowledge.error?.message ?? enabled.error?.message ?? null;
  const write = (writes: readonly RotationWrite[]): void => {
    for (const change of writes) handlers.change(change.key, change.value);
  };
  return (
    <RotationRowView
      state={rotation.state}
      notice={rotation.notice}
      editable={editable}
      lockedText={lockedText}
      error={error}
      asking={asking && editable}
      onToggle={(next) => {
        const step = rotationStepOf({ pluginEnabled, acknowledged }, next);
        if (step.kind === "ask") {
          setAsking(true);
          return;
        }
        write(step.writes);
      }}
      onConfirm={() => {
        setAsking(false);
        write(rotationConfirmOf({ pluginEnabled }));
      }}
      onCancel={() => {
        setAsking(false);
      }}
    />
  );
}

/** 사용량 패널의 읽기 상태. `reload`는 "다시 읽기" 단추가 부른다 */
export interface UsageState {
  readonly load: UsageLoad;
  readonly reload: () => void;
}

/** 읽은 결과와 그 결과의 대화. 대화가 바뀌면 옛 결과는 쓰지 않는다 */
interface UsageSlot {
  readonly thread: ThreadId;
  readonly load: UsageLoad;
}

const LOADING: UsageLoad = { status: "loading" };

/**
 * `usage.get { threadId }`를 읽는다. 연결이 살아 있고 대화가 있을 때 읽고, 대화가 바뀌면 다시 읽는다. 옛 응답은 버린다.
 * 대화가 없으면 읽지 않는다(패널이 안내만 보인다).
 */
export function useUsageState(live: boolean, threadId: ThreadId | null): UsageState {
  const commands = useCommands();
  const [slot, setSlot] = useState<UsageSlot | null>(null);
  const latest = useRef(0);
  const read = useCallback(
    async (thread: ThreadId): Promise<void> => {
      latest.current += 1;
      const seq = latest.current;
      const result = await commands.usage.get({ threadId: thread });
      if (seq !== latest.current) return;
      setSlot({
        thread,
        load: result.ok
          ? { status: "ready", gauges: result.value.gauges }
          : { status: "failed", message: t("desktop.providers.usage.failed") },
      });
    },
    [commands],
  );
  useEffect(() => {
    if (live && threadId !== null) detach(read(threadId), rethrow);
  }, [live, read, threadId]);
  // 대화가 바뀌었거나 아직 읽지 않았으면 읽는 중이다. 옛 대화의 값은 보이지 않는다
  const load = slot !== null && threadId !== null && slot.thread === threadId ? slot.load : LOADING;
  return {
    load,
    reload: () => {
      if (threadId === null) return;
      setSlot(null);
      detach(read(threadId), rethrow);
    },
  };
}

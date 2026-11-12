import {
  ACCOUNTS_KEY,
  ROTATION_ACK_KEY,
  checkAccount,
  modelAccountsView,
  readAccounts,
  rotationRiskNotice,
  withAccount,
  withoutAccount,
  type AccountEntry,
} from "@fresnel/client";
import { t } from "@fresnel/client/i18n";
import {
  DEFAULT_MODEL_KEY,
  PROVIDERS_KEY,
  checkProviderId,
  providerSecretName,
  readProviders,
  submitKey,
  type FieldVM,
  type KeyField,
  type SettingsView,
  type SetupSnapshot,
} from "@fresnel/client/settings";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { SecretName } from "@fresnel/contracts/capabilities";
import type { UsageGauge } from "@fresnel/contracts/wire";
import { useCallback, useEffect, useReducer, useState, type ReactNode } from "react";
import { useLinkPhase } from "../../../state/engine/index.ts";
import { useCommands } from "../../commands.ts";
import { useModelChoices } from "../../model-usage.ts";
import { errorText } from "../../settings.tsx";
import type { FieldHandlers } from "../settings/settings-field.tsx";
import { allFieldsOf } from "../settings/settings-model.ts";
import type { CheckStep } from "../shared/check-steps.tsx";
import { providerNameOf } from "../shared/provider-names.ts";
import {
  ROTATION_ENABLED_KEY,
  addableProvidersOf,
  fieldOfKey,
  initialChecks,
  isBaseUrl,
  isModelRule,
  isPassing,
  linkedCheckOf,
  modelsCheckOf,
  nextPriorityOf,
  poolsOf,
  providerCardsOf,
  reprioritizedOf,
  rotationConfirmOf,
  rotationStepOf,
  secretNameOfRef,
  storedCheckOf,
  stringListOf,
  withCheck,
  withModelUsable,
  withNewProvider,
  withProviderBaseUrl,
  withProviderEnabled,
  withRule,
  withoutProvider,
  withoutRule,
  type ProviderCheckId,
  type ProviderCheckReason,
  type ProviderCheckResult,
  type RotationWrite,
} from "./providers-model.ts";
import {
  AccountPool,
  AccountsView,
  AddAccountDialog,
  AddProviderDialog,
  AllowedRules,
  BaseUrlDialog,
  KeyDialog,
  ModelAccessList,
  ModelPolicyView,
  ProvidersView,
  RemoveProviderDialog,
  RotationRow,
  providerStepsOf,
  type KeyDialogPhase,
  type KeySource,
} from "./providers-view.tsx";
import { invalidTextOf } from "./providers-text.ts";

// 설정 "모델과 계정" 구역의 동작(P-11, DP-83·DP-84 [결정: 2026-11-11 사용자]). 패널 셋(제공자, 계정 풀과 회전, 쓸 모델)이 여기 있다.
// 설정 값은 설정 화면의 view-model(`view`)에서 읽고, 바꾸면 바로 저장한다(`handlers.change`, `settings.set` 한 번).
// 키 값은 이 파일의 어느 상태에도 들어가지 않는다: `submitKey`가 입력란을 읽는 즉시 비우고 셸(`setup.registerKey`)로 보낸다.
// 키를 넣으면 제공자에 잇고(`setup.connectProviderKey`: 엔진의 지금 목록을 읽어 원소만 바꿔 쓴다) 곧바로 연결 시험을 돈다.
// 연결 시험의 셋째 단계는 엔진 카탈로그(`models.list`)가 이 제공자의 모델을 내는지까지다. 제공자 API를 실제로 부르는 경로는 wire에 없다.

/** 설정 화면이 패널에 넘기는 것 */
export interface ModelsPanelProps {
  readonly view: SettingsView;
  readonly live: boolean;
  readonly handlers: FieldHandlers;
}

/** 항목 하나를 바꿀 수 있는가와 막힌 이유. 오프라인·잠금·저장 중이면 바꿀 수 없다 */
function editState(
  field: FieldVM | undefined,
  live: boolean,
): {
  readonly editable: boolean;
  readonly lockedText: string | null;
  readonly error: string | null;
} {
  if (field === undefined) {
    return { editable: false, lockedText: t("desktop.providers.missing"), error: null };
  }
  let lockedText: string | null = null;
  if (!live) lockedText = t("desktop.providers.rotation.offline");
  else if (field.lock !== null) lockedText = field.lock.text;
  else if (!field.editable) lockedText = t("desktop.providers.rotation.locked");
  return {
    editable: lockedText === null && !field.saving,
    lockedText,
    error: field.error?.message ?? field.issues[0]?.message ?? null,
  };
}

interface ProviderData {
  readonly snapshot: SetupSnapshot | null;
  readonly gauges: readonly UsageGauge[];
}

const EMPTY_DATA: ProviderData = { snapshot: null, gauges: [] };

/** 시크릿 목록과 누적 사용량. 연결이 살아 있을 때 읽고 설정이 바뀌면 다시 읽는다. `reload`는 키를 넣은 뒤 부른다 */
function useProviderData(): {
  readonly snapshot: SetupSnapshot | null;
  readonly gauges: readonly UsageGauge[];
  readonly reload: () => Promise<void>;
} {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  // 읽은 결과는 통째로 바꾼다. 효과 안에서 비동기로 부르므로 setState 대신 reducer의 dispatch를 쓴다
  const [data, put] = useReducer((_: ProviderData, next: ProviderData) => next, EMPTY_DATA);
  const reload = useCallback(async (): Promise<void> => {
    const [setup, usage] = await Promise.all([
      commands.setup.load({ binaries: false }),
      commands.usage.get({}),
    ]);
    put({
      snapshot: setup.ok ? setup.value : null,
      gauges: usage.ok ? usage.value.gauges : [],
    });
  }, [commands]);
  useEffect(() => {
    if (!live) return undefined;
    detach(reload(), rethrow);
    return commands.setup.onInvalidated(() => {
      detach(reload(), rethrow);
    });
  }, [commands, live, reload]);
  return { snapshot: data.snapshot, gauges: data.gauges, reload };
}

/** 저장된(값이 있는) 시크릿 이름 */
function storedSecretsOf(snapshot: SetupSnapshot | null): readonly string[] {
  return (snapshot?.secrets ?? []).filter((row) => row.registered).map((row) => row.name);
}

function nowMs(): number {
  return performance.now();
}

/** 키 연결 대화 상자의 상태. 닫혀 있으면 null */
interface KeyTarget {
  readonly providerId: string;
  readonly name: SecretName;
  readonly action: "add" | "set";
  readonly phase: KeyDialogPhase;
  readonly source: KeySource;
  readonly picked: string | null;
}

/**
 * 연결 시험을 차례로 돈다. 단계가 바뀔 때마다 `onStep`으로 알리고, 실패하면 뒤 단계는 건너뛴다.
 * ① 키 저장(`secret.test`) ② 제공자 연결(엔진 설정의 원소) ③ 모델 목록(`models.list`)
 */
function useProviderTest(): (
  providerId: string,
  name: SecretName | null,
  onStep: (checks: readonly ProviderCheckResult[]) => void,
) => Promise<void> {
  const commands = useCommands();
  return useCallback(
    async (providerId, name, onStep) => {
      let checks = initialChecks();
      const step = (next: ProviderCheckResult): void => {
        checks = withCheck(checks, next);
        onStep(checks);
      };
      const finish = (
        id: ProviderCheckId,
        started: number,
        reason: ProviderCheckReason,
      ): boolean => {
        const passed = isPassing(reason);
        step({ id, state: passed ? "passed" : "failed", reason, elapsedMs: nowMs() - started });
        return passed;
      };
      let started = nowMs();
      step({ id: "stored", state: "running" });
      if (name === null) {
        finish("stored", started, { kind: "noKey" });
        return;
      }
      const tested = await commands.secrets.test(name);
      if (
        !finish(
          "stored",
          started,
          tested.ok
            ? storedCheckOf(tested.value)
            : { kind: "error", text: t("desktop.providers.check.detail.failed") },
        )
      ) {
        return;
      }
      started = nowMs();
      step({ id: "linked", state: "running" });
      const setup = await commands.setup.load({ binaries: false });
      if (
        !finish(
          "linked",
          started,
          setup.ok
            ? linkedCheckOf(setup.value.providers, providerId, name)
            : { kind: "error", text: errorText(setup.error) },
        )
      ) {
        return;
      }
      started = nowMs();
      step({ id: "models", state: "running" });
      const models = await commands.listModels();
      finish(
        "models",
        started,
        models.ok
          ? modelsCheckOf(models.value.models, providerId)
          : { kind: "error", text: errorText(models.error) },
      );
    },
    [commands],
  );
}

// ── 제공자 ──────────────────────────────────────────────────────────────

export function ProvidersPanel(props: ModelsPanelProps): ReactNode {
  const { view, live, handlers } = props;
  const commands = useCommands();
  const models = useModelChoices();
  const data = useProviderData();
  const runTest = useProviderTest();
  const field = fieldOfKey(allFieldsOf(view), PROVIDERS_KEY);
  const edit = editState(field, live);
  const read = readProviders(field?.value ?? []);
  const providers = read.ok ? read.value : [];
  const [steps, setSteps] = useState<Readonly<Record<string, readonly CheckStep[]>>>({});
  const [adding, setAdding] = useState<{ readonly custom: boolean } | null>(null);
  const [draftId, setDraftId] = useState("");
  const [draftBaseUrl, setDraftBaseUrl] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [key, setKey] = useState<KeyTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [baseUrl, setBaseUrl] = useState<{ readonly id: string; readonly draft: string } | null>(
    null,
  );
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const stored = storedSecretsOf(data.snapshot);

  const write = (next: readonly (typeof providers)[number][]): void => {
    handlers.change(PROVIDERS_KEY, next);
  };

  const setCardSteps = (id: string, checks: readonly ProviderCheckResult[]): void => {
    const shown = providerStepsOf(checks, {
      onKey: () => {
        openKey(id);
      },
      onEnable: () => {
        write(withProviderEnabled(providers, id, true));
      },
    });
    setSteps((prev) => ({ ...prev, [id]: shown }));
  };

  const testCard = (id: string): void => {
    const entry = providers.find((candidate) => candidate.id === id);
    const name = secretNameOfRef(entry?.apiKeyRef ?? null);
    detach(
      runTest(id, name, (checks) => {
        setCardSteps(id, checks);
      }).then(() => data.reload()),
      rethrow,
    );
  };

  /** 키 대화 상자를 연다. 호스트가 자기 창에서 값을 받으면 그 안내를, 아니면 붙여 넣기 칸을 보인다 */
  function openKey(id: string): void {
    const secret = providerSecretName(id);
    if (!secret.ok) {
      setAddError(t("desktop.providers.custom.idInvalid"));
      return;
    }
    const name = secret.value;
    const exists = stored.includes(name);
    const action = exists ? "set" : "add";
    setKey({
      providerId: id,
      name,
      action,
      phase: { kind: "entry", error: null },
      source: "paste",
      picked: null,
    });
    detach(
      commands.setup.beginKeyEntry(name, action).then((begun) => {
        if (begun.ok && begun.value) {
          setKey((prev) => (prev === null ? prev : { ...prev, phase: { kind: "hostWindow" } }));
        } else if (!begun.ok && begun.error.kind !== "unsupported") {
          setKey((prev) =>
            prev === null
              ? prev
              : { ...prev, phase: { kind: "entry", error: errorText(begun.error) } },
          );
        }
        return undefined;
      }),
      rethrow,
    );
  }

  /** 연결하고 대화 상자 안에서 시험한다 */
  const connectAndTest = async (target: KeyTarget, name: SecretName): Promise<void> => {
    const connected = await commands.setup.connectProviderKey(target.providerId, name);
    if (!connected.ok) {
      setKey((prev) =>
        prev === null
          ? prev
          : { ...prev, phase: { kind: "entry", error: errorText(connected.error) } },
      );
      return;
    }
    const show = (checks: readonly ProviderCheckResult[]): void => {
      const shown = providerStepsOf(checks, {
        onKey: () => {
          setKey((prev) =>
            prev === null ? prev : { ...prev, phase: { kind: "entry", error: null } },
          );
        },
        onEnable: () => {
          write(withProviderEnabled(providers, target.providerId, true));
        },
      });
      setKey((prev) =>
        prev === null ? prev : { ...prev, phase: { kind: "checking", steps: shown } },
      );
      setSteps((prev) => ({ ...prev, [target.providerId]: shown }));
    };
    await runTest(target.providerId, name, show);
    await data.reload();
  };

  const submitPaste = (keyField: KeyField): void => {
    if (key === null) return;
    const target = key;
    setBusy(true);
    detach(
      (async () => {
        // `submitKey`는 첫 `await` 전에 입력란을 읽고 비운다. 이 함수는 제출 이벤트 안에서 바로 불린다
        const outcome = await submitKey(commands.setup, target.name, target.action, keyField);
        switch (outcome.kind) {
          case "registered":
            await connectAndTest(target, target.name);
            break;
          case "empty":
            setKey({
              ...target,
              phase: { kind: "entry", error: t("desktop.settings.keyValue.empty") },
            });
            break;
          case "terminal":
            setKey({
              ...target,
              phase: { kind: "entry", error: t("desktop.firstRun.key.unavailable") },
            });
            break;
          case "failed":
            setKey({ ...target, phase: { kind: "entry", error: outcome.text } });
            break;
          default:
            assertNever(outcome, "KeyOutcome");
        }
        setBusy(false);
      })(),
      rethrow,
    );
  };

  const submitPick = (): void => {
    if (key === null || key.picked === null) return;
    const parsed = secretNameOfRef(`secret://${key.picked}`);
    if (parsed === null) return;
    const target = key;
    setBusy(true);
    detach(
      connectAndTest(target, parsed).then(() => {
        setBusy(false);
        return undefined;
      }),
      rethrow,
    );
  };

  const hostDone = (): void => {
    if (key === null) return;
    const target = key;
    setBusy(true);
    detach(
      connectAndTest(target, target.name).then(() => {
        setBusy(false);
        return undefined;
      }),
      rethrow,
    );
  };

  const submitCustom = (): void => {
    const id = checkProviderId(draftId);
    if (!id.ok) {
      setAddError(t("desktop.providers.custom.idInvalid"));
      return;
    }
    if (providers.some((entry) => entry.id === id.value)) {
      setAddError(t("desktop.providers.custom.exists"));
      return;
    }
    if (!isBaseUrl(draftBaseUrl)) {
      setAddError(t("desktop.providers.baseUrl.invalid"));
      return;
    }
    write(withNewProvider(providers, id.value, draftBaseUrl));
    setAdding(null);
    setDraftId("");
    setDraftBaseUrl("");
    setAddError(null);
    openKey(id.value);
  };

  const cards = read.ok
    ? providerCardsOf({
        providers,
        secrets: data.snapshot?.secrets ?? null,
        models,
        gauges: data.gauges,
      })
    : null;
  const keyName = key === null ? "" : providerNameOf(key.providerId);
  const baseUrlName = baseUrl === null ? "" : providerNameOf(baseUrl.id);
  return (
    <>
      <ProvidersView
        cards={cards}
        unreadable={read.ok ? null : t("desktop.providers.unreadable")}
        editable={edit.editable}
        lockedText={edit.lockedText}
        error={edit.error}
        addable={addableProvidersOf(providers)}
        steps={steps}
        handlers={{
          onAdd: () => {
            setAddError(null);
            setAdding({ custom: false });
          },
          onPick: openKey,
          onCustom: () => {
            setAddError(null);
            setAdding({ custom: true });
          },
          onToggle: (id, enabled) => {
            write(withProviderEnabled(providers, id, enabled));
          },
          onKey: openKey,
          onTest: testCard,
          onBaseUrl: (id) => {
            setBaseUrlError(null);
            setBaseUrl({ id, draft: providers.find((e) => e.id === id)?.baseUrl ?? "" });
          },
          onRemove: setRemoving,
        }}
      />
      <AddProviderDialog
        open={adding !== null}
        custom={adding?.custom === true}
        addable={addableProvidersOf(providers)}
        draftId={draftId}
        draftBaseUrl={draftBaseUrl}
        error={addError}
        busy={busy}
        onPick={(id) => {
          setAdding(null);
          openKey(id);
        }}
        onCustom={() => {
          setAddError(null);
          setAdding({ custom: true });
        }}
        onDraftId={setDraftId}
        onDraftBaseUrl={setDraftBaseUrl}
        onSubmitCustom={submitCustom}
        onClose={() => {
          setAdding(null);
        }}
      />
      <KeyDialog
        open={key !== null}
        providerName={keyName}
        secretName={key?.name ?? ""}
        phase={key?.phase ?? { kind: "entry", error: null }}
        source={key?.source ?? "paste"}
        secrets={stored}
        picked={key?.picked ?? null}
        busy={busy}
        onSource={(source) => {
          setKey((prev) => (prev === null ? prev : { ...prev, source }));
        }}
        onPicked={(picked) => {
          setKey((prev) => (prev === null ? prev : { ...prev, picked }));
        }}
        onSubmitPaste={submitPaste}
        onSubmitPick={submitPick}
        onHostDone={hostDone}
        onRetry={() => {
          if (key === null) return;
          const target = key;
          const name =
            secretNameOfRef(providers.find((e) => e.id === target.providerId)?.apiKeyRef ?? null) ??
            target.name;
          detach(
            connectAndTest(target, name).then(() => undefined),
            rethrow,
          );
        }}
        onClose={() => {
          setKey(null);
          setBusy(false);
        }}
      />
      <BaseUrlDialog
        open={baseUrl !== null}
        providerName={baseUrlName}
        draft={baseUrl?.draft ?? ""}
        error={baseUrlError}
        onDraft={(draft) => {
          setBaseUrl((prev) => (prev === null ? prev : { ...prev, draft }));
        }}
        onSave={() => {
          if (baseUrl === null) return;
          if (!isBaseUrl(baseUrl.draft)) {
            setBaseUrlError(t("desktop.providers.baseUrl.invalid"));
            return;
          }
          write(withProviderBaseUrl(providers, baseUrl.id, baseUrl.draft));
          setBaseUrl(null);
        }}
        onClose={() => {
          setBaseUrl(null);
        }}
      />
      <RemoveProviderDialog
        open={removing !== null}
        providerName={removing === null ? "" : providerNameOf(removing)}
        onConfirm={() => {
          if (removing !== null) write(withoutProvider(providers, removing));
          setRemoving(null);
        }}
        onClose={() => {
          setRemoving(null);
        }}
      />
    </>
  );
}

// ── 계정 풀과 회전 ───────────────────────────────────────────────────────

/** 계정 추가 대화 상자의 초안. 키 값은 들지 않는다 */
interface AccountDraft {
  readonly provider: string | null;
  readonly accountId: string;
  readonly source: KeySource;
  readonly picked: string | null;
}

const EMPTY_ACCOUNT: AccountDraft = {
  provider: null,
  accountId: "",
  source: "paste",
  picked: null,
};

/** 계정 키의 시크릿 이름: `<provider>-<계정>-api-key`. 만들 수 없으면 null */
function accountSecretOf(provider: string | null, accountId: string): SecretName | null {
  if (provider === null || accountId.trim() === "") return null;
  const made = providerSecretName(`${provider}-${accountId.trim().toLowerCase()}`);
  return made.ok ? made.value : null;
}

export function AccountsPanel(props: ModelsPanelProps): ReactNode {
  const { view, live, handlers } = props;
  const commands = useCommands();
  const data = useProviderData();
  const fields = allFieldsOf(view);
  const field = fieldOfKey(fields, ACCOUNTS_KEY);
  const edit = editState(field, live);
  const read = readAccounts(field?.value ?? []);
  const list = read.ok ? read.value : [];
  const pools = poolsOf(list);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AccountDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const stored = storedSecretsOf(data.snapshot);
  const providerChoices = [
    ...new Set([
      ...(data.snapshot?.providers ?? []).map((entry) => entry.id),
      ...pools.map((pool) => pool.provider),
    ]),
  ];

  const write = (next: readonly AccountEntry[]): void => {
    setError(null);
    handlers.change(ACCOUNTS_KEY, next);
  };

  /** 검사를 거쳐 계정 하나를 넣거나 바꾼다. 떨어지면 칸 이름과 함께 말한다 */
  const put = (entry: AccountEntry, onError: (text: string) => void): boolean => {
    const checked = checkAccount(entry);
    if (!checked.ok) {
      onError(invalidTextOf(checked.error.field));
      return false;
    }
    write(withAccount(list, checked.value));
    return true;
  };

  const submit = (keyField: KeyField): void => {
    if (draft === null) return;
    const current = draft;
    const fail = (text: string): void => {
      setDraftError(text);
      setBusy(false);
    };
    if (current.provider === null) {
      keyField.take();
      fail(t("desktop.providers.pool.needProvider"));
      return;
    }
    const provider = current.provider;
    const entryOf = (name: string): AccountEntry => ({
      provider,
      accountId: current.accountId.trim(),
      credential: `secret://${name}`,
      priority: nextPriorityOf(list, provider),
      reservePct: 0,
    });
    if (current.source === "pick") {
      keyField.take();
      if (current.picked === null) {
        fail(t("desktop.providers.key.pickPlaceholder"));
        return;
      }
      if (put(entryOf(current.picked), fail)) setDraft(null);
      return;
    }
    const name = accountSecretOf(provider, current.accountId);
    if (name === null) {
      keyField.take();
      fail(invalidTextOf("accountId"));
      return;
    }
    setBusy(true);
    detach(
      (async () => {
        const action = stored.includes(name) ? "set" : "add";
        const outcome = await submitKey(commands.setup, name, action, keyField);
        if (outcome.kind === "registered") {
          if (put(entryOf(name), fail)) setDraft(null);
          await data.reload();
        } else if (outcome.kind === "empty") {
          fail(t("desktop.settings.keyValue.empty"));
          return;
        } else if (outcome.kind === "terminal") {
          fail(t("desktop.firstRun.key.unavailable"));
          return;
        } else {
          fail(outcome.text);
          return;
        }
        setBusy(false);
      })(),
      rethrow,
    );
  };

  // 회전: 켜기 키와 고지 동의 키는 플러그인 탭과 같은 설정 항목이다
  const enabled = fieldOfKey(fields, ROTATION_ENABLED_KEY);
  const acknowledge = fieldOfKey(fields, ROTATION_ACK_KEY);
  const pluginEnabled = enabled?.value === true;
  const acknowledged = acknowledge?.value === true;
  const rotationState =
    enabled === undefined || acknowledge === undefined
      ? null
      : modelAccountsView({
          accounts: field?.value,
          rateLimit: undefined,
          acknowledged: acknowledge.value,
          pluginEnabled,
        }).rotation.state;
  let rotationLock: string | null = null;
  if (enabled === undefined || acknowledge === undefined)
    rotationLock = t("desktop.providers.rotation.missing");
  else if (!live) rotationLock = t("desktop.providers.rotation.offline");
  else if ((enabled.lock ?? acknowledge.lock) !== null)
    rotationLock = (enabled.lock ?? acknowledge.lock)?.text ?? null;
  else if (!enabled.editable || !acknowledge.editable)
    rotationLock = t("desktop.providers.rotation.locked");
  const rotationEditable =
    rotationLock === null && enabled?.saving !== true && acknowledge?.saving !== true;
  const writeRotation = (writes: readonly RotationWrite[]): void => {
    for (const change of writes) handlers.change(change.key, change.value);
  };

  return (
    <>
      <AccountsView
        editable={edit.editable}
        unreadable={read.ok ? null : t("desktop.providers.pool.unreadable")}
        error={error ?? edit.error}
        onAdd={() => {
          setDraftError(null);
          setDraft({ ...EMPTY_ACCOUNT, provider: providerChoices[0] ?? null });
        }}
        rotation={
          <RotationRow
            state={rotationState}
            notice={rotationRiskNotice()}
            pools={pools}
            editable={rotationEditable}
            lockedText={rotationLock}
            error={acknowledge?.error?.message ?? enabled?.error?.message ?? null}
            asking={asking && rotationEditable}
            onToggle={(next) => {
              const step = rotationStepOf({ pluginEnabled, acknowledged }, next);
              if (step.kind === "ask") {
                setAsking(true);
                return;
              }
              writeRotation(step.writes);
            }}
            onConfirm={() => {
              setAsking(false);
              writeRotation(rotationConfirmOf({ pluginEnabled }));
            }}
            onCancel={() => {
              setAsking(false);
            }}
          />
        }
        pool={
          <AccountPool
            pools={pools}
            expanded={expanded}
            editable={edit.editable}
            onExpand={(provider) => {
              setExpanded((prev) => new Set([...prev, provider]));
            }}
            onMove={(provider, order) => {
              write(reprioritizedOf(list, provider, order));
            }}
            onReserve={(entry, reservePct) => {
              put({ ...entry, reservePct }, setError);
            }}
            onRemove={(entry) => {
              write(withoutAccount(list, entry.provider, entry.accountId));
            }}
          />
        }
      />
      <AddAccountDialog
        open={draft !== null}
        providers={providerChoices}
        provider={draft?.provider ?? null}
        accountId={draft?.accountId ?? ""}
        secretName={accountSecretOf(draft?.provider ?? null, draft?.accountId ?? "") ?? "…"}
        source={draft?.source ?? "paste"}
        secrets={stored}
        picked={draft?.picked ?? null}
        busy={busy}
        error={draftError}
        onProvider={(provider) => {
          setDraft((prev) => (prev === null ? prev : { ...prev, provider }));
        }}
        onAccountId={(accountId) => {
          setDraft((prev) => (prev === null ? prev : { ...prev, accountId }));
        }}
        onSource={(source) => {
          setDraft((prev) => (prev === null ? prev : { ...prev, source }));
        }}
        onPicked={(picked) => {
          setDraft((prev) => (prev === null ? prev : { ...prev, picked }));
        }}
        onSubmit={submit}
        onClose={() => {
          setDraft(null);
          setBusy(false);
        }}
      />
    </>
  );
}

// ── 쓸 모델 ─────────────────────────────────────────────────────────────

const ALLOWED_KEY = "l1.models.allowedModels";
const DENIED_KEY = "l1.models.deniedModels";

export function ModelPolicyPanel(props: ModelsPanelProps): ReactNode {
  const { view, live, handlers } = props;
  const models = useModelChoices();
  const fields = allFieldsOf(view);
  const defaultField = fieldOfKey(fields, DEFAULT_MODEL_KEY);
  const allowedField = fieldOfKey(fields, ALLOWED_KEY);
  const deniedField = fieldOfKey(fields, DENIED_KEY);
  const defaultEdit = editState(defaultField, live);
  const allowedEdit = editState(allowedField, live);
  const deniedEdit = editState(deniedField, live);
  const allowed = stringListOf(allowedField?.value ?? []) ?? [];
  const denied = stringListOf(deniedField?.value ?? []) ?? [];
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [ruleError, setRuleError] = useState<string | null>(null);
  const defaultModel = typeof defaultField?.value === "string" ? defaultField.value : null;
  const providerIds = [
    ...new Set(models.map((entry) => entry.ref.slice(0, entry.ref.indexOf("/")))),
  ];
  const quick = providerIds.filter((id) => !allowed.includes(`${id}/*`));
  const notes = [defaultEdit.lockedText, allowedEdit.lockedText, deniedEdit.lockedText].find(
    (text) => text !== null,
  );
  const errors = [defaultEdit.error, deniedEdit.error].find((text) => text !== null);
  return (
    <ModelPolicyView
      defaultModel={defaultModel}
      models={models}
      editable={{
        default: defaultEdit.editable,
        denied: deniedEdit.editable,
        allowed: allowedEdit.editable,
      }}
      onDefault={(ref) => {
        handlers.change(DEFAULT_MODEL_KEY, ref);
      }}
      notes={
        notes === undefined && errors === undefined ? undefined : (
          <>
            {notes === undefined ? null : <p className="m-0 text-ui text-text-tertiary">{notes}</p>}
            {errors === undefined ? null : (
              <p role="alert" className="m-0 text-ui text-danger-text">
                {errors}
              </p>
            )}
          </>
        )
      }
      access={
        <ModelAccessList
          models={models}
          denied={denied}
          query={query}
          editable={deniedEdit.editable}
          onQuery={setQuery}
          onUsable={(ref, usable) => {
            handlers.change(DENIED_KEY, withModelUsable(denied, ref, usable));
          }}
        />
      }
      allowed={
        <AllowedRules
          rules={allowed}
          quick={quick}
          draft={draft}
          error={ruleError ?? allowedEdit.error}
          editable={allowedEdit.editable}
          onDraft={(text) => {
            setDraft(text);
            setRuleError(null);
          }}
          onAdd={(rule) => {
            const trimmed = rule.trim();
            if (!isModelRule(trimmed)) {
              setRuleError(t("desktop.models.allowed.invalid"));
              return;
            }
            setRuleError(null);
            setDraft("");
            handlers.change(ALLOWED_KEY, withRule(allowed, trimmed));
          }}
          onRemove={(rule) => {
            handlers.change(ALLOWED_KEY, withoutRule(allowed, rule));
          }}
        />
      }
    />
  );
}

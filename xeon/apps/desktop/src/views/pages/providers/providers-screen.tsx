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
import { useCommands, type SecretCommandError } from "../../commands.ts";
import { useModelChoices } from "../../model-usage.ts";
import { errorText } from "../../settings.tsx";
import type { FieldHandlers } from "../settings/settings-field.tsx";
import { allFieldsOf } from "../settings/settings-model.ts";
import type { CheckStep } from "../shared/check-steps.tsx";
import { providerNameOf } from "../shared/provider-names.ts";
import { useFallbackConfirm } from "../secrets/key-store-confirm.tsx";
import { commandErrorText } from "../secrets/secret-text.ts";
import {
  ROTATION_ENABLED_KEY,
  addableProvidersOf,
  authCheckOf,
  fieldOfKey,
  initialChecks,
  isBaseUrl,
  isModelRule,
  isNeutral,
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
  storeFailedChecks,
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
  type KeyErrorText,
  type KeySource,
} from "./providers-view.tsx";
import { invalidTextOf } from "./providers-text.ts";

// 설정 "모델과 계정" 구역의 동작(P-11, DP-83·DP-84 [결정: 2026-11-11 사용자]). 패널 셋(제공자, 계정 풀과 회전, 쓸 모델)이 여기 있다.
// 설정 값은 설정 화면의 view-model(`view`)에서 읽고, 바꾸면 바로 저장한다(`handlers.change`, `settings.set` 한 번).
// 키 값은 이 파일의 어느 상태에도 들어가지 않는다: `submitKey`가 입력란을 읽는 즉시 비우고 셸(`setup.registerKey`)로 보낸다.
// 키를 넣으면 제공자에 잇고(`setup.connectProviderKey`: 엔진의 지금 목록을 읽어 원소만 바꿔 쓴다) 곧바로 연결 시험을 돈다.
// 연결 시험의 셋째 단계는 엔진 카탈로그(`models.list`)가 이 제공자의 모델을 내는지이고, 넷째 단계(`provider.checkAuth`)가 제공자가 키를 받는지다.
// 카드의 "연결됨"은 넷째 단계가 통과했을 때만이다(DP-83 [결정: 2026-11-11 사용자]).

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

/** 키 등록 결과의 실패를 화면 문장 한 쌍으로. 값은 없다 */
function keyFailureOf(outcome: { readonly text: string; readonly fix?: string }): KeyErrorText {
  return { text: outcome.text, ...(outcome.fix === undefined ? {} : { fix: outcome.fix }) };
}

/** 시험이 떨어진 까닭: 시크릿 명령 오류의 문장 한 줄 */
function testFailureOf(error: SecretCommandError): ProviderCheckReason {
  const ref = commandErrorText(error);
  return { kind: "error", text: t(ref.id, ref.args) };
}

/**
 * 연결 시험을 차례로 돈다. 단계가 바뀔 때마다 `onStep`으로 알리고, 실패하면 뒤 단계는 건너뛴다.
 * ① 키 저장(`secret.test`) ② 제공자 연결(엔진 설정의 원소) ③ 모델 목록(`models.list`) ④ 제공자가 키를 받는지(`provider.checkAuth`)
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
        const neutral = isNeutral(reason);
        step({
          id,
          state: passed ? "passed" : neutral ? "neutral" : "failed",
          reason,
          elapsedMs: nowMs() - started,
        });
        return passed || neutral;
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
          tested.ok ? storedCheckOf(tested.value) : testFailureOf(tested.error),
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
      if (
        !finish(
          "models",
          started,
          models.ok
            ? modelsCheckOf(models.value.models, providerId)
            : { kind: "error", text: errorText(models.error) },
        )
      ) {
        return;
      }
      started = nowMs();
      step({ id: "auth", state: "running" });
      const auth = await commands.checkProviderAuth(providerId);
      finish(
        "auth",
        started,
        auth.ok ? authCheckOf(auth.value) : { kind: "error", text: errorText(auth.error) },
      );
    },
    [commands],
  );
}

// ── 제공자 ──────────────────────────────────────────────────────────────

/** 제공자 패널이 설정 화면에서 받는 것. `focusProvider`는 설정 점프가 준 제공자 id다 */
interface ProvidersPanelProps extends ModelsPanelProps {
  readonly focusProvider?: string | null;
  readonly onFocused?: () => void;
}

export function ProvidersPanel(props: ProvidersPanelProps): ReactNode {
  const { view, live, handlers, focusProvider = null, onFocused } = props;
  const commands = useCommands();
  const models = useModelChoices();
  const data = useProviderData();
  const runTest = useProviderTest();
  // 키를 넣기 전 열쇠 보관 확인(앱 파일 승인). 대화 상자는 이 화면의 그림 끝에 둔다
  const confirm = useFallbackConfirm(commands.secrets);
  const field = fieldOfKey(allFieldsOf(view), PROVIDERS_KEY);
  const edit = editState(field, live);
  const read = readProviders(field?.value ?? []);
  const providers = read.ok ? read.value : [];
  const [steps, setSteps] = useState<Readonly<Record<string, readonly CheckStep[]>>>({});
  // 제공자별 마지막 연결 시험 결과(카드 상태의 근거). 화면 상태에만 있고 저장하지 않는다
  const [results, setResults] = useState<Readonly<Record<string, readonly ProviderCheckResult[]>>>(
    {},
  );
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
    setResults((prev) => ({ ...prev, [id]: checks }));
  };

  /** 설정이 바뀐 제공자의 지난 시험 결과를 버린다. 다시 시험하기 전까지 카드는 확인 안 됨이다 */
  const forgetResult = (id: string): void => {
    setResults((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([entryId]) => entryId !== id)),
    );
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
  const openKey = useCallback(
    (id: string): void => {
      const secret = providerSecretName(id);
      if (!secret.ok) {
        setAddError(t("desktop.providers.custom.idInvalid"));
        return;
      }
      const name = secret.value;
      const exists = storedSecretsOf(data.snapshot).includes(name);
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
                : { ...prev, phase: { kind: "entry", error: { text: errorText(begun.error) } } },
            );
          }
          return undefined;
        }),
        rethrow,
      );
    },
    [commands, data.snapshot, setAddError, setKey],
  );

  // 설정 점프가 준 제공자의 키 대화 상자를 한 번 연다. 시크릿 목록을 읽은 뒤에 연다(넣을지 바꿀지가 목록에 달렸다).
  // 목록에 없는 제공자면 대화 상자 없이 목록만 보이고, 어느 쪽이든 요청은 받은 것으로 치운다
  const focusListed =
    focusProvider !== null && providers.some((entry) => entry.id === focusProvider);
  useEffect(() => {
    if (focusProvider === null || data.snapshot === null) return;
    if (focusListed) openKey(focusProvider);
    onFocused?.();
  }, [focusProvider, data.snapshot, focusListed, openKey, onFocused]);

  /** 연결하고 대화 상자 안에서 시험한다. `trimmed`는 키 앞뒤를 지웠는지(등록 결과)다 */
  const connectAndTest = async (
    target: KeyTarget,
    name: SecretName,
    trimmed = false,
  ): Promise<void> => {
    const connected = await commands.setup.connectProviderKey(target.providerId, name);
    if (!connected.ok) {
      setKey((prev) =>
        prev === null
          ? prev
          : { ...prev, phase: { kind: "entry", error: { text: errorText(connected.error) } } },
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
        prev === null ? prev : { ...prev, phase: { kind: "checking", steps: shown, trimmed } },
      );
      setSteps((prev) => ({ ...prev, [target.providerId]: shown }));
      setResults((prev) => ({ ...prev, [target.providerId]: checks }));
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
        const outcome = await submitKey(
          commands.setup,
          target.name,
          target.action,
          keyField,
          confirm.preflight,
        );
        switch (outcome.kind) {
          case "registered":
            await connectAndTest(target, target.name, outcome.trimmed);
            break;
          case "cancelled":
            // 열쇠 보관 확인에서 취소했다. 입력란과 키 창은 그대로 둔다
            break;
          case "empty":
            setKey({
              ...target,
              phase: { kind: "entry", error: { text: t("desktop.settings.keyValue.empty") } },
            });
            break;
          case "terminal":
            setKey({
              ...target,
              phase: { kind: "entry", error: { text: t("desktop.firstRun.key.unavailable") } },
            });
            break;
          case "failed":
            setKey({ ...target, phase: { kind: "entry", error: keyFailureOf(outcome) } });
            // 등록이 떨어진 사유는 카드의 저장 단계에도 남긴다(대화 상자를 닫아도 카드에서 보인다)
            setCardSteps(target.providerId, storeFailedChecks(outcome.text, outcome.fix));
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
        checks: results,
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
            forgetResult(id);
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
          forgetResult(baseUrl.id);
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
          if (removing !== null) {
            forgetResult(removing);
            write(withoutProvider(providers, removing));
          }
          setRemoving(null);
        }}
        onClose={() => {
          setRemoving(null);
        }}
      />
      {confirm.dialog}
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
  // 계정 풀의 키 등록도 등록 전 열쇠 보관 확인을 거친다(같은 키 저장소 규칙)
  const confirm = useFallbackConfirm(commands.secrets);
  const fields = allFieldsOf(view);
  const field = fieldOfKey(fields, ACCOUNTS_KEY);
  const edit = editState(field, live);
  const read = readAccounts(field?.value ?? []);
  const list = read.ok ? read.value : [];
  const pools = poolsOf(list);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AccountDraft | null>(null);
  const [draftError, setDraftError] = useState<KeyErrorText | null>(null);
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
    const fail = (text: string, fix?: string): void => {
      setDraftError(fix === undefined ? { text } : { text, fix });
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
        const outcome = await submitKey(commands.setup, name, action, keyField, confirm.preflight);
        if (outcome.kind === "registered") {
          if (put(entryOf(name), fail)) setDraft(null);
          await data.reload();
        } else if (outcome.kind === "cancelled") {
          // 열쇠 보관 확인에서 취소했다. 초안은 그대로 둔다
          setBusy(false);
          return;
        } else if (outcome.kind === "empty") {
          fail(t("desktop.settings.keyValue.empty"));
          return;
        } else if (outcome.kind === "terminal") {
          fail(t("desktop.firstRun.key.unavailable"));
          return;
        } else {
          fail(outcome.text, outcome.fix);
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
      {confirm.dialog}
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

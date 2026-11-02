import { detach, rethrow } from "@fresnel/contracts";
import type { SecretName } from "@fresnel/contracts/capabilities";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { keepTools } from "../app/setup.ts";
import { useLinkPhase } from "../state/engine/index.ts";
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  checkModelRef,
  checkProviderId,
  PRESET_PROVIDERS,
  providerSecretName,
  setupSteps,
  submitKey,
  type KeyField,
  type BinaryView,
  type SetupSnapshot,
  type SetupStep,
} from "@fresnel/client/settings";
import { useCommands, type CommandError } from "./commands.ts";

// 최소 설정 화면(G2-08, L4.desktop.spec §4.14): 첫 실행 안내, 외부 도구 점검 결과, 모델 키 등록, 기본 모델.
// 요청 결과로 얻는 값이라 거울에 넣지 않고 이 화면의 로컬 상태에 둔다(FS-03, FS-04).
// 키 값은 호스트가 받을 수 없는 연결(사이드카)에서만 이 화면의 등록 창에서 받는다(§4.14.1). 그 입력란은 제어 컴포넌트가 아니다:
// 값은 React 상태에 들어가지 않고, 저장을 누르면 `submitKey`가 입력란을 읽는 즉시 비운다.

// 문장은 id로 들고 있다가 그릴 때 현재 로케일로 만든다(모듈을 읽을 때의 로케일에 묶이지 않도록)
const STEP_TEXT_ID: Readonly<Record<SetupStep["id"], MessageId>> = {
  tools: "desktop.settings.step.tools",
  key: "desktop.settings.step.key",
  model: "desktop.settings.step.model",
};

export type KeyEntry =
  | { readonly state: "idle" }
  | { readonly state: "busy" }
  /** 호스트가 값을 받을 수 없어 이 화면의 등록 창을 연다. 값은 상태에 없다 */
  | { readonly state: "form"; readonly name: SecretName; readonly action: "add" | "set" }
  /** 셸에도 값을 받는 길이 없다. 터미널 명령을 안내한다 */
  | { readonly state: "terminal"; readonly command: string }
  | { readonly state: "failed"; readonly text: string };

export function errorText(error: CommandError): string {
  if (error.kind === "offline") return t("desktop.settings.error.offline");
  if (error.kind === "unsupported") return t("desktop.settings.error.unsupported");
  if (error.kind === "rejected" && error.detail !== undefined) {
    // 값이 틀렸다는 host의 문장은 사용자가 고칠 수 있는 내용이라 그대로 보인다(예: 알 수 없는 모델 ...)
    return t("desktop.settings.error.rejectedDetail", { detail: error.detail });
  }
  if (error.kind === "rejected" && error.code !== null) {
    return t("desktop.settings.error.rejectedCode", { code: error.code });
  }
  return t("desktop.settings.error.failed");
}

export function Steps(props: { readonly steps: readonly SetupStep[] }): ReactNode {
  return (
    <ol className="setup-steps" aria-label={t("desktop.settings.steps.label")}>
      {props.steps.map((step) => (
        <li key={step.id} data-done={step.done ? "yes" : "no"}>
          <span aria-hidden="true">{step.done ? "[x]" : "[ ]"}</span> {t(STEP_TEXT_ID[step.id])}
          {step.unknown ? <span className="dim"> {t("desktop.settings.step.unknown")}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function Tools(props: { readonly binaries: BinaryView | null }): ReactNode {
  const { binaries } = props;
  if (binaries === null) {
    return (
      <p className="dim">
        {t("desktop.settings.tools.unavailable")} {t("desktop.settings.tools.doctorBefore")}{" "}
        <code>fresnel doctor</code>
        {t("desktop.settings.tools.doctorAfter")}
      </p>
    );
  }
  return (
    <table className="setup-tools">
      <thead>
        <tr>
          <th>{t("desktop.settings.tools.column.tool")}</th>
          <th>{t("desktop.settings.tools.column.need")}</th>
          <th>{t("desktop.settings.tools.column.status")}</th>
          <th>{t("desktop.settings.tools.column.usedBy")}</th>
        </tr>
      </thead>
      <tbody>
        {binaries.rows.map((row) => (
          <tr key={row.name} data-ok={row.ok ? "yes" : "no"}>
            <td>
              <code>{row.name}</code>
            </td>
            <td>
              {row.need === "required"
                ? t("desktop.settings.tools.need.required")
                : t("desktop.settings.tools.need.optional")}
            </td>
            <td>
              {row.ok
                ? t("desktop.settings.tools.status.available")
                : t("desktop.settings.tools.status.unavailable")}{" "}
              <span className="dim">{row.note}</span>
              {row.ok ? null : <div className="dim">{row.impact}</div>}
            </td>
            <td className="dim">{row.usedBy}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * 키 값 등록 창. 입력란은 제어 컴포넌트가 아니다: 값은 DOM 노드에만 있고 React 상태와 props에 들어가지 않는다.
 * 저장을 누르면 부모가 `field.take()`로 읽는 즉시 비운다. 취소와 사라짐(unmount)도 비운다.
 */
function KeyForm(props: {
  readonly busy: boolean;
  readonly onSubmit: (field: KeyField) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const input = useRef<HTMLInputElement | null>(null);
  const clear = (): void => {
    if (input.current !== null) input.current.value = "";
  };
  return (
    <form
      className="key-form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit({
          take: () => {
            const typed = input.current?.value ?? "";
            clear();
            return typed;
          },
        });
      }}
    >
      <label className="field">
        <span>{t("desktop.settings.keyValue.label")}</span>
        <input
          ref={input}
          type="password"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          defaultValue=""
        />
      </label>
      <div className="approval-actions">
        <button type="submit" className="primary" disabled={props.busy}>
          {t("desktop.settings.save.button")}
        </button>
        <button
          type="button"
          disabled={props.busy}
          onClick={() => {
            clear();
            props.onCancel();
          }}
        >
          {t("desktop.settings.cancel.button")}
        </button>
      </div>
    </form>
  );
}

export function SettingsBody(props: {
  readonly snapshot: SetupSnapshot;
  readonly providerInput: string;
  readonly modelInput: string;
  readonly keyEntry: KeyEntry;
  readonly busy: boolean;
  readonly message: string | null;
  readonly onProvider: (value: string) => void;
  readonly onModel: (value: string) => void;

  readonly onRegister: () => void;
  /** 저장을 눌렀다. `field.take()`가 입력란을 읽고 비운다 */
  readonly onSubmitKey: (field: KeyField) => void;
  readonly onCancelKey: () => void;
  readonly onConnect: () => void;
  readonly onRecheck: () => void;
  readonly onSaveModel: () => void;
}): ReactNode {
  const { snapshot } = props;
  const provider = checkProviderId(props.providerInput);
  const secret = provider.ok ? providerSecretName(provider.value) : null;
  const secretName = secret?.ok === true ? secret.value : null;
  const registered =
    secretName !== null &&
    (snapshot.secrets ?? []).some((s) => s.name === secretName && s.registered);
  const linked =
    provider.ok &&
    snapshot.providers.some(
      (entry) =>
        entry.id === provider.value &&
        entry.enabled &&
        secretName !== null &&
        entry.apiKeyRef === `secret://${secretName}`,
    );
  const model = checkModelRef(props.modelInput);
  return (
    <div className="settings">
      <section>
        <h2>{t("desktop.settings.start.title")}</h2>
        <Steps steps={setupSteps(snapshot)} />
      </section>
      <section>
        <h2>{t("desktop.settings.tools.title")}</h2>
        <Tools binaries={snapshot.binaries} />
      </section>
      <section>
        <h2>{t("desktop.settings.modelKey.title")}</h2>
        <p className="dim">
          {t("desktop.settings.keyNote.value")} {t("desktop.settings.keyNote.bundled")}{" "}
          <code>fresnel</code>
          {t("desktop.settings.keyNote.storage")}{" "}
          <code>{t("desktop.settings.keyNote.refExample")}</code>{" "}
          {t("desktop.settings.keyNote.refOnly")}
        </p>
        <label className="field">
          <span>{t("desktop.settings.provider.label")}</span>
          <input
            type="text"
            list="provider-presets"
            value={props.providerInput}
            onChange={(event) => {
              props.onProvider(event.currentTarget.value);
            }}
          />
          <datalist id="provider-presets">
            {PRESET_PROVIDERS.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </label>
        {secretName === null ? (
          <p className="dim">{t("desktop.settings.provider.nameRule")}</p>
        ) : (
          <p>
            {t("desktop.settings.secretName.label")} <code>{secretName}</code> ·{" "}
            <span data-registered={registered ? "yes" : "no"}>
              {registered
                ? t("desktop.settings.secret.registered")
                : t("desktop.settings.secret.notRegistered")}
            </span>
            {linked ? ` · ${t("desktop.settings.provider.linked")}` : ""}
          </p>
        )}
        <div className="approval-actions">
          <button
            type="button"
            className="primary"
            disabled={props.busy || secretName === null}
            onClick={props.onRegister}
          >
            {registered
              ? t("desktop.settings.key.change.button")
              : t("desktop.settings.key.register.button")}
          </button>
          <button
            type="button"
            disabled={props.busy || secretName === null || !registered || linked}
            onClick={props.onConnect}
          >
            {t("desktop.settings.provider.connect.button")}
          </button>
          <button type="button" disabled={props.busy} onClick={props.onRecheck}>
            {t("desktop.settings.recheck.button")}
          </button>
        </div>
        {props.keyEntry.state === "form" ? (
          <KeyForm busy={props.busy} onSubmit={props.onSubmitKey} onCancel={props.onCancelKey} />
        ) : null}
        {props.keyEntry.state === "terminal" ? (
          <div role="note">
            <p>
              {t("desktop.settings.key.terminalHint", {
                button: t("desktop.settings.recheck.button"),
              })}
            </p>
            <pre className="code">{props.keyEntry.command}</pre>
          </div>
        ) : null}
        {props.keyEntry.state === "failed" ? (
          <div className="error" role="alert">
            {props.keyEntry.text}
          </div>
        ) : null}
      </section>
      <section>
        <h2>{t("desktop.settings.defaultModel.title")}</h2>
        <label className="field">
          <span>{t("desktop.settings.modelRef.label")}</span>
          <input
            type="text"
            placeholder="anthropic/claude-sonnet-5-5"
            value={props.modelInput}
            onChange={(event) => {
              props.onModel(event.currentTarget.value);
            }}
          />
        </label>
        <div className="approval-actions">
          <button
            type="button"
            className="primary"
            disabled={props.busy || !model.ok}
            onClick={props.onSaveModel}
          >
            {t("desktop.settings.save.button")}
          </button>
          {snapshot.defaultModel === null ? (
            <span className="dim">{t("desktop.settings.defaultModel.unset")}</span>
          ) : (
            <span className="dim">
              {t("desktop.settings.defaultModel.current", { model: snapshot.defaultModel })}
            </span>
          )}
        </div>
        {!model.ok && props.modelInput.trim() !== "" ? (
          <p className="error">{t("desktop.settings.modelRef.invalid")}</p>
        ) : null}
      </section>
      {props.message === null ? null : (
        <div role="status" className="dim">
          {props.message}
        </div>
      )}
    </div>
  );
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly error: CommandError }
  | { readonly kind: "ready"; readonly snapshot: SetupSnapshot };

export function SettingsScreen(): ReactNode {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [providerInput, setProviderInput] = useState("anthropic");
  const [modelInput, setModelInput] = useState("");
  const [keyEntry, setKeyEntry] = useState<KeyEntry>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // `withTools`가 거짓이면(설정이 바뀌었다는 알림) 외부 도구 점검은 다시 하지 않고 앞서 읽은 결과를 유지한다
  const reload = useCallback(
    (withTools: boolean): Promise<void> => {
      return commands.setup.load({ binaries: withTools }).then((result) => {
        if (result.ok) {
          const fresh = result.value;
          setLoaded((previous) =>
            withTools || previous.kind !== "ready"
              ? { kind: "ready", snapshot: fresh }
              : { kind: "ready", snapshot: keepTools(fresh, previous.snapshot) },
          );
          // 입력란이 비어 있을 때만 지금 값을 채운다. 사용자가 고치던 글자를 덮어쓰지 않는다
          setModelInput((current) => (current === "" ? (fresh.defaultModel ?? "") : current));
        } else {
          setLoaded({ kind: "error", error: result.error });
        }
        return undefined;
      });
    },
    [commands],
  );

  // 연결이 살아나면 읽고, 설정이 바뀌었다는 알림을 받으면 다시 읽는다
  useEffect(() => {
    if (phase !== "live") return undefined;
    detach(reload(true), rethrow);
    return commands.setup.onInvalidated(() => {
      detach(reload(false), rethrow);
    });
  }, [commands, phase, reload]);

  const work = (job: () => Promise<void>): void => {
    setBusy(true);
    setMessage(null);
    detach(
      job().then(() => {
        setBusy(false);
        return undefined;
      }),
      rethrow,
    );
  };

  const secretNameNow = (): SecretName | null => {
    const provider = checkProviderId(providerInput);
    if (!provider.ok) return null;
    const secret = providerSecretName(provider.value);
    return secret.ok ? secret.value : null;
  };

  const register = (): void => {
    const provider = checkProviderId(providerInput);
    const name = secretNameNow();
    if (!provider.ok || name === null || loaded.kind !== "ready") return;
    const exists = (loaded.snapshot.secrets ?? []).some((s) => s.name === name && s.registered);
    work(async () => {
      setKeyEntry({ state: "busy" });
      const action = exists ? "set" : "add";
      const begun = await commands.setup.beginKeyEntry(name, action);
      // 호스트가 값을 받을 수 없는 연결(사이드카)이거나 그 메서드가 없는 엔진이면 이 화면의 등록 창을 연다
      if (!begun.ok && begun.error.kind !== "unsupported") {
        setKeyEntry({ state: "failed", text: errorText(begun.error) });
        return;
      }
      if (!begun.ok || !begun.value) {
        setKeyEntry({ state: "form", name, action });
        return;
      }
      setKeyEntry({ state: "idle" });
      const connected = await commands.setup.connectProviderKey(provider.value, name);
      if (!connected.ok) setKeyEntry({ state: "failed", text: errorText(connected.error) });
      await reload(false);
    });
  };

  const submitKeyValue = (field: KeyField): void => {
    const provider = checkProviderId(providerInput);
    if (!provider.ok || keyEntry.state !== "form") return;
    const { name, action } = keyEntry;
    work(async () => {
      // `submitKey`는 첫 await 전에 입력란을 읽고 비운다. 그 뒤에 상태를 바꿔 등록 창을 내린다
      const submitting = submitKey(commands.setup, name, action, field);
      setKeyEntry({ state: "busy" });
      const outcome = await submitting;
      if (outcome.kind === "terminal") {
        setKeyEntry({ state: "terminal", command: `fresnel secret ${action} ${name}` });
        return;
      }
      if (outcome.kind === "failed") {
        setKeyEntry({ state: "failed", text: outcome.text });
        return;
      }
      if (outcome.kind === "empty") {
        setKeyEntry({ state: "failed", text: t("desktop.settings.keyValue.empty") });
        return;
      }
      setKeyEntry({ state: "idle" });
      const connected = await commands.setup.connectProviderKey(provider.value, name);
      if (!connected.ok) setKeyEntry({ state: "failed", text: errorText(connected.error) });
      // 등록 결과는 `secret.list`를 다시 읽어 보인다(등록됨)
      await reload(false);
    });
  };

  const cancelKey = (): void => {
    setKeyEntry({ state: "idle" });
  };

  const connect = (): void => {
    const provider = checkProviderId(providerInput);
    const name = secretNameNow();
    if (!provider.ok || name === null) return;
    work(async () => {
      const connected = await commands.setup.connectProviderKey(provider.value, name);
      setKeyEntry(
        connected.ok ? { state: "idle" } : { state: "failed", text: errorText(connected.error) },
      );
      await reload(false);
    });
  };

  const saveModel = (): void => {
    const model = checkModelRef(modelInput);
    if (!model.ok) return;
    work(async () => {
      const saved = await commands.setup.setDefaultModel(model.value);
      setMessage(saved.ok ? t("desktop.settings.defaultModel.saved") : errorText(saved.error));
      await reload(false);
    });
  };

  return (
    <main className="main settings-screen">
      <header className="settings-header">
        <h1>{t("desktop.settings.title")}</h1>
        <button
          type="button"
          onClick={() => {
            commands.showScreen("chat");
          }}
        >
          {t("desktop.settings.backToChat.button")}
        </button>
      </header>
      {loaded.kind === "loading" ? (
        <p className="dim">{t("desktop.settings.loading.status")}</p>
      ) : null}
      {loaded.kind === "error" ? (
        <div className="error" role="alert">
          {t("desktop.settings.loadFailed", { reason: errorText(loaded.error) })}
        </div>
      ) : null}
      {loaded.kind === "ready" ? (
        <SettingsBody
          snapshot={loaded.snapshot}
          providerInput={providerInput}
          modelInput={modelInput}
          keyEntry={keyEntry}
          busy={busy}
          message={message}
          onProvider={(value) => {
            setProviderInput(value);
            setKeyEntry({ state: "idle" });
          }}
          onModel={setModelInput}
          onRegister={register}
          onSubmitKey={submitKeyValue}
          onCancelKey={cancelKey}
          onConnect={connect}
          onRecheck={() => {
            setKeyEntry({ state: "idle" });
            work(() => reload(true));
          }}
          onSaveModel={saveModel}
        />
      ) : null}
    </main>
  );
}
